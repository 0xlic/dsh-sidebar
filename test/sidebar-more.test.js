import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  MORE_ID, OWN_ID, PLUGINS_ALIAS, isProtected, withMore, sidebarView,
  viewPanelId, realPanelId, normalize, move, toggle,
} from '../src/model.js';

const ids = rows => rows.map(row => row.id);
const rows = [
  {id: 'chat', label: 'Chat', order: 0, icon: 'chat-icon'},
  {id: 'plugins', label: 'Plugins', order: 10, icon: 'plugins-icon'},
  {id: 'files', label: 'Files', order: 20, icon: 'files-icon'},
];
const preference = (order = [], hidden = []) => ({order, hidden});
const roundtrip = value => normalize(JSON.parse(JSON.stringify(value)));

test('More and the manager are protected, but ordinary panels and the plugins alias are not', () => {
  assert.equal(MORE_ID, 'dsh-sidebar:more');
  assert.equal(OWN_ID, 'dsh-sidebar');
  assert.equal(PLUGINS_ALIAS, 'dsh-sidebar:panel:plugins');
  for (const id of [MORE_ID, OWN_ID]) assert.equal(isProtected(id), true);
  for (const id of ['chat', 'plugins', PLUGINS_ALIAS, '', undefined]) {
    assert.equal(isProtected(id), false);
  }
});

test('withMore appends one localized marker without mutating rows or duplicating stale markers', () => {
  const input = [{id: MORE_ID, label: 'Old'}, ...rows, {id: MORE_ID, label: 'Duplicate'}];
  const before = structuredClone(input);
  const result = withMore(input, '更多');
  assert.deepEqual(ids(result), ['chat', 'plugins', 'files', MORE_ID]);
  assert.deepEqual(result.at(-1), {id: MORE_ID, label: '更多', order: Infinity});
  assert.deepEqual(input, before);
  assert.equal(result[0], rows[0]);
  assert.equal(withMore([])[0].label, 'More');
});

test('default view sorts real rows and places More at the bottom', () => {
  const view = sidebarView([rows[2], rows[0], rows[1]], preference());
  assert.deepEqual(ids(view.direct), ['chat', 'plugins', 'files']);
  assert.deepEqual(view.folded, []);
  assert.deepEqual(ids(view.panels), ['chat', PLUGINS_ALIAS, 'files', MORE_ID]);
  assert.deepEqual(view.unpinned, [MORE_ID]);
  assert.equal(view.panels.at(-1).label, 'More');
});

test('custom marker position splits real IDs while shell panels and unpinned use aliases', () => {
  const view = sidebarView(rows, preference(['files', MORE_ID, 'plugins', 'chat']), '其他');
  assert.deepEqual(ids(view.direct), ['files']);
  assert.deepEqual(ids(view.folded), ['plugins', 'chat']);
  assert.deepEqual(ids(view.panels), ['files', MORE_ID, PLUGINS_ALIAS, 'chat']);
  assert.deepEqual(view.unpinned, [PLUGINS_ALIAS, 'chat', MORE_ID]);
  assert.equal(view.panels.find(row => row.id === MORE_ID).label, '其他');
  assert.equal(view.folded[0], rows[1]);
  assert.equal(view.panels.find(row => row.id === PLUGINS_ALIAS).icon, 'plugins-icon');
});

test('marker may be first, folding every real entry without becoming a real entry', () => {
  const view = sidebarView(rows, preference([MORE_ID, 'chat', 'plugins', 'files']));
  assert.deepEqual(view.direct, []);
  assert.deepEqual(ids(view.folded), ['chat', 'plugins', 'files']);
  assert.deepEqual(view.unpinned, ['chat', PLUGINS_ALIAS, 'files', MORE_ID]);
  assert.equal(view.panels.filter(row => row.id === MORE_ID).length, 1);
});

test('hidden entries occupy neither area, shell panels, nor unpinned IDs', () => {
  const view = sidebarView(rows, preference(['chat', MORE_ID, 'plugins', 'files'], ['chat', 'plugins']));
  assert.deepEqual(view.direct, []);
  assert.deepEqual(ids(view.folded), ['files']);
  assert.deepEqual(ids(view.panels), [MORE_ID, 'files']);
  assert.deepEqual(view.unpinned, ['files', MORE_ID]);
});

test('normalization removes protected hidden IDs in both groups while preserving marker order', () => {
  const raw = {
    sidebar: {order: ['chat', MORE_ID, MORE_ID, 'plugins', null], hidden: [MORE_ID, OWN_ID, 'plugins', 'plugins', 7]},
    settings: {order: [MORE_ID, OWN_ID], hidden: [OWN_ID, MORE_ID, 'files']},
  };
  const before = structuredClone(raw);
  const state = normalize(raw);
  assert.deepEqual(state.sidebar, preference(['chat', MORE_ID, 'plugins'], ['plugins']));
  assert.deepEqual(state.settings, preference([MORE_ID, OWN_ID], ['files']));
  assert.deepEqual(raw, before);
});

test('toggle cannot hide More or manager and raw hidden marker cannot remove the split', () => {
  const state = normalize({sidebar: preference(['chat', MORE_ID, 'plugins', 'files'])});
  for (const group of ['sidebar', 'settings']) {
    for (const id of [MORE_ID, OWN_ID]) assert.deepEqual(toggle(state, group, id), state);
  }
  const view = sidebarView(rows, preference([MORE_ID, 'chat', 'plugins', 'files'], [MORE_ID]));
  assert.deepEqual(ids(view.folded), ['chat', 'plugins', 'files']);
  assert.deepEqual(ids(view.panels), [MORE_ID, 'chat', PLUGINS_ALIAS, 'files']);
  assert.ok(view.unpinned.includes(MORE_ID));
});

test('legacy saved orders without a marker keep More at the bottom, including new entries', () => {
  for (const order of [['files', 'chat', 'plugins'], ['files'], []]) {
    const state = roundtrip({sidebar: preference(order)});
    const view = sidebarView(rows, state.sidebar);
    assert.equal(view.panels.at(-1).id, MORE_ID);
    assert.equal(view.direct.length, rows.length);
    assert.deepEqual(view.folded, []);
    assert.deepEqual(view.unpinned, [MORE_ID]);
  }
  assert.deepEqual(ids(sidebarView(rows, preference(['files'])).direct), ['files', 'chat', 'plugins']);
});

test('moving a panel across More persists folding and unfolding through JSON', () => {
  const initial = normalize({sidebar: preference(['chat', 'plugins', MORE_ID, 'files', 'unloaded'])});
  const before = structuredClone(initial);
  const folded = roundtrip(move(initial, 'sidebar', withMore(rows), 'plugins', 1));
  assert.deepEqual(folded.sidebar.order, ['chat', MORE_ID, 'plugins', 'files', 'unloaded']);
  assert.deepEqual(ids(sidebarView(rows, folded.sidebar).direct), ['chat']);
  assert.deepEqual(ids(sidebarView(rows, folded.sidebar).folded), ['plugins', 'files']);
  const restored = roundtrip(move(folded, 'sidebar', withMore(rows), 'plugins', -1));
  assert.deepEqual(restored, initial);
  assert.deepEqual(ids(sidebarView(rows, restored.sidebar).direct), ['chat', 'plugins']);
  assert.deepEqual(initial, before);
});

test('moving the marker changes the split and retains hidden and temporarily absent identities', () => {
  const state = normalize({sidebar: preference(['chat', 'plugins', MORE_ID, 'files', 'unloaded'], ['plugins'])});
  const next = roundtrip(move(state, 'sidebar', withMore(rows), MORE_ID, -1));
  assert.deepEqual(next.sidebar.order, ['chat', MORE_ID, 'plugins', 'files', 'unloaded']);
  assert.deepEqual(next.sidebar.hidden, ['plugins']);
  assert.deepEqual(ids(sidebarView(rows, next.sidebar).folded), ['files']);
  const visible = roundtrip(toggle(next, 'sidebar', 'plugins'));
  assert.deepEqual(ids(sidebarView(rows, visible.sidebar).folded), ['plugins', 'files']);
});

test('plugins presentation alias roundtrips to the real route and icon key without persisting aliases', () => {
  assert.equal(viewPanelId('plugins'), PLUGINS_ALIAS);
  assert.equal(realPanelId(PLUGINS_ALIAS), 'plugins');
  for (const id of ['chat', 'files', MORE_ID, OWN_ID]) {
    assert.equal(viewPanelId(id), id);
    assert.equal(realPanelId(id), id);
  }
  const state = roundtrip({sidebar: preference(['chat', MORE_ID, 'plugins', 'files'])});
  const view = sidebarView(rows, state.sidebar);
  const pluginPanel = view.panels.find(row => row.id === PLUGINS_ALIAS);
  const original = rows.find(row => row.id === realPanelId(pluginPanel.id));
  assert.equal(realPanelId(pluginPanel.id), 'plugins');
  assert.equal(pluginPanel.icon, original.icon);
  assert.equal(pluginPanel.label, original.label);
  assert.deepEqual(view.folded.find(row => row.id === 'plugins'), original);
  assert.equal(state.sidebar.order.includes(PLUGINS_ALIAS), false);
  const hidden = roundtrip(toggle(state, 'sidebar', realPanelId(pluginPanel.id)));
  assert.deepEqual(hidden.sidebar.hidden, ['plugins']);
  assert.equal(sidebarView(rows, hidden.sidebar).panels.some(row => row.id === PLUGINS_ALIAS), false);
});

test('rc.5 shell filtering puts Plugins below More only in the menu, even when selected', () => {
  const view = sidebarView(rows, preference(['chat', MORE_ID, 'plugins', 'files']));
  const shellDirect = view.panels.filter(({id}) => id === 'plugins' || !view.unpinned.includes(id));
  const shellMenu = view.panels.filter(({id}) => id !== 'plugins')
    .map(row => ({...row, pinned: !view.unpinned.includes(row.id), active: row.id === viewPanelId('plugins')}));
  const foldedMenu = shellMenu.filter(row => !row.pinned && row.id !== MORE_ID);
  assert.deepEqual(ids(shellDirect), ['chat']);
  assert.deepEqual(foldedMenu.map(row => realPanelId(row.id)), ['plugins', 'files']);
  assert.equal(foldedMenu[0].active, true);
});

test('new entries after a saved More marker go into its menu without being hidden', () => {
  const view = sidebarView([...rows, {id:'new-plugin',label:'New',order:30}], preference(['chat', 'plugins', 'files', MORE_ID]));
  assert.deepEqual(ids(view.direct), ['chat','plugins','files']);
  assert.deepEqual(ids(view.folded), ['new-plugin']);
});

test('all hidden or absent real rows still leave a More panel and unpinned marker for shell visibility', () => {
  for (const input of [rows, []]) {
    const view = sidebarView(input, preference([MORE_ID, 'chat', 'plugins', 'files'], ['chat', 'plugins', 'files', MORE_ID]));
    assert.deepEqual(view.direct, []);
    assert.deepEqual(view.folded, []);
    assert.deepEqual(ids(view.panels), [MORE_ID]);
    assert.deepEqual(view.unpinned, [MORE_ID]);
  }
});
