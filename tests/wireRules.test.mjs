// wire rules tests — the grammar both canvases, the engine, and the DRC share
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isEntryPart, dataCanConnect, compatTargets, takesFlow, branchLink } from '../src/wireRules.js'
import { runDRC } from '../src/drc.js'
import { emptyValue, renameTypeInDoc, newNode, typedValue, exitVarsOf } from '../src/model.js'

const n = (kind, extra = {}) => ({ id: 'n' + kind + (extra.tag || Math.random().toString(36).slice(2, 6)), kind, x: 0, y: 0, ...extra })
const flow = (a, b) => ({ id: 'f' + Math.random().toString(36).slice(2, 8), kind: 'flow', from: a.id, fromPort: 'out', to: b.id, toPort: 'in' })
const data = (a, ap, b, bp) => ({ id: 'd' + Math.random().toString(36).slice(2, 8), kind: 'data', from: a.id, fromPort: ap, to: b.id, toPort: bp })

test('entry rule: ENTER doors always enter, nothing else does', () => {
  const en = n('enter')
  const st = n('step')
  const st2 = n('step')
  const stg = n('setg', { gRef: 'g' })
  const ex = n('exit')
  assert.ok(isEntryPart(en, []), 'ENTER is ALWAYS an entry — it cannot be suppressed')
  assert.ok(!isEntryPart(st, [flow(en, st)]), 'a fed step is not an entry')
  assert.ok(!isEntryPart(st2, []), 'an unconnected part no longer self-starts')
  for (const silent of [stg, ex]) assert.ok(!isEntryPart(silent, []), `${silent.kind} never enters`)
})

test('asset ports wire like types — asset ⇡ feeds any, never int', () => {
  const en = n('enter', { vars: [], assets: [{ id: 'ea1', asset: 'as1', name: 'sprites' }] })
  const ib = n('ifb')
  const insp = n('inspect', { objType: 'asset' })
  const g = { nodes: [en, ib, insp], links: [] }
  assert.ok(dataCanConnect(g, [], en.id, 'ea1', insp.id, '__obj__').ok, 'asset → any')
  const bad = dataCanConnect(g, [], en.id, 'ea1', ib.id, '__a__')
  assert.ok(!bad.ok && bad.why.includes('asset'), 'asset → int refused, and the why says so')
})

test('data rule matrix: same, mismatch, self, if-operand sides alike', () => {
  const assets = [{ id: 'as', name: 's', api: [{ id: 'fn', name: 'f', inputs: [], outputs: [{ id: 'v', name: 'o', type: 'int' }] }] }]
  const sys = n('syscall', { calls: [{ asset: 'as', fn: 'fn' }] })

  // int ⇡ → int ⇣ (loop's counted-to window) is fine
  const fr = n('for')
  const gg = { nodes: [sys, fr], links: [] }
  assert.ok(dataCanConnect(gg, assets, sys.id, 'v', fr.id, '__to__').ok, 'int → int')

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
  const act = n('action')
  const fr = n('for')
  const sys = n('syscall', { calls: [{ asset: 'as', fn: 'fn' }] })
  const assets = [{ id: 'as', name: 's', api: [{ id: 'fn', name: 'f', inputs: [], outputs: [{ id: 'v', name: 'o', type: 'int' }] }] }]
  const g = { nodes: [sys, act, fr], links: [] }
  const keys = [`${act.id}:in:in`, `${fr.id}:in:in`, `${fr.id}:out:out`, `${sys.id}:in:in`]
  const flowPulse = compatTargets(g, assets, { kind: 'flow', from: sys.id, port: 'out' }, keys)
  assert.deepEqual(flowPulse.sort(), [`${fr.id}:in:in`, `${act.id}:in:in`].sort())
  const dataPulse = compatTargets(g, assets, { kind: 'data', from: sys.id, port: 'v' }, [...keys, `${fr.id}:__to__:in`])
  assert.ok(dataPulse.includes(`${fr.id}:__to__:in`), 'int output pulses matching ⇣ in')
  assert.ok(!dataPulse.some((k) => k.endsWith(':out')), 'outputs never pulse')
})

test('MACHINE node exposes every ENTER variable as one complete ⇣ list', () => {
  const assets = [{ id: 'as', name: 's', api: [{ id: 'fn', name: 'f', inputs: [], outputs: [{ id: 'v', name: 'o', type: 'int' }] }] }]
  const sys = n('syscall', { calls: [{ asset: 'as', fn: 'fn' }] })
  const m = n('machine', {
    graph: {
      id: 'gm',
      mode: 'machine',
      name: 'm',
      entry: null,
      nodes: [
        n('enter', { name: 'round', vars: [{ id: 'e1', name: 'hp', type: 'int', value: '' }] }),
        n('enter', { name: 'trade', vars: [{ id: 'e2', name: 'ally', type: 'string', value: '' }] }),
      ],
      links: [],
    },
  })
  const g = { nodes: [sys, m], links: [] }
  assert.ok(dataCanConnect(g, assets, sys.id, 'v', m.id, 'e1').ok, 'int ⇡ feeds the ENTER var through the MACHINE node')
  assert.ok(!dataCanConnect(g, assets, sys.id, 'v', m.id, 'e2').ok, 'string var refuses an int — types travel with the var')
})

test('MACHINE node mirrors EXIT variables as one complete ⇡ output list', () => {
  const m = n('machine', {
    graph: {
      id: 'gm',
      mode: 'machine',
      name: 'combat',
      entry: null,
      nodes: [
        n('enter', { name: 'round', vars: [{ id: 'e1', name: 'hp', type: 'int', value: '' }] }),
        n('exit', { name: 'win', vars: [{ id: 'x1', name: 'score', type: 'int', value: '' }] }),
        n('exit', { name: 'flee', vars: [{ id: 'x2', name: 'score', type: 'string', value: '' }] }),
      ],
      links: [],
    },
  })
  const fr = n('for')
  const sink = n('inspect', { objType: 'any' })
  const g = { nodes: [m, fr, sink], links: [] }
  const vs = exitVarsOf(m.graph)
  assert.equal(vs.length, 2, 'every EXIT door’s variables join the MACHINE node’s ⇡ list')
  assert.deepEqual(vs.map((v) => v.exit), ['win', 'flee'], 'each ⇡ is tagged with the door it leaves through')
  assert.equal(vs[1].id, 'x2', 'two doors may announce the same name and keep their own port')
  assert.ok(dataCanConnect(g, [], m.id, 'x1', fr.id, '__to__').ok, 'the int score feeds an ⇣ int above')
  assert.ok(!dataCanConnect(g, [], m.id, 'x2', fr.id, '__to__').ok, 'the string score refuses an int')
  assert.ok(dataCanConnect(g, [], m.id, 'x2', sink.id, '__obj__').ok, 'the string score feeds an ⇣ any')
})

test('DRC still runs clean over a wired machine and flags a closed cycle', () => {
  const en = n('enter', { tag: 'a' })
  const st2 = n('step', { tag: 'b' })
  const doc = { design: { id: 'g', mode: 'machine', name: 'x', nodes: [en, st2], links: [flow(en, st2)] }, assets: [], types: [], vars: [] }
  assert.equal(runDRC(doc).filter((f) => f.sev === 'error').length, 0)
  const p1 = n('step', { tag: 'c' })
  const p2 = n('step', { tag: 'd' })
  const cycle = { id: 'g2', mode: 'machine', name: 'y', nodes: [p1, p2], links: [flow(p1, p2), flow(p2, p1)] }
  const found = runDRC({ design: cycle, assets: [], types: [], vars: [] })
  assert.ok(found.some((f) => f.text.includes('no entry')), 'closed cycle without an entry is an error')
})

// ---- VAR typed fill-in -------------------------------------------------------
const VTYPES = [
  {
    id: 't1',
    name: 'Vec',
    fields: [
      { id: 'f1', name: 'x', typeId: 'int' },
      { id: 'f2', name: 'y', typeId: 'int' },
    ],
  },
  {
    id: 't2',
    name: 'Foe',
    fields: [
      { id: 'f3', name: 'hp', typeId: 'int' },
      { id: 'f4', name: 'pos', typeId: 'Vec' },
      { id: 'f5', name: 'taunts', typeId: 'string[]' },
    ],
  },
]

test('emptyValue shapes a fresh fill-in — structs recurse every field, arrays start empty', () => {
  assert.deepEqual(
    emptyValue('Foe', VTYPES),
    { hp: '', pos: { x: '', y: '' }, taunts: [] },
    'nested struct fields all present, arrays empty lists, bools and leaves blank',
  )
  assert.deepEqual(emptyValue('Foe[]', VTYPES), [], 'arrays begin with no items')
  assert.equal(emptyValue('bool', VTYPES), 'false')
  assert.equal(emptyValue('asset', VTYPES), '', 'asset starts unpicked')
  assert.equal(newNode('var').variable.type, 'string', 'a fresh VAR is a string')
})

test('renaming a type cascades into VAR types — plain and array forms', () => {
  const doc = {
    assets: [],
    vars: [],
    design: {
      nodes: [
        { id: 'a', kind: 'var', variable: { name: 'spawn', type: 'Foe', value: {} } },
        { id: 'b', kind: 'var', variable: { name: 'mob', type: 'Foe[]', value: [] } },
      ],
      links: [],
    },
  }
  const d = renameTypeInDoc(doc, 'Foe', 'Monster')
  assert.equal(d.design.nodes[0].variable.type, 'Monster')
  assert.equal(d.design.nodes[1].variable.type, 'Monster[]')
})

test('DRC flags a VAR with no name and one making a vanished type', () => {
  const nn = n('var', { variable: { name: '', type: 'Vec', value: {} } })
  const ghost = n('var', { variable: { name: 'boo', type: 'Ghost', value: {} } })
  const good = n('var', { variable: { name: 'hero', type: 'Foe', value: {} } })
  const found = runDRC({ design: { nodes: [good], links: [] }, assets: [], types: VTYPES, vars: [] })
  assert.ok(!found.some((f) => f.text.includes('assigns to no name') || f.text.includes('Ghost')), 'a named Foe VAR is clean')
  const bad = runDRC({ design: { nodes: [nn, ghost], links: [] }, assets: [], types: VTYPES, vars: [] })
  assert.ok(bad.some((f) => f.sev === 'warn' && f.text.includes('assigns to no name')), 'nameless VAR warned')
  assert.ok(bad.some((f) => f.sev === 'warn' && f.text.includes('Ghost')), 'vanished type warned')
})

test('VAR is pure data — takes no flow, and its ⇡ carries the picked type', () => {
  const v = n('var', { variable: { name: 'hero', type: 'Foe', value: {} } })
  const step = n('step')
  const fr = n('for')
  const insp = n('inspect', { objType: 'any' })
  assert.ok(!takesFlow(v), 'no flow in or out of a VAR')
  assert.ok(takesFlow(step), 'ordinary flow parts still take flow')
  const g = { nodes: [v, step, fr, insp], links: [] }
  assert.ok(dataCanConnect(g, VTYPES, v.id, '__val__', insp.id, '__obj__').ok, 'Foe ⇡ feeds any ⇣')
  const bad = dataCanConnect(g, VTYPES, v.id, '__val__', fr.id, '__to__')
  assert.ok(!bad.ok && bad.why.toLowerCase().includes('foe'), 'Foe ⇡ refuses an int ⇣ and says why')
  const notyped = n('var', { variable: { name: 'x', type: '', value: '' } })
  const g2 = { nodes: [notyped, insp], links: [] }
  assert.ok(!dataCanConnect(g2, VTYPES, notyped.id, '__val__', insp.id, '__obj__').ok, 'no type picked — no ⇡ port yet')
})

test('typedValue coerces the fill-in — leaves, nested structs, arrays', () => {
  assert.equal(typedValue('int', '42', VTYPES), 42)
  assert.equal(typedValue('bool', 'true', VTYPES), true)
  assert.equal(typedValue('float', '1.5', VTYPES), 1.5)
  assert.deepEqual(
    typedValue(
      'Foe',
      { hp: '3', pos: { x: '1', y: '' }, taunts: ['die', 'run'] },
      VTYPES,
    ),
    { hp: 3, pos: { x: 1, y: 0 }, taunts: ['die', 'run'] },
    'numbers land at every depth, strings stay strings',
  )
  assert.deepEqual(typedValue('int[]', ['7', '8'], VTYPES), [7, 8], 'arrays coerce item by item')
  assert.deepEqual(typedValue('Vec', { x: 1, y: 2 }), { x: 1, y: 2 }, 'without the doc types the shape still passes through')
})

test('DRC flags flow wired into a VAR and a VAR set as entry', () => {
  const v = n('var', { variable: { name: 'hero', type: 'Vec', value: {} } })
  const s = n('step', { tag: 'flowed' })
  const wired = { nodes: [v, s], links: [{ id: 'l1', kind: 'flow', from: s.id, fromPort: 'out', to: v.id, toPort: 'in' }] }
  const found = runDRC({ design: { mode: 'flow', nodes: [v, s], links: wired.links }, assets: [], types: VTYPES, vars: [] })
  assert.ok(found.some((f) => f.sev === 'error' && f.text.includes('has flow wires')), 'flow into a VAR is an error')
  const asEntry = runDRC({ design: { mode: 'flow', entry: v.id, nodes: [v], links: [] }, assets: [], types: VTYPES, vars: [] })
  assert.ok(asEntry.some((f) => f.sev === 'error' && f.text.includes('graph entry')), 'a VAR cannot be the entry')
  const clean = runDRC({ design: { mode: 'flow', nodes: [v], links: [] }, assets: [], types: VTYPES, vars: [] })
  assert.ok(!clean.some((f) => f.text.includes('flow wires') || f.text.includes('graph entry')), 'a quiet VAR raises no flow error')
})

// ---- Ctrl+drag branch-off — the grammar behind grabbing a wire anchor and
// pulling a second connection off of it (both canvases call this) -------------

test('a flow branch shares the run up to the grabbed anchor, then breaks to the new part', () => {
  const [a, b, c] = [n('enter'), n('step'), n('action')]
  const src = { ...flow(a, b), id: 'L', anchors: [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }] }
  const g = { id: 'g', mode: 'machine', name: '', entry: null, nodes: [a, b, c], links: [src] }
  const r = branchLink(g, [], src, 1, c.id, 'in')
  assert.ok(r.ok, r.why)
  assert.equal(r.link.kind, 'flow')
  assert.equal(r.link.from, a.id, 'branch grows from the same source port')
  assert.equal(r.link.fromPort, 'out')
  assert.equal(r.link.to, c.id)
  assert.deepEqual(r.link.anchors, [{ x: 10, y: 10 }, { x: 20, y: 20 }], 'shares the stem up to the grabbed anchor')
  r.link.anchors[0].x = 999
  assert.equal(src.anchors[0].x, 10, 'the stem is a copy — moving the branch never drags the original')
})

test('flow branch rejections echo the wire grammar', () => {
  const [a, b] = [n('enter'), n('step')]
  const v = n('var', { variable: { name: 'x', type: 'int' } })
  const src = { ...flow(a, b), id: 'L', anchors: [{ x: 1, y: 1 }] }
  const g = { id: 'g', mode: 'machine', name: '', entry: null, nodes: [a, b, v], links: [src] }
  assert.match(branchLink(g, [], src, 0, a.id, 'in').why, /itself/, 'no self-feeding')
  assert.match(branchLink(g, [], src, 0, b.id, 'in').why, /already/, 'the wire being branched is itself a duplicate target')
  assert.match(branchLink(g, [], src, 0, v.id, 'in').why, /pure data/, 'VAR takes no flow')
  assert.match(branchLink(g, [], src, 0, 'ghost', 'in').why, /drop the branch/)
})

test('a data branch obeys types, existing connections and the anchor stem too', () => {
  const v = n('var', { variable: { name: 'hp', type: 'int' } })
  const [p1, p2] = [n('for'), n('for')]
  const src = { ...data(v, '__val__', p1, '__to__'), id: 'D', anchors: [{ x: 5, y: 5 }] }
  const g = { id: 'g', mode: 'machine', name: '', entry: null, nodes: [v, p1, p2], links: [src] }
  const ok = branchLink(g, [], src, 0, p2.id, '__to__')
  assert.ok(ok.ok, ok.why)
  assert.equal(ok.link.kind, 'data')
  assert.equal(ok.link.toPort, '__to__')
  assert.deepEqual(ok.link.anchors, [{ x: 5, y: 5 }], 'the branch clones the run so far')
  assert.match(branchLink(g, [], src, 0, p1.id, '__to__').why, /already runs there/, 'the original target is not a new branch')
  const sv = n('var', { variable: { name: 's', type: 'string' } })
  const ssrc = { ...data(sv, '__val__', p1, '__to__'), anchors: [] }
  const g2 = { ...g, nodes: [...g.nodes, sv] }
  assert.match(branchLink(g2, [], ssrc, -1, p2.id, '__to__').why, /type mismatch/, 'string cannot branch into an int window')
})
