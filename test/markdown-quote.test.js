import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  markdownQuoteInput, markdownQuotePosition, previewCodePath, previewPlanBelongsToSession, previewQuoteAvailability,
  readCodeSelection, readMarkdownSelection, registerPreviewQuote,
} from '../src/markdown-quote.js';

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

test('plan Markdown selections stay in the visible plan body', () => {
  const plan = {closest: () => null};
  const endpoint = owner => ({nodeType: 3, parentElement: {
    closest: selector => selector === '[data-plan-preview]' ? owner : null,
  }});
  const range = {startContainer: endpoint(plan), endContainer: endpoint(plan)};
  const selection = {isCollapsed: false, rangeCount: 1, getRangeAt: () => range, toString: () => '  计划步骤  '};
  const root = {contains: node => node === plan};
  assert.deepEqual(readMarkdownSelection(root, selection, 'plan'), {text: '计划步骤', range, body: plan});
  assert.equal(readMarkdownSelection(root, selection), null);
  range.endContainer = endpoint({});
  assert.equal(readMarkdownSelection(root, selection, 'plan'), null);
  range.endContainer = endpoint(plan);
  plan.closest = () => ({inert: true});
  assert.equal(readMarkdownSelection(root, selection, 'plan'), null);
});

function previewTarget() {
  const target = {current: 'one', panel: null, block: undefined, status: new Map()};
  const input = {insertQuote: () => true};
  const ctx = {
    uiSession: {
      adapter: {current: {getSnapshot: () => ({key: target.current})}},
      sessionStatus: {getSnapshot: () => target.status},
    },
    layout: {panelInfo: {getSnapshot: () => ({activePanelId: target.panel})}},
    conversation: {blocks: {storeFor(sessionId) {
      assert.equal(sessionId, 'one');
      return {getSnapshot: () => target.block};
    }}},
  };
  function setPending(kind, sessionId = 'one') {
    target.status = new Map([[sessionId, {pendingInteraction: {kind, sessionId, key: `${sessionId}:${kind}`}}]]);
  }
  return {ctx, input, target, setPending};
}

test('preview quote availability follows the current session, panel, draft phase and composer block', () => {
  const {ctx, input, target, setPending} = previewTarget();
  const available = phase => previewQuoteAvailability(ctx, 'one', input, phase);
  assert.equal(previewQuoteAvailability(ctx, 'one', input), 'quote');
  assert.equal(available('plain'), 'quote');
  for (const phase of ['adjudicating', 'claimed', 'submitting', 'sending']) assert.equal(available(phase), null, phase);
  target.block = {reason: 'Composer unavailable'};
  assert.equal(available('plain'), null);
  target.block = undefined;
  setPending('question', 'two');
  assert.equal(available('plain'), 'quote');
  target.current = 'two';
  assert.equal(available('plain'), null);
  target.current = 'one';
  target.panel = 'settings';
  assert.equal(available('plain'), null);
  target.panel = null;
  assert.equal(previewQuoteAvailability(ctx, 'one', {}, 'plain'), null);
});

test('plan review is distinct from quoting; generic pending interactions disable quotes', () => {
  const {ctx, input, target, setPending} = previewTarget();
  const available = (phase, session) => previewQuoteAvailability(ctx, 'one', input, phase, session);
  setPending('question');
  assert.equal(available('plain'), null);
  assert.equal(markdownQuoteInput(ctx, 'one', input), null);
  setPending('plan-review');
  assert.equal(available('plain'), 'plan-review');
  assert.equal(markdownQuoteInput(ctx, 'one', input), null);
  assert.equal(available('sending'), 'plan-review');
  target.block = {reason: 'Composer unavailable'};
  assert.equal(available('plain'), null);
  target.block = undefined;
  assert.equal(available('plain', {removed: true}), null);
  target.panel = 'settings';
  assert.equal(available('plain'), null);
  target.panel = null;
  assert.equal(previewQuoteAvailability(ctx, 'one', {}, 'plain'), null);
  target.status = new Map();
  target.block = undefined;
  assert.equal(available('plain'), 'quote');
});

test('removed and non-continuable sessions cannot receive preview quotes', () => {
  const {ctx, input} = previewTarget();
  const available = session => previewQuoteAvailability(ctx, 'one', input, 'plain', session);
  assert.equal(available({removed: true}), null);
  assert.equal(available({subagent: {address: {mode: 'one-shot'}}}), null);
  assert.equal(available({subagent: {address: {mode: 'unknown'}}}), null);
  assert.equal(available({removed: false, subagent: {address: {mode: 'continuable'}}}), 'quote');
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

test('durable and temporary plan addresses belong only to their decoded session', () => {
  const durable = 'dsh-resource://plan/a%20b/call%23id';
  assert.equal(previewPlanBelongsToSession(durable, 'a b'), true);
  assert.equal(previewPlanBelongsToSession(durable, 'other'), false);

  for (const mode of ['one-shot', 'continuable', 'unknown']) {
    const subagent = `dsh-resource://plan/subagent/parent/child%20id/${mode}/call%2Fid`;
    assert.equal(previewPlanBelongsToSession(subagent, 'child id'), true);
    assert.equal(previewPlanBelongsToSession(subagent, 'parent'), false);
  }

  const temporary = 'dsh-resource://plan-review/a%20b/window%3Arequest';
  assert.equal(previewPlanBelongsToSession(temporary, 'a b'), true);
  assert.equal(previewPlanBelongsToSession(temporary, 'other'), false);
});

test('plan addresses reject invalid encodings, modes and URI shapes', () => {
  for (const address of [
    undefined,
    'dsh-resource://file/session/a/plan.md',
    'dsh-resource://plan/a',
    'dsh-resource://plan/a/',
    'dsh-resource://plan//call',
    'dsh-resource://plan/a/call/extra',
    'dsh-resource://plan/a/call?view=markdown',
    'dsh-resource://plan/a/call#heading',
    'dsh-resource://plan/a/%ZZ',
    'dsh-resource://plan/subagent/parent/a/unsupported/call',
    'dsh-resource://plan/subagent//a/continuable/call',
    'dsh-resource://plan/subagent/parent/a/continuable/',
    'dsh-resource://plan-review/a',
    'dsh-resource://plan-review/a/request/extra',
    'dsh-resource://plan-review/a/%ZZ',
    'dsh-resource://plan-review/%ZZ/request',
  ]) assert.equal(previewPlanBelongsToSession(address, 'a'), false, String(address));
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

test('only the built-in Markdown, code and plan entries are wrapped across both native slots', () => {
  const native = () => null;
  const entry = key => ({component: native, options: {key}});
  const md = entry('@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown');
  const code = entry('@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code');
  const other = entry('@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text');
  const plan = entry('@deepseek-ai/dsh-client-ui-plan');
  const otherTab = entry('third-party-preview');
  const documentSlot = 'sidebar.right.tab.document', paneSlot = 'sidebar.right.pane.tab';
  const entries = new Map([[documentSlot, [md, code, other]], [paneSlot, [plan, otherTab]]]);
  const listeners = new Map(), unsubscribed = new Set();
  const ctx = {uiSession: {adapter: {current: {}}}, layout: {panelInfo: {}}, slots: {
    entriesOfSlot(slot) { assert.ok(entries.has(slot), slot); return entries.get(slot); },
    subscribe(slot, listener) {
      assert.ok(entries.has(slot), slot);
      assert.equal(listeners.has(slot), false);
      listeners.set(slot, listener);
      return () => { unsubscribed.add(slot); listeners.delete(slot); };
    },
  }};
  const cleanup = registerPreviewQuote(ctx, {}, key => key, {getSnapshot: () => ({preferences: {}})});
  assert.deepEqual(new Set(listeners.keys()), new Set([documentSlot, paneSlot]));
  for (const wrapped of [md, code, plan]) assert.notEqual(wrapped.component, native, wrapped.options.key);
  for (const unmatched of [other, otherTab]) assert.equal(unmatched.component, native, unmatched.options.key);

  const planWrapper = plan.component;
  entries.set(documentSlot, [other]); listeners.get(documentSlot)();
  assert.equal(md.component, native);
  assert.equal(code.component, native);
  assert.equal(plan.component, planWrapper);
  entries.set(documentSlot, [md, code, other]); listeners.get(documentSlot)();
  assert.notEqual(md.component, native);
  assert.notEqual(code.component, native);

  const mdWrapper = md.component;
  entries.set(paneSlot, [otherTab]); listeners.get(paneSlot)();
  assert.equal(plan.component, native);
  assert.equal(md.component, mdWrapper);
  entries.set(paneSlot, [plan, otherTab]); listeners.get(paneSlot)();
  assert.notEqual(plan.component, native);

  cleanup();
  assert.deepEqual(unsubscribed, new Set([documentSlot, paneSlot]));
  assert.equal(listeners.size, 0);
  for (const restored of [md, code, plan]) assert.equal(restored.component, native, restored.options.key);
});
