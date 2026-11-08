import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {
  MORE_ID, footerViewId, footerEntryId, mergeSidebarRows,
  sidebarView, withMore, normalize, move, toggle, projectSidebarTree,
} from '../src/model.js';

const panel = {id: 'plugins', label: 'Plugins', order: 10};
const action = {id: 'mobile-gateway-devices', label: 'whaleness移动设备', order: 80};
const actionId = footerViewId(action.id);
const ids = rows => Array.from(rows, row => row.id);
// Minimal React element/store double: no plugin component is invoked by the
// projection, and tests can check the exact original renderSlot callback.
const React = {
  createElement(type, props, ...children) {
    return {type, key: props?.key ?? null, props: {...props, ...(children.length ? {children: children.length === 1 ? children[0] : children} : {})}};
  },
  isValidElement: value => !!value && typeof value === 'object' && 'type' in value,
  cloneElement(node, props, children) { return {...node, props: {...node.props, ...props, children}}; },
  useSyncExternalStore: (_, snapshot) => snapshot(),
  useRef: value => ({current: value}),
};

test('footer identities are namespaced and preserve original labels without mutating rows', () => {
  const merged = mergeSidebarRows([panel], [action]);
  assert.deepEqual(ids(merged), ['plugins', actionId]);
  assert.equal(merged[1].label, action.label);
  assert.equal(action.id, 'mobile-gateway-devices');
  assert.equal(footerEntryId(actionId), action.id);
  assert.equal(footerEntryId('plugins'), null);
  assert.equal(footerEntryId(undefined), null);
  assert.deepEqual(ids(mergeSidebarRows([{...panel, id: action.id}], [action])), [action.id, actionId]);
});

test('footer actions share ordering, folding, hiding, persistence and reset with panels', () => {
  const merged = mergeSidebarRows([panel], [action]);
  let state = normalize(null);
  assert.deepEqual(ids(sidebarView(merged, state.sidebar).direct), ['plugins', actionId]);
  state = move(state, 'sidebar', withMore(merged), actionId, 1);
  state = normalize(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(ids(sidebarView(merged, state.sidebar).folded), [actionId]);
  state = toggle(state, 'sidebar', actionId);
  assert.deepEqual(ids(sidebarView(merged, state.sidebar).folded), []);
  assert.ok(!ids(sidebarView(merged, state.sidebar).panels).includes(actionId));
  state = toggle(state, 'sidebar', actionId);
  state = move(state, 'sidebar', withMore(merged), actionId, -1);
  state = move(state, 'sidebar', withMore(merged), actionId, -1);
  assert.deepEqual(ids(sidebarView(merged, state.sidebar).direct), [actionId, 'plugins']);
  assert.deepEqual(ids(sidebarView(merged, normalize(null).sidebar).direct), ['plugins', actionId]);
});

test('tree projection replaces complete footer rows, not icons or unrelated elements; preserves single children', () => {
  const h = React.createElement;
  const originalAction = h('button', {onClick() {}});
  const icon = h('span', {id: actionId});
  const row = h(() => { throw Error('Must not invoke PanelRow'); }, {
    id: actionId, wide: true, usePanelInfo() {}, selectPanel() {}, key: actionId,
  });
  const tree = h('nav', null, h('section', null, [row, icon, null, false]));
  const before = tree.props.children;
  const projected = projectSidebarTree(React, tree, (id, wide, key) => {
    assert.equal(id, action.id); assert.equal(wide, true); assert.equal(key, actionId);
    return originalAction;
  });
  assert.ok(!Array.isArray(projected));
  assert.ok(!Array.isArray(projected.props.children));
  assert.equal(projected.props.children.props.children[0], originalAction);
  assert.equal(projected.props.children.props.children[1], icon);
  assert.equal(tree.props.children, before);
});

function runtime(preferences = normalize(null), extraFooter = []) {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  const h = React.createElement, cleanups = [], subscribers = new Map();
  let injected, saved = null;
  const renderCalls = [];
  function Shell(props) {
    const rows = props.usePanels(x => x);
    const unpinned = props.useEntryPins(x => x);
    return h('aside', null,
      h('nav', null, rows.filter(row => !unpinned.includes(row.id)).map(row =>
        h('PanelRow', {...row, wide: true, usePanelInfo: props.usePanelInfo, selectPanel: props.selectPanel, key: row.id}))),
      props.renderSlot('sidebar.footer.action', {wide: true}));
  }
  const shell = {component: Shell, options: {id: 'sidebar'}};
  const slots = new Map([
    ['sidebar', [shell]], ['sidebar.panellist', [{options: panel}]],
    ['sidebar.footer.action', [{options: action}, ...extraFooter]],
  ]);
  const versions = new Map();
  vm.runInNewContext(source, {
    window: {__ModuleLoader__: {load: value => { injected = value.factory(() => React); }}, addEventListener() {}, removeEventListener() {}},
    localStorage: {getItem: () => saved, setItem: (_, value) => { saved = value; }},
  });
  let config = {status: 'ready', writable: true, value: {preferences}};
  const configSubscribers = new Set();
  const form = {
    getSnapshot: () => config,
    subscribe(fn) { configSubscribers.add(fn); return () => configSubscribers.delete(fn); },
    async set(field, value) { config = {...config, value: {...config.value, [field]: value}}; for (const fn of configSubscribers) fn(); return true; },
  };
  const ctx = {
    configForms: {get(id) { assert.equal(id, 'dsh-sidebar'); return form; }},
    effect(fn) { const off = fn(); if (off) cleanups.push(off); },
    locale: {register: () => () => {}, bind: () => key => key, subscribe: () => () => {}, getSnapshot: () => ({revision: 0})},
    slots: {
      entriesOfSlot: name => slots.get(name) || [], getVersion: name => versions.get(name) || 0,
      subscribe(name, fn) { const set = subscribers.get(name) || new Set(); set.add(fn); subscribers.set(name, set); return () => set.delete(fn); },
      inject(_, fn) { fn(); },
      register(options, component) { const rows = slots.get(options.name) || []; rows.push({options, component}); slots.set(options.name, rows); },
    },
  };
  injected.apply(ctx);
  const props = {
    usePanels: selector => selector([panel]), useEntryPins: selector => selector([]),
    usePanelInfo: selector => selector({activePanelId: 'plugins'}),
    selectPanel: id => { throw Error('Footer must not navigate: ' + id); },
    renderSlot: (...args) => { renderCalls.push(args); return h('OriginalSlot', {args}); },
  };
  return {shell, Shell, slots, props, renderCalls, cleanups, form};
}

test('built adapter moves original footer slot into the main list and restores shell on disposal', () => {
  const env = runtime();
  const projected = env.shell.component(env.props);
  const tree = projected.type(projected.props);
  const footerRow = tree.props.children[0].props.children.find(node => node.props.id === action.id);
  assert.ok(footerRow, 'footer action appears in main nav');
  const control = footerRow.type(footerRow.props);
  const slot = control.props.children[1].props.children;
  assert.equal(slot.type, 'OriginalSlot');
  assert.equal(slot.props.args[0], 'sidebar.footer.action');
  assert.equal(slot.props.args[1].wide, false, 'native button provides only its icon; presentation owns the label');
  assert.equal(slot.props.args[2].only, action.id);
  assert.equal(control.props.children[2].props.children, action.label);
  assert.equal(tree.props.children[1].props.children, undefined, 'original bottom location is empty');
  for (const off of env.cleanups.reverse()) off();
  assert.equal(env.shell.component, env.Shell);
});

test('More renders original footer control without a wrapping menu button or a panel route', () => {
  const env = runtime();
  const projected = env.shell.component(env.props);
  projected.props.renderSlot('sidebar.panellist.actions', {entries: [{id: actionId, label: '设备', pinned: false}]});
  const owner = env.renderCalls.at(-1)[1];
  const more = env.slots.get('sidebar.panellist.actions')[0].component;
  let dismissed = false;
  const tree = more({...owner, onDismiss: () => { dismissed = true; }});
  const wrapper = tree.props.children[1];
  assert.equal(wrapper.type, 'div');
  const footer = wrapper.props.children;
  assert.equal(footer.props.inMore, true);
  const control = footer.type(footer.props);
  assert.equal(control.props['data-menu'], true);
  assert.equal(control.props.children[2].props.children, '设备');
  const moreStyle = tree.props.children[0].props.children;
  assert.match(moreStyle, /font-size:13px/);
  assert.match(moreStyle, /padding:6px 8px/);
  assert.match(moreStyle, /width:14px;height:14px/);
  assert.equal(control.props.children[1].props.children.type, 'OriginalSlot');
  assert.equal(control.props.children[1].props.children.props.args[2].only, action.id);
  control.props.onClick({defaultPrevented: false});
  assert.equal(dismissed, true);
});

test('unlabelled Cordis status controls remain at their native location and are absent from the catalog', () => {
  const env = runtime(normalize(null), [{options: {id: 'cordis-panel'}}]);
  const projected = env.shell.component(env.props);
  const tree = projected.type(projected.props);
  const native = tree.props.children[1].props.children;
  assert.equal(native.props.children.props.args[2].only, 'cordis-panel');
  assert.ok(!ids(projected.props.usePanels(x => x)).includes(footerViewId('cordis-panel')));
  const page = env.slots.get('settings.section')[0].component();
  const all = JSON.stringify(page);
  assert.ok(!all.includes('cordis-panel'));
  assert.ok(all.includes(action.label));
});

test('configured panel, More and footer names are projected without changing native action IDs', () => {
  const env = runtime(normalize({sidebar: {names: {plugins: '扩展', [MORE_ID]: '其他', [actionId]: '设备'}}}));
  const projected = env.shell.component(env.props);
  const rows = projected.props.usePanels(x => x);
  assert.equal(rows.find(row => row.id === 'dsh-sidebar:panel:plugins').label, '扩展');
  assert.equal(projected.props.t('panels.more'), '其他');
  const tree = projected.type(projected.props);
  const footer = tree.props.children[0].props.children.find(node => node.props.id === action.id);
  assert.equal(footer.props.label, '设备');
  const control = footer.type(footer.props);
  assert.equal(control.props.children[2].props.children, '设备');
  assert.equal(control.props.children[1].props.children.props.args[2].only, action.id);
});

test('footer menu presentation uses the same font, icon size and left alignment as normal More rows', () => {
  const env = runtime();
  const projected = env.shell.component(env.props);
  const tree = projected.type(projected.props);
  const footer = tree.props.children[0].props.children.find(node => node.props.id === action.id);
  const control = footer.type(footer.props);
  const style = control.props.children[0].props.children;
  assert.match(style, /font-size:14px/);
  assert.match(style, /font-weight:400/);
  assert.match(style, /line-height:20px/);
  assert.match(style, /justify-content:flex-start!important/);
  assert.match(style, /svg\{width:16px!important;height:16px!important/);
  assert.match(style, /inset:0 12px 0 36px/);
  assert.match(style, /pointer-events:none/);
  assert.match(style, /data-menu=true\]\{font-size:13px/);
  assert.match(style, /inset:0 8px 0 28px/);
});

test('native icon size rules match actual display:contents slot anchors without leaking into subpanels', () => {
  const env = runtime();
  const projected = env.shell.component(env.props);
  const tree = projected.type(projected.props);
  const footer = tree.props.children[0].props.children.find(node => node.props.id === action.id);
  const css = footer.type(footer.props).props.children[0].props.children;
  const {document} = parseHTML(`<html><body>
    <div class="dshsb-footer-entry" data-menu="true" data-wide="true">
      <div class="dshsb-footer-control">
        <div data-slot="sidebar.footer.action" style="display:contents">
          <button id="wrapped" style="width:36px;height:36px"><svg id="wrapped-icon" width="22" height="22"></svg></button>
          <div class="plugin-panel"><button id="panel-button"><svg id="panel-icon" width="24" height="24"></svg></button></div>
        </div>
      </div>
    </div>
    <div class="dshsb-footer-entry" data-menu="true" data-wide="true">
      <div class="dshsb-footer-control"><button id="direct"><svg id="direct-icon" width="22" height="22"></svg></button></div>
    </div>
    <div class="dshsb-footer-entry" data-menu="false" data-wide="true">
      <div class="dshsb-footer-control"><span data-slot="sidebar.footer.action" style="display:contents"><button id="main"><svg id="main-icon" width="22" height="22"></svg></button></span></div>
    </div>
  </body></html>`);
  // Resolve our ordered stylesheet declarations against an actual DOM selector
  // engine. In particular, display:contents must NOT erase DOM parentage.
  const declarations = new Map();
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const node of document.querySelectorAll(selector.trim())) {
      const values = declarations.get(node) || {};
      for (const declaration of body.split(';')) {
        const colon = declaration.indexOf(':');
        if (colon >= 0) values[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
      }
      declarations.set(node, values);
    }
  }
  const styles = id => declarations.get(document.getElementById(id)) || {};
  for (const id of ['wrapped-icon', 'direct-icon']) {
    assert.equal(styles(id).width, '14px!important');
    assert.equal(styles(id).height, '14px!important');
  }
  assert.equal(styles('main-icon').width, '16px!important');
  assert.equal(styles('wrapped').width, '100%!important');
  assert.equal(styles('wrapped').height, '34px!important');
  assert.equal(styles('wrapped')['justify-content'], 'flex-start!important');
  assert.equal(styles('panel-button').width, undefined);
  assert.equal(styles('panel-icon').width, undefined);
});

test('a mounted sidebar adapter keeps the same hook count after disposal fallback', () => {
  const env = runtime();
  const adapter = env.shell.component, original = React.useSyncExternalStore;
  let count = 0;
  React.useSyncExternalStore = (...args) => { count += 1; return original(...args); };
  try {
    adapter(env.props);
    const managedCount = count;
    for (const off of env.cleanups.reverse()) off();
    count = 0;
    adapter(env.props);
    assert.equal(count, managedCount);
  } finally { React.useSyncExternalStore = original; }
});

function findElement(tree, predicate) {
  if (Array.isArray(tree)) return tree.map(node => findElement(node, predicate)).find(Boolean);
  if (!tree || typeof tree !== 'object') return undefined;
  return predicate(tree) ? tree : findElement(tree.props?.children, predicate);
}

test('rename field restores a rejected draft even if optimistic updates were never rendered', async () => {
  const env = runtime();
  const page = env.slots.get('settings.section')[0].component();
  const field = findElement(page, node => node.type?.name === 'NameField' && node.props.row.id === panel.id);
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
  const page = env.slots.get('settings.section')[0].component();
  const field = findElement(page, node => node.type?.name === 'NameField' && node.props.row.id === panel.id);
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
