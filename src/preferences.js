import {normalize} from './model.js';

// All durable writes go through DSH's revision-aware configuration forms.
// localStorage is read only for one-time migration of v1 browser preferences.
export function createPreferencesController(form, legacy = {}) {
  let active = true, pending = 0, generation = 0, migrationAttempted = false;
  let state = {preferences: normalize(null), status: 'loading', writable: false};
  const listeners = new Set();
  const publish = patch => {
    if (!active) return;
    state = {...state, ...patch};
    for (const listener of [...listeners]) listener();
  };
  function sync() {
    if (!active) return;
    const view = form.getSnapshot();
    const writable = view.status === 'ready' && view.writable;
    if (view.status !== 'ready') {
      publish({writable: false, status: view.status === 'loading' ? 'loading' : 'unavailable'});
      return;
    }
    if (pending) { publish({writable}); return; }
    if (view.value?.preferences == null && writable && !migrationAttempted) {
      migrationAttempted = true;
      let previous;
      try { previous = legacy.read?.(); } catch { /* Unavailable browser storage does not block plugin configuration. */ }
      if (previous && typeof previous === 'object' && !Array.isArray(previous)) {
        publish({writable});
        void save(previous, true);
        return;
      }
    }
    publish({preferences: normalize(view.value?.preferences), writable,
      status: writable ? 'saved' : 'readonly'});
  }
  async function save(next, migrating = false) {
    if (!active || !state.writable) return false;
    const preferences = normalize(next), ticket = ++generation;
    pending += 1;
    publish({preferences, status: 'saving'});
    let accepted = false;
    try { accepted = await form.set('preferences', preferences); }
    catch { /* Transport rejection may not have refreshed the shared mirror. */ }
    let recovered = true;
    if (!accepted && ticket === generation && active && legacy.recover) {
      try { recovered = await legacy.recover(); }
      catch { recovered = false; }
    }
    pending -= 1;
    if (!active) return accepted;
    if (accepted && migrating) {
      try { legacy.clear?.(); } catch { /* The plugin config is already durable. */ }
    }
    if (ticket === generation) {
      const view = form.getSnapshot();
      const writable = view.status === 'ready' && view.writable;
      publish({preferences: normalize(view.value?.preferences), writable,
        status: accepted ? (writable ? 'saved' : 'readonly') : recovered ? 'error' : 'offline'});
    }
    return accepted;
  }
  const unsubscribe = form.subscribe(sync);
  sync();
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    save,
    refresh() { publish({}); },
    dispose() { active = false; unsubscribe(); listeners.clear(); },
  };
}
