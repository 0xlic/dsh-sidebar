import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalize} from '../src/model.js';

const panel = {id: 'plugins', label: 'Plugins', order: 10};
const action = {id: 'mobile-gateway-devices', label: '移动设备', order: 80};
// Element/store doubles test the adapter contract, not visual rendering.
const React = {
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
  function Shell(props) { return h('NativeShell', props); }
  function Settings(props) { return h('NativeSettings', props); }
  const shell = {component: Shell, options: {id: 'sidebar'}, children: {native: true}, store: {native: true}};
  const settings = {component: Settings, options: {id: 'sidebar.settings'}};
  function Browser(props) { return props.nativeTree || h('NativeBrowser', props); }
  const browser = {component: Browser, options: {}, children: {native: true}, store: {native: true}};
  const nativeIcon = {component() {}, options: {id: panel.id}};
  const nativeMore = {component() {}, options: {id: 'native-more'}};
  const nativeFooter = {component() {}, options: action};
  const slots = new Map([
    ['sidebar', [shell]], ['sidebar.settings', [settings]], ['sidebar.workspaces', [browser]],
    ['sidebar.panellist', [{options: panel}]],
    ['sidebar.footer.action', [nativeFooter]],
    ['sidebar.panellist.actions', [nativeMore]],
    ['settings.section.icon', [nativeIcon]],
    ['settings.section', [{options: {id: 'general', label: 'General'}}, {options: {id: 'plugins', label: 'Plugins'}}]],
  ]);
  vm.runInNewContext(source, {
    window: {__ModuleLoader__: {load: value => { injected = value.factory(id => id === 'react' ? React : {StateDot: 'NativeStateDot'}); }}},
    localStorage: storage,
  });
  let config = {status: 'ready', writable: true, value: {preferences}};
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
    configForms: {get(id) { assert.equal(id, 'dsh-sidebar'); return form; }},
    effect(fn) { const off = fn(); if (off) cleanups.push(off); },
    locale: new TestLocaleRuntime(),
    slots: {
      entriesOfSlot: name => slots.get(name) || [], getVersion: () => 0,
      subscribe(name, fn) { const set = subscribers.get(name) || new Set(); set.add(fn); subscribers.set(name, set); return () => set.delete(fn); },
      inject(_, fn) { fn(); },
      register(options, component) { const rows = slots.get(options.name) || []; rows.push({options, component}); slots.set(options.name, rows); },
    },
  };
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
  return {shell, Shell, settings, Settings, browser, Browser, slots, props, cleanups, form, nativeIcon, nativeMore, nativeFooter, page, iconCalls, slotCalls, nativeFallbacks, writes, menuContributions, menuActive, notifications, locale: ctx.locale};
}

function findElement(tree, predicate) {
  if (Array.isArray(tree)) return tree.map(node => findElement(node, predicate)).find(Boolean);
  if (!tree || typeof tree !== 'object') return undefined;
  return predicate(tree) ? tree : findElement(tree.props?.children, predicate);
}

test('built adapter preserves native icons, IDs and navigation with a persistent More boundary', () => {
  const env = runtime({sidebar: {order: ['files', 'plugins'], hidden: ['plugins'], names: {plugins: '扩展'}}});
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

function nativeNavigation(props) {
  const panels = props.usePanels(x => x), unpinned = props.useEntryPins(x => x);
  return React.createElement('nav', null,
    panels.filter(row => row.id === 'plugins' || !unpinned.includes(row.id)).map(row =>
      React.createElement('NativePanelRow', {...row, canUnpin: row.id !== 'plugins', selectPanel: props.selectPanel})),
    React.createElement('NativeMore', {
      entries: panels.filter(row => row.id !== 'plugins'), onOpen: props.selectPanel, onPinnedChange: props.setPinned,
      renderSlot: props.renderSlot,
    }));
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
  assert.equal(more.props.renderSlot, env.props.renderSlot);
  assert.deepEqual(env.slots.get('sidebar.panellist.actions'), [env.nativeMore]);
});
test('More pin moves a folded item above the persistent boundary and failure rolls back with feedback', async () => {
  const preferences = {sidebar: {order: ['dsh-sidebar:more', 'plugins']}};
  const env = runtime(preferences);
  const more = findElement(projectedNavigation(env), node => node.type === 'NativeMore');
  await more.props.onPinnedChange('plugins', true);
  assert.deepEqual(Array.from(env.writes.at(-1).sidebar.order), ['plugins', 'dsh-sidebar:more']);
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
  assert.deepEqual(Array.from(env.writes.at(-1).sidebar.order), ['dsh-sidebar:more', 'plugins']);
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

test('native More and footer controls are not replaced, duplicated or relocated', () => {
  const env = runtime();
  assert.deepEqual(env.slots.get('sidebar.panellist.actions'), [env.nativeMore]);
  assert.deepEqual(env.slots.get('sidebar.footer.action'), [env.nativeFooter]);
  const page = env.page();
  for (const group of ['sidebar', 'settings']) assert.equal(findElement(panelRegion(page, group), node => node.props?.role === 'switch'), undefined);
  assert.equal(findElement(page, node => node.props?.row?.id === 'dsh-sidebar:more'), undefined);
  assert.equal(findElement(page, node => node.props?.row?.id === action.id), undefined);
});

test('management page requests original panel icons through the native factory with the real ID', () => {
  const env = runtime();
  env.page();
  assert.equal(env.iconCalls.length, 1);
  assert.equal(env.iconCalls[0][0], 'sidebar.panel.icon');
  assert.deepEqual({...env.iconCalls[0][1]}, {id: 'plugins', size: 18, active: false});
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
  assert.equal(env.slots.get('settings.section.icon').length, 1, 'no duplicate declarations or registrations');
  assert.equal(env.slots.get('settings.section.icon')[0], env.nativeIcon);
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
  assert.deepEqual(JSON.parse(storage.getItem(panelsKey)), {sidebar: false, settings: true, workspace: false});
  const reloaded = runtime(undefined, storage);
  tree = reloaded.page();
  assert.equal(panelRegion(tree, 'sidebar').props.hidden, true);
  assert.equal(panelRegion(tree, 'settings').props.hidden, false);
  assert.equal(reloaded.writes.length, 0, 'folding does not write menu configuration');
  assert.deepEqual(JSON.parse(storage.getItem(panelsKey)), {sidebar: false, settings: true, workspace: false});
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

test('workspace settings folds independently and its switches persist without clearing each other', async () => {
  const storage = memoryStorage(), env = runtime(undefined, storage);
  let tree = env.page();
  assert.equal(panelRegion(tree, 'workspace').props.hidden, true);
  const pinToggle = () => findElement(env.page(), node => node.props?.['aria-labelledby'] === 'test-panels-pin-label');
  assert.equal(pinToggle().props.disabled, false);
  assert.equal(pinToggle().props['aria-checked'], false);
  pinToggle().props.onClick(); await Promise.resolve();
  assert.equal(env.writes.at(-1).workspace.pinning, true);
  disclosure(tree, 'workspace').props.onClick();
  tree = env.page();
  assert.equal(panelRegion(tree, 'workspace').props.hidden, false);
  const toggle = () => findElement(env.page(), node => node.props?.['aria-labelledby'] === 'test-panels-dynamic-label');
  assert.equal(toggle().props['aria-checked'], false);
  toggle().props.onClick();
  await Promise.resolve();
  assert.equal(env.writes.at(-1).workspace.dynamicSort, true);
  assert.equal(toggle().props['aria-checked'], true);
  assert.equal(panelRegion(runtime(undefined, storage).page(), 'workspace').props.hidden, false);
  toggle().props.onClick(); await Promise.resolve();
  assert.equal(env.writes.at(-1).workspace.dynamicSort, false);
  assert.equal(env.writes.at(-1).workspace.pinning, true);
  pinToggle().props.onClick(); await Promise.resolve();
  assert.equal(env.writes.at(-1).workspace.pinning, false);
  env.form.update({writable:false});
  assert.equal(toggle().props.disabled,true);
  assert.equal(pinToggle().props.disabled,true);
});

test('active workspace switch persists independently, reuses native StateDot and updates with live activity', async () => {
  const env = runtime();
  findElement(env.page(), node => node.props?.['aria-labelledby'] === 'test-panels-pin-label').props.onClick();
  await Promise.resolve();
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
  assert.equal(marker(render()), undefined);
  const toggle = () => findElement(env.page(), node => node.props?.['aria-labelledby'] === 'test-panels-activity-label');
  assert.equal(toggle().props['aria-checked'], false);
  toggle().props.onClick(); await Promise.resolve();
  assert.equal(env.writes.at(-1).workspace.activeIndicator, true);
  assert.equal(env.writes.at(-1).workspace.pinning, true);
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
  assert.equal(project().props.useWorkspaces(x=>x),snapshot);
  const switchNode = () => findElement(env.page(), node => node.props?.['aria-labelledby']==='test-panels-dynamic-label');
  switchNode().props.onClick(); await Promise.resolve();
  const projected = project();
  assert.equal(projected.props.component,env.Browser);
  assert.deepEqual(Array.from(projected.props.useWorkspaces(x=>x.items),w=>w.workspaceId),['b','a']);
  for(const key of ['actions','renderSlot','insertWorkspaceBefore','useSessions','useStore']) assert.equal(projected.props[key],props[key]);
  assert.equal(env.browser.store.native,true); assert.equal(env.browser.children.native,true);
  sessions = {byId:{a:{updatedAt:30},b:{updatedAt:20}}};
  assert.equal(project().props.useWorkspaces(x=>x),snapshot);
  sessions = {byId:{a:{updatedAt:10},b:{updatedAt:20}}};
  for(const grouping of ['flat','workspace-tree']) {view={groupBy:grouping,orderBy:'updated'};assert.equal(project().props.useWorkspaces(x=>x),snapshot);}
  view={groupBy:'workspace',orderBy:'manual'};assert.equal(project().props.useWorkspaces(x=>x),snapshot);
  view={groupBy:'workspace',orderBy:'updated'};
  switchNode().props.onClick(); await Promise.resolve();
  assert.equal(project().props.useWorkspaces(x=>x),snapshot);
  for(const cleanup of env.cleanups.reverse()) cleanup();
  assert.equal(env.browser.component,env.Browser);
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
  findElement(env.page(), node => node.props?.['aria-labelledby'] === 'test-panels-pin-label').props.onClick();
  await Promise.resolve();
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
  assert.deepEqual(Array.from(node.props.items, item => item.id), ['filter-by', 'only-archived', 'dshsb-workspace-filter-separator', 'dshsb-workspace-filter', 'dshsb-only-pinned']);
  assert.equal(node.props.items.at(-1).label, 'onlyPinned');
  assert.equal(node.props.items.at(-1).icon.type, 'svg');
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
    assert.equal(menu().props.items.at(-1).disabled, true);
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
  assert.equal(menu().props.items.at(-1).disabled, true);
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
  assert.equal(workspacePinRow(env).button, undefined);
  findElement(env.page(), node => node.props?.['aria-labelledby'] === 'test-panels-pin-label').props.onClick();
  await Promise.resolve();
  const button = workspacePinRow(env).button;
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
  toggle('dynamic').props.onClick(); await Promise.resolve();
  toggle('pin').props.onClick(); await Promise.resolve();
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
  findElement(env.page(),node=>node.props?.['aria-labelledby']==='test-panels-pin-label').props.onClick();
  await Promise.resolve();
  env.form.set=async()=>false;
  await clickWorkspacePin(env, 'a');
  assert.equal(workspacePinRow(env).button.props['aria-pressed'], false);
  assert.equal(env.notifications.length, 1);
  assert.deepEqual(Array.from(env.notifications[0]), ['pinFailed', false]);
});

test('workspace pin is a third native-styled row action, suppresses parent click/drag and leaves original controls intact', async () => {
  const env = runtime();
  findElement(env.page(), node => node.props?.['aria-labelledby'] === 'test-panels-pin-label').props.onClick();
  await Promise.resolve();
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

test('native workspace account reconciliation cannot retrigger sorting in an update loop', async () => {
  const env = runtime();
  findElement(env.page(), node => node.props?.['aria-labelledby'] === 'test-panels-dynamic-label').props.onClick();
  await Promise.resolve();
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
