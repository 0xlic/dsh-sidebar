import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/model.js';
const {normalize, arrange, navigationRows, setVisible, move, reorder, rename, sidebarRows, splitSidebar, OWN_ID, MORE_ID, WORKSPACE_ID} = model;

const ids = rows => rows.map(row => row.id);
const rows = [
  {id: 'chat', label: 'Chat', order: 0, icon: 'chat-icon'},
  {id: 'plugins', label: 'Plugins', order: 10, icon: 'plugins-icon'},
  {id: 'files', label: 'Files', order: 20, icon: 'files-icon'},
];
const marker = 'dsh-sidebar:more';
const footer = 'dsh-sidebar:footer:devices';
const roundtrip = value => normalize(JSON.parse(JSON.stringify(value)));
const partition = (native, preference) => {
  const {visible, folded} = splitSidebar(native, preference);
  return {visible: ids(visible), folded: ids(folded)};
};

test('model exports ordering, renaming, sidebar boundary and component adaptation', () => {
  assert.deepEqual(Object.keys(model).sort(), [
    'OWN_ID', 'MORE_ID', 'WORKSPACE_ID', 'GROUPS', 'isBoundary', 'footerId', 'menuLabel', 'rename', 'replaceComponent', 'normalize', 'arrange', 'navigationRows', 'setVisible', 'move', 'reorder', 'sidebarRows', 'splitSidebar',
  ].sort());
  assert.equal(MORE_ID, marker);
});

test('legacy config retains sidebar boundary and valid hidden state but removes obsolete footer and boundary names', () => {
  const raw = {
    sidebar: {
      order: ['files', marker, 'plugins', footer, 'chat', marker, 'unloaded'],
      hidden: ['chat', 'plugins', 'files', OWN_ID],
      names: {[marker]: 'More', [footer]: 'Devices', plugins: '扩展', unloaded: '稍后加载'},
    },
    settings: {order: [marker, OWN_ID, footer, 'models'], hidden: ['models'], names: {models: '模型', [marker]: '更多', [footer]: '旧投影'}},
  };
  const before = structuredClone(raw);
  const state = roundtrip(raw);
  assert.deepEqual(state.sidebar, {order: ['files', marker, 'plugins', 'chat', 'unloaded'], hidden: ['chat', 'plugins', 'files'], names: {plugins: '扩展', unloaded: '稍后加载'}});
  assert.deepEqual(state.settings, {order: [OWN_ID, 'models'], hidden: ['models'], names: {models: '模型'}});
  assert.deepEqual(ids(arrange(rows, state.sidebar)), ['files', 'plugins', 'chat']);
  assert.equal(arrange(rows, state.sidebar)[1].label, '扩展');
  assert.deepEqual(partition(rows, state.sidebar), {visible: [], folded: []});
  assert.deepEqual(raw, before);
  assert.deepEqual(roundtrip(state), state);
});

test('only the sorting catalog appends localized More and workspace boundaries by default', () => {
  const before = structuredClone(rows);
  const catalog = sidebarRows(rows);
  assert.deepEqual(ids(catalog), ['chat', 'plugins', 'files', marker, WORKSPACE_ID]);
  assert.equal(catalog.at(-2).label, 'More');
  assert.equal(catalog.at(-1).label, 'Workspaces');
  assert.equal(catalog.at(-2).order, Infinity);
  assert.equal(catalog.at(-1).order, Infinity);
  rows.forEach((row, index) => assert.equal(catalog[index], row));
  const localized = sidebarRows(rows, '更多', '工作区');
  assert.equal(localized.at(-2).label, '更多');
  assert.equal(localized.at(-1).label, '工作区');
  assert.deepEqual(ids(sidebarRows([...catalog, {id: marker, label: 'Duplicate'}])), ids(catalog));
  assert.deepEqual(rows, before);
  const preference = normalize(null).sidebar;
  assert.deepEqual(ids(arrange(rows, preference)), ids(rows));
  assert.deepEqual(partition(rows, preference), {visible: ids(rows), folded: []});
});

test('boundary at the first, middle and last positions partitions all native rows exactly once', () => {
  for (const [order, visible, folded] of [
    [[marker, 'chat', 'plugins', 'files'], [], ['chat', 'plugins', 'files']],
    [['files', marker, 'plugins', 'chat'], ['files'], ['plugins', 'chat']],
    [['files', 'plugins', 'chat', marker], ['files', 'plugins', 'chat'], []],
  ]) {
    const preference = normalize({sidebar: {order}}).sidebar;
    assert.deepEqual(partition(rows, preference), {visible, folded});
    assert.deepEqual(new Set([...visible, ...folded]), new Set(ids(rows)));
    assert.equal(arrange(rows, preference).some(row => row.id === marker), false);
  }
});

test('empty lists retain a sortable boundary without rendering it as a menu', () => {
  for (const order of [[], [marker], ['unloaded', marker]]) {
    const preference = normalize({sidebar: {order}}).sidebar;
    assert.deepEqual(arrange([], preference), []);
    assert.deepEqual(ids(sidebarRows([])), [marker, WORKSPACE_ID]);
    assert.deepEqual(partition([], preference), {visible: [], folded: []});
  }
});

test('newly registered entries follow an explicit saved boundary but precede an unsaved default boundary', () => {
  const native = [...rows, {id: 'new-plugin', label: 'New', order: 30}];
  assert.deepEqual(partition(native, normalize(null).sidebar), {visible: ids(native), folded: []});
  assert.deepEqual(partition(native, normalize({sidebar: {order: ['chat', 'plugins', 'files', marker]}}).sidebar), {
    visible: ids(rows), folded: ['new-plugin'],
  });
  const saved = roundtrip({sidebar: {order: ['chat', marker, 'unloaded']}});
  assert.deepEqual(partition([...native, {id: 'unloaded', label: 'Loaded', order: -10}], saved.sidebar), {
    visible: ['chat'], folded: ['unloaded', 'plugins', 'files', 'new-plugin'],
  });
});

test('moving real entries across the boundary persists the partition and unloaded identities after restart', () => {
  const state = normalize({sidebar: {order: ['chat', marker, 'plugins', footer, 'files', 'unloaded'], names: {plugins: '扩展'}}});
  const before = structuredClone(state);
  const catalog = sidebarRows(rows);
  const expanded = roundtrip(move(state, 'sidebar', catalog, 'plugins', -1));
  assert.deepEqual(expanded.sidebar, {order: ['chat', 'plugins', marker, 'files', WORKSPACE_ID, 'unloaded'], names: {plugins: '扩展'}});
  assert.deepEqual(partition(rows, expanded.sidebar), {visible: ['chat', 'plugins'], folded: ['files']});
  const folded = roundtrip(reorder(expanded, 'sidebar', catalog, 'chat', marker, true));
  assert.deepEqual(folded.sidebar.order, ['plugins', marker, 'chat', 'files', WORKSPACE_ID, 'unloaded']);
  assert.deepEqual(partition(rows, folded.sidebar), {visible: ['plugins'], folded: ['chat', 'files']});
  assert.equal(splitSidebar(rows, folded.sidebar).visible[0].label, '扩展');
  assert.deepEqual(state, before);
});

test('the boundary itself supports arrow moves and drag reorder to both ends', () => {
  const catalog = sidebarRows(rows);
  const initial = normalize(null);
  const moved = move(initial, 'sidebar', catalog, marker, -1);
  assert.deepEqual(partition(rows, moved.sidebar), {visible: ['chat', 'plugins'], folded: ['files']});
  const first = roundtrip(reorder(moved, 'sidebar', catalog, marker, 'chat'));
  assert.deepEqual(first.sidebar.order, [marker, 'chat', 'plugins', 'files', WORKSPACE_ID]);
  assert.deepEqual(partition(rows, first.sidebar), {visible: [], folded: ids(rows)});
  assert.deepEqual(move(first, 'sidebar', catalog, marker, -1), first);
  const last = roundtrip(reorder(first, 'sidebar', catalog, marker, 'files', true));
  assert.deepEqual(last.sidebar.order, ['chat', 'plugins', 'files', marker, WORKSPACE_ID]);
  assert.deepEqual(partition(rows, last.sidebar), {visible: ids(rows), folded: []});
  const belowWorkspace = move(last, 'sidebar', catalog, marker, 1);
  assert.deepEqual(belowWorkspace.sidebar.order, ['chat', 'plugins', 'files', WORKSPACE_ID, marker]);
  assert.equal(splitSidebar(rows, belowWorkspace.sidebar).moreLocation, 'bottom');
  assert.deepEqual(move(belowWorkspace, 'sidebar', catalog, marker, 1), belowWorkspace);
  assert.deepEqual(initial, normalize(null));
});

test('folded native IDs, plugin entries, pin state, metadata and actions survive ordering and renaming', () => {
  const action = () => {};
  const metadata = {owner: 'native'};
  const native = [...rows, {id: 'devices', label: 'Devices', order: 30, pinned: false, active: true, action, metadata}];
  const state = rename(normalize({sidebar: {order: ['chat', marker, 'devices', 'plugins', 'files']}}), 'sidebar', 'devices', '设备');
  const before = [...native];
  const {visible, folded} = splitSidebar(native, state.sidebar);
  assert.deepEqual(ids(visible), ['chat']);
  assert.deepEqual(ids(folded), ['devices', 'plugins', 'files']);
  assert.deepEqual(folded[0], {...native[3], label: '设备'});
  assert.equal(folded[0].action, action);
  assert.equal(folded[0].metadata, metadata);
  assert.equal(folded[1], rows[1]);
  assert.equal(folded[1].id, 'plugins');
  assert.equal(folded.some(row => row.id === 'dsh-sidebar:panel:plugins'), false);
  assert.deepEqual(ids(arrange(native, state.sidebar)), ['chat', 'devices', 'plugins', 'files']);
  assert.deepEqual(native, before);
  assert.equal(native[3].label, 'Devices');
});

test('arrange never filters actual rows or implicitly adds the sorting boundary', () => {
  const actual = [...rows, {id: marker, label: 'Native More'}, {id: footer, label: 'Native extension'}];
  const result = arrange(actual, {order: [], hidden: ids(actual)});
  assert.equal(result.length, actual.length);
  for (const row of actual) assert.equal(result.find(item => item.id === row.id), row);
});

test('hidden rows never appear in top, bottom or More, but remain manageable and recoverable', () => {
  const actionId = model.footerId('settings');
  const native = [...rows, {id: OWN_ID}, {id: actionId, kind: 'footer'}];
  const preference = {order: ['chat', marker, 'plugins', OWN_ID, WORKSPACE_ID, 'files', actionId],
    hidden: ['chat', 'plugins', 'files', actionId, OWN_ID, marker, WORKSPACE_ID]};
  const result = splitSidebar(native, preference);
  assert.deepEqual(ids(result.visible), []);
  assert.deepEqual(ids(result.top), []);
  assert.deepEqual(ids(result.bottom), []);
  assert.deepEqual(ids(result.folded), [OWN_ID]);
  assert.deepEqual(ids(result.ordered), preference.order);
  assert.deepEqual(ids(navigationRows(native, preference)), [OWN_ID]);
  const allHidden = splitSidebar(rows, {order: [marker, ...ids(rows)], hidden: ids(rows)});
  assert.deepEqual(allHidden.folded, []);
  assert.deepEqual(allHidden.visible, []);
  assert.equal(allHidden.ordered.length, rows.length + 2);
  const restored = setVisible(normalize({sidebar: preference}), 'sidebar', 'plugins', true);
  assert.deepEqual(ids(splitSidebar(native, restored.sidebar).folded), ['plugins', OWN_ID]);
});

test('native pin/unpin metadata is independent of the persisted More boundary', () => {
  const native = rows.map((row, i) => ({...row, pinned: i !== 2}));
  const preference = normalize({sidebar: {order: ['files', marker, 'plugins', 'chat']}}).sidebar;
  const result = arrange(native, preference);
  assert.deepEqual(ids(result.filter(row => row.pinned)), ['plugins', 'chat']);
  assert.deepEqual(ids(result.filter(row => !row.pinned)), ['files']);
  assert.deepEqual(partition(native, preference), {visible: ['files'], folded: ['plugins', 'chat']});
  native[0] = {...native[0], pinned: false};
  const updated = arrange(native, preference);
  assert.deepEqual(ids(updated.filter(row => !row.pinned)), ['files', 'chat']);
  assert.deepEqual(partition(native, preference), {visible: ['files'], folded: ['plugins', 'chat']});
  assert.deepEqual(preference, {order: ['files', marker, 'plugins', 'chat']});
});

test('renaming cannot name the boundary or resurrect obsolete footer identities in either group', () => {
  const initial = normalize({sidebar: {order: ['chat', marker, 'plugins']}});
  for (const group of ['sidebar', 'settings']) {
    for (const id of [marker, WORKSPACE_ID, footer, 'dsh-sidebar:footer:']) {
      assert.deepEqual(rename(initial, group, id, 'Old'), initial);
    }
  }
});

test('settings normalization never retains a boundary or a boundary name', () => {
  const state = roundtrip({settings: {order: ['models', marker, WORKSPACE_ID, OWN_ID, marker], names: {[marker]: '更多', [WORKSPACE_ID]: '工作区', models: '模型'}}});
  assert.deepEqual(state.settings, {order: ['models', OWN_ID], names: {models: '模型'}});
  assert.deepEqual(ids(arrange([{id: OWN_ID}, {id: 'models'}], state.settings)), ['models', OWN_ID]);
});
