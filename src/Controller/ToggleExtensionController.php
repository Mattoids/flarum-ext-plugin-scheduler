<?php

namespace Mattoid\PluginScheduler\Controller;

use Flarum\Api\Controller\AbstractShowController;
use Flarum\Extension\ExtensionManager;
use Flarum\Foundation\ValidationException;
use Illuminate\Support\Arr;
use Mattoid\PluginScheduler\Command\ApplyScheduleRules;
use Mattoid\PluginScheduler\Serializer\ScheduleRuleSerializer;
use Psr\Http\Message\ServerRequestInterface;
use Tobscure\JsonApi\Document;

class ToggleExtensionController extends AbstractShowController
{
    public $serializer = ScheduleRuleSerializer::class;

    protected function data(ServerRequestInterface $request, Document $document)
    {
        $request->getAttribute('actor')->assertAdmin();

        $attributes = Arr::get($request->getParsedBody(), 'data.attributes', []);

        $extension = trim((string) Arr::get($attributes, 'extension', ''));
        $action = Arr::get($attributes, 'action', '');

        if ($extension === '' || !in_array($action, ['enable', 'disable'], true)) {
            throw new ValidationException(['extension' => 'Invalid extension or action']);
        }

        $extensionId = ApplyScheduleRules::toExtensionId($extension);

        if ($extensionId === ApplyScheduleRules::SELF_EXTENSION && $action === 'disable') {
            throw new ValidationException(['extension' => 'Cannot disable the scheduler extension itself']);
        }

        /** @var ExtensionManager $manager */
        $manager = resolve(ExtensionManager::class);

        if ($action === 'enable') {
            $manager->enable($extensionId);
        } else {
            $manager->disable($extensionId);
        }

        return new \stdClass();
    }
}
