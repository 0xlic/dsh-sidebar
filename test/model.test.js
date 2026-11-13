import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalize, arrange, move, reorder, rename, OWN_ID, replaceComponent} from '../src/model.js';

test('navigation adapter preserves child ownership, injection and store', () => {
  const original = () => {}, replacement = () => {};
  const entry = {component: original, children: {'sidebar.brand.mark': {kind:'single',scope:'root'}}, inject: () => ({}), store: {}, locale:'sidebar', options:{priority:0}};
  const before = {...entry};
  const restore = replaceComponent(entry, replacement);
  assert.equal(entry.component, replacement);
  for (const key of ['children','inject','store','locale','options']) assert.equal(entry[key], before[key]);
  restore();
  assert.deepEqual(entry, before);
  restore();
  assert.deepEqual(entry, before);
});
test('adapter cleanup does not overwrite a newer component', () => {
  const entry = {component: () => {}}, later = () => {};
  const restore = replaceComponent(entry, () => {});
  entry.component = later;
  restore();
  assert.equal(entry.component, later);
});
const rows = [{id:'a',order:0},{id:'b',order:10},{id:'c',order:20},{id:OWN_ID,order:50}];
test('normalization rejects malformed data and discards legacy hidden preferences', () => {
  const state = normalize({settings:{order:['a','a',null],hidden:[OWN_ID,'a','a',42]}});
  assert.deepEqual(state.settings,{order:['a']});
  for (const value of [null, undefined, [], 42, {sidebar: {order: 'a', names: []}}]) {
    assert.deepEqual(normalize(value), {sidebar:{order:[]},settings:{order:[]}});
  }
});
test('workspace switches default on and only an explicit false disables them', () => {
  assert.deepEqual(normalize({workspace: {}}).workspace, {
    dynamicSort: true, pinning: true, activeIndicator: true, collapseOneClick: true,
  });
  for (const field of ['dynamicSort', 'pinning', 'activeIndicator', 'collapseOneClick']) {
    for (const value of [false, true, 'false', 0, 1, null, undefined]) {
      const state = normalize({workspace: {[field]: value}});
      assert.equal(state.workspace[field], value !== false, `${field} with ${String(value)}`);
      assert.equal(rename(state, 'sidebar', 'a', 'A').workspace[field], value !== false);
    }
  }
});

test('workspace normalization is opt-in, accepts only plain objects and uses strict booleans', () => {
  const legacy = {sidebar: {order: ['a'], names: {a: 'A'}}, settings: {order: ['b']}};
  assert.deepEqual(normalize(legacy), legacy);
  for (const workspace of [undefined, null, [], true, false, 1, 'true', new Date(), new (class Workspace {})()]) {
    assert.deepEqual(normalize({...legacy, workspace}), legacy);
  }
  for (const dynamicSort of [undefined, null, false, 0, 1, 'true', 'false', [], {}, new Boolean(true)]) {
    assert.deepEqual(normalize({...legacy, workspace: {dynamicSort, pinned: ['a']}}), {...legacy, workspace: {dynamicSort: dynamicSort !== false, pinning: true, activeIndicator: true, collapseOneClick: true}});
  }
  for (const workspace of [{dynamicSort: true, extra: 'discard'}, Object.assign(Object.create(null), {dynamicSort: true})]) {
    const next = normalize({...legacy, workspace});
    assert.deepEqual(next, {...legacy, workspace: {dynamicSort: true, pinning: true, activeIndicator: true, collapseOneClick: true}});
    assert.deepEqual(normalize(next), next);
    assert.notEqual(next.workspace, workspace);
  }
});
test('one-click collapse defaults on and only an explicit false disables it', () => {
  assert.equal(normalize({workspace: {}}).workspace.collapseOneClick, true);
  for (const [value, expected] of [[false, false], [true, true], ['false', true], [0, true], [null, true], [undefined, true]]) {
    assert.equal(normalize({workspace: {collapseOneClick: value}}).workspace.collapseOneClick, expected);
  }
  const state = normalize({workspace: {collapseOneClick: false}});
  assert.equal(rename(state, 'sidebar', 'a', 'A').workspace.collapseOneClick, false);
  assert.equal(move(state, 'sidebar', rows, 'b', -1).workspace.collapseOneClick, false);
});
test('workspace pinning fields remain optional and normalize malformed values and duplicate IDs', () => {
  assert.deepEqual(normalize({workspace: {}}).workspace, {dynamicSort: true, pinning: true, activeIndicator: true, collapseOneClick: true});
  for (const pinning of [undefined, null, false, 0, 1, 'true', 'false', [], {}, new Boolean(true)]) {
    assert.deepEqual(normalize({workspace: {pinning}}).workspace, {dynamicSort: true, pinning: pinning !== false, activeIndicator: true, collapseOneClick: true});
  }
  assert.deepEqual(normalize({workspace: {pinning: true}}).workspace, {dynamicSort: true, pinning: true, activeIndicator: true, collapseOneClick: true});
  for (const pinnedWorkspaceIds of [undefined, null, true, 1, 'a', {}, new Set(['a'])]) {
    assert.deepEqual(normalize({workspace: {pinnedWorkspaceIds}}).workspace, {dynamicSort: true, pinning: true, activeIndicator: true, collapseOneClick: true, pinnedWorkspaceIds: []});
  }
  const workspace = {pinning: false, pinnedWorkspaceIds: ['a', '', null, 'b', 'a', 42, '  ', {}, ['c'], 'b', 'unloaded']};
  const before = structuredClone(workspace), next = normalize({workspace});
  assert.deepEqual(next.workspace, {dynamicSort: true, pinning: false, activeIndicator: true, collapseOneClick: true, pinnedWorkspaceIds: ['a', 'b', 'unloaded']});
  assert.deepEqual(normalize(next), next);
  assert.deepEqual(workspace, before);
  assert.notEqual(next.workspace.pinnedWorkspaceIds, workspace.pinnedWorkspaceIds);
  const nullPrototype = Object.assign(Object.create(null), {pinning: true, pinnedWorkspaceIds: ['a', 'a']});
  assert.deepEqual(normalize({workspace: nullPrototype}).workspace, {dynamicSort: true, pinning: true, activeIndicator: true, collapseOneClick: true, pinnedWorkspaceIds: ['a']});
});
test('rename, move and reorder preserve workspace settings without mutating their input', () => {
  for (const dynamicSort of [false, true]) for (const pinning of [undefined, false, true]) {
    const workspace = {dynamicSort, ...(pinning === undefined ? {} : {pinning, pinnedWorkspaceIds: ['a', 'unloaded']})};
    const state = normalize({workspace}), before = structuredClone(state), expected = {
      dynamicSort: dynamicSort !== false,
      pinning: pinning !== false,
      activeIndicator: true,
      collapseOneClick: true,
      ...(pinning === undefined ? {} : {pinnedWorkspaceIds: ['a', 'unloaded']}),
    };
    for (const group of ['sidebar', 'settings']) {
      for (const next of [
        rename(state, group, 'a', 'A'),
        rename(state, group, 'a', ''),
        move(state, group, rows, 'b', -1),
        move(state, group, rows, 'a', -1),
        reorder(state, group, rows, 'c', 'a'),
        reorder(state, group, rows, 'missing', 'a'),
      ]) assert.deepEqual(next.workspace, expected);
    }
    assert.deepEqual(state, before);
  }
});
test('default preserves original order', () => {
  assert.deepEqual(arrange(rows,normalize(null).sidebar),rows);
});
test('custom order appends new plugins', () => {
  assert.deepEqual(arrange(rows,{order:['c','a']}).map(x=>x.id),['c','a','b',OWN_ID]);
});
test('legacy hidden data cannot hide any actual row, including the manager', () => {
  assert.deepEqual(arrange(rows,{order:[],hidden:['a',OWN_ID]}),rows);
});
test('move preserves all rows, names and absent identities while dropping hidden data', () => {
  let state=normalize({sidebar:{order:['a','b','c',OWN_ID,'absent'],hidden:['b'],names:{b:'Bee',absent:'Unloaded'}}});
  state=move(state,'sidebar',rows,'c',-1);
  assert.deepEqual(state.sidebar,{order:['a','c','b',OWN_ID,'absent'],names:{b:'Bee',absent:'Unloaded'}});
});
test('boundary and missing-row movement are harmless and leave input immutable', () => {
  const state=normalize(null), before=structuredClone(state);
  assert.deepEqual(move(state,'sidebar',rows,'a',-1),state);
  assert.deepEqual(move(state,'sidebar',rows,OWN_ID,1),state);
  assert.deepEqual(move(state,'sidebar',rows,'missing',1),state);
  move(state,'sidebar',rows,'b',-1);
  assert.deepEqual(state,before);
});
test('reorder inserts first at last and last at first without swapping intermediate rows', () => {
  const state = normalize(null);
  assert.deepEqual(reorder(state, 'sidebar', rows, 'a', OWN_ID, true).sidebar.order, ['b', 'c', OWN_ID, 'a']);
  assert.deepEqual(reorder(state, 'sidebar', rows, OWN_ID, 'a').sidebar.order, [OWN_ID, 'a', 'b', 'c']);
});
test('reorder inserts before and after targets using positions after removing the source', () => {
  const state = normalize(null);
  for (const [id, targetId, after, expected] of [
    ['a', 'c', false, ['b', 'a', 'c', OWN_ID]],
    ['a', 'c', true, ['b', 'c', 'a', OWN_ID]],
    [OWN_ID, 'b', false, ['a', OWN_ID, 'b', 'c']],
    [OWN_ID, 'b', true, ['a', 'b', OWN_ID, 'c']],
  ]) {
    assert.deepEqual(reorder(state, 'sidebar', rows, id, targetId, after).sidebar.order, expected);
  }
});
test('reorder uses arranged order and preserves names, unloaded identities and other groups immutably', () => {
  const state = normalize({
    sidebar: {order: ['unloaded-before', 'c', 'a', 'unloaded-after', 'b', OWN_ID], names: {a: 'A renamed', 'unloaded-before': 'Pending'}},
    settings: {order: ['settings-only', 'a'], names: {a: 'Settings A'}},
  });
  const before = structuredClone(state), originalRows = structuredClone(rows);
  const next = reorder(state, 'sidebar', rows, 'b', 'c');
  assert.deepEqual(next.sidebar, {
    order: ['b', 'c', 'a', OWN_ID, 'unloaded-before', 'unloaded-after'],
    names: {a: 'A renamed', 'unloaded-before': 'Pending'},
  });
  assert.deepEqual(next.settings, state.settings);
  assert.deepEqual(state, before);
  assert.deepEqual(rows, originalRows);
  const settingsNext = reorder(state, 'settings', rows, 'c', 'a');
  assert.deepEqual(settingsNext.settings.order, ['c', 'a', 'b', OWN_ID, 'settings-only']);
  assert.deepEqual(settingsNext.sidebar, state.sidebar);
});
test('reorder self, adjacent positions, missing or unloaded IDs and invalid groups are noops', () => {
  const state = normalize({sidebar: {order: ['unloaded'], names: {a: 'A'}}});
  const before = structuredClone(state);
  for (const [group, id, targetId, after] of [
    ['sidebar', 'b', 'b', false],
    ['sidebar', 'b', 'b', true],
    ['sidebar', 'a', 'b', false],
    ['sidebar', 'b', 'a', true],
    ['sidebar', 'missing', 'a', false],
    ['sidebar', 'a', 'missing', false],
    ['sidebar', 'unloaded', 'a', false],
    ['sidebar', 'a', 'unloaded', false],
    ['sidebar', 'a', 'settings-only', false],
    ['unknown', 'a', 'b', true],
  ]) {
    assert.deepEqual(reorder(state, group, rows, id, targetId, after), state);
  }
  assert.deepEqual(reorder(state, 'sidebar', [], 'a', 'b'), state);
  assert.deepEqual(state, before);
});
test('reset restores all builtin navigation', () => {
  assert.deepEqual(arrange(rows,normalize(null).settings),rows);
});
