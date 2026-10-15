import app from 'flarum/admin/app';
import ExtensionPage from 'flarum/admin/components/ExtensionPage';
import Button from 'flarum/common/components/Button';
import Select from 'flarum/common/components/Select';
import Mithril from 'mithril';

interface ExtensionInfo {
  id: string;
  name: string;
  extra: {
    'flarum-extension': {
      title: string;
    };
  };
}

interface Rule {
  id: number;
  ruleType: string;
  extension: string;
  action: string;
  repeatType: string;
  executeTime: string;
  settingKey: string;
  settingValue: string;
}

interface SettingTarget {
  group: string;
  type: string;
}

interface DraftRow {
  editingRuleId: number | null;
  ruleType: string;
  extension: string;
  action: string;
  repeatType: string;
  date: string;
  time: string;
  text: string;
  settingKey: string;
  settingValue: string;
}

const SELF_ID = 'mattoid-plugin-scheduler';

const TIMEZONE_OPTIONS = [
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
];

// 与后端 Mattoid\PluginScheduler\SettingsTargets 保持一致
const SETTING_TARGETS: Record<string, SettingTarget> = {
  forum_title: { group: 'basics', type: 'text' },
  forum_description: { group: 'basics', type: 'textarea' },
  welcome_title: { group: 'basics', type: 'text' },
  welcome_message: { group: 'basics', type: 'textarea' },
  logo_path: { group: 'appearance', type: 'image' },
  favicon_path: { group: 'appearance', type: 'image' },
  theme_primary_color: { group: 'appearance', type: 'color' },
  theme_secondary_color: { group: 'appearance', type: 'color' },
  theme_dark_mode: { group: 'appearance', type: 'bool' },
  theme_colored_header: { group: 'appearance', type: 'bool' },
  custom_header: { group: 'appearance', type: 'textarea' },
  custom_footer: { group: 'appearance', type: 'textarea' },
  custom_less: { group: 'appearance', type: 'textarea' },
};

function extensionTitle(ext: ExtensionInfo): string {
  return (ext.extra && ext.extra['flarum-extension'] && ext.extra['flarum-extension'].title) || ext.name || ext.id;
}

export default class SchedulerPage extends ExtensionPage {
  private rules: Rule[] = [];
  private draftRows: DraftRow[] = [];
  private saving: boolean = false;
  private loadingRules: boolean = true;
  private openDropdown: number | null = null;
  private uploadingImage: boolean = false;

  oninit(vnode: Mithril.Vnode) {
    super.oninit(vnode);
    this.loadRules();
  }

  installedExtensions(): ExtensionInfo[] {
    return Object.keys(app.data.extensions)
      .filter((id) => id !== SELF_ID)
      .map((id) => {
        const ext = app.data.extensions[id] as unknown as ExtensionInfo;
        ext.id = id;
        return ext;
      });
  }

  extensionOptions(): Record<string, string> {
    const options: Record<string, string> = {};
    this.installedExtensions().forEach((ext) => {
      options[ext.id] = extensionTitle(ext);
    });
    return options;
  }

  settingOptions(): Record<string, string> {
    const options: Record<string, string> = {};
    Object.keys(SETTING_TARGETS).forEach((key) => {
      const group = SETTING_TARGETS[key].group;
      const label = app.translator.trans(`mattoid-plugin-scheduler.admin.setting-${key}`);
      options[key] = `${app.translator.trans(`mattoid-plugin-scheduler.admin.setting-group-${group}`)} / ${label}`;
    });
    return options;
  }

  actionOptions(row: DraftRow): Record<string, string> {
    if (row.ruleType === 'setting') {
      return {
        set: app.translator.trans('mattoid-plugin-scheduler.admin.action-set'),
        reset: app.translator.trans('mattoid-plugin-scheduler.admin.action-reset'),
      };
    }
    return {
      enable: app.translator.trans('mattoid-plugin-scheduler.admin.enable'),
      disable: app.translator.trans('mattoid-plugin-scheduler.admin.disable'),
    };
  }

  loadRules() {
    this.loadingRules = true;

    app
      .request({
        method: 'GET',
        url: app.forum.attribute('apiUrl') + '/plugin-scheduler/rules',
      })
      .then((result: any) => {
        this.rules = ((result && result.data) || []).map((item: any) => ({
          id: parseInt(item.id, 10),
          ruleType: item.attributes.ruleType || 'extension',
          extension: item.attributes.extension,
          action: item.attributes.action,
          repeatType: item.attributes.repeatType,
          executeTime: item.attributes.executeTime,
          settingKey: item.attributes.settingKey || '',
          settingValue: item.attributes.settingValue || '',
        }));
      })
      .catch(() => {
        this.rules = [];
      })
      .then(() => {
        this.loadingRules = false;
        m.redraw();
      });
  }

  addRow() {
    const options = this.extensionOptions();
    const first = Object.keys(options)[0] || '';
    this.draftRows.push({
      editingRuleId: null,
      ruleType: 'extension',
      extension: first,
      action: 'enable',
      repeatType: 'once',
      date: new Date().toISOString().slice(0, 10),
      time: '08:00',
      text: '',
      settingKey: 'welcome_title',
      settingValue: '',
    });
  }

  editRule(rule: Rule) {
    // 同一规则同时只能有一条编辑草稿：先清空所有草稿
    this.draftRows = [];
    this.openDropdown = null;
    const [date, time] = (rule.executeTime || '').split(' ');
    this.draftRows.push({
      editingRuleId: rule.id,
      ruleType: rule.ruleType || 'extension',
      extension: rule.extension,
      action: rule.action,
      repeatType: rule.repeatType,
      // daily/weekly 规则的日期部分仅作占位（weekly 用原日期里的星期几，daily 保存时会被当天日期替换）
      date:
        rule.repeatType === 'daily' || rule.repeatType === 'weekly'
          ? rule.repeatType === 'daily'
            ? new Date().toISOString().slice(0, 10)
            : date || new Date().toISOString().slice(0, 10)
          : date || new Date().toISOString().slice(0, 10),
      time: time || '08:00',
      text: '',
      settingKey: rule.settingKey || 'welcome_title',
      settingValue: rule.settingValue || '',
    });
  }

  filteredExtensionOptions(row: DraftRow): [string, string][] {
    const options = this.extensionOptions();
    const keyword = (row.text || '').trim().toLowerCase();
    const entries = Object.keys(options).map((id) => [id, options[id]] as [string, string]);
    if (!keyword) {
      return entries;
    }
    return entries.filter(([id, title]) => id.toLowerCase().indexOf(keyword) !== -1 || title.toLowerCase().indexOf(keyword) !== -1);
  }

  openExtDropdown(index: number) {
    const row = this.draftRows[index];
    const options = this.extensionOptions();
    // 已选插件有效时清空过滤文本，展开即显示全部列表；
    // 无效（手输内容）时保留原文本便于继续编辑
    row.text = options[row.extension] ? '' : row.extension;
    this.openDropdown = index;
  }

  closeExtDropdown(index: number) {
    setTimeout(() => {
      if (this.openDropdown === index) {
        this.openDropdown = null;
        m.redraw();
      }
    }, 200);
  }

  saveRows() {
    this.saving = true;

    const requests = this.draftRows.map((row) => {
      const executeTime =
        row.repeatType === 'daily'
          ? new Date().toISOString().slice(0, 10) + ' ' + row.time
          : row.date + ' ' + row.time;

      return app.request({
        method: row.editingRuleId ? 'PUT' : 'POST',
        url: app.forum.attribute('apiUrl') + '/plugin-scheduler/rules' + (row.editingRuleId ? '/' + row.editingRuleId : ''),
        body: {
          data: {
            attributes:
              row.ruleType === 'setting'
                ? {
                    ruleType: row.ruleType,
                    action: row.action,
                    repeatType: row.repeatType,
                    executeTime: executeTime,
                    settingKey: row.settingKey,
                    settingValue: row.action === 'set' ? row.settingValue : '',
                  }
                : {
                    ruleType: row.ruleType,
                    extension: row.extension,
                    action: row.action,
                    repeatType: row.repeatType,
                    executeTime: executeTime,
                  },
          },
        },
      });
    });

    Promise.all(requests)
      .then(() => {
        this.draftRows = [];
      })
      .then(() => {
        this.saving = false;
        this.loadRules();
      });
  }

  timezone(): string {
    const settings = app.data.settings as Record<string, string>;
    return settings['mattoid-plugin-scheduler.timezone'] || 'Asia/Shanghai';
  }

  saveTimezone(value: string) {
    app.request({
      method: 'POST',
      url: app.forum.attribute('apiUrl') + '/settings',
      body: { 'mattoid-plugin-scheduler.timezone': value },
    });
  }

  deleteRule(id: number) {
    if (!confirm(app.translator.trans('mattoid-plugin-scheduler.admin.confirm-delete'))) return;

    app
      .request({
        method: 'DELETE',
        url: app.forum.attribute('apiUrl') + '/plugin-scheduler/rules/' + id,
      })
      .then(() => this.loadRules());
  }

  // 设置类规则的值编辑器：文本类统一用大文本框，logo/站点图标用与 core 一致的上传模式，
  // 颜色/布尔用各自的专用控件
  settingValueInput(row: DraftRow) {
    const target = SETTING_TARGETS[row.settingKey];
    const onchange = (value: string) => {
      row.settingValue = value;
    };

    if (target && target.type === 'image') {
      return this.settingImageInput(row);
    }

    if (!target || target.type === 'text' || target.type === 'textarea') {
      return (
        <textarea
          className="FormControl PluginSchedulerSettingValue"
          rows={6}
          value={row.settingValue}
          placeholder={app.translator.trans('mattoid-plugin-scheduler.admin.setting-value-placeholder')}
          oninput={(e: InputEvent) => onchange((e.target as HTMLTextAreaElement).value)}
        />
      );
    }

    if (target.type === 'color') {
      return (
        <input
          type="color"
          className="PluginSchedulerColor"
          value={/^#[0-9a-fA-F]{6}$/.test(row.settingValue) ? row.settingValue : '#4d698e'}
          oninput={(e: InputEvent) => onchange((e.target as HTMLInputElement).value)}
        />
      );
    }

    // bool
    return (
      <Select
        value={row.settingValue === '1' ? '1' : '0'}
        options={{
          '1': app.translator.trans('mattoid-plugin-scheduler.admin.bool-on'),
          '0': app.translator.trans('mattoid-plugin-scheduler.admin.bool-off'),
        }}
        onchange={onchange}
      />
    );
  }

  // logo / 站点图标：复刻 core 外观页的上传交互，但只上传存文件、把路径写进规则值，
  // 不立即改动站点当前设置（生效时机由定时规则决定）
  settingImageInput(row: DraftRow) {
    const uploading = !!this.uploadingImage;
    const url = row.settingValue ? app.forum.attribute('baseUrl') + '/assets/' + row.settingValue : '';

    const pick = () => {
      this.uploadingImage = true;
      m.redraw();

      const $input = $('<input type="file" accept="image/*">');
      $input
        .appendTo('body')
        .hide()
        .trigger('click')
        .on('change', (e) => {
          const body = new FormData();
          body.append('file', $(e.target)[0].files[0]);

          app
            .request({
              method: 'POST',
              url: app.forum.attribute('apiUrl') + '/plugin-scheduler/upload-image?key=' + row.settingKey,
              serialize: (raw: any) => raw,
              body,
            })
            .then((response: any) => {
              row.settingValue = response.path;
            })
            .catch(() => {
              alert(app.translator.trans('mattoid-plugin-scheduler.admin.image-upload-failed'));
            })
            .then(() => {
              this.uploadingImage = false;
              m.redraw();
            });
        });
    };

    return (
      <div className="PluginSchedulerImage">
        {url && <img className="PluginSchedulerImage-preview" src={url} alt="" />}
        <Button className="Button" icon="fas fa-upload" disabled={uploading} onclick={pick}>
          {uploading
            ? app.translator.trans('mattoid-plugin-scheduler.admin.image-uploading')
            : url
            ? app.translator.trans('mattoid-plugin-scheduler.admin.image-change')
            : app.translator.trans('mattoid-plugin-scheduler.admin.image-upload')}
        </Button>
        {url && (
          <Button
            className="Button Button--danger"
            onclick={() => {
              row.settingValue = '';
            }}
          >
            {app.translator.trans('mattoid-plugin-scheduler.admin.image-clear')}
          </Button>
        )}
      </div>
    );
  }

  ruleName(rule: Rule, options: Record<string, string>): string {
    if (rule.ruleType === 'setting') {
      const keyLabel = app.translator.trans(`mattoid-plugin-scheduler.admin.setting-${rule.settingKey}`);
      const actionLabel =
        rule.action === 'reset'
          ? app.translator.trans('mattoid-plugin-scheduler.admin.action-reset')
          : app.translator.trans('mattoid-plugin-scheduler.admin.action-set');
      const valuePreview = rule.action === 'set' && rule.settingValue ? ` = ${rule.settingValue.slice(0, 40)}` : '';
      return `[${keyLabel}] ${actionLabel}${valuePreview}`;
    }
    return options[rule.extension] || rule.extension;
  }

  content() {
    const options = this.extensionOptions();

    return (
      <div className="ExtensionPage-body">
        <div className="container">
          <div className="PluginSchedulerPanel">
            <div className="PluginSchedulerPanel-title">
              {app.translator.trans('mattoid-plugin-scheduler.admin.rules-title')}
            </div>

            {this.loadingRules && (
              <div className="PluginSchedulerEmpty">
                {app.translator.trans('core.admin.loading')}
              </div>
            )}

            {!this.loadingRules && this.rules.length === 0 && this.draftRows.length === 0 && (
              <div className="PluginSchedulerEmpty">
                {app.translator.trans('mattoid-plugin-scheduler.admin.no-rules')}
              </div>
            )}

            {!this.loadingRules &&
              this.rules.map((rule) => (
                <div className="PluginSchedulerRow" key={rule.id}>
                  <span className="PluginSchedulerRow-name">{this.ruleName(rule, options)}</span>
                  <span className="PluginSchedulerRow-meta">
                    {app.translator.trans(`mattoid-plugin-scheduler.admin.repeat-${rule.repeatType}`)}
                    {' / '}
                    {rule.executeTime}
                  </span>
                  <Button className="Button" onclick={() => this.editRule(rule)}>
                    {app.translator.trans('mattoid-plugin-scheduler.admin.edit')}
                  </Button>
                  <Button className="Button Button--danger" onclick={() => this.deleteRule(rule.id)}>
                    {app.translator.trans('mattoid-plugin-scheduler.admin.delete')}
                  </Button>
                </div>
              ))}

            {this.draftRows.map((row, index) => (
              <div className="PluginSchedulerRow PluginSchedulerRow--draft" key={index}>
                <Select
                  value={row.ruleType}
                  options={{
                    extension: app.translator.trans('mattoid-plugin-scheduler.admin.rule-type-extension'),
                    setting: app.translator.trans('mattoid-plugin-scheduler.admin.rule-type-setting'),
                  }}
                  onchange={(value: string) => {
                    row.ruleType = value;
                    row.action = value === 'setting' ? 'set' : 'enable';
                  }}
                />

                {row.ruleType === 'extension' && (
                  <div className="PluginSchedulerExtSelect">
                    <input
                      class="FormControl PluginSchedulerExtSearch"
                      value={this.openDropdown === index ? row.text : options[row.extension] || row.extension}
                      placeholder={app.translator.trans('mattoid-plugin-scheduler.admin.extension-search-placeholder')}
                      onclick={() => this.openExtDropdown(index)}
                      onfocus={() => this.openExtDropdown(index)}
                      oninput={(e: InputEvent) => {
                        row.text = (e.target as HTMLInputElement).value;
                        const matched = Object.keys(options).find((id) => id === row.text || options[id] === row.text);
                        row.extension = matched || row.text;
                      }}
                      onblur={() => this.closeExtDropdown(index)}
                    />
                    <Button
                      className="Button PluginSchedulerExtSelect-toggle"
                      icon="fas fa-caret-down"
                      onclick={() => {
                        if (this.openDropdown === index) {
                          this.openDropdown = null;
                        } else {
                          this.openExtDropdown(index);
                        }
                      }}
                    />
                    {this.openDropdown === index && (
                      <div className="PluginSchedulerExtSelect-menu">
                        {this.filteredExtensionOptions(row).length === 0 && (
                          <div className="PluginSchedulerExtSelect-empty">
                            {app.translator.trans('mattoid-plugin-scheduler.admin.no-extension-matched')}
                          </div>
                        )}
                        {this.filteredExtensionOptions(row).map(([id, title]) => (
                          <div
                            className="PluginSchedulerExtSelect-item"
                            onmousedown={() => {
                              row.extension = id;
                              row.text = title;
                              this.openDropdown = null;
                            }}
                          >
                            <span className="PluginSchedulerExtSelect-item-title">{title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {row.ruleType === 'setting' && (
                  <Select
                    value={row.settingKey}
                    options={this.settingOptions()}
                    onchange={(value: string) => {
                      row.settingKey = value;
                      row.settingValue = '';
                    }}
                  />
                )}

                <Select
                  value={row.action}
                  options={this.actionOptions(row)}
                  onchange={(value: string) => {
                    row.action = value;
                  }}
                />

                {row.ruleType === 'setting' && row.action === 'set' && this.settingValueInput(row)}

                <Select
                  value={row.repeatType}
                  options={{
                    once: app.translator.trans('mattoid-plugin-scheduler.admin.repeat-once'),
                    daily: app.translator.trans('mattoid-plugin-scheduler.admin.repeat-daily'),
                    weekly: app.translator.trans('mattoid-plugin-scheduler.admin.repeat-weekly'),
                    monthly: app.translator.trans('mattoid-plugin-scheduler.admin.repeat-monthly'),
                    yearly: app.translator.trans('mattoid-plugin-scheduler.admin.repeat-yearly'),
                  }}
                  onchange={(value: string) => {
                    row.repeatType = value;
                  }}
                />
                {(row.repeatType === 'once' || row.repeatType === 'monthly' || row.repeatType === 'yearly') && (
                  <input
                    type="date"
                    value={row.date}
                    onchange={(e: InputEvent) => {
                      row.date = (e.target as HTMLInputElement).value;
                    }}
                  />
                )}
                <input
                  type="time"
                  value={row.time}
                  onchange={(e: InputEvent) => {
                    row.time = (e.target as HTMLInputElement).value;
                  }}
                />
                <Button
                  className="Button Button--danger"
                  onclick={() => {
                    this.draftRows.splice(index, 1);
                  }}
                >
                  {app.translator.trans('mattoid-plugin-scheduler.admin.delete')}
                </Button>
              </div>
            ))}

            <div className="PluginSchedulerActions">
              <Button className="Button" onclick={() => this.addRow()}>
                {app.translator.trans('mattoid-plugin-scheduler.admin.add-rule')}
              </Button>
              {this.draftRows.length > 0 && (
                <Button className="Button Button--primary" disabled={this.saving} onclick={() => this.saveRows()}>
                  {app.translator.trans('mattoid-plugin-scheduler.admin.save-rules')}
                </Button>
              )}
              <div className="PluginSchedulerTimezone">
                <span className="PluginSchedulerTimezone-label">
                  {app.translator.trans('mattoid-plugin-scheduler.admin.timezone')}
                </span>
                <Select
                  value={this.timezone()}
                  options={TIMEZONE_OPTIONS.reduce((acc, tz) => ({ ...acc, [tz]: tz }), {} as Record<string, string>)}
                  onchange={(value: string) => this.saveTimezone(value)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
