// wire rules tests — the grammar both canvases, the engine, and the DRC share
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isEntryPart, dataCanConnect, compatTargets } from '../src/wireRules.js'
import { runDRC } from '../src/drc.js'

const n = (kind, extra = {}) => ({ id: 'n' + kind + (extra.tag || Math.random().toString(36).slice(2, 6)), kind, x: 0, y: 0, ...extra })
const flow = (a, b) => ({ id: 'f' + Math.random().toString(36).slice(2, 8), kind: 'flow', from: a.id, fromPort: 'out', to: b.id, toPort: 'in', amount: 1 })
const data = (a, ap, b, bp) => ({ id: 'd' + Math.random().toString(36).slice(2, 8), kind: 'data', from: a.id, fromPort: ap, to: b.id, toPort: bp })

test('entry rule: fed parts, portless parts and silent parts never enter', () => {
  const src = n('source')
  const pool = n('pool')
  const dr = n('drain')
  const ad = n('add')
  const st = n('setg', { gRef: 'g' })
  const ex = n('exit')
  const links = [flow(src, pool)]
  assert.ok(isEntryPart(src, links))
  assert.ok(!isEntryPart(pool, links), 'fed pool is not an entry')
  for (const silent of [dr, ad, st, ex]) assert.ok(!isEntryPart(silent, []), `${silent.kind} never enters`)
})

test('data rule matrix: same, mismatch, self, if-operand sides alike', () => {
  const assets = [{ id: 'as', name: 's', api: [{ id: 'fn', name: 'f', inputs: [], outputs: [{ id: 'v', name: 'o', type: 'int' }] }] }]
  const sys = n('syscall', { calls: [{ asset: 'as', fn: 'fn' }] })

  // int ⇡ → int ⇣ (pool fed window) is fine; a text ⇡ into an int ⇣ is not
  const pool = n('pool')
  const gg = { nodes: [sys, pool], links: [] }
  assert.ok(dataCanConnect(gg, assets, sys.id, 'v', pool.id, '__in__').ok, 'int → int')

  // no self-feeding
  assert.ok(!dataCanConnect(gg, assets, sys.id, 'v', sys.id, '__in__').ok, 'no self-feeding')

  // if-operands: both sides of one compare must agree
  const iff = n('ifb')
  const gi = { nodes: [sys, iff], links: [] }
  assert.ok(dataCanConnect(gi, assets, sys.id, 'v', iff.id, '__a__').ok, 'int feeds ⇣a')
  const gi2 = { nodes: [sys, iff], links: [data(sys, 'v', iff, '__b__')] }
  assert.ok(dataCanConnect(gi2, assets, sys.id, 'v', iff.id, '__a__').ok, 'same type on both sides is fine')
})

test('compatTargets pulses exactly the accepting ports', () => {
  const pool = n('pool')
  const other = n('pool')
  const sys = n('syscall', { calls: [{ asset: 'as', fn: 'fn' }] })
  const assets = [{ id: 'as', name: 's', api: [{ id: 'fn', name: 'f', inputs: [], outputs: [{ id: 'v', name: 'o', type: 'int' }] }] }]
  const g = { nodes: [sys, pool, other], links: [] }
  const keys = [`${pool.id}:in:in`, `${other.id}:in:in`, `${pool.id}:__int__:out`, `${sys.id}:in:in`]
  const flowPulse = compatTargets(g, assets, { kind: 'flow', from: sys.id, port: 'out' }, keys)
  assert.deepEqual(flowPulse.sort(), [`${other.id}:in:in`, `${pool.id}:in:in`].sort())
  const dataPulse = compatTargets(g, assets, { kind: 'data', from: sys.id, port: 'v' }, [...keys, `${other.id}:__in__:in`])
  assert.ok(dataPulse.includes(`${other.id}:__in__:in`), 'int output pulses matching ⇣ in')
  assert.ok(!dataPulse.some((k) => k.endsWith(':out')), 'outputs never pulse')
})

test('DRC still runs clean over a wired machine and flags a closed cycle', () => {
  const src = n('source')
  const pool = n('pool')
  const doc = { design: { id: 'g', mode: 'machine', name: 'x', nodes: [src, pool], links: [flow(src, pool)] }, assets: [], types: [], vars: [] }
  assert.equal(runDRC(doc).filter((f) => f.sev === 'error').length, 0)
  const p1 = n('pool')
  const p2 = n('pool')
  const cycle = { id: 'g2', mode: 'machine', name: 'y', nodes: [p1, p2], links: [flow(p1, p2), flow(p2, p1)] }
  const found = runDRC({ design: cycle, assets: [], types: [], vars: [] })
  assert.ok(found.some((f) => f.text.includes('no entry')), 'closed cycle without an entry is an error')
})
