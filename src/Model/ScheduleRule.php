<?php

namespace Mattoid\PluginScheduler\Model;

use Flarum\Database\AbstractModel;

class ScheduleRule extends AbstractModel
{
    protected $table = 'plugin_schedule_rules';

    protected $fillable = ['extension', 'action', 'repeat_type', 'execute_time', 'executed_at'];

    protected $dates = ['execute_time', 'executed_at'];
}
