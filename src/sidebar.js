import {splitSidebar} from './model.js';

// Match the installed SidebarRoot: 14px text, 22px line height, 16px glyphs,
// 6px label gap and a 32px row. Scope overrides to menu launchers, not dialogs.
export const MORE_MENU_CSS = `
.dshsb-more-content{font-family:inherit;font-size:14px;font-weight:400;line-height:22px;color:var(--dsw-alias-label-primary)}
.dshsb-more-content .dshsb-more-item,.dshsb-more-content .dshsb-more-native button[role="menuitem"]:not([aria-label]){display:flex;align-items:center;justify-content:flex-start;box-sizing:border-box;width:100%;min-height:32px;margin:0;border:0;border-radius:var(--dsw-radius-md,6px);padding:5px 12px;gap:6px;background:transparent;color:inherit;font:inherit;line-height:22px;text-align:start;cursor:pointer}
.dshsb-more-content .dshsb-more-item>svg,.dshsb-more-content .dshsb-more-native button[role="menuitem"]:not([aria-label]) svg{width:16px;height:16px;flex:none}
.dshsb-more-content .dshsb-more-item>span:not(:has(svg)){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshsb-more-content .dshsb-more-item>span:first-child:has(>svg){display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:16px;margin:0}
.dshsb-more-content .dshsb-more-item:hover,.dshsb-more-content .dshsb-more-native button[role="menuitem"]:not([aria-label]):hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshsb-more-content .dshsb-more-item:focus-visible,.dshsb-more-content .dshsb-more-pin:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dshsb-more-content .dshsb-more-pin{display:flex;align-items:center;justify-content:center;box-sizing:border-box;flex:none;width:30px;min-height:32px;padding:6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dshsb-more-content .dshsb-more-pin:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
`;

// Let React render component boundaries so hooks remain attached to a stable
// component, then project that component's output. Never call a child eagerly.
const actionProjections = new WeakMap();
function isFunctionComponent(node) {
  return typeof node.type === 'function' && !node.type.prototype?.isReactComponent;
}
function projectComponent(React, node, project) {
  const Component = node.type;
  let Projection = actionProjections.get(Component);
  if (!Projection) {
    Projection = function ActionProjection({componentProps, project}) {
      return project(Component(componentProps));
    };
    actionProjections.set(Component, Projection);
  }
  return React.createElement(Projection, {key: node.key, componentProps: node.props, project});
}
/** Defer wrapping until a function launcher actually renders, including null. */
export function projectActionOutput(React, tree, project) {
  if (React.isValidElement(tree) && isFunctionComponent(tree)) {
    return projectComponent(React, tree, output => projectActionOutput(React, output, project));
  }
  return tree == null || tree === false ? tree : project(tree);
}

/** Style only an action's trigger; never restyle its dialog or other controls. */
export function projectMenuTrigger(React, tree) {
  let found = false;
  function adapt(node) {
    if (Array.isArray(node)) return node.map(adapt);
    if (!React.isValidElement(node) || found) return node;
    if (node.props.role === 'dialog' || node.props['aria-modal']) return node;
    if (isFunctionComponent(node)) return projectComponent(React, node, tree => projectMenuTrigger(React, tree));
    if (node.type === 'button' || node.props.role === 'menuitem' || node.props.role === 'button') {
      found = true;
      // Inline launcher styles outrank the scoped menu CSS (the mobile gateway
      // supplies a 42px height, negative margins and its own padding).
      const style = {...node.props.style, display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
        boxSizing: 'border-box', width: '100%', height: 'auto', minHeight: 32, margin: 0,
        border: 0, borderRadius: 'var(--dsw-radius-md,6px)', padding: '5px 12px', gap: 6,
        background: undefined, backgroundColor: undefined, color: 'inherit', font: 'inherit', lineHeight: '22px', textAlign: 'start'};
      return React.cloneElement(node, {className: `${node.props.className || ''} dshsb-more-item`.trim(), role: 'menuitem', style});
    }
    return node.props.children === undefined ? node : React.cloneElement(node, {}, adapt(node.props.children));
  }
  return adapt(tree);
}

/** Project the shell's elements, never declare child slots or invent panel IDs. */
export function projectSidebarTree(React, tree, panels, preference, activePanelId, onPinnedChange, options = {}) {
  const {top, bottom, visible, folded, moreLocation} = splitSidebar(panels, preference);
  const rows = new Map();
  let more, footerSeat, navigation;
  const isMore = node => Array.isArray(node.props.entries) && typeof node.props.onPinnedChange === 'function' &&
    typeof node.props.onOpen === 'function';
  const isRow = node => typeof node.props.id === 'string' && typeof node.props.canUnpin === 'boolean' &&
    typeof node.props.selectPanel === 'function';
  function visit(node) {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!React.isValidElement(node)) return;
    if (isMore(node)) more = node;
    if (isRow(node)) rows.set(node.props.id, React.cloneElement(node, {canUnpin: false}));
    if (node.props['data-dshsb-footer-seat']) footerSeat = node;
    if (node.type === 'nav') navigation = node;
    visit(node.props.children);
  }
  visit(tree);
  // Unknown shells fail open: leave all native actions accessible.
  if (!more) return tree;
  const entry = (row, pinned) => ({id: row.id, label: row.label, pinned, active: row.id === activePanelId});
  const managedMore = React.cloneElement(more, {
    key: more.key ?? 'dshsb-more',
    entries: [...visible.filter(row => row.kind !== 'footer').map(row => entry(row, true)),
      ...folded.filter(row => row.kind !== 'footer').map(row => entry(row, false))],
    onPinnedChange,
    ...(options.renderMore ? {renderSlot: (name, owner, ...args) => options.renderMore(more.props.renderSlot, name, owner, args, folded)} : {}),
  });
  // Older contract-only callers do not expose a footer seat; preserve that path.
  if (!navigation || !footerSeat) {
    const visibleIds = new Set(visible.map(row => row.id));
    function legacy(node) {
      if (Array.isArray(node)) return node.map(legacy);
      if (!React.isValidElement(node)) return node;
      if (isMore(node)) return managedMore;
      if (isRow(node)) return visibleIds.has(node.props.id) ? rows.get(node.props.id) : null;
      return node.props.children === undefined ? node : React.cloneElement(node, {}, legacy(node.props.children));
    }
    return legacy(tree);
  }
  const render = row => row.kind === 'footer' ? options.renderFooter?.(row) : rows.get(row.id);
  const topNodes = top.map(render), bottomNodes = bottom.map(render);
  (moreLocation === 'bottom' ? bottomNodes : topNodes).push(managedMore);
  function adapt(node) {
    if (Array.isArray(node)) return node.map(adapt);
    if (!React.isValidElement(node)) return node;
    if (node === navigation) return React.cloneElement(node, {}, topNodes);
    if (node === footerSeat) return React.cloneElement(node, {}, bottomNodes);
    return node.props.children === undefined ? node : React.cloneElement(node, {}, adapt(node.props.children));
  }
  return adapt(tree);
}

/** Rename only the action's own plain label, leaving its callbacks and subtree intact. */
export function projectActionLabel(React, tree, original, label) {
  if (!original || original === label) return tree;
  function adapt(node) {
    if (node === original) return label;
    if (Array.isArray(node)) return node.map(adapt);
    if (!React.isValidElement(node)) return node;
    if (node.props.role === 'dialog' || node.props['aria-modal']) return node;
    if (isFunctionComponent(node)) {
      return projectComponent(React, node, tree => projectActionLabel(React, tree, original, label));
    }
    const props = {};
    if (node.props.label === original) props.label = label;
    for (const key of ['title', 'aria-label']) {
      if (typeof node.props[key] === 'string' && node.props[key].includes(original)) props[key] = node.props[key].split(original).join(label);
    }
    return node.props.children === undefined ? React.cloneElement(node, props)
      : React.cloneElement(node, props, adapt(node.props.children));
  }
  return adapt(tree);
}
