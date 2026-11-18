import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalize, arrange, navigationRows, setVisible, move, reorder, rename, OWN_ID, replaceComponent,
  MORE_ID, WORKSPACE_ID, isBoundary, footerId, sidebarRows, splitSidebar} from '../src/model.js';

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
test('normalization rejects malformed data and honors valid legacy hidden preferences', () => {
  const state = normalize({settings:{order:['a','a',null],hidden:[OWN_ID,'a','a',42]}});
  assert.deepEqual(state.settings,{order:['a'],hidden:['a']});
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
test('visibility is immutable, group-local, deduplicated and protects recovery identities', () => {
  const raw = {sidebar: {order: ['b', 'a'], hidden: ['a', 'a', OWN_ID, MORE_ID, WORKSPACE_ID,
    footerId('settings'), 'dsh-sidebar:footer:old', '', '  ', 42], names: {a: 'Alpha'}},
    settings: {hidden: ['b']}, workspace: {dynamicSort: false, pinnedWorkspaceIds: ['workspace']}};
  const state = normalize(raw), before = structuredClone(state);
  assert.deepEqual(state.sidebar.hidden, ['a', footerId('settings')]);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(state))), state);
  for (const group of ['sidebar', 'settings']) {
    const hidden = setVisible(state, group, 'unloaded', false);
    assert.equal(hidden[group].hidden.includes('unloaded'), true);
    assert.deepEqual(setVisible(hidden, group, 'unloaded', false), hidden);
    assert.deepEqual(setVisible(hidden, group, 'unloaded', true), state);
    assert.deepEqual(hidden.workspace, state.workspace);
    assert.deepEqual(hidden[group].order, state[group].order);
    assert.deepEqual(hidden[group].names, state[group].names);
    for (const id of [OWN_ID, MORE_ID, WORKSPACE_ID, '', ' ', null, 1, {}, 'dsh-sidebar:footer:old']) {
      assert.deepEqual(setVisible(state, group, id, false), state);
    }
  }
  for (const group of [undefined, null, 'unknown', '__proto__']) assert.deepEqual(setVisible(state, group, 'a', false), state);
  for (const value of [undefined, null, 0, 1, 'false']) assert.deepEqual(setVisible(state, 'sidebar', 'a', value), state);
  assert.deepEqual(setVisible(normalize({settings: {hidden: ['a']}}), 'settings', 'a', true).settings, {order: []});
  assert.deepEqual(state, before);
});
test('navigation filters hidden rows after ordering and renaming without altering metadata or catalogs', () => {
  const action = () => {};
  const native = [{id: 'a', label: 'A'}, {id: 'b', label: 'B', action}, {id: OWN_ID}, {id: MORE_ID}, {id: WORKSPACE_ID}];
  const preference = {order: ['b', 'a'], hidden: ['a', OWN_ID, MORE_ID, WORKSPACE_ID], names: {b: 'Bee'}};
  const before = structuredClone(preference);
  const result = navigationRows(native, preference);
  assert.deepEqual(result.map(row => row.id), ['b', OWN_ID, MORE_ID, WORKSPACE_ID]);
  assert.equal(result[0].label, 'Bee');
  assert.equal(result[0].action, action);
  assert.equal(arrange(native, preference).length, native.length);
  assert.deepEqual(preference, before);
});
test('default preserves original order', () => {
  assert.deepEqual(arrange(rows,normalize(null).sidebar),rows);
});
test('custom order appends new plugins', () => {
  assert.deepEqual(arrange(rows,{order:['c','a']}).map(x=>x.id),['c','a','b',OWN_ID]);
});
test('management catalog retains hidden rows, while navigation protects the manager', () => {
  assert.deepEqual(arrange(rows,{order:[],hidden:['a',OWN_ID]}),rows);
  assert.deepEqual(navigationRows(rows,{order:[],hidden:['a',OWN_ID]}), rows.slice(1));
});
test('move preserves all rows, names, absent identities and hidden data', () => {
  let state=normalize({sidebar:{order:['a','b','c',OWN_ID,'absent'],hidden:['b'],names:{b:'Bee',absent:'Unloaded'}}});
  state=move(state,'sidebar',rows,'c',-1);
  assert.deepEqual(state.sidebar,{order:['a','c','b',OWN_ID,'absent'],hidden:['b'],names:{b:'Bee',absent:'Unloaded'}});
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

const ids = rows => rows.map(row => row.id);
const footer = {id: footerId('settings'), kind: 'footer', label: 'Settings', order: -100};
const sidebarMenus = [{id: 'a', label: 'A', order: 0}, {id: 'b', label: 'B', order: 10}, footer];
test('sidebar defaults to panels, More, workspaces, then footer actions without folding footer', () => {
  const before = structuredClone(sidebarMenus);
  const live = sidebarRows(sidebarMenus, 'More translated', 'Workspaces translated');
  assert.deepEqual(ids(live), ['a', 'b', MORE_ID, WORKSPACE_ID, footer.id]);
  assert.equal(live[2].label, 'More translated');
  assert.equal(live[3].label, 'Workspaces translated');
  assert.deepEqual(ids(arrange(live, {order: []})), ids(live));
  const result = splitSidebar(sidebarMenus, {order: []});
  assert.deepEqual(ids(result.visible), ['a', 'b', footer.id]);
  assert.deepEqual(result.folded, []);
  assert.deepEqual(ids(result.top), ['a', 'b']);
  assert.deepEqual(ids(result.bottom), [footer.id]);
  assert.equal(result.moreLocation, 'top');
  assert.deepEqual(sidebarMenus, before);
});
test('legacy More order folds trailing panels but leaves new workspace and footer below them', () => {
  const result = splitSidebar(sidebarMenus, {order: ['a', MORE_ID, 'b']});
  assert.deepEqual(ids(result.ordered), ['a', MORE_ID, 'b', WORKSPACE_ID, footer.id]);
  assert.deepEqual(ids(result.visible), ['a', footer.id]);
  assert.deepEqual(ids(result.folded), ['b']);
  assert.deepEqual(ids(result.top), ['a']);
  assert.deepEqual(ids(result.bottom), [footer.id]);
});
test('menus can cross either divider and footer actions fold only when explicitly moved inside More', () => {
  const live = sidebarRows(sidebarMenus);
  let state = normalize(null);
  state = reorder(state, 'sidebar', live, 'b', WORKSPACE_ID, true);
  let result = splitSidebar(sidebarMenus, state.sidebar);
  assert.deepEqual(ids(result.top), ['a']);
  assert.deepEqual(ids(result.bottom), ['b', footer.id]);
  assert.deepEqual(result.folded, []);
  state = reorder(state, 'sidebar', live, footer.id, WORKSPACE_ID);
  result = splitSidebar(sidebarMenus, state.sidebar);
  assert.deepEqual(ids(result.folded), [footer.id]);
  assert.deepEqual(ids(result.visible), ['a', 'b']);
  state = reorder(state, 'sidebar', live, 'b', MORE_ID, true);
  result = splitSidebar(sidebarMenus, state.sidebar);
  assert.deepEqual(ids(result.folded), ['b', footer.id]);
  state = reorder(state, 'sidebar', live, 'b', MORE_ID);
  assert.deepEqual(ids(splitSidebar(sidebarMenus, state.sidebar).top), ['a', 'b']);
});
test('More below workspace leaves earlier bottom menus visible and folds only later menus', () => {
  const result = splitSidebar(sidebarMenus, {order: ['a', WORKSPACE_ID, 'b', MORE_ID, footer.id]});
  assert.deepEqual(ids(result.top), ['a']);
  assert.deepEqual(ids(result.bottom), ['b']);
  assert.deepEqual(ids(result.visible), ['a', 'b']);
  assert.deepEqual(ids(result.folded), [footer.id]);
  assert.equal(result.moreLocation, 'bottom');
  assert.equal(result.moreIndex, 3);
  assert.equal(result.workspaceIndex, 1);
});
test('adjacent, first and last boundaries never fold workspaces or expose sentinels as menus', () => {
  for (const [order, visible, folded, top, bottom] of [
    [[MORE_ID, WORKSPACE_ID, 'a', 'b', footer.id], ['a', 'b', footer.id], [], [], ['a', 'b', footer.id]],
    [[WORKSPACE_ID, MORE_ID, 'a', 'b', footer.id], [], ['a', 'b', footer.id], [], []],
    [[MORE_ID, 'a', 'b', footer.id, WORKSPACE_ID], [], ['a', 'b', footer.id], [], []],
    [['a', WORKSPACE_ID, 'b', footer.id, MORE_ID], ['a', 'b', footer.id], [], ['a'], ['b', footer.id]],
  ]) {
    const result = splitSidebar(sidebarMenus, {order});
    assert.deepEqual(ids(result.visible), visible);
    assert.deepEqual(ids(result.folded), folded);
    assert.deepEqual(ids(result.top), top);
    assert.deepEqual(ids(result.bottom), bottom);
    assert.equal(result.ordered.filter(row => row.id === WORKSPACE_ID).length, 1);
  }
  const empty = splitSidebar([], {order: [WORKSPACE_ID, MORE_ID]});
  assert.deepEqual(empty.visible, []);
  assert.deepEqual(empty.folded, []);
  assert.deepEqual(empty.top, []);
  assert.deepEqual(empty.bottom, []);
});
test('sidebarRows replaces existing boundaries once and preserves multiple footer action order', () => {
  const second = {id: footerId('other'), kind: 'footer', order: -200};
  const live = sidebarRows([footer, {id: MORE_ID}, {id: 'a'}, {id: WORKSPACE_ID}, second, {id: MORE_ID}]);
  assert.deepEqual(ids(arrange(live, {order: []})), ['a', MORE_ID, WORKSPACE_ID, footer.id, second.id]);
  assert.equal(live.find(row => row.id === MORE_ID).label, 'More');
  assert.equal(live.find(row => row.id === WORKSPACE_ID).label, 'Workspaces');
});
test('both boundaries are reserved, movable sidebar-only identities; old footer preferences remain ignored', () => {
  const oldFooter = 'dsh-sidebar:footer:settings';
  assert.equal(footer.id, 'dsh-sidebar:action:settings');
  for (const id of [MORE_ID, WORKSPACE_ID]) assert.equal(isBoundary(id), true);
  for (const id of [undefined, null, 'a', footer.id, oldFooter]) assert.equal(isBoundary(id), false);
  const raw = {order: [MORE_ID, WORKSPACE_ID, footer.id, oldFooter, 'a', MORE_ID],
    names: {[MORE_ID]: 'No', [WORKSPACE_ID]: 'No', [footer.id]: 'Options', [oldFooter]: 'Old', a: 'A'}};
  const state = normalize({sidebar: raw, settings: raw});
  assert.deepEqual(state.sidebar, {order: [MORE_ID, WORKSPACE_ID, footer.id, 'a'], names: {[footer.id]: 'Options', a: 'A'}});
  assert.deepEqual(state.settings, {order: [footer.id, 'a'], names: {[footer.id]: 'Options', a: 'A'}});
  for (const id of [MORE_ID, WORKSPACE_ID, oldFooter]) {
    assert.deepEqual(rename(state, 'sidebar', id, 'Changed'), state);
  }
  const live = sidebarRows(sidebarMenus);
  const arranged = arrange(live, raw);
  assert.equal(arranged.find(row => row.id === MORE_ID).label, 'More');
  assert.equal(arranged.find(row => row.id === WORKSPACE_ID).label, 'Workspaces');
  const moved = reorder(normalize(null), 'sidebar', live, WORKSPACE_ID, MORE_ID);
  assert.deepEqual(ids(splitSidebar(sidebarMenus, moved.sidebar).folded), [footer.id]);
  assert.deepEqual(normalize(moved), moved);
});
