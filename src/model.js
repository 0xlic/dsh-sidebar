export const OWN_ID = 'dsh-sidebar';
export const GROUPS = ['sidebar', 'settings'];

export const MORE_ID = 'dsh-sidebar:more';
export const WORKSPACE_ID = 'dsh-sidebar:workspaces';
export function isBoundary(id) {
  return id === MORE_ID || id === WORKSPACE_ID;
}
export function footerId(id) {
  return `dsh-sidebar:action:${id}`;
}
// Ignore obsolete footer identities rather than migrating their saved positions.
function isPreferenceId(id) {
  return typeof id === 'string' && !id.startsWith('dsh-sidebar:footer:');
}
function canHide(id) {
  return isPreferenceId(id) && id.trim() !== '' && !isBoundary(id) && id !== OWN_ID;
}
function hiddenIds(preference) {
  return new Set((Array.isArray(preference?.hidden) ? preference.hidden : []).filter(canHide));
}
/** Visibility never affects the management catalog or protected recovery entries. */
export function navigationRows(rows, preference) {
  const hidden = hiddenIds(preference);
  return arrange(rows, preference).filter(row => !hidden.has(row.id));
}
export function setVisible(preferences, group, id, visible) {
  const next = normalize(preferences);
  if (!GROUPS.includes(group) || !canHide(id) || typeof visible !== 'boolean') return next;
  const hidden = hiddenIds(next[group]);
  if (visible) hidden.delete(id);
  else hidden.add(id);
  if (hidden.size) next[group].hidden = [...hidden];
  else delete next[group].hidden;
  return next;
}
export function sidebarRows(rows, label = 'More', workspaceLabel = 'Workspaces') {
  const menus = rows.filter(row => !isBoundary(row.id));
  return [
    ...menus.filter(row => row.kind !== 'footer'),
    {id: MORE_ID, label, order: Infinity},
    {id: WORKSPACE_ID, label: workspaceLabel, order: Infinity},
    ...menus.filter(row => row.kind === 'footer').map(row => ({...row, order: Infinity})),
  ];
}
export function splitSidebar(rows, preference) {
  const ordered = arrange(sidebarRows(rows), preference);
  const moreIndex = ordered.findIndex(row => row.id === MORE_ID);
  const workspaceIndex = ordered.findIndex(row => row.id === WORKSPACE_ID);
  const visible = [], folded = [], top = [], bottom = [];
  const hidden = hiddenIds(preference);
  ordered.forEach((row, index) => {
    if (isBoundary(row.id) || hidden.has(row.id)) return;
    if (index > moreIndex && (moreIndex > workspaceIndex || index < workspaceIndex)) folded.push(row);
    else {
      visible.push(row);
      (index < workspaceIndex ? top : bottom).push(row);
    }
  });
  return {visible, folded, top, bottom, ordered, moreIndex, workspaceIndex,
    moreLocation: moreIndex < workspaceIndex ? 'top' : 'bottom'};
}
export function menuLabel(row, preference) {
  return !isBoundary(row.id) && preference?.names && Object.hasOwn(preference.names, row.id) ? preference.names[row.id] : row.label;
}
export function rename(preferences, group, id, label) {
  const next = normalize(preferences);
  if (!isPreferenceId(id) || isBoundary(id)) return next;
  const name = typeof label === 'string' ? label.trim().slice(0, 80) : '';
  const names = {...next[group].names};
  if (name) Object.defineProperty(names, id, {value: name, enumerable: true, configurable: true, writable: true});
  else delete names[id];
  if (Object.keys(names).length) next[group].names = names;
  else delete next[group].names;
  return next;
}
/** Reversible metadata adapter; never duplicate child declarations. */
export function replaceComponent(entry, replacement) {
  const original = entry.component;
  entry.component = replacement;
  return () => {
    // Do not overwrite a later adapter installed by another plugin.
    if (entry.component === replacement) entry.component = original;
  };
}
export function normalize(value) {
  const out = {};
  for (const group of GROUPS) {
    const raw = value?.[group];
    const names = Object.fromEntries(Object.entries(raw?.names && typeof raw.names === 'object' && !Array.isArray(raw.names) ? raw.names : {})
      .filter(([id, name]) => isPreferenceId(id) && !isBoundary(id) && typeof name === 'string' && name.trim())
      .map(([id, name]) => [id, name.trim().slice(0, 80)]));
    const hidden = [...hiddenIds(raw)];
    out[group] = {
      ...(hidden.length ? {hidden} : {}),
      order: [...new Set((Array.isArray(raw?.order) ? raw.order : []).filter(id => isPreferenceId(id) && (group === 'sidebar' || !isBoundary(id))))],
      ...(Object.keys(names).length ? {names} : {}),
    };
  }
  const rightSidebar = value?.rightSidebar;
  if (rightSidebar && typeof rightSidebar === 'object' &&
      (Object.getPrototypeOf(rightSidebar) === Object.prototype || Object.getPrototypeOf(rightSidebar) === null)) {
    out.rightSidebar = {
      showHidden: rightSidebar.showHidden !== false,
      sendFileToConversation: rightSidebar.sendFileToConversation !== false,
      quotePreviewSelection: typeof rightSidebar.quotePreviewSelection === 'boolean'
        ? rightSidebar.quotePreviewSelection
        : rightSidebar.quoteMarkdownSelection !== false && rightSidebar.quoteCodeSelection !== false,
    };
  }
  const workspace = value?.workspace;
  if (workspace !== null && typeof workspace === 'object' &&
      (Object.getPrototypeOf(workspace) === Object.prototype || Object.getPrototypeOf(workspace) === null)) {
    out.workspace = {
      dynamicSort: workspace.dynamicSort !== false,
      pinning: workspace.pinning !== false,
      ...(Object.hasOwn(workspace, 'onlyPinned') ? {onlyPinned: workspace.onlyPinned === true} : {}),
      activeIndicator: workspace.activeIndicator !== false,
      collapseOneClick: workspace.collapseOneClick !== false,
      ...(Object.hasOwn(workspace, 'archiveUnpinnedSessions') ? {archiveUnpinnedSessions: workspace.archiveUnpinnedSessions !== false} : {}),
      ...(Object.hasOwn(workspace, 'pinnedWorkspaceIds') ? {
        pinnedWorkspaceIds: [...new Set((Array.isArray(workspace.pinnedWorkspaceIds) ? workspace.pinnedWorkspaceIds : [])
          .filter(id => typeof id === 'string' && id.trim()))],
      } : {}),
    };
  }
  return out;
}
export function arrange(rows, preference) {
  const ranks = new Map(preference.order.map((id, i) => [id, i]));
  const ordered = rows.map((row, index) => ({row, index})).sort((a, b) => {
    const ar = ranks.get(a.row.id), br = ranks.get(b.row.id);
    if (ar !== undefined || br !== undefined) return (ar ?? Infinity) - (br ?? Infinity) || a.index - b.index;
    return (a.row.order ?? 0) - (b.row.order ?? 0) || a.index - b.index;
  }).map(x => x.row);
  return ordered.map(row => menuLabel(row, preference) === row.label ? row : {...row, label: menuLabel(row, preference)});
}
/** Insert a live row before/after another row in this group's current order. */
export function reorder(preferences, group, rows, id, targetId, after = false) {
  const next = normalize(preferences);
  if (!GROUPS.includes(group) || id === targetId || !isPreferenceId(id) || !isPreferenceId(targetId)) return next;
  const order = arrange(rows, next[group]).map(row => row.id);
  const from = order.indexOf(id);
  if (from < 0 || !order.includes(targetId)) return next;
  const original = [...order];
  order.splice(from, 1);
  const to = order.indexOf(targetId) + (after ? 1 : 0);
  order.splice(to, 0, id);
  if (order.every((value, index) => value === original[index])) return next;
  // Keep unloaded identities available without disturbing the live row order.
  next[group].order = [...order.filter(isPreferenceId), ...next[group].order.filter(value => !order.includes(value))];
  return next;
}
export function move(preferences, group, rows, id, delta) {
  const next = normalize(preferences);
  const order = arrange(rows, next[group]).map(x => x.id);
  const from = order.indexOf(id), to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return next;
  [order[from], order[to]] = [order[to], order[from]];
  // Retain temporarily unloaded plugin identities without changing live order.
  next[group].order = [...order.filter(isPreferenceId), ...next[group].order.filter(x => !order.includes(x))];
  return next;
}
