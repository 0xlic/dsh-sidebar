export const OWN_ID = 'dsh-sidebar';
export const GROUPS = ['sidebar', 'settings'];
export const MORE_ID = 'dsh-sidebar:more';
export const PLUGINS_ALIAS = 'dsh-sidebar:panel:plugins';
export const FOOTER_PREFIX = 'dsh-sidebar:footer:';
export function footerViewId(id) { return FOOTER_PREFIX + id; }
export function footerEntryId(id) { return typeof id === 'string' && id.startsWith(FOOTER_PREFIX) ? id.slice(FOOTER_PREFIX.length) : null; }
export function isMenuEntry(options) {
  const label = typeof options.label === 'function' ? options.label() : options.label;
  return typeof options.id === 'string' && typeof label === 'string' && label.trim().length > 0;
}
export function menuLabel(row, preference) {
  return preference?.names && Object.hasOwn(preference.names, row.id) ? preference.names[row.id] : row.label;
}
export function rename(preferences, group, id, label) {
  const next = normalize(preferences);
  const name = typeof label === 'string' ? label.trim().slice(0, 80) : '';
  const names = {...next[group].names};
  if (name) Object.defineProperty(names, id, {value: name, enumerable: true, configurable: true, writable: true});
  else delete names[id];
  if (Object.keys(names).length) next[group].names = names;
  else delete next[group].names;
  return next;
}
export function mergeSidebarRows(panels, footer) {
  return [...panels, ...footer.map(row => ({...row, id: footerViewId(row.id)}))];
}
// Only replace shell PanelRow elements, never invoke or re-create plugin actions.
// Traversal stops at component boundaries; their hooks and slot injectors stay owned
// by the original renderer. A footer action is a complete control, not an icon.
export function projectSidebarTree(React, tree, renderFooter) {
  if (Array.isArray(tree)) return tree.map(node => projectSidebarTree(React, node, renderFooter));
  if (!React.isValidElement(tree)) return tree;
  const id = footerEntryId(tree.props.id);
  if (id !== null && typeof tree.props.usePanelInfo === 'function' && typeof tree.props.selectPanel === 'function') {
    return renderFooter(id, tree.props.wide, tree.key, tree.props.label);
  }
  return tree.props.children === undefined ? tree : React.cloneElement(tree, undefined,
    projectSidebarTree(React, tree.props.children, renderFooter));
}
export function isProtected(id) { return id === OWN_ID || id === MORE_ID; }
// The rc.5 shell hard-codes literal 'plugins' as permanently pinned and omits
// it from More. Use a presentation-only id; navigation and icons map back.
export function viewPanelId(id) { return id === 'plugins' ? PLUGINS_ALIAS : id; }
export function realPanelId(id) { return id === PLUGINS_ALIAS ? 'plugins' : id; }
export function withMore(rows, label = 'More') {
  return [...rows.filter(row => row.id !== MORE_ID), {id: MORE_ID, label, order: Infinity}];
}
export function sidebarView(rows, preference, label = 'More') {
  const ordered = arrange(withMore(rows, label), preference);
  const split = ordered.findIndex(row => row.id === MORE_ID);
  const direct = ordered.slice(0, split), folded = ordered.slice(split + 1);
  return {
    direct, folded,
    // The virtual More row remains unpinned: it keeps the shell's nav alive
    // even when every real entry is hidden or folded. It is never a panel.
    panels: ordered.map(row => ({...row, id: viewPanelId(row.id)})),
    unpinned: [...folded.map(row => viewPanelId(row.id)), MORE_ID],
  };
}
/** Narrow rc.5 compatibility adapter; never duplicate child declarations. */
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
      .filter(([, name]) => typeof name === 'string' && name.trim())
      .map(([id, name]) => [id, name.trim().slice(0, 80)]));
    out[group] = {
      ...(Object.keys(names).length ? {names} : {}),
      order: [...new Set((Array.isArray(raw?.order) ? raw.order : []).filter(x => typeof x === 'string'))],
      hidden: [...new Set((Array.isArray(raw?.hidden) ? raw.hidden : []).filter(x => typeof x === 'string' && !isProtected(x)))],
    };
  }
  return out;
}
export function arrange(rows, preference, includeHidden = false) {
  const ranks = new Map(preference.order.map((id, i) => [id, i]));
  const ordered = rows.map((row, index) => ({row, index})).sort((a, b) => {
    const ar = ranks.get(a.row.id), br = ranks.get(b.row.id);
    if (ar !== undefined || br !== undefined) return (ar ?? Infinity) - (br ?? Infinity) || a.index - b.index;
    return (a.row.order ?? 0) - (b.row.order ?? 0) || a.index - b.index;
  }).map(x => x.row);
  const visible = includeHidden ? ordered : ordered.filter(row => isProtected(row.id) || !preference.hidden.includes(row.id));
  return visible.map(row => menuLabel(row, preference) === row.label ? row : {...row, label: menuLabel(row, preference)});
}
export function move(preferences, group, rows, id, delta) {
  const next = normalize(preferences);
  const order = arrange(rows, next[group], true).map(x => x.id);
  const from = order.indexOf(id), to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return next;
  [order[from], order[to]] = [order[to], order[from]];
  // Retain temporarily unloaded plugin identities without changing live order.
  next[group].order = [...order, ...next[group].order.filter(x => !order.includes(x))];
  return next;
}
export function toggle(preferences, group, id) {
  const next = normalize(preferences);
  if (isProtected(id)) return next;
  const hidden = next[group].hidden;
  next[group].hidden = hidden.includes(id) ? hidden.filter(x => x !== id) : [...hidden, id];
  return next;
}
