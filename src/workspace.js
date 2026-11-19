// Ordering is pure. The display and Host sync use the same ranking rules.
function rankWorkspaces(snapshot, sessions, view, enabled, pinOptions) {
  const dynamic = enabled && view?.groupBy === 'workspace' && view?.orderBy === 'updated';
  const pinned = new Set(pinOptions.pinning && view?.groupBy !== 'flat' ? pinOptions.pinnedWorkspaceIds || [] : []);
  const onlyPinned = pinOptions.onlyPinned === true && view?.groupBy === 'workspace';
  const visiblePins = new Set(pinOptions.pinnedWorkspaceIds || []);
  if ((!dynamic && pinned.size === 0 && !onlyPinned) || !Array.isArray(snapshot?.items)) return null;
  // Archival changes visibility, not activity. Keep archived members in the
  // ranking so hiding the newest session does not move its workspace.
  const items = onlyPinned ? snapshot.items.filter(workspace => visiblePins.has(workspace.workspaceId)) : snapshot.items;
  const ranked = items.map((workspace, index) => {
    let updatedAt = -Infinity;
    for (const id of dynamic ? workspace.sessionIds || [] : []) {
      const session = sessions?.byId?.[id];
      if (!session || session.origin === 'subagent') continue;
      if (session.blank && !(session.retainedBy?.mainView > 0)) continue;
      if (typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt)) updatedAt = Math.max(updatedAt, session.updatedAt);
    }
    return {workspace, index, updatedAt};
  });
  ranked.sort((a, b) => {
    const ap = pinned.has(a.workspace.workspaceId), bp = pinned.has(b.workspace.workspaceId);
    if (ap !== bp) return ap ? -1 : 1;
    // Pinned workspaces keep their native relative order; recency applies only
    // to the ordinary block. Native session pins never enter this comparison.
    if (ap || !dynamic || a.updatedAt === b.updatedAt) return a.index - b.index;
    return a.updatedAt > b.updatedAt ? -1 : 1;
  });
  return ranked.map(row => ({...row, priority: pinned.has(row.workspace.workspaceId) ? Infinity : row.updatedAt}));
}

export function orderRecentWorkspaces(snapshot, sessions, view, enabled, pinOptions = {}) {
  const ranked = rankWorkspaces(snapshot, sessions, view, enabled, pinOptions);
  if (!ranked || (ranked.length === snapshot.items.length && ranked.every((row, i) => row.workspace === snapshot.items[i]))) return snapshot;
  return {...snapshot, items: ranked.map(row => row.workspace)};
}

export function workspaceHostOrder(snapshot, sessions, view, enabled, pinOptions = {}) {
  const dynamic = enabled && view?.groupBy === 'workspace' && view?.orderBy === 'updated';
  if (snapshot?.phase !== 'ready' || snapshot.state !== 'idle' || view?.groupBy === 'flat' ||
      (dynamic && sessions?.phase !== 'ready')) return null;
  const ranked = rankWorkspaces(snapshot, sessions, view, enabled, {...pinOptions, onlyPinned: false});
  if (!ranked) return null;
  // Ignore registry echoes and timestamp churn that doesn't change the ranking.
  // Canonicalize equal-priority groups for the key only (not the actual order).
  const groups = [];
  for (const {workspace, priority} of ranked) {
    if (groups.at(-1)?.priority !== priority) groups.push({priority, ids: []});
    groups.at(-1).ids.push(workspace.workspaceId);
  }
  const key = JSON.stringify([dynamic, pinOptions.pinning, view?.groupBy,
    groups.map(group => [group.priority === Infinity, group.ids.sort()])]);
  return {key, ids: ranked.map(row => row.workspace.workspaceId)};
}

// Move the needed row before the first mismatch. Replan against native order
// after each acknowledgment instead of assuming later anchors still exist.
export function nextWorkspaceMove(items, ids) {
  if (items.length !== ids.length) return null;
  const i = items.findIndex((row, index) => row.workspaceId !== ids[index]);
  if (i < 0 || !items.some(row => row.workspaceId === ids[i])) return null;
  return [ids[i], items[i].workspaceId];
}

export function createWorkspaceOrderSync({readMove, move, onError, delay = 450}) {
  let key = null, pending = false, disposed = false, running = false, timer;
  const schedule = () => {
    if (!disposed && pending && !running && timer === undefined) timer = setTimeout(flush, delay);
  };
  async function flush() {
    timer = undefined;
    if (disposed || !pending) return;
    running = true;
    pending = false;
    const target = key;
    try {
      // Bound the work when other clients make concurrent edits.
      const seen = new Set();
      while (!disposed && target === key) {
        const step = readMove(target);
        if (!step) break;
        const signature = JSON.stringify(step);
        if (seen.has(signature)) throw new Error('Workspace order changed during sync');
        seen.add(signature);
        await move(...step);
      }
    } catch (error) {
      if (!disposed && target === key) onError(error);
    } finally {
      running = false;
      schedule();
    }
  }
  return {
    update(next) {
      if (disposed || next === key) return;
      key = next;
      pending = next !== null;
      clearTimeout(timer);
      timer = undefined;
      schedule();
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
  };
}

// Native grouping puts sessions absent from the workspace projection into
// Ungrouped. Filter the matching session projection too, without touching the
// actual session store, selection, retention or workspace membership.
export function filterWorkspaceSessions(sessions, workspaces, enabled) {
  if (!enabled || !Array.isArray(workspaces?.items)) return sessions;
  const members = new Set(workspaces.items.flatMap(workspace => workspace.sessionIds || []));
  return {...sessions,
    ids: (sessions.ids || Object.keys(sessions.byId || {})).filter(id => members.has(id)),
    byId: Object.fromEntries(Object.entries(sessions.byId || {}).filter(([id]) => members.has(id))),
  };
}

// The context menu and native session controls use the same archive operation
// and glyph. The workspace snapshot supplies membership independent of row limits.
export function registerWorkspaceArchiveMenu({contextMenus, workspaces, sessions, uiWorkspace, remoteAccess}, t, preferences) {
  const enabled = () => preferences.getSnapshot().preferences.workspace?.archiveUnpinnedSessions !== false;
  const running = new Set();
  let live = true;
  function readTargets(workspaceId) {
    const workspaceList = workspaces.list.getSnapshot();
    const sessionList = sessions.list.getSnapshot();
    if (workspaceList.phase !== 'ready' || sessionList.phase !== 'ready') return null;
    const workspace = workspaceList.items.find(row => row.workspaceId === workspaceId);
    if (!workspace) return null;
    return {workspace, workspaceList, sessionList};
  }
  function canArchive({workspaceList, sessionList}, id) {
    const session = sessionList.byId[id];
    return session && !session.blank && session.origin !== 'subagent' &&
      !workspaceList.pinnedSessionIds.includes(id) && !workspaceList.archivedSessionIds.includes(id) &&
      remoteAccess.source('session', id, 'workspace/archiveSession').getSnapshot();
  }
  const unregister = contextMenus.register({
    id: 'dsh-sidebar.archive-workspace-sessions', target: 'workspace', order: 250,
    observe: () => [preferences, workspaces.list, sessions.list],
    resolve({workspaceId}) {
      if (!enabled()) return [];
      const targets = readTargets(workspaceId);
      if (!targets) return [];
      return [{
        id: 'archive-sessions', label: t('archiveSessions'), icon: {key: 'workspace.archive'},
        disabled: running.has(workspaceId) || !targets.workspace.sessionIds.some(id => canArchive(targets, id)),
        failureLabel: t('archiveSessionsFailed'),
        async run() {
          if (!live || !enabled() || running.has(workspaceId)) return;
          const current = readTargets(workspaceId);
          if (!current) return;
          const ids = [...new Set(current.workspace.sessionIds.filter(id => canArchive(current, id)))];
          if (!ids.length) return;
          running.add(workspaceId);
          let archived = 0, active = 0, skipped = 0, failed = 0;
          try {
            for (const id of ids) {
              // Recheck before each write: a session may have moved, been pinned,
              // or been archived while an earlier request was in flight.
              const latest = readTargets(workspaceId);
              if (!live) break;
              if (!latest) { failed++; continue; }
              if (!latest.workspace.sessionIds.includes(id) || !canArchive(latest, id)) { skipped++; continue; }
              try {
                // Keep the Host's running-work refusal; a bulk action must not stop work.
                await uiWorkspace.archiveSession(id);
                archived++;
              } catch (error) {
                if (error?.rpcError?.code === 'workspace/session-active') active++;
                else failed++;
              }
            }
            if (live) {
              const lines = [t('archiveSessionsDone', {archived})];
              if (active) lines.push(t('archiveSessionsActive', {active}));
              if (skipped) lines.push(t('archiveSessionsSkipped', {skipped}));
              if (failed) lines.push(t('archiveSessionsIncomplete', {failed}));
              contextMenus.notify(lines.join(' '), !active && !failed && archived > 0);
            }
          } finally {
            running.delete(workspaceId);
          }
        },
      }];
    },
  });
  return () => { live = false; unregister(); };
}

// Aggregate live activity only: an unread completion is not an active session.
// Match native root-row visibility, including archived filtering and blank rows.
export function workspaceActivity(workspace, sessions, statuses, archivedIds = [], archivedFilter = 'default') {
  const archived = new Set(archivedIds);
  let state = null;
  for (const id of workspace?.sessionIds || []) {
    const session = sessions?.byId?.[id];
    if (!session || session.origin === 'subagent' || session.blank) continue;
    if (archivedFilter === 'only' ? !archived.has(id) : archivedFilter !== 'show' && archived.has(id)) continue;
    const status = statuses?.get(id);
    if (['approval', 'plan-review', 'question'].includes(status?.pendingInteraction?.kind)) return 'warning';
    const running = status?.running ?? session.running;
    const children = sessions?.projectionsBySession?.[id]?.values?.subagentCatalog || [];
    if (running || children.some(child => (statuses?.get(child.id)?.running ?? sessions?.byId?.[child.id]?.running) === true)) state = 'ongoing';
  }
  return state;
}

export function workspaceActivityCss(id, menuOpen = false) {
  if (typeof id !== 'string' || !id) return '';
  const value = Array.from('workspace:' + id, char => /[a-zA-Z0-9_-]/.test(char) ? char : '\\' + char.codePointAt(0).toString(16) + ' ').join('');
  const row = `[data-row-key="${value}"][role="treeitem"]`;
  const strip = `${row}>:has(>.dshsb-workspace-activity)`;
  const marker = `${strip}>.dshsb-workspace-activity`;
  const resting = selector => `${selector}>:has(>.dshsb-workspace-activity){display:inline-flex}
${selector}>:has(>.dshsb-workspace-activity)>:not(.dshsb-workspace-activity){display:none}
${selector} .dshsb-workspace-activity{display:inline-flex}`;
  return `${marker}{display:none;flex:none;width:16px;height:20px;align-items:center;justify-content:center;pointer-events:none}
${!menuOpen ? `@media(hover:hover){${resting(`${row}:not(:hover):not(:focus-within)`)}}
@media(hover:none){${resting(`${row}:not([aria-expanded="true"]):not(:focus-within)`)}}` : ''}`;
}

// Exact installed IconPinFillRegular geometry (native session pin, 14px).
export const WORKSPACE_PIN_PATHS = Object.freeze([
  'M9.96976 1.70572L13.1554 3.93629L10.9019 8.12317L11.5158 11.605L10.7192 12.7427L2.52767 7.00693L3.3243 5.86922L6.80612 5.25528L9.96976 1.70572Z',
  'M6.05285 9.47511C6.27284 9.16094 6.70586 9.08458 7.02003 9.30457C7.3342 9.52455 7.41055 9.95757 7.19057 10.2717L3.98587 14.4708L3.21223 13.9291L6.05285 9.47511Z',
]);
const WORKSPACE_PIN_MASK = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="1"><path d="M9.96976 1.70572L13.1554 3.93629L10.9019 8.12317L11.5158 11.605L10.7192 12.7427L2.52767 7.00693L3.3243 5.86922L6.80612 5.25528L9.96976 1.70572Z" fill="black" stroke="black" stroke-linejoin="round"/><path d="M6.05285 9.47511C6.27284 9.16094 6.70586 9.08458 7.02003 9.30457C7.3342 9.52455 7.41055 9.95757 7.19057 10.2717L3.98587 14.4708L3.21223 13.9291L6.05285 9.47511Z" fill="black"/></svg>');
const WORKSPACE_PIN_OUTLINE_MASK = WORKSPACE_PIN_MASK.replace(encodeURIComponent('fill="black" stroke="black"'), encodeURIComponent('stroke="black"'));
export function workspacePinMarkerCss(id, menuOpen = false, pinned = true) {
  if (typeof id !== 'string' || !id) return '';
  // Escape the complete attribute value, including quotes and '<', so IDs can
  // neither inject selectors nor terminate the style element.
  const value = Array.from('workspace:' + id, char => /[a-zA-Z0-9_-]/.test(char) ? char : '\\' + char.codePointAt(0).toString(16) + ' ').join('');
  const row = `[data-row-key="${value}"][role="treeitem"]`;
  const action = `${row} .dshsb-workspace-pin-action`;
  const strip = `${row}>:has(>.dshsb-workspace-pin-action)`;
  return `${row}::after{content:"";display:${pinned && !menuOpen ? 'inline-flex' : 'none'};flex:none;width:16px;height:20px;margin-left:6px;pointer-events:none;background-color:var(--dsw-alias-label-caption);-webkit-mask:url("${WORKSPACE_PIN_MASK}") center/14px 14px no-repeat;mask:url("${WORKSPACE_PIN_MASK}") center/14px 14px no-repeat}
${action}{order:2;flex:none;cursor:pointer}
${action}:disabled{opacity:.4;cursor:not-allowed}
${action}:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
${action} .dshsb-workspace-pin-glyph{display:inline-block;width:14px;height:14px;pointer-events:none;background-color:currentColor;-webkit-mask:url("${WORKSPACE_PIN_OUTLINE_MASK}") center/contain no-repeat;mask:url("${WORKSPACE_PIN_OUTLINE_MASK}") center/contain no-repeat}
${action}[aria-pressed="true"] .dshsb-workspace-pin-glyph{-webkit-mask-image:url("${WORKSPACE_PIN_MASK}");mask-image:url("${WORKSPACE_PIN_MASK}")}
${row}:focus-within::after{display:none}
${row}:focus-within>:has(>.dshsb-workspace-pin-action){display:inline-flex}
${menuOpen ? `${strip}{display:inline-flex}` : ''}
@media(hover:hover){${row}:hover::after{display:none}}
@media(hover:none){${row}[aria-expanded="true"]::after{display:none}}`;
}

// Fixed styling for the one-click collapse control in the Workspace section
// header. The native action cluster clips a third button, so this control is a
// direct header child immediately before the search slot and supplies the
// group's push-right margin itself.
export const WORKSPACE_COLLAPSE_ALL_CSS = `
.dshsb-collapse-all{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;margin-left:auto;border:0;border-radius:var(--dsw-radius-sm);padding:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
@media(hover:hover){.dshsb-collapse-all:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.dshsb-collapse-all:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
[data-sidebar-workspace-header]:has(>.dshsb-collapse-all)>:has(input){margin-left:0}
[data-sidebar-workspace-header]:has(input:not([tabindex="-1"]))>.dshsb-collapse-all{display:none}`;
