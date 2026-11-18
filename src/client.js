const React = require('react');
const h = React.createElement;
const {StateDot} = require('@deepseek-ai/dsh-client-ui-primitives');
const NS = 'dsh-sidebar';
const STORAGE_KEY = 'dsh-sidebar.preferences.v1';
const PANELS_KEY = 'dsh-sidebar.panels.v1';
const EMPTY_WORKSPACE_PINS = Object.freeze([]);
function readPanelState() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(PANELS_KEY) || 'null'); } catch { /* Storage may be unavailable. */ }
  return Object.fromEntries([...GROUPS, 'workspace'].map((group, index) => [group,
    typeof saved?.[group] === 'boolean' ? saved[group] : index === 0]));
}
const dicts = {
  zh: {
    title: '侧边栏管理',
    sidebar: '主侧边栏', settings: '设置侧边栏', drag: '拖拽排序', dragHint: '拖动调整顺序，也可使用上下方向键',
    error: '保存到插件配置失败，已重新读取服务器配置，请重试。',
    offline: '保存失败，无法确认服务器最新配置；当前显示最后已确认的配置。请恢复连接后刷新。',
    loading: '正在读取插件配置…', saving: '正在保存到插件配置…',
    unavailable: '插件配置尚不可用，请重启应用以加载新版服务端插件。', readonly: '当前连接无配置写入权限。',
    rename: '菜单名称', defaultName: '恢复原名', more: '更多', visible: '显示', selfProtected: '保留管理入口以便恢复隐藏的菜单',
    moreHint: '「更多」是收纳分界线：上方直接显示，下方收入更多。拖动分界线或菜单调整，重启后保留。',
    folded: '已收入更多', moreBoundary: '收纳分界线', workspaceBoundary: '工作区', workspaceBoundaryHint: '工作区分割项',
    bottomEntry: '显示在工作区下方', actionEntry: '插件动作', pinMenu: '移出更多',
    layoutHint: '「工作区」上方显示功能入口，下方显示底部菜单。「更多」收纳其后至工作区分割项之前的菜单；更多在工作区下方时，收纳其后的菜单。两个分割项均可拖动。',
    workspace: '工作区设置', pinWorkspace: '置顶工作区',
    activeIndicator: '活跃工作区标识', activeIndicatorHint: '工作区有运行中或等待交互的会话时，在右侧显示会话同款圆圈；悬停时隐藏，固定图标位于其右侧。',
    activityOngoing: '工作区有运行中的会话', activityWarning: '工作区有等待交互的会话',
    pinHint: '悬停工作区，点击右侧图钉切换置顶。置顶优先；DSH 界面保持打开且有写入权限时，顺序同步到 Host，图钉不同步。',
    pinAction: '置顶工作区', unpinAction: '取消置顶工作区', pinFailed: '工作区置顶设置保存失败，请重试。',
    collapseOneClick: '工作区一键折叠', collapseOneClickHint: '在「工作区」右侧显示一键折叠按钮；关闭后隐藏按钮，视图选项中的折叠动作也不可用。',
    collapseAll: '折叠所有工作区',
    filterWorkspaces: '筛选工作区', onlyPinned: '仅显示固定工作区', filterFailed: '工作区筛选设置保存失败，请重试。',
    dynamicSort: '动态调整工作区排序', dynamicSortHint: '仅在「按工作区」和「最近更新」时生效。DSH 界面保持打开且有写入权限时，顺序同步到 Host；关闭后不恢复旧顺序。',
    workspaceSyncFailed: '未能完成工作区顺序同步。移动端顺序可能与此处不同；请检查连接后刷新 DSH 重试。',
    empty: '当前没有可调整的导航项目。', compatibility: '部分导航接口不兼容，相关导航已保留原样。',
  },
  en: {
    title: 'Sidebar Manager',
    sidebar: 'Main sidebar', settings: 'Settings sidebar', drag: 'Drag to reorder', dragHint: 'Drag to reorder, or use the up and down arrow keys',
    error: 'Could not save plugin configuration. Server preferences were reloaded; please retry.',
    offline: 'Save failed and the latest server state could not be confirmed. Showing the last confirmed configuration; reconnect and refresh.',
    loading: 'Loading plugin configuration…', saving: 'Saving plugin configuration…',
    unavailable: 'Plugin configuration is unavailable. Restart the app to load the updated server plugin.', readonly: 'This connection cannot write configuration.',
    rename: 'Menu name', defaultName: 'Restore name', more: 'More', visible: 'Show', selfProtected: 'Keep the manager reachable to restore hidden entries',
    moreHint: 'More is the boundary: entries above stay visible; entries below go into More. Drag the boundary or entries to adjust. Saved across restarts.',
    folded: 'Inside More', moreBoundary: 'Folding boundary', workspaceBoundary: 'Workspaces', workspaceBoundaryHint: 'Workspace boundary',
    bottomEntry: 'Below workspaces', actionEntry: 'Plugin action', pinMenu: 'Move out of More',
    layoutHint: 'Entries above Workspaces appear at the top; entries below appear at the bottom. More folds the following entries up to Workspaces, or all following entries when More is below Workspaces. Drag either boundary to adjust.',
    workspace: 'Workspace settings', pinWorkspace: 'Pin workspaces',
    activeIndicator: 'Active workspace indicator', activeIndicatorHint: 'Show the session status circle on the right when sessions are running or awaiting interaction. Hidden on hover, before the pin marker.',
    activityOngoing: 'Workspace has running sessions', activityWarning: 'Workspace has sessions awaiting interaction',
    pinHint: 'Hover a workspace and click the pin to toggle it. Pins take priority. A writable, open sidebar syncs the order to the Host, not the pin icon.',
    pinAction: 'Pin workspace', unpinAction: 'Unpin workspace', pinFailed: 'Could not save workspace pinning. Please retry.',
    collapseOneClick: 'One-click workspace collapse', collapseOneClickHint: 'Show the collapse-all button beside Search; when off, the button is hidden and the view-menu action is unavailable.',
    collapseAll: 'Collapse all workspaces',
    filterWorkspaces: 'Filter workspaces', onlyPinned: 'Only show pinned workspaces', filterFailed: 'Could not save workspace filtering. Please retry.',
    dynamicSort: 'Dynamically reorder workspaces', dynamicSortHint: 'Applies in By workspace and Recently updated. A writable, open sidebar syncs the order to the Host. Turning sorting off does not restore the old order.',
    workspaceSyncFailed: 'Could not finish syncing workspace order. Mobile clients may show a different order. Check your connection, then refresh DSH to retry.',
    empty: 'No navigation entries are available.', compatibility: 'Some navigation APIs are incompatible. Affected navigation was left unchanged.',
  },
};
const css = `
.dshsb-page{color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6;max-width:920px;margin:0 auto;padding:4px 0 24px}
.dshsb-page *{box-sizing:border-box}.dshsb-page p{margin:4px 0 12px;color:var(--dsw-alias-label-secondary)}
.dshsb-status{font-size:12px;color:var(--dsw-alias-label-secondary)}.dshsb-error{color:var(--dsw-alias-state-error-primary)}
.dshsb-card{border:1px solid var(--dsw-alias-border-l1);border-radius:16px;overflow:hidden;margin:16px 0;background:var(--dsw-alias-bg-layer-1)}
.dshsb-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;gap:12px;background:var(--dsw-alias-bg-layer-2)}.dshsb-head h3{font-size:15px;margin:0;font-weight:600}
.dshsb-head h3{flex:1;min-width:0}.dshsb-disclosure{display:flex;align-items:center;gap:8px;width:100%;border:0;padding:0;background:transparent;text-align:start;font-weight:600!important;min-height:32px}.dshsb-disclosure:focus-visible{outline-offset:4px!important}.dshsb-chevron{display:inline-block;flex:none;font-size:12px;transform:rotate(0deg)}.dshsb-disclosure[aria-expanded=true] .dshsb-chevron{transform:rotate(90deg)}.dshsb-panel[hidden]{display:none}
.dshsb-row{position:relative;display:flex;gap:12px;align-items:center;padding:12px 18px;min-height:62px;border-top:1px solid var(--dsw-alias-border-l1)}
.dshsb-row[data-dshsb-boundary=true]{background:var(--dsw-alias-bg-layer-2)}
.dshsb-page .dshsb-grip{display:flex;align-items:center;justify-content:center;align-self:stretch;flex:none;width:32px;min-height:36px;border:0;border-radius:6px;padding:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:grab;touch-action:none;user-select:none}.dshsb-grip:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.dshsb-page .dshsb-grip:active:not(:disabled){cursor:grabbing}.dshsb-grip svg{pointer-events:none}.dshsb-row[data-dragging=true]{opacity:.5}.dshsb-row[data-drop=before]::before,.dshsb-row[data-drop=after]::after{content:'';position:absolute;left:12px;right:12px;height:2px;z-index:1;background:var(--dsw-alias-brand-primary);pointer-events:none}.dshsb-row[data-drop=before]::before{top:0}.dshsb-row[data-drop=after]::after{bottom:0}
.dshsb-label{flex:1;min-width:0;overflow-wrap:anywhere}.dshsb-visibility{display:inline-flex;align-items:center;gap:6px;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}.dshsb-visibility input{width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-brand-primary)}.dshsb-visibility:has(input:disabled){cursor:not-allowed;opacity:.5}.dshsb-id,.dshsb-fold-state{display:block;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dshsb-icon{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;flex:none;color:var(--dsw-alias-label-secondary)}
.dshsb-name{display:flex;align-items:center;gap:6px;min-width:0}.dshsb-page .dshsb-name-input,.dshsb-page .dshsb-name-input:hover,.dshsb-page .dshsb-name-input:focus{field-sizing:content;flex:0 1 auto;min-width:2ch;max-width:100%;width:auto;font:inherit;color:inherit;line-height:inherit;background:transparent!important;border:0!important;border-radius:0;outline:none!important;box-shadow:none!important;padding:2px 0;margin:0}.dshsb-page .dshsb-name-input:focus-visible{text-decoration:underline dotted var(--dsw-alias-label-tertiary);text-underline-offset:3px}.dshsb-page .dshsb-name-reset{display:inline-flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;min-height:0;padding:0;border:0;background:transparent;border-radius:4px;color:var(--dsw-alias-label-secondary)}.dshsb-page .dshsb-name-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.dshsb-page button{font:inherit;color:inherit;cursor:pointer}.dshsb-button{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:6px 12px;min-height:32px}.dshsb-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.dshsb-page button:disabled{opacity:.4;cursor:not-allowed}.dshsb-page button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
.dshsb-setting-copy{flex:1;min-width:0}.dshsb-setting-hint{display:block;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);margin-top:4px}.dshsb-page .dshsb-switch{position:relative;flex:none;width:36px;height:22px;border:0;border-radius:99px;padding:0;background:var(--dsw-alias-state-idle-primary)}.dshsb-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}.dshsb-switch span{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base)}.dshsb-switch[aria-checked=true] span{transform:translateX(14px)}
.dshsb-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}.dshsb-empty{padding:18px}
@media(max-width:600px){.dshsb-row{padding:10px;gap:6px}.dshsb-id{display:none}.dshsb-head{padding:12px}.dshsb-page{padding:0}}
`;
return {
  inject: ['slots', 'locale', 'configForms', 'contextMenus'],
  apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, dicts));
    const t = ctx.locale.bind(NS);
    // LocaleRuntime methods read instance fields (`this.snapshot/listeners`).
    // React invokes external-store callbacks unbound; preserve their receiver.
    const subscribeLocale = listener => ctx.locale.subscribe(listener);
    const getLocaleSnapshot = () => ctx.locale.getSnapshot();
    const source = createPreferencesController(ctx.configForms.get(OWN_ID), {
      read: () => JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'),
      clear: () => localStorage.removeItem(STORAGE_KEY),
      recover: async () => {
        const mirror = ctx.configForms.describe();
        await mirror.load();
        const view = mirror.getSnapshot();
        return view.status === 'ready' && !view.error;
      },
    });
    const save = next => source.save(next);
    let live = true;
    ctx.effect(() => () => { live = false; source.dispose(); });
    // Only the sync feature depends on this Client service. Keep the sidebar
    // usable before the provider starts and in profiles without the provider.
    let workspaceService;
    ctx.inject(['workspaces'], scoped => {
      const service = scoped.workspaces;
      scoped.effect(() => {
        workspaceService = service;
        source.refresh();
        return () => {
          if (workspaceService !== service) return;
          workspaceService = undefined;
          source.refresh();
        };
      });
    });
    async function toggleWorkspacePin(workspaceId) {
      const current = source.getSnapshot();
      const workspace = current.preferences.workspace || {};
      if (!live || !current.writable || workspace.pinning === false) return;
      const ids = workspace.pinnedWorkspaceIds || [];
      const pinnedWorkspaceIds = ids.includes(workspaceId) ? ids.filter(id => id !== workspaceId) : [...ids, workspaceId];
      const accepted = await save({...current.preferences, workspace: {...workspace, pinnedWorkspaceIds}});
      if (!accepted && live) ctx.contextMenus.notify(t('pinFailed'), false);
    }
    // Native IDs, icon factories, navigation and child declarations stay owned
    // by DSH. Only the navigation's display grouping uses persisted preferences.
    function SidebarWithMore({component: Component, preference, ...props}) {
      let panels = [];
      const usePanels = selector => props.usePanels(rows => { panels = rows; return selector(rows); });
      const activePanelId = props.usePanelInfo(info => info.activePanelId);
      // Still invoke the native hook at each call site, but do not let its
      // volatile pin store disagree with the persistent ordering boundary.
      const useEntryPins = selector => { props.useEntryPins(identity); return selector([]); };
      // Keep the root's authorized child renderer: actions are never cloned into
      // panel registrations, and retain their own state, permissions and handlers.
      const actionRows = React.useSyncExternalStore(footerCatalog.subscribe, footerCatalog.getSnapshot);
      let footerOwner;
      const renderSlot = (name, owner, ...args) => {
        const original = props.renderSlot(name, owner, ...args);
        if (name !== 'sidebar.footer.action') return original;
        footerOwner = owner;
        return h('div', {'data-dshsb-footer-seat': true, style: {width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column'}}, original);
      };
      const tree = Component({...props, usePanels, useEntryPins, renderSlot});
      const menuRow = (content, row, owner) => h('div', {key: row.id, style: {display: 'flex', alignItems: 'center'}},
        h('div', {style: {flex: 1, minWidth: 0}}, content),
        h('button', {type: 'button', role: 'menuitem', className: 'dshsb-more-pin',
          title: t('pinMenu'), 'aria-label': `${t('pinMenu')} ${row.label}`,
          onClick: () => { owner.onPinnedChange(row.id, true); owner.onDismiss(); }},
          h('svg', {width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': 1, 'aria-hidden': true},
            h('path', {d: 'm9 2 5 5-3 1-3 3-1-2-4 4 4-4-2-1 3-3Z'}))));
      const renderFooter = (row, menuOwner) => h(React.Fragment, {key: row.id},
        props.renderSlot('sidebar.footer.action', menuOwner
          ? {wide: true, dshsbMenuWrap: tree => menuRow(projectMenuTrigger(React, tree), row, menuOwner)} : footerOwner || {wide: true}, {only: row.actionId}));
      return projectSidebarTree(React, tree, [...panels, ...actionRows], preference, activePanelId, (id, pinned) => {
        const current = source.getSnapshot();
        if (!current.writable) { ctx.contextMenus.notify(t('readonly'), false); return; }
        return save(reorder(current.preferences, 'sidebar', catalogs.sidebar.getSnapshot(), id, MORE_ID, !pinned))
          .then(accepted => { if (!accepted && live) ctx.contextMenus.notify(t('error'), false); });
      }, {
        renderFooter,
        renderMore: (nativeRender, name, owner, args, folded) => {
          if (name !== 'sidebar.panellist.actions') return nativeRender(name, owner, ...args);
          if (!folded.some(row => row.kind === 'footer')) {
            return h('div', {className: 'dshsb-more-content'}, h('style', null, MORE_MENU_CSS),
              h('div', {className: 'dshsb-more-native'}, nativeRender(name, owner, ...args)));
          }
          // Render the mixed folded sequence once; the native action contribution
          // still owns browsing/creation, but receives no duplicate folded panels.
          return h('div', {className: 'dshsb-more-content'},
            h('style', null, MORE_MENU_CSS),
            ...folded.map(row => row.kind === 'footer' ? renderFooter(row, owner)
              : menuRow(h('button', {type: 'button', role: 'menuitem', className: 'dshsb-more-item',
                'aria-current': row.id === activePanelId ? 'page' : undefined,
                onClick: () => { owner.onOpen(row.id); owner.onDismiss(); }},
                props.renderFactorySlot('sidebar.panel.icon', {id: row.id, size: 16, active: row.id === activePanelId}), row.label), row, owner)),
            h('div', {className: 'dshsb-more-native'}, nativeRender(name, {...owner, entries: owner.entries.filter(row => row.pinned)}, ...args)));
        },
      });
    }
    const compatibility = [];
    const identity = value => value;
    function wrap(name, hookName, group) {
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
            function NavigationAdapter(props) {
              const {preferences: state} = React.useSyncExternalStore(source.subscribe, source.getSnapshot);
              const originalHook = props[hookName];
              if (!enabled) return h(Component, {...props, key: 'dshsb-original'});
              if (typeof originalHook !== 'function') {
                if (!compatibility.includes(name)) compatibility.push(name);
                return h(Component, {...props, key: 'dshsb-original'});
              }
              const useNavigation = selector => selector(navigationRows(originalHook(identity), state[group]));
              if (group === 'sidebar' && [props.useEntryPins, props.usePanelInfo].every(fn => typeof fn === 'function')) {
                return h(SidebarWithMore, {...props, key: 'dshsb-managed', component: Component,
                  preference: state.sidebar, [hookName]: useNavigation});
              }
              if (group === 'settings' && typeof props.renderSlot === 'function') {
                // Only the settings shell owns settings.section.icon. Borrow its
                // authorized renderer instead of redeclaring or invoking icons.
                // The shell builds its nav before the active page, supplying the
                // native fallback for every section (including built-in icons).
                const fallbacks = new Map();
                const renderSettingsIcon = (id, size) => props.renderSlot('settings.section.icon',
                  {size, active: false}, {only: id, fallback: fallbacks.get(id)});
                const renderSlot = (name, owner, options) => {
                  if (name === 'settings.section.icon') fallbacks.set(options?.only, options?.fallback);
                  return props.renderSlot(name,
                    name === 'settings.section' && options?.only === OWN_ID
                      ? {...owner, renderSettingsIcon} : owner, options);
                };
                return h(Component, {...props, key: 'dshsb-managed', [hookName]: useNavigation, renderSlot});
              }
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
          source.refresh();
          patches.clear();
        };
      });
    }
    wrap('sidebar', 'usePanels', 'sidebar');
    wrap('sidebar.settings', 'useSections', 'settings');

    ctx.effect(() => {
      const patches = new Map();
      let enabled = true;
      const sync = () => {
        for (const entry of ctx.slots.entriesOfSlot('sidebar.workspaces')) {
          if (patches.has(entry)) continue;
          const Component = entry.component;
          if (typeof Component !== 'function') { compatibility.push('sidebar.workspaces'); continue; }
          function WorkspaceAdapter(props) {
            const {preferences} = React.useSyncExternalStore(source.subscribe, source.getSnapshot);
            // The original Browser owns these same hooks, store, actions and child
            // declarations. Subscribe normally; change only the rendered items order.
            if (![props.useWorkspaces, props.useSessions, props.useStore].every(fn => typeof fn === 'function')) {
              if (!compatibility.includes('sidebar.workspaces')) compatibility.push('sidebar.workspaces');
              return h(Component, props);
            }
            return h(WorkspaceProjection, {...props, component: Component,
              active: enabled && preferences.workspace?.dynamicSort !== false,
              onlyPinned: enabled && preferences.workspace?.onlyPinned === true,
              pinning: enabled && preferences.workspace?.pinning !== false,
              activeIndicator: enabled && preferences.workspace?.activeIndicator !== false,
              collapseOneClick: enabled && preferences.workspace?.collapseOneClick !== false,
              pinnedWorkspaceIds: preferences.workspace?.pinnedWorkspaceIds || EMPTY_WORKSPACE_PINS});
          }
          patches.set(entry, replaceComponent(entry, WorkspaceAdapter));
        }
      };
      const off = ctx.slots.subscribe('sidebar.workspaces', sync);
      sync();
      return () => { off(); enabled = false; for (const restore of patches.values()) restore(); source.refresh(); };
    });
    // Native chevron geometry at the regular 1px stroke; two inward chevrons
    // express "collapse all" without the heavier custom glyph used before.
    function collapseAllIcon() {
      return h('svg', {width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
        'stroke-width': 1, 'aria-hidden': true, focusable: false},
        h('path', {d: 'M4 3.5L7.29289 6.79289C7.68342 7.18342 8.31658 7.18342 8.70711 6.79289L12 3.5'}),
        h('path', {d: 'M4 12.5L7.29289 9.20711C7.68342 8.81658 8.31658 8.81658 8.70711 9.20711L12 12.5'}));
    }
    // The installed Browser has no view-menu contribution slot. Adapt only its
    // identifiable ViewOptionsMenu element, retaining the native Menu and actions.
    function FilterMenu({component: Component, collapseAllAvailable, onCollapseAllWorkspaces, ...props}) {
      const {preferences, writable} = React.useSyncExternalStore(source.subscribe, source.getSnapshot);
      React.useSyncExternalStore(subscribeLocale, getLocaleSnapshot);
      const menu = Component(props);
      if (!Array.isArray(menu?.props?.items) || !menu.props.items.some(item => item.id === 'only-archived')) return menu;
      const id = 'dshsb-only-pinned';
      const collapseId = 'dshsb-collapse-workspaces';
      return React.cloneElement(menu, {
        items: [...menu.props.items,
          {type: 'separator', id: 'dshsb-workspace-filter-separator'},
          {type: 'label', id: 'dshsb-workspace-filter', text: t('filterWorkspaces')},
          {id, label: t('onlyPinned'), icon: h('svg', {width: 16, height: 16, viewBox: '0 0 16 16',
            fill: 'none', stroke: 'currentColor', 'stroke-width': 1, 'aria-hidden': true, focusable: false},
            h('path', {d: WORKSPACE_PIN_PATHS[0], 'stroke-linejoin': 'round'}),
            h('path', {d: WORKSPACE_PIN_PATHS[1], fill: 'currentColor'})),
            disabled: !writable || props.groupBy !== 'workspace'},
          {type: 'separator', id: 'dshsb-collapse-separator'},
          {id: collapseId, label: t('collapseAll'), icon: collapseAllIcon(),
            disabled: !collapseAllAvailable || typeof onCollapseAllWorkspaces !== 'function'}],
        selectedIds: [...(menu.props.selectedIds || []), ...(preferences.workspace?.onlyPinned ? [id] : [])],
        onSelect: selected => {
          if (selected === collapseId) {
            // Collapsing is a local viewing action, like the native group rows;
            // close first and then write every Workspace's explicit state.
            menu.props.onClose?.();
            if (collapseAllAvailable) onCollapseAllWorkspaces();
            return;
          }
          if (selected !== id) return menu.props.onSelect(selected);
          // Close like the native items; the preferences controller applies the
          // optimistic value immediately, so the list updates without waiting.
          menu.props.onClose?.();
          if (!writable || props.groupBy !== 'workspace') return;
          const current = source.getSnapshot().preferences;
          void save({...current, workspace: {...current.workspace, onlyPinned: current.workspace?.onlyPinned !== true}})
            .then(accepted => { if (!accepted && live) ctx.contextMenus.notify(t('filterFailed'), false); });
        },
      });
    }
    function BrowserWithFilter({component: Component, fullWorkspaces, collapseAllAvailable,
      onCollapseAllWorkspaces, ...props}) {
      function adapt(node) {
        if (Array.isArray(node)) return node.map(adapt);
        if (!React.isValidElement(node)) return node;
        if (typeof node.type === 'function' && typeof node.props.onArchivedFilterPick === 'function' &&
            typeof node.props.onGroupPick === 'function') {
          return h(FilterMenu, {...node.props, component: node.type, key: node.key, collapseAllAvailable,
            onCollapseAllWorkspaces});
        }
        // The native action cluster has room for only its own two buttons, so
        // this control is a direct header child placed immediately before the
        // search slot: the fourth icon, leftmost in the right-side group.
        if (props.wide !== false && collapseAllAvailable && typeof onCollapseAllWorkspaces === 'function' &&
            node.props['data-sidebar-workspace-header'] !== undefined) {
          const children = node.props.children === undefined ? []
            : Array.isArray(node.props.children) ? node.props.children : [node.props.children];
          const label = t('collapseAll');
          const adapted = children.map(child => adapt(child));
          adapted.splice(Math.min(1, adapted.length), 0, h(React.Fragment, {key: 'dshsb-collapse-all-control'},
            h('style', null, WORKSPACE_COLLAPSE_ALL_CSS),
            h('button', {type: 'button', className: 'dshsb-collapse-all', title: label, 'aria-label': label,
              onClick: onCollapseAllWorkspaces},
              collapseAllIcon())));
          return React.cloneElement(node, {}, adapted);
        }
        // Rename validates duplicates against the full registry, so the dialog
        // must keep every Workspace even while the sidebar hides some.
        if (Array.isArray(fullWorkspaces) && Array.isArray(node.props.workspaces) &&
            typeof node.props.renameWorkspace === 'function' &&
            typeof node.props.settleWorkspaceAction === 'function') {
          return React.cloneElement(node, {workspaces: fullWorkspaces});
        }
        return node.props.children === undefined ? node : React.cloneElement(node, {}, adapt(node.props.children));
      }
      return adapt(Component(props));
    }
    function WorkspaceProjection({component: Component, active, pinning, onlyPinned, activeIndicator, collapseOneClick,
      pinnedWorkspaceIds, ...props}) {
      const snapshot = props.useWorkspaces(identity);
      const byId = props.useSessions(state => state.byId);
      // Never subscribe the ordering projection to the whole viewing store:
      // the native Browser reconciles account/expansion state in an effect
      // whenever items change. Including that store snapshot here creates
      // items -> reconciliation -> view -> new items -> reconciliation forever.
      const groupBy = props.useStore(state => state.groupBy);
      const orderBy = props.useStore(state => state.orderBy);
      const archivedFilter = props.useStore(state => state.archivedFilter ?? 'default');
      const projected = React.useMemo(() => orderRecentWorkspaces(snapshot, {byId},
        {groupBy, orderBy}, active, {pinning, pinnedWorkspaceIds, onlyPinned}),
        [snapshot, byId, groupBy, orderBy, active, pinning, pinnedWorkspaceIds, onlyPinned]);
      const filtering = onlyPinned && groupBy === 'workspace';
      const sessionSnapshot = props.useSessions(identity);
      const {writable, status: preferencesStatus} = React.useSyncExternalStore(source.subscribe, source.getSnapshot);
      const workspaces = workspaceService;
      const canSync = typeof workspaces?.insertBefore === 'function' && typeof workspaces?.list?.getSnapshot === 'function';
      const writer = React.useRef(null);
      const readMove = React.useRef(null);
      const syncKey = React.useMemo(() => canSync && writable && ['saved', 'error'].includes(preferencesStatus)
        ? workspaceHostOrder(snapshot, sessionSnapshot, {groupBy, orderBy}, active,
          {pinning, pinnedWorkspaceIds})?.key ?? null : null,
      [canSync, writable, preferencesStatus, snapshot, sessionSnapshot, groupBy, orderBy, active, pinning, pinnedWorkspaceIds]);
      React.useEffect(() => {
        if (!canSync) return;
        let lastError = -Infinity;
        const sync = createWorkspaceOrderSync({
          readMove: key => readMove.current?.(key),
          move: (id, before) => workspaces.insertBefore(id, before),
          onError: () => {
            if (live && Date.now() - lastError >= 30_000) {
              lastError = Date.now();
              ctx.contextMenus.notify(t('workspaceSyncFailed'), false);
            }
          },
        });
        writer.current = sync;
        return () => { sync.dispose(); writer.current = null; };
      }, [workspaces, canSync]);
      React.useEffect(() => {
        readMove.current = syncKey === null ? null : key => {
          const confirmed = source.getSnapshot();
          if (!live || !['saved', 'error'].includes(confirmed.status) || !confirmed.writable) return null;
          const prefs = confirmed.preferences.workspace;
          const current = workspaces.list.getSnapshot();
          const plan = workspaceHostOrder(current, sessionSnapshot, {groupBy, orderBy},
            active && prefs?.dynamicSort !== false, {pinning: pinning && prefs?.pinning !== false,
              pinnedWorkspaceIds: prefs?.pinnedWorkspaceIds || EMPTY_WORKSPACE_PINS});
          return plan?.key === key ? nextWorkspaceMove(current.items, plan.ids) : null;
        };
        writer.current?.update(syncKey);
      }, [workspaces, syncKey, sessionSnapshot, groupBy, orderBy, active, pinning, pinnedWorkspaceIds]);
      const statuses = typeof props.useSessionStatus === 'function' ? props.useSessionStatus(identity) : null;
      const activityByWorkspace = React.useMemo(() => new Map(activeIndicator ? snapshot.items.map(workspace =>
        [workspace.workspaceId, workspaceActivity(workspace, sessionSnapshot, statuses, snapshot.archivedSessionIds, archivedFilter)]) : []),
        [activeIndicator, snapshot, sessionSnapshot, statuses, archivedFilter]);
      const visibleSessions = React.useMemo(() => filterWorkspaceSessions(sessionSnapshot, projected, filtering),
        [sessionSnapshot, projected, filtering]);
      // Keep the native hook invocation at every Browser call site even while
      // filtering, so toggling the filter never changes its React hook count.
      const useSessions = filtering ? selector => {
        props.useSessions(identity);
        return selector(visibleSessions);
      } : props.useSessions;
      const menuTarget = React.useSyncExternalStore(ctx.contextMenus.active.subscribe, ctx.contextMenus.active.getSnapshot);
      React.useSyncExternalStore(subscribeLocale, getLocaleSnapshot);
      const openWorkspaceId = menuTarget?.kind === 'workspace' ? menuTarget.value.workspaceId : null;
      const useWorkspaces = selector => selector(projected);
      // The native Browser prunes expansion and manual Session orders for every
      // Workspace absent from its list. A display filter must not discard those,
      // so the retention call keeps every Workspace, including hidden ones.
      const retainedWorkspaceIds = React.useRef(EMPTY_WORKSPACE_PINS);
      retainedWorkspaceIds.current = snapshot.items.map(workspace => workspace.workspaceId);
      const actionSource = props.actions;
      const actions = React.useMemo(() => typeof actionSource?.retainAccountKeys === 'function'
        ? {...actionSource, retainAccountKeys: keys => actionSource.retainAccountKeys(
          [...new Set([...keys, ...retainedWorkspaceIds.current])])}
        : actionSource, [actionSource]);
      const collapseAvailable = typeof actionSource?.setGroupExpanded === 'function';
      const workspaceIds = React.useMemo(() => snapshot.items.map(workspace => workspace.workspaceId)
        .filter(id => typeof id === 'string' && id), [snapshot]);
      const collapseAllWorkspaces = () => {
        if (!collapseAvailable) return;
        // Collapse only; expanding stays with the native Workspace rows. The
        // action is intentionally repeatable and never disables itself.
        for (const id of workspaceIds) actionSource.setGroupExpanded(id, false);
      };
      const renderFactorySlot = (name, owner, ...args) => {
        const original = props.renderFactorySlot(name, owner, ...args);
        const id = owner?.target?.kind === 'workspace' ? owner.target.value.workspaceId : null;
        if (name !== 'contextMenu.button' || typeof id !== 'string') return original;
        const activity = activityByWorkspace.get(id);
        const marker = activity ? h(React.Fragment, null,
          h('style', null, workspaceActivityCss(id, openWorkspaceId === id)),
          h('span', {className: 'dshsb-workspace-activity', role: 'img',
            'aria-label': t(activity === 'warning' ? 'activityWarning' : 'activityOngoing')}, h(StateDot, {state: activity}))) : null;
        if (!pinning) return marker ? h(React.Fragment, null, marker, original) : original;
        const pinned = pinnedWorkspaceIds.includes(id);
        const label = t(pinned ? 'unpinAction' : 'pinAction');
        // Keep the native ellipsis and New Session controls. CSS places this
        // action after both original controls in the native flex action strip.
        return h(React.Fragment, null,
          h('style', null, workspacePinMarkerCss(id, openWorkspaceId === id, pinned)), ...(marker ? [marker] : []), original,
          h('button', {type: 'button', className: `${owner.className || ''} dshsb-workspace-pin-action`.trim(),
            'aria-label': label, title: label, 'aria-pressed': pinned, disabled: !writable,
            draggable: false, onPointerDown: event => event.stopPropagation(),
            onDragStart: event => { event.preventDefault(); event.stopPropagation(); },
            onClick: event => { event.stopPropagation(); return toggleWorkspacePin(id); }},
            h('span', {className: 'dshsb-workspace-pin-glyph', 'aria-hidden': true})));
      };
      return h(BrowserWithFilter, {...props, component: Component, actions, useWorkspaces, useSessions, renderFactorySlot,
        fullWorkspaces: filtering ? snapshot.items : null,
        collapseAllAvailable: collapseOneClick && collapseAvailable && workspaceIds.length > 0 && groupBy !== 'flat',
        onCollapseAllWorkspaces: collapseAllWorkspaces});
    }

    // Action labels are owned by their component, unlike panel labels. Adapt
    // only exact matching label props/text, and restore on unload.
    ctx.effect(() => {
      const patches = new Map();
      let enabled = true;
      const sync = () => {
        for (const entry of ctx.slots.entriesOfSlot('sidebar.footer.action')) {
          if (patches.has(entry) || typeof entry.options.id !== 'string' || typeof entry.component !== 'function') continue;
          const Component = entry.component;
          function ActionAdapter({dshsbMenuWrap, ...props}) {
            const {preferences} = React.useSyncExternalStore(source.subscribe, source.getSnapshot);
            React.useSyncExternalStore(subscribeLocale, getLocaleSnapshot);
            const original = typeof entry.options.label === 'function' ? entry.options.label() : entry.options.label;
            const label = preferences.sidebar.names?.[footerId(entry.options.id)] || original;
            // Some actions register props => <FooterButton {...props}/> rather
            // than returning the button itself. Resolve those boundaries during
            // React rendering before renaming, styling or manufacturing a pin.
            return projectActionOutput(React, Component(props), output => {
              const tree = projectActionLabel(React, output, original, enabled ? label : original);
              return enabled && typeof dshsbMenuWrap === 'function' ? dshsbMenuWrap(tree) : tree;
            });
          }
          patches.set(entry, replaceComponent(entry, ActionAdapter));
        }
      };
      const off = ctx.slots.subscribe('sidebar.footer.action', sync);
      sync();
      return () => { off(); enabled = false; for (const restore of patches.values()) restore(); };
    });

    function catalog(name) {
      let version = -1, revision = -1, rows = [];
      return {
        getSnapshot() {
          const v = ctx.slots.getVersion(name), r = ctx.locale.getSnapshot().revision;
          if (v !== version || r !== revision) {
            version = v; revision = r;
            rows = ctx.slots.entriesOfSlot(name).map(entry => {
              const label = typeof entry.options.label === 'function' ? entry.options.label() : entry.options.label;
              return {id: entry.options.id, order: entry.options.order ?? 0,
                label: typeof label === 'string' && label.trim() ? label : entry.options.id};
            }).filter(row => typeof row.id === 'string');
            if (name === 'sidebar.footer.action') rows = rows.map(row => ({...row, actionId: row.id, id: footerId(row.id), kind: 'footer'}));
          }
          return rows;
        },
        subscribe(fn) {
          const off = ctx.slots.subscribe(name, fn), offLocale = ctx.locale.subscribe(fn);
          return () => { off(); offLocale(); };
        },
      };
    }
    const panelCatalog = catalog('sidebar.panellist'), footerCatalog = catalog('sidebar.footer.action');
    let lastPanels, lastActions, sidebarSnapshot;
    const sidebarCatalog = {
      getSnapshot() {
        const panels = panelCatalog.getSnapshot(), actions = footerCatalog.getSnapshot();
        if (lastPanels !== panels || lastActions !== actions) {
          lastPanels = panels; lastActions = actions;
          sidebarSnapshot = sidebarRows([...panels, ...actions], t('more'), t('workspaceBoundary'));
        }
        return sidebarSnapshot;
      },
      subscribe(fn) {
        const offPanels = panelCatalog.subscribe(fn), offActions = footerCatalog.subscribe(fn);
        return () => { offPanels(); offActions(); };
      },
    };
    const catalogs = {sidebar: sidebarCatalog, settings: catalog('settings.section')};
    function VisibilityField({group, row, writable, preference}) {
      if (isBoundary(row.id)) return null;
      const protectedEntry = row.id === OWN_ID;
      const checked = protectedEntry || !preference.hidden?.includes(row.id);
      return h('label', {className: 'dshsb-visibility', title: protectedEntry ? t('selfProtected') : undefined},
        h('input', {type: 'checkbox', checked, disabled: !writable || protectedEntry,
          'aria-label': `${t('visible')} ${row.label}`,
          onChange: event => {
            if (!source.getSnapshot().writable || protectedEntry) return;
            void save(setVisible(source.getSnapshot().preferences, group, row.id, event.target.checked));
          }}), t('visible'));
    }
    function NameField({group, row, name, writable}) {
      const [draft, setDraft] = React.useState(name);
      const draftVersion = React.useRef(0);
      React.useEffect(() => setDraft(name), [name]);
      const commit = async value => {
        const ticket = ++draftVersion.current;
        setDraft(value.trim() || row.label);
        if (value.trim() === name) return;
        const accepted = await save(rename(source.getSnapshot().preferences, group, row.id, value === row.label ? '' : value));
        if (!accepted && ticket === draftVersion.current) {
          setDraft(menuLabel(row, source.getSnapshot().preferences[group]));
        }
      };
      return h('div', {className: 'dshsb-name'},
        h('input', {className: 'dshsb-name-input', value: draft, maxLength: 80, disabled: !writable, spellCheck: false,
          'aria-label': `${t('rename')} ${row.label}`, placeholder: row.label,
          onChange: event => { draftVersion.current += 1; setDraft(event.target.value); },
          onBlur: event => commit(event.target.value),
          onKeyDown: event => {
            if (event.key === 'Enter' && !event.nativeEvent?.isComposing) { event.preventDefault(); event.currentTarget.blur(); }
            if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.value = name; setDraft(name); event.currentTarget.blur(); }
          },
        }),
        name !== row.label ? h('button', {type: 'button', className: 'dshsb-name-reset', disabled: !writable,
          title: t('defaultName'), 'aria-label': `${t('defaultName')} ${row.label}`,
          onClick: () => save(rename(source.getSnapshot().preferences, group, row.id, ''))},
          h('svg', {width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.25,
            'aria-hidden': true, focusable: false}, h('path', {d: 'M3 6a5 5 0 1 1 0 4M3 2v4h4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'}))) : null);
    }
    function Page({renderFactorySlot, renderSettingsIcon}) {
      const [expanded, setExpanded] = React.useState(readPanelState);
      const panelId = React.useId();
      const root = React.useRef(null), dragging = React.useRef(null);
      const [dragView, setDragView] = React.useState(null);
      function releaseDrag() {
        const drag = dragging.current;
        dragging.current = null;
        if (drag) {
          drag.handle.ownerDocument.removeEventListener('keydown', drag.escape, true);
          drag.handle.ownerDocument.defaultView.cancelAnimationFrame(drag.frame);
          if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
        }
        return drag;
      }
      React.useEffect(() => () => { releaseDrag(); }, []);
      function updateTarget(drag) {
        const hit = drag.handle.ownerDocument.elementFromPoint(drag.x, drag.y)?.closest('[data-dshsb-row]');
        const valid = hit && root.current?.contains(hit) && hit.dataset.dshsbGroup === drag.group;
        const targetId = valid ? hit.dataset.dshsbRow : null;
        const bounds = valid ? hit.getBoundingClientRect() : null;
        const after = Boolean(bounds && drag.y >= bounds.top + bounds.height / 2);
        if (drag.targetId === targetId && drag.after === after && drag.shown) return;
        Object.assign(drag, {targetId, after, shown: true});
        setDragView({group: drag.group, id: drag.id, targetId, after});
      }
      function dragFrame(drag) {
        if (dragging.current !== drag) return;
        // Scroll the settings content while a held handle approaches its edge.
        const view = drag.handle.ownerDocument.defaultView;
        for (let node = root.current?.parentElement; node; node = node.parentElement) {
          if (node.scrollHeight <= node.clientHeight || !/(auto|scroll|overlay)/.test(view.getComputedStyle(node).overflowY)) continue;
          const box = node.getBoundingClientRect();
          const edge = Math.min(32, box.height / 4);
          if (drag.x >= box.left && drag.x <= box.right && drag.y >= box.top && drag.y <= box.bottom) {
            const delta = drag.y < box.top + edge ? -12 : drag.y > box.bottom - edge ? 12 : 0;
            if (delta) node.scrollBy(0, delta);
          }
          break;
        }
        updateTarget(drag);
        drag.frame = view.requestAnimationFrame(() => dragFrame(drag));
      }
      function beginDrag(event, group, id) {
        if (!source.getSnapshot().writable || event.button !== 0 || dragging.current) return;
        event.preventDefault();
        const handle = event.currentTarget;
        handle.focus({preventScroll: true});
        handle.setPointerCapture(event.pointerId);
        dragging.current = {handle, group, id, pointerId: event.pointerId,
          startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
          active: false, targetId: null, after: false, frame: 0,
          escape: keyEvent => {
            if (keyEvent.key !== 'Escape') return;
            keyEvent.preventDefault(); keyEvent.stopPropagation(); finishDrag(null, false);
          }};
        handle.ownerDocument.addEventListener('keydown', dragging.current.escape, true);
      }
      function moveDrag(event) {
        const drag = dragging.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        drag.x = event.clientX; drag.y = event.clientY;
        if (!drag.active) {
          if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5) return;
          drag.active = true;
          dragFrame(drag);
        } else updateTarget(drag);
      }
      function saveOrder(group, next) {
        if (!source.getSnapshot().writable) return;
        const rows = catalogs[group].getSnapshot(), current = source.getSnapshot().preferences;
        const before = arrange(rows, current[group]), after = arrange(rows, next[group]);
        if (before.length === after.length && before.every((row, i) => row.id === after[i].id)) return;
        void save(next);
      }
      function finishDrag(event, commit) {
        const drag = dragging.current;
        if (!drag || (event && drag.pointerId !== event.pointerId)) return;
        if (commit && drag.active) {
          drag.x = event.clientX; drag.y = event.clientY;
          updateTarget(drag);
        }
        releaseDrag();
        setDragView(null);
        if (!commit || !drag.active || !drag.targetId) return;
        saveOrder(drag.group, reorder(source.getSnapshot().preferences, drag.group,
          catalogs[drag.group].getSnapshot(), drag.id, drag.targetId, drag.after));
      }
      function handleDragKey(event, group, id) {
        if (event.key === 'Escape' && dragging.current) {
          event.preventDefault(); event.stopPropagation(); finishDrag(null, false); return;
        }
        const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
        if (!delta || dragging.current || !source.getSnapshot().writable) return;
        event.preventDefault();
        saveOrder(group, move(source.getSnapshot().preferences, group, catalogs[group].getSnapshot(), id, delta));
      }
      const togglePanel = group => {
        const next = {...expanded, [group]: !expanded[group]};
        setExpanded(next);
        try { localStorage.setItem(PANELS_KEY, JSON.stringify(next)); } catch { /* Folding still works without storage. */ }
      };
      const {preferences: state, status, writable} = React.useSyncExternalStore(source.subscribe, source.getSnapshot);
      React.useSyncExternalStore(subscribeLocale, getLocaleSnapshot);
      const all = {
        sidebar: React.useSyncExternalStore(catalogs.sidebar.subscribe, catalogs.sidebar.getSnapshot),
        settings: React.useSyncExternalStore(catalogs.settings.subscribe, catalogs.settings.getSnapshot),
      };
      return h('section', {className: 'dshsb-page', ref: root},
        h('style', null, css),
        compatibility.length ? h('p', {role: 'alert', className: 'dshsb-error'}, t('compatibility')) : null,
        h('div', {role: 'status', 'aria-live': 'polite',
          className: 'dshsb-status' + (['error', 'offline', 'unavailable'].includes(status) ? ' dshsb-error' : '')},
          status === 'saved' ? null : t(status)),
        h('span', {className: 'dshsb-sr-only', id: `${panelId}-drag-hint`}, t('dragHint')),
        ...GROUPS.map(group => {
          const rows = arrange(all[group], state[group]);
          return h('section', {key: group, className: 'dshsb-card', 'aria-label': t(group)},
            h('div', {className: 'dshsb-head'},
              h('h3', null, h('button', {type: 'button', className: 'dshsb-disclosure',
                id: `${panelId}-${group}-toggle`, 'aria-expanded': expanded[group],
                'aria-controls': `${panelId}-${group}`, onClick: () => togglePanel(group)},
                h('span', {className: 'dshsb-chevron', 'aria-hidden': true}, '▶'), t(group)))),
            h('div', {className: 'dshsb-panel', id: `${panelId}-${group}`, hidden: !expanded[group],
              role: 'region', 'aria-labelledby': `${panelId}-${group}-toggle`},
            group === 'sidebar' ? h('p', {className: 'dshsb-empty'}, t('layoutHint')) : null,
            rows.length === 0 ? h('p', {className: 'dshsb-empty'}, t('empty')) : null,
            ...rows.map((row, i) => h('div', {key: row.id, className: 'dshsb-row',
              'data-dshsb-row': row.id, 'data-dshsb-group': group,
              'data-dshsb-boundary': isBoundary(row.id),
              'data-dragging': dragView?.group === group && dragView.id === row.id,
              'data-drop': dragView?.group === group && dragView.targetId === row.id && dragView.id !== row.id
                ? dragView.after ? 'after' : 'before' : undefined},
              h('button', {type: 'button', className: 'dshsb-grip', disabled: !writable || rows.length < 2,
                title: t('dragHint'), 'aria-label': `${t('drag')} ${row.label} (${i + 1}/${rows.length})`,
                'aria-describedby': `${panelId}-drag-hint`,
                onPointerDown: event => beginDrag(event, group, row.id),
                onPointerMove: moveDrag, onPointerUp: event => finishDrag(event, true),
                onPointerCancel: event => finishDrag(event, false), onLostPointerCapture: event => finishDrag(event, false),
                onKeyDown: event => handleDragKey(event, group, row.id)},
                h('svg', {width: 16, height: 20, viewBox: '0 0 16 20', fill: 'currentColor', 'aria-hidden': true, focusable: false},
                  ...[5, 10, 15].flatMap(y => [5, 11].map(x => h('circle', {key: `${x}-${y}`, cx: x, cy: y, r: 1.4}))))),
              h('span', {className: 'dshsb-icon', 'aria-hidden': true}, row.id === MORE_ID
                ? h('svg', {width: 18, height: 18, viewBox: '0 0 18 18', fill: 'currentColor'},
                  ...[3, 9, 15].map(cx => h('circle', {key: cx, cx, cy: 9, r: 1.5})))
                : row.id === WORKSPACE_ID || row.kind === 'footer'
                  ? h('svg', {width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none', stroke: 'currentColor', 'stroke-width': 1, 'aria-hidden': true},
                    h('path', {d: row.id === WORKSPACE_ID ? 'M2 5h5l2-2h7v12H2Z' : 'M3 3h4v4H3Zm8 0h4v4h-4ZM3 11h4v4H3Zm8 0h4v4h-4Z'}))
                : group === 'sidebar'
                  ? renderFactorySlot('sidebar.panel.icon', {id: row.id, size: 18, active: false})
                  : renderSettingsIcon?.(row.id, 16)),
              h('div', {className: 'dshsb-label'}, isBoundary(row.id) ? h('strong', null, row.label) : h(NameField, {group,
                row: all[group].find(entry => entry.id === row.id), name: row.label, writable}),
                h('span', {className: isBoundary(row.id) ? 'dshsb-fold-state' : 'dshsb-id'},
                  row.id === MORE_ID ? t('moreBoundary') : row.id === WORKSPACE_ID ? t('workspaceBoundaryHint')
                    : row.actionId || row.id)),
              isBoundary(row.id) ? null : h(VisibilityField, {group, row, writable, preference: state[group]})))));
        }),
        h('section', {className: 'dshsb-card', 'aria-label': t('workspace')},
          h('div', {className: 'dshsb-head'}, h('h3', null,
            h('button', {type: 'button', className: 'dshsb-disclosure',
              id: `${panelId}-workspace-toggle`, 'aria-expanded': expanded.workspace,
              'aria-controls': `${panelId}-workspace`, onClick: () => togglePanel('workspace')},
              h('span', {className: 'dshsb-chevron', 'aria-hidden': true}, '▶'), t('workspace')))),
          h('div', {className: 'dshsb-panel', id: `${panelId}-workspace`, hidden: !expanded.workspace,
            role: 'region', 'aria-labelledby': `${panelId}-workspace-toggle`},
            h('div', {className: 'dshsb-row'},
              h('div', {className: 'dshsb-setting-copy', id: `${panelId}-activity-label`}, t('activeIndicator'),
                h('span', {className: 'dshsb-setting-hint', id: `${panelId}-activity-hint`}, t('activeIndicatorHint'))),
              h('button', {type: 'button', className: 'dshsb-switch', role: 'switch', disabled: !writable,
                'aria-checked': state.workspace?.activeIndicator !== false,
                'aria-labelledby': `${panelId}-activity-label`, 'aria-describedby': `${panelId}-activity-hint`,
                onClick: () => {
                  const current = source.getSnapshot().preferences;
                  const enabled = current.workspace?.activeIndicator !== false;
                  void save({...current, workspace: {...current.workspace, activeIndicator: !enabled}});
                }}, h('span', {'aria-hidden': true}))),
            h('div', {className: 'dshsb-row'},
              h('div', {className: 'dshsb-setting-copy', id: `${panelId}-pin-label`}, t('pinWorkspace'),
                h('span', {className: 'dshsb-setting-hint', id: `${panelId}-pin-hint`}, t('pinHint'))),
              h('button', {type: 'button', className: 'dshsb-switch', role: 'switch', disabled: !writable,
                'aria-checked': state.workspace?.pinning !== false,
                'aria-labelledby': `${panelId}-pin-label`, 'aria-describedby': `${panelId}-pin-hint`,
                onClick: () => {
                  const current = source.getSnapshot().preferences;
                  const enabled = current.workspace?.pinning !== false;
                  void save({...current, workspace: {...current.workspace, pinning: !enabled}});
                }}, h('span', {'aria-hidden': true}))),
            h('div', {className: 'dshsb-row'},
              h('div', {className: 'dshsb-setting-copy', id: `${panelId}-collapse-one-click-label`}, t('collapseOneClick'),
                h('span', {className: 'dshsb-setting-hint', id: `${panelId}-collapse-one-click-hint`}, t('collapseOneClickHint'))),
              h('button', {type: 'button', className: 'dshsb-switch', role: 'switch', disabled: !writable,
                'aria-checked': state.workspace?.collapseOneClick !== false,
                'aria-labelledby': `${panelId}-collapse-one-click-label`,
                'aria-describedby': `${panelId}-collapse-one-click-hint`,
                onClick: () => {
                  const current = source.getSnapshot().preferences;
                  const enabled = current.workspace?.collapseOneClick !== false;
                  void save({...current, workspace: {...current.workspace, collapseOneClick: !enabled}});
                }}, h('span', {'aria-hidden': true}))),
            h('div', {className: 'dshsb-row'},
              h('div', {className: 'dshsb-setting-copy'},
                h('span', {id: `${panelId}-dynamic-label`}, t('dynamicSort')),
                h('span', {className: 'dshsb-setting-hint', id: `${panelId}-dynamic-hint`}, t('dynamicSortHint'))),
              h('button', {type: 'button', className: 'dshsb-switch', role: 'switch', disabled: !writable,
                'aria-checked': state.workspace?.dynamicSort !== false,
                'aria-labelledby': `${panelId}-dynamic-label`, 'aria-describedby': `${panelId}-dynamic-hint`,
                onClick: () => {
                  const current = source.getSnapshot().preferences;
                  const enabled = current.workspace?.dynamicSort !== false;
                  void save({...current, workspace: {...current.workspace, dynamicSort: !enabled}});
                }}, h('span', {'aria-hidden': true}))))));
    }
    ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
      name: 'settings.section.icon', id: OWN_ID,
    }, ({size = 16}) => h('svg', {
      width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': true, focusable: false,
    }, h('rect', {x: 1.5, y: 2, width: 13, height: 12, rx: 2}),
    h('path', {d: 'M6 2v12m3-8.5h3M9 8h2M9 10.5h3M3.25 6.75 4.5 8l-1.25 1.25'}))));
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section', id: OWN_ID, order: 50, label: () => t('title'),
    }, Page));
  },
};
