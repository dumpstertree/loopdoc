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

test('llm export — a CODE part carries its own script verbatim', () => {
  const cdoc = {
    app: 'loopdoc-composer',
    name: 'Code node',
    types: [],
    vars: [],
    assets: [],
    funcs: [],
    design: {
      mode: 'flow',
      name: 'Loop',
      entry: 'c1',
      nodes: [
        { id: 'c1', kind: 'step', name: 'read' },
        { id: 'c2', kind: 'code', name: 'clamp', lang: 'python', code: 'def clamp(a, b):\n    return a if a < b else b', inVars: [{ id: 'iv1', name: 'a', type: 'int' }, { id: 'iv2', name: 'b', type: 'int' }], outVars: [{ id: 'ov1', name: 'result', type: 'int' }] },
        { id: 'c3', kind: 'code', name: 'tabbed', lang: 'python', code: 'def bump(v):\n\treturn v + 1', inVars: [{ id: 'iv3', name: 'v', type: 'int' }], outVars: [{ id: 'ov2', name: 'result', type: 'int' }] },
        { id: 'c4', kind: 'code', name: 'blank', lang: 'python', code: '', inVars: [], outVars: [] },
        { id: 'v1', kind: 'var', name: 'hp', variable: { name: 'hp', type: 'int', value: '3' } },
      ],
      links: [
        { id: 'k1', kind: 'flow', from: 'c1', fromPort: 'out', to: 'c2', toPort: 'in' },
        { id: 'k2', kind: 'flow', from: 'c2', fromPort: 'out', to: 'c3', toPort: 'in' },
        { id: 'k3', kind: 'flow', from: 'c3', fromPort: 'out', to: 'c4', toPort: 'in' },
        { id: 'k4', kind: 'data', from: 'v1', fromPort: '__val__', to: 'c2', toPort: 'iv1' },
      ],
    },
  }
  const t = exportForLLM(cdoc)
  assert.ok(t.includes('CODE: code_clamp "clamp" ( int:a ~ var_hp.hp, int:b ) -> ( int:result ) python script {'), 'the entry names the script, its language and its typed ports on one line')
  assert.ok(t.includes('    def clamp(a, b):') && t.includes('        return a if a < b else b'), 'script printed verbatim inside the part’s braces, pushed in one level so its own indentation stays relative')
  assert.ok(t.includes('      def bump(v):') && t.includes('        return v + 1'), 'tab-indented python becomes spaces — the brief stays readable')
  assert.ok(t.includes('CODE: code_blank "blank" {\n        no script written yet — its ports stay'), 'an empty CODE part says so instead of looking truncated')
  assert.ok(t.includes('( int:a ~ var_hp.hp, int:b )'), 'the value feeding the script’s param is a wired slot, and the one nothing feeds is the bare slot')
  const ref = t.slice(t.indexOf('## Part reference'), t.indexOf('## Graphs'))
  assert.ok(ref.includes('CODE —'), 'the script kind is explained in the vocabulary')
})

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
  assert.ok(at('## Graphs') < at('## Curio features'), 'the programs then the engine mapping close the brief')
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
  assert.ok(t.indexOf('STEP: step_start') > t.indexOf('### Flow Graph "Main Loop"') && t.indexOf('STEP: step_start') < t.indexOf('MACHINE: mach_combat'), 'chain written in run order, entry first')
  assert.ok(t.includes('VAR: var_hero "hero" ( Foe:hero ) -> ( Foe:hero ) {\n  makes hero:Foe = { hp: 3, pos: { x: 1, y: 2 } }'), 'definition keeps both handles: slug + display label')
  assert.ok(t.includes('mach_combat "combat" ( int:lives ~ var_hero.hero'), 'a machine call folds its data wires into its slot list')
  assert.ok(t.includes('TEXT') || t.includes('annotation frame'), 'text frame carried')
})

test('llm export — a machine gets its own section, stated before the graph that runs it', () => {
  const t = exportForLLM(doc)
  assert.ok(t.includes('### Machine mach_combat "combat"'), 'the machine opens under a heading of its own, not inside a call site')
  assert.ok(t.includes('MACHINE: mach_combat "combat" ( int:lives ~ var_hero.hero, int:round ~ getg.depth, int:rank ~ getledger.rank'), 'the call site’s slots still carry the values the machine takes')
  assert.ok(t.includes('mach_combat — its own parts are stated in the section for it above'), 'the call site only names the handle — its parts are already above it on the page')
  assert.ok(t.indexOf('### Machine mach_combat "combat"') < t.indexOf('MACHINE: mach_combat'), 'the machine section is stated before the section that calls it')
  assert.ok(t.includes('## Machines') && t.indexOf('## Machines') < t.indexOf('## Graphs'), 'machine sections come before the graphs that run them')
  assert.ok(!t.includes('📦'), 'assets the door carries are legacy — culled from the brief')
  assert.ok(!t.includes('action_gold'), 'an action nothing chains to is culled out of the machine')
  assert.ok(t.includes('for item, index in arr [iter]') && t.includes('end the loop [end]'), 'foreach lowered to a loop header, its iter/end ports named')
  assert.ok(t.includes('    ACTION: action_spend "spend" {') && t.includes('      chain waits here for a click'), 'inside its own section, the loop body is stepped one indent deeper than the loop')
  assert.ok(t.includes('EXIT: exit_victory "victory" {'), 'an EXIT prints as the part that ends its chain')
  assert.ok(t.includes('[x] tune gold') && t.includes('[ ] boss drop'), 'todo checklist with ticks')
})

test('llm export — ledger and global reads name what they touch', () => {
  const t = exportForLLM(doc)
  assert.ok(t.includes('## Shared state — named values every graph & machine reads or writes'), 'shared state gets its own section before the programs')
  assert.ok(t.includes('system ledger roster.rank :int — read by getledger'), 'the ledger variable is declared with the part that reads it')
  assert.ok(t.includes('reads system ledger roster.rank (int)'), 'the get part names the ledger variable it reads')
  assert.ok(t.includes('int:rank ~ getledger.rank'), 'the ledger value reaches the call as a wired slot named by its producer')
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
  assert.ok(t.includes('## Curio features — the engine primitives a built game is made of'), 'the engine vocabulary opens the mapping')
  assert.ok(t.includes('- HABIT →') && t.includes('- LEDGER →'), 'the primitives are explained in the engine’s own words, not just named')
  assert.ok(t.includes('## Canvas → Curio feature'), 'the canvases map onto those primitives')
  assert.ok(t.includes('## Node → Curio feature'), 'and so do the individual parts')
  assert.ok(t.includes('named EXIT (its ⇡ announce vars) → one variant of the #[stimulant] enum'), 'machine doors map onto events')
  assert.ok(t.includes('⚙ GLOBALS → #[record] structs'), 'globals map onto records')
  assert.ok(t.includes('GET LEDGER / SET LEDGER (system ledger variables, listed up top under Shared'), 'the ledger idiom maps onto ledger records')
  assert.ok(!t.includes('asset.manifest'), 'the cheatsheet no longer routes anything through asset plumbing')
  assert.ok(t.indexOf('## Curio features') > t.indexOf('## Part reference'), 'cheatsheet closes the brief, after the vocabulary')
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

// a design the LLM reviewer tore into: three machine exits, a part that fans out
// inside the machine, card-typed operands, a call nobody feeds, a value producer
// no chain walks, and a script its own validator calls broken
const crit = {
  app: 'loopdoc-composer',
  name: 'Critique',
  types: [{ id: 't1', name: 'Vec', fields: [{ id: 'f1', name: 'x', typeId: 'float' }] }],
  vars: [],
  assets: [
    { id: 'lv', kind: 'system', name: 'LevelEngine', api: [
      { id: 'gen', name: 'generate', inputs: [{ id: 'p1', name: 'min_w', type: 'int' }], outputs: [{ id: 'o1', name: 'map', type: 'int' }] },
    ] },
    { id: 'ie', kind: 'system', name: 'InputEngine', api: [] },
  ],
  funcs: [],
  design: {
    mode: 'flow',
    name: 'Main Loop',
    entry: 'e1',
    nodes: [
      { id: 'e1', kind: 'event', name: '', x: 0, y: 0, calls: [{ asset: 'lv', fn: 'gen' }] },
      { id: 'disp', kind: 'step', name: '', x: 0, y: 0, note: 'display tiles' },
      { id: 'gl_in', kind: 'getledger', name: '', x: 0, y: 0, lRef: 'ie', lName: 'input', lType: 'InputEngine:Input' },
      { id: 'gl_d', kind: 'getledger', name: '', x: 0, y: 0, lRef: 'lv', lName: 'depth', lType: 'int' },
      { id: 'insp', kind: 'inspect', name: '', x: 0, y: 0, fields: [{ id: 'fx', name: 'x', typeId: 'float' }] },
      { id: 'add1', kind: 'add', name: '', x: 0, y: 0, aVal: '1', bVal: '' },
      { id: 'sl_d', kind: 'setledger', name: '', x: 0, y: 0, lRef: 'lv', lName: 'depth', lType: 'int' },
      { id: 'sl_p', kind: 'setledger', name: '', x: 0, y: 0, lRef: 'lv', lName: 'position', lType: 'Vec' },
      { id: 'mach', kind: 'machine', name: '', x: 0, y: 0, graph: {
        mode: 'machine',
        name: 'walk',
        nodes: [
          { id: 'en', kind: 'enter', name: 'door', x: 0, y: 0, vars: [{ id: 'ev1', name: 'location', type: 'Vec' }] },
          { id: 'cd', kind: 'code', name: '', x: 0, y: 0, lang: 'python', code: 'def move(location):\n    delta_x += 1\n    return location', inVars: [{ id: 'iv0', name: 'location', type: 'Vec' }], outVars: [{ id: 'ov1', name: 'delta_z', type: 'int' }] },
          { id: 'if3', kind: 'ifb', name: '', x: 0, y: 0, op: '==', cmpType: 'bool' },
          { id: 'if4', kind: 'ifb', name: '', x: 0, y: 0, op: '==', cmpType: 'bool' },
          { id: 'x_c', kind: 'exit', name: 'continue', x: 0, y: 0, vars: [{ id: 'xv1', name: 'location', type: 'Vec' }] },
          { id: 'x_d', kind: 'exit', name: 'descend', x: 0, y: 0 },
          { id: 'x_u', kind: 'exit', name: 'ascend', x: 0, y: 0 },
          { id: 'er1', kind: 'exitinst', name: '', x: 0, y: 0, exitRef: 'x_d' },
          { id: 'er2', kind: 'exitinst', name: '', x: 0, y: 0, exitRef: 'x_c' },
        ],
        links: [
          { id: 'mf1', kind: 'flow', from: 'en', fromPort: 'out', to: 'cd', toPort: 'in' },
          { id: 'mf2', kind: 'flow', from: 'cd', fromPort: 'out', to: 'if3', toPort: 'in' },
          { id: 'mf3', kind: 'flow', from: 'cd', fromPort: 'out', to: 'if4', toPort: 'in' },
          { id: 'mf4', kind: 'flow', from: 'if3', fromPort: 'true', to: 'er1', toPort: 'in' },
          { id: 'mf5', kind: 'flow', from: 'if3', fromPort: 'false', to: 'er2', toPort: 'in' },
          { id: 'md1', kind: 'data', from: 'en', fromPort: 'ev1', to: 'cd', toPort: 'iv0' },
          { id: 'md2', kind: 'data', from: 'en', fromPort: 'ev1', to: 'er2', toPort: 'xv1' },
        ],
      } },
    ],
    links: [
      { id: 'l1', kind: 'flow', from: 'e1', fromPort: 'out', to: 'disp', toPort: 'in' },
      { id: 'l2', kind: 'flow', from: 'disp', fromPort: 'out', to: 'mach', toPort: 'in' },
      { id: 'l3', kind: 'flow', from: 'mach', fromPort: 'x_c', to: 'sl_p', toPort: 'in' },
      { id: 'l4', kind: 'flow', from: 'mach', fromPort: 'x_d', to: 'gl_d', toPort: 'in' },
      { id: 'l5', kind: 'flow', from: 'gl_d', fromPort: 'out', to: 'add1', toPort: 'in' },
      { id: 'l6', kind: 'flow', from: 'add1', fromPort: 'out', to: 'sl_d', toPort: 'in' },
      { id: 'd1', kind: 'data', from: 'insp', fromPort: 'fx', to: 'add1', toPort: '__b__' },
      { id: 'd2', kind: 'data', from: 'add1', fromPort: '__val__', to: 'sl_d', toPort: '__val__' },
      { id: 'd3', kind: 'data', from: 'gl_in', fromPort: '__val__', to: 'sl_p', toPort: '__val__' },
    ],
  },
}

test('llm export — a multi-exit machine names each door on its closing brace', () => {
  const t = exportForLLM(crit)
  assert.ok(t.includes('} [ "continue":setledger_2, "descend":getledger_2 ]'), 'exit routing is named where the machine is declared, not left to parallel-chain markers')
  assert.ok(t.includes('EXIT REF: exitref {') && t.includes('leave by the door "descend"'), 'the door inside the machine names itself inside its braces')
  assert.ok(t.includes('⚠ a second flow wire leaves code on its out port — both get enqueued'), 'the fan-out rides where it belongs: inside the machine, at its own indent')
  assert.ok(!t.includes('parallel chain'), 'no chain is hoisted to the foot of the section any more')
})

test('llm export — values the design typed instead of wiring are printed', () => {
  const t = exportForLLM(crit)
  assert.ok(t.includes('ADD: add ( num:a ~ 1, num:b ~ inspect.x ) -> ( int:result ) {'), 'the card value is in the brief, so +1 is not a guess, and a wired slot names its producer')
  assert.ok(t.includes('EVENT: event ( int:min_w ) -> ( int:map ) {'), 'a call parameter nothing feeds prints as a bare slot')
  assert.ok(t.includes('num:b ~ inspect.x') && t.includes('INSPECT: inspect ( any:obj ) -> ( float:x )'), 'the value producer a live wire reads rides in the brief — no dangling handle')
})

test('llm export — a script the validator calls broken says so', () => {
  const t = exportForLLM(crit)
  assert.ok(t.includes("⚠ its script does not validate at line 1: output 'delta_z' is never assigned"), 'the fault is stated where the script is, so the reader fixes it once instead of shipping it')
  assert.ok(t.includes('    def move(location):') && t.includes('        delta_x += 1'), 'the script still rides inside its part’s braces verbatim, its own indentation kept relative')
})

test('llm export — handles read as the design says, and the cheatsheet only maps used parts', () => {
  const t = exportForLLM(crit)
  assert.ok(t.includes('step_display_tiles (note: "display tiles")'), 'an unnamed part\'s handle comes from its note, so it reads as what it is for')
  assert.ok(t.includes('- system ledger InputEngine.input :InputEngine:Input — read by getledger · no part in this design writes it'), 'an engine-only ledger value says nobody writes it')
  assert.ok(t.includes('## Curio features — the engine primitives a built game is made of'), 'the mapping section opens with the engine vocabulary')
  assert.ok(t.includes('- CODE part (its script is printed inside its own braces, verbatim)'), 'a kind this brief uses maps onto the engine')
  assert.ok(!t.includes('CHOICE options') && !t.includes('VAR “hero”'), 'mappings for kinds this brief never carries are left out')
  assert.ok(!t.includes('- FUNC / ƒ'), 'a whole canvas this design has no ƒ in is left out too')
  assert.ok((t.match(/```/g) || []).length % 2 === 0, 'fences stay balanced with the new blocks inside them')
})
