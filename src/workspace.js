// Presentation-only ordering: never writes the native workspace registry order.
export function orderRecentWorkspaces(snapshot, sessions, view, enabled, pinOptions = {}) {
  const dynamic = enabled && view?.groupBy === 'workspace' && view?.orderBy === 'updated';
  const pinned = new Set(pinOptions.pinning && view?.groupBy !== 'flat' ? pinOptions.pinnedWorkspaceIds || [] : []);
  const onlyPinned = pinOptions.onlyPinned === true && view?.groupBy === 'workspace';
  const visiblePins = new Set(pinOptions.pinnedWorkspaceIds || []);
  if ((!dynamic && pinned.size === 0 && !onlyPinned) || !Array.isArray(snapshot?.items)) return snapshot;
  const archived = new Set(snapshot.archivedSessionIds || []);
  const filter = view?.archivedFilter || 'default';
  const items = onlyPinned ? snapshot.items.filter(workspace => visiblePins.has(workspace.workspaceId)) : snapshot.items;
  const ranked = items.map((workspace, index) => {
    let updatedAt = -Infinity;
    for (const id of dynamic ? workspace.sessionIds || [] : []) {
      const session = sessions?.byId?.[id];
      if (!session || session.origin === 'subagent') continue;
      if (session.blank && !(session.retainedBy?.mainView > 0)) continue;
      if (filter === 'only' ? !archived.has(id) : filter !== 'show' && archived.has(id)) continue;
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
  if (ranked.length === snapshot.items.length && ranked.every((row, i) => row.workspace === snapshot.items[i])) return snapshot;
  return {...snapshot, items: ranked.map(row => row.workspace)};
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
