import {splitSidebar} from './model.js';

/** Project only the native navigation's element props, preserving its Menu,
 * icons, routes, authorization and child-slot ownership. No DOM mutations. */
export function projectSidebarTree(React, tree, panels, preference, activePanelId, onPinnedChange) {
  const {visible, folded} = splitSidebar(panels, preference);
  const visibleIds = new Set(visible.map(row => row.id));
  let foundMore = false;
  function hasMore(node) {
    if (Array.isArray(node)) return node.some(hasMore);
    if (!React.isValidElement(node)) return false;
    if (Array.isArray(node.props.entries) && typeof node.props.onPinnedChange === 'function' &&
        typeof node.props.onOpen === 'function') return true;
    return hasMore(node.props.children);
  }
  foundMore = hasMore(tree);
  // If a future DSH version removes the native More menu, fail open.
  if (!foundMore) return tree;
  function adapt(node) {
    if (Array.isArray(node)) return node.map(adapt);
    if (!React.isValidElement(node)) return node;
    if (Array.isArray(node.props.entries) && typeof node.props.onPinnedChange === 'function' &&
        typeof node.props.onOpen === 'function') {
      return React.cloneElement(node, {
        entries: [...visible.map(row => ({id: row.id, label: row.label, pinned: true, active: row.id === activePanelId})),
          ...folded.map(row => ({id: row.id, label: row.label, pinned: false, active: row.id === activePanelId}))],
        onPinnedChange,
      });
    }
    if (typeof node.props.id === 'string' && typeof node.props.canUnpin === 'boolean' &&
        typeof node.props.selectPanel === 'function') {
      return visibleIds.has(node.props.id) ? React.cloneElement(node, {canUnpin: false}) : null;
    }
    return node.props.children === undefined ? node : React.cloneElement(node, {}, adapt(node.props.children));
  }
  return adapt(tree);
}
