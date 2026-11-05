export const OWN_ID = 'dsh-sidebar';
export const GROUPS = ['sidebar', 'settings'];
export const MORE_ID = 'dsh-sidebar:more';
export const PLUGINS_ALIAS = 'dsh-sidebar:panel:plugins';
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
    out[group] = {
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
  return includeHidden ? ordered : ordered.filter(row => isProtected(row.id) || !preference.hidden.includes(row.id));
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
