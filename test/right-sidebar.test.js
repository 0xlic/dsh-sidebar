import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Config} from '../index.js';
import {normalize, rename} from '../src/model.js';
import {workspaceFileReference, registerFileReferenceMenu, createHiddenDefaultController, registerHiddenFilesDefault} from '../src/right-sidebar.js';

test('right sidebar default is checked and an explicit false survives config writes', () => {
  assert.equal(normalize(Config({preferences: {rightSidebar: {}}}).preferences.get()).rightSidebar.showHidden, true);
  const next = rename({rightSidebar: {showHidden: false}}, 'sidebar', 'chat', 'Chat');
  assert.equal(normalize(Config({preferences: next}).preferences.get()).rightSidebar.showHidden, false);
  assert.equal(normalize(null).rightSidebar, undefined);
  assert.throws(() => Config({preferences: {rightSidebar: {showHidden: 'false'}}}).preferences.get(), /expected boolean/);
});

test('preview quote migration honors either legacy opt-out unless an explicit new boolean exists', () => {
  for (const [rightSidebar, enabled] of [
    [{}, true],
    [{quoteMarkdownSelection: true, quoteCodeSelection: true}, true],
    [{quoteMarkdownSelection: false, quoteCodeSelection: true}, false],
    [{quoteCodeSelection: false}, false],
    [{quoteMarkdownSelection: false, quoteCodeSelection: false}, false],
    [{quotePreviewSelection: true, quoteMarkdownSelection: false, quoteCodeSelection: false}, true],
    [{quotePreviewSelection: false, quoteMarkdownSelection: true, quoteCodeSelection: true}, false],
    [{quotePreviewSelection: null, quoteMarkdownSelection: false}, false],
  ]) {
    const preferences = {rightSidebar};
    const parsed = Config({preferences}).preferences.get();
    const expected = {showHidden: true, sendFileToConversation: true, quotePreviewSelection: enabled};
    assert.deepEqual(normalize(preferences).rightSidebar, expected);
    assert.deepEqual(normalize(parsed).rightSidebar, expected);
    assert.deepEqual(Config({preferences: normalize(parsed)}).preferences.get().rightSidebar, expected);
  }
  assert.equal(normalize({rightSidebar: {quotePreviewSelection: 'true', quoteCodeSelection: false}}).rightSidebar.quotePreviewSelection, false);
  assert.equal(normalize({rightSidebar: {quoteCodeSelection: 'false'}}).rightSidebar.quotePreviewSelection, true);
  for (const key of ['quotePreviewSelection', 'quoteMarkdownSelection', 'quoteCodeSelection']) {
    assert.throws(() => Config({preferences: {rightSidebar: {[key]: 'false'}}}).preferences.get(), /expected boolean/);
  }
});

test('file references match native quoting and do not accept another root or traversal', () => {
  assert.deepEqual(workspaceFileReference('/repo/', '/repo/.config/a b.md'), {
    source: 'reference', appearance: 'file', label: 'a b.md', ref: '@".config/a b.md"', clipboardText: '@".config/a b.md"',
  });
  assert.equal(workspaceFileReference('C:\\Repo\\', 'c:/Repo/file.txt').ref, '@file.txt');
  assert.equal(workspaceFileReference('\\\\Host\\Share\\', '//host/share/f.md').ref, '@f.md');
  assert.equal(workspaceFileReference('/', '/.env').ref, '@.env');
  for (const path of ['/repo2/file', '/repo/../file', '/repo//file', '/repo/x".md', '/repo/a\nb', 'file']) {
    assert.equal(workspaceFileReference('/repo', path), null, path);
  }
});

test('native file menu uses the current pane session and inserts without submitting or replacing the draft', () => {
  const rows = [], notices = [], refEdits = [], binding = {ctx: {}};
  let active = 'one', panelId = null, released = false, accept = true;
  const context = {
    contextMenus: {register(contribution) { rows.push(contribution); return () => { released = true; }; },
      notify(...args) { notices.push(args); }},
    uiSession: {adapter: {current: {getSnapshot: () => ({key: active})}}},
    layout: {panelInfo: {getSnapshot: () => ({activePanelId: panelId})}},
    sessions: {list: {getSnapshot: () => ({byId: {one: {cwd: '/repo'}}})}, binding: id => id === 'one' ? binding : undefined},
    conversation: {input: {for(ctx) {
      assert.equal(ctx, binding.ctx);
      return {addFiles(...args) { refEdits.push(args); return accept; }, submit() { throw new Error('Must not submit'); }};
    }}},
  };
  let rightSidebar;
  const preferences = {getSnapshot: () => ({preferences: {rightSidebar}})};
  const cleanup = registerFileReferenceMenu(context, key => key, preferences);
  const [provider] = rows;
  assert.ok(provider.observe().includes(preferences));
  assert.equal(provider.target, 'file');
  const target = {sessionId: 'one', path: '/repo/a.md', paneId: 'pane'};
  assert.deepEqual(provider.resolve({...target, paneId: undefined}), []);
  assert.deepEqual(provider.resolve({...target, path: '/other/a.md'}), []);
  const [action] = provider.resolve(target);
  assert.equal(action.label, 'referenceFile');
  assert.deepEqual(action.icon, {key: 'dsh-sidebar.file-reference'});
  rightSidebar = {sendFileToConversation: false};
  assert.deepEqual(provider.resolve(target), []);
  action.run();
  assert.equal(refEdits.length, 0);
  rightSidebar = {sendFileToConversation: true};
  assert.equal(provider.resolve(target).length, 1);
  active = 'two';
  assert.throws(() => action.run(), /current conversation/);
  active = 'one'; panelId = 'another-page';
  assert.deepEqual(provider.resolve(target), []);
  panelId = null;
  action.run();
  assert.deepEqual(refEdits, [[[workspaceFileReference('/repo', '/repo/a.md')], []]]);
  assert.deepEqual(notices, [['referenceAdded', true]]);
  accept = false;
  assert.throws(() => action.run(), /did not accept/);
  cleanup();
  assert.equal(released, true);
  action.run();
  assert.equal(refEdits.length, 2);
});

function testStorage() {
  const values = new Map();
  return {getItem: key => values.get(key), setItem: (key, value) => values.set(key, value)};
}

test('hidden default changes only plugin-managed workspaces and keeps an explicit eye choice on reopen', async () => {
  const storage = testStorage();
  const writes = [];
  const set = (root, patch) => writes.push([root, patch]);
  const apply = createHiddenDefaultController(() => storage);
  apply('/loading', false, undefined, set);
  apply('/already-on', true, true, set); // Existing native choice is not ours.
  apply('/already-on', false, true, set); // User used the eye.
  apply('/managed/', false, true, set);
  apply('/managed', false, true, set); // Other pane with old snapshot in the same commit.
  assert.deepEqual(writes, [['/managed/', {showHidden: true}]]);
  await Promise.resolve();
  apply('/managed', true, false, set);
  await Promise.resolve();
  apply('/managed', false, true, set);
  await Promise.resolve();
  apply('/managed', false, true, set); // Changed after we initialized it: the eye wins.
  const reopened = createHiddenDefaultController(() => storage);
  reopened('/managed', false, true, set);
  reopened('/already-on', false, true, set);
  assert.deepEqual(writes, [['/managed/', {showHidden: true}], ['/managed', {showHidden: false}], ['/managed', {showHidden: true}]]);
});

test('hidden default wraps only the native Files registration and releases it with the slot', () => {
  const component = () => null;
  const native = {component, options: {key: '@deepseek-ai/dsh-client-ui-sidebar-files'}, store: {}, inject() {}};
  const other = {component, options: {key: 'other-files'}};
  const {store, inject} = native;
  let sync, unsubscribed = false, entries = [native, other];
  const cleanup = registerHiddenFilesDefault({
    entriesOfSlot(name) { assert.equal(name, 'sidebar.right.pane.tab'); return entries; },
    subscribe(name, listener) { sync = listener; return () => { unsubscribed = true; }; },
  }, {}, {}, () => {});
  assert.notEqual(native.component, component);
  assert.equal(native.store, store);
  assert.equal(native.inject, inject);
  assert.equal(other.component, component);
  entries = [other]; sync();
  assert.equal(native.component, component);
  entries = [native, other]; sync();
  assert.notEqual(native.component, component);
  cleanup();
  assert.equal(unsubscribed, true);
  assert.equal(native.component, component);
});

test('hidden default will not edit native preferences when ownership cannot be recorded', () => {
  const apply = createHiddenDefaultController(() => ({getItem: () => null, setItem: () => { throw new Error('unavailable'); }}));
  apply('/repo', false, true, () => assert.fail('must not edit the native preference'));
});
