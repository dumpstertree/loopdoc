// ƒ functions — doc-level definitions that own their own body graph, picked by
// FUNC parts on a machine canvas. The body is where the function's parts will
// eventually live, so loading must heal it like any other graph.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newDoc, newFunc, newGraph, newNode, newFuncGraph, kindsFor, funcKinds, funcPorts, enterVarsOf, exitVarsOf, resolveGraph, replaceGraph, serializeDoc, parseDoc } from '../src/model.js'

test('a fresh doc carries the ƒ FUNCTIONS list beside types/globals/assets', () => {
  const d = newDoc('Turn-Based RPG')
  assert.ok(Array.isArray(d.funcs), 'the doc owns a funcs list')
  assert.equal(d.funcs.length, 0, 'a new document defines no functions yet')
})

test('newFunc reserves storage for the future parts of a function', () => {
  const f = newFunc('apply damage')
  assert.ok(typeof f.id === 'string' && f.id.startsWith('fn_'), 'functions are addressable by id')
  assert.equal(f.name, 'apply damage', 'the name is what a FUNC dropdown shows')
  assert.equal(f.note, '', 'an optional note rides the definition')
  assert.ok(f.graph, 'the body graph exists from the start')
  assert.equal(f.graph.mode, 'func', 'its body is its own func graph — not a machine graph')
  assert.equal(f.graph.name, 'apply damage', 'the body is named after the function')
  assert.equal(f.graph.nodes.length, 2, 'ENTER and EXIT are born with the body')
  assert.deepEqual(f.graph.nodes.map((n) => n.kind), ['enter', 'exit'], 'one permanent door and one permanent end')
  assert.equal(f.graph.nodes[0].name, 'enter', 'default door name')
  assert.equal(f.graph.nodes[1].name, 'exit', 'default end name')
  assert.equal(f.graph.entry, f.graph.nodes[0].id, 'the body knows where its chains start')
  assert.deepEqual(f.graph.links, [], 'and so are its wires')
})

test('a FUNC part is a machine part and starts unpicked', () => {
  const part = newNode('func', 10, 20)
  assert.equal(part.func, null, 'picks nothing until the dropdown says so')
  assert.ok(kindsFor('machine').includes('func'), 'the machine toolbar offers the FUNC button')
  assert.ok(kindsFor('flow').includes('func'), 'the graph canvas offers it too — a call sits on any canvas')
})

test('a func canvas offers everything a machine canvas does — minus the doors', () => {
  assert.ok(funcKinds.includes('func'), 'a func body may call other functions — recursion is open')
  assert.ok(!funcKinds.includes('enter'), 'ENTER never comes off the func toolbar')
  assert.ok(!funcKinds.includes('exit'), 'nor does EXIT')
  for (const k of kindsFor('machine'))
    if (k !== 'enter' && k !== 'exit')
      assert.ok(funcKinds.includes(k), 'every other machine part belongs in a func body')
})

test('a picked FUNC survives save and load', () => {
  const d = newDoc('RPG')
  const fn = newFunc('apply damage')
  d.funcs.push(fn)
  const body = newNode('action', 0, 0)
  body.name = 'hp'
  fn.graph.nodes.push(body)
  const back = parseDoc(serializeDoc(d))
  assert.equal(back.funcs.length, 1, 'the definition round-trips')
  assert.equal(back.funcs[0].name, 'apply damage', 'and keeps its name')
  assert.equal(back.funcs[0].graph.nodes.length, 3, 'the body keeps its parts beside its permanent doors')
  assert.ok(back.funcs[0].graph.nodes.some((n) => n.id === body.id), 'the same part, same id')
  assert.ok(back.funcs[0].graph.nodes.some((n) => n.kind === 'enter'), 'the born ENTER survived')
  assert.ok(back.funcs[0].graph.nodes.some((n) => n.kind === 'exit'), 'and the born EXIT')
  assert.equal(back.funcs[0].graph.mode, 'func', 'the body stays a func graph')
})

test('loading heals a function whose body graph is missing', () => {
  const d = {
    app: 'loopdoc-composer',
    version: 1,
    name: 'RPG',
    design: newGraph('flow', 'Main Loop'),
    funcs: [{ name: 'bare' }], // an entry saved before func graphs existed
  }
  const back = parseDoc(serializeDoc(d))
  const f = back.funcs[0]
  assert.ok(f.id && f.note === '' && f.graph, 'the entry gains the fields the editor expects')
  assert.equal(f.graph.mode, 'func', 'a missing body becomes a fresh func graph')
  assert.ok(f.graph.nodes.some((n) => n.kind === 'enter'), 'even a healed body owns an ENTER')
  assert.ok(f.graph.nodes.some((n) => n.kind === 'exit'), 'and an EXIT')
  assert.equal(f.graph.entry, f.graph.nodes.find((n) => n.kind === 'enter').id, 'and chains start at that ENTER')
})

test('a body that lost a door gets it born back on load', () => {
  const fn = newFunc('orphan')
  fn.graph.nodes = fn.graph.nodes.filter((n) => n.kind !== 'exit') // hand-edit deleted one
  const d = { ...newDoc('RPG'), funcs: [fn] }
  const back = parseDoc(serializeDoc(d))
  assert.ok(back.funcs[0].graph.nodes.some((n) => n.kind === 'exit'), 'the missing EXIT is reborn')
  assert.ok(back.funcs[0].graph.nodes.some((n) => n.kind === 'enter'), 'the survivor kept its spot')
})

test('func body graphs are repaired like every other graph', () => {
  const fn = newFunc('dupe')
  const a = newNode('action', 0, 0)
  const copy = { ...a, x: 40 } // a copy that kept its original id
  fn.graph.nodes.push(a, copy)
  const d = { ...newDoc('RPG'), funcs: [fn] }
  const back = parseDoc(serializeDoc(d))
  const nodes = back.funcs[0].graph.nodes
  assert.ok(nodes[0].id !== nodes[1].id, 'shared ids inside a func body get healed')
})

test('a func node is navigable — its body opens the same way from every call site', () => {
  const d = newDoc('RPG')
  const fn = newFunc('apply damage')
  d.funcs.push(fn)
  const c1 = newNode('func', 0, 0)
  const c2 = newNode('func', 300, 0)
  c1.func = c2.func = fn.id
  d.design.nodes.push(c1, c2)
  assert.equal(resolveGraph(d, [c1.id]).id, fn.graph.id, 'walking in from the first call site opens the body')
  assert.equal(resolveGraph(d, [c2.id]).id, fn.graph.id, 'the second call site opens the very same body')
  // editing the body under one call site writes back into the definition …
  const next = { ...fn.graph, nodes: [...fn.graph.nodes, newNode('action', 40, 40)] }
  const edited = replaceGraph(d, [c1.id], next)
  assert.equal(edited.funcs[0].graph.nodes.length, next.nodes.length, 'the edit lands on the definition')
  assert.ok(
    edited.funcs[0].graph.nodes.some((n) => n.kind === 'action'),
    'the new part is in the shared body',
  )
  // … and the other call site sees it too — one backing graph, many doors
  assert.ok(
    resolveGraph(edited, [c2.id]).nodes.some((n) => n.kind === 'action'),
    'the other call site sees the same edit',
  )
})

test('a FUNC card mirrors the body: ENTER vars grow ⇣, EXIT vars grow ⇡', () => {
  const fn = newFunc('apply damage')
  const en = fn.graph.nodes.find((n) => n.kind === 'enter')
  const ex = fn.graph.nodes.find((n) => n.kind === 'exit')
  en.vars = [{ id: 'vid_t', name: 'target', type: 'int' }]
  ex.vars = [{ id: 'vid_left', name: 'hpLeft', type: 'int' }]
  const call = newNode('func', 0, 0)
  call.func = fn.id
  const dp = funcPorts(call, [fn])
  assert.deepEqual(dp.in.map((p) => `${p.name}:${p.type}`), ['target:int'], '⇣ feeds the ENTER variable')
  assert.deepEqual(dp.out.map((p) => `${p.name}:${p.type}`), ['hpLeft:int'], '⇡ reads the EXIT variable')
})

test('a func canvas never offers the function you are inside', () => {
  const fn = newFunc('apply damage')
  const here = fn.graph.id
  const picks = [newFunc('cure'), fn].filter((f) => !f.graph || f.graph.id !== here)
  assert.equal(picks.length, 1, 'the enclosing definition is dropped from its own dropdown')
  assert.equal(picks[0].name, 'cure', 'every other function stays pickable')
})
