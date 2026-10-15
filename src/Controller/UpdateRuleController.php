<?php

namespace Mattoid\PluginScheduler\Controller;

use Flarum\Api\Controller\AbstractCreateController;
use Flarum\Foundation\ValidationException;
use Illuminate\Support\Arr;
use Mattoid\PluginScheduler\Command\ApplyScheduleRules;
use Mattoid\PluginScheduler\Model\ScheduleRule;
use Mattoid\PluginScheduler\Serializer\ScheduleRuleSerializer;
use Psr\Http\Message\ServerRequestInterface;
use Tobscure\JsonApi\Document;

class UpdateRuleController extends AbstractCreateController
{
    public $serializer = ScheduleRuleSerializer::class;

    protected function data(ServerRequestInterface $request, Document $document)
    {
        $request->getAttribute('actor')->assertAdmin();

        $id = Arr::get($request->getQueryParams(), 'id');
        $rule = ScheduleRule::query()->findOrFail($id);

        $attributes = Arr::get($request->getParsedBody(), 'data.attributes', []);

        $extension = trim((string) Arr::get($attributes, 'extension', ''));
        $action = Arr::get($attributes, 'action', '');
        $repeatType = Arr::get($attributes, 'repeatType', 'once');
        $executeTime = Arr::get($attributes, 'executeTime', '');

        if ($extension === '' || !in_array($action, ['enable', 'disable'], true) || !in_array($repeatType, ['once', 'daily'], true)) {
            throw new ValidationException(['extension' => 'Invalid rule parameters']);
        }

        if (ApplyScheduleRules::toExtensionId($extension) === ApplyScheduleRules::SELF_EXTENSION) {
            throw new ValidationException(['extension' => 'Cannot schedule the scheduler extension itself']);
        }

        $time = \DateTime::createFromFormat('Y-m-d H:i', $executeTime);
        if (!$time) {
            $time = \DateTime::createFromFormat('Y-m-d\TH:i', $executeTime);
        }

        if (!$time) {
            throw new ValidationException(['executeTime' => 'Invalid execute_time format, expected Y-m-d H:i']);
        }

        $rule->extension = $extension;
        $rule->action = $action;
        $rule->repeat_type = $repeatType;
        $rule->execute_time = $time;

        // daily 规则执行时间可能改到当天更晚时刻，清掉当天防重标记；
        // once 规则同理由调用方决定（更新即视为未执行）
        $rule->executed_at = null;

        $rule->save();

        return $rule;
    }
}
