import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orderRecentWorkspaces, workspacePinMarkerCss, filterWorkspaceSessions, workspaceActivity, workspaceActivityCss,
  workspaceHostOrder, nextWorkspaceMove, createWorkspaceOrderSync} from '../src/workspace.js';
import {setTimeout as wait} from 'node:timers/promises';
test('workspace activity tracks running roots, live status overrides, pending interaction and children, not completion', () => {
  const workspace = {sessionIds: ['a', 'b']};
  const sessions = {byId: {a: {running: true}, b: {}}, projectionsBySession: {b: {values: {subagentCatalog: [{id: 'child'}]}}}};
  assert.equal(workspaceActivity(workspace, sessions), 'ongoing');
  const statuses = new Map([['a', {running: false, completionUnread: true}]]);
  assert.equal(workspaceActivity(workspace, sessions, statuses), null);
  statuses.set('child', {running: true});
  assert.equal(workspaceActivity(workspace, sessions, statuses), 'ongoing');
  for (const kind of ['approval', 'plan-review', 'question']) {
    statuses.set('a', {running: false, pendingInteraction: {kind}});
    assert.equal(workspaceActivity(workspace, sessions, statuses), 'warning');
  }
  assert.equal(workspaceActivity({sessionIds: []}, sessions, statuses), null);
});
test('activity follows workspace membership, archive visibility and native hidden rows', () => {
  for (const session of [{running: false}, {running: true, blank: true}, {running: true, origin: 'subagent'}, undefined])
    assert.equal(workspaceActivity({sessionIds: ['a']}, {byId: {a: session}}), null);
  const sessions = {byId: {a: {running: true}, other: {running: true}}};
  const workspace = {sessionIds: ['a']};
  assert.equal(workspaceActivity(workspace, sessions, null, ['a']), null);
  assert.equal(workspaceActivity(workspace, sessions, null, ['a'], 'show'), 'ongoing');
  assert.equal(workspaceActivity(workspace, sessions, null, ['a'], 'only'), 'ongoing');
  assert.equal(workspaceActivity(workspace, sessions, null, [], 'only'), null);
  assert.equal(workspaceActivity({sessionIds: ['missing']}, sessions), null);
});
test('activity CSS shows only a resting noninteractive marker and safely scopes to workspace rows', () => {
  const css = workspaceActivityCss('x\"</style>');
  assert.ok(!css.includes('</style>'));
  assert.match(css, /\\3c /);
  assert.match(css, /:not\(:hover\):not\(:focus-within\)/);
  assert.match(css, /pointer-events:none/);
  assert.match(css, /width:16px;height:20px/);
  assert.ok(!workspaceActivityCss('a', true).includes('display:inline-flex'));
  assert.equal(workspaceActivityCss(null), '');
});
const view = {groupBy: 'workspace', orderBy: 'updated'};
const snapshot = {phase: 'ready', items: [
  {workspaceId: 'a', sessionIds: ['a1','a2']},
  {workspaceId: 'b', sessionIds: ['b1']},
  {workspaceId: 'empty', sessionIds: []},
], pinnedSessionIds: ['a1'], archivedSessionIds: []};
const list = {byId: {a1:{updatedAt:10},a2:{updatedAt:20},b1:{updatedAt:30}}};
const ids = value => value.items.map(item => item.workspaceId);
test('only pinned filters workspace grouping for either sort, independently of pin controls', () => {
  const before = structuredClone(snapshot);
  for (const orderBy of ['manual', 'updated']) {
    const options = {onlyPinned: true, pinning: false, pinnedWorkspaceIds: ['a', 'missing']};
    const result = orderRecentWorkspaces(snapshot, list, {...view, orderBy}, true, options);
    assert.deepEqual(ids(result), ['a']);
    assert.equal(result.items[0], snapshot.items[0]);
    assert.equal(result.pinnedSessionIds, snapshot.pinnedSessionIds);
    for (const groupBy of ['flat', 'workspace-tree'])
      assert.equal(orderRecentWorkspaces(snapshot, list, {...view, groupBy, orderBy}, true, options), snapshot);
  }
  assert.deepEqual(ids(orderRecentWorkspaces(snapshot, list, view, false, {onlyPinned: true})), []);
  assert.deepEqual(ids(orderRecentWorkspaces(snapshot, list, view, false, {onlyPinned: true, pinnedWorkspaceIds: ['empty']})), ['empty']);
  assert.equal(orderRecentWorkspaces(snapshot, list, view, false, {onlyPinned: false}), snapshot);
  assert.deepEqual(snapshot, before);
});
test('filtered-out workspaces cannot leak sessions into Ungrouped; native sessions stay untouched', () => {
  const sessions = {ids: ['a1', 'a2', 'b1', 'stray'], byId: {...list.byId, stray: {id: 'stray'}}, selected: 'b1'};
  const before = structuredClone(sessions);
  const workspaces = {...snapshot, items: [snapshot.items[0]]};
  const result = filterWorkspaceSessions(sessions, workspaces, true);
  assert.deepEqual(result.ids, ['a1', 'a2']);
  assert.deepEqual(Object.keys(result.byId), ['a1', 'a2']);
  assert.equal(result.byId.a1, sessions.byId.a1);
  assert.equal(result.selected, 'b1');
  assert.deepEqual(sessions, before);
  assert.equal(filterWorkspaceSessions(sessions, workspaces, false), sessions);
  assert.deepEqual(filterWorkspaceSessions(sessions, {items: []}, true).ids, []);
});
test('resting workspace pin uses native geometry, dimensions and color, without pointer interaction', () => {
  const css=workspacePinMarkerCss('ws-a');
  assert.match(css,/workspace\\3a ws-a/);
  assert.match(css,/\[role="treeitem"\]::after/);
  assert.match(css,/width:16px;height:20px;margin-left:6px;pointer-events:none/);
  assert.match(css,/var\(--dsw-alias-label-caption\)/);
  assert.match(css,/14px 14px no-repeat/);
  assert.match(decodeURIComponent(css),/M9\.96976 1\.70572L13\.1554/);
  assert.match(css,/@media\(hover:hover\)/);
  assert.match(css,/:hover::after/);
  assert.match(css,/:focus-within::after/);
  assert.match(css,/@media\(hover:none\)/);
  assert.match(workspacePinMarkerCss('ws-a',true),/content:"";display:none/);
});
test('marker selector safely escapes arbitrary workspace IDs and cannot target session rows or inject styles', () => {
  const css=workspacePinMarkerCss('x"],body{color:red}</style>\\\\a\n');
  assert.ok(!css.includes('</style>'));
  assert.ok(!css.includes('],body'));
  assert.ok(!css.includes('color:red'));
  assert.match(css,/\\22 /);
  assert.match(css,/\\3c /);
  for(const id of ['',null,undefined,42]) assert.equal(workspacePinMarkerCss(id),'');
});
test('workspace pins precede dynamic results and keep native relative order even when empty', () => {
  const pins = {pinning:true,pinnedWorkspaceIds:['empty','a','missing']};
  const result = orderRecentWorkspaces(snapshot,list,view,true,pins);
  assert.deepEqual(ids(result),['a','empty','b']);
  const updated = {byId:{...list.byId,b1:{updatedAt:999}}};
  assert.deepEqual(ids(orderRecentWorkspaces(snapshot,updated,view,true,pins)),['a','empty','b']);
  assert.equal(result.items[0],snapshot.items[0]);
  assert.equal(result.items[1],snapshot.items[2]);
  assert.equal(result.pinnedSessionIds,snapshot.pinnedSessionIds);
  assert.deepEqual(pins.pinnedWorkspaceIds,['empty','a','missing']);
});
test('workspace pins also lead manual order without writing session or native workspace order', () => {
  const before = structuredClone(snapshot), pins={pinning:true,pinnedWorkspaceIds:['b']};
  assert.deepEqual(ids(orderRecentWorkspaces(snapshot,list,{...view,orderBy:'manual'},false,pins)),['b','a','empty']);
  assert.equal(orderRecentWorkspaces(snapshot,list,{...view,groupBy:'flat'},true,pins),snapshot);
  assert.deepEqual(snapshot,before);
  assert.equal(orderRecentWorkspaces(snapshot,list,{...view,orderBy:'manual'},false,{...pins,pinning:false}),snapshot);
});
test('dynamic ranking applies only to the unpinned block, and native session pin toggles never raise workspaces', () => {
  const pins={pinning:true,pinnedWorkspaceIds:['empty']};
  const result=orderRecentWorkspaces(snapshot,list,view,true,pins);
  assert.deepEqual(ids(result),['empty','b','a']);
  const sessionPinned={...snapshot,pinnedSessionIds:['a1','a2']};
  const after=orderRecentWorkspaces(sessionPinned,list,view,true,pins);
  assert.deepEqual(ids(after),ids(result));
  assert.equal(after.pinnedSessionIds,sessionPinned.pinnedSessionIds);
  assert.equal(after.items.find(w=>w.workspaceId==='a').sessionIds,snapshot.items[0].sessionIds);
  const unpinWorkspace=orderRecentWorkspaces(snapshot,list,view,true,{pinning:true,pinnedWorkspaceIds:[]});
  assert.deepEqual(ids(unpinWorkspace),['b','a','empty']);
});
test('dynamic order uses newest member and updates live without mutating registry or sessions', () => {
  const before = structuredClone(snapshot);
  const result = orderRecentWorkspaces(snapshot, list, view, true);
  assert.deepEqual(ids(result), ['b','a','empty']);
  assert.equal(result.items[0], snapshot.items[1]);
  assert.equal(result.pinnedSessionIds, snapshot.pinnedSessionIds);
  assert.deepEqual(snapshot, before);
  const updated = {...list, byId:{...list.byId,a1:{updatedAt:40}}};
  assert.equal(orderRecentWorkspaces(snapshot, updated, view, true), snapshot);
  assert.equal(list.byId.a1.updatedAt, 10);
});
test('disabled, manual, flat and workspace-tree modes preserve native snapshot exactly', () => {
  assert.equal(orderRecentWorkspaces(snapshot,list,view,false),snapshot);
  for(const mode of [{...view,orderBy:'manual'}, {...view,groupBy:'flat'}, {...view,groupBy:'workspace-tree'}])
    assert.equal(orderRecentWorkspaces(snapshot,list,mode,true),snapshot);
});
test('ties, empty workspaces and unknown or invalid timestamps keep native relative order', () => {
  for(const byId of [{}, {a1:{updatedAt:30},b1:{updatedAt:30}}, {a1:{updatedAt:NaN},b1:{updatedAt:'999'}}])
    assert.equal(orderRecentWorkspaces(snapshot,{byId},view,true),snapshot);
});
test('ranking ignores subagents and unretained blanks', () => {
  const sessions = {byId:{a1:{updatedAt:100},a2:{updatedAt:20},b1:{updatedAt:30}}};
  for (const extra of [{origin:'subagent'}, {blank:true}]) {
    assert.deepEqual(ids(orderRecentWorkspaces(snapshot,{byId:{...sessions.byId,a1:{updatedAt:100,...extra}}},view,true)),['b','a','empty']);
  }
});

const native = {...snapshot, state: 'idle'};
const catalog = {...list, phase: 'ready'};

test('a retained new draft does not change display order or the Host sync plan until sent', () => {
  const before = workspaceHostOrder(native, catalog, view, true);
  assert.deepEqual(before.ids, ['b', 'a', 'empty']);
  for (const workspaceId of ['a', 'empty']) {
    const current = {...native, items: native.items.map(row => row.workspaceId === workspaceId
      ? {...row, sessionIds: [...row.sessionIds, 'draft']} : row)};
    const draft = {blank: true, retainedBy: {mainView: 1}, updatedAt: 50};
    const unsent = {...catalog, byId: {...catalog.byId, draft}};
    assert.deepEqual(ids(orderRecentWorkspaces(current, unsent, view, true)), before.ids);
    assert.deepEqual(workspaceHostOrder(current, unsent, view, true), before);

    const sent = {...catalog, byId: {...catalog.byId, draft: {...draft, blank: false, updatedAt: 60}}};
    const expected = [workspaceId, ...before.ids.filter(id => id !== workspaceId)];
    const plan = workspaceHostOrder(current, sent, view, true);
    assert.deepEqual(ids(orderRecentWorkspaces(current, sent, view, true)), expected);
    assert.deepEqual(plan.ids, expected);
    assert.notEqual(plan.key, before.key);
  }
});

test('consecutive archives, unarchive, and archive filters leave display order and Host sync key unchanged', () => {
  const before = workspaceHostOrder(native, catalog, view, true);
  assert.deepEqual(before.ids, ['b', 'a', 'empty']);
  for (const archivedSessionIds of [['b1'], ['b1', 'a2'], ['b1', 'a2', 'a1'], ['a2', 'a1'], []]) {
    const current = {...native, archivedSessionIds};
    for (const archivedFilter of ['default', 'show', 'only']) {
      const currentView = {...view, archivedFilter};
      assert.deepEqual(ids(orderRecentWorkspaces(current, catalog, currentView, true)), before.ids);
      assert.deepEqual(workspaceHostOrder(current, catalog, currentView, true), before);
    }
  }
});

test('new or updated sessions still reorder the workspaces after archival', () => {
  const current = {...native, archivedSessionIds: ['b1']};
  const before = workspaceHostOrder(current, catalog, view, true);
  const updated = {...catalog, byId: {...catalog.byId, a2: {updatedAt: 40}}};
  const withNew = {...current, items: current.items.map(row => row.workspaceId === 'empty' ? {...row, sessionIds: ['new']} : row)};
  const newCatalog = {...catalog, byId: {...catalog.byId, new: {updatedAt: 50}}};
  for (const [snapshot, sessions, expected] of [[current, updated, ['a', 'b', 'empty']], [withNew, newCatalog, ['empty', 'b', 'a']]]) {
    const plan = workspaceHostOrder(snapshot, sessions, view, true);
    assert.deepEqual(plan.ids, expected);
    assert.deepEqual(ids(orderRecentWorkspaces(snapshot, sessions, view, true)), expected);
    assert.notEqual(plan.key, before.key);
  }
});

test('Host sync ranks the full registry: pins first, then recency, regardless of only-pinned display', () => {
  const pins = {pinning: true, pinnedWorkspaceIds: ['empty'], onlyPinned: true};
  const plan = workspaceHostOrder(native, catalog, view, true, pins);
  assert.deepEqual(plan.ids, ['empty', 'b', 'a']);
  assert.deepEqual(ids(orderRecentWorkspaces(native, catalog, view, true, pins)), ['empty']);
  assert.deepEqual(nextWorkspaceMove(native.items, plan.ids), ['empty', 'a']);
  assert.equal(workspaceHostOrder({...native, state: 'loading'}, catalog, view, true, pins), null);
  assert.equal(workspaceHostOrder(native, {...catalog, phase: 'pending'}, view, true, pins), null);
  assert.equal(workspaceHostOrder(native, catalog, {...view, groupBy: 'flat'}, true, pins), null);
  const manual = {...view, orderBy: 'manual'};
  assert.deepEqual(workspaceHostOrder(native, catalog, manual, false, pins).ids, ['empty', 'a', 'b']);
  assert.equal(workspaceHostOrder(native, catalog, manual, false, {...pins, pinnedWorkspaceIds: []}), null);
});

test('registry echoes and external manual moves do not schedule the same priority rule again', () => {
  const pins = {pinning: true, pinnedWorkspaceIds: ['a', 'empty']};
  const first = workspaceHostOrder(native, catalog, view, true, pins);
  const external = {...native, items: [native.items[1], native.items[2], native.items[0]]};
  const same = workspaceHostOrder(external, catalog, view, true, pins);
  assert.equal(first.key, same.key);
  assert.deepEqual(same.ids, ['empty', 'a', 'b'], 'tied rows follow current native order');
  assert.notEqual(workspaceHostOrder(external, catalog, view, true, {...pins, pinnedWorkspaceIds: ['empty']}).key, same.key);
  const updated = {...catalog, byId: {...catalog.byId, a1: {updatedAt: 100}}};
  assert.notEqual(workspaceHostOrder(native, updated, view, true).key, workspaceHostOrder(native, catalog, view, true).key);
});

test('sync coalesces priorities, serializes native moves, and replans when the target changes mid-write', async t => {
  let items = native.items.slice(), target = ['empty', 'b', 'a'];
  let started, release, done;
  const first = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const completed = new Promise(resolve => { done = resolve; });
  const calls = [], errors = [];
  const sync = createWorkspaceOrderSync({delay: 0,
    readMove: () => nextWorkspaceMove(items, target),
    onError: error => errors.push(error),
    async move(id, anchor) {
      calls.push([id, anchor]);
      if (calls.length === 1) { started(); await gate; }
      const moved = items.find(row => row.workspaceId === id);
      items = items.filter(row => row !== moved);
      items.splice(items.findIndex(row => row.workspaceId === anchor), 0, moved);
      if (calls.length === 2) done();
    },
  });
  t.after(() => sync.dispose());
  sync.update('superseded');
  sync.update('initial');
  await first;
  target = ['b', 'empty', 'a'];
  sync.update('new ranking');
  assert.deepEqual(calls, [['empty', 'a']]);
  release();
  await completed;
  sync.update('new ranking');
  await wait(5);
  assert.deepEqual(calls, [['empty', 'a'], ['b', 'empty']]);
  assert.deepEqual(items.map(row => row.workspaceId), target);
  assert.deepEqual(errors, []);
});

test('sync reports failure once for a ranking and cancels work when disabled or disposed', async t => {
  let moves = 0, errors = 0;
  let failed;
  const failure = new Promise(resolve => { failed = resolve; });
  const sync = createWorkspaceOrderSync({delay: 0, readMove: () => ['b', 'a'],
    move() { moves++; throw new Error('Host rejected move'); },
    onError() { errors++; failed(); },
  });
  t.after(() => sync.dispose());
  sync.update('ranking');
  await failure;
  sync.update('ranking');
  await wait(5);
  assert.deepEqual([moves, errors], [1, 1]);
  sync.update('other');
  sync.update(null);
  await wait(5);
  sync.update('last');
  sync.dispose();
  await wait(5);
  assert.deepEqual([moves, errors], [1, 1]);
});
