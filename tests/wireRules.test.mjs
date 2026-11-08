// wire rules tests — the grammar both canvases, the engine, and the DRC share
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isEntryPart, dataCanConnect, compatTargets, takesFlow, branchLink, valueWireRisks } from '../src/wireRules.js'
import { runDRC } from '../src/drc.js'
import { emptyValue, renameTypeInDoc, newNode, typedValue, exitVarsOf, syncMath, patchNode, pruneLinks, dataPorts, dataPortType, kindMeta } from '../src/model.js'

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

// ---- ledger parts and the flow grammar ------------------------------------
test('ledger grammar: GET LEDGER is pure data, SET LEDGER passes the chain through', () => {
  const gl = n('getledger', { lRef: 's1', lName: 'hp', lType: 'int', lVarId: 'lv1' })
  const sl = n('setledger', { lRef: 's1', lName: 'hp', lType: 'int', lVarId: 'lv1' })
  const gg = n('getg', { gRef: 'g1', gName: 'hp', gType: 'int' })
  const sg = n('setg', { gRef: 'g1', gName: 'hp', gType: 'int' })
  const step = n('step')
  assert.ok(!takesFlow(gl), 'GET LEDGER takes no flow — it sits beside the chain')
  assert.ok(!takesFlow(gg), 'GET GLOBAL likewise')
  assert.ok(takesFlow(sl), 'SET LEDGER takes flow in and out — the chain carries the write')
  assert.ok(takesFlow(sg), 'SET GLOBAL wears the same pass-through pair')
  // GET LEDGER ⇡ publishes the ledger value; SET LEDGER ⇣ is fed to write
  const fr = n('for')
  const g = { nodes: [gl, sl, fr], links: [] }
  assert.ok(dataCanConnect(g, [], gl.id, '__val__', fr.id, '__to__').ok, 'GET LEDGER ⇡ int feeds an ⇣ int')
  assert.ok(dataCanConnect(g, [], fr.id, '__i__', sl.id, '__val__').ok, 'SET LEDGER ⇣ still takes its value wire')
  assert.ok(!dataCanConnect(g, [], sl.id, '__val__', fr.id, '__to__').ok, 'the write ⇣ is not a feed source')
  // DRC: a GET LEDGER wired into the flow or set as entry is flagged, a quiet one is clean
  const wired = { id: 'lf', kind: 'flow', from: step.id, fromPort: 'out', to: gl.id, toPort: 'in' }
  const found = runDRC({ design: { mode: 'flow', nodes: [gl, step], links: [wired] }, assets: [], types: [], vars: [] })
  assert.ok(found.some((f) => f.sev === 'error' && f.text.includes('flow wires')), 'flow into GET LEDGER is an error')
  const asEntry = runDRC({ design: { mode: 'flow', entry: gl.id, nodes: [gl], links: [] }, assets: [], types: [], vars: [] })
  assert.ok(asEntry.some((f) => f.sev === 'error' && f.text.includes('graph entry')), 'GET LEDGER cannot be the entry')
  const clean = runDRC({ design: { mode: 'flow', nodes: [sl, gl, step], links: [{ ...wired, from: sl.id, to: step.id }] }, assets: [], types: [], vars: [] })
  assert.ok(!clean.some((f) => f.text.includes('flow wires')), 'SET LEDGER on the chain raises no flow error')
})

// ---- STEP typed variables --------------------------------------------------
test('STEP grows typed ⇣ inputs and ⇡ outputs that wire like any other ports', () => {
  const st = n('step', {
    inVars: [{ id: 'i1', name: 'hp', type: 'int' }],
    outVars: [{ id: 'o1', name: 'roll', type: 'int' }],
  })
  const fr = n('for')
  const insp = n('inspect', { objType: 'any' })
  const g = { nodes: [st, fr, insp], links: [] }
  assert.ok(dataCanConnect(g, [], st.id, 'o1', fr.id, '__to__').ok, 'STEP ⇡ int feeds an ⇣ int')
  assert.ok(dataCanConnect(g, [], fr.id, '__i__', st.id, 'i1').ok, 'an int ⇡ feeds STEP ⇣')
  const st2 = n('step', { outVars: [{ id: 'o2', name: 'msg', type: 'string' }] })
  const bad = dataCanConnect({ nodes: [st2, fr], links: [] }, [], st2.id, 'o2', fr.id, '__to__')
  assert.ok(!bad.ok && bad.why.toLowerCase().includes('int'), 'type mismatch still explains itself')
  const v = n('var', { variable: { name: 'x', type: 'string', value: '' } })
  const gv = { nodes: [st, v], links: [] }
  assert.ok(!dataCanConnect(gv, [], v.id, '__val__', st.id, 'i1').ok, 'string VAR cannot feed an int ⇣')
  assert.ok(takesFlow(st), 'STEP still passes the chain through')
  // renaming a type cascades into STEP variables too
  const doc = { assets: [], vars: [], design: { nodes: [{ ...st, id: 's1', x: 0, y: 0 }], links: [] } }
  const d = renameTypeInDoc(doc, 'int', 'Foe')
  assert.equal(d.design.nodes[0].inVars[0].type, 'Foe', '⇣ type follows the rename')
  assert.equal(d.design.nodes[0].outVars[0].type, 'Foe', '⇡ type follows the rename')
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

// ---- math parts — add/sub/mul/div/mod share one operand grammar ----------
test('math operands accept int and float only', () => {
  const aInt = n('var', { variable: { name: 'hp', type: 'int', value: 7 } })
  const aFlt = n('var', { variable: { name: 'rate', type: 'float', value: 1.5 } })
  const aStr = n('var', { variable: { name: 'who', type: 'string', value: 'x' } })
  const add = n('add')
  assert.ok(dataCanConnect({ nodes: [aInt, add], links: [] }, [], aInt.id, '__val__', add.id, '__a__').ok, 'an int feeds ⇣ a')
  assert.ok(dataCanConnect({ nodes: [aFlt, add], links: [] }, [], aFlt.id, '__val__', add.id, '__b__').ok, 'a float feeds ⇣ b')
  const bad = dataCanConnect({ nodes: [aStr, add], links: [] }, [], aStr.id, '__val__', add.id, '__a__')
  assert.ok(!bad.ok && bad.why.includes('math parts take int or float'), 'a string is refused with an explanation')
})

test('math ⇡ learns float from a float operand and reverts on unwrap', () => {
  const flt = n('var', { variable: { name: 'rate', type: 'float', value: 1.5 } })
  const add = n('add')
  const g = { nodes: [flt, add], links: [data(flt, '__val__', add, '__a__')] }
  const synced = syncMath(g, [], [])
  const learned = synced.nodes.find((x) => x.id === add.id)
  assert.equal(learned.rType, 'float', 'a float operand makes the ⇡ result a float')
  const back = syncMath({ ...g, links: [] }, [], [])
  assert.equal(back.nodes.find((x) => x.id === add.id).rType, 'int', 'with no float side it falls back to int')
})

test('math ⇡ learns float from a decimal custom value', () => {
  const add = n('add', { aVal: '3', bVal: '1.5' })
  const g = syncMath({ nodes: [add], links: [] }, [], [])
  assert.equal(g.nodes.find((x) => x.id === add.id).rType, 'float', 'a decimal custom value counts as a float side')
  const add2 = n('add', { aVal: '3', bVal: '2' })
  const whole = syncMath({ nodes: [add2], links: [] }, [], [])
  assert.equal(whole.nodes.find((x) => x.id === add2.id).rType, 'int', 'whole custom values keep the result int')
})

test('DRC: call input with a card value is no longer blind', () => {
  const assets = [{ id: 'asa', name: 'sys', api: [{ id: 'fb', name: 'mv', inputs: [{ id: 'p1', name: 'to', type: 'int' }], outputs: [] }] }]
  const bare = n('syscall', { calls: [{ asset: 'asa', fn: 'fb' }] })
  const fed = { ...bare, cVals: { p1: '7' } }
  const g = (nodes) => runDRC({ design: { mode: 'machine', nodes, links: [] }, assets, types: [], vars: [] })
  assert.ok(g([bare]).some((f) => f.text.includes('runs blind')), 'unwired and untyped warns')
  assert.ok(!g([fed]).some((f) => f.text.includes('runs blind')), 'the card value silences it')
})


// ---- node patches must never prune ports that still exist ----
test('editing a node keeps its live ports — STEP flow-in and FUNC ⇣ survive patches', () => {
  const en = n('enter')
  const st = n('step')
  const l = flow(en, st)
  const g = { nodes: [en, st], links: [l] }
  const renamed = pruneLinks(patchNode(g, st.id, { name: 'renamed step' }), [], st.id, [])
  assert.ok(renamed.links.some((x) => x.id === l.id), 'renaming a STEP keeps its incoming flow (implicit in port)')

  const fn = { id: 'f9', graph: { nodes: [{ kind: 'enter', vars: [{ id: 'e1', name: 'to', type: 'vector2' }, { id: 'e2', name: 'speed', type: 'int' }] }], links: [] } }
  const gv = n('var')
  const fc = n('func', { func: 'f9' })
  const d1 = data(gv, 'out', fc, 'e1')
  const d2 = data(gv, 'out', fc, 'e2')
  const g2 = { nodes: [gv, fc], links: [d1, d2] }
  const edited = pruneLinks(patchNode(g2, fc.id, { cVals: { e1: { x: 3, y: 4 } } }), [], fc.id, [fn])
  assert.equal(edited.links.length, 2, 'a vector2 card-value edit keeps every FUNC input wire')
})

// ---- and/or parts — growable bool slots on every canvas ----
test('and/or offer bool ⇣ slots and one bool ⇡ on all three canvases', () => {
  const an = newNode('and', 0, 0)
  const or = newNode('or', 0, 0)
  assert.ok(an.slots === 2 && or.slots === 2, 'new and/or spawn with two slots')
  for (const k of ['and', 'or'])
    assert.deepEqual(kindMeta({ kind: k }).canvas, ['flow', 'machine', 'func'], `${k} sits on flow, machine and func`)
  const dp = dataPorts(an, [], [], null)
  assert.deepEqual(dp.in.map((p) => p.id), ['__s0__', '__s1__'], 'two positional slot ports')
  assert.ok(dp.in.every((p) => p.type === 'bool'), 'every slot takes bool')
  assert.deepEqual(dp.out.map((p) => [p.id, p.type]), [['__bool__', 'bool']], 'one bool verdict out')
})

test('the + ⇣ button grows another slot — ports, ids and types follow', () => {
  const an = newNode('and', 0, 0)
  const grown = { ...an, slots: 3 }
  const dp = dataPorts(grown, [], [], null)
  assert.deepEqual(dp.in.map((p) => [p.id, p.name]), [['__s0__', 'slot 1'], ['__s1__', 'slot 2'], ['__s2__', 'slot 3']], 'slot 3 appears')
  assert.equal(dataPortType({ nodes: [grown], links: [] }, [], grown.id, '__s2__', 'in'), 'bool', 'the new slot is typed bool')
})

test('editing an and/or keeps its slot wires — renaming and card values never prune', () => {
  const t = n('var')
  const an = n('and')
  const d1 = data(t, '__val__', an, '__s0__')
  const d2 = data(t, '__val__', an, '__s1__')
  const g = { nodes: [t, an], links: [d1, d2] }
  const renamed = pruneLinks(patchNode(g, an.id, { name: 'gate' }), [], an.id, [])
  assert.equal(renamed.links.length, 2, 'renaming keeps both slot wires')
  const grown = pruneLinks(patchNode(renamed, an.id, { slots: 4 }), [], an.id, [])
  assert.equal(grown.links.length, 2, 'growing to four slots keeps the two existing wires')
})

test('DRC: an unfed and/or warns, a typed or wired slot silences it', () => {
  const bare = n('and')
  const fed = n('and', { cVals: { __s0__: 'true' } })
  const wired = n('or')
  const src = n('var')
  const g = (nodes, links) => runDRC({ design: { mode: 'machine', nodes, links }, assets: [], types: [], vars: [] })
  const warns = (r) => r.filter((f) => f.text.includes('verdict stays empty'))
  assert.ok(warns(g([bare], [])).length === 1, 'no slot fed, no card value — warns')
  assert.ok(!warns(g([fed], [])).length, 'a card-typed slot silences it')
  assert.ok(!warns(g([wired, src], [data(src, '__val__', wired, '__s1__')])).length, 'a wired slot silences it')
  const partial = g([{ ...bare, slots: 3 }], [data(src, '__val__', bare, '__s0__')])
  assert.ok(partial.some((f) => f.text.includes('unwired, untyped ⇣ slot is simply ignored')), 'a blank slot among fed ones is an info, not a warn')
})

// ---- value-wire ordering: the rule that decides which data wires draw red ----
const mg = (nodes, links, entry = null) => ({ mode: 'machine', nodes, links, ...(entry ? { entry } : {}) })

test('ordering: a ⇡ fed ahead of its reader is guaranteed, the same wire reversed races', () => {
  const en = n('enter')
  const a = n('step', { tag: 'a', outVars: [{ id: 'v', type: 'int' }] })
  const b = n('step', { tag: 'b', inVars: [{ id: 'v', type: 'int' }] })
  const fwd = mg([en, a, b], [flow(en, a), flow(a, b), data(a, 'v', b, 'v')], en.id)
  assert.ok(!valueWireRisks(fwd).length, 'ENTER ▸ A ▸ B: A always ran before B')
  const rev = mg([en, a, b], [flow(en, b), flow(b, a), data(a, 'v', b, 'v')], en.id)
  const risks = valueWireRisks(rev)
  assert.ok(risks.length === 1 && risks[0].origin === a.id, 'B ▸ A: reading A at B is a race, blamed on A')
})

test('ordering: a part on a side branch never dominates the join', () => {
  const en = n('enter')
  const a = n('step', { tag: 'a', outVars: [{ id: 'v', type: 'int' }] })
  const b = n('step', { tag: 'b' })
  const c = n('step', { tag: 'c', inVars: [{ id: 'v', type: 'int' }] })
  const g = mg([en, a, b, c], [flow(en, a), flow(a, c), flow(en, b), flow(b, c), data(a, 'v', c, 'v')], en.id)
  const risks = valueWireRisks(g)
  assert.ok(risks.length === 1 && risks[0].origin === a.id, 'A runs beside B — it may not have run when C reads it')
})

test('ordering: made values (VAR / GET GLOBAL / ENTER) are order-free', () => {
  const en = n('enter')
  const v = n('var', { variable: { name: 'seed', type: 'int', value: 1 } })
  const gg = n('getg', { gRef: 'g' })
  const st = n('step', { inVars: [{ id: 'v1', type: 'int' }, { id: 'v2', type: 'int' }, { id: 'v3', type: 'int' }] })
  const g = mg([en, v, gg, st], [flow(en, st), data(v, '__val__', st, 'v1'), data(gg, '__val__', st, 'v2'), data(en, en.id, st, 'v3')], en.id)
  assert.ok(!valueWireRisks(g).length, 'nothing fires: those values exist from the start of the run')
})

test('ordering: a math ⇡ inherits the guarantee of the wires feeding it', () => {
  const sys = n('syscall', { calls: [{ asset: 'as', fn: 'fn' }] })
  const en = n('enter')
  const st = n('step', { inVars: [{ id: 'v', type: 'int' }] })
  const add = n('add')
  const links = [flow(en, sys), flow(en, st), data(sys, 'v', add, '__a__'), data(add, '__out__', st, 'v')]
  const risks = valueWireRisks(mg([en, sys, st, add], links, en.id))
  assert.ok(risks.length === 1 && risks[0].origin === sys.id, 'the demand chain runs back to the call, which may not have run')
  const fed = [flow(en, sys), flow(sys, add), flow(add, st), data(sys, 'v', add, '__a__'), data(add, '__out__', st, 'v')]
  assert.ok(!valueWireRisks(mg([en, sys, st, add], fed, en.id)).length, 'park the fold in the chain and the call dominates the read')
})

test('ordering: value wires that chain back to themselves are flagged as a cycle', () => {
  const en = n('enter')
  const m1 = n('add')
  const m2 = n('mul')
  const links = [flow(en, m1), flow(m1, m2), data(m1, '__a__', m2, '__b__'), data(m2, '__out__', m1, '__a__')]
  const risks = valueWireRisks(mg([en, m1, m2], links, en.id))
  assert.ok(risks.length === 2 && risks.every((r) => r.kind === 'cycle'), 'neither fold can ever be built')
})

test('ordering: a loop’s ⇡item/⇡index cover every body reader', () => {
  const en = n('enter')
  const fe = n('foreach', { itemType: 'unit' })
  const st = n('step', { inVars: [{ id: 'it', type: 'unit' }] })
  const g = mg([en, fe, st], [flow(en, fe), flow(fe, st), data(fe, '__item__', st, 'it')], en.id)
  assert.ok(!valueWireRisks(g).length, 'the FOR part itself is what publishes its item — the chain cannot reach a body without it')
})

test('DRC reports the racing wire with the same verdict the canvas draws red', () => {
  const en = n('enter')
  const a = n('step', { tag: 'a', outVars: [{ id: 'v', type: 'int' }] })
  const b = n('step', { tag: 'b', inVars: [{ id: 'v', type: 'int' }] })
  const doc = {
    name: 'x',
    design: { id: 'g1', name: 'loop', mode: 'flow', nodes: [en, a, b], links: [flow(en, b), flow(b, a), data(a, 'v', b, 'v')], entry: en.id },
  }
  const findings = runDRC(doc)
  assert.ok(
    findings.some((f) => f.sev === 'warn' && f.text.includes('may read') && f.text.includes('wire drawn red')),
    'the DRC says the ⇡ may not have run, and points at the red wire',
  )
})
