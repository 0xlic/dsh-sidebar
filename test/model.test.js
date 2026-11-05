import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalize, arrange, move, toggle, OWN_ID, replaceComponent} from '../src/model.js';

test('navigation adapter preserves child ownership, injection and store', () => {
  const original = () => {}, replacement = () => {};
  const entry = {component: original, children: {'sidebar.brand.mark': {kind:'single',scope:'root'}}, inject: () => ({}), store: {}, locale:'sidebar', options:{priority:0}};
  const before = {...entry};
  const restore = replaceComponent(entry, replacement);
  assert.equal(entry.component, replacement);
  for (const key of ['children','inject','store','locale','options']) assert.equal(entry[key], before[key]);
  restore();
  assert.deepEqual(entry, before);
  restore();
  assert.deepEqual(entry, before);
});
test('adapter cleanup does not overwrite a newer component', () => {
  const entry = {component: () => {}}, later = () => {};
  const restore = replaceComponent(entry, () => {});
  entry.component = later;
  restore();
  assert.equal(entry.component, later);
});
const rows = [{id:'a',order:0},{id:'b',order:10},{id:'c',order:20},{id:OWN_ID,order:50}];
test('normalization rejects malformed data and protects the manager', () => {
  const state = normalize({settings:{order:['a','a',null],hidden:[OWN_ID,'a','a',42]}});
  assert.deepEqual(state.settings,{order:['a'],hidden:['a']});
  assert.deepEqual(normalize(null).sidebar,{order:[],hidden:[]});
});
test('default preserves original order', () => {
  assert.deepEqual(arrange(rows,normalize(null).sidebar),rows);
});
test('custom order appends new plugins', () => {
  assert.deepEqual(arrange(rows,{order:['c','a'],hidden:[]}).map(x=>x.id),['c','a','b',OWN_ID]);
});
test('hidden manager remains visible even with tampered data', () => {
  assert.deepEqual(arrange(rows,{order:[],hidden:['a',OWN_ID]}).map(x=>x.id),['b','c',OWN_ID]);
});
test('move includes hidden rows and preserves absent identities', () => {
  let state=normalize({sidebar:{order:['a','b','c',OWN_ID,'absent'],hidden:['b']}});
  state=move(state,'sidebar',rows,'c',-1);
  assert.deepEqual(state.sidebar.order,['a','c','b',OWN_ID,'absent']);
  assert.deepEqual(state.sidebar.hidden,['b']);
});
test('toggle can restore hidden rows but never hides manager', () => {
  let state=toggle(normalize(null),'settings','a');
  assert.deepEqual(state.settings.hidden,['a']);
  assert.deepEqual(toggle(state,'settings','a').settings.hidden,[]);
  assert.deepEqual(toggle(state,'settings',OWN_ID),state);
});
test('boundary movement is harmless and leaves input immutable', () => {
  const state=normalize(null), before=structuredClone(state);
  assert.deepEqual(move(state,'sidebar',rows,'a',-1),state);
  move(state,'sidebar',rows,'b',-1);
  assert.deepEqual(state,before);
});
test('reset restores all builtin navigation', () => {
  assert.deepEqual(arrange(rows,normalize(null).settings),rows);
});
