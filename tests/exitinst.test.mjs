// EXIT REF tests — the instance node that routes to an existing EXIT.
// Covers model (mirrored ports, refs, unique names), engine (exit-via-ref),
// DRC (missing/dupe warnings), and copy/paste re-id of refs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { newNode, dataPorts, dataPortType, resolveExitRef, exitInstVars, exitNameTaken, reidGraph, pruneExitInstLinks, kindMeta, parseDoc, serializeDoc, kindsFor, funcKinds } from '../src/model.js'
import { stepOnce } from '../src/engine.js'
import { runDRC } from '../src/drc.js'

let seq = 0
const n = (kind, extra = {}) => ({ id: 'n' + ++seq, kind, x: 0, y: 0, ...extra })
const flow = (a, b) => ({ id: 'f' + ++seq, kind: 'flow', from: a.id, fromPort: 'out', to: b.id, toPort: 'in' })
const data = (a, ap, b, bp) => ({ id: 'd' + ++seq, kind: 'data', from: a.id, fromPort: ap, to: b.id, toPort: bp })

function run(nodes, links, k, mem = { tokens: [] }, assets = []) {
  const log = []
  for (let i = 0; i < k; i++) stepOnce(nodes, links, log, mem, assets)
  return { log, mem }
}

test('an EXIT REF starts unpicked', () => {
  const part = newNode('exitinst', 10, 20)
  assert.equal(part.exitRef, null, 'picks nothing until the dropdown says so')
  assert.ok(kindMeta(part).shape.rows === 'exitref', 'the card grows the exitref row')
})

test('the machine toolbar offers it, the func toolbar does not', () => {
  assert.ok(kindsFor('machine').includes('exitinst'), 'the machine rail offers the EXIT REF button')
  assert.ok(!funcKinds.includes('exitinst'), 'a func body can not — it has no machine doors to route to')
})

test('mirrored ⇣ ports follow the target EXIT live', () => {
  const x = { id: 'x1', kind: 'exit', name: 'win', vars: [{ id: 'xv1', name: 'score', type: 'int', value: '7' }] }
  const i = { id: 'i1', kind: 'exitinst', exitRef: 'x1' }
  const g = { id: 'g1', mode: 'machine', nodes: [x, i], links: [] }
  const dp = dataPorts(i, [], [], g)
  assert.deepEqual(dp.in.map((p) => p.id + ':' + p.type), ['xv1:int'], 'the instance mirrors the door’s vars')
  assert.deepEqual(dp.out, [], 'an instance is a sink — it never outputs')
  // edit the target: add a var, change a type — the instance follows with no repatch
  x.vars.push({ id: 'xv2', name: 'loot', type: 'str[]' })
  const dp2 = dataPorts(i, [], [], g)
  assert.deepEqual(dp2.in.map((p) => p.id), ['xv1', 'xv2'], 'added var appears on the instance')
  // dangling target: ports vanish, the ref itself stays put
  const lost = { ...g, nodes: [{ ...x, id: 'x9' }] }
  assert.deepEqual(dataPorts(i, [], [], lost).in, [], 'missing target shows no ports')
  assert.equal(resolveExitRef(lost, i), null, 'refs only chain to REAL exits')
  const fake = { ...g, nodes: [{ ...i, id: 'i2', exitRef: 'i1' }] }
  assert.equal(resolveExitRef(fake, fake.nodes[0]), null, 'a ref never targets another ref')
})

test('dataPortType sees the mirrored port so wiring validates', () => {
  const x = { id: 'x1', kind: 'exit', vars: [{ id: 'xv1', name: 'score', type: 'int' }] }
  const i = { id: 'i1', kind: 'exitinst', exitRef: 'x1' }
  const g = { id: 'g1', nodes: [x, i], links: [] }
  assert.equal(dataPortType(g, [], 'i1', 'xv1', 'in'), 'int', 'the mirrored port type resolves through the graph')
  assert.equal(dataPortType(g, [], 'i1', 'ghost', 'in'), null, 'unknown port ids stay gone')
})

test('wires into a ref are pruned when the target vars change', () => {
  const p = n('add', { name: 'calc', aVal: 4, bVal: 5 })
  const x = { id: 'x1', kind: 'exit', vars: [{ id: 'xv1', name: 'score', type: 'int' }] }
  const i = { id: 'i1', kind: 'exitinst', exitRef: 'x1' }
  const g = { id: 'g1', nodes: [p, x, i], links: [data(p, '__val__', i, 'xv1')] }
  assert.equal(g.links.length, 1, 'wire sits on the mirrored port')
  x.vars = [] // the door loses its variable…
  const healed = pruneExitInstLinks(g, [], 'x1')
  assert.deepEqual(healed.links, [], '…and the ref’s stale wire is dropped')
})

test('EXIT names must be unique — taken check ignores case and blanks', () => {
  const g = { nodes: [{ id: 'a', kind: 'exit', name: 'Victory' }, { id: 'b', kind: 'exit', name: '' }] }
  assert.ok(exitNameTaken(g, 'victory', 'b'), 'case-insensitive collision')
  assert.ok(!exitNameTaken(g, 'defeat', 'b'), 'free names are free')
  assert.ok(!exitNameTaken(g, '', 'b'), 'the empty name is exempt')
})

test('a ref hits its target: same door, same name, wired values', () => {
  const en = n('enter', { name: 'go' })
  const a = n('step', { name: 'a' })
  const b = n('step', { name: 'b' })
  const calc = n('add', { name: 'calc', aVal: 4, bVal: 5 })
  const x = { id: 'x1', kind: 'exit', name: 'win', vars: [{ id: 'xv1', name: 'score', type: 'int', value: '7' }] }
  const i = { id: 'i1', kind: 'exitinst', exitRef: 'x1' }
  const nodes = [en, a, b, calc, x, i]
  const links = [flow(en, a), flow(a, x), flow(en, b), flow(b, i), data(calc, '__val__', i, 'xv1')]
  const { log, mem } = run(nodes, links, 12)
  assert.ok(log.some((l) => l.includes('⏏ win — machine exit · announces score: 7')), 'real door announces the fallback')
  assert.ok(log.some((l) => l.includes('(via ref)') && l.includes('score: 9')), 'the ref announces the WIRED value 4+5 under the target’s name')
  assert.equal(mem.lastExit, 'win', 'the machine remembers exiting through the target door')
  assert.ok(mem.exits && mem.exits['x1'], 'values are recorded under the TARGET exit id')
  const viaRef = log.find((l) => l.includes('(via ref)'))
  assert.ok(viaRef.includes('⏏ win'), 'the ref reports the target’s name, not its own')
})

test('a ref whose target vanished drops the machine exit', () => {
  const en = n('enter', { name: 'go' })
  const b = n('step', { name: 'b' })
  const i = { id: 'i1', kind: 'exitinst', exitRef: 'gone' }
  const { log, mem } = run([en, b, i], [flow(en, b), flow(b, i)], 6)
  assert.ok(log.some((l) => l.includes('target EXIT missing')), 'the drop is visible in the walkthrough')
  assert.notEqual(mem.lastExit, 'win', 'no exit name is invented')
})

test('DRC: refs get their own warnings and only real exits count', () => {
  const mk = (nodes, links = []) => runDRC({ design: { mode: 'machine', nodes, links }, assets: [], types: [], vars: [] })
  const en = n('enter', { name: 'go' })
  const lost = { id: 'i2', kind: 'exitinst', exitRef: 'gone' }
  const dupe1 = { id: 'x1', kind: 'exit', name: 'win' }
  const dupe2 = { id: 'x2', kind: 'exit', name: 'WIN' }
  const withInst = mk([en, dupe1, dupe2, { id: 'p1', kind: 'exitinst' }, lost])
  assert.ok(withInst.some((f) => f.sev === 'error' && f.text.includes('used by more than one EXIT')), 'duplicate exit names are flagged')
  assert.ok(withInst.some((f) => f.sev === 'error' && f.text.includes('no EXIT selected')), 'an unpicked ref is an error')
  assert.ok(withInst.some((f) => f.sev === 'error' && f.text.includes('target EXIT is missing')), 'a lost ref is an error')
  const noReal = mk([en, lost])
  assert.ok(noReal.some((f) => f.text.includes('no EXIT part')), 'refs never count as an outcome — only real doors do')
  const target = { id: 'x1', kind: 'exit', vars: [{ id: 'xv1', name: 'score', type: 'int' }] }
  const instNode = { id: 'i1', kind: 'exitinst', exitRef: 'x1' }
  const unwired = mk([en, target, instNode], [flow(en, target), flow(en, instNode)])
  assert.ok(!unwired.some((f) => f.text.includes('no EXIT part')), 'a real exit silences the no-EXIT note')
  assert.ok(unwired.some((f) => f.sev === 'warn' && f.text.includes('nothing wired in')), 'unwired mirrored ⇣ gets its own warning')
})

test('the parent MACHINE node only grows ports for REAL exits', () => {
  const x = { id: 'x1', kind: 'exit', name: 'win', vars: [] }
  const i = { id: 'i1', kind: 'exitinst', exitRef: 'x1' }
  const m = { id: 'm1', kind: 'machine', graph: { id: 'gm', nodes: [x, i], links: [] } }
  const outs = kindMeta(m).ports(m)
  assert.deepEqual(outs.map((p) => p.id), ['x1'], 'the ref adds no extra flow-out port above')
  assert.deepEqual(dataPorts(m, []).out, [], 'its ⇡ mirror still comes only from the real door’s vars')
})

test('copy/paste remaps the ref when the target comes along', () => {
  const x = { id: 'x1', kind: 'exit', name: 'win' }
  const i = { id: 'i1', kind: 'exitinst', exitRef: 'x1' }
  const clip = JSON.parse(JSON.stringify({ id: 'g1', mode: 'machine', nodes: [x, i], links: [] }))
  const fresh = reidGraph(clip)
  const nx = fresh.nodes.find((q) => q.kind === 'exit')
  const ni = fresh.nodes.find((q) => q.kind === 'exitinst')
  assert.equal(ni.exitRef, nx.id, 'the paste keeps its own copy wired, not the original door')
  // pasted WITHOUT the target: the old id survives — it resolves against the
  // still-existing original, and DRC catches it if that one is gone too
  const alone = JSON.parse(JSON.stringify({ id: 'g2', mode: 'machine', nodes: [i], links: [] }))
  const alone2 = reidGraph(alone)
  assert.equal(alone2.nodes[0].exitRef, 'x1', 'a lone ref keeps pointing at the original by id')
})

test('a loaded doc dedupes clashing EXIT names and keeps refs intact', () => {
  const mk = (exits) => ({ app: 'loopdoc-composer', design: { mode: 'machine', nodes: exits, links: [] }, assets: [], types: [], vars: [] })
  const doc = mk([
    { id: 'e1', kind: 'enter' },
    { id: 'x1', kind: 'exit', name: 'win' },
    { id: 'x2', kind: 'exit', name: 'WIN' },
    { id: 'i1', kind: 'exitinst', exitRef: 'x2' },
  ])
  const back = parseDoc(serializeDoc(doc))
  const ex = back.design.nodes.filter((q) => q.kind === 'exit')
  const names = ex.map((q) => String(q.name).toLowerCase())
  assert.equal(new Set(names).size, 2, 'the clash heals on load')
  const inst = back.design.nodes.find((q) => q.kind === 'exitinst')
  assert.equal(inst.exitRef, 'x2', 'the ref followed the id, not the name — the renamed target is still its target')
})
