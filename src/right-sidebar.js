// The stock file navigator supplies the absolute path and the pane id.
// Check containment before creating a reference; no file is read by this action.
export function workspaceFileReference(cwd, absolutePath) {
  if (typeof cwd !== 'string' || typeof absolutePath !== 'string') return null;
  const windows = /^[a-z]:[/\\]|^(?:\\\\|\/\/)[^/\\]+[/\\][^/\\]+/i.test(cwd);
  const normalizePath = path => windows ? path.replace(/\\/g, '/') : path;
  const root = normalizePath(cwd).replace(/\/+$/, '');
  const path = normalizePath(absolutePath);
  if (!cwd.startsWith('/') && !windows) return null;
  const prefix = `${root}/`;
  if (!(windows ? path.toLowerCase().startsWith(prefix.toLowerCase()) : path.startsWith(prefix))) return null;
  const relative = path.slice(prefix.length);
  const segments = relative.split('/');
  // Match DSH's @file grammar: quoted whitespace, no escapes for quotes or controls.
  if (segments.some(part => !part || part === '.' || part === '..') || /[\u0000-\u001f\u007f-\u009f"]/u.test(relative)) return null;
  const mention = /\s/u.test(relative) ? `@"${relative}"` : `@${relative}`;
  return {source: 'reference', ref: mention, label: segments.at(-1), appearance: 'file', clipboardText: mention};
}

export const FILE_REFERENCE_ICON = 'dsh-sidebar.file-reference';

export function registerFileReferenceMenu({contextMenus, conversation, sessions, uiSession, layout}, t, preferences) {
  const current = uiSession.adapter.current;
  const enabled = () => preferences.getSnapshot().preferences.rightSidebar?.sendFileToConversation !== false;
  let live = true;
  function resolveTarget({sessionId, path, paneId}) {
    if (!paneId || !sessionId || current.getSnapshot().key !== sessionId ||
        layout.panelInfo.getSnapshot().activePanelId !== null) return null;
    const ref = workspaceFileReference(sessions.list.getSnapshot().byId[sessionId]?.cwd, path);
    const binding = ref && sessions.binding(sessionId);
    return binding ? {ref, binding} : null;
  }
  const unregister = contextMenus.register({
    id: 'dsh-sidebar.reference-workspace-file', target: 'file', order: 160,
    observe: () => [current, layout.panelInfo, sessions.list, preferences],
    resolve(target) {
      if (!enabled() || !resolveTarget(target)) return [];
      return [{
        id: 'reference-file', label: t('referenceFile'), icon: {key: FILE_REFERENCE_ICON}, failureLabel: t('referenceFailed'),
        run() {
          if (!live || !enabled()) return;
          const resolved = resolveTarget(target);
          if (!resolved) throw new Error('File no longer belongs to the current conversation');
          const input = conversation.input.for(resolved.binding.ctx);
          // rc.5's native file-intake adapter inserts an atomic chip after the
          // selection, with separators. It never replaces selected text or submits.
          if (typeof input.addFiles !== 'function' || !input.addFiles([resolved.ref], [])) {
            throw new Error('The current input did not accept the file reference');
          }
          contextMenus.notify(t('referenceAdded'), true);
        },
      }];
    },
  });
  return () => { live = false; unregister(); };
}

// Native storage omits false (its built-in default). Track only the workspaces
// we initialized so turning the plugin switch off can undo our own changes
// without removing the user's existing eye choices or touching other settings.
export function hiddenFileDefault(marker, nativeValue, enabled) {
  if (marker === 'manual') return null;
  if (marker === 'managed') {
    if (!nativeValue) return {marker: 'manual'};
    return enabled ? null : {marker: null, showHidden: false};
  }
  if (nativeValue) return {marker: 'manual'};
  return enabled ? {marker: 'managed', showHidden: true} : null;
}

export function createHiddenDefaultController(storage) {
  const key = 'dsh-sidebar.hidden-defaults.v1';
  const pending = new Set();
  return (cwd, nativeValue, enabled, setSearchPreferences) => {
    if (typeof cwd !== 'string' || !cwd || typeof nativeValue !== 'boolean' || typeof enabled !== 'boolean') return;
    // Match the native search book's workspace key, including drive roots.
    const trimmed = cwd.replace(/[/\\]+$/, '');
    const root = trimmed === '' ? cwd.slice(0, 1)
      : /^[a-z]:$/i.test(trimmed) && trimmed.length < cwd.length ? cwd.slice(0, 3) : trimmed;
    if (pending.has(root)) return; // Another occurrence may still hold the pre-write snapshot.
    let store, raw;
    try { store = storage(); raw = store.getItem(key); }
    catch { return; } // Do not change the native default if we cannot track ownership.
    let entries = {};
    try {
      const parsed = JSON.parse(raw || 'null');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) entries = parsed;
    } catch { /* Recover from malformed plugin-local data. */ }
    const marker = Object.hasOwn(entries, root) ? entries[root] : null;
    const change = hiddenFileDefault(marker, nativeValue, enabled);
    if (!change) return;
    const next = {...entries, [root]: change.marker};
    if (change.marker === null) delete next[root];
    try { store.setItem(key, JSON.stringify(next)); }
    catch { return; }
    if (typeof change.showHidden === 'boolean') {
      pending.add(root);
      queueMicrotask(() => pending.delete(root));
      try { setSearchPreferences(cwd, {showHidden: change.showHidden}); }
      catch { try { store.setItem(key, JSON.stringify(entries)); } catch { /* Storage became unavailable. */ } }
    }
  };
}

// The primary native Files page is a keyed slot entry. Keep its registry
// identity and all its native hooks, renderer, store, commands and children.
export function registerHiddenFilesDefault(slots, React, source, applyDefault) {
  const slot = 'sidebar.right.pane.tab';
  const key = '@deepseek-ai/dsh-client-ui-sidebar-files';
  const patches = new Map();
  let active = true;
  const sync = () => {
    const entries = new Set(slots.entriesOfSlot(slot).filter(entry => entry.options.key === key));
    for (const [entry, restore] of patches) if (!entries.has(entry)) { restore(); patches.delete(entry); }
    for (const entry of entries) {
      if (patches.has(entry) || typeof entry.component !== 'function') continue;
      const Native = entry.component;
      function DefaultFilesBody(props) {
        if (!active || ![props.useSessions, props.useSearchPreferences, props.setSearchPreferences].every(fn => typeof fn === 'function')) {
          return React.createElement(Native, props);
        }
        return React.createElement(FilesWithDefault, props);
      }
      function FilesWithDefault(props) {
        const {sessionId, useSessions, useSearchPreferences, setSearchPreferences} = props;
        const cwd = useSessions(snapshot => snapshot.byId[sessionId]?.cwd);
        const nativeValue = useSearchPreferences(cwd ?? '')?.showHidden;
        const state = React.useSyncExternalStore(source.subscribe, source.getSnapshot);
        const enabled = state.status === 'loading' || state.status === 'unavailable'
          ? undefined : state.preferences.rightSidebar?.showHidden !== false;
        React.useEffect(() => {
          if (active) applyDefault(cwd, nativeValue, enabled, setSearchPreferences);
        }, [cwd, nativeValue, enabled, setSearchPreferences]);
        return React.createElement(Native, props);
      }
      entry.component = DefaultFilesBody;
      patches.set(entry, () => { if (entry.component === DefaultFilesBody) entry.component = Native; });
    }
  };
  const unsubscribe = slots.subscribe(slot, sync);
  sync();
  return () => {
    active = false;
    unsubscribe();
    for (const restore of patches.values()) restore();
    patches.clear();
  };
}
