import test from 'node:test'
import assert from 'node:assert/strict'
import { fuzzyRank } from '../src/fuzzy.js'

const items = [
  { id: 'step', label: 'STEP', hint: 'plain step in the loop — flow passes through' },
  { id: 'event', label: 'EVENT', hint: 'an event that fires when flow reaches it' },
  { id: 'condition', label: 'CONDITION', hint: 'test a condition — flow leaves through TRUE or FALSE' },
  { id: 'choice', label: 'CHOICE', hint: 'player/loop decision — one exit port per option' },
  { id: 'load', label: 'LOAD', hint: 'load a 📦 asset into memory' },
  { id: 'log', label: 'LOG', hint: 'print a line to the console' },
  { id: 'assetref', label: 'ASSET REF', hint: 'reference a declared asset by name' },
]
const ids = (q) => fuzzyRank(items, q).map((i) => i.id)

test('empty query keeps the original order', () => {
  assert.deepEqual(ids(''), items.map((i) => i.id))
})

test('exact label wins', () => {
  assert.equal(ids('step')[0], 'step')
})

test('characters must appear in order', () => {
  assert.deepEqual(ids('psets'), []) // 's' after the trailing p exists nowhere
})

test('prefix beats scattered letters', () => {
  assert.equal(ids('co')[0], 'condition') // CHOICE also matches, but scattered
})

test('word-start bonus in the hint surfaces it', () => {
  assert.ok(ids('fire').includes('event')) // "fires" in the EVENT hint
})

test('label match outranks hint prose', () => {
  // ASSET REF contains "asset" in its label; LOAD only mentions it in prose
  assert.deepEqual(ids('asset').slice(0, 2), ['assetref', 'load'])
})

test('shorter label wins ties', () => {
  assert.equal(ids('l')[0], 'log') // LOG vs LOAD, both plain starts
})

test('no matches returns empty list', () => {
  assert.deepEqual(ids('xyzqq'), [])
})
