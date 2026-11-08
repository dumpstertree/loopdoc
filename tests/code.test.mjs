// CODE node — scripted node with typed ⇣/⇡ ports, Python validation
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newNode, kindsFor, funcKinds, dataPorts, reidNode } from '../src/model.js'
import { validateCode } from '../src/codeLang.js'
import { runDRC } from '../src/drc.js'
import { stepOnce } from '../src/engine.js'

test('CODE node appears on flow, machine, func canvases', () => {
  assert.ok(kindsFor('flow').includes('code'))
  assert.ok(kindsFor('machine').includes('code'))
  assert.ok(kindsFor('func').includes('code'))
  assert.ok(funcKinds.includes('code'))
})

test('newNode code initializes script and io vars', () => {
  const n = newNode('code', 10, 20)
  assert.deepEqual(n.inVars, [])
  assert.deepEqual(n.outVars, [])
  assert.equal(n.code, '')
  assert.equal(n.lang, 'python')
})

test('CODE data ports mirror inVars/outVars', () => {
  const n = newNode('code', 0, 0)
  n.inVars = [{ id: 'i1', name: 'x', type: 'int' }]
  n.outVars = [{ id: 'o1', name: 'y', type: 'string' }]
  const dp = dataPorts(n, [], [], null)
  assert.deepEqual(dp.in.map((p) => [p.id, p.type, p.name]), [['i1', 'int', 'x']])
  assert.deepEqual(dp.out.map((p) => [p.id, p.type, p.name]), [['o1', 'string', 'y']])
})

test('validateCode accepts empty and exactly one function; rejects no/multiple defs', () => {
  assert.equal(validateCode('').ok, true)
  assert.equal(validateCode('def f(a, b):\n    return [a, b]').ok, true)
  assert.equal(validateCode('x = (1 + 2)\nprint(x)').ok, false, 'no function defined')
  assert.equal(validateCode('def a():\n  pass\ndef b():\n  pass').ok, false, 'multiple functions')
  assert.equal(validateCode('def a():\n  def b():\n    pass\n  return 1').ok, false, 'nested counts as second def')
})

test('validateCode catches unclosed brackets and strings', () => {
  assert.equal(validateCode('x = (1 + 2').ok, false)
  assert.equal(validateCode('x = [1, 2').ok, false)
  assert.equal(validateCode('x = {1: 2').ok, false)
  assert.equal(validateCode('x = "hello').ok, false)
  assert.ok(validateCode('x = (1 + 2').errors[0].message.includes("unclosed '('"))
})

test('DRC warns on invalid code syntax', () => {
  const doc = {
    design: {
      id: 'g',
      mode: 'flow',
      name: 'x',
      nodes: [{ id: 'c1', kind: 'code', x: 0, y: 0, code: 'def f(\n  pass', lang: 'python', inVars: [], outVars: [] }],
      links: [],
      entry: null,
    },
    assets: [],
    types: [],
    vars: [],
    funcs: [],
  }
  const found = runDRC(doc)
  assert.ok(found.some((f) => f.sev === 'warn' && /^code:/.test(f.text)), 'code validation error reported')
})

test('engine passes chain through code node', () => {
  const en = { id: 'en', kind: 'enter', x: 0, y: 0 }
  const cd = { id: 'cd', kind: 'code', x: 0, y: 0, name: 'calc', lang: 'python', code: 'x=1', inVars: [], outVars: [] }
  const sk = { id: 'sk', kind: 'step', x: 0, y: 0, name: 'end' }
  const nodes = [en, cd, sk]
  const links = [
    { id: 'l1', kind: 'flow', from: 'en', fromPort: 'out', to: 'cd', toPort: 'in' },
    { id: 'l2', kind: 'flow', from: 'cd', fromPort: 'out', to: 'sk', toPort: 'in' },
  ]
  const log = []
  const mem = { tokens: [] }
  for (let i = 0; i < 8; i++) stepOnce(nodes, links, log, mem, [])
  assert.ok(log.some((l) => l.includes('calc') || l.includes('code')), 'code logged')
  assert.ok(log.some((l) => l.includes('end — chain end')), 'chain passed through')
})

test('reidNode remaps inVars/outVars so data wires follow paste', () => {
  const n = newNode('code', 0, 0)
  n.inVars = [{ id: 'i1', name: 'a', type: 'int' }]
  n.outVars = [{ id: 'o1', name: 'b', type: 'int' }]
  const map = new Map()
  const nn = reidNode(n, map)
  assert.notEqual(nn.inVars[0].id, 'i1')
  assert.notEqual(nn.outVars[0].id, 'o1')
  assert.equal(map.get(`${n.id}:i1`), nn.inVars[0].id)
  assert.equal(map.get(`${n.id}:o1`), nn.outVars[0].id)
})
