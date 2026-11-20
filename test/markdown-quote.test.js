import {test} from 'node:test';
import assert from 'node:assert/strict';
import {markdownQuoteInput, markdownQuotePosition, previewCodePath, readCodeSelection, readMarkdownSelection, registerPreviewQuote} from '../src/markdown-quote.js';

const rect = (left, top, right, bottom) => ({left, top, right, bottom});

test('quote placement follows the pointer line and fits the visible viewport', () => {
  const bounds = rect(100, 50, 360, 250);
  const size = {width: 76, height: 28};
  const first = rect(125, 54, 330, 74);
  const last = rect(310, 126, 410, 144);
  assert.deepEqual(markdownQuotePosition([first, last], bounds, size), {left: 189.5, top: 82});
  assert.deepEqual(markdownQuotePosition([first, last], bounds, size, {x: 345, y: 140}), {left: 284, top: 90});
  assert.equal(markdownQuotePosition([rect(130, 8, 200, 20)], bounds, size), null);
  assert.equal(markdownQuotePosition([rect(150, 80, 150, 95)], bounds, size), null);
  assert.equal(markdownQuotePosition([first], bounds, {...size, width: 300}), null);
});

test('only a nonblank, single selection contained by one Markdown body can be quoted', () => {
  const body = {closest: () => null}, other = {closest: () => null};
  const root = {contains: node => node === body};
  const end = owner => ({nodeType: 3, parentElement: {closest: () => owner}});
  const startContainer = end(body);
  const range = {startContainer, endContainer: end(body)};
  const selection = {isCollapsed: false, rangeCount: 1, getRangeAt: () => range, toString: () => '  第一段\n第二段  '};
  assert.deepEqual(readMarkdownSelection(root, selection), {text: '第一段\n第二段', range, body});
  assert.equal(readMarkdownSelection(root, {...selection, isCollapsed: true}), null);
  assert.equal(readMarkdownSelection(root, {...selection, rangeCount: 2}), null);
  assert.equal(readMarkdownSelection(root, {...selection, toString: () => ' \n '}), null);
  range.endContainer = end(other);
  assert.equal(readMarkdownSelection(root, selection), null);
  range.endContainer = end(body);
  body.closest = () => ({hidden: true});
  assert.equal(readMarkdownSelection(root, selection), null);
});

test('preview resolves only the visible current conversation’s native quote input', () => {
  let current = 'one', panel = null;
  const quotes = [];
  const input = {insertQuote(text) { quotes.push(text); return true; }};
  const ctx = {
    uiSession: {adapter: {current: {getSnapshot: () => ({key: current})}}},
    layout: {panelInfo: {getSnapshot: () => ({activePanelId: panel})}},
  };
  assert.equal(markdownQuoteInput(ctx, 'one', input).insertQuote('一段\n文字'), true);
  assert.deepEqual(quotes, ['一段\n文字']);
  current = 'two';
  assert.equal(markdownQuoteInput(ctx, 'one', input), null);
  current = 'one'; panel = 'settings';
  assert.equal(markdownQuoteInput(ctx, 'one', input), null);
  panel = null;
  assert.equal(markdownQuoteInput(ctx, 'one', {}), null);
});

test('code addresses preserve escaped filename characters and belong to the preview session', () => {
  const addr = 'dsh-resource://file/session/a%20b/src/a%20%23%3F.ts?view=code#L5';
  assert.equal(previewCodePath(addr, 'a b'), 'src/a #?.ts');
  assert.equal(previewCodePath(addr, 'other'), null);
  assert.equal(previewCodePath('dsh-resource://file/session/a/a%ZZ.ts', 'a'), null);
  assert.equal(previewCodePath('dsh-resource://file/absolute/a.ts', 'a'), null);
});

function codeRange(rendered, from, to) {
  const body = {textContent: rendered, closest: () => null, ownerDocument: {createRange() {
    let end;
    return {selectNodeContents: () => {}, setEnd(node, offset) { end = node.start + offset; },
      toString: () => rendered.slice(0, end)};
  }}};
  const token = start => ({nodeType: 3, start, parentElement: {closest: selector => selector.includes('[data-code-block-content]') ? body : null}});
  const range = {startContainer: token(from), startOffset: 0, endContainer: token(to), endOffset: 0};
  const selection = {rangeCount: 1, isCollapsed: false, getRangeAt: () => range};
  const root = {contains: node => node === body};
  return {body, range, root, selection};
}

test('code quotes contain exact selected indentation, source locations, and a safe enclosing fence', () => {
  const snippet = '  const s = `x`;\n\n\t// ```  \n';
  const source = `header\n${snippet}footer`;
  const {selection, root} = codeRange(source, 7, 7 + snippet.length);
  assert.equal(readCodeSelection(root, selection, source, 'src/ui.ts').text,
    `"src/ui.ts":2-4\n\`\`\`\`\n${snippet}\`\`\`\``);
  const short = codeRange('a\r\n  xyz', 6, 8);
  assert.equal(readCodeSelection(short.root, short.selection, 'a\r\n  xyz\r\n', 'app.py').text, '"app.py":2\n```\nyz\n```');
});

test('code quoting ignores whitespace, stale text, hidden previews and ranges outside the code body', () => {
  const {selection, range, body, root} = codeRange('  a', 0, 2);
  const read = (source = '  a') => readCodeSelection(root, selection, source, 'app.py');
  assert.equal(read(), null);
  range.endContainer.start = 3;
  assert.ok(read());
  assert.equal(read('  b'), null);
  body.closest = () => ({hidden: true});
  assert.equal(read(), null);
  body.closest = () => null;
  range.endContainer = {nodeType: 3, parentElement: {closest: () => null}};
  assert.equal(read(), null);
});

test('only the built-in Markdown and code slot entries are wrapped and the wrappers are reversible', () => {
  const native = () => null;
  const md = {component: native, options: {key: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown'}};
  const code = {component: native, options: {key: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code'}};
  const other = {component: native, options: {key: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text'}};
  let entries = [md, code, other], sync, unsubscribed = false;
  const ctx = {uiSession: {adapter: {current: {}}}, layout: {panelInfo: {}}, slots: {
    entriesOfSlot(slot) { assert.equal(slot, 'sidebar.right.tab.document'); return entries; },
    subscribe(slot, listener) { assert.equal(slot, 'sidebar.right.tab.document'); sync = listener; return () => { unsubscribed = true; }; },
  }};
  const cleanup = registerPreviewQuote(ctx, {}, key => key, {getSnapshot: () => ({preferences: {}})});
  assert.notEqual(md.component, native);
  assert.notEqual(code.component, native);
  assert.equal(other.component, native);
  entries = [other]; sync();
  assert.equal(md.component, native);
  assert.equal(code.component, native);
  entries = [md, code, other]; sync();
  assert.notEqual(md.component, native);
  assert.notEqual(code.component, native);
  cleanup();
  assert.equal(unsubscribed, true);
  assert.equal(md.component, native);
  assert.equal(code.component, native);
});
