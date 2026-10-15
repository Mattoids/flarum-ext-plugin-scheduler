<?php

namespace Mattoid\PluginScheduler\Controller;

use Flarum\Api\Controller\AbstractCreateController;
use Flarum\Foundation\ValidationException;
use Illuminate\Support\Arr;
use Mattoid\PluginScheduler\Command\ApplyScheduleRules;
use Mattoid\PluginScheduler\Model\ScheduleRule;
use Mattoid\PluginScheduler\Serializer\ScheduleRuleSerializer;
use Mattoid\PluginScheduler\SettingsTargets;
use Psr\Http\Message\ServerRequestInterface;
use Tobscure\JsonApi\Document;

class SaveRuleController extends AbstractCreateController
{
    public $serializer = ScheduleRuleSerializer::class;

    protected function data(ServerRequestInterface $request, Document $document)
    {
        $request->getAttribute('actor')->assertAdmin();

        $attributes = Arr::get($request->getParsedBody(), 'data.attributes', []);

        $ruleType = Arr::get($attributes, 'ruleType', 'extension');
        $repeatType = Arr::get($attributes, 'repeatType', 'once');
        $executeTime = Arr::get($attributes, 'executeTime', '');

        if (!in_array($ruleType, ['extension', 'setting'], true) || !in_array($repeatType, ['once', 'daily', 'weekly', 'monthly', 'yearly'], true)) {
            throw new ValidationException(['ruleType' => 'Invalid rule parameters']);
        }

        $time = \DateTime::createFromFormat('Y-m-d H:i', $executeTime);
        if (!$time) {
            $time = \DateTime::createFromFormat('Y-m-d\TH:i', $executeTime);
        }

        if (!$time) {
            throw new ValidationException(['executeTime' => 'Invalid execute_time format, expected Y-m-d H:i']);
        }

        $rule = new ScheduleRule();
        $rule->rule_type = $ruleType;
        $rule->repeat_type = $repeatType;
        $rule->execute_time = $time;

        if ($ruleType === 'setting') {
            $this->applySettingAttributes($rule, $attributes);
        } else {
            $extension = trim((string) Arr::get($attributes, 'extension', ''));
            $action = Arr::get($attributes, 'action', '');

            if ($extension === '' || !in_array($action, ['enable', 'disable'], true)) {
                throw new ValidationException(['extension' => 'Invalid rule parameters']);
            }

            if (ApplyScheduleRules::toExtensionId($extension) === ApplyScheduleRules::SELF_EXTENSION) {
                throw new ValidationException(['extension' => 'Cannot schedule the scheduler extension itself']);
            }

            $rule->extension = $extension;
            $rule->action = $action;
        }

        $rule->save();

        return $rule;
    }

    public static function applySettingAttributes(ScheduleRule $rule, array $attributes)
    {
        $action = Arr::get($attributes, 'action', '');
        $settingKey = trim((string) Arr::get($attributes, 'settingKey', ''));

        if (!in_array($action, ['set', 'reset'], true)) {
            throw new ValidationException(['action' => 'Invalid action for setting rule, expected set/reset']);
        }

        if (!SettingsTargets::isValid($settingKey)) {
            throw new ValidationException(['settingKey' => 'Unsupported setting key: ' . $settingKey]);
        }

        $rule->extension = '';
        $rule->action = $action;
        $rule->setting_key = $settingKey;
        $rule->setting_value = $action === 'set' ? (string) Arr::get($attributes, 'settingValue', '') : null;
    }
}
