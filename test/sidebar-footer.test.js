import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalize} from '../src/model.js';
import {WORKSPACE_COLLAPSE_ALL_CSS} from '../src/workspace.js';
import {MORE_MENU_CSS, projectMenuTrigger} from '../src/sidebar.js';

test('workspace ellipsis archives eligible members using the native session glyph and action', async () => {
  const env = runtime();
  let snapshot = {phase: 'ready', items: [
    {workspaceId: 'target', sessionIds: ['pinned', 'old', 'active', 'quiet', 'laterPinned', 'hidden', 'blank', 'child', 'denied']},
    {workspaceId: 'other', sessionIds: ['otherSession']},
    {workspaceId: 'empty', sessionIds: []},
  ], pinnedSessionIds: ['pinned'], archivedSessionIds: ['old']};
  const calls = [];
  const deactivate = env.activateArchiveMenu({
    workspaces: {list: {getSnapshot: () => snapshot}},
    sessions: {list: {getSnapshot: () => ({phase: 'ready', byId: {
      pinned: {}, old: {}, active: {}, quiet: {}, laterPinned: {}, hidden: {},
      blank: {blank: true}, child: {origin: 'subagent'}, denied: {}, otherSession: {},
    }})}},
    remoteAccess: {source(kind, id, endpoint) {
      assert.equal(kind, 'session');
      assert.equal(endpoint, 'workspace/archiveSession');
      return {getSnapshot: () => id !== 'denied'};
    }},
    uiWorkspace: {async archiveSession(...args) {
      calls.push(args);
      if (args[0] === 'active') throw Object.assign(new Error('session active'), {rpcError: {code: 'workspace/session-active'}});
      if (args[0] === 'quiet') snapshot = {...snapshot, pinnedSessionIds: ['pinned', 'laterPinned']};
    }},
  });
  const [menu] = env.menuContributions;
  const target = {workspaceId: 'target'};
  const switchOf = fixture => findElement(fixture.page(), node => node.props?.['aria-labelledby'] === 'test-panels-archive-sessions-label');
  const toggle = () => switchOf(env);
  assert.equal(toggle().props['aria-checked'], true);
  assert.equal(menu.resolve(target).length, 1);
  let menuUpdates = 0;
  const unsubscribe = menu.observe(target)[0].subscribe(() => { menuUpdates++; });
  toggle().props.onClick(); await Promise.resolve();
  assert.ok(menuUpdates > 0, 'open menu observes preference changes');
  assert.equal(toggle().props['aria-checked'], false);
  assert.equal(menu.resolve(target).length, 0);
  assert.equal(env.writes.at(-1).workspace.archiveUnpinnedSessions, false);
  assert.equal(switchOf(runtime(env.writes.at(-1))).props['aria-checked'], false);
  toggle().props.onClick(); await Promise.resolve();
  assert.equal(toggle().props['aria-checked'], true);
  assert.equal(env.writes.at(-1).workspace.archiveUnpinnedSessions, true);
  assert.equal(switchOf(runtime(env.writes.at(-1))).props['aria-checked'], true);
  assert.deepEqual(calls, [], 'enabling does not archive sessions');
  assert.equal(menu.target, 'workspace');
  assert.equal(menu.order, 250);
  assert.equal(menu.resolve({workspaceId: 'missing'}).length, 0);
  assert.equal(menu.resolve({workspaceId: 'empty'})[0].disabled, true);
  const [action] = menu.resolve({workspaceId: 'target'});
  assert.equal(action.disabled, false);
  assert.equal(action.icon.key, 'workspace.archive');
  await Promise.all([action.run(), action.run()]);
  assert.deepEqual(calls, [['active'], ['quiet'], ['hidden']]);
  assert.deepEqual(env.notifications, [['archiveSessionsDone archiveSessionsActive archiveSessionsSkipped', false]]);
  await menu.resolve({workspaceId: 'other'})[0].run();
  assert.deepEqual(calls.at(-1), ['otherSession']);
  assert.deepEqual(env.notifications.at(-1), ['archiveSessionsDone', true]);
  assert.equal(env.writes.length, 2, 'archiving does not change preferences');
  toggle().props.onClick(); await Promise.resolve();
  assert.equal(env.writes.at(-1).workspace.archiveUnpinnedSessions, false);
  assert.equal(menu.resolve(target).length, 0);
  await action.run();
  assert.equal(calls.length, 4, 'an old action cannot run after disabling');
  env.form.update({writable: false});
  assert.equal(toggle().props.disabled, true);
  unsubscribe();
  deactivate();
  assert.equal(env.menuContributions.length, 0);
});

const panel = {id: 'plugins', label: 'Plugins', order: 10};
const action = {id: 'mobile-gateway-devices', label: '移动设备', order: 80};
const footerId = 'dsh-sidebar:action:mobile-gateway-devices';
const WORKSPACE_ID = 'dsh-sidebar:workspaces';
const MORE_ID = 'dsh-sidebar:more';
// Element/store doubles test the adapter contract, not visual rendering.
const React = {
  Fragment: Symbol.for('react.fragment'),
  createElement(type, props, ...children) {
    return {type, key: props?.key ?? null, props: {...props, ...(children.length ? {children: children.length === 1 ? children[0] : children} : {})}};
  },
  isValidElement: node => Boolean(node && typeof node === 'object' && node.type && node.props),
  cloneElement(node, props, ...children) {
    return {...node, props: {...node.props, ...props, ...(children.length ? {children: children[0]} : {})}};
  },
  useSyncExternalStore: (subscribe, snapshot) => {
    const value = snapshot();
    const unsubscribe = subscribe(() => {});
    unsubscribe();
    return value;
  },
  useRef: value => ({current: value}),
  useId: () => 'test-panels',
  useEffect() {},
  useMemo: fn => fn(),
};

// Match the installed LocaleRuntime: these are receiver-dependent class
// methods, not bound arrow functions. Passing them directly to React crashes.
class TestLocaleRuntime {
  snapshot = {revision: 0};
  listeners = new Set();
  reads = 0;
  subscriptions = 0;
  register() { return () => {}; }
  bind() { return key => key; }
  getSnapshot() { this.reads++; return this.snapshot; }
  subscribe(listener) {
    this.subscriptions++;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function runtime(preferences = normalize(null), storage = {getItem: () => null, setItem() {}}) {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  const h = React.createElement, cleanups = [], subscribers = new Map();
  let injected;
  const versions = new Map();
  function Shell(props) { return h('NativeShell', props); }
  function Settings(props) { return h('NativeSettings', props); }
  const shell = {component: Shell, options: {id: 'sidebar'}, children: {native: true}, store: {native: true}};
  const settings = {component: Settings, options: {id: 'sidebar.settings'}};
  function Browser(props) { return props.nativeTree || h('NativeBrowser', props); }
  const browser = {component: Browser, options: {}, children: {native: true}, store: {native: true}};
  const nativeIcon = {component() {}, options: {id: panel.id}};
  const nativeMore = {component() {}, options: {id: 'native-more'}};
  function NativeFooter(props) {
    return h('button', {...props, title: action.label, 'aria-label': action.label},
      h('NativeActionIcon'), action.label, h('span', null, action.label + ' details'));
  }
  const nativeFooter = {component: NativeFooter, options: action};
  const slots = new Map([
    ['sidebar', [shell]], ['sidebar.settings', [settings]], ['sidebar.workspaces', [browser]],
    ['sidebar.panellist', [{options: panel}]],
    ['sidebar.footer.action', [nativeFooter]],
    ['sidebar.panellist.actions', [nativeMore]],
    ['settings.section.icon', [nativeIcon]],
    ['settings.section', [{options: {id: 'general', label: 'General'}}, {options: {id: 'plugins', label: 'Plugins'}}]],
  ]);
  const context = vm.createContext({
    window: {__ModuleLoader__: {load: value => { injected = value.factory(id => id === 'react' ? React : {StateDot: 'NativeStateDot'}); }}},
    localStorage: storage, setTimeout, clearTimeout, preferencesJSON: JSON.stringify(preferences),
  });
  vm.runInContext(source, context);
  // Host preferences arrive as JSON decoded in the client's own realm.
  let config = {status: 'ready', writable: true, value: {preferences: vm.runInContext('JSON.parse(preferencesJSON)', context)}};
  const configSubscribers = new Set(), writes = [];
  const form = {
    getSnapshot: () => config,
    subscribe(fn) { configSubscribers.add(fn); return () => configSubscribers.delete(fn); },
    async set(field, value) { writes.push(value); config = {...config, value: {...config.value, [field]: value}}; for (const fn of configSubscribers) fn(); return true; },
    update(patch) { config = {...config, ...patch}; for (const fn of configSubscribers) fn(); },
  };
  const menuContributions = [], notifications = [];
  let activeMenu = null;
  const menuListeners = new Set();
  const menuActive = {getSnapshot: () => activeMenu,
    subscribe: listener => { menuListeners.add(listener); return () => menuListeners.delete(listener); },
    set: target => { activeMenu = target; for (const listener of menuListeners) listener(); }};
  const ctx = {
    contextMenus: {active: menuActive, notify: (...args) => notifications.push(args), register(contribution) {
      menuContributions.push(contribution);
      return () => { menuContributions.splice(menuContributions.indexOf(contribution), 1); };
    }},
    configForms: {
      get(id) { assert.equal(id, 'dsh-sidebar'); return form; },
      describe() { return {async load() {}, getSnapshot: () => ({status: 'ready'})}; },
    },
    effect(fn) { const off = fn(); if (off) cleanups.push(off); },
    locale: new TestLocaleRuntime(),
    slots: {
      entriesOfSlot: name => slots.get(name) || [], getVersion: name => versions.get(name) || 0,
      subscribe(name, fn) { const set = subscribers.get(name) || new Set(); set.add(fn); subscribers.set(name, set); return () => set.delete(fn); },
      inject(_, fn) { fn(); },
      register(options, component) { const rows = slots.get(options.name) || []; rows.push({options, component}); slots.set(options.name, rows); },
    },
  };
  let activateWorkspaces, activateArchiveMenu;
  ctx.inject = (deps, activate) => {
    if (deps.length === 1) {
      assert.deepEqual(Array.from(deps), ['workspaces']);
      activateWorkspaces = service => activate({workspaces: service, effect: fn => fn()});
    } else if (deps[0] === 'conversation') {
      assert.deepEqual(Array.from(deps), ['conversation', 'sessions', 'uiSession', 'layout']);
      // This fixture does not mount the optional conversation provider.
    } else {
      assert.deepEqual(Array.from(deps), ['workspaces', 'sessions', 'uiWorkspace', 'remoteAccess']);
      activateArchiveMenu = services => {
        let cleanup;
        activate({...services, contextMenus: ctx.contextMenus, effect: fn => { cleanup = fn(); }});
        return cleanup;
      };
    }
  };
  Object.defineProperty(ctx, 'workspaces', {get() { throw new Error('cannot get property "workspaces" without inject'); }});
  injected.apply(ctx);
  const iconCalls = [], slotCalls = [];
  const nativeFallbacks = new Map(['general', 'plugins', 'dsh-sidebar'].map(id => [id, h('NativeFallback', {id})]));
  const props = {
    usePanels: selector => selector([panel]), useEntryPins: selector => selector(['files']),
    usePanelInfo: selector => selector({activePanelId: 'plugins'}),
    useSections: selector => selector([{id: 'general', label: 'General'}, {id: 'plugins', label: 'Plugins'}]),
    selectPanel() {}, setPinned() {}, useEntryActions() {}, t: key => key,
    renderSlot: (...args) => { slotCalls.push(args); return h('NativeSlot', {args}); },
    renderFactorySlot: (...args) => { iconCalls.push(args); return h('NativeIcon', {args}); },
  };
  const pageHooks = [];
  const page = () => {
    const original = React.useState, originalRef = React.useRef;
    let cursor = 0;
    // Retain local Page hook values across direct contract calls; children are not invoked.
    React.useState = initial => {
      const i = cursor++;
      if (!(i in pageHooks)) pageHooks[i] = typeof initial === 'function' ? initial() : initial;
      return [pageHooks[i], next => { pageHooks[i] = next; }];
    };
    React.useRef = initial => {
      const i = cursor++;
      if (!(i in pageHooks)) pageHooks[i] = {current: initial};
      return pageHooks[i];
    };
    try {
      // Exercise the installed shell's call contract: nav icons first, active page last.
      const bridge = settings.component(props).props.renderSlot;
      for (const [id, fallback] of nativeFallbacks) bridge('settings.section.icon', {size: 16, active: id === 'dsh-sidebar'}, {only: id, fallback});
      const owner = bridge('settings.section', {close() {}}, {only: 'dsh-sidebar'}).props.args[1];
      return slots.get('settings.section').find(entry => entry.options.id === 'dsh-sidebar').component({...props, ...owner});
    } finally { React.useState = original; React.useRef = originalRef; }
  };
  const publishSlot = (name, entries) => {
    slots.set(name, entries); versions.set(name, (versions.get(name) || 0) + 1);
    for (const fn of subscribers.get(name) || []) fn();
  };
  return {activateWorkspaces, activateArchiveMenu, publishSlot, subscribers, NativeFooter, shell, Shell, settings, Settings, browser, Browser, slots, props, cleanups, form, nativeIcon, nativeMore, nativeFooter, page, iconCalls, slotCalls, nativeFallbacks, writes, menuContributions, menuActive, notifications, locale: ctx.locale};
}

function findElement(tree, predicate) {
  if (Array.isArray(tree)) return tree.map(node => findElement(node, predicate)).find(Boolean);
  if (!tree || typeof tree !== 'object') return undefined;
  return predicate(tree) ? tree : findElement(tree.props?.children, predicate);
}

test('built adapter preserves native icons, IDs and navigation with a persistent More boundary', () => {
  const env = runtime({sidebar: {order: ['files', 'plugins'], names: {plugins: '扩展'}}});
  const projected = env.shell.component(env.props);
  assert.equal(projected.props.component, env.Shell);
  for (const key of Object.keys(env.props).filter(key => key !== 'usePanels')) {
    assert.equal(projected.props[key], env.props[key], key + ' must pass through unchanged');
  }
  const rows = projected.props.usePanels(x => x);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'plugins');
  assert.equal(rows[0].label, '扩展');
  assert.deepEqual(Array.from(projected.props.useEntryPins(x => x)), ['files']);
  assert.equal(env.shell.children.native, true);
  assert.equal(env.shell.store.native, true);
});

// Reproduce the root shell's structural contract. The adapter, not this fixture,
// supplies the footer seat by wrapping the root's authorized renderSlot call.
function nativeNavigation(props) {
  const panels = props.usePanels(x => x), unpinned = props.useEntryPins(x => x);
  return React.createElement('aside', {'data-native-shell': true},
    React.createElement('nav', null,
      panels.filter(row => row.id === 'plugins' || !unpinned.includes(row.id)).map(row =>
        React.createElement('NativePanelRow', {...row, canUnpin: row.id !== 'plugins', selectPanel: props.selectPanel})),
      React.createElement('NativeMore', {
        entries: panels.filter(row => row.id !== 'plugins'), onOpen: props.selectPanel, onPinnedChange: props.setPinned,
        renderSlot: props.renderSlot,
      })),
    React.createElement('section', {'data-native-workspaces': true}, props.renderSlot('sidebar.workspaces', {wide: true})),
    React.createElement('footer', null, props.renderSlot('sidebar.footer.action', {wide: true})));
}
function projectedNavigation(env) {
  const boundary = env.shell.component(env.props);
  return boundary.type({...boundary.props, component: nativeNavigation});
}
test('native More includes folded plugins with real IDs, native navigation and current page mark', () => {
  const env = runtime({sidebar: {order: ['dsh-sidebar:more', 'plugins'], names: {plugins: '扩展'}}});
  const tree = projectedNavigation(env);
  assert.equal(findElement(tree, node => node.type === 'NativePanelRow'), undefined);
  const more = findElement(tree, node => node.type === 'NativeMore');
  assert.deepEqual(JSON.parse(JSON.stringify(more.props.entries)), [{id: 'plugins', label: '扩展', pinned: false, active: true}]);
  assert.equal(more.props.onOpen, env.props.selectPanel);
  assert.equal(typeof more.props.renderSlot, 'function');
  assert.deepEqual(env.slots.get('sidebar.panellist.actions'), [env.nativeMore]);
});
test('More pin moves a folded item above the persistent boundary and failure rolls back with feedback', async () => {
  const preferences = {sidebar: {order: ['dsh-sidebar:more', 'plugins']}};
  const env = runtime(preferences);
  const more = findElement(projectedNavigation(env), node => node.type === 'NativeMore');
  await more.props.onPinnedChange('plugins', true);
  assert.deepEqual(Array.from(env.writes.at(-1).sidebar.order), ['plugins', MORE_ID, WORKSPACE_ID, footerId]);
  const shown = findElement(projectedNavigation(env), node => node.type === 'NativePanelRow');
  assert.equal(shown.props.id, 'plugins');
  assert.equal(shown.props.canUnpin, false);
  const readonly = runtime(preferences); readonly.form.update({writable: false});
  findElement(projectedNavigation(readonly), node => node.type === 'NativeMore').props.onPinnedChange('plugins', true);
  assert.equal(readonly.writes.length, 0);
  assert.equal(readonly.notifications[0][0], 'readonly');
  const failed = runtime(preferences);
  failed.form.set = async () => false;
  await findElement(projectedNavigation(failed), node => node.type === 'NativeMore').props.onPinnedChange('plugins', true);
  assert.equal(findElement(projectedNavigation(failed), node => node.type === 'NativePanelRow'), undefined);
  assert.equal(failed.notifications[0][0], 'error');
});
test('More boundary has a keyboard-operable persistent grip and stays out of settings', async () => {
  const env = runtime(), page = env.page();
  const marker = rowNode(page, 'sidebar', 'dsh-sidebar:more');
  assert.equal(marker.props.children[2].props.children[0].type, 'strong');
  assert.equal(rowNode(page, 'settings', 'dsh-sidebar:more'), undefined);
  gripNode(marker).props.onKeyDown({key: 'ArrowUp', preventDefault() {}});
  await Promise.resolve();
  assert.deepEqual(Array.from(env.writes.at(-1).sidebar.order), [MORE_ID, 'plugins', WORKSPACE_ID, footerId]);
  assert.equal(findElement(projectedNavigation(env), node => node.type === 'NativePanelRow'), undefined);
});

test('settings adapter preserves the native icon renderer and changes only order/names', () => {
  const env = runtime({settings: {order: ['plugins', 'general'], names: {plugins: '扩展'}}});
  const projected = env.settings.component(env.props);
  assert.equal(projected.type, env.Settings);
  assert.deepEqual(Array.from(projected.props.useSections(x => x), row => row.id), ['plugins', 'general']);
  assert.equal(projected.props.useSections(x => x)[0].label, '扩展');
  const owner = {size: 16, active: true}, options = {only: 'plugins', fallback: {native: true}};
  projected.props.renderSlot('settings.section.icon', owner, options);
  const call = env.slotCalls.at(-1);
  assert.equal(call[0], 'settings.section.icon');
  assert.equal(call[1], owner);
  assert.equal(call[2], options);
  assert.equal(env.slots.get('settings.section.icon')[0], env.nativeIcon);
});

test('native More and footer registrations retain original IDs without duplicate declarations', () => {
  const env = runtime();
  assert.deepEqual(env.slots.get('sidebar.panellist.actions'), [env.nativeMore]);
  assert.deepEqual(env.slots.get('sidebar.footer.action'), [env.nativeFooter]);
  const page = env.page();
  for (const group of ['sidebar', 'settings']) assert.equal(findElement(panelRegion(page, group), node => node.props?.role === 'switch'), undefined);
  assert.equal(findElement(page, node => node.props?.row?.id === 'dsh-sidebar:more'), undefined);
  assert.equal(findElement(page, node => node.props?.row?.id === action.id), undefined);
  assert.ok(rowNode(page, 'sidebar', footerId));
  assert.ok(rowNode(page, 'sidebar', WORKSPACE_ID));
  assert.equal(rowNode(page, 'settings', footerId), undefined);
});

test('management page requests original panel icons through the native factory with the real ID', () => {
  const env = runtime();
  env.page();
  const panelCalls = env.iconCalls.filter(([name]) => name === 'sidebar.panel.icon');
  assert.equal(panelCalls.length, 1);
  assert.deepEqual({...panelCalls[0][1]}, {id: 'plugins', size: 18, active: false});
  assert.equal(env.iconCalls.some(([, owner]) => owner.id === footerId || owner.id === WORKSPACE_ID), false);
  assert.equal(env.slots.get('sidebar.panellist')[0].options, panel);
});

test('settings management reads registered icons and native built-in fallbacks with real section IDs', () => {
  const env = runtime({settings: {order: ['plugins', 'general'], names: {plugins: '扩展'}}});
  const tree = env.page();
  const region = panelRegion(tree, 'settings');
  const plugin = findElement(region, node => node.props?.className === 'dshsb-row' && node.key === 'plugins');
  const general = findElement(region, node => node.props?.className === 'dshsb-row' && node.key === 'general');
  for (const [row, id] of [[plugin, 'plugins'], [general, 'general']]) {
    const icon = findElement(row, node => node.props?.className === 'dshsb-icon').props.children;
    assert.equal(icon.type, 'NativeSlot');
    const [name, owner, options] = icon.props.args;
    assert.equal(name, 'settings.section.icon');
    assert.deepEqual({...owner}, {size: 16, active: false});
    assert.equal(options.only, id);
    assert.equal(options.fallback, env.nativeFallbacks.get(id));
  }
  const icons = env.slots.get('settings.section.icon');
  assert.equal(icons.length, 2, 'one native icon plus the manager’s own icon');
  assert.equal(icons[0], env.nativeIcon);
  assert.equal(icons[1].options.id, 'dsh-sidebar');
  for (const size of [16, 20, 24]) {
    const svg = icons[1].component({size, active: true});
    assert.equal(svg.type, 'svg');
    assert.equal(svg.props.width, size);
    assert.equal(svg.props.height, size);
    assert.equal(svg.props.stroke, 'currentColor');
    assert.equal(svg.props.viewBox, '0 0 16 16');
    assert.equal(svg.props['aria-hidden'], true);
  }
});

test('icon bridge only adds the renderer to this manager page and passes other pages through unchanged', () => {
  const env = runtime(), bridge = env.settings.component(env.props).props.renderSlot;
  const owner = {close() {}}, options = {only: 'plugins'};
  bridge('settings.section', owner, options);
  assert.equal(env.slotCalls.at(-1)[1], owner);
  assert.equal(env.slotCalls.at(-1)[2], options);
  bridge('settings.section', owner, {only: 'dsh-sidebar'});
  const enriched = env.slotCalls.at(-1)[1];
  assert.equal(enriched.close, owner.close);
  assert.equal(typeof enriched.renderSettingsIcon, 'function');
  const fallback = {native: 'gear'};
  bridge('settings.section.icon', {size: 16, active: true}, {only: 'late-plugin', fallback});
  enriched.renderSettingsIcon('late-plugin', 16);
  assert.equal(env.slotCalls.at(-1)[0], 'settings.section.icon');
  assert.equal(env.slotCalls.at(-1)[2].only, 'late-plugin');
  assert.equal(env.slotCalls.at(-1)[2].fallback, fallback, 'latest native fallback remains available');
});

test('cleanup restores original shells and a mounted adapter keeps its hook count on fallback', () => {
  const env = runtime();
  const adapter = env.shell.component, original = React.useSyncExternalStore;
  let count = 0;
  React.useSyncExternalStore = (...args) => { count += 1; return original(...args); };
  try {
    adapter(env.props);
    const managedCount = count;
    for (const off of env.cleanups.reverse()) off();
    assert.equal(env.shell.component, env.Shell);
    assert.equal(env.settings.component, env.Settings);
    count = 0;
    const fallback = adapter(env.props);
    assert.equal(count, managedCount);
    assert.equal(fallback.props.usePanels, env.props.usePanels);
  } finally { React.useSyncExternalStore = original; }
});

test('names edit as borderless text and only renamed entries expose an accessible restore icon', async () => {
  const env = runtime({sidebar: {names: {plugins: 'Custom'}}});
  const field = findElement(env.page(), node => node.type?.name === 'NameField' && node.props.row.id === panel.id);
  const originalState = React.useState;
  React.useState = initial => [initial, () => {}];
  try {
    const tree = field.type(field.props), [input, reset] = tree.props.children;
    assert.equal(input.props.spellCheck, false);
    assert.equal(reset.props.className, 'dshsb-name-reset');
    assert.equal(reset.props.title, 'defaultName');
    assert.equal(reset.props['aria-label'], 'defaultName Plugins');
    assert.equal(reset.props.children.type, 'svg');
    assert.equal(reset.props.children.props.width, 14);
    assert.equal(field.type({...field.props, name: panel.label}).props.children[1], null);
    assert.equal(field.type({...field.props, writable: false}).props.children[1].props.disabled, true);
    await reset.props.onClick();
    assert.equal(env.writes.at(-1).sidebar.names?.plugins, undefined);
  } finally { React.useState = originalState; }
  const css = findElement(env.page(), node => node.type === 'style').props.children;
  assert.match(css, /field-sizing:content/);
  assert.match(css, /border:0!important/);
  assert.match(css, /outline:none!important;box-shadow:none!important/);
  assert.match(css, /dshsb-name-input:focus-visible\{text-decoration:underline dotted/);
  assert.doesNotMatch(css, /dshsb-name-input:focus\{outline:2px/);
});

test('rename field restores a rejected draft even if optimistic updates were never rendered', async () => {
  const env = runtime();
  const field = findElement(env.page(), node => node.type?.name === 'NameField' && node.props.row.id === panel.id);
  const originalState = React.useState, originalEffect = React.useEffect;
  let draft;
  React.useState = initial => { draft = initial; return [initial, next => { draft = next; }]; };
  React.useEffect = () => {};
  try {
    env.form.set = () => { throw Error('offline'); };
    const input = field.type(field.props).props.children[0];
    input.props.onChange({target: {value: 'Rejected'}});
    await input.props.onBlur({target: {value: 'Rejected'}});
    assert.equal(draft, panel.label);
  } finally { React.useState = originalState; React.useEffect = originalEffect; }
});

test('failed rename does not discard a newer draft typed while awaiting persistence', async () => {
  const env = runtime();
  const field = findElement(env.page(), node => node.type?.name === 'NameField' && node.props.row.id === panel.id);
  const originalState = React.useState, originalEffect = React.useEffect;
  let draft, reject;
  React.useState = initial => { draft = initial; return [initial, next => { draft = next; }]; };
  React.useEffect = () => {};
  try {
    env.form.set = () => new Promise((_, fail) => { reject = fail; });
    const input = field.type(field.props).props.children[0];
    const task = input.props.onBlur({target: {value: 'Submitted'}});
    input.props.onChange({target: {value: 'Still editing'}});
    reject(Error('offline'));
    await task;
    assert.equal(draft, 'Still editing');
  } finally { React.useState = originalState; React.useEffect = originalEffect; }
});

const panelsKey = 'dsh-sidebar.panels.v1';
const disclosure = (tree, group) => findElement(tree, node => node.props?.id === `test-panels-${group}-toggle`);
const panelRegion = (tree, group) => findElement(tree, node => node.props?.id === `test-panels-${group}`);
function memoryStorage(value = null) {
  const values = new Map([[panelsKey, value]]);
  return {getItem: key => values.get(key) ?? null, setItem: (key, next) => values.set(key, next)};
}

test('settings page omits the large title and retains group headings', () => {
  const tree = runtime().page();
  assert.equal(findElement(tree, node => node.type === 'h2'), undefined);
  for (const group of ['sidebar', 'settings', 'workspace']) {
    assert.ok(disclosure(tree, group));
  }
});

test('only the first panel starts expanded, with accessible independent disclosure controls', () => {
  const env = runtime();
  const tree = env.page();
  for (const [group, open] of [['sidebar', true], ['settings', false]]) {
    const button = disclosure(tree, group), region = panelRegion(tree, group);
    assert.equal(button.type, 'button');
    assert.equal(button.props.type, 'button');
    assert.equal(button.props['aria-expanded'], open);
    assert.equal(button.props['aria-controls'], region.props.id);
    assert.equal(region.props.hidden, !open);
    assert.equal(region.props['aria-labelledby'], button.props.id);
    assert.equal(button.props.disabled, undefined, 'folding does not require config write permission');
  }
});

test('each panel remembers its open state after remount without changing menu preferences', () => {
  const storage = memoryStorage(), env = runtime(undefined, storage);
  disclosure(env.page(), 'settings').props.onClick();
  let tree = env.page();
  assert.equal(disclosure(tree, 'sidebar').props['aria-expanded'], true);
  assert.equal(disclosure(tree, 'settings').props['aria-expanded'], true);
  disclosure(tree, 'sidebar').props.onClick();
  assert.equal(storage.getItem('dsh-sidebar.preferences.v1'), null);
  assert.deepEqual(JSON.parse(storage.getItem(panelsKey)), {sidebar: false, settings: true, workspace: false, rightSidebar: false});
  const reloaded = runtime(undefined, storage);
  tree = reloaded.page();
  assert.equal(panelRegion(tree, 'sidebar').props.hidden, true);
  assert.equal(panelRegion(tree, 'settings').props.hidden, false);
  assert.equal(reloaded.writes.length, 0, 'folding does not write menu configuration');
  assert.deepEqual(JSON.parse(storage.getItem(panelsKey)), {sidebar: false, settings: true, workspace: false, rightSidebar: false});
});

test('right sidebar switches default on and persist independently; file menu icon uses the native slot', async () => {
  const env = runtime();
  const icon = env.slots.get('contextMenu.icon').find(entry => entry.options.key === 'dsh-sidebar.file-reference').component();
  assert.equal(icon.type, 'svg');
  assert.equal(icon.props.width, 16);
  assert.equal(icon.props['aria-hidden'], true);
  disclosure(env.page(), 'right-sidebar').props.onClick();
  const field = name => findElement(panelRegion(env.page(), 'right-sidebar'), node => node.props?.role === 'switch' &&
    node.props['aria-labelledby'] === `test-panels-${name}-label`);
  assert.equal(panelRegion(env.page(), 'right-sidebar').props.hidden, false);
  assert.equal(field('showHidden').props['aria-checked'], true);
  assert.equal(field('sendFileToConversation').props['aria-checked'], true);
  field('showHidden').props.onClick();
  field('sendFileToConversation').props.onClick();
  await Promise.resolve();
  assert.equal(env.writes.at(-1).rightSidebar.showHidden, false);
  assert.equal(env.writes.at(-1).rightSidebar.sendFileToConversation, false);
  assert.equal(field('sendFileToConversation').props['aria-checked'], false);
  env.form.update({writable: false});
  assert.equal(field('sendFileToConversation').props.disabled, true);
});

test('clean management page omits explanatory copy, reset controls and persistent saved text', () => {
  const env = runtime(), tree = env.page();
  assert.equal(findElement(tree, node => node.props?.className === 'dshsb-toolbar'), undefined);
  assert.equal(findElement(tree, node => node.props?.className === 'dshsb-note'), undefined);
  assert.equal(findElement(tree, node => node.props?.className === 'dshsb-button'), undefined);
  assert.equal(findElement(tree, node => node.props?.children === 'description'), undefined);
  assert.equal(findElement(tree, node => node.props?.role === 'status').props.children, null);
  const hint = findElement(tree, node => node.props?.id === 'test-panels-drag-hint');
  assert.equal(hint.props.className, 'dshsb-sr-only');
  const grip = gripNode(rowNode(tree, 'settings', 'general'));
  assert.equal(grip.props['aria-describedby'], hint.props.id);
});

test('clean management page retains unavailable configuration feedback', () => {
  const env = runtime();
  env.form.update({status: 'unavailable'});
  const tree = env.page(), status = findElement(tree, node => node.props?.role === 'status');
  assert.equal(status.props.children, 'unavailable');
  assert.match(status.props.className, /dshsb-error/);
  assert.equal(gripNode(rowNode(tree, 'settings', 'general')).props.disabled, true);
});

test('both panels can be closed or opened and retain explicit false values', () => {
  for (const open of [false, true]) {
    const env = runtime(undefined, memoryStorage(JSON.stringify({sidebar: open, settings: open})));
    const tree = env.page();
    for (const group of ['sidebar', 'settings']) assert.equal(panelRegion(tree, group).props.hidden, !open);
  }
});

test('invalid or unavailable panel storage falls back safely and never blocks folding', () => {
  for (const raw of ['bad json', 'null', '42', '{"sidebar":"false","settings":1}']) {
    const tree = runtime(undefined, memoryStorage(raw)).page();
    assert.equal(panelRegion(tree, 'sidebar').props.hidden, false);
    assert.equal(panelRegion(tree, 'settings').props.hidden, true);
  }
  const partial = runtime(undefined, memoryStorage('{"sidebar":false}')).page();
  assert.equal(panelRegion(partial, 'sidebar').props.hidden, true);
  assert.equal(panelRegion(partial, 'settings').props.hidden, true);
  const env = runtime(undefined, {getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); }});
  disclosure(env.page(), 'sidebar').props.onClick();
  assert.equal(panelRegion(env.page(), 'sidebar').props.hidden, true);
  disclosure(env.page(), 'settings').props.onClick();
  assert.equal(panelRegion(env.page(), 'settings').props.hidden, false);
});

test('workspace settings open by default and their switches persist without clearing each other', async () => {
  const storage = memoryStorage(), env = runtime(undefined, storage);
  let tree = env.page();
  assert.equal(panelRegion(tree, 'workspace').props.hidden, true);
  const pinToggle = () => findElement(env.page(), node => node.props?.['aria-labelledby'] === 'test-panels-pin-label');
  assert.equal(pinToggle().props.disabled, false);
  assert.equal(pinToggle().props['aria-checked'], true, 'pinning defaults on');
  pinToggle().props.onClick(); await Promise.resolve();
  assert.equal(env.writes.at(-1).workspace.pinning, false);
  const collapseSwitch = () => findElement(env.page(), node => node.props?.['aria-labelledby'] === 'test-panels-collapse-one-click-label');
  assert.equal(collapseSwitch().props.disabled, false);
  assert.equal(collapseSwitch().props['aria-checked'], true, 'one-click collapse defaults on');
  collapseSwitch().props.onClick(); await Promise.resolve();
  assert.equal(env.writes.at(-1).workspace.collapseOneClick, false);
  assert.equal(env.writes.at(-1).workspace.pinning, false, 'the switch merges with pinning');
  disclosure(tree, 'workspace').props.onClick();
  tree = env.page();
  assert.equal(panelRegion(tree, 'workspace').props.hidden, false);
  const toggle = () => findElement(env.page(), node => node.props?.['aria-labelledby'] === 'test-panels-dynamic-label');
  assert.equal(toggle().props['aria-checked'], true, 'dynamic sorting defaults on');
  toggle().props.onClick();
  await Promise.resolve();
  assert.equal(env.writes.at(-1).workspace.dynamicSort, false);
  assert.equal(toggle().props['aria-checked'], false);
  assert.equal(panelRegion(runtime(undefined, storage).page(), 'workspace').props.hidden, false);
  toggle().props.onClick(); await Promise.resolve();
  assert.equal(env.writes.at(-1).workspace.dynamicSort, true);
  assert.equal(env.writes.at(-1).workspace.pinning, false);
  pinToggle().props.onClick(); await Promise.resolve();
  assert.equal(env.writes.at(-1).workspace.pinning, true);
  env.form.update({writable:false});
  assert.equal(toggle().props.disabled,true);
  assert.equal(pinToggle().props.disabled,true);
  assert.equal(collapseSwitch().props.disabled,true);
});

test('active workspace switch persists independently, reuses native StateDot and updates with live activity', async () => {
  const env = runtime();
  let statuses = new Map([['a1', {running: true}]]);
  const snapshot = {items: [{workspaceId: 'a', sessionIds: ['a1']}], archivedSessionIds: []};
  const props = {useWorkspaces: select => select(snapshot), useSessions: select => select({byId: {a1: {}}}),
    useStore: select => select({groupBy: 'workspace'}), useSessionStatus: select => select(statuses),
    renderFactorySlot: () => React.createElement('NativeMenuButton')};
  const owner = {target: {kind: 'workspace', value: {workspaceId: 'a'}}};
  const render = () => {
    const adapter = env.browser.component(props);
    const browser = adapter.type(adapter.props);
    return browser.props.renderFactorySlot('contextMenu.button', owner);
  };
  const marker = tree => findElement(tree, node => node.props?.className === 'dshsb-workspace-activity');
  const toggle = () => findElement(env.page(), node => node.props?.['aria-labelledby'] === 'test-panels-activity-label');
  assert.equal(toggle().props['aria-checked'], true, 'active indicator defaults on');
  statuses = new Map([['a1', {running: true}]]);
  assert.equal(marker(render()).props.children.props.state, 'ongoing');
  const pin = findElement(render(), node => node.props?.className?.includes('dshsb-workspace-pin-action'));
  await pin.props.onClick({stopPropagation() {}});
  assert.equal(env.writes.at(-1).workspace.pinnedWorkspaceIds[0], 'a');
  assert.equal(env.writes.at(-1).workspace.activeIndicator, true);
  assert.equal(marker(render()).props.children.type, 'NativeStateDot');
  assert.equal(marker(render()).props.children.props.state, 'ongoing');
  assert.ok(findElement(render(), node => node.type === 'NativeMenuButton'));
  statuses = new Map([['a1', {pendingInteraction: {kind: 'approval'}}]]);
  assert.equal(marker(render()).props.children.props.state, 'warning');
  statuses = new Map([['a1', {running: false, completionUnread: true}]]);
  assert.equal(marker(render()), undefined);
  env.form.update({writable: false});
  assert.equal(toggle().props.disabled, true);
});

test('workspace adapter changes only projected item order and restores original on disable and disposal', async () => {
  const env = runtime();
  const snapshot = {items:[{workspaceId:'a',sessionIds:['a']},{workspaceId:'b',sessionIds:['b']}], phase:'ready', pinnedSessionIds:[]};
  let sessions = {byId:{a:{updatedAt:10},b:{updatedAt:20}}};
  let view = {groupBy:'workspace', orderBy:'updated'};
  const props = {useWorkspaces: selector => selector(snapshot),useSessions: selector=>selector(sessions),useStore:selector=>selector(view),
    actions:{native:true},renderSlot(){},insertWorkspaceBefore(){throw Error('Must not write registry');}};
  const project = () => { const bridge = env.browser.component(props); return bridge.type(bridge.props); };
  const switchNode = () => findElement(env.page(), node => node.props?.['aria-labelledby']==='test-panels-dynamic-label');
  const ids = () => Array.from(project().props.useWorkspaces(x=>x.items),w=>w.workspaceId);
  assert.deepEqual(ids(),['b','a'],'dynamic sorting is on by default');
  const projected = project();
  assert.equal(projected.props.component,env.Browser);
  for(const key of ['actions','renderSlot','insertWorkspaceBefore','useSessions','useStore']) assert.equal(projected.props[key],props[key]);
  assert.equal(env.browser.store.native,true); assert.equal(env.browser.children.native,true);
  sessions = {byId:{a:{updatedAt:30},b:{updatedAt:20}}};
  assert.deepEqual(ids(),['a','b']);
  sessions = {byId:{a:{updatedAt:10},b:{updatedAt:20}}};
  for(const grouping of ['flat','workspace-tree']) {view={groupBy:grouping,orderBy:'updated'};assert.equal(project().props.useWorkspaces(x=>x),snapshot);}
  view={groupBy:'workspace',orderBy:'manual'};assert.equal(project().props.useWorkspaces(x=>x),snapshot);
  view={groupBy:'workspace',orderBy:'updated'};
  switchNode().props.onClick(); await Promise.resolve();
  assert.equal(project().props.useWorkspaces(x=>x),snapshot,'turning dynamic sorting off restores the native snapshot');
  for(const cleanup of env.cleanups.reverse()) cleanup();
  assert.equal(env.browser.component,env.Browser);
});

test('built workspace adapter syncs the complete order through the native Workspace service', {timeout: 3000}, async t => {
  const env = runtime({workspace: Object.assign(Object.create(null), {pinnedWorkspaceIds: ['c'], onlyPinned: true})});
  let snapshot = {phase: 'ready', state: 'idle', items: ['a', 'b', 'c'].map(workspaceId => ({workspaceId, sessionIds: [workspaceId]}))};
  let complete;
  const synced = new Promise(resolve => { complete = resolve; });
  const moves = [];
  const deactivate = env.activateWorkspaces({
    list: {getSnapshot: () => snapshot},
    async insertBefore(id, anchor) {
      moves.push([id, anchor]);
      const items = snapshot.items.filter(row => row.workspaceId !== id);
      items.splice(items.findIndex(row => row.workspaceId === anchor), 0, snapshot.items.find(row => row.workspaceId === id));
      snapshot = {...snapshot, items};
      if (moves.length === 2) complete();
    },
  });
  t.after(deactivate);
  const sessionSnapshot = {phase: 'ready', byId: {a: {updatedAt: 10}, b: {updatedAt: 20}, c: {updatedAt: 1}}};
  const bridge = env.browser.component({useWorkspaces: selector => selector(snapshot),
    useSessions: selector => selector(sessionSnapshot), useStore: selector => selector({groupBy: 'workspace', orderBy: 'updated'})});
  const selectedEffects = [], cleanups = [];
  const originalEffect = React.useEffect;
  React.useEffect = fn => selectedEffects.push(fn);
  let projected;
  try { projected = bridge.type(bridge.props); } finally { React.useEffect = originalEffect; }
  t.after(() => { for (const cleanup of cleanups.reverse()) cleanup(); });
  for (const fn of selectedEffects) { const dispose = fn(); if (dispose) cleanups.push(dispose); }
  assert.deepEqual(Array.from(projected.props.useWorkspaces(s => s.items), row => row.workspaceId), ['c']);
  await synced;
  assert.deepEqual(moves, [['c', 'a'], ['b', 'a']]);
  assert.deepEqual(snapshot.items.map(row => row.workspaceId), ['c', 'b', 'a']);
  assert.deepEqual(env.writes, []);
});

test('workspace and filter menu preserve LocaleRuntime receiver for snapshot, subscribe and cleanup', () => {
  const env = runtime();
  const subscriptions = [];
  const original = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => {
    const value = original(subscribe, getSnapshot);
    if (value === env.locale.snapshot) subscriptions.push({subscribe, getSnapshot});
    return value;
  };
  try {
    function ViewMenu() {
      return React.createElement('NativeMenu', {items: [{id: 'only-archived'}], selectedIds: [], onClose() {}, onSelect() {}});
    }
    const props = {useWorkspaces: selector => selector({items: []}),
      useSessions: selector => selector({ids: [], byId: {}}),
      useStore: selector => selector({groupBy: 'workspace', orderBy: 'updated'}),
      nativeTree: React.createElement(ViewMenu, {onGroupPick() {}, onArchivedFilterPick() {}})};
    const projection = env.browser.component(props);
    const browser = projection.type(projection.props);
    const filter = browser.type(browser.props);
    filter.type(filter.props);
    assert.equal(subscriptions.length, 2, 'both WorkspaceProjection and FilterMenu subscribe');
    assert.equal(subscriptions[0].subscribe, subscriptions[1].subscribe);
    assert.equal(subscriptions[0].getSnapshot, subscriptions[1].getSnapshot);
    let notified = 0;
    const off = subscriptions[0].subscribe(() => { notified++; });
    env.locale.snapshot = {revision: 1};
    for (const listener of env.locale.listeners) listener();
    assert.equal(notified, 1);
    assert.equal(subscriptions[0].getSnapshot(), env.locale.snapshot);
    off();
    assert.equal(env.locale.listeners.size, 0, 'locale subscription cleans up');
  } finally { React.useSyncExternalStore = original; }
});

test('workspace filter menu follows archive group, toggles durably, and leaves native actions intact', async () => {
  const env = runtime();
  await workspacePinRow(env).button.props.onClick({stopPropagation() {}});
  const initialWrites = env.writes.length;
  let groupBy = 'workspace', closed = 0;
  const selected = [];
  const NativeMenu = () => null;
  function ViewMenu() {
    return React.createElement(NativeMenu, {
      items: [{type: 'label', id: 'filter-by'}, {id: 'only-archived'}], selectedIds: ['workspace', 'updated'],
      onClose() { closed++; }, onSelect(id) { selected.push(id); }, portal: true,
    });
  }
  const snapshot = {items: [{workspaceId: 'a', sessionIds: ['a1']}, {workspaceId: 'b', sessionIds: ['b1']}]};
  const sessions = {ids: ['a1', 'b1'], byId: {a1: {}, b1: {}}};
  const retained = [];
  const actions = {retainAccountKeys: keys => { retained.push([...keys]); }};
  const nativeDialogs = [{workspaceId: 'a'}];
  function project() {
    const bridge = env.browser.component({
      useWorkspaces: selector => selector(snapshot), useSessions: selector => selector(sessions),
      useStore: selector => selector({groupBy, orderBy: 'updated'}), actions,
      nativeTree: React.createElement('div', null,
        React.createElement(ViewMenu, {groupBy, onGroupPick() {}, onArchivedFilterPick() {}}),
        React.createElement('Dialogs', {request: {}, workspaces: nativeDialogs,
          renameWorkspace() {}, settleWorkspaceAction() {}, deleteWorkspace() {}})),
    });
    return bridge.type(bridge.props);
  }
  function tree() {
    const browser = project();
    return browser.type(browser.props);
  }
  function menu() {
    const view = tree().props.children[0];
    return view.type(view.props);
  }
  const dialogWorkspaces = () => tree().props.children[1].props.workspaces;
  assert.deepEqual(dialogWorkspaces(), nativeDialogs);
  let node = menu();
  assert.equal(node.type, NativeMenu);
  assert.equal(node.props.portal, true);
  assert.deepEqual(Array.from(node.props.items, item => item.id), ['filter-by', 'only-archived', 'dshsb-workspace-filter-separator', 'dshsb-workspace-filter', 'dshsb-only-pinned', 'dshsb-collapse-separator', 'dshsb-collapse-workspaces']);
  const pinnedItem = () => menu().props.items.find(item => item.id === 'dshsb-only-pinned');
  const collapseItem = () => menu().props.items.find(item => item.id === 'dshsb-collapse-workspaces');
  assert.equal(pinnedItem().label, 'onlyPinned');
  assert.equal(pinnedItem().icon.type, 'svg');
  assert.equal(collapseItem().label, 'collapseAll', 'unrecorded expansion counts as collapsed');
  assert.equal(collapseItem().disabled, true, 'no store writer is available in this native fixture');
  await node.props.onSelect('updated');
  assert.deepEqual(selected, ['updated']);
  await node.props.onSelect('dshsb-only-pinned');
  assert.equal(closed, 1);
  assert.equal(env.writes.at(-1).workspace.onlyPinned, true);
  assert.deepEqual(Array.from(project().props.useWorkspaces(x => x.items), w => w.workspaceId), ['a']);
  assert.deepEqual(Array.from(project().props.useSessions(x => x.ids)), ['a1']);
  project().props.actions.retainAccountKeys(['\u0000ungrouped', '\u0000flat', 'a']);
  assert.deepEqual(retained.at(-1), ['\u0000ungrouped', '\u0000flat', 'a', 'b']);
  assert.deepEqual(dialogWorkspaces(), snapshot.items);
  assert.ok(menu().props.selectedIds.includes('dshsb-only-pinned'));
  for (groupBy of ['workspace-tree', 'flat']) {
    assert.equal(pinnedItem().disabled, true);
    assert.equal(collapseItem().disabled, true);
    assert.equal(project().props.useWorkspaces(x => x), snapshot);
    assert.equal(project().props.useSessions(x => x), sessions);
    await menu().props.onSelect('dshsb-only-pinned');
    assert.equal(env.writes.length, initialWrites + 1);
  }
  groupBy = 'workspace';
  await menu().props.onSelect('dshsb-only-pinned');
  assert.equal(env.writes.at(-1).workspace.onlyPinned, false);
  assert.equal(project().props.useWorkspaces(x => x), snapshot);
  env.form.update({writable: false});
  assert.equal(pinnedItem().disabled, true);
});

function workspacePinRow(env, id = 'a') {
  const original = React.createElement('OriginalFactory', {onClick() {}}), calls = [];
  const props = {useWorkspaces: selector => selector({items: []}), useSessions: selector => selector({byId: {}}),
    useStore: selector => selector({groupBy: 'workspace', orderBy: 'manual'}),
    renderFactorySlot: (...args) => { calls.push(args); return original; }};
  const bridge = env.browser.component(props), native = bridge.type(bridge.props);
  const owner = {target: {kind: 'workspace', value: {workspaceId: id, displayTitle: 'Workspace ' + id}}, label: 'Menu', className: 'native-button'};
  const options = {native: true};
  const element = native.props.renderFactorySlot('contextMenu.button', owner, options);
  const button = findElement(element, node => node.props?.className?.includes('dshsb-workspace-pin-action'));
  return {native, element, button, original, owner, options, calls};
}
const clickWorkspacePin = (env, id) => workspacePinRow(env, id).button.props.onClick({stopPropagation() {}});

test('workspace row pin toggles current state, persists IDs and never registers a menu action', async () => {
  const env = runtime();
  const button = workspacePinRow(env).button;
  assert.ok(button, 'pinning defaults on');
  assert.equal(button.props['aria-pressed'], false);
  assert.equal(button.props.title, 'pinAction');
  await button.props.onClick({stopPropagation() {}});
  assert.deepEqual(Array.from(env.writes.at(-1).workspace.pinnedWorkspaceIds), ['a']);
  assert.equal(workspacePinRow(env).button.props['aria-pressed'], true);
  assert.equal(workspacePinRow(env).button.props.title, 'unpinAction');
  // Even a rapid second click from the previous render reads the latest state.
  await button.props.onClick({stopPropagation() {}});
  assert.deepEqual(Array.from(env.writes.at(-1).workspace.pinnedWorkspaceIds), []);
  await clickWorkspacePin(env, 'a'); await clickWorkspacePin(env, 'b'); await clickWorkspacePin(env, 'a');
  assert.deepEqual(Array.from(env.writes.at(-1).workspace.pinnedWorkspaceIds), ['b']);
  assert.equal(env.menuContributions.length, 0, 'three-dot menu has no plugin pin contribution');
  const toggle = () => findElement(env.page(), node => node.props?.['aria-labelledby'] === 'test-panels-pin-label');
  toggle().props.onClick(); await Promise.resolve();
  assert.equal(workspacePinRow(env, 'b').button, undefined);
  assert.deepEqual(Array.from(env.writes.at(-1).workspace.pinnedWorkspaceIds), ['b']);
  toggle().props.onClick(); await Promise.resolve();
  assert.equal(workspacePinRow(env, 'b').button.props['aria-pressed'], true);
  env.form.update({writable: false});
  const disabled = workspacePinRow(env).button;
  assert.equal(disabled.props.disabled, true);
  const count = env.writes.length;
  await disabled.props.onClick({stopPropagation() {}});
  assert.equal(env.writes.length, count);
  for (const off of env.cleanups.reverse()) off();
  await button.props.onClick({stopPropagation() {}});
  assert.equal(env.writes.length, count, 'a disposed control cannot write');
});

test('saved workspace pins reach the browser projection while native session state and callbacks pass through', async () => {
  const env=runtime();
  const toggle=key=>findElement(env.page(),node=>node.props?.['aria-labelledby']===`test-panels-${key}-label`);
  const snapshot={items:[{workspaceId:'a',sessionIds:['a1']},{workspaceId:'b',sessionIds:['b1']}],
    pinnedSessionIds:['a1'],archivedSessionIds:[],phase:'ready'};
  const props={useWorkspaces:selector=>selector(snapshot),useSessions:selector=>selector({byId:{a1:{updatedAt:1},b1:{updatedAt:2}}}),
    useStore:selector=>selector({groupBy:'workspace',orderBy:'updated'}),actions:{nativeSessionPin:true},
    renderSlot(){},unarchiveSession(){},insertWorkspaceBefore(){throw Error('Do not rewrite native registry');}};
  const project=()=>{const bridge=env.browser.component(props);return bridge.type(bridge.props);};
  assert.deepEqual(Array.from(project().props.useWorkspaces(s=>s.items),w=>w.workspaceId),['b','a']);
  await clickWorkspacePin(env, 'a');
  const projected=project();
  assert.deepEqual(Array.from(projected.props.useWorkspaces(s=>s.items),w=>w.workspaceId),['a','b']);
  assert.equal(projected.props.useWorkspaces(s=>s.pinnedSessionIds),snapshot.pinnedSessionIds);
  assert.equal(projected.props.useWorkspaces(s=>s.archivedSessionIds),snapshot.archivedSessionIds);
  for(const key of ['actions','useSessions','useStore','renderSlot','unarchiveSession','insertWorkspaceBefore'])
    assert.equal(projected.props[key],props[key]);
  toggle('pin').props.onClick(); await Promise.resolve();
  assert.deepEqual(Array.from(project().props.useWorkspaces(s=>s.items),w=>w.workspaceId),['b','a']);
  assert.deepEqual(Array.from(env.writes.at(-1).workspace.pinnedWorkspaceIds),['a']);
});

test('workspace row pin save failure is surfaced and rolls back the optimistic state', async () => {
  const env=runtime();
  env.form.set=async()=>false;
  await clickWorkspacePin(env, 'a');
  assert.equal(workspacePinRow(env).button.props['aria-pressed'], false);
  assert.equal(env.notifications.length, 1);
  assert.deepEqual(Array.from(env.notifications[0]), ['pinFailed', false]);
});

test('workspace pin is a third native-styled row action, suppresses parent click/drag and leaves original controls intact', async () => {
  const env = runtime();
  let row = workspacePinRow(env);
  assert.ok(row.button);
  const style = findElement(row.element, node => node.type === 'style');
  assert.match(style.props.children, /content:"";display:none/, 'unpinned row has no resting glyph');
  assert.equal(row.element.props.children[1], row.original);
  assert.equal(row.element.props.children[2], row.button);
  assert.equal(row.calls.at(-1)[1], row.owner); assert.equal(row.calls.at(-1)[2], row.options);
  assert.match(row.button.props.className, /native-button/);
  assert.match(style.props.children, /order:2/, 'pin is visually after ellipsis and new-session controls');
  assert.equal(row.button.props.draggable, false);
  let stopped = 0, prevented = 0;
  const event = {stopPropagation() { stopped++; }, preventDefault() { prevented++; }};
  row.button.props.onPointerDown(event); row.button.props.onDragStart(event);
  assert.equal(stopped, 2); assert.equal(prevented, 1);
  await row.button.props.onClick(event);
  assert.equal(stopped, 3);
  row = workspacePinRow(env);
  assert.equal(row.button.props['aria-pressed'], true);
  assert.match(findElement(row.element, n => n.type === 'style').props.children, /content:"";display:inline-flex/);
  for (const [name, target] of [['contextMenu.button', {kind: 'session', value: {sessionId: 'a'}}], ['another.factory', row.owner.target]])
    assert.equal(row.native.props.renderFactorySlot(name, {target}), row.original);
  env.menuActive.set({kind: 'workspace', value: {workspaceId: 'a'}});
  assert.match(findElement(workspacePinRow(env).element, n => n.type === 'style').props.children, /content:"";display:none/);
  assert.equal(env.menuContributions.length, 0);
});

test('view options collapse all only collapses and never expands rendered workspaces', async () => {
  const env = runtime();
  let groupBy = 'workspace', groupExpansion = {}, closed = 0;
  const calls = [];
  const NativeMenu = () => null;
  function ViewMenu() {
    return React.createElement(NativeMenu, {items: [{type: 'label', id: 'filter-by'}, {id: 'only-archived'}],
      selectedIds: [], onClose() { closed++; }, onSelect(id) { calls.push(['native', id]); }});
  }
  const snapshot = {items: [{workspaceId: 'a'}, {workspaceId: 'b'}]};
  const actions = {retainAccountKeys() {}, setGroupExpanded(id, expanded) {
    calls.push(['set', id, expanded]); groupExpansion = {...groupExpansion, [id]: expanded};
  }};
  const project = () => {
    const bridge = env.browser.component({useWorkspaces: selector => selector(snapshot),
      useSessions: selector => selector({ids: [], byId: {}}),
      useStore: selector => selector({groupBy, orderBy: 'updated', groupExpansion}), actions,
      nativeTree: React.createElement(ViewMenu, {onGroupPick() {}, onArchivedFilterPick() {}})});
    return bridge.type(bridge.props);
  };
  const menu = () => {
    const browser = project(), filterMenu = browser.type(browser.props);
    return filterMenu.type(filterMenu.props);
  };
  const collapse = () => menu().props.items.find(item => item.id === 'dshsb-collapse-workspaces');
  assert.equal(collapse().label, 'collapseAll');
  assert.equal(collapse().disabled, false, 'the action stays available for repeated clicks');
  const writesBefore = env.writes.length;
  await menu().props.onSelect('dshsb-collapse-workspaces');
  assert.deepEqual(calls, [['set', 'a', false], ['set', 'b', false]]);
  assert.equal(closed, 1);
  assert.equal(env.writes.length, writesBefore, 'collapsing stays in the native view store');
  assert.equal(collapse().label, 'collapseAll', 'the menu never offers an expand action');
  assert.equal(collapse().disabled, false, 'repeated clicks remain available');
  calls.length = 0;
  await menu().props.onSelect('dshsb-collapse-workspaces');
  assert.deepEqual(calls, [['set', 'a', false], ['set', 'b', false]], 'a second click collapses again, never expands');
  groupBy = 'flat';
  assert.equal(collapse().disabled, true);
  groupBy = 'workspace-tree';
  assert.equal(collapse().disabled, false, 'tree mode still collapses every rendered Workspace');
  calls.length = 0;
  await menu().props.onSelect('dshsb-collapse-workspaces');
  assert.deepEqual(calls, [['set', 'a', false], ['set', 'b', false]]);
  calls.length = 0;
  await menu().props.onSelect('only-archived');
  assert.deepEqual(calls, [['native', 'only-archived']]);
  const withoutWriter = env.browser.component({useWorkspaces: selector => selector(snapshot),
    useSessions: selector => selector({ids: [], byId: {}}),
    useStore: selector => selector({groupBy: 'workspace', orderBy: 'updated', groupExpansion: {}}),
    actions: {retainAccountKeys() {}}, nativeTree: React.createElement(ViewMenu, {onGroupPick() {}, onArchivedFilterPick() {}})});
  const browser = withoutWriter.type(withoutWriter.props);
  const filterMenu = browser.type(browser.props), plain = filterMenu.type(filterMenu.props);
  assert.equal(plain.props.items.find(item => item.id === 'dshsb-collapse-workspaces').disabled, true);
});

test('workspace header places one-click collapse-all immediately before search and toggles every workspace', async () => {
  const env = runtime();
  let groupBy = 'workspace', groupExpansion = {a: true};
  const calls = [];
  const actions = {retainAccountKeys() {}, setGroupExpanded(id, expanded) { calls.push([id, expanded]); }};
  const snapshot = {items: [{workspaceId: 'a'}, {workspaceId: 'b'}]};
  const ViewMenu = () => React.createElement('NativeMenu', {items: [{id: 'only-archived'}], onClose() {}, onSelect() {}});
  const header = () => React.createElement('div', {'data-sidebar-workspace-header': '', 'data-native': true},
    React.createElement('span', {key: 'label'}, '工作区'),
    React.createElement('div', {key: 'search'}),
    React.createElement('div', {key: 'actions'}, React.createElement(ViewMenu, {onGroupPick() {}, onArchivedFilterPick() {}})));
  const project = (overrides = {}) => {
    const bridge = env.browser.component({useWorkspaces: selector => selector(snapshot),
      useSessions: selector => selector({ids: [], byId: {}}),
      useStore: selector => selector({groupBy, orderBy: 'updated', groupExpansion}),
      actions, wide: true, nativeTree: header(), ...overrides});
    return bridge.type(bridge.props);
  };
  const tree = project().type(project().props);
  assert.equal(tree.props['data-sidebar-workspace-header'], '');
  assert.equal(tree.props.children[0].key, 'label');
  assert.equal(tree.props.children[1].key, 'dshsb-collapse-all-control', 'control sits immediately before search');
  assert.equal(tree.props.children[2].key, 'search');
  const headerButton = () => findElement(tree, node => node.props?.className === 'dshsb-collapse-all');
  assert.equal(headerButton().props['aria-label'], 'collapseAll');
  const icon = headerButton().props.children;
  assert.equal(icon.type, 'svg');
  assert.equal(icon.props['stroke-width'], 1);
  assert.equal(icon.props.children.length, 2);
  assert.equal(findElement(tree, node => node.type === 'style').props.children, WORKSPACE_COLLAPSE_ALL_CSS);
  assert.match(WORKSPACE_COLLAPSE_ALL_CSS, /input:not\(\[tabindex="-1"\]\)/);
  assert.match(WORKSPACE_COLLAPSE_ALL_CSS, />\.dshsb-collapse-all\{display:none\}/);
  await findElement(tree, node => node.props?.className === 'dshsb-collapse-all').props.onClick();
  assert.deepEqual(calls, [['a', false], ['b', false]]);
  calls.length = 0;
  const repeatTree = project().type(project().props);
  const repeat = findElement(repeatTree, node => node.props?.className === 'dshsb-collapse-all');
  assert.equal(repeat.props['aria-label'], 'collapseAll', 'the control never offers an expand action');
  assert.equal(repeat.props.disabled, undefined, 'the control stays clickable');
  await repeat.props.onClick();
  assert.deepEqual(calls, [['a', false], ['b', false]], 'a repeated click collapses again, never expands');
  groupBy = 'flat';
  assert.equal(findElement(project().type(project().props), node => node.props?.className === 'dshsb-collapse-all'), undefined);
  groupBy = 'workspace';
  assert.equal(findElement(project({wide: false}).type(project({wide: false}).props), node => node.props?.className === 'dshsb-collapse-all'), undefined);
  const noWriter = env.browser.component({useWorkspaces: selector => selector(snapshot),
    useSessions: selector => selector({ids: [], byId: {}}),
    useStore: selector => selector({groupBy: 'workspace', orderBy: 'updated', groupExpansion: {}}),
    actions: {retainAccountKeys() {}}, wide: true, nativeTree: header()});
  assert.equal(findElement(noWriter.type(noWriter.props).type(noWriter.type(noWriter.props).props), node => node.props?.className === 'dshsb-collapse-all'), undefined);
  findElement(env.page(), node => node.props?.['aria-labelledby'] === 'test-panels-collapse-one-click-label').props.onClick();
  await Promise.resolve();
  assert.equal(findElement(project().type(project().props), node => node.props?.className === 'dshsb-collapse-all'), undefined, 'turning the setting off hides the header control');
});

test('native workspace account reconciliation cannot retrigger sorting in an update loop', async () => {
  const env = runtime();
  const snapshot = {items: [{workspaceId:'a',sessionIds:['a']},{workspaceId:'b',sessionIds:['b']}]};
  let byId = {a:{updatedAt:1},b:{updatedAt:2}};
  let view = {groupBy:'workspace',orderBy:'updated',groupExpansion:{},sessionOrderByAccount:{}};
  const selected = [];
  const props = {useWorkspaces: selector => selector(snapshot), useSessions: selector => selector({byId}),
    useStore: selector => { const value = selector(view); selected.push(value); return value; }};
  const bridge = env.browser.component(props);
  const original = React.useMemo;
  const memos = [], previous = [];
  let cursor = 0, derivations = 0;
  // Exercise the projection's dependency contract with Object.is memo semantics.
  // This is not a mounted React/visual test: it reproduces the native store's
  // retainAccountKeys -> new expansion/account objects -> parent update inputs.
  React.useMemo = (derive, deps) => {
    const index = cursor++;
    if (!previous[index] || deps.some((value,i) => !Object.is(value,previous[index][i]))) {
      memos[index] = derive(); previous[index] = deps;
      if (index === 0) derivations += 1;
    }
    return memos[index];
  };
  try {
    let items;
    for (let pass=0; pass<60; pass++) {
      cursor = 0;
      const projected = bridge.type(bridge.props).props.useWorkspaces(state=>state.items);
      assert.deepEqual(Array.from(projected,w=>w.workspaceId),['b','a']);
      if (items) assert.equal(projected,items,'view-only reconciliation must preserve items identity');
      items = projected;
      view = {...view,groupExpansion:{a:true},sessionOrderByAccount:{a:['a'],b:['b']}};
    }
    assert.equal(derivations,1,'account reconciliation does not cause repeated sorting');
    assert.ok(selected.every(value=>value!==view && typeof value==='string'),'only primitive view settings are selected');
    cursor = 0;
    byId = {...byId,a:{updatedAt:3}};
    assert.equal(bridge.type(bridge.props).props.useWorkspaces(state=>state),snapshot,'real session update still reorders');
    cursor = 0;
    view = {...view,orderBy:'manual'};
    assert.equal(bridge.type(bridge.props).props.useWorkspaces(state=>state),snapshot);
    cursor = 0;
    bridge.props.active=false; bridge.props.pinning=true; bridge.props.pinnedWorkspaceIds=['b'];
    const pinnedItems=bridge.type(bridge.props).props.useWorkspaces(state=>state.items);
    assert.deepEqual(Array.from(pinnedItems,w=>w.workspaceId),['b','a']);
    const pinDerivations=derivations;
    for(let pass=0;pass<60;pass++) {
      cursor = 0;
      view={...view,groupExpansion:{a:true},sessionOrderByAccount:{}};
      assert.equal(bridge.type(bridge.props).props.useWorkspaces(state=>state.items),pinnedItems);
    }
    assert.equal(derivations,pinDerivations,'workspace pins also preserve identity during native reconciliation');
  } finally { React.useMemo = original; }
});

const rowNode = (tree, group, id) => findElement(tree, node => node.props?.['data-dshsb-group'] === group && node.key === id);
const gripNode = row => findElement(row, node => node.props?.className === 'dshsb-grip');
function pointerDrag(env, group = 'settings', id = 'general') {
  const tree = env.page(), grip = gripNode(rowNode(tree, group, id));
  let hit = null, captured = false, serial = 0;
  const frames = new Map(), listeners = new Map();
  const view = {requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; }, cancelAnimationFrame(id) { frames.delete(id); },
    getComputedStyle: node => ({overflowY: node.overflowY || 'visible'})};
  const document = {defaultView: view, elementFromPoint: () => hit,
    addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type)};
  const handle = {ownerDocument: document, focus() {}, setPointerCapture() { captured = true; },
    hasPointerCapture: () => captured, releasePointerCapture() { captured = false; }};
  tree.props.ref.current = {contains: node => node?.owned === true, parentElement: null};
  const event = (x = 10, y = 10, extra = {}) => ({pointerId: 1, button: 0, clientX: x, clientY: y,
    currentTarget: handle, preventDefault() {}, stopPropagation() {}, ...extra});
  const target = (targetId, targetGroup = group, owned = true) => {
    hit = {owned, dataset: {dshsbRow: targetId, dshsbGroup: targetGroup},
      closest() { return this; }, getBoundingClientRect: () => ({top: 20, height: 40})};
  };
  return {grip, event, target, root: tree.props.ref.current, frames, listeners, captured: () => captured};
}

test('rows expose dotted handles without ordinal labels or up/down buttons', () => {
  const env = runtime(), tree = env.page();
  const row = rowNode(tree, 'settings', 'general'), grip = gripNode(row);
  assert.equal(row.props.children[0], grip, 'drag area is first on the left');
  assert.equal(grip.props.disabled, false);
  assert.equal(grip.props.children.type, 'svg');
  assert.equal(grip.props.children.props.children.length, 6);
  assert.equal(findElement(tree, node => node.props?.className === 'dshsb-number'), undefined);
  assert.equal(findElement(tree, node => node.props?.className === 'dshsb-arrow'), undefined);
  assert.equal(gripNode(rowNode(tree, 'sidebar', 'plugins')).props.disabled, false, 'one panel can cross the More boundary');
  assert.equal(gripNode(rowNode(tree, 'sidebar', 'dsh-sidebar:more')).props.disabled, false);
});

test('pointer drop inserts instead of swapping, highlights the gap, and saves once on release', () => {
  const env = runtime({settings: {names: {general: '常规'}}}), d = pointerDrag(env);
  d.grip.props.onPointerDown(d.event());
  d.target('dsh-sidebar');
  d.grip.props.onPointerMove(d.event(10, 55));
  const preview = env.page();
  assert.equal(rowNode(preview, 'settings', 'general').props['data-dragging'], true);
  assert.equal(rowNode(preview, 'settings', 'dsh-sidebar').props['data-drop'], 'after');
  assert.equal(env.writes.length, 0, 'hover does not persist intermediate orders');
  d.grip.props.onPointerUp(d.event(10, 55));
  assert.equal(env.writes.length, 1);
  assert.deepEqual(Array.from(env.writes[0].settings.order), ['plugins', 'dsh-sidebar', 'general']);
  assert.equal(env.writes[0].settings.names.general, '常规');
  assert.equal(d.captured(), false);
  assert.equal(d.frames.size, 0);
  assert.equal(d.listeners.size, 0);
  d.grip.props.onLostPointerCapture(d.event());
  assert.equal(env.writes.length, 1);
});

test('drop before a row, keyboard arrows, and read-only handles use the same saved order', () => {
  const env = runtime(), d = pointerDrag(env, 'settings', 'dsh-sidebar');
  d.grip.props.onPointerDown(d.event()); d.target('general');
  d.grip.props.onPointerMove(d.event(10, 25)); d.grip.props.onPointerUp(d.event(10, 25));
  assert.deepEqual(Array.from(env.writes[0].settings.order), ['dsh-sidebar', 'general', 'plugins']);
  const handle = gripNode(rowNode(env.page(), 'settings', 'dsh-sidebar'));
  handle.props.onKeyDown({key: 'ArrowDown', preventDefault() {}});
  assert.deepEqual(Array.from(env.writes[1].settings.order), ['general', 'dsh-sidebar', 'plugins']);
  env.form.update({writable: false});
  const readonly = gripNode(rowNode(env.page(), 'settings', 'general'));
  assert.equal(readonly.props.disabled, true);
  readonly.props.onPointerDown(d.event());
  readonly.props.onKeyDown({key: 'ArrowDown', preventDefault() {}});
  assert.equal(env.writes.length, 2);
});

test('canceled, external, cross-panel, self and click-only drags never save', () => {
  for (const mode of ['cancel', 'escape', 'lost', 'external', 'cross', 'self', 'click']) {
    const env = runtime(), d = pointerDrag(env);
    d.grip.props.onPointerDown(d.event());
    d.target(mode === 'self' ? 'general' : 'plugins', mode === 'cross' ? 'sidebar' : 'settings', mode !== 'external');
    if (mode !== 'click') d.grip.props.onPointerMove(d.event(10, 55));
    if (mode === 'cancel') d.grip.props.onPointerCancel(d.event());
    if (mode === 'lost') d.grip.props.onLostPointerCapture(d.event());
    if (mode === 'escape') d.listeners.get('keydown')({key: 'Escape', preventDefault() {}, stopPropagation() {}});
    d.grip.props.onPointerUp(d.event(10, mode === 'click' ? 10 : 55));
    assert.equal(env.writes.length, 0, mode);
    assert.equal(d.frames.size, 0, mode);
    assert.equal(d.listeners.size, 0, mode);
  }
});

test('edge scrolling remains inside the scrollport and stops when canceled', () => {
  const env = runtime(), d = pointerDrag(env), scrolls = [];
  d.root.parentElement = {scrollHeight: 500, clientHeight: 100, overflowY: 'auto', parentElement: null,
    getBoundingClientRect: () => ({left: 0, right: 100, top: 0, bottom: 100, height: 100}),
    scrollBy: (x, y) => scrolls.push(y)};
  d.grip.props.onPointerDown(d.event()); d.target('plugins');
  d.grip.props.onPointerMove(d.event(10, 95));
  assert.deepEqual(scrolls, [12]);
  d.grip.props.onPointerMove(d.event(10, 180));
  const frame = d.frames.values().next().value;
  frame();
  assert.deepEqual(scrolls, [12], 'outside the vertical scrollport must not keep scrolling');
  d.grip.props.onPointerCancel(d.event());
  // A real RAF removes its fired callback; the fake map retains it, so test
  // that the stale callback does not schedule anything after cancellation.
  const count = d.frames.size;
  frame();
  assert.equal(d.frames.size, count);
});


const footerSeat = tree => findElement(tree, node => node.props?.['data-dshsb-footer-seat'] === true);
const nativeNav = tree => findElement(tree, node => node.type === 'nav');
const footerSlots = tree => {
  const nodes = [];
  function visit(node) {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    if (node.type === 'NativeSlot' && node.props.args[0] === 'sidebar.footer.action') nodes.push(node);
    visit(node.props?.children);
  }
  visit(tree);
  return nodes;
};
function assertOriginalFooterIds(tree, expected = [action.id], inMenu = false) {
  const nodes = footerSlots(tree);
  assert.deepEqual(nodes.map(node => node.props.args[2]?.only), expected);
  for (const node of nodes) {
    const {dshsbMenuWrap, ...owner} = node.props.args[1];
    assert.deepEqual({...owner}, {wide: true});
    assert.equal(typeof dshsbMenuWrap, inMenu ? 'function' : 'undefined');
  }
}

test('default management sequence is panels, More, Workspaces, then namespaced footer action', () => {
  const env = runtime(), region = panelRegion(env.page(), 'sidebar');
  assert.deepEqual(Array.from(region.props.children.flat(Infinity).filter(node => node?.props?.['data-dshsb-group'] === 'sidebar'), node => node.key), ['plugins', MORE_ID, WORKSPACE_ID, footerId]);
  const tree = projectedNavigation(env);
  assert.ok(findElement(tree, node => node.props?.['data-native-workspaces']));
  assert.ok(findElement(nativeNav(tree), node => node.type === 'NativePanelRow'));
  assert.equal(footerSlots(nativeNav(tree)).length, 0);
  assertOriginalFooterIds(footerSeat(tree));
  assert.deepEqual({...footerSeat(tree).props.style}, {width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column'});
  assertOriginalFooterIds(tree);
});

test('dragging footer before Workspaces saves its top position and preserves native slot ownership', () => {
  const env = runtime(), drag = pointerDrag(env, 'sidebar', footerId);
  drag.grip.props.onPointerDown(drag.event()); drag.target(MORE_ID);
  drag.grip.props.onPointerMove(drag.event(10, 25)); drag.grip.props.onPointerUp(drag.event(10, 25));
  assert.deepEqual(Array.from(env.writes.at(-1).sidebar.order), ['plugins', footerId, MORE_ID, WORKSPACE_ID]);
  const tree = projectedNavigation(env);
  assertOriginalFooterIds(nativeNav(tree));
  assert.equal(footerSlots(footerSeat(tree)).length, 0);
  const reloaded = runtime(env.writes.at(-1));
  assertOriginalFooterIds(nativeNav(projectedNavigation(reloaded)));
});

test('footer between More and Workspaces folds into More without becoming a fake native panel', () => {
  const env = runtime(), drag = pointerDrag(env, 'sidebar', footerId);
  drag.grip.props.onPointerDown(drag.event()); drag.target(WORKSPACE_ID);
  drag.grip.props.onPointerMove(drag.event(10, 25)); drag.grip.props.onPointerUp(drag.event(10, 25));
  assert.deepEqual(Array.from(env.writes.at(-1).sidebar.order), ['plugins', MORE_ID, footerId, WORKSPACE_ID]);
  const tree = projectedNavigation(env), more = findElement(tree, node => node.type === 'NativeMore');
  assert.equal(footerSlots(tree).length, 0, 'folded actions do not remain in the root footer');
  assert.deepEqual(Array.from(more.props.entries, row => row.id), ['plugins']);
  const owner = {entries: more.props.entries, onOpen: env.props.selectPanel, onDismiss() {}};
  const menu = more.props.renderSlot('sidebar.panellist.actions', owner);
  assertOriginalFooterIds(menu, [action.id], true);
  const nativeCall = env.slotCalls.at(-1);
  assert.equal(nativeCall[0], 'sidebar.panellist.actions');
  assert.deepEqual(Array.from(nativeCall[1].entries, row => row.id), ['plugins']);
  assert.equal(env.slots.get('sidebar.panellist').length, 1);
  assert.equal(env.slots.get('sidebar.footer.action').length, 1);
});

test('a real panel can move below Workspaces while More follows the workspace boundary', () => {
  const env = runtime(), drag = pointerDrag(env, 'sidebar', 'plugins');
  drag.grip.props.onPointerDown(drag.event()); drag.target(footerId);
  drag.grip.props.onPointerMove(drag.event(10, 55)); drag.grip.props.onPointerUp(drag.event(10, 55));
  assert.deepEqual(Array.from(env.writes.at(-1).sidebar.order), [MORE_ID, WORKSPACE_ID, footerId, 'plugins']);
  let tree = projectedNavigation(env);
  assert.equal(findElement(nativeNav(tree), node => node.type === 'NativePanelRow'), undefined);
  assert.equal(findElement(footerSeat(tree), node => node.type === 'NativePanelRow').props.id, 'plugins');
  assert.ok(findElement(nativeNav(tree), node => node.type === 'NativeMore'));
  gripNode(rowNode(env.page(), 'sidebar', MORE_ID)).props.onKeyDown({key: 'ArrowDown', preventDefault() {}});
  assert.deepEqual(Array.from(env.writes.at(-1).sidebar.order), [WORKSPACE_ID, MORE_ID, footerId, 'plugins']);
  tree = projectedNavigation(env);
  assert.equal(findElement(nativeNav(tree), node => node.type === 'NativeMore'), undefined);
  const more = findElement(footerSeat(tree), node => node.type === 'NativeMore');
  assert.deepEqual(Array.from(more.props.entries, row => row.id), ['plugins']);
  assert.equal(more.props.entries[0].pinned, false);
  assert.equal(findElement(footerSeat(tree), node => node.type === 'NativePanelRow'), undefined);
});

test('native footer ActionAdapter replaces only exact labels and restores callbacks and component on disposal', () => {
  const env = runtime({sidebar: {names: {[footerId]: 'Devices renamed'}}});
  const click = () => {}, pointer = () => {}, owner = {onClick: click, onPointerDown: pointer, disabled: true};
  const adapted = env.nativeFooter.component;
  const tree = adapted(owner);
  assert.equal(tree.props.title, 'Devices renamed');
  assert.equal(tree.props['aria-label'], 'Devices renamed');
  assert.equal(tree.props.children[1], 'Devices renamed');
  assert.equal(tree.props.children[2].props.children, action.label + ' details');
  assert.equal(tree.props.children[0].type, 'NativeActionIcon');
  assert.equal(tree.props.onClick, click); assert.equal(tree.props.onPointerDown, pointer);
  assert.equal(tree.props.disabled, true);
  for (const off of env.cleanups.reverse()) off();
  assert.equal(env.nativeFooter.component, env.NativeFooter);
  assert.equal(adapted(owner).props.children[1], action.label, 'mounted adapter falls back to original label');
  assert.equal(env.nativeFooter.component(owner).props.onClick, click);
});

// Resolve only the adapter's deferred function boundary, not arbitrary children.
function renderActionOutput(node) {
  while (React.isValidElement(node) && typeof node.type === 'function') node = node.type(node.props);
  return node;
}

test('wrapped mobile footer renames its rendered launcher and overrides inline More geometry', () => {
  const env = runtime({sidebar: {names: {[footerId]: '我的手机'}}});
  const h = React.createElement, click = () => {}, pointer = () => {};
  let renders = 0;
  const icon = h('svg', {width: 20, height: 20, viewBox: '0 0 882 832', fill: 'currentColor'}, h('path', {d: 'M0 0'}));
  const dialog = h('section', {role: 'dialog'}, h('button', {title: action.label}, action.label));
  function FooterButton(props) {
    React.useSyncExternalStore(env.locale.subscribe.bind(env.locale), env.locale.getSnapshot.bind(env.locale));
    renders++;
    return h(React.Fragment, null,
      h('button', {...props, title: action.label, 'aria-label': action.label, 'aria-pressed': true,
        style: {height: 42, width: 'calc(100% + 4px)', margin: '4px -2px', padding: '0 10px 0 8px', gap: 8, background: 'transparent'}},
        icon, h('span', null, action.label)), dialog);
  }
  const registration = props => h(FooterButton, props);
  const entry = {options: action, component: registration};
  env.publishSlot('sidebar.footer.action', [entry]);
  let wrapped = 0;
  const props = {wide: true, onClick: click, onPointerDown: pointer, disabled: true,
    dshsbMenuWrap: tree => { wrapped++; return projectMenuTrigger(React, tree); }};
  const deferred = entry.component(props);
  assert.equal(renders, 0, 'nested Hooks must not run eagerly in the slot adapter');
  const tree = renderActionOutput(deferred);
  const button = findElement(tree, n => n.type === 'button');
  assert.equal(renders, 1); assert.equal(wrapped, 1);
  assert.equal(button.props.title, '我的手机'); assert.equal(button.props['aria-label'], '我的手机');
  assert.equal(button.props.children[1].props.children, '我的手机');
  assert.equal(button.props.onClick, click); assert.equal(button.props.onPointerDown, pointer);
  assert.equal(button.props.disabled, true); assert.equal(button.props['aria-pressed'], true);
  assert.equal(button.props.dshsbMenuWrap, undefined);
  assert.equal(button.props.role, 'menuitem');
  assert.equal(button.props.style.height, 'auto'); assert.equal(button.props.style.minHeight, 32);
  assert.equal(button.props.style.width, '100%'); assert.equal(button.props.style.margin, 0);
  assert.equal(button.props.style.padding, '5px 12px'); assert.equal(button.props.style.gap, 6);
  assert.equal(button.props.style.background, undefined, 'scoped CSS must still own hover background');
  assert.deepEqual(button.props.children[0], icon, 'preserve brand geometry; scoped CSS sizes the SVG to 16px');
  assert.equal(findElement(tree, n => n.props?.role === 'dialog'), dialog, 'dialog labels, controls and styles are untouched');
  env.form.update({value: {preferences: normalize({sidebar: {names: {[footerId]: '另一名称'}}})}});
  const updated = entry.component(props);
  assert.equal(updated.type, deferred.type, 'rename must retain the wrapper component identity');
  assert.equal(findElement(renderActionOutput(updated), n => n.type === 'button').props.title, '另一名称');
  for (const off of env.cleanups.reverse()) off();
  assert.equal(entry.component, registration);
});

test('deferred null and false footer components do not manufacture a More row or pin', () => {
  for (const value of [null, false]) {
    const env = runtime();
    const entry = {options: action, component: props => React.createElement(() => value, props)};
    env.publishSlot('sidebar.footer.action', [entry]);
    let wrapped = 0;
    const tree = renderActionOutput(entry.component({wide: true, dshsbMenuWrap: () => { wrapped++; }}));
    assert.equal(tree, value); assert.equal(wrapped, 0);
  }
});

test('late footer registration and removal update management and root rendering without fake registrations', () => {
  const lateOptions = {id: 'late-action', label: 'Late action', order: 90};
  const lateId = 'dsh-sidebar:action:late-action';
  function LateAction(props) { return React.createElement('button', props, lateOptions.label); }
  const late = {options: lateOptions, component: LateAction};
  const env = runtime({sidebar: {names: {[lateId]: 'Late renamed'}}});
  assert.equal(rowNode(env.page(), 'sidebar', lateId), undefined);
  env.publishSlot('sidebar.footer.action', [env.nativeFooter, late]);
  assert.ok(rowNode(env.page(), 'sidebar', lateId));
  assert.equal(late.component({}).props.children, 'Late renamed');
  assertOriginalFooterIds(footerSeat(projectedNavigation(env)), [action.id, lateOptions.id]);
  env.publishSlot('sidebar.footer.action', [env.nativeFooter]);
  assert.equal(rowNode(env.page(), 'sidebar', lateId), undefined);
  assertOriginalFooterIds(footerSeat(projectedNavigation(env)));
  assert.equal(env.slots.get('sidebar.panellist').length, 1);
  for (const off of env.cleanups.reverse()) off();
  assert.equal(late.component, LateAction);
  assert.equal(env.subscribers.get('sidebar.footer.action').size, 0);
});


test('mixed More renders folded footer and panel once, preserves native pinned entries and pins original preference IDs', async () => {
  const env = runtime({sidebar: {order: [MORE_ID, footerId, 'plugins', WORKSPACE_ID]}});
  // A narrow shell owner must not leak into action rows inside the wide More menu.
  const narrowProps = {...env.props, renderSlot: (...args) => env.props.renderSlot(...args)};
  const boundary = env.shell.component(narrowProps);
  const tree = boundary.type({...boundary.props, component: props => nativeNavigation({...props,
    renderSlot: (name, owner, ...args) => props.renderSlot(name, {...owner, wide: false}, ...args)})});
  const more = findElement(tree, node => node.type === 'NativeMore');
  assert.deepEqual(Array.from(more.props.entries, row => row.id), ['plugins']);
  assert.equal(more.props.entries[0].pinned, false);
  const opened = [], pinned = [];
  let dismissed = 0;
  const pinnedNative = {id: 'native-pinned', pinned: true};
  const owner = {
    entries: [pinnedNative, ...more.props.entries],
    onOpen: id => opened.push(id), onDismiss: () => { dismissed++; },
    onPinnedChange: (id, value) => { pinned.push([id, value]); return more.props.onPinnedChange(id, value); },
  };
  const start = env.slotCalls.length, options = {native: true};
  const menu = more.props.renderSlot('sidebar.panellist.actions', owner, options);
  const calls = env.slotCalls.slice(start);
  assert.equal(calls.filter(([name]) => name === 'sidebar.footer.action').length, 1);
  assertOriginalFooterIds(menu, [action.id], true);
  const nativeCalls = calls.filter(([name]) => name === 'sidebar.panellist.actions');
  assert.equal(nativeCalls.length, 1);
  assert.deepEqual(Array.from(nativeCalls[0][1].entries), [pinnedNative]);
  assert.equal(nativeCalls[0][1].onOpen, owner.onOpen);
  assert.equal(nativeCalls[0][1].onPinnedChange, owner.onPinnedChange);
  assert.equal(nativeCalls[0][2], options);
  const footerSlot = footerSlots(menu)[0];
  const footerRow = env.nativeFooter.component(footerSlot.props.args[1]);
  assert.equal(footerRow.props.children[0].props.children.props.dshsbMenuWrap, undefined, 'private wrapper never reaches the native action');
  const rows = menu.props.children.map(node => node?.key === footerId ? footerRow : node).filter(node => node?.type === 'div' && node.key != null);
  assert.deepEqual(rows.map(row => row.key), [footerId, 'plugins']);
  const panelButton = findElement(rows[1], node => node.props?.role === 'menuitem');
  assert.equal(panelButton.props['aria-current'], 'page');
  panelButton.props.onClick();
  assert.deepEqual(opened, ['plugins']); assert.equal(dismissed, 1);
  const pinButton = rows[0].props.children[1];
  pinButton.props.onClick(); await Promise.resolve();
  assert.deepEqual(pinned, [[footerId, true]]);
  assert.equal(dismissed, 2);
  assert.deepEqual(Array.from(env.writes.at(-1).sidebar.order), [footerId, MORE_ID, 'plugins', WORKSPACE_ID]);
  assert.equal(env.slots.get('sidebar.panellist').length, 1);
  assert.equal(env.slots.get('sidebar.footer.action').length, 1);
});

test('unknown root without native More fails open and retains the original accessible footer slot', () => {
  const env = runtime({sidebar: {order: [MORE_ID, footerId, WORKSPACE_ID, 'plugins']}});
  const boundary = env.shell.component(env.props);
  const tree = boundary.type({...boundary.props, component: props => React.createElement('aside', null,
    React.createElement('nav', null),
    React.createElement('section', {'data-native-workspaces': true}, props.renderSlot('sidebar.workspaces', {wide: true})),
    React.createElement('footer', null, props.renderSlot('sidebar.footer.action', {wide: true})))});
  const slots = footerSlots(tree);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].props.args[2], undefined, 'fallback preserves the unfiltered original native footer renderer');
  assert.deepEqual({...slots[0].props.args[1]}, {wide: true});
  const click = () => {};
  const native = env.nativeFooter.component({onClick: click});
  assert.equal(native.props.onClick, click);
  assert.equal(native.props['aria-label'], action.label);
  assert.equal(env.writes.length, 0);
});


test('hidden native footer actions produce no empty More row or phantom pin and strip private owner props', () => {
  for (const hiddenValue of [null, false]) {
    const hiddenId = 'dsh-sidebar:action:hidden-toolbox';
    const env = runtime({sidebar: {order: ['plugins', MORE_ID, hiddenId, WORKSPACE_ID, footerId]}});
    const received = [];
    const hidden = {options: {id: 'hidden-toolbox', label: 'Toolbox', order: 90},
      component: props => { received.push(props); return hiddenValue; }};
    env.publishSlot('sidebar.footer.action', [env.nativeFooter, hidden]);
    const more = findElement(projectedNavigation(env), node => node.type === 'NativeMore');
    const menu = more.props.renderSlot('sidebar.panellist.actions', {
      entries: more.props.entries, onOpen() {}, onDismiss() {}, onPinnedChange() { throw Error('phantom pin'); },
    });
    assertOriginalFooterIds(menu, ['hidden-toolbox'], true);
    const slotOwner = footerSlots(menu)[0].props.args[1];
    let wrapped = 0;
    const tree = hidden.component({...slotOwner, dshsbMenuWrap: node => { wrapped++; return slotOwner.dshsbMenuWrap(node); }});
    assert.equal(tree, hiddenValue);
    assert.equal(wrapped, 0, 'null/false native actions never receive independent menu chrome');
    assert.deepEqual({...received[0]}, {wide: true});
    assert.equal(findElement(tree, node => node.type === 'button'), undefined);
    assert.equal(env.writes.length, 0);
  }
});

function visibilityInput(env, group, id) {
  const row = rowNode(env.page(), group, id);
  assert.ok(row, `${group} keeps management row ${id}`);
  const field = findElement(row, node => node.type?.name === 'VisibilityField');
  assert.ok(field, `${group} exposes visibility for ${id}`);
  const label = field.type(field.props);
  assert.equal(label.type, 'label');
  const input = findElement(label, node => node.type === 'input');
  assert.equal(input.props.type, 'checkbox');
  return input;
}
const settleVisibility = () => new Promise(resolve => setImmediate(resolve));

test('both navigation groups persist visibility, retain management rows and restore native navigation', async () => {
  for (const group of ['sidebar', 'settings']) {
    const order = group === 'sidebar' ? ['plugins', MORE_ID, WORKSPACE_ID, footerId] : ['plugins', 'general'];
    const preferences = {[group]: {order, names: {plugins: 'Renamed plugins'}}};
    const env = runtime(preferences);
    const nativeRows = () => (group === 'sidebar' ? env.shell : env.settings).component(env.props).props[group === 'sidebar' ? 'usePanels' : 'useSections'](x => x);
    const initial = visibilityInput(env, group, 'plugins');
    assert.equal(initial.props.checked, true);
    assert.equal(initial.props.disabled, false);
    assert.equal(initial.props['aria-label'], 'visible Renamed plugins');
    initial.props.onChange({target: {checked: false}});
    await settleVisibility();
    assert.deepEqual(Array.from(env.writes.at(-1)[group].hidden), ['plugins']);
    assert.deepEqual(Array.from(env.writes.at(-1)[group].order), order);
    assert.deepEqual({...env.writes.at(-1)[group].names}, {plugins: 'Renamed plugins'});
    assert.equal(nativeRows().some(row => row.id === 'plugins'), false);
    assert.equal(visibilityInput(env, group, 'plugins').props.checked, false);
    if (group === 'sidebar') {
      const more = findElement(projectedNavigation(env), node => node.type === 'NativeMore');
      assert.equal(more.props.entries.some(row => row.id === 'plugins'), false);
    }
    const reloaded = runtime(env.writes.at(-1));
    assert.equal(visibilityInput(reloaded, group, 'plugins').props.checked, false);
    visibilityInput(env, group, 'plugins').props.onChange({target: {checked: true}});
    await settleVisibility();
    assert.equal(visibilityInput(env, group, 'plugins').props.checked, true);
    assert.equal(nativeRows().find(row => row.id === 'plugins').label, 'Renamed plugins');
    assert.equal(env.writes.at(-1)[group].hidden?.includes('plugins') ?? false, false);
    assert.deepEqual(Array.from(env.writes.at(-1)[group].order), order);
    assert.deepEqual({...env.writes.at(-1)[group].names}, {plugins: 'Renamed plugins'});
  }
});

test('hidden footer actions disappear from their root seat or More without losing their management checkbox', async () => {
  for (const folded of [false, true]) {
    const order = folded ? ['plugins', MORE_ID, footerId, WORKSPACE_ID] : ['plugins', MORE_ID, WORKSPACE_ID, footerId];
    const env = runtime({sidebar: {order, names: {[footerId]: 'Custom devices'}}});
    const visibleFooter = () => {
      const tree = projectedNavigation(env);
      if (!folded) return footerSlots(footerSeat(tree));
      const more = findElement(tree, node => node.type === 'NativeMore');
      return footerSlots(more.props.renderSlot('sidebar.panellist.actions', {entries: more.props.entries, onOpen() {}, onDismiss() {}}));
    };
    assert.equal(visibleFooter().length, 1);
    visibilityInput(env, 'sidebar', footerId).props.onChange({target: {checked: false}});
    await settleVisibility();
    assert.equal(visibilityInput(env, 'sidebar', footerId).props.checked, false);
    assert.equal(visibleFooter().length, 0);
    assert.deepEqual(Array.from(env.writes.at(-1).sidebar.hidden), [footerId]);
    assert.deepEqual(Array.from(env.writes.at(-1).sidebar.order), order);
    assert.equal(env.writes.at(-1).sidebar.names[footerId], 'Custom devices');
    assert.equal(visibilityInput(runtime(env.writes.at(-1)), 'sidebar', footerId).props.checked, false);
    visibilityInput(env, 'sidebar', footerId).props.onChange({target: {checked: true}});
    await settleVisibility();
    assert.equal(visibleFooter().length, 1);
    assert.equal(visibilityInput(env, 'sidebar', footerId).props.checked, true);
  }
});

test('readonly and self-protected manager visibility cannot write, and boundary rows have no checkbox', () => {
  const env = runtime();
  for (const id of [MORE_ID, WORKSPACE_ID]) {
    const row = rowNode(env.page(), 'sidebar', id);
    assert.ok(row);
    assert.equal(findElement(row, node => node.type?.name === 'VisibilityField'), undefined);
    assert.equal(findElement(row, node => node.props?.type === 'checkbox'), undefined);
  }
  const protectedInput = visibilityInput(env, 'settings', 'dsh-sidebar');
  assert.equal(protectedInput.props.checked, true);
  assert.equal(protectedInput.props.disabled, true);
  protectedInput.props.onChange({target: {checked: false}});
  for (const group of ['sidebar', 'settings']) {
    const stale = visibilityInput(env, group, 'plugins');
    env.form.update({writable: false});
    const readonly = visibilityInput(env, group, 'plugins');
    assert.equal(readonly.props.disabled, true);
    readonly.props.onChange({target: {checked: false}});
    stale.props.onChange({target: {checked: false}});
    env.form.update({writable: true});
  }
  assert.equal(env.writes.length, 0);
});

test('failed visibility saves roll back checked state, keep names/order and report an error', async () => {
  for (const group of ['sidebar', 'settings']) {
    for (const reject of [false, true]) {
      const order = ['plugins', 'general'];
      const env = runtime({[group]: {order, names: {plugins: 'Custom plugins'}}});
      let finish;
      env.form.set = () => new Promise((resolve, fail) => { finish = () => reject ? fail(Error('offline')) : resolve(false); });
      visibilityInput(env, group, 'plugins').props.onChange({target: {checked: false}});
      assert.equal(visibilityInput(env, group, 'plugins').props.checked, false, 'optimistic checkbox state');
      finish();
      await settleVisibility();
      assert.equal(visibilityInput(env, group, 'plugins').props.checked, true);
      const status = findElement(env.page(), node => node.props?.role === 'status');
      assert.equal(status.props.children, 'error');
      assert.match(status.props.className, /dshsb-error/);
      const field = findElement(rowNode(env.page(), group, 'plugins'), node => node.type?.name === 'VisibilityField');
      assert.deepEqual(Array.from(field.props.preference.order), order);
      assert.deepEqual({...field.props.preference.names}, {plugins: 'Custom plugins'});
    }
  }
});

test('native and mixed More share scoped native-sized menu styles', () => {
  for (const order of [['plugins', MORE_ID, WORKSPACE_ID, footerId], [MORE_ID, footerId, 'plugins', WORKSPACE_ID]]) {
    const env = runtime({sidebar: {order}});
    const more = findElement(projectedNavigation(env), node => node.type === 'NativeMore');
    const menu = more.props.renderSlot('sidebar.panellist.actions', {entries: more.props.entries, onOpen() {}, onDismiss() {}});
    assert.equal(menu.props.className, 'dshsb-more-content');
    assert.equal(findElement(menu, node => node.type === 'style').props.children, MORE_MENU_CSS);
    assert.ok(findElement(menu, node => node.props?.className === 'dshsb-more-native'));
  }
  assert.match(MORE_MENU_CSS, /font-size:14px/);
  assert.match(MORE_MENU_CSS, /line-height:22px/);
  assert.match(MORE_MENU_CSS, /padding:5px 12px;gap:6px/);
  assert.match(MORE_MENU_CSS, /svg\{width:16px;height:16px/);
  assert.ok(MORE_MENU_CSS.trim().split('\n').every(rule => rule.startsWith('.dshsb-more-content')));
});

test('menu projection preserves nulls, trigger callbacks and classes and never changes dialog controls', () => {
  const h = React.createElement, click = () => {}, pointer = () => {};
  const dialog = h('section', {role: 'dialog'}, h('button', {className: 'dialog-button', onClick: click}, 'Confirm'));
  const modal = h('section', {'aria-modal': true}, h('button', null, 'Modal'));
  const trigger = h('button', {className: 'native-trigger', onClick: click, onPointerDown: pointer, disabled: true}, 'Devices');
  const later = h('button', {className: 'later-trigger'}, 'Later');
  const tree = [null, false, dialog, modal, h('div', null, trigger, later), null];
  const projected = projectMenuTrigger(React, tree);
  assert.equal(projectMenuTrigger(React, null), null);
  assert.equal(projectMenuTrigger(React, false), false);
  assert.equal(projected[0], null); assert.equal(projected[1], false); assert.equal(projected[5], null);
  assert.equal(projected[2], dialog); assert.equal(projected[3], modal);
  const [button, untouched] = projected[4].props.children;
  assert.equal(button.props.className, 'native-trigger dshsb-more-item');
  assert.equal(button.props.role, 'menuitem');
  assert.equal(button.props.onClick, click); assert.equal(button.props.onPointerDown, pointer);
  assert.equal(button.props.disabled, true);
  assert.equal(untouched, later);
  assert.equal(trigger.props.role, undefined, 'original trigger remains untouched');
});

test('only More and Workspaces use a themed separator background without disabling drag handles', () => {
  const env = runtime(), page = env.page();
  for (const id of [MORE_ID, WORKSPACE_ID]) {
    const row = rowNode(page, 'sidebar', id);
    assert.equal(row.props['data-dshsb-boundary'], true);
    assert.equal(gripNode(row).props.disabled, false);
  }
  for (const [group, id] of [['sidebar', 'plugins'], ['sidebar', footerId], ['settings', 'general']]) {
    assert.equal(rowNode(page, group, id).props['data-dshsb-boundary'], false);
  }
  const css = findElement(page, node => node.type === 'style').props.children;
  assert.match(css, /\.dshsb-row\[data-dshsb-boundary=true\]\{background:var\(--dsw-alias-bg-layer-2\)\}/);
});

test('missing, empty or whitespace-only registered titles fall back to the original English ID', () => {
  for (const label of [undefined, '', '   ', () => '   ']) {
    const env = runtime();
    env.publishSlot('sidebar.footer.action', [{options: {id: 'unnamed-menu', label}, component: () => null}]);
    const row = rowNode(env.page(), 'sidebar', 'dsh-sidebar:action:unnamed-menu');
    assert.equal(findElement(row, node => node.type?.name === 'NameField').props.name, 'unnamed-menu');
    assert.equal(findElement(row, node => node.props?.className === 'dshsb-id').props.children, 'unnamed-menu');
  }
});

test('ordinary subtitles use original English IDs while primary names retain custom text or fall back to IDs', () => {
  for (const order of [['plugins', MORE_ID, WORKSPACE_ID, footerId], [MORE_ID, 'plugins', footerId, WORKSPACE_ID]]) {
    const env = runtime({sidebar: {order, names: {plugins: '扩展', [footerId]: '自定义设备'}}, settings: {names: {general: '自定义常规'}}});
    const unnamed = {options: {id: 'cordis-panel'}, component: () => null};
    env.publishSlot('sidebar.footer.action', [env.nativeFooter, unnamed]);
    const page = env.page();
    const subtitle = id => findElement(rowNode(page, 'sidebar', id), node => node.props?.className === 'dshsb-id').props.children;
    assert.equal(subtitle('plugins'), 'plugins');
    assert.equal(findElement(rowNode(page, 'settings', 'general'), node => node.props?.className === 'dshsb-id').props.children, 'general');
    assert.equal(subtitle(footerId), action.id);
    assert.equal(subtitle('dsh-sidebar:action:cordis-panel'), 'cordis-panel');
    const primary = (group, id) => findElement(rowNode(page, group, id), node => node.type?.name === 'NameField').props.name;
    assert.equal(primary('sidebar', 'plugins'), '扩展');
    assert.equal(primary('sidebar', footerId), '自定义设备');
    assert.equal(primary('settings', 'general'), '自定义常规');
    assert.equal(primary('sidebar', 'dsh-sidebar:action:cordis-panel'), 'cordis-panel');
    assert.equal(findElement(rowNode(page, 'sidebar', MORE_ID), node => node.props?.className === 'dshsb-fold-state').props.children, 'moreBoundary');
    assert.equal(findElement(rowNode(page, 'sidebar', WORKSPACE_ID), node => node.props?.className === 'dshsb-fold-state').props.children, 'workspaceBoundaryHint');
  }
});
