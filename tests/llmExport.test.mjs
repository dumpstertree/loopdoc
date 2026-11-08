// llm export — the flattener must name, nest, and wire everything it's given
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportForLLM } from '../src/llmExport.js'

const doc = {
  app: 'loopdoc-composer',
  name: 'Goblin Depths',
  notes: { business: '', mood: 'cozy dread' },
  types: [
    { id: 't1', name: 'Vec', fields: [{ id: 'f1', name: 'x', typeId: 'int' }, { id: 'f2', name: 'y', typeId: 'int' }] },
    { id: 't2', name: 'Foe', fields: [{ id: 'f3', name: 'hp', typeId: 'int' }, { id: 'f4', name: 'pos', typeId: 'Vec' }] },
  ],
  vars: [{ id: 'g1', name: 'depth', type: 'int', value: '0' }],
  assets: [
    { id: 'as1', kind: 'art', name: 'sprites', api: [] },
    { id: 'as2', kind: 'system', name: 'roster', api: [{ id: 'fn1', name: 'foes', inputs: [], outputs: [{ id: 'o1', name: 'foes', type: 'Foe[]' }] }] },
  ],
  design: {
    mode: 'flow',
    name: 'Main Loop',
    entry: 'n1',
    nodes: [
      { id: 'n1', kind: 'step', name: 'start', x: 0, y: 0 },
      { id: 'n2', kind: 'var', name: 'hero', x: 0, y: 0, variable: { name: 'hero', type: 'Foe', value: { hp: '3', pos: { x: '1', y: '2' } } } },
      { id: 'n3', kind: 'machine', name: 'combat', x: 0, y: 0, graph: {
        mode: 'machine',
        name: 'combat',
        nodes: [
          { id: 'm1', kind: 'enter', name: 'door', x: 0, y: 0, vars: [{ id: 'ev1', name: 'lives', type: 'int', value: '3' }], assets: [{ id: 'ea1', asset: 'as1', name: 'sprites' }] },
          { id: 'm2', kind: 'action', name: 'gold', x: 0, y: 0 },
          { id: 'm3', kind: 'foreach', x: 0, y: 0, itemType: 'Foe' },
          { id: 'm4', kind: 'action', name: 'spend', x: 0, y: 0 },
          { id: 'm5', kind: 'exit', name: 'victory', x: 0, y: 0 },
          { id: 'm6', kind: 'todo', name: 'balance', x: 0, y: 0, todos: [{ id: 'td1', text: 'tune gold', done: true }, { id: 'td2', text: 'boss drop', done: false }] },
        ],
        links: [
          { id: 'f1', kind: 'flow', from: 'm1', fromPort: 'out', to: 'm3', toPort: 'in' },
          { id: 'f2', kind: 'flow', from: 'm3', fromPort: 'out', to: 'm4', toPort: 'in' },
          { id: 'f3', kind: 'flow', from: 'm4', fromPort: 'out', to: 'm5', toPort: 'in' },
        ],
      } },
      { id: 'n4', kind: 'text', name: 'the battle loop', x: 0, y: 0 },
    ],
    links: [
      { id: 'l1', kind: 'flow', from: 'n1', fromPort: 'out', to: 'n3', toPort: 'in' },
      { id: 'l2', kind: 'data', from: 'n2', fromPort: '__val__', to: 'n3', toPort: 'ev1' },
    ],
  },
}

test('llm export — header, notes, types, globals, assets all land', () => {
  const t = exportForLLM(doc)
  assert.ok(t.includes('# Game design brief — Goblin Depths'))
  assert.ok(t.includes('cozy dread'), 'mood note carried')
  assert.ok(t.includes('Foe { hp: int, pos: Vec }'), 'struct type expanded')
  assert.ok(t.includes('depth:int = 0'), 'global listed')
  assert.ok(t.includes('fn foes(') && t.includes('foes:Foe[]'), 'system fn signature listed')
  assert.ok(t.includes('🎨 sprites (art)') && t.includes('⚙️ roster (system)'), 'assets with icons')
})

test('llm export — flow graph: entry, typed VAR with real values, nesting', () => {
  const t = exportForLLM(doc)
  assert.ok(t.indexOf('STEP "start"') > t.indexOf('### Flow Graph "Main Loop"') && t.indexOf('STEP "start"') < t.indexOf('MACHINE "combat"'), 'chain written in run order, entry first')
  assert.ok(t.includes('VAR "hero": makes hero:Foe = { hp: 3, pos: { x: 1, y: 2 } }'), 'fill-in coerced and expanded')
  assert.ok(t.includes('# ⇣ lives ← VAR "hero".hero :Foe'), 'data wire shown as a # line under its consumer')
  assert.ok(t.includes('NOTE') || t.includes('annotation frame'), 'text frame carried')
})

test('llm export — machine section: door vars/assets, loops, wires, actions', () => {
  const t = exportForLLM(doc)
  assert.ok(t.includes('Machine "combat"') && t.includes('inside MACHINE "combat"'), 'nested machine sectioned under its parent')
  assert.ok(t.includes('lives:int = 3'), 'enter var carried')
  assert.ok(t.includes('📦 sprites'), 'enter asset carried')
  assert.ok(t.includes('ACTION "gold": chain waits here for a click'), 'action part and its waiting shown')
  assert.ok(t.includes('for item:Foe (+index) in'), 'foreach lowered to a loop header')
  assert.ok(t.includes('  ACTION "spend": chain waits here for a click'), 'loop body is an indented block')
  assert.ok(t.includes('# (end unwired — after the loop the chain stops here)'), 'unwired loop end stated, not hidden')
  assert.ok(t.includes('[x] tune gold') && t.includes('[ ] boss drop'), 'todo checklist with ticks')
  assert.ok(t.includes('EXIT "victory"'), 'named exit listed')
})

test('llm export — part reference covers only kinds used', () => {
  const t = exportForLLM(doc)
  const ref = t.slice(t.indexOf('## Part reference'))
  assert.ok(ref.includes('ACTION —'), 'used kind explained')
  assert.ok(ref.includes('FOREACH —'), 'loop kind explained')
  assert.ok(!ref.includes('IF —'), 'unused kind not bloating the brief')
})

test('llm export — system fn descriptions ride the export', () => {
  const withDesc = structuredClone(doc)
  withDesc.assets[1].api[0].desc = 'every living foe, west to east'
  const t = exportForLLM(withDesc)
  assert.ok(t.includes('fn foes( ) ⇡ foes:Foe[] — every living foe, west to east'), 'desc appended after the signature')
})

test('llm export — fn description is optional; docs without one export unchanged', () => {
  const t = exportForLLM(doc)
  assert.ok(t.includes('fn foes( ) ⇡ foes:Foe[]\n'), 'no desc, no trailing dash')
})
