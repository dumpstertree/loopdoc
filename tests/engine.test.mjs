// chain engine tests — run against the REAL engine (src/engine.js), node:test.
// Replaces the old /tmp Python replay suite, which was a reimplementation and
// could drift from the JS it pretended to test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stepOnce, dataValue } from '../src/engine.js'
import { newGlobal, makeGlobalsStore, enterVarsOf } from '../src/model.js'

let seq = 0
const n = (kind, extra = {}) => ({ id: 'n' + ++seq, kind, x: 0, y: 0, ...extra })
const flow = (a, b, extra = {}) => ({ id: 'f' + ++seq, kind: 'flow', from: a.id, fromPort: 'out', to: b.id, toPort: 'in', ...extra })
const data = (a, ap, b, bp) => ({ id: 'd' + ++seq, kind: 'data', from: a.id, fromPort: ap, to: b.id, toPort: bp })

// run the machine for k steps; the sim state (mem + log) lives inside stepOnce
function run(nodes, links, k, mem = { tokens: [] }, assets = []) {
  const log = []
  for (let i = 0; i < k; i++) stepOnce(nodes, links, log, mem, assets)
  return { log, mem }
}

test('entry fires, chain walks one hop per step, ends, re-fires', () => {
  const en = n('enter', { name: 'go' })
  const sink = n('step', { name: 'sink' }) // no out edges → chain end here
  const nodes = [en, sink]
  const links = [flow(en, sink)]
  const mem = { tokens: [] }
  const { log } = run(nodes, links, 4, mem)
  assert.ok(log.some((l) => l.includes('chain end')), 'chain end logged')
  run(nodes, links, 6, mem)
  assert.ok(mem.tokens.length >= 1, 'entry re-fired after its chains finished')
})

test('fork duplicates the token to every output', () => {
  const en = n('enter')
  const s1 = n('step', { name: 'one' })
  const s2 = n('step', { name: 'two' })
  const links = [flow(en, s1), flow(en, s2)]
  const { log } = run([en, s1, s2], links, 12)
  // both body chains reach their end — the fork really split
  const ends = log.filter((l) => l.includes('chain end'))
  assert.ok(ends.some((l) => l.includes('one')), 'fork branch one ran')
  assert.ok(ends.some((l) => l.includes('two')), 'fork branch two ran')
})

test('action waits for a click, then fires', () => {
  const en = n('enter')
  const ac = n('action', { name: 'attack' })
  const sk = n('step', { name: 'done' })
  const nodes = [en, ac, sk]
  const links = [flow(en, ac), flow(ac, sk)]
  const mem = { tokens: [] }
  const { log } = run(nodes, links, 4, mem)
  assert.ok(log.some((l) => l.includes('waiting for click')), 'chain held at the action')
  mem.tokens.forEach((t) => (t.ready = true)) // the click
  const again = run(nodes, links, 6, mem)
  assert.ok(again.log.some((l) => l.includes('attack fired')), 'the click released the action')
  assert.ok(again.log.some((l) => l.includes('done — chain end')), 'the chain got through')
})

test('SET writes the global the chain carries', () => {
  const g = newGlobal('depth')
  g.type = 'int'
  const src = n('enter')
  const made = n('var', { variable: { name: 'depth', type: 'int', value: '7' } })
  const setg = n('setg', { gRef: g.id, gName: 'depth', gType: 'int' })
  const nodes = [src, made, setg]
  const links = [flow(src, setg), data(made, '__val__', setg, '__val__')]
  const mem = { tokens: [], g: { [g.id]: 0 } }
  run(nodes, links, 6, mem)
  assert.equal(mem.g[g.id], 7, 'depth set from the wired VAR value')
})

test('ifb routes on wired ⇣a vs custom ⇣b and exposes the verdict', () => {
  const src = n('enter')
  const made = n('var', { variable: { name: 'score', type: 'int', value: '5' } })
  const iff = n('ifb', { op: '>', bVal: '3' })
  const yes = n('step', { name: 'yes' })
  const no = n('step', { name: 'no' })
  const l = flow(iff, yes)
  l.fromPort = 'true'
  const l2 = flow(iff, no)
  l2.fromPort = 'false'
  const nodes = [src, made, iff, yes, no]
  const links = [flow(src, iff), data(made, '__val__', iff, '__a__'), l, l2]
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
  const src = n('enter')
  const sys = n('syscall', { calls: [{ asset: 'as0', fn: 'fn0' }], out: { r: 9 } })
  const iff = n('ifb', { op: '>', bVal: '0' })
  const dead = n('step')
  const nodes = [src, sys, iff, dead]
  const links = [flow(src, iff), flow(src, sys), data(sys, 'r', iff, '__a__'), flow(iff, dead)]
  const { log } = run(nodes, links, 10, { tokens: [] }, assets)
  assert.ok(log.some((l) => l.includes('holding')), 'held while the producer had not fired')
  assert.ok(log.some((l) => l.startsWith('✓') || l.startsWith('✗')), 'proceeded once the value existed')
})

test('EXIT kills the token and records lastExit', () => {
  const en = n('enter')
  const ex = n('exit', { name: 'win' })
  const mem = { tokens: [] }
  const { log } = run([en, ex], [flow(en, ex)], 6, mem)
  assert.equal(mem.lastExit, 'win')
  assert.ok(log.some((l) => l.includes('⏏')), 'exit logged')
  // (the door has since re-fired — the point is the machine never wedges at a door)
})

test('EXIT variables announce values out — wired ⇣ wins, the card value is the fallback', () => {
  const src = n('enter')
  const made = n('var', { variable: { name: 'loot', type: 'int', value: '12' } })
  const ex = n('exit', {
    name: 'win',
    vars: [
      { id: 'x1', name: 'gold', type: 'int', value: '' },
      { id: 'x2', name: 'party', type: 'string[]', value: 'goblin, orc' },
    ],
  })
  const mem = { tokens: [] }
  const nodes = [src, made, ex]
  const links = [flow(src, ex), data(made, '__val__', ex, 'x1')]
  const { log } = run(nodes, links, 6, mem)
  assert.ok(
    log.some((l) => l.includes('⏏ win') && l.includes('gold: 12') && l.includes('party: [goblin, orc]')),
    'the exit logs both announcements',
  )
  const said = mem.exits[ex.id]
  assert.equal(said.name, 'win', 'the door is remembered by name')
  assert.equal(said.vars[0].val, 12, '⇣ gold took the wired VAR value')
  assert.deepEqual(said.vars[1].val, ['goblin', 'orc'], '⇣ party fell back to the comma list typed on the card')
})

test('foreach walks the array one iteration at a time, then pulses end', () => {
  const assets = [
    {
      id: 'as1',
      name: 'bags',
      api: [{ id: 'fn1', name: 'list', inputs: [], outputs: [{ id: 'v1', name: 'items', type: 'int[]' }] }],
    },
  ]
  const en = n('enter')
  const sys = n('syscall', { calls: [{ asset: 'as1', fn: 'fn1' }], out: { v1: [10, 20, 30] } })
  const fe = n('foreach', { itemType: 'int' })
  const body = n('step', { name: 'body' })
  const after = n('step', { name: 'after' })
  const nodes = [en, sys, fe, body, after]
  const lEnd = flow(fe, after)
  lEnd.fromPort = 'end'
  const links = [flow(en, sys), flow(sys, fe), data(sys, 'v1', fe, '__arr__'), flow(fe, body), lEnd]
  const { log } = run(nodes, links, 60, { tokens: [] }, assets)
  assert.ok(log.some((l) => l.includes('1/3')), 'iteration 1 ran')
  assert.ok(log.some((l) => l.includes('3/3')), 'iteration 3 ran')
  assert.ok(log.some((l) => l.includes('finished (3)')), 'end pulsed after the last one')
  assert.ok(log.some((l) => l.includes('after — chain end')), 'end chain fired downstream')
})

test('blocking syscall freezes the chain until clicked', () => {
  const assets = [
    {
      id: 'as2',
      name: 'ui',
      api: [{ id: 'fn2', name: 'ask', inputs: [], outputs: [{ id: 'r', name: 'answer', type: 'int' }] }],
    },
  ]
  const src = n('enter')
  const sys = n('syscall', { calls: [{ asset: 'as2', fn: 'fn2' }], block: true })
  const sink = n('step', { name: 'sink' })
  const nodes = [src, sys, sink]
  const links = [flow(src, sys), flow(sys, sink)]
  const mem = { tokens: [] }
  const log = []
  for (let i = 0; i < 6; i++) stepOnce(nodes, links, log, mem, assets)
  assert.ok(mem.tokens.some((t) => t.wait === 'block'), 'chain frozen at the blocking call')
  mem.tokens.forEach((t) => (t.ready = true)) // the click
  for (let i = 0; i < 6; i++) stepOnce(nodes, links, log, mem, assets)
  assert.ok(mem.call[sys.id], 'call result stored after the click')
  assert.ok(log.some((l) => l.includes('sink — chain end')), 'the chain got through to the sink')
})

test('silent parts never self-fire as entries', () => {
  const dr = n('setg', { gRef: 'x' })
  const ad = n('getg', { gRef: 'x' })
  const st = n('ifb', { op: '>', bVal: '3' })
  const mem = { tokens: [] }
  run([dr, ad, st], [], 3, mem)
  assert.equal(mem.tokens.length, 0, 'silent parts stay silent')
})

test('unconnected step and var parts never self-fire — entries are explicit', () => {
  const seed = n('var', { variable: { name: 'seed', type: 'int', value: '3' } })
  const st = n('step')
  const iff = n('ifb', { op: '>', bVal: '3' })
  const mem = { tokens: [] }
  run([seed, st, iff], [], 3, mem)
  assert.equal(mem.tokens.length, 0, 'nothing self-started')
})

test('ENTER always starts chains and publishes its variables as data', () => {
  const en = n('enter', { name: 'door', vars: [{ id: 'v1', name: 'hits', type: 'int', value: '4' }] })
  const iff = n('ifb', { op: '>', bVal: '3' })
  const yes = n('step', { name: 'yes' })
  const l = flow(iff, yes)
  l.fromPort = 'true'
  const nodes = [en, iff, yes]
  const links = [flow(en, iff), data(en, 'v1', iff, '__a__'), l]
  const { log } = run(nodes, links, 8, { tokens: [] })
  assert.ok(log.some((x) => x.startsWith('✓') && x.includes('4 > 3')), 'enter variable fed the compare')
  assert.ok(log.some((x) => x.includes('yes — chain end')), 'the true chain reached the sink')
})

test('ENTER array variables publish as lists — a foreach iterates them', () => {
  const en = n('enter', { vars: [{ id: 'v1', name: 'mobs', type: 'int[]', value: '10, 20, 30' }] })
  const fe = n('foreach', { itemType: 'int' })
  const body = n('step', { name: 'body' })
  const nodes = [en, fe, body]
  const links = [flow(en, fe), data(en, 'v1', fe, '__arr__'), flow(fe, body)]
  const { log } = run(nodes, links, 40, { tokens: [] })
  assert.ok(log.some((x) => x.includes('loaded [10, 20, 30]')), 'comma list became an array')
  assert.ok(log.some((x) => x.includes('item="30"')), 'iterated to the last item')
  assert.ok(log.filter((x) => x.includes('body — chain end')).length >= 3, 'every iteration ran')
})

// ---- array tools — pure data; a foreach's `loaded [...]` log reveals results
test('APPEND adds one value to the end of an array', () => {
  const en = n('enter', {
    vars: [
      { id: 'v1', name: 'xs', type: 'int[]', value: '1, 2' },
      { id: 'v2', name: 'nine', type: 'int', value: '9' },
    ],
  })
  const ap = n('append', { itemType: 'int' })
  const fe = n('foreach', { itemType: 'int' })
  const body = n('step', { name: 'body' })
  const nodes = [en, ap, fe, body]
  const links = [flow(en, fe), data(en, 'v1', ap, '__arr__'), data(en, 'v2', ap, '__val__'), data(ap, '__arr__', fe, '__arr__'), flow(fe, body)]
  const { log } = run(nodes, links, 40, { tokens: [] })
  assert.ok(log.some((x) => x.includes('loaded [1, 2, 9]')), 'value appended')
})

test('JOIN concatenates, REMOVE cuts by value, REMOVE AT cuts by index', () => {
  const en = n('enter', {
    vars: [
      { id: 'v1', name: 'xs', type: 'int[]', value: '3, 1, 2' },
      { id: 'v2', name: 'tail', type: 'int[]', value: '8' },
      { id: 'v3', name: 'one', type: 'int', value: '1' },
    ],
  })
  const jn = n('join', { itemType: 'int' })
  const rm = n('remove', { itemType: 'int' })
  const ra = n('removeat', { itemType: 'int' })
  const fe = n('foreach', { itemType: 'int' })
  const body = n('step', { name: 'body' })
  const nodes = [en, jn, rm, ra, fe, body]
  const links = [
    flow(en, fe),
    data(en, 'v1', jn, '__a__'),
    data(en, 'v2', jn, '__b__'),
    data(jn, '__arr__', rm, '__arr__'),
    data(en, 'v3', rm, '__val__'),
    data(rm, '__arr__', ra, '__arr__'),
    data(en, 'v3', ra, '__index__'), // 1 → drops the element at index 1
    data(ra, '__arr__', fe, '__arr__'),
    flow(fe, body),
  ]
  const { log } = run(nodes, links, 40, { tokens: [] })
  assert.ok(log.some((x) => x.includes('loaded [3, 8]')), 'joined → [3,1,2,8], removed 1 → [3,2,8], cut index 1 → [3, 8]')
})

test('SORT orders primitives and struct items by a picked field', () => {
  const assets = [
    {
      id: 'asf',
      name: 'roster',
      api: [{ id: 'ff', name: 'foes', inputs: [], outputs: [{ id: 'fo', name: 'foes', type: 'Foe[]' }] }],
    },
  ]
  const sys = n('syscall', { calls: [{ asset: 'asf', fn: 'ff' }] })
  const en = n('enter', { vars: [{ id: 'v1', name: 'xs', type: 'int[]', value: '3, 1, 2' }] })
  const sortP = n('sort', { itemType: 'int' })
  const sortF = n('sort', { itemType: 'Foe', field: 'hp' })
  const feP = n('foreach', { itemType: 'int' })
  const feF = n('foreach', { itemType: 'Foe' })
  const nodes = [sys, en, sortP, sortF, feP, feF]
  const links = [
    data(en, 'v1', sortP, '__arr__'),
    data(sortP, '__arr__', feP, '__arr__'),
    data(sys, 'fo', sortF, '__arr__'),
    data(sortF, '__arr__', feF, '__arr__'),
  ]
  const mem = { tokens: [], call: { [sys.id]: { fo: [{ hp: 3 }, { hp: 1 }] } } }
  assert.deepEqual(dataValue(nodes, links, mem, feP.id, '__arr__').val, [1, 2, 3], 'numbers sorted numerically')
  assert.deepEqual(
    dataValue(nodes, links, mem, feF.id, '__arr__').val.map((x) => x.hp),
    [1, 3],
    'struct items sorted by ⇡ hp',
  )
})

test('CLONE publishes a deep copy — mutating it never touches the base value', () => {
  const assets = [
    {
      id: 'asc',
      name: 'roster',
      api: [{ id: 'fc', name: 'foes', inputs: [], outputs: [{ id: 'fo', name: 'foes', type: 'Foe[]' }] }],
    },
  ]
  const sys = n('syscall', { calls: [{ asset: 'asc', fn: 'fc' }] })
  const cl = n('clone', { vType: 'Foe[]' })
  const fe = n('foreach', { itemType: 'Foe' })
  const nodes = [sys, cl, fe]
  const links = [data(sys, 'fo', cl, '__val__'), data(cl, '__val__', fe, '__arr__')]
  const mem = { tokens: [], call: { [sys.id]: { fo: [{ hp: 3 }] } } }
  const d = dataValue(nodes, links, mem, fe.id, '__arr__')
  assert.deepEqual(d.val, [{ hp: 3 }], 'the copy reads like the base')
  d.val[0].hp = 99 // scribble on the copy
  assert.equal(mem.call[sys.id].fo[0].hp, 3, 'base value untouched after the copy mutated')
})

// ---- 📦 door assets — ENTER passes doc assets in, just like variables ----
test('ENTER 📦 door publishes the picked asset as data', () => {
  const assets = [{ id: 'as1', kind: 'art', name: 'sprites', api: [] }]
  const en = n('enter', { vars: [], assets: [{ id: 'ea1', asset: 'as1', name: 'sprites' }] })
  const insp = n('inspect', { objType: 'asset' })
  const nodes = [en, insp]
  const links = [data(en, 'ea1', insp, '__obj__')]
  const d = dataValue(nodes, links, { tokens: [], assets }, insp.id, '__obj__')
  assert.equal(d.val?.name, 'sprites', 'the asset handle flows through the data wire')
  const empty = dataValue(nodes, links, { tokens: [] }, insp.id, '__obj__')
  assert.equal(empty.val, null, 'nothing to resolve the handle against — no value yet')
})

test('a sim run leaves the doc assets on mem so 📦 doors resolve inside', () => {
  const assets = [{ id: 'as1', kind: 'audio', name: 'theme', api: [] }]
  const en = n('enter', { vars: [], assets: [{ id: 'ea1', asset: 'as1', name: 'theme' }] })
  const body = n('step')
  const mem = { tokens: [] }
  run([en, body], [flow(en, body)], 1, mem, assets)
  const insp = n('inspect', { objType: 'asset' })
  const d = dataValue([en, body, insp], [flow(en, body), data(en, 'ea1', insp, '__obj__')], mem, insp.id, '__obj__')
  assert.equal(d.val?.name, 'theme', 'stepOnce rode the asset store on mem')
})

test('enterVarsOf lists 📦 doors among the MACHINE node ⇣ inputs', () => {
  const en = n('enter', {
    name: 'door',
    vars: [{ id: 'v1', name: 'lives', type: 'int', value: '3' }],
    assets: [{ id: 'ea1', asset: 'as1', name: 'sprites' }],
  })
  const list = enterVarsOf({ nodes: [en] })
  assert.deepEqual(
    list.map((v) => [v.name, v.type, v.enter]),
    [
      ['lives', 'int', 'door'],
      ['sprites', 'asset', 'door'],
    ],
    'vars first, then 📦 — one complete ⇣ list',
  )
})

test('VAR ⇡ reads through a data wire as its typed runtime value', () => {
  const v = n('var', { variable: { name: 'count', type: 'int', value: '5' } })
  const iff = n('ifb', { op: '>', bVal: '3' }) // unwired side would take the custom value — the wire wins
  const nodes = [v, iff]
  const links = [data(v, '__val__', iff, '__a__')]
  const d = dataValue(nodes, links, {}, iff.id, '__a__')
  assert.equal(d.val, 5, 'the "5" fill-in arrives as a number')
  assert.ok(d.from.includes('count'), 'provenance names the variable')
})
