import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPreferencesController} from '../src/preferences.js';
import {normalize, rename, arrange, MORE_ID, footerViewId, isMenuEntry} from '../src/model.js';
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

test('host schema exposes preferences as a live-editable field with order, hidden and names', () => {
  assert.equal(Config.dict.preferences.meta.volatile, true);
  const input = {sidebar: {order: ['b', MORE_ID, 'a'], hidden: ['a'], names: {b: '自定义菜单'}}, settings: {}};
  const parsed = Config({preferences: input}).preferences.get();
  assert.deepEqual(parsed.sidebar.order, ['b', MORE_ID, 'a']);
  assert.deepEqual(parsed.sidebar.hidden, ['a']);
  assert.equal(parsed.sidebar.names.b, '自定义菜单');
  assert.deepEqual(parsed.settings.names, {});
  assert.ok(Config({}).preferences.get() == null);
});

test('names trim and persist alongside order and hidden; clearing restores native labels', () => {
  const rows = [{id: 'a', label: 'Original'}, {id: 'b', label: 'Other'}];
  let prefs = normalize({sidebar: {order: ['b', 'a'], hidden: ['b']}});
  prefs = rename(prefs, 'sidebar', 'a', '  我的菜单  ');
  assert.equal(arrange(rows, prefs.sidebar)[0].label, '我的菜单');
  assert.deepEqual(prefs.sidebar.order, ['b', 'a']);
  assert.deepEqual(prefs.sidebar.hidden, ['b']);
  assert.equal(normalize(JSON.parse(JSON.stringify(prefs))).sidebar.names.a, '我的菜单');
  assert.equal(arrange(rows, rename(prefs, 'sidebar', 'a', '').sidebar)[0].label, 'Original');
  assert.equal(rename(prefs, 'sidebar', 'a', 'x'.repeat(100)).sidebar.names.a.length, 80);
  const invalid = normalize({sidebar: {names: {a: null, b: 4, c: '  ', d: '  Fine '}}});
  assert.deepEqual(invalid.sidebar.names, {d: 'Fine'});
  assert.equal(arrange([{id: 'toString', label: 'Safe'}], normalize(null).sidebar)[0].label, 'Safe');
  const proto = rename(normalize(null), 'sidebar', '__proto__', 'Safe');
  assert.equal(proto.sidebar.names.__proto__, 'Safe');
  assert.equal(Object.getPrototypeOf(proto.sidebar.names), Object.prototype);
});

test('unlabelled status widgets are not navigation menus', () => {
  assert.equal(isMenuEntry({id: 'cordis-panel'}), false);
  assert.equal(isMenuEntry({id: 'status', label: () => ''}), false);
  assert.equal(isMenuEntry({id: 'status', label: '  '}), false);
  assert.equal(isMenuEntry({id: 'devices', label: () => '移动设备'}), true);
});

test('configuration is authoritative and writes include all preferences, then survive reload', async () => {
  const form = fakeForm(normalize(null));
  const source = createPreferencesController(form, {read() { throw Error('Existing config must not read localStorage'); }});
  const next = rename(normalize({sidebar: {order: [MORE_ID, 'a'], hidden: ['a']}}), 'sidebar', footerViewId('devices'), '设备');
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
  const old = normalize({sidebar: {order: ['a', MORE_ID], hidden: ['b']}});
  let cleared = false;
  const source = createPreferencesController(form, {read: () => old, clear: () => { cleared = true; }});
  assert.equal(source.getSnapshot().status, 'saving');
  assert.equal(cleared, false);
  assert.deepEqual(form.writes[0].value, old);
  form.settle(true);
  await Promise.resolve();
  assert.equal(cleared, true);
  assert.equal(source.getSnapshot().status, 'saved');
  assert.deepEqual(source.getSnapshot().preferences, old);
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
  const original = normalize({sidebar: {hidden: ['a']}});
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
  const first = rename(normalize(null), 'sidebar', 'a', 'A');
  const second = rename(first, 'sidebar', 'a', 'B');
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
