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
  extension: string;
  action: string;
  repeatType: string;
  executeTime: string;
}

interface DraftRow {
  editingRuleId: number | null;
  extension: string;
  action: string;
  repeatType: string;
  date: string;
  time: string;
  text: string;
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

function extensionTitle(ext: ExtensionInfo): string {
  return (ext.extra && ext.extra['flarum-extension'] && ext.extra['flarum-extension'].title) || ext.name || ext.id;
}

export default class SchedulerPage extends ExtensionPage {
  private rules: Rule[] = [];
  private draftRows: DraftRow[] = [];
  private saving: boolean = false;
  private loadingRules: boolean = true;
  private openDropdown: number | null = null;

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
          extension: item.attributes.extension,
          action: item.attributes.action,
          repeatType: item.attributes.repeatType,
          executeTime: item.attributes.executeTime,
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
      extension: first,
      action: 'enable',
      repeatType: 'once',
      date: new Date().toISOString().slice(0, 10),
      time: '08:00',
      text: '',
    });
  }

  editRule(rule: Rule) {
    // 同一规则同时只能有一条编辑草稿：先清空所有草稿
    this.draftRows = [];
    this.openDropdown = null;
    const [date, time] = (rule.executeTime || '').split(' ');
    this.draftRows.push({
      editingRuleId: rule.id,
      extension: rule.extension,
      action: rule.action,
      repeatType: rule.repeatType,
      // daily 规则的日期部分仅作占位，保存时会被当天日期替换
      date: rule.repeatType === 'daily' ? new Date().toISOString().slice(0, 10) : date || new Date().toISOString().slice(0, 10),
      time: time || '08:00',
      text: '',
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
            attributes: {
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

  content() {
    const options = this.extensionOptions();
    const extensionName = (id: string) => options[id] || id;

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
                  <span className="PluginSchedulerRow-name">{extensionName(rule.extension)}</span>
                  <span className="PluginSchedulerRow-meta">
                    {rule.action === 'enable'
                      ? app.translator.trans('mattoid-plugin-scheduler.admin.enable')
                      : app.translator.trans('mattoid-plugin-scheduler.admin.disable')}
                    {' / '}
                    {rule.repeatType === 'daily'
                      ? app.translator.trans('mattoid-plugin-scheduler.admin.repeat-daily')
                      : app.translator.trans('mattoid-plugin-scheduler.admin.repeat-once')}
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
              <div className="PluginSchedulerRow" key={index}>
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
                <Select
                  value={row.action}
                  options={{
                    enable: app.translator.trans('mattoid-plugin-scheduler.admin.enable'),
                    disable: app.translator.trans('mattoid-plugin-scheduler.admin.disable'),
                  }}
                  onchange={(value: string) => {
                    row.action = value;
                  }}
                />
                <Select
                  value={row.repeatType}
                  options={{
                    once: app.translator.trans('mattoid-plugin-scheduler.admin.repeat-once'),
                    daily: app.translator.trans('mattoid-plugin-scheduler.admin.repeat-daily'),
                  }}
                  onchange={(value: string) => {
                    row.repeatType = value;
                  }}
                />
                {row.repeatType === 'once' && (
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
