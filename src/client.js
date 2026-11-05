const React = require('react');
const h = React.createElement;
const NS = 'dsh-sidebar';
const STORAGE_KEY = 'dsh-sidebar.preferences.v1';
const dicts = {
  zh: {
    title: '侧边栏管理', description: '调整导航项目的顺序和显示状态，立即生效并自动保存。',
    sidebar: '主侧边栏', settings: '设置侧边栏', up: '上移', down: '下移', show: '显示', hide: '隐藏',
    protected: '始终显示', reset: '恢复默认', resetGroup: '重置此列表', saved: '已自动保存',
    error: '保存失败：浏览器存储不可用。当前修改仅在本次页面有效。',
    hint: '使用 ↑ ↓ 调整顺序；开关控制显示或隐藏。新安装的导航项目会自动追加。',
    more: '更多', moreHint: '排在此项下面的菜单会收入「更多」', inMore: '位于「更多」菜单内',
    moreLockedHint: '「更多」不可隐藏；可上下移动，调整收纳范围。',
    fixed: '新会话及底部设置入口保持原位。隐藏项目不会停用插件，也不会出现在「更多」内。',
    lockHint: '本插件的设置入口和「更多」不可隐藏；将菜单移到「更多」上方可重新显示在侧边栏。',
    empty: '当前没有可调整的导航项目。', compatibility: '当前应用的导航接口不兼容，未修改原有导航。',
  },
  en: {
    title: 'Sidebar Manager', description: 'Reorder navigation entries and control their visibility. Changes apply immediately and are saved automatically.',
    sidebar: 'Main sidebar', settings: 'Settings sidebar', up: 'Move up', down: 'Move down', show: 'Show', hide: 'Hide',
    protected: 'Always visible', reset: 'Restore defaults', resetGroup: 'Reset this list', saved: 'Saved automatically',
    error: 'Could not save: browser storage is unavailable. Changes will last only for this page.',
    hint: 'Use ↑ ↓ to reorder and the switches to show or hide. Newly installed entries are appended automatically.',
    more: 'More', moreHint: 'Entries below this row go into More', inMore: 'Inside the More menu',
    moreLockedHint: 'More cannot be hidden. Move it to change which entries are folded.',
    fixed: 'New Session and the bottom Settings launcher keep their positions. Hiding an entry does not disable its plugin and excludes it from More too.',
    lockHint: 'This settings entry and More cannot be hidden. Move entries above More to put them back in the sidebar.',
    empty: 'No navigation entries are available.', compatibility: 'The application navigation API is incompatible. Original navigation was left unchanged.',
  },
};
const css = `
.dshsb-page{color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6;max-width:920px;margin:0 auto;padding:4px 0 24px}
.dshsb-page *{box-sizing:border-box}.dshsb-page h2{font-size:20px;margin:0 0 6px;font-weight:600}.dshsb-page p{margin:4px 0 12px;color:var(--dsw-alias-label-secondary)}
.dshsb-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:18px 0}.dshsb-status{font-size:12px;color:var(--dsw-alias-label-secondary)}.dshsb-error{color:var(--dsw-alias-state-error-primary)}
.dshsb-card{border:1px solid var(--dsw-alias-border-l1);border-radius:16px;overflow:hidden;margin:16px 0;background:var(--dsw-alias-bg-layer-1)}
.dshsb-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;gap:12px;background:var(--dsw-alias-bg-layer-2)}.dshsb-head h3{font-size:15px;margin:0;font-weight:600}
.dshsb-row{display:flex;gap:12px;align-items:center;padding:12px 18px;min-height:62px;border-top:1px solid var(--dsw-alias-border-l1)}.dshsb-muted .dshsb-label{color:var(--dsw-alias-label-secondary)}
.dshsb-number{width:22px;flex-shrink:0;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}.dshsb-label{flex:1;min-width:0;overflow-wrap:anywhere}.dshsb-id{display:block;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshsb-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}.dshsb-page button{font:inherit;color:inherit;cursor:pointer}.dshsb-button{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:6px 12px;min-height:32px}.dshsb-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.dshsb-page button:disabled{opacity:.4;cursor:not-allowed}.dshsb-page button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}.dshsb-arrow{padding:3px 9px}
.dshsb-switch{position:relative;width:36px;height:22px;border:0;border-radius:99px;padding:0;background:var(--dsw-alias-state-idle-primary);margin-left:10px;flex-shrink:0}.dshsb-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}.dshsb-switch span{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .12s}.dshsb-switch[aria-checked=true] span{transform:translateX(14px)}
.dshsb-lock{font-size:11px;color:var(--dsw-alias-label-secondary);margin-left:6px}.dshsb-note{font-size:12px}.dshsb-empty{padding:18px}
@media(max-width:600px){.dshsb-row{padding:10px;gap:6px}.dshsb-id{display:none}.dshsb-lock{max-width:45px;line-height:1.3}.dshsb-number{width:14px}.dshsb-head{padding:12px}.dshsb-page{padding:0}}
@media(prefers-reduced-motion:reduce){.dshsb-switch span{transition:none}}
`;
return {
  inject: ['slots', 'locale'],
  apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, dicts));
    const t = ctx.locale.bind(NS);
    let prefs = normalize(null), storageError = false;
    const listeners = new Set();
    try { prefs = normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); }
    catch { storageError = true; }
    const source = {
      getSnapshot: () => prefs,
      subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    };
    const notify = () => { for (const fn of [...listeners]) fn(); };
    function save(next) {
      prefs = normalize(next);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); storageError = false; }
      catch { storageError = true; }
      notify();
      return !storageError;
    }
    ctx.effect(() => {
      const sync = event => {
        if (event.storageArea !== localStorage || (event.key !== STORAGE_KEY && event.key !== null)) return;
        try { prefs = normalize(JSON.parse(event.newValue || 'null')); storageError = false; notify(); }
        catch { /* Ignore a malformed cross-window update. */ }
      };
      window.addEventListener('storage', sync);
      return () => window.removeEventListener('storage', sync);
    });
    // rc.5 does not provide a navigation projection/filter API. Registering
    // another parent with the same children is INVALID: declarations have one
    // owner, even when the parent registration shadows the original.
    // Use a narrow, reversible component adapter on the existing entry instead.
    // Its renderer retains the original child authorization, inject cache and
    // exact store. No second shell or child declarations are registered.
    const compatibility = [];
    const identity = value => value;
    function wrap(name, hook, group) {
      ctx.effect(() => {
        const patches = new Map();
        let enabled = true;
        function sync() {
          for (const entry of ctx.slots.entriesOfSlot(name)) {
            if (patches.has(entry)) continue;
            const Component = entry.component;
            if (typeof Component !== 'function') {
              if (!compatibility.includes(name)) compatibility.push(name);
              continue;
            }
            const hookName = 'use' + hook[0].toUpperCase() + hook.slice(1);
            function NavigationAdapter(props) {
              const state = React.useSyncExternalStore(source.subscribe, source.getSnapshot);
              const originalHook = props[hookName];
              if (!enabled || typeof originalHook !== 'function') return h(Component, {...props, key: 'dshsb-original'});
              // Consume the original hooks normally, preserving subscriptions.
              if (group === 'sidebar') {
                const usePanels = selector => {
                  const rows = originalHook(identity);
                  return selector(sidebarView(rows, state.sidebar, t('more')).panels);
                };
                const useEntryPins = selector => {
                  props.useEntryPins(identity);
                  const rows = originalHook(identity);
                  return selector(sidebarView(rows, state.sidebar, t('more')).unpinned);
                };
                const usePanelInfo = selector => props.usePanelInfo(info => selector({
                  ...info, activePanelId: viewPanelId(info.activePanelId),
                }));
                const renderSlot = (name, owner, options) => {
                  const shared = name === 'sidebar.panellist.actions'
                    ? {...owner, entries: owner.entries.filter(entry => entry.id !== MORE_ID),
                        renderPanelIcon: (id, active) => props.renderSlot('sidebar.panellist',
                          {size: 16, active: Boolean(active)}, {only: realPanelId(id)}),
                      } : owner;
                  return props.renderSlot(name, shared,
                    name === 'sidebar.panellist' && typeof options?.only === 'string'
                      ? {...options, only: realPanelId(options.only)} : options);
                };
                return h(Component, {...props, key: 'dshsb-managed', usePanels, useEntryPins, usePanelInfo, renderSlot,
                  selectPanel: id => props.selectPanel(realPanelId(id)),
                });
              }
              const useNavigation = selector => {
                const rows = originalHook(identity);
                return selector(arrange(rows, state[group]));
              };
              return h(Component, {...props, key: 'dshsb-managed', [hookName]: useNavigation});
            }
            patches.set(entry, replaceComponent(entry, NavigationAdapter));
          }
        }
        const off = ctx.slots.subscribe(name, sync);
        sync();
        return () => {
          off();
          enabled = false;
          for (const restore of patches.values()) restore();
          // An already mounted adapter may survive until its parent rerenders.
          // Make it immediately render the unmodified view on plugin disposal.
          prefs = normalize(prefs);
          notify();
          patches.clear();
        };
      });
    }
    wrap('sidebar', 'panels', 'sidebar');
    wrap('sidebar.settings', 'sections', 'settings');

    function catalog(name) {
      let version = -1, revision = -1, rows = [];
      return {
        getSnapshot() {
          const v = ctx.slots.getVersion(name), r = ctx.locale.getSnapshot().revision;
          if (v !== version || r !== revision) {
            version = v; revision = r;
            rows = ctx.slots.entriesOfSlot(name).map(entry => ({
              id: entry.options.id,
              order: entry.options.order ?? 0,
              label: (typeof entry.options.label === 'function' ? entry.options.label() : entry.options.label) || entry.options.id,
            })).filter(row => typeof row.id === 'string');
            if (name === 'sidebar.panellist') rows = withMore(rows, t('more'));
          }
          return rows;
        },
        subscribe(fn) {
          const a = ctx.slots.subscribe(name, fn), b = ctx.locale.subscribe(fn);
          return () => { a(); b(); };
        },
      };
    }
    const catalogs = {sidebar: catalog('sidebar.panellist'), settings: catalog('settings.section')};
    function Page() {
      const state = React.useSyncExternalStore(source.subscribe, source.getSnapshot);
      React.useSyncExternalStore(fn => ctx.locale.subscribe(fn), () => ctx.locale.getSnapshot());
      const all = {
        sidebar: React.useSyncExternalStore(catalogs.sidebar.subscribe, catalogs.sidebar.getSnapshot),
        settings: React.useSyncExternalStore(catalogs.settings.subscribe, catalogs.settings.getSnapshot),
      };
      return h('section', {className: 'dshsb-page'},
        h('style', null, css),
        h('h2', null, t('title')), h('p', null, t('description')),
        compatibility.length ? h('p', {role: 'alert', className: 'dshsb-error'}, t('compatibility')) : null,
        h('div', {className: 'dshsb-toolbar'},
          h('span', {role: 'status', 'aria-live': 'polite', className: 'dshsb-status' + (storageError ? ' dshsb-error' : '')}, t(storageError ? 'error' : 'saved')),
          h('button', {type: 'button', className: 'dshsb-button', onClick: () => save(normalize(null))}, t('reset'))),
        h('p', {className: 'dshsb-note'}, t('hint')),
        ...GROUPS.map(group => {
          const rows = arrange(all[group], state[group], true);
          const moreIndex = group === 'sidebar' ? rows.findIndex(row => row.id === MORE_ID) : -1;
          return h('section', {key: group, className: 'dshsb-card', 'aria-label': t(group)},
            h('div', {className: 'dshsb-head'}, h('h3', null, t(group)),
              h('button', {type: 'button', className: 'dshsb-button', onClick: () => save({...state, [group]: {order: [], hidden: []}})}, t('resetGroup'))),
            rows.length === 0 ? h('p', {className: 'dshsb-empty'}, t('empty')) : null,
            ...rows.map((row, i) => {
              const locked = isProtected(row.id), visible = locked || !state[group].hidden.includes(row.id);
              return h('div', {key: row.id, className: 'dshsb-row' + (!visible ? ' dshsb-muted' : '')},
                h('span', {className: 'dshsb-number', 'aria-hidden': true}, i + 1),
                h('div', {className: 'dshsb-label'}, row.label, h('span', {className: 'dshsb-id'},
                  row.id === MORE_ID ? t('moreHint') : visible && moreIndex >= 0 && i > moreIndex ? t('inMore') : row.id)),
                h('div', {className: 'dshsb-actions'},
                  ...[-1, 1].map(delta => h('button', {
                    key: delta, type: 'button', className: 'dshsb-button dshsb-arrow',
                    title: t(delta < 0 ? 'up' : 'down'), 'aria-label': `${t(delta < 0 ? 'up' : 'down')} ${row.label}`,
                    disabled: delta < 0 ? i === 0 : i === rows.length - 1,
                    onClick: () => save(move(prefs, group, all[group], row.id, delta)),
                  }, delta < 0 ? '↑' : '↓')),
                  h('button', {type: 'button', className: 'dshsb-switch', role: 'switch', 'aria-checked': visible,
                    'aria-label': `${t(visible ? 'hide' : 'show')} ${row.label}`, title: t(row.id === MORE_ID ? 'moreLockedHint' : locked ? 'lockHint' : visible ? 'hide' : 'show'),
                    disabled: locked, onClick: () => save(toggle(prefs, group, row.id)),
                  }, h('span', {'aria-hidden': true}))));
            }));
        }),
        h('p', {className: 'dshsb-note'}, t('lockHint')),
        h('p', {className: 'dshsb-note'}, t('fixed')));
    }
    const moreCss = `
.dshsb-more-entry{display:flex;align-items:center;justify-content:flex-start;gap:8px;box-sizing:border-box;width:100%;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);padding:8px 12px;text-align:start;font-family:inherit;font-size:14px;font-weight:400;line-height:20px;cursor:pointer;min-height:36px}
.dshsb-more-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none}.dshsb-more-check{margin-left:auto;flex:none}
.dshsb-more-entry:hover,.dshsb-more-entry:focus-visible{background:var(--dsw-alias-bg-layer-2)}.dshsb-more-entry:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.dshsb-more-entry[aria-current=page]{color:var(--dsw-alias-brand-primary)}.dshsb-more-title{overflow-wrap:anywhere;min-width:0}.dshsb-more-separator{height:1px;background:var(--dsw-alias-border-l1);margin:6px 4px}
`;
    function MoreEntries({entries, onOpen, onDismiss, renderPanelIcon}) {
      const folded = entries.filter(entry => !entry.pinned && entry.id !== MORE_ID);
      const buttons = React.useRef([]);
      return h(React.Fragment, null, h('style', null, moreCss),
        ...folded.map((entry, index) => h('button', {
          key: entry.id, type: 'button', role: 'menuitem', tabIndex: 0,
          ref: node => { buttons.current[index] = node; },
          className: 'dshsb-more-entry', 'aria-current': entry.active ? 'page' : undefined,
          onClick: () => { onDismiss(); onOpen(entry.id); },
          onKeyDown: event => {
            const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
            const next = index + delta;
            if (delta && next >= 0 && next < folded.length) {
              event.preventDefault(); event.stopPropagation(); buttons.current[next]?.focus();
            }
            // Let the shell handle Escape and navigation to its own footer rows.
          },
        }, h('span', {className: 'dshsb-more-icon', 'aria-hidden': true}, renderPanelIcon?.(entry.id, entry.active)),
          h('span', {className: 'dshsb-more-title'}, entry.label),
          entry.active ? h('span', {className: 'dshsb-more-check', 'aria-hidden': true}, '✓') : null)),
        folded.length ? h('div', {role: 'separator', className: 'dshsb-more-separator'}) : null);
    }
    ctx.slots.inject('sidebar.panellist.actions', () => ctx.slots.register({
      name: 'sidebar.panellist.actions', id: 'dsh-sidebar-folded', order: -100,
      label: () => t('more'),
    }, MoreEntries));
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section', id: OWN_ID, order: 50, label: () => t('title'),
    }, Page));
  },
};
