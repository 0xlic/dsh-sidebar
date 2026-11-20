// rc.5 has no selection-action seat in previews. Wrap the two built-in
// registrations, leaving their loader, renderer and Session props native.
const PREVIEW_QUOTE_SLOT = 'sidebar.right.tab.document';
const PREVIEW_QUOTE_ENTRIES = new Map([
  ['@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown', 'markdown'],
  ['@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code', 'code'],
]);
const CODE_BODY = '[data-code-preview] [data-code-block-content] pre > code';
const MARKDOWN_QUOTE_CSS = `
.dshsb-markdown-quote-root{position:relative;min-width:0}
.dshsb-markdown-quote-root[data-quote-kind=code]{display:flex;flex:1 1 auto;flex-direction:column;min-height:0;height:100%}
.dshsb-markdown-quote{position:absolute;z-index:2;visibility:hidden;padding:5px 10px;border:0;border-radius:999px;
  background:var(--dsw-alias-button-floating-fill);--dsw-elevation-stroke-color:var(--dsw-alias-border-l3);
  box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);
  cursor:pointer;user-select:none;white-space:nowrap}
.dshsb-markdown-quote:focus-visible{background:var(--dsw-alias-button-floating-hover);
  outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
@media(hover:hover){.dshsb-markdown-quote:hover{background:var(--dsw-alias-button-floating-hover)}}
`;

export function readMarkdownSelection(root, selection) {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const bodyOf = node => (node.nodeType === 1 ? node : node.parentElement)?.closest('[data-document-markdown]');
  const body = bodyOf(range.startContainer);
  if (!body || body !== bodyOf(range.endContainer) || !root.contains(body) || body.closest('[hidden],[inert]')) return null;
  const text = selection.toString().trim();
  return text ? {text, range, body} : null;
}

// Decode DSH's session file address per segment (escaped #, ? and spaces
// are filename characters). Never show the transport URI or a foreign session.
export function previewCodePath(address, sessionId) {
  const match = typeof address === 'string' && /^dsh-resource:\/\/file\/session\/([^/?#]+)\/([^?#]+)/.exec(address);
  if (!match) return null;
  try {
    if (decodeURIComponent(match[1]) !== sessionId) return null;
    return match[2].split('/').map(decodeURIComponent).join('/');
  } catch { return null; }
}

const codeNewlines = text => text.replace(/\r\n?/g, '\n');

function codeOffset(body, node, offset) {
  const prefix = body.ownerDocument.createRange();
  prefix.selectNodeContents(body);
  prefix.setEnd(node, offset);
  return codeNewlines(prefix.toString()).length;
}

export function readCodeRange(root, range, source, path) {
  const bodyOf = node => (node.nodeType === 1 ? node : node.parentElement)?.closest(CODE_BODY);
  const body = bodyOf(range.startContainer);
  if (!path || !body || body !== bodyOf(range.endContainer) || !root.contains(body) || body.closest('[hidden],[inert]')) return null;
  // The native CodeBlock renders source text, not its gutter numbers. It
  // removes the final LF; HTML highlighting can normalize CRLF as well.
  const rendered = codeNewlines(body.textContent);
  const expected = codeNewlines(source);
  if (rendered !== expected && rendered !== expected.replace(/\n$/, '')) return null;
  const start = codeOffset(body, range.startContainer, range.startOffset);
  const end = codeOffset(body, range.endContainer, range.endOffset);
  const snippet = rendered.slice(start, end);
  if (!snippet.trim()) return null;
  const firstLine = rendered.slice(0, start).split('\n').length;
  // A selection ending at the next row's start should not attribute code to that row.
  const lastLine = firstLine + snippet.replace(/\n$/, '').split('\n').length - 1;
  const location = `${JSON.stringify(path)}:${firstLine}${lastLine === firstLine ? '' : `-${lastLine}`}`;
  let fenceLength = 3;
  for (const match of snippet.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
  const fence = '`'.repeat(fenceLength);
  const text = `${location}\n${fence}\n${snippet}${snippet.endsWith('\n') ? '' : '\n'}${fence}`;
  return {text, range, body};
}

export function readCodeSelection(root, selection, source, path) {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  return readCodeRange(root, selection.getRangeAt(0), source, path);
}

export function markdownQuotePosition(rects, bounds, size, pointer) {
  const visible = rects.filter(rect => rect.right > rect.left && rect.bottom > rect.top &&
    rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom);
  if (!visible.length || size.width > bounds.right - bounds.left || size.height > bounds.bottom - bounds.top) return null;
  const distance = rect => Math.max(rect.top - pointer.y, pointer.y - rect.bottom, 0) +
    Math.max(rect.left - pointer.x, pointer.x - rect.right, 0);
  const anchor = pointer ? visible.reduce((best, rect) => distance(rect) < distance(best) ? rect : best) : visible[0];
  const gap = 8;
  const above = anchor.top - gap - size.height;
  const x = (Math.max(anchor.left, bounds.left) + Math.min(anchor.right, bounds.right)) / 2;
  return {
    left: Math.max(bounds.left, Math.min(x - size.width / 2, bounds.right - size.width)),
    top: Math.max(bounds.top, Math.min(above >= bounds.top ? above : anchor.bottom + gap, bounds.bottom - size.height)),
  };
}

export function markdownQuoteInput({uiSession, layout}, sessionId, inputActions) {
  if (!sessionId || uiSession.adapter.current.getSnapshot().key !== sessionId ||
      layout.panelInfo.getSnapshot().activePanelId !== null) return null;
  // The session-scoped document slot receives this stable standard prop from
  // uiConversation, just like the native transcript quote action.
  return typeof inputActions?.insertQuote === 'function' ? inputActions : null;
}

function markdownVisibleBounds(body, view) {
  const box = body.getBoundingClientRect();
  const bounds = {left: Math.max(4, box.left), top: 4, right: Math.min(view.innerWidth - 4, box.right), bottom: view.innerHeight - 4};
  for (let node = body; node; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || node.hidden || node.inert) return null;
    if (node === body) continue;
    const clipsX = /^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowX);
    const clipsY = /^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowY);
    if (!clipsX && !clipsY) continue;
    const rect = node.getBoundingClientRect();
    if (clipsX) { bounds.left = Math.max(bounds.left, rect.left); bounds.right = Math.min(bounds.right, rect.right); }
    if (clipsY) { bounds.top = Math.max(bounds.top, rect.top); bounds.bottom = Math.min(bounds.bottom, rect.bottom); }
  }
  return bounds;
}

function sameMarkdownRange(a, b) {
  return a && b && a.startContainer === b.startContainer && a.startOffset === b.startOffset &&
    a.endContainer === b.endContainer && a.endOffset === b.endOffset;
}

export function registerPreviewQuote(ctx, React, t, preferences) {
  const isEnabled = kind => preferences.getSnapshot().preferences.rightSidebar?.[
    kind === 'code' ? 'quoteCodeSelection' : 'quoteMarkdownSelection'] !== false;
  const h = React.createElement;
  const patches = new Map();
  const current = ctx.uiSession.adapter.current;
  const panels = ctx.layout.panelInfo;
  let live = true;
  const disposers = new Set();

  function QuotePreview({Native, nativeProps, kind, path}) {
    const {sessionId, content, inputActions} = nativeProps;
    const root = React.useRef(null);
    const button = React.useRef(null);
    const selected = React.useRef(null);
    const [shown, setShown] = React.useState(false);
    const text = content.text;
    const enabled = React.useSyncExternalStore(preferences.subscribe, () => isEnabled(kind));
    const readSelection = (el, selection) => kind === 'code' ? readCodeSelection(el, selection, text, path) : readMarkdownSelection(el, selection);
    React.useSyncExternalStore(callback => ctx.locale.subscribe(callback), () => ctx.locale.getSnapshot());
    function dismiss() {
      selected.current = null;
      if (button.current) button.current.style.visibility = 'hidden';
      setShown(false);
    }
    function place() {
      const el = root.current, control = button.current, target = selected.current;
      if (!el || !control || !target) return;
      const view = el.ownerDocument.defaultView;
      const {body, range, pointer} = target;
      const bounds = view && el.contains(body) && body.contains(range.startContainer) && body.contains(range.endContainer)
        ? markdownVisibleBounds(kind === 'code' ? body.closest('[data-code-block-content]') : body, view) : null;
      const pos = bounds && markdownQuotePosition([...range.getClientRects()], bounds, control.getBoundingClientRect(), pointer);
      if (!pos) { control.style.visibility = 'hidden'; return; }
      const box = el.getBoundingClientRect();
      control.style.left = `${(pos.left - box.left) / (box.width / el.offsetWidth || 1)}px`;
      control.style.top = `${(pos.top - box.top) / (box.height / el.offsetHeight || 1)}px`;
      control.style.visibility = 'visible';
    }
    React.useLayoutEffect(place);
    React.useLayoutEffect(() => {
      if (!enabled) return;
      const el = root.current;
      const doc = el?.ownerDocument, view = doc?.defaultView;
      if (!view) return;
      dismiss();
      let pointerSelecting = false, previousRange = null, frame = null;
      const schedulePlacement = () => {
        if (!selected.current || frame !== null) return;
        frame = view.requestAnimationFrame(() => { frame = null; place(); });
      };
      const refresh = pointer => {
        if (pointerSelecting || !live || !isEnabled(kind)) return;
        const selection = readSelection(el, doc.getSelection());
        if (!selection) {
          // Tabbing to the button can collapse the document highlight.
          if (selected.current && doc.activeElement === button.current) return;
          previousRange = null;
          dismiss();
          return;
        }
        if (sameMarkdownRange(previousRange, selection.range)) return;
        previousRange = selection.range.cloneRange();
        if (!markdownQuoteInput(ctx, sessionId, inputActions)) { dismiss(); return; }
        selected.current = {...selection, range: previousRange, rawText: previousRange.toString(), pointer};
        setShown(true);
        schedulePlacement();
      };
      const change = () => refresh(null);
      const down = event => {
        if (event.composedPath().includes(button.current)) return;
        dismiss();
        previousRange = null;
        pointerSelecting = event.button === 0 && event.composedPath().includes(el);
      };
      const up = event => {
        if (!pointerSelecting) return;
        pointerSelecting = false;
        refresh(event.pointerType === 'mouse' ? {x: event.clientX, y: event.clientY} : null);
      };
      const cancel = () => { pointerSelecting = false; dismiss(); };
      const keydown = event => {
        if (event.key !== 'Escape' || !selected.current) return;
        if (button.current?.style.visibility === 'visible') event.preventDefault();
        cancel();
      };
      const checkTarget = () => {
        if (current.getSnapshot().key !== sessionId || panels.getSnapshot().activePanelId !== null) cancel();
      };
      const listeners = [[doc, 'selectionchange', change], [doc, 'pointerdown', down, true],
        [doc, 'pointerup', up, true], [doc, 'pointercancel', cancel, true], [doc, 'keydown', keydown, true],
        [doc, 'scroll', schedulePlacement, true], [view, 'resize', schedulePlacement], [view, 'blur', cancel]];
      for (const [target, event, fn, capture] of listeners) target.addEventListener(event, fn, capture);
      const offSession = current.subscribe(checkTarget), offPanel = panels.subscribe(checkTarget);
      const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(schedulePlacement) : null;
      observer?.observe(el);
      const dispose = () => {
        if (!disposers.delete(dispose)) return;
        for (const [target, event, fn, capture] of listeners) target.removeEventListener(event, fn, capture);
        offSession(); offPanel(); observer?.disconnect();
        if (frame !== null) view.cancelAnimationFrame(frame);
        dismiss();
      };
      disposers.add(dispose);
      return dispose;
    }, [sessionId, text, inputActions, enabled]);

    function quote() {
      const el = root.current, captured = selected.current;
      const documentSelection = el?.ownerDocument.getSelection();
      const selection = el && readSelection(el, documentSelection);
      const keyboardSelection = captured && documentSelection?.isCollapsed &&
        el.ownerDocument.activeElement === button.current && el.contains(captured.body) &&
        captured.body.contains(captured.range.startContainer) && captured.body.contains(captured.range.endContainer) &&
        captured.range.toString() === captured.rawText &&
        (kind !== 'code' || readCodeRange(el, captured.range, text, path)?.text === captured.text);
      if (!live || !isEnabled(kind) || !captured || (!keyboardSelection && (!selection ||
          !sameMarkdownRange(captured.range, selection.range) || selection.text !== captured.text))) { dismiss(); return; }
      const input = markdownQuoteInput(ctx, sessionId, inputActions);
      if (!input) { dismiss(); return; }
      if (!input.insertQuote(captured.text)) {
        ctx.contextMenus.notify(t('quoteFailed'), false);
        return;
      }
      // The native insert focuses the composer. Do not clear a new selection there.
      if (documentSelection.rangeCount === 1 && sameMarkdownRange(captured.range, documentSelection.getRangeAt(0))) {
        documentSelection.removeAllRanges();
      }
      dismiss();
    }
    return h('div', {ref: root, className: 'dshsb-markdown-quote-root', 'data-quote-kind': kind}, h('style', null, MARKDOWN_QUOTE_CSS),
      h(Native, nativeProps), enabled && shown && h('button', {ref: button, type: 'button', className: 'dshsb-markdown-quote',
        onPointerDown: event => event.preventDefault(), onClick: quote}, t(kind === 'code' ? 'quoteCode' : 'quoteText')));
  }

  function sync() {
    const entries = new Set(ctx.slots.entriesOfSlot(PREVIEW_QUOTE_SLOT).filter(entry => PREVIEW_QUOTE_ENTRIES.has(entry.options.key)));
    for (const [entry, restore] of patches) if (!entries.has(entry)) { restore(); patches.delete(entry); }
    for (const entry of entries) {
      if (patches.has(entry) || typeof entry.component !== 'function') continue;
      const Native = entry.component;
      const kind = PREVIEW_QUOTE_ENTRIES.get(entry.options.key);
      function PreviewWithQuote(props) {
        if (!live || props.content?.kind !== 'text' || !props.sessionId ||
            typeof props.inputActions?.insertQuote !== 'function') return h(Native, props);
        const path = kind === 'code' ? previewCodePath(props.resourceAddress, props.sessionId) : null;
        if (kind === 'code' && !path) return h(Native, props);
        return h(QuotePreview, {key: props.resourceAddress, Native, nativeProps: props, kind, path});
      }
      entry.component = PreviewWithQuote;
      patches.set(entry, () => { if (entry.component === PreviewWithQuote) entry.component = Native; });
    }
  }
  const off = ctx.slots.subscribe(PREVIEW_QUOTE_SLOT, sync);
  sync();
  return () => {
    live = false;
    off();
    for (const dispose of disposers) dispose();
    for (const restore of patches.values()) restore();
    patches.clear();
  };
}
