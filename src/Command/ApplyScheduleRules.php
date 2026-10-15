<?php

namespace Mattoid\PluginScheduler\Command;

use Flarum\Console\AbstractCommand;
use Flarum\Extension\ExtensionManager;
use Flarum\Settings\SettingsRepositoryInterface;
use Mattoid\PluginScheduler\Model\ScheduleRule;
use Psr\Log\LoggerInterface;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

class ApplyScheduleRules extends AbstractCommand
{
    const SELF_EXTENSION = 'mattoid-plugin-scheduler';

    /**
     * Flarum 的 ExtensionManager 使用扩展 ID（如 mattoid-store），
     * 这里同时兼容 Composer 包名（如 mattoid/flarum-ext-store）。
     */
    public static function toExtensionId($name)
    {
        if (strpos($name, '/') === false) {
            return $name;
        }

        [$vendor, $package] = explode('/', $name);
        $package = str_replace(['flarum-ext-', 'flarum-'], '', $package);

        return $vendor.'-'.$package;
    }

    protected static $defaultName = 'plugin-scheduler:apply';

    protected function configure()
    {
        $this->setName(static::$defaultName)
            ->setDescription('Apply due plugin schedule rules (enable/disable extensions).');
    }

    protected function fire()
    {
        // 规则时间是按设置时区解释的裸墙钟时间（管理端按本地时间选择直接存库），
        // 而 PHP CLI/Flarum 运行时时区是 UTC，比较前必须把 now 转换到设置时区。
        $tzName = resolve(SettingsRepositoryInterface::class)->get('mattoid-plugin-scheduler.timezone') ?: 'Asia/Shanghai';
        $tz = new \DateTimeZone($tzName);
        $now = new \DateTime('now', $tz);
        $nowTime = $now->format('H:i');
        $nowDate = $now->format('Y-m-d');

        $rules = ScheduleRule::query()->get();

        /** @var ExtensionManager $extensions */
        $extensions = resolve(ExtensionManager::class);

        $applied = 0;
        foreach ($rules as $rule) {
            // shiftTimezone：把库里按设置时区解释的裸时间挂到该时区（不做换算）
            $executeTime = $rule->execute_time->copy()->shiftTimezone($tz);

            $due = false;

            if ($rule->repeat_type === 'daily') {
                $executedAt = $rule->executed_at ? $rule->executed_at->copy()->shiftTimezone($tz) : null;
                $executedToday = $executedAt && $executedAt->format('Y-m-d') === $nowDate;
                $due = ($executeTime->format('H:i') === $nowTime) && !$executedToday;
            } else {
                // once：到达或超过设定时间即执行
                $due = $executeTime <= $now;
            }

            if (!$due) {
                continue;
            }

            $extensionId = static::toExtensionId($rule->extension);

            if ($extensionId === static::SELF_EXTENSION) {
                $this->info('Skipping rule #' . $rule->id . ': cannot schedule the scheduler extension itself.');
                continue;
            }

            try {
                if ($rule->action === 'enable') {
                    $this->enableCascade($extensions, $extensionId);
                } else {
                    $this->disableCascade($extensions, $extensionId);
                }

                $this->info('Rule #' . $rule->id . ': ' . $rule->action . ' ' . $rule->extension);

                if ($rule->repeat_type === 'once') {
                    $rule->delete();
                } else {
                    $rule->executed_at = $now;
                    $rule->save();
                }

                $applied++;
            } catch (\Throwable $e) {
                /** @var LoggerInterface $logger */
                $logger = resolve(LoggerInterface::class);
                $logger->error('[plugin-scheduler] rule #' . $rule->id . ' failed: ' . $e->getMessage());
                $this->error('Rule #' . $rule->id . ' failed: ' . $e->getMessage());
            }
        }

        $this->info('Plugin scheduler: ' . $applied . ' rule(s) applied.');
    }

    /**
     * 级联禁用：先深度收集所有「已启用且依赖 $id（含传递依赖）」的扩展并禁用，
     * 再禁用 $id 本身。若级联列表包含本插件自身，整个规则中止。
     */
    protected function disableCascade(ExtensionManager $extensions, $id)
    {
        $cascade = [];
        $visited = [$id => true];
        $queue = [$id];

        while ($queue) {
            $current = array_shift($queue);
            foreach ($extensions->getEnabledExtensions() as $ext) {
                $extId = $ext->getId();
                if (isset($visited[$extId])) {
                    continue;
                }
                if (in_array($current, $ext->getExtensionDependencyIds(), true)) {
                    $visited[$extId] = true;
                    $cascade[] = $extId;
                    $queue[] = $extId;
                }
            }
        }

        if (in_array(static::SELF_EXTENSION, $cascade, true)) {
            $msg = 'Aborting disable of ' . $id . ': cascade would disable the scheduler extension itself.';
            /** @var LoggerInterface $logger */
            $logger = resolve(LoggerInterface::class);
            $logger->warning('[plugin-scheduler] ' . $msg);
            $this->error($msg);
            throw new \RuntimeException($msg);
        }

        // 先禁用依赖方（级联），再禁用目标
        foreach ($cascade as $extId) {
            $extensions->disable($extId);
            $this->info('disable ' . $extId . ' (dependency cascade)');
        }
        $extensions->disable($id);
    }

    /**
     * 级联启用：递归先启用 $id 缺失的依赖，再启用 $id。
     * 依赖未安装时记录错误并使规则失败；依赖链里的本插件自身直接跳过。
     */
    protected function enableCascade(ExtensionManager $extensions, $id, $chain = [])
    {
        if (isset($chain[$id])) {
            throw new \RuntimeException('Circular dependency detected while enabling ' . $id);
        }
        $chain[$id] = true;

        $extension = $extensions->getExtension($id);
        if (!$extension) {
            throw new \RuntimeException('Extension not installed: ' . $id);
        }

        foreach ($extension->getExtensionDependencyIds() as $depId) {
            if ($depId === static::SELF_EXTENSION) {
                continue;
            }
            if (!$extensions->isEnabled($depId)) {
                $this->enableCascade($extensions, $depId, $chain);
                $extensions->enable($depId);
                $this->info('enable ' . $depId . ' (dependency cascade)');
            }
        }

        $extensions->enable($id);
    }

    protected function info($message)
    {
        if ($this->output) {
            $this->output->writeln('<info>' . $message . '</info>');
        }
    }

    protected function error($message)
    {
        if ($this->output) {
            $this->output->writeln('<error>' . $message . '</error>');
        }
    }
}
