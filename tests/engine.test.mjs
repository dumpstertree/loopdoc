// chain engine tests — run against the REAL engine (src/engine.js), node:test.
// Replaces the old /tmp Python replay suite, which was a reimplementation and
// could drift from the JS it pretended to test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stepOnce } from '../src/engine.js'
import { newGlobal, makeGlobalsStore } from '../src/model.js'

let seq = 0
const n = (kind, extra = {}) => ({ id: 'n' + ++seq, kind, x: 0, y: 0, ...extra })
const flow = (a, b, extra = {}) => ({ id: 'f' + ++seq, kind: 'flow', from: a.id, fromPort: 'out', to: b.id, toPort: 'in', amount: 1, ...extra })
const data = (a, ap, b, bp) => ({ id: 'd' + ++seq, kind: 'data', from: a.id, fromPort: ap, to: b.id, toPort: bp })

// run the machine for k steps; pools seed from their init like startSim does
function run(nodes, links, k, mem = { tokens: [] }, assets = []) {
  const log = []
  let a = Object.fromEntries(nodes.filter((x) => x.kind === 'pool').map((x) => [x.id, x.init || 0]))
  for (let i = 0; i < k; i++) a = stepOnce(nodes, links, a, log, mem, assets)
  return { log, mem, a }
}

test('entry fires, chain walks one hop per step, ends, re-fires', () => {
  const src = n('source', { name: 'go' })
  const sink = n('pool', { init: 0 }) // no out edges → chain end here
  const nodes = [src, sink]
  const links = [flow(src, sink)]
  const mem = { tokens: [] }
  const { log } = run(nodes, links, 4, mem)
  assert.ok(log.some((l) => l.includes('chain end')), 'chain end logged')
  run(nodes, links, 6, mem)
  assert.ok(mem.tokens.length >= 1, 'entry re-fired after its chains finished')
})

test('fork duplicates the token to every output', () => {
  const src = n('source')
  const p1 = n('pool', { init: 0 })
  const p2 = n('pool', { init: 0 })
  const links = [flow(src, p1), flow(src, p2)]
  const { a } = run([src, p1, p2], links, 12)
  // each body chain feeds its pool: 1 + 1 per iteration so far, both equal
  assert.equal(a[p1.id], a[p2.id])
  assert.ok(a[p1.id] >= 2, 'both forks ran')
})

test('drain subtracts from every upstream pool, chain continues', () => {
  const src = n('source')
  const pool = n('pool', { init: 5 })
  const dr = n('drain', { drain: 2 })
  const sink = n('pool', { init: 0 })
  const nodes = [src, pool, dr, sink]
  const links = [flow(src, dr), flow(pool, dr), flow(dr, sink)]
  const { log } = run(nodes, links, 8)
  assert.ok(log.some((l) => l.includes('−2') && l.includes('drain')), 'drained 2')
})

test('add is drain’s signed mirror — negative gain subtracts', () => {
  const src = n('source')
  const pool = n('pool', { init: 5 })
  const plus = n('add', { gain: 3 })
  const minus = n('add', { gain: -1 })
  const nodes = [src, pool, plus, minus]
  const links = [flow(src, plus), flow(pool, plus), flow(src, minus), flow(pool, minus)]
  const { log } = run(nodes, links, 6)
  assert.ok(log.some((l) => l.includes('+3')), 'add +3')
  assert.ok(log.some((l) => l.includes('-1')), 'add -1')
})

test('fed pool is a window onto a ⚙ global — ADD write-through moves the global', () => {
  const g = newGlobal('pos_y')
  g.type = 'int'
  g.value = '5'
  const gs = makeGlobalsStore()
  const src = n('source')
  const win = n('pool', { init: 0 })
  const add = n('add', { gain: 1 })
  const gg = n('getg', { gRef: g.id, gName: 'pos_y', gType: 'int' })
  const nodes = [src, win, add, gg]
  const links = [flow(src, win), flow(win, add), data(gg, '__val__', win, '__in__')]
  const mem = { tokens: [], g: gs.vals([g]) }
  run(nodes, links, 10, mem)
  assert.equal(mem.g[g.id], 5 + 1, 'global moved 5 → 6 through the window')
})

test('SET writes the global the chain carries', () => {
  const g = newGlobal('depth')
  g.type = 'int'
  const src = n('source')
  const pool = n('pool', { init: 7 })
  const setg = n('setg', { gRef: g.id, gName: 'depth', gType: 'int' })
  const nodes = [src, pool, setg]
  const links = [flow(src, setg), data(pool, '__int__', setg, '__val__')]
  const mem = { tokens: [], g: { [g.id]: 0 } }
  run(nodes, links, 6, mem)
  assert.equal(mem.g[g.id], 7, 'depth set to pool value')
})

test('ifb routes on wired ⇣a vs custom ⇣b and exposes the verdict', () => {
  const src = n('source')
  const pool = n('pool', { init: 5 })
  const iff = n('ifb', { op: '>', bVal: '3' })
  const yes = n('pool', { init: 0 })
  const no = n('pool', { init: 0 })
  const l = flow(iff, yes)
  l.fromPort = 'true'
  const l2 = flow(iff, no)
  l2.fromPort = 'false'
  const nodes = [src, pool, iff, yes, no]
  const links = [flow(src, iff), data(pool, '__int__', iff, '__a__'), l, l2]
  const mem = { tokens: [] }
  const { log } = run(nodes, links, 8, mem)
  assert.ok(log.some((l) => l.includes('✓')), '5 > 3 took the true branch')
  assert.equal(mem.ifres[iff.id], true, 'verdict readable on mem')
})

test('ifb holds while an operand has no value yet, then proceeds', () => {
  const assets = [
    {
      id: 'as0',
      name: 'late',
      api: [{ id: 'fn0', name: 'val', inputs: [], outputs: [{ id: 'r', name: 'v', type: 'int' }] }],
    },
  ]
  const src = n('source')
  const sys = n('syscall', { calls: [{ asset: 'as0', fn: 'fn0' }], out: { r: 9 } })
  const iff = n('ifb', { op: '>', bVal: '0' })
  const dead = n('pool', { init: 0 })
  const nodes = [src, sys, iff, dead]
  const links = [flow(src, iff), flow(src, sys), data(sys, 'r', iff, '__a__'), flow(iff, dead)]
  const { log } = run(nodes, links, 10, { tokens: [] }, assets)
  assert.ok(log.some((l) => l.includes('holding')), 'held while the producer had not fired')
  assert.ok(log.some((l) => l.startsWith('✓') || l.startsWith('✗')), 'proceeded once the value existed')
})

test('EXIT kills the token and records lastExit', () => {
  const src = n('source')
  const ex = n('exit', { name: 'win' })
  const mem = { tokens: [] }
  const { log } = run([src, ex], [flow(src, ex)], 6, mem)
  assert.equal(mem.lastExit, 'win')
  assert.ok(log.some((l) => l.includes('⏏')), 'exit logged')
  // (the entry has since re-fired — the point is the machine never wedges at a door)
})

test('register pulses every N passes', () => {
  const src = n('source')
  const reg = n('register', { countTo: 2 })
  const sink = n('pool', { init: 0 })
  const nodes = [src, reg, sink]
  const links = [flow(src, reg), flow(reg, sink)]
  const { log } = run(nodes, links, 12)
  assert.ok(log.some((l) => l.includes('pulsed')), 'register pulsed')
})

test('delay releases after its countdown', () => {
  const src = n('source')
  const del = n('delay', { delay: 2 })
  const sink = n('pool', { init: 0 })
  const nodes = [src, del, sink]
  const links = [flow(src, del), flow(del, sink)]
  const { log } = run(nodes, links, 10)
  assert.ok(log.some((l) => l.includes('released')), 'delay released')
})

test('foreach walks the array one iteration at a time, then pulses end', () => {
  const assets = [
    {
      id: 'as1',
      name: 'bags',
      api: [{ id: 'fn1', name: 'list', inputs: [], outputs: [{ id: 'v1', name: 'items', type: 'int[]' }] }],
    },
  ]
  const sys = n('syscall', { calls: [{ asset: 'as1', fn: 'fn1' }], out: { v1: [10, 20, 30] } })
  const fe = n('foreach', { itemType: 'int' })
  const body = n('pool', { init: 0 })
  const after = n('pool', { init: 0 })
  const nodes = [sys, fe, body, after]
  const lEnd = flow(fe, after)
  lEnd.fromPort = 'end'
  const links = [flow(sys, fe), data(sys, 'v1', fe, '__arr__'), flow(fe, body), lEnd]
  const { log, a } = run(nodes, links, 60, { tokens: [] }, assets)
  assert.ok(log.some((l) => l.includes('1/3')), 'iteration 1 ran')
  assert.ok(log.some((l) => l.includes('3/3')), 'iteration 3 ran')
  assert.ok(log.some((l) => l.includes('finished (3)')), 'end pulsed after the last one')
  assert.ok(a[after.id] >= 1, 'end chain fired downstream')
})

test('blocking syscall freezes the chain until clicked', () => {
  const assets = [
    {
      id: 'as2',
      name: 'ui',
      api: [{ id: 'fn2', name: 'ask', inputs: [], outputs: [{ id: 'r', name: 'answer', type: 'int' }] }],
    },
  ]
  const src = n('source')
  const sys = n('syscall', { calls: [{ asset: 'as2', fn: 'fn2' }], block: true })
  const sink = n('pool', { init: 0 })
  const nodes = [src, sys, sink]
  const links = [flow(src, sys), flow(sys, sink)]
  const mem = { tokens: [] }
  const log = []
  let a = {}
  for (let i = 0; i < 6; i++) a = stepOnce(nodes, links, a, log, mem, assets)
  assert.ok(mem.tokens.some((t) => t.wait === 'block'), 'chain frozen at the blocking call')
  mem.tokens.forEach((t) => (t.ready = true)) // the click
  for (let i = 0; i < 6; i++) a = stepOnce(nodes, links, a, log, mem, assets)
  assert.ok(mem.call[sys.id], 'call result stored after the click')
  assert.ok(a[sink.id] >= 1, 'the chain got through to the sink')
})

test('drain, add and SET never self-fire as entries', () => {
  const dr = n('drain')
  const ad = n('add')
  const st = n('setg', { gRef: 'x' })
  const mem = { tokens: [] }
  run([dr, ad, st], [], 3, mem)
  assert.equal(mem.tokens.length, 0, 'silent parts stay silent')
})
