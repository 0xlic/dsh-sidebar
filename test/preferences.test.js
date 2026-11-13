import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPreferencesController} from '../src/preferences.js';
import {normalize, rename, arrange, sidebarRows, splitSidebar, reorder, MORE_ID} from '../src/model.js';
import {Config} from '../index.js';

function fakeForm(initial, options = {}) {
  let state = {status: 'ready', writable: true, value: {preferences: initial}, ...options};
  const subscribers = new Set(), writes = [], pending = [];
  function update(patch) { state = {...state, ...patch}; for (const fn of subscribers) fn(); }
  return {
    getSnapshot: () => state,
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    set(field, value) {
      writes.push({field, value: structuredClone(value)});
      return new Promise(resolve => pending.push(accepted => {
        if (accepted) update({value: {...state.value, [field]: value}});
        resolve(accepted);
      }));
    },
    update, writes, settle: accepted => pending.shift()(accepted), subscribers,
  };
}

test('host schema exposes menu order/names and optional workspace sorting as live-editable preferences', () => {
  assert.equal(Config.dict.preferences.meta.volatile, true);
  assert.deepEqual(Object.keys(Config.dict.preferences.dict.sidebar.dict).sort(), ['names', 'order']);
  assert.deepEqual(Object.keys(Config.dict.preferences.dict.settings.dict).sort(), ['names', 'order']);
  const input = {sidebar: {order: ['b', 'a'], names: {b: '自定义菜单'}}, settings: {}};
  const parsed = Config({preferences: input}).preferences.get();
  assert.deepEqual(parsed.sidebar.order, ['b', 'a']);
  assert.equal(Object.hasOwn(parsed.sidebar, 'hidden'), false);
  assert.equal(parsed.sidebar.names.b, '自定义菜单');
  assert.deepEqual(parsed.settings.names, {});
  assert.ok(Config({}).preferences.get() == null);
  assert.equal(Config.dict.preferences.dict.workspace.meta.default, null);
  assert.ok(parsed.workspace == null);
  assert.deepEqual(normalize(parsed), {sidebar: {order: ['b', 'a'], names: {b: '自定义菜单'}}, settings: {order: []}});
});

test('host workspace schema defaults to disabled sorting/pinning and empty IDs and rejects malformed values', () => {
  const defaults = {dynamicSort: false, pinning: false, onlyPinned: false, activeIndicator: false, pinnedWorkspaceIds: []};
  for (const [workspace, expected] of [
    [null, null], [{}, defaults], [{dynamicSort: false}, defaults],
    [{dynamicSort: true}, {...defaults, dynamicSort: true}],
    [{onlyPinned: true}, {...defaults, onlyPinned: true}],
    [{activeIndicator: true}, {...defaults, activeIndicator: true}],
    [{pinning: true, pinnedWorkspaceIds: ['a', 'unloaded']}, {...defaults, pinning: true, pinnedWorkspaceIds: ['a', 'unloaded']}],
    [{pinning: false, pinnedWorkspaceIds: ['a']}, {...defaults, pinnedWorkspaceIds: ['a']}],
  ]) {
    assert.deepEqual(Config({preferences: {workspace}}).preferences.get().workspace, expected);
  }
  for (const field of ['dynamicSort', 'pinning', 'onlyPinned', 'activeIndicator']) for (const value of ['true', 'false', 0, 1, [], {}]) {
    assert.throws(() => Config({preferences: {workspace: {[field]: value}}}).preferences.get(), /expected boolean/);
  }
  for (const pinnedWorkspaceIds of ['a', true, 1, {}, [1], ['a', {}]]) {
    assert.throws(() => Config({preferences: {workspace: {pinnedWorkspaceIds}}}).preferences.get());
  }
});

test('names trim and persist alongside order; clearing restores native labels', () => {
  const rows = [{id: 'a', label: 'Original'}, {id: 'b', label: 'Other'}];
  let prefs = normalize({sidebar: {order: ['b', 'a'], hidden: ['b']}});
  prefs = rename(prefs, 'sidebar', 'a', '  我的菜单  ');
  assert.deepEqual(arrange(rows, prefs.sidebar).map(row => row.label), ['Other', '我的菜单']);
  assert.deepEqual(prefs.sidebar.order, ['b', 'a']);
  assert.equal(Object.hasOwn(prefs.sidebar, 'hidden'), false);
  assert.equal(normalize(JSON.parse(JSON.stringify(prefs))).sidebar.names.a, '我的菜单');
  assert.equal(arrange(rows, rename(prefs, 'sidebar', 'a', '').sidebar)[1].label, 'Original');
  assert.equal(rename(prefs, 'sidebar', 'a', 'x'.repeat(100)).sidebar.names.a.length, 80);
  const invalid = normalize({sidebar: {names: {a: null, b: 4, c: '  ', d: '  Fine '}}});
  assert.deepEqual(invalid.sidebar.names, {d: 'Fine'});
  assert.equal(arrange([{id: 'toString', label: 'Safe'}], normalize(null).sidebar)[0].label, 'Safe');
  const proto = rename(normalize(null), 'sidebar', '__proto__', 'Safe');
  assert.equal(proto.sidebar.names.__proto__, 'Safe');
  assert.equal(Object.getPrototypeOf(proto.sidebar.names), Object.prototype);
});

test('configuration is authoritative and writes include all preferences, then survive reload', async () => {
  const form = fakeForm(normalize(null));
  const source = createPreferencesController(form, {read() { throw Error('Existing config must not read localStorage'); }});
  const next = rename(normalize({workspace: {dynamicSort: true, pinning: false, pinnedWorkspaceIds: ['workspace-a', 'unloaded']}, sidebar: {order: ['devices', MORE_ID, 'a'], names: {a: '菜单'}, hidden: ['a']}}), 'sidebar', 'devices', '设备');
  const task = source.save(next);
  assert.equal(source.getSnapshot().status, 'saving');
  assert.equal(form.writes[0].field, 'preferences');
  assert.deepEqual(form.writes[0].value, next);
  form.settle(true);
  assert.equal(await task, true);
  assert.equal(source.getSnapshot().status, 'saved');
  source.dispose();
  const reloaded = createPreferencesController(form);
  assert.deepEqual(reloaded.getSnapshot().preferences, next);
  reloaded.dispose();
});

test('one-time browser migration clears local data only after the host accepts the config write', async () => {
  const form = fakeForm(undefined);
  const old = {sidebar: {
    order: ['a', 'dsh-sidebar:more', 'b', 'dsh-sidebar:footer:devices', 'unloaded'],
    hidden: ['a', 'b'], names: {a: '我的菜单', unloaded: '未加载', 'dsh-sidebar:more': '更多', 'dsh-sidebar:footer:devices': '设备'},
  }};
  const migrated = normalize(old);
  let cleared = false;
  const source = createPreferencesController(form, {read: () => old, clear: () => { cleared = true; }});
  assert.equal(source.getSnapshot().status, 'saving');
  assert.equal(cleared, false);
  assert.deepEqual(form.writes[0].value, migrated);
  assert.deepEqual(migrated.sidebar, {order: ['a', MORE_ID, 'b', 'unloaded'], names: {a: '我的菜单', unloaded: '未加载'}});
  assert.deepEqual(arrange([{id: 'a'}, {id: 'b'}], migrated.sidebar).map(row => row.id), ['a', 'b']);
  const split = splitSidebar([{id: 'a'}, {id: 'b'}], migrated.sidebar);
  assert.deepEqual(split.visible.map(row => row.id), ['a']);
  assert.deepEqual(split.folded.map(row => row.id), ['b']);
  form.settle(true);
  await Promise.resolve();
  assert.equal(cleared, true);
  assert.equal(source.getSnapshot().status, 'saved');
  assert.deepEqual(source.getSnapshot().preferences, migrated);
  source.dispose();
});

test('host schema and normalization retain only the sidebar ordering boundary', () => {
  const parsed = Config({preferences: {
    sidebar: {order: ['a', MORE_ID, 'plugins'], names: {[MORE_ID]: '更多', plugins: '扩展'}},
    settings: {order: ['models', MORE_ID, 'dsh-sidebar'], names: {[MORE_ID]: 'More', models: '模型'}},
  }}).preferences.get();
  assert.deepEqual(parsed.sidebar.order, ['a', MORE_ID, 'plugins']);
  const restored = normalize(JSON.parse(JSON.stringify(parsed)));
  assert.deepEqual(restored.sidebar, {order: ['a', MORE_ID, 'plugins'], names: {plugins: '扩展'}});
  assert.deepEqual(restored.settings, {order: ['models', 'dsh-sidebar'], names: {models: '模型'}});
});

test('moving a boundary across native plugin entries persists to a fresh controller and host roundtrip', async () => {
  const rows = [{id: 'chat', label: 'Chat'}, {id: 'plugins', label: 'Plugins'}, {id: 'devices', label: 'Devices'}];
  const initial = normalize({sidebar: {order: ['chat', 'plugins', 'devices', MORE_ID, 'unloaded'], names: {plugins: '扩展'}}});
  const form = fakeForm(initial);
  const source = createPreferencesController(form);
  const next = reorder(initial, 'sidebar', sidebarRows(rows), MORE_ID, 'plugins');
  const saved = source.save(next);
  assert.deepEqual(form.writes[0].value.sidebar.order, ['chat', MORE_ID, 'plugins', 'devices', 'unloaded']);
  assert.deepEqual(splitSidebar(rows, source.getSnapshot().preferences.sidebar).folded.map(row => row.id), ['plugins', 'devices']);
  form.settle(true);
  assert.equal(await saved, true);
  source.dispose();

  // Simulate process restart: serialize, pass through host schema, then create a new form/controller.
  const persisted = Config({preferences: JSON.parse(JSON.stringify(form.getSnapshot().value.preferences))}).preferences.get();
  const restarted = createPreferencesController(fakeForm(persisted));
  const preference = restarted.getSnapshot().preferences.sidebar;
  assert.deepEqual(preference, next.sidebar);
  const {visible, folded} = splitSidebar([...rows, {id: 'new-plugin', label: 'New'}], preference);
  assert.deepEqual(visible.map(row => row.id), ['chat']);
  assert.deepEqual(folded.map(row => row.id), ['plugins', 'devices', 'new-plugin']);
  assert.equal(folded[0].label, '扩展');
  assert.equal(folded[1], rows[2]);
  assert.equal(restarted.getSnapshot().preferences.settings.order.includes(MORE_ID), false);
  restarted.dispose();
});

test('rejected boundary movement restores the durable partition rather than the optimistic fold state', async () => {
  const rows = [{id: 'chat'}, {id: 'plugins'}];
  const initial = normalize({sidebar: {order: ['chat', 'plugins', MORE_ID]}});
  const form = fakeForm(initial), source = createPreferencesController(form);
  const next = reorder(initial, 'sidebar', sidebarRows(rows), MORE_ID, 'chat');
  const saved = source.save(next);
  assert.deepEqual(splitSidebar(rows, source.getSnapshot().preferences.sidebar).visible, []);
  form.settle(false);
  assert.equal(await saved, false);
  assert.deepEqual(source.getSnapshot().preferences, initial);
  assert.deepEqual(splitSidebar(rows, source.getSnapshot().preferences.sidebar).folded, []);
  source.dispose();
});

test('failed migration preserves the old data and does not claim successful persistence', async () => {
  const form = fakeForm(undefined);
  let cleared = false;
  const source = createPreferencesController(form, {read: () => ({sidebar: {hidden: ['a']}}), clear: () => { cleared = true; }});
  form.settle(false);
  await Promise.resolve();
  assert.equal(source.getSnapshot().status, 'error');
  assert.equal(cleared, false);
  assert.deepEqual(source.getSnapshot().preferences, normalize(null));
  source.dispose();
});

test('write failure rolls back to server config, including synchronous transport errors', async () => {
  const original = normalize({sidebar: {order: ['b', 'a'], names: {a: 'Original'}, hidden: ['a']}});
  const form = fakeForm(original);
  const source = createPreferencesController(form);
  const task = source.save(rename(original, 'sidebar', 'a', 'New'));
  form.settle(false);
  assert.equal(await task, false);
  assert.deepEqual(source.getSnapshot().preferences, original);
  assert.equal(source.getSnapshot().status, 'error');
  form.set = () => { throw Error('offline'); };
  assert.equal(await source.save(normalize(null)), false);
  assert.equal(source.getSnapshot().status, 'error');
  source.dispose();
});

test('workspace switches and pinned IDs roll back on failure and survive rapid writes with menu edits', async () => {
  const initial = normalize({sidebar:{order:['a']}, workspace:{dynamicSort:false, pinning:false, onlyPinned:false, pinnedWorkspaceIds:['existing']}});
  const form = fakeForm(initial), source = createPreferencesController(form);
  const on = normalize({...initial,workspace:{dynamicSort:true, pinning:true, onlyPinned:true, pinnedWorkspaceIds:['existing', 'unloaded']}});
  const failed = source.save(on);
  assert.deepEqual(source.getSnapshot().preferences.workspace,on.workspace);
  form.settle(false); assert.equal(await failed,false);
  assert.deepEqual(source.getSnapshot().preferences.workspace,initial.workspace);
  assert.equal(source.getSnapshot().status,'error');
  const off = normalize({...on, workspace: {...on.workspace, pinning:false}});
  const first = source.save(on), second = source.save(rename(off,'sidebar','a','Renamed'));
  assert.deepEqual(form.writes[2].value.workspace,off.workspace);
  form.settle(true); await first;
  assert.deepEqual(source.getSnapshot().preferences.workspace,off.workspace);
  assert.equal(source.getSnapshot().status,'saving');
  form.settle(true); await second;
  assert.deepEqual(source.getSnapshot().preferences.workspace,off.workspace);
  assert.equal(source.getSnapshot().preferences.sidebar.names.a,'Renamed');
  source.dispose();
  const reloaded = createPreferencesController(form);
  assert.deepEqual(reloaded.getSnapshot().preferences.workspace,off.workspace);
  assert.equal(reloaded.getSnapshot().preferences.sidebar.names.a,'Renamed');
  reloaded.dispose();
});

test('rapid edits preserve latest optimistic state until the last settlement', async () => {
  const form = fakeForm(normalize(null));
  const source = createPreferencesController(form);
  const first = rename(normalize(null), 'sidebar', 'a', 'First');
  const second = rename(first, 'sidebar', 'a', 'Second');
  const one = source.save(first), two = source.save(second);
  form.settle(true);
  await one;
  assert.equal(source.getSnapshot().preferences.sidebar.names.a, 'Second');
  assert.equal(source.getSnapshot().status, 'saving');
  form.settle(true);
  await two;
  assert.equal(source.getSnapshot().preferences.sidebar.names.a, 'Second');
  assert.equal(source.getSnapshot().status, 'saved');
  source.dispose();
});

test('latest transport failure refreshes a superseded successful write before rollback', async () => {
  const first = rename(normalize({workspace: {dynamicSort: true, pinning: true, pinnedWorkspaceIds: ['a', 'unloaded']}}), 'sidebar', 'a', 'A');
  const second = rename({...first, workspace: {...first.workspace, pinning: false, pinnedWorkspaceIds: ['b']}}, 'sidebar', 'a', 'B');
  let held = normalize(null), durable = held, sequence = 0, tail = Promise.resolve();
  const subscribers = new Set();
  const form = {
    getSnapshot: () => ({status: 'ready', writable: true, value: {preferences: held}}),
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    set(_, value) {
      const call = ++sequence;
      const task = tail.then(() => {
        if (call === 2) throw Error('transport rejected');
        durable = value;
        // Real configForms does not fold superseded successful writes.
        return true;
      });
      tail = task.catch(() => {});
      return task;
    },
  };
  const source = createPreferencesController(form, {recover: async () => {
    held = durable;
    for (const fn of subscribers) fn();
    return true;
  }});
  const one = source.save(first), two = source.save(second);
  assert.deepEqual(await Promise.all([one, two]), [true, false]);
  assert.equal(source.getSnapshot().preferences.sidebar.names.a, 'A');
  assert.deepEqual(source.getSnapshot().preferences.workspace, first.workspace);
  assert.equal(source.getSnapshot().status, 'error');
  source.dispose();
});

test('failed recovery reports uncertainty rather than claiming server state was refreshed', async () => {
  const form = fakeForm(normalize(null));
  form.set = async () => { throw Error('offline'); };
  const source = createPreferencesController(form, {recover: async () => false});
  assert.equal(await source.save(rename(normalize(null), 'sidebar', 'a', 'New')), false);
  assert.equal(source.getSnapshot().status, 'offline');
  source.dispose();
});

test('read-only/unavailable config blocks writes; mirrored external edits update navigation', async () => {
  const form = fakeForm(normalize(null), {status: 'loading', writable: false});
  const source = createPreferencesController(form);
  assert.equal(source.getSnapshot().status, 'loading');
  assert.equal(await source.save(normalize(null)), false);
  form.update({status: 'unavailable'});
  assert.equal(source.getSnapshot().status, 'unavailable');
  form.update({status: 'ready'});
  assert.equal(source.getSnapshot().status, 'readonly');
  assert.equal(await source.save(normalize(null)), false);
  const external = rename(normalize(null), 'settings', 'models', '模型配置');
  form.update({writable: true, value: {preferences: external}});
  assert.deepEqual(source.getSnapshot().preferences, external);
  assert.equal(source.getSnapshot().status, 'saved');
  source.dispose();
  assert.equal(form.subscribers.size, 0);
});
