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
          { id: 'm1', kind: 'enter', name: 'door', x: 0, y: 0, vars: [
            { id: 'ev1', name: 'lives', type: 'int', value: '3' },
            { id: 'ev2', name: 'round', type: 'int' },
            { id: 'ev3', name: 'rank', type: 'int' },
          ], assets: [{ id: 'ea1', asset: 'as1', name: 'sprites' }] },
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
      // content the design never uses: a cycle no chain start reaches, a value
      // nothing consumes, and the legacy art asset — all must be culled
      { id: 'n5', kind: 'ifb', name: 'nope1', x: 0, y: 0 },
      { id: 'n6', kind: 'step', name: 'nope2', x: 0, y: 0 },
      { id: 'n7', kind: 'var', name: 'unusedvalue', x: 0, y: 0, variable: { name: 'unusedvalue', type: 'Foe', value: { hp: '1' } } },
      // the shared-state idiom: a global read and a system ledger variable read
      { id: 'n8', kind: 'getg', name: '', x: 0, y: 0, gName: 'depth', gType: 'int' },
      { id: 'n9', kind: 'getledger', name: '', x: 0, y: 0, lRef: 'as2', lName: 'rank', lType: 'int' },
    ],
    links: [
      { id: 'l1', kind: 'flow', from: 'n1', fromPort: 'out', to: 'n3', toPort: 'in' },
      { id: 'l2', kind: 'data', from: 'n2', fromPort: '__val__', to: 'n3', toPort: 'ev1' },
      { id: 'l3', kind: 'flow', from: 'n5', fromPort: 'true', to: 'n6', toPort: 'in' },
      { id: 'l4', kind: 'flow', from: 'n6', fromPort: 'out', to: 'n5', toPort: 'in' },
      { id: 'l5', kind: 'data', from: 'n8', fromPort: '__val__', to: 'n3', toPort: 'ev2' },
      { id: 'l6', kind: 'data', from: 'n9', fromPort: '__val__', to: 'n3', toPort: 'ev3' },
    ],
  },
}

test('llm export — header, notes, types, shared state, systems all land', () => {
  const t = exportForLLM(doc)
  assert.ok(t.includes('# Game design brief — Goblin Depths'))
  assert.ok(t.includes('cozy dread'), 'mood note carried')
  assert.ok(t.includes('Foe { hp: int, pos: Vec }'), 'struct type expanded')
  assert.ok(t.includes('⚙ global depth:int = 0'), 'a global some GET GLOBAL reads is listed')
  assert.ok(t.includes('fn foes(') && t.includes('foes:Foe[]'), 'system fn signature listed')
  assert.ok(t.includes('⚙️ roster (system)'), 'systems still carry the brief')
  assert.ok(!t.includes('🎨') && !t.includes('## Assets'), 'art assets are legacy — the brief never mentions them')
})

test('llm export — the brief introduces concepts in reading order', () => {
  const t = exportForLLM(doc)
  const at = (s) => t.indexOf(s)
  assert.ok(at('## Part reference') < at('## Systems') && at('## Systems') < at('## Data types'), 'vocabulary, then the materials')
  assert.ok(at('## Data types') < at('## Shared state') && at('## Shared state') < at('## Graphs'), 'shared state before the programs that use it')
  assert.ok(at('## Graphs') < at('## Curio mapping'), 'the programs then the engine mapping close the brief')
  assert.ok(t.includes('```'), 'programs ride in fenced code blocks — their # lines survive markdown intact')
})

test('llm export — content the design never reaches is culled, not flagged', () => {
  const t = exportForLLM(doc)
  assert.ok(!t.includes('nope1') && !t.includes('nope2'), 'parts no chain start reaches are simply absent')
  assert.ok(!t.includes('unusedvalue'), 'a value nothing consumes is absent')
  assert.ok(!t.includes('could not be placed in a chain') && !t.includes('not reached by any chain start'), 'no unreachable dumping block left behind')
})

test('llm export — flow graph: entry, typed VAR with real values, nesting', () => {
  const t = exportForLLM(doc)
  assert.ok(t.indexOf('STEP "start"') > t.indexOf('### Flow Graph "Main Loop"') && t.indexOf('STEP "start"') < t.indexOf('MACHINE "combat"'), 'chain written in run order, entry first')
  assert.ok(t.includes('var_hero — VAR "hero": makes hero:Foe = { hp: 3, pos: { x: 1, y: 2 } }'), 'definition keeps both handles: slug + display label')
  assert.ok(t.includes('mach_combat(lives ← var_hero.hero :Foe'), 'a machine call folds its data wires into call arguments')
  assert.ok(t.includes('NOTE') || t.includes('annotation frame'), 'text frame carried')
})

test('llm export — machine section reads as a function: signature, loops, returns', () => {
  const t = exportForLLM(doc)
  assert.ok(t.includes('Machine "combat"') && t.includes('inside MACHINE "combat"'), 'nested machine sectioned under its parent')
  assert.ok(t.includes('machine "combat"(lives:int = 3, round:int, rank:int):'), 'a single-door machine reads as a function signature: its door vars are parameters')
  assert.ok(t.includes('# enter_door — ENTER "door" starts it'), 'the door names itself on the signature, not as a line in the body')
  assert.ok(!t.includes('📦'), 'assets the door carries are legacy — culled from the brief')
  assert.ok(!t.includes('action_gold'), 'an action nothing chains to is culled out of the section')
  assert.ok(t.includes('for item:Foe (+index) in'), 'foreach lowered to a loop header')
  assert.ok(t.includes('    action_spend — ACTION "spend": chain waits here for a click'), 'loop body is an indented block under the signature')
  assert.ok(t.includes('return "victory"  # exit_victory — EXIT "victory"'), 'an EXIT prints as a return')
  assert.ok(t.includes('[x] tune gold') && t.includes('[ ] boss drop'), 'todo checklist with ticks')
})

test('llm export — ledger and global reads name what they touch', () => {
  const t = exportForLLM(doc)
  assert.ok(t.includes('## Shared state — named values every graph & machine reads or writes'), 'shared state gets its own section before the programs')
  assert.ok(t.includes('system ledger roster.rank :int — read by getledger'), 'the ledger variable is declared with the part that reads it')
  assert.ok(t.includes('reads system ledger roster.rank (int)'), 'the get part names the ledger variable it reads')
  assert.ok(t.includes('rank ← getledger.rank :int'), 'the ledger value reaches the call by name, as a call argument')
  assert.ok(t.includes('reads ⚙ depth (int)'), 'the global read names the global')
})

test('llm export — unwired paths are not flagged: the code shape carries them', () => {
  const t = exportForLLM(doc)
  assert.ok(!t.includes('## ⚠ Open in this design'), 'no open-points section collected at the foot of the brief')
  assert.ok(!t.includes('(true unwired') && !t.includes('(false unwired') && !t.includes('(end unwired'), 'an unwired arm prints nothing at all')
  assert.ok(!t.includes('has no flow'), 'no per-part note left behind claiming a branch is undecided')
})

test('llm export — Curio cheatsheet closes the brief', () => {
  const t = exportForLLM(doc)
  assert.ok(t.includes('## Curio mapping — cheatsheet: graph part → engine feature'), 'mapping section present')
  assert.ok(t.includes('named EXIT (its ⇡ announce vars) → one variant of the #[stimulant] enum'), 'machine doors map onto events')
  assert.ok(t.includes('⚙ GLOBALS → #[record] structs'), 'globals map onto records')
  assert.ok(t.includes('GET LEDGER / SET LEDGER (system ledger variables, listed up top under Shared'), 'the ledger idiom maps onto ledger records')
  assert.ok(!t.includes('asset.manifest'), 'the cheatsheet no longer routes anything through asset plumbing')
  assert.ok(t.indexOf('## Curio mapping') > t.indexOf('## Part reference'), 'cheatsheet closes the brief, after the vocabulary')
})

test('llm export — part reference covers only kinds used', () => {
  const t = exportForLLM(doc)
  const ref = t.slice(t.indexOf('## Part reference'), t.indexOf('## Systems'))
  assert.ok(ref.includes('ACTION —'), 'used kind explained')
  assert.ok(ref.includes('FOREACH —'), 'loop kind explained')
  assert.ok(ref.includes('GET LEDGER —') && ref.includes('GET GLOBAL —'), 'the shared-state kinds are explained')
  assert.ok(!ref.includes('IF —'), 'the ifb part nothing reaches never brings its kind into the brief')
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
