// ---------------------------------------------------------------------------
// loopdoc composer — document model
//
// One vocabulary everywhere:
//   Doc  ▸ Graph ▸ Node + Link            (assets live on the Doc)
//
// A Graph is either `flow` (the game-loop canvas: control flow between nodes)
// or `machine` (a Machinations-style economy sim). Both share the same node
// and link shapes, the same port model and the same typed data-wire rules.
//
//   Node { id, kind, name, x, y, ...kind fields }
//   Link { id, kind:'flow'|'data', from, fromPort, to, toPort, amount?, anchors? }
//
// Flow links move control (flow graphs) or resource tokens (machines).
// Data links carry a typed value from a ⇡ output port to a ⇣ input port of
// the same type — pools expose their amount as `int`, system calls expose
// their fn's variables.
// ---------------------------------------------------------------------------

let seq = 0
export function uid(prefix = 'n') {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`
}

// ---- assets ----------------------------------------------------------------
export const ASSET_KINDS = [
  { id: 'art', icon: '🎨', label: 'art' },
  { id: 'audio', icon: '🔊', label: 'audio' },
  { id: 'ui', icon: '🖥️', label: 'ui' },
  { id: 'input', icon: '🎮', label: 'input' },
  { id: 'system', icon: '⚙️', label: 'system' },
]
export const assetIcon = (kind) => (ASSET_KINDS.find((k) => k.id === kind) || {}).icon || '📦'

// ---- data types ------------------------------------------------------------
// types are declared on the doc and picked from dropdowns everywhere.
// a variable's `type` is a plain type NAME string — arrays carry '[]'
// ('int', 'Foe', 'Foe[]') — so wire checking stays a simple name compare.
export const BASIC_TYPES = ['int', 'float', 'string', 'bool', 'asset']

export function newType(name = '') {
  return { id: uid('ty'), name, fields: [{ id: uid('f'), name: '', typeId: 'int' }] }
}

// document-wide global variable — a named, typed value with a default the
// whole app shares; GET GLOBAL/SET GLOBAL parts read and write it inside machines
export function newGlobal(name = '') {
  return { id: uid('gv'), name, type: 'int', value: '' }
}

// coerce a global's stored default string into its typed runtime value
export function globalValue(g) {
  if (!g) return undefined
  if (g.type === 'int') return Math.trunc(Number(g.value)) || 0
  if (g.type === 'float') return Number(g.value) || 0
  if (g.type === 'bool') return g.value === 'true' || g.value === '1'
  return g.value ?? ''
}

// coerce an ENTER variable's stored string into its typed runtime value —
// array types are comma lists ('goblin, orc, 3'), just like sim answers
export function varValue(v) {
  if (!v) return undefined
  const t = String(v.type || '')
  if (!t.endsWith('[]')) return globalValue(v)
  const base = t.replace(/\[\s*\]$/, '').trim().toLowerCase()
  return String(v.value ?? '')
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((s) => {
      if (base === 'int') return Math.trunc(Number(s)) || 0
      if (base === 'float') return Number(s) || 0
      if (base === 'bool') return s === 'true' || s === '1'
      return isNaN(s) ? s : Number(s) // declared/unknown base — numbers stay numbers
    })
}

// the session store for globals — the game's live state. ONE store per open
// document: machine sims READ and WRITE it in place (SET, fed-pool write-
// through), so exploration's depth hands straight through to combat's next
// run. Pools still reset every run; globals only reset here (↺ / new doc /
// open file), which is what makes scenes one game instead of one sim each.
export function makeGlobalsStore() {
  let g = null
  return {
    // the live map, seeded (once) from defaults; new vars join live mid-session
    vals: (vars) => {
      if (!g) g = {}
      for (const v of vars || []) if (!(v.id in g)) g[v.id] = globalValue(v)
      return g
    },
    reset: () => {
      g = null
    },
  }
}

// ---- shared wire routing -----------------------------------------------------
// straight lines with 90° turns: horizontal → vertical → horizontal,
// plus the midpoint of the (vertical) leg where the amount circle sits
export function orth(sx, sy, tx, ty) {
  const mx = sx + Math.max(30, (tx - sx) / 2)
  return { d: `M ${sx} ${sy} L ${mx} ${sy} L ${mx} ${ty} L ${tx} ${ty}`, mid: { x: mx, y: (sy + ty) / 2 } }
}

// a wire's path: 90° breaks all the way through. Dropped anchors steer the
// run — every hop between two points is the same horizontal → vertical →
// horizontal elbow the plain wire uses, so placing a point on a line BENDS it
// instead of pulling it into a diagonal. Legs that land where they started
// collapse to nothing, so a hop sharing an x or a y is simply a straight run.
// mid lands on the middle hop's vertical leg, where the amount circle sits.
export function routePath(a, b, anchors) {
  if (!anchors || !anchors.length) return orth(a.x, a.y, b.x, b.y)
  const pts = [a, ...anchors, b]
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]
    const q = pts[i]
    const mx = (p.x + q.x) / 2
    d += ` L ${mx} ${p.y} L ${mx} ${q.y} L ${q.x} ${q.y}`
  }
  const h = Math.min(pts.length - 1, Math.max(1, Math.floor(pts.length / 2)))
  return { d, mid: { x: (pts[h - 1].x + pts[h].x) / 2, y: (pts[h - 1].y + pts[h].y) / 2 } }
}

// every pickable type name, base first then arrays
export function typeNames(types) {  const seen = []
  for (const n of [...BASIC_TYPES, ...(types || []).map((t) => t.name).filter(Boolean)])
    if (!seen.includes(n)) seen.push(n)
  return seen
}

// fields of a declared type by (lowercased) name — inspect port snapshot
export function fieldsOf(types, typeName) {
  if (!typeName || typeName === 'any') return null
  const t = (types || []).find((x) => (x.name || '').trim().toLowerCase() === typeName.toLowerCase())
  if (!t) return null
  return (t.fields || []).map((f) => ({ id: f.id, name: f.name || 'field', typeId: f.typeId }))
}

// the blank value of a type — what VAR starts a fresh fill-in with:
// arrays begin empty, structs carry an empty value per field (recursively),
// leaves are strings (bools 'true'/'false'), exactly as global defaults store
export function emptyValue(typeId, types) {
  const t = String(typeId || '').trim()
  if (t.endsWith('[]')) return []
  const fields = fieldsOf(types, t)
  if (fields) return Object.fromEntries(fields.map((f) => [f.name, emptyValue(f.typeId, types)]))
  if (t === 'bool') return 'false'
  return ''
}

// rename a type everywhere it is referenced (fn vars, foreach item types)
export function renameTypeInDoc(doc, oldName, newName) {
  const d = JSON.parse(JSON.stringify(doc))
  const fix = (t) => (t === oldName ? newName : t === oldName + '[]' ? newName + '[]' : t)
  for (const a of d.assets || [])
    for (const f of a.api || [])
      for (const key of ['inputs', 'outputs'])
        for (const v of f[key] || []) v.type = fix(v.type)
  for (const v of d.vars || []) v.type = fix(v.type)
  const walk = (g) => {
    for (const n of g.nodes) {
      if (n.kind === 'foreach') n.itemType = fix(n.itemType || '')
      if (n.kind === 'var' && n.variable) n.variable.type = fix(n.variable.type || '')
      if (n.kind === 'getg' || n.kind === 'setg') {
        n.gType = fix(n.gType || '')
        if (n.gName === oldName) n.gName = newName
      }
      if (n.graph) walk(n.graph)
    }
  }
  walk(d.design)
  return d
}

export function newVar() {
  return { id: uid('v'), name: '', type: 'int' }
}
export function newFn() {
  return { id: uid('fn'), name: '', inputs: [newVar()], outputs: [newVar()] }
}
export function newAsset(kind = 'art', name = '') {
  const ledger = kind === 'system' ? [{ id: uid('lv'), name: '', type: 'string', size: '' }] : []
  return { id: uid('asset'), kind, name, note: '', api: kind === 'system' ? [] : undefined, ledger }
}

// Resolve an asset's chosen API function: { asset, fn } or null.
export function resolveCall(call, assets) {
  if (!call || !call.asset || !call.fn) return null
  const a = (assets || []).find((x) => x.id === call.asset)
  const fn = a && (a.api || []).find((f) => f.id === call.fn)
  return a && fn ? { asset: a, fn } : null
}

// The complete ENTER-variable list of a machine graph, in enter order — the
// MACHINE node shows exactly this as its ⇣ inputs, and enter cards mirror it.
// Each entry remembers which door declared it. 📦 asset entries ride along
// too, typed 'asset' — a handle to one of the doc's assets.
export function enterVarsOf(graph) {
  const out = []
  for (const e of (graph || {}).nodes || []) {
    if (e.kind !== 'enter') continue
    for (const v of e.vars || [])
      out.push({ id: v.id, name: v.name || 'var', type: v.type || 'int', enter: e.name || 'enter' })
    for (const a of e.assets || [])
      out.push({ id: a.id, name: a.name || 'asset', type: 'asset', enter: e.name || 'enter' })
  }
  return out
}

// ---- array-op data ports -----------------------------------------------------
// APPEND/JOIN/REMOVE/REMOVE AT/SORT are pure data like INSPECT: they learn
// their itemType from the array first wired in, and every port's type follows.
const arrIn = (n, id = '__arr__', name = 'arr') => ({
  id,
  type: n.itemType ? n.itemType + '[]' : 'array',
  name,
})
const valIn = (n) => ({ id: '__val__', type: n.itemType || 'any', name: 'val' })
const arrOut = (n) => ({
  id: '__arr__',
  type: n.itemType ? n.itemType + '[]' : 'array',
  name: 'arr',
})

// ---- node kinds --------------------------------------------------------------
// One registry for both graph modes. Each kind declares:
//   mode     'flow' | 'machine'
//   ports()  flow ports: [{ id, dir, label }]
//   data()   typed data ports from the node's system calls / pool amount
//   fields   which kind-specific fields the editor shows
export const KINDS = {
  // ---- flow graph nodes -----------------------------------------------------
  step: {
    mode: 'flow',
    label: 'STEP',
    cls: 'nd-step',
    hint: 'plain step in the loop — flow passes through',
    ports: () => [{ id: 'out', dir: 'out', label: 'out' }],
  },
  event: {
    mode: 'flow',
    label: 'EVENT',
    cls: 'nd-event',
    hint: 'an event that fires when flow reaches it — calls system fns, may generate an asset',
    ports: () => [{ id: 'out', dir: 'out', label: 'out' }],
  },
  condition: {
    mode: 'flow',
    label: 'IF',
    cls: 'nd-cond',
    hint: 'test a condition — flow leaves through TRUE or FALSE',
    ports: () => [
      { id: 'true', dir: 'out', label: 'true' },
      { id: 'false', dir: 'out', label: 'false' },
    ],
  },
  choice: {
    mode: 'flow',
    label: 'CHOICE',
    cls: 'nd-choice',
    hint: 'player/loop decision — one exit port per option',
    ports: (n) => (n.exits || []).map((e) => ({ id: e.id, dir: 'out', label: e.label || '?' })),
  },
  load: {
    mode: 'flow',
    label: 'LOAD',
    cls: 'nd-load',
    hint: 'load a 📦 asset into memory',
    ports: () => [{ id: 'out', dir: 'out', label: 'loaded' }],
  },
  unload: {
    mode: 'flow',
    label: 'UNLOAD',
    cls: 'nd-unload',
    hint: 'remove a 📦 asset from memory',
    ports: () => [{ id: 'out', dir: 'out', label: 'unloaded' }],
  },
  input: {
    mode: 'flow',
    label: 'INPUT',
    cls: 'nd-input',
    hint: 'apply a 🎮 input asset',
    ports: () => [{ id: 'out', dir: 'out', label: 'out' }],
  },
  var: {
    mode: 'flow',
    // pure data like INSPECT — no flow ports at all (dataOnly keeps the
    // implicit flow in-port off it and the canvas off wiring flow into it)
    dataOnly: true,
    label: 'VAR',
    cls: 'nd-var',
    hint: 'makes a typed value — pick the type and fill in every field (child structs nest inside, arrays grow row by row) · ⇡ publishes it for any ⇣ of that type · drag its corner grip to widen the form',
    ports: () => [],
    data: (n) => ({
      in: [],
      out: n.variable?.type
        ? [{ id: '__val__', type: n.variable.type, name: n.variable.name || 'value' }]
        : [],
    }),
  },
  graph: {
    mode: 'flow',
    label: 'GRAPH',
    cls: 'nd-graph',
    hint: 'nested flow graph — flow enters it; RETURN links lead back out',
    ports: () => [{ id: 'return', dir: 'out', label: 'return' }],
  },
  machine: {
    mode: 'flow',
    label: 'MACHINE',
    cls: 'nd-machine',
    hint: 'nested machine — chains run its economy · its EXIT parts become named output ports here · its ENTER variables become ⇣ data inputs',
    ports: (n) => {
      const xs = ((n.graph || {}).nodes || []).filter((x) => x.kind === 'exit')
      return xs.length
        ? xs.map((x) => ({ id: x.id, dir: 'out', label: x.name || 'exit' }))
        : [{ id: 'out', dir: 'out', label: 'out' }]
    },
    // every ENTER var of the nested machine, in enter order — ONE complete
    // ⇣ list on this card however many enter doors the machine has
    data: (n) => ({ in: enterVarsOf(n.graph), out: [] }),
  },
  // ---- machine nodes ----------------------------------------------------------
  enter: {
    mode: 'machine',
    label: 'ENTER',
    cls: 'mc-enter',
    hint: 'the machine’s door — always starts chains · its typed variables and 📦 assets publish ⇡ inside and appear as ⇣ inputs on the MACHINE node in the parent graph',
    ports: () => [{ id: 'out', dir: 'out', label: '' }],
    data: (n) => ({
      in: [],
      out: [
        ...(n.vars || []).map((v) => ({ id: v.id, type: v.type || 'int', name: v.name || 'var' })),
        ...(n.assets || []).map((a) => ({ id: a.id, type: 'asset', name: a.name || 'asset' })),
      ],
    }),
  },
  source: {
    mode: 'machine',
    label: 'SOURCE',
    cls: 'mc-source',
    hint: 'chain entry — re-fires when its chain ends, adding amounts to downstream pools',
    ports: () => [{ id: 'out', dir: 'out', label: '' }],
  },
  drain: {
    mode: 'machine',
    label: 'DRAIN',
    cls: 'mc-drain',
    hint: 'removes its amount from upstream pools — the chain may continue out, so what follows reads the drained value · wire ⇣ in:int to dictate the amount',
    ports: () => [
      { id: 'in', dir: 'in', label: '' },
      { id: 'out', dir: 'out', label: '' },
    ],
    data: () => ({ in: [{ id: '__in__', type: 'int', name: 'in' }], out: [] }),
  },
  add: {
    mode: 'machine',
    label: 'ADD',
    cls: 'mc-add',
    hint: 'drain’s mirror — adds its amount to upstream pools (negative subtracts, e.g. −1) · chain continues out so what follows reads the new value · wire ⇣ in:int to dictate the amount',
    ports: () => [
      { id: 'in', dir: 'in', label: '' },
      { id: 'out', dir: 'out', label: '' },
    ],
    data: () => ({ in: [{ id: '__in__', type: 'int', name: 'in' }], out: [] }),
  },
  getg: {
    mode: 'both',
    label: 'GET GLOBAL',
    cls: 'mc-getg',
    hint: 'reads a document-wide global — pick it here · ⇡ publishes its value (live during sim, the default while editing)',
    ports: () => [],
    data: (n) => ({ in: [], out: [{ id: '__val__', type: n.gType || 'string', name: n.gName || 'value' }] }),
  },
  setg: {
    mode: 'both',
    label: 'SET GLOBAL',
    cls: 'mc-setg',
    hint: 'flow passes through as it writes its ⇣ value into a global — every GET GLOBAL reader (any machine, any round) sees it · unwired ⇣ leaves the global untouched',
    ports: () => [
      { id: 'in', dir: 'in', label: '' },
      { id: 'out', dir: 'out', label: '' },
    ],
    data: (n) => ({ in: [{ id: '__val__', type: n.gType || 'string', name: n.gName || 'value' }], out: [] }),
  },
  getledger: {
    mode: 'flow',
    label: 'GET LEDGER',
    cls: 'mc-getledger',
    hint: 'reads a system ledger variable — pick the system and variable · ⇡ publishes its value',
    ports: () => [],
    data: (n) => ({ in: [], out: [{ id: '__val__', type: n.lType || 'string', name: n.lName || 'value' }] }),
  },
  setledger: {
    mode: 'flow',
    label: 'SET LEDGER',
    cls: 'mc-setledger',
    hint: 'flow passes through as it writes its ⇣ value into a system ledger variable · every GET LEDGER reader sees it',
    ports: () => [
      { id: 'in', dir: 'in', label: '' },
      { id: 'out', dir: 'out', label: '' },
    ],
    data: (n) => ({ in: [{ id: '__val__', type: n.lType || 'string', name: n.lName || 'value' }], out: [] }),
  },
  pool: {
    mode: 'machine',
    label: 'POOL',
    cls: 'mc-pool',
    hint: 'token pool ⇡ int data · wire ⇣ in:int = live window onto that value — drains/sources edit it and write back to the origin',
    ports: () => [
      { id: 'in', dir: 'in', label: '' },
      { id: 'out', dir: 'out', label: '' },
    ],
    data: () => ({
      in: [{ id: '__in__', type: 'int', name: 'in' }],
      out: [{ id: '__int__', type: 'int', name: 'amount' }],
    }),
  },
  converter: {
    mode: 'machine',
    label: 'CONVERTER',
    cls: 'mc-converter',
    hint: 'chain passes through — takes amounts from input pools, gives to output pools',
    ports: flowIO(),
  },
  gate: {
    mode: 'machine',
    label: 'GATE',
    cls: 'mc-gate',
    hint: 'chain passes through — takes amounts from input pools (never gates)',
    ports: flowIO(),
  },
  randgate: {
    mode: 'machine',
    label: 'RAND GATE',
    cls: 'mc-randgate',
    hint: 'coin flip — half the chains that arrive drop here',
    ports: flowIO(),
  },
  ifb: {
    mode: 'machine',
    label: 'IF',
    cls: 'mc-ifb',
    hint: 'compares ⇣ a ⟨sign⟩ ⇣ b — int or bool, unwired sides take a custom value — chain leaves via true or false · ⇡ result:bool carries the verdict',
    ports: () => [
      { id: 'in', dir: 'in' },
      { id: 'true', dir: 'out', label: 'true' },
      { id: 'false', dir: 'out', label: 'false' },
    ],
    data: (n) => ({
      in: [
        { id: '__a__', type: n.cmpType || 'any', name: 'a' },
        { id: '__b__', type: n.cmpType || 'any', name: 'b' },
      ],
      out: [{ id: '__bool__', type: 'bool', name: 'result' }],
    }),
  },
  trader: {
    mode: 'machine',
    label: 'TRADER',
    cls: 'mc-trader',
    hint: 'chain passes through — takes amounts from input pools',
    ports: flowIO(),
  },
  delay: {
    mode: 'machine',
    label: 'DELAY',
    cls: 'mc-delay',
    hint: 'holds the chain N steps, then releases it',
    ports: flowIO(),
  },
  queue: {
    mode: 'machine',
    label: 'QUEUE',
    cls: 'mc-queue',
    hint: 'releases at most rate chains per step, the rest wait their turn (FIFO)',
    ports: flowIO(),
  },
  register: {
    mode: 'machine',
    label: 'REGISTER',
    cls: 'mc-register',
    hint: 'absorbs chains; pulses 1 downstream every N counted',
    ports: flowIO(),
  },
  for: {
    mode: 'machine',
    label: 'FOR',
    cls: 'mc-for',
    hint: 'counted loop — a chain arriving loads ⇣ to:int, iter out runs one iteration per step publishing ⇡ i:int · end out continues the chain when done',
    ports: () => [
      { id: 'in', dir: 'in', label: '' },
      { id: 'out', dir: 'out', label: 'iter' },
      { id: 'end', dir: 'out', label: 'end' },
    ],
    data: () => ({
      in: [{ id: '__to__', type: 'int', name: 'to' }],
      out: [{ id: '__i__', type: 'int', name: 'i' }],
    }),
  },
  foreach: {
    mode: 'machine',
    label: 'FOREACH',
    cls: 'mc-foreach',
    hint: 'array loop — a chain arriving loads ⇣ arr, iter out runs one iteration per step publishing ⇡ item + ⇡ index · end out continues the chain when done',
    ports: () => [
      { id: 'in', dir: 'in', label: '' },
      { id: 'out', dir: 'out', label: 'iter' },
      { id: 'end', dir: 'out', label: 'end' },
    ],
    data: (n) => ({
      in: [{ id: '__arr__', type: 'array', name: 'arr' }],
      out: [
        { id: '__item__', type: n.itemType || '?', name: 'item' },
        { id: '__idx__', type: 'int', name: 'index' },
      ],
    }),
  },
  inspect: {
    mode: 'machine',
    label: 'INSPECT',
    cls: 'mc-inspect',
    hint: 'pure data — no flow needed · ⇣ obj any value; one ⇡ per field of its declared type',
    ports: () => [],
    data: (n) => ({
      in: [{ id: '__obj__', type: n.objType || 'any', name: 'obj' }],
      out: (n.fields || []).map((f) => ({ id: f.id, type: f.typeId, name: f.name || 'field' })),
    }),
  },
  append: {
    mode: 'machine',
    label: 'APPEND',
    cls: 'mc-append',
    hint: 'pure data — ⇡ a copy of ⇣ arr with ⇣ val added at the end',
    ports: () => [],
    data: (n) => ({ in: [arrIn(n), valIn(n)], out: [arrOut(n)] }),
  },
  join: {
    mode: 'machine',
    label: 'JOIN',
    cls: 'mc-join',
    hint: 'pure data — ⇡ ⇣ a followed by ⇣ b, one array',
    ports: () => [],
    data: (n) => ({ in: [arrIn(n, '__a__', 'a'), arrIn(n, '__b__', 'b')], out: [arrOut(n)] }),
  },
  remove: {
    mode: 'machine',
    label: 'REMOVE',
    cls: 'mc-remove',
    hint: 'pure data — ⇡ ⇣ arr without any element equal to ⇣ val',
    ports: () => [],
    data: (n) => ({ in: [arrIn(n), valIn(n)], out: [arrOut(n)] }),
  },
  removeat: {
    mode: 'machine',
    label: 'REMOVE AT',
    cls: 'mc-removeat',
    hint: 'pure data — ⇡ ⇣ arr with the element at ⇣ at:int dropped',
    ports: () => [],
    data: (n) => ({
      in: [arrIn(n), { id: '__index__', type: 'int', name: 'at' }],
      out: [arrOut(n)],
    }),
  },
  sort: {
    mode: 'machine',
    label: 'SORT',
    cls: 'mc-sort',
    hint: 'pure data — ⇡ ⇣ arr ordered ascending — by ⇡ field of the item type, or by value itself',
    ports: () => [],
    data: (n) => ({ in: [arrIn(n)], out: [arrOut(n)] }),
  },
  clone: {
    mode: 'machine',
    label: 'CLONE',
    cls: 'mc-clone',
    hint: 'pure data — ⇡ a deep copy of ⇣ val: windows, pools and write-backs touch the copy, never the base value',
    ports: () => [],
    data: (n) => ({
      in: [{ id: '__val__', type: 'any', name: 'val' }],
      out: [{ id: '__val__', type: n.vType || '?', name: 'copy' }],
    }),
  },
  action: {
    mode: 'machine',
    label: 'ACTION',
    cls: 'mc-action',
    hint: 'chain waits here — click to fire (consumes amounts from input pools)',
    ports: flowIO(),
  },
  syscall: {
    mode: 'machine',
    label: 'SYS CALL',
    cls: 'mc-syscall',
    hint: 'calls its system fn as the chain passes · ⏳ can block — stays opened until clicked to return',
    ports: flowIO(),
  },
  text: {
    mode: 'both',
    label: 'TEXT',
    cls: 'mc-text',
    hint: 'annotation + group frame — drop other parts inside it and they move with the frame · drag its corner grip to size it over everything it labels',
    ports: () => [],
  },
  todo: {
    mode: 'both',
    label: 'TODO',
    cls: 'mc-todo',
    hint: 'checklist — add task lines and tick them off; a silent note that never joins the chain sim',
    ports: () => [],
  },
  exit: {
    mode: 'machine',
    label: 'EXIT',
    cls: 'mc-exit',
    hint: 'the machine ends here — named exits become output ports on the MACHINE node in the parent graph',
    ports: () => [{ id: 'in', dir: 'in', label: 'exit' }],
  },
}
function flowIO() {
  return () => [
    { id: 'in', dir: 'in', label: '' },
    { id: 'out', dir: 'out', label: '' },
  ]
}

export const kindsFor = (mode) =>
  Object.keys(KINDS).filter((k) => KINDS[k].mode === mode || KINDS[k].mode === 'both')

// ---- text-frame grouping ---------------------------------------------------------
// A TEXT node is a group frame: parts dropped so their anchor lands inside it are
// adopted (n.parent = frame id), and dragging the frame carries its children — and
// their children — along. Adoption is sticky: a part keeps its current frame as
// long as it stays inside it, so overlapping frames never steal members.
export function textFrame(n) {
  return { x: n.x, y: n.y, w: n.w || 184, h: n.h || 88 }
}
const inFrame = (f, n) => n.x >= f.x && n.x <= f.x + f.w && n.y >= f.y && n.y <= f.y + f.h

// the node plus every descendant through parent links
export function groupKin(g, id) {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const n of g.nodes || [])
      if (n.parent && out.has(n.parent) && !out.has(n.id)) {
        out.add(n.id)
        grew = true
      }
  }
  return out
}

// re-home each moved node to the smallest text frame holding its anchor — never
// one of its own descendants (cycle guard). Returns a fresh nodes array, or the
// same one when nothing changed
export function adoptInto(g, ids) {
  const frames = (g.nodes || []).filter((n) => n.kind === 'text')
  if (!frames.length) return g.nodes
  let changed = false
  const nodes = (g.nodes || []).map((n) => {
    if (!ids.includes(n.id)) return n
    const cur = n.parent ? frames.find((t) => t.id === n.parent) : null
    if (cur && cur.id !== n.id && inFrame(textFrame(cur), n)) return n // sticky — stays put
    const mine = groupKin(g, n.id)
    let best = null
    let bestArea = Infinity
    for (const t of frames) {
      if (t.id === n.id || mine.has(t.id)) continue
      const f = textFrame(t)
      if (!inFrame(f, n)) continue
      const area = f.w * f.h
      if (area < bestArea) {
        best = t
        bestArea = area
      }
    }
    const np = best ? best.id : undefined
    if ((n.parent || undefined) === np) return n
    changed = true
    return { ...n, parent: np }
  })
  return changed ? nodes : g.nodes
}
export const kindMeta = (node) => KINDS[node.kind] || {}

// Data ports of a node: { in: [{id,type,name}], out: [...] }
// event/syscall nodes expose every resolved system call's fn variables;
// pools expose their amount as int.
// coerce a VAR fill-in into its runtime value — leaf strings become their
// declared numbers/bools, structs and arrays keep their shape and recurse.
// `types` may be missing (engine mem without the doc) — then struct leaves
// simply stay as they are.
export function typedValue(typeId, value, types) {
  const t = String(typeId || '').trim()
  if (t.endsWith('[]')) {
    const base = t.replace(/\[\s*\]$/, '').trim()
    return (Array.isArray(value) ? value : []).map((x) => typedValue(base, x, types))
  }
  if (t === 'int') return Math.trunc(Number(value)) || 0
  if (t === 'float') return Number(value) || 0
  if (t === 'bool') return value === true || value === 'true' || value === '1'
  const fields = fieldsOf(types, t)
  if (fields && value && typeof value === 'object' && !Array.isArray(value))
    return Object.fromEntries(fields.map((f) => [f.name, typedValue(f.typeId, value[f.name], types)]))
  return value === undefined ? null : value // string · asset id · undeclared
}

export function dataPorts(node, assets) {
  const meta = KINDS[node.kind] || {}
  const d = meta.data ? meta.data(node) : { in: [], out: [] }
  const out = { in: [...d.in], out: [...d.out] }
  for (const call of node.calls || []) {
    const r = resolveCall(call, assets)
    if (!r) continue
    for (const v of r.fn.inputs || []) if (v.name || v.type) out.in.push({ id: v.id, type: v.type, name: v.name })
    for (const v of r.fn.outputs || []) if (v.name || v.type) out.out.push({ id: v.id, type: v.type, name: v.name })
  }
  return out
}

// Type of one data port, lower-cased for comparison; null if gone.
export function dataPortType(graph, assets, nodeId, portId, dir) {
  const node = (graph.nodes || []).find((n) => n.id === nodeId)
  if (!node) return null
  const set = dataPorts(node, assets)[dir]
  const p = set.find((x) => x.id === portId)
  return p ? (p.type || '').trim().toLowerCase() : null
}

// The data a call takes/returns, for logs and labels. Blank input vars
// (leftovers from API editing) are ignored.
export function fnSig(r) {
  const real = (vs) => (vs || []).filter((v) => v.name || v.type)
  const fmt = (vs, dash) => real(vs).map((v) => `${v.name || '?'}:${v.type || '?'}`).join(', ') || dash
  return { in: fmt(r.fn.inputs, 'void'), out: fmt(r.fn.outputs, 'void') }
}

// ---- nodes & graphs ------------------------------------------------------------
export function newNode(kind, x, y) {
  const n = { id: uid('nd'), kind, name: '', x: Math.round(x), y: Math.round(y) }
  if (kind === 'choice') n.exits = [{ id: uid('ex'), label: 'option a' }, { id: uid('ex'), label: 'option b' }]
  if (kind === 'event') n.calls = []
  if (kind === 'load' || kind === 'unload' || kind === 'input') n.asset = null
  if (kind === 'var') n.variable = { name: '', type: 'string', value: '' }
  if (kind === 'graph') n.graph = newGraph('flow', n.name || 'sub graph')
  if (kind === 'machine') n.graph = newGraph('machine', n.name || 'machine')
  if (kind === 'pool') n.init = 10
  if (kind === 'drain') n.drain = 1
  if (kind === 'add') n.gain = 1
  if (kind === 'source' || kind === 'drain') n.auto = true
  if (kind === 'delay') n.delay = 3
  if (kind === 'queue') n.rate = 1
  if (kind === 'register') n.countTo = 2
  if (kind === 'foreach') n.itemType = '?'
  if (['append', 'join', 'remove', 'removeat', 'sort'].includes(kind)) n.itemType = null // learns from the first array wired in
  if (kind === 'sort') n.field = ''
  if (kind === 'clone') n.vType = ''
  if (kind === 'inspect') n.objType = 'any'
  if (kind === 'syscall') n.calls = [{ asset: null, fn: null }]
  if (kind === 'syscall') n.out = {}
  if (kind === 'todo') n.todos = [{ id: uid('td'), text: '', done: false }]
  if (kind === 'enter') n.vars = [{ id: uid('ev'), name: '', type: 'int', value: '' }]
  if (kind === 'enter') n.assets = []
  if (kind === 'getledger' || kind === 'setledger') {
    n.lRef = null
    n.lName = ''
    n.lType = ''
    n.lVarId = null
  }
  return n
}

export function newGraph(mode, name) {
  return { id: uid('g'), mode, name: name || (mode === 'flow' ? 'Main Loop' : 'machine'), entry: null, nodes: [], links: [] }
}

export function newDoc(name = 'Untitled Design') {
  return {
    app: 'loopdoc-composer',
    version: 1,
    name,
    design: newGraph('flow', 'Main Loop'),
    notes: { business: '', mood: '' },
    assets: [],
    types: [],
    vars: [],
  }
}

// ---- graph operations (pure) ------------------------------------------------------
export function patchNode(graph, id, patch) {
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }
}

export function removeNode(graph, id) {
  return {
    ...graph,
    nodes: graph.nodes
      .filter((n) => n.id !== id)
      .map((n) => (n.parent === id ? { ...n, parent: undefined } : n)), // orphan the frame's children
    links: graph.links.filter((l) => l.from !== id && l.to !== id),
    entry: graph.entry === id ? null : graph.entry,
  }
}

// Remove links that no longer make sense after a node edit (ports vanished).
export function pruneLinks(graph, assets, nodeId) {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return graph
  const meta = kindMeta(node)
  const flowIds = new Set(meta.ports ? meta.ports(node).map((p) => p.id) : [])
  const dp = dataPorts(node, assets)
  const dataIds = new Set([...dp.in.map((p) => p.id), ...dp.out.map((p) => p.id)])
  return {
    ...graph,
    links: graph.links.filter((l) => {
      if (l.from === nodeId && l.kind === 'flow' && !flowIds.has(l.fromPort)) return false
      if (l.to === nodeId && l.kind === 'flow' && !flowIds.has(l.toPort)) return false
      if (l.from === nodeId && l.kind === 'data' && !dataIds.has(l.fromPort)) return false
      if (l.to === nodeId && l.kind === 'data' && !dataIds.has(l.toPort)) return false
      return true
    }),
  }
}

// ---- doc-wide walks -------------------------------------------------------------
export function walkGraphs(graph, fn, path = []) {
  fn(graph, path)
  for (const n of graph.nodes) if (n.graph) walkGraphs(n.graph, fn, [...path, n])
}

// Every asset referenced by name/id across all graphs, with a label helper.
export function assetLabel(id, assets) {
  const a = (assets || []).find((x) => x.id === id)
  return a ? `${assetIcon(a.kind)} ${a.name || '(unnamed)'}` : String(id || '?')
}

export function removeAssetRefs(doc, assetId) {
  // ids owned by the deleted system's API — data links die with it
  const gone = new Set()
  const sys = (doc.assets || []).find((a) => a.id === assetId)
  for (const f of (sys && sys.api) || [])
    for (const v of [...(f.inputs || []), ...(f.outputs || [])]) gone.add(v.id)
  const cleanGraph = (graph) => {
    graph.links = (graph.links || []).filter((l) => !(l.kind === 'data' && (gone.has(l.fromPort) || gone.has(l.toPort))))
    for (const n of graph.nodes) {
      if (n.asset === assetId) n.asset = null
      if (Array.isArray(n.calls)) n.calls = n.calls.filter((c) => c.asset !== assetId)
      if (Array.isArray(n.assets)) n.assets.forEach((a) => { if (a.asset === assetId) a.asset = null })
      if (n.graph) cleanGraph(n.graph)
    }
  }
  // deep-clone the graph tree so we never mutate the current doc in place
  const next = { ...doc, assets: (doc.assets || []).filter((a) => a.id !== assetId), design: JSON.parse(JSON.stringify(doc.design)) }
  cleanGraph(next.design)
  return next
}

// ---- grid ------------------------------------------------------------------------
// snap pitch — keep in sync with the 26px dot grid in theme.css
export const GRID = 26
export const snap = (v) => Math.round(v / GRID) * GRID

// ---- copy/paste re-id ------------------------------------------------------------
export function reidNode(node, map) {
  const nn = JSON.parse(JSON.stringify(node))
  map.set(nn.id, (nn.id = uid('nd')))
  ;(nn.exits || []).forEach((e) => {
    const old = e.id
    e.id = uid('ex')
    map.set(`${node.id}:${old}`, e.id)
  })
  ;(nn.todos || []).forEach((t) => (t.id = uid('td'))) // checklist rows are private — fresh ids, no port maps
  // ENTER variables ARE ports (inside the machine and on the parent MACHINE
  // node) — re-id and register both key forms so data wires follow
  ;(nn.vars || []).forEach((v) => {
    const old = v.id
    v.id = uid('ev')
    map.set(old, v.id)
    map.set(`${node.id}:${old}`, v.id)
  })
  ;(nn.assets || []).forEach((a) => {
    const old = a.id
    a.id = uid('ev')
    map.set(old, a.id)
    map.set(`${node.id}:${old}`, a.id)
  })
  if (nn.gen) nn.gen = { ...nn.gen, id: uid('asset') }
  if (nn.graph) {
    // MACHINE node: its parent-side ports ARE the nested exit nodes, so
    // links wired to those ports (fromPort = exit node id) must follow the
    // exit re-id — register `oldNode:oldExit → newExit` after reidding
    const oldExits = (nn.graph.nodes || []).filter((x) => x.kind === 'exit').map((x) => x.id)
    // …and its ⇣ data ports ARE the nested ENTER variables (vars and assets)
    const oldVars = (nn.graph.nodes || [])
      .filter((x) => x.kind === 'enter')
      .flatMap((x) => [...(x.vars || []), ...(x.assets || [])].map((v) => v.id))
    reidGraph(nn.graph, map)
    for (const old of oldExits) {
      const nx = map.get(old)
      if (nx) map.set(`${node.id}:${old}`, nx)
    }
    for (const old of oldVars) {
      const nx = map.get(old)
      if (nx) map.set(`${node.id}:${old}`, nx)
    }
  }
  return nn
}

export function reidGraph(graph, map = new Map()) {
  graph.id = uid('g')
  // reidNode returns a fresh deep copy — the new nodes must REPLACE the old
  // ones, otherwise pastes keep duplicate ids (shared moves/deletes, ghost
  // React keys) while links point at ids that no longer exist
  graph.nodes = graph.nodes.map((n) => reidNode(n, map))
  // group frames inside a paste keep their children — remap parent; when the
  // frame itself was not part of the clipboard map.get misses and it clears
  graph.nodes.forEach((n) => {
    if (n.parent) n.parent = map.get(n.parent)
  })
  graph.links = (graph.links || []).map((l) => ({
    ...l,
    id: uid('lk'),
    from: map.get(l.from) || l.from,
    to: map.get(l.to) || l.to,
    fromPort: map.get(`${l.from}:${l.fromPort}`) || l.fromPort,
    toPort: map.get(`${l.to}:${l.toPort}`) || l.toPort,
  }))
  graph.entry = map.get(graph.entry) || graph.entry
  return graph
}

// ---- persistence --------------------------------------------------------------
export function serializeDoc(doc) {
  return JSON.stringify(doc, null, 2)
}

// repair per graph: unique node/link ids (copies made by the pre-fix paste
// bug shared ids with their originals → ghost renders, shared move/delete)
function dedupeIds(g) {
  const seenN = new Set()
  for (const n of g.nodes || []) {
    if (seenN.has(n.id)) n.id = uid('nd')
    seenN.add(n.id)
  }
  const seenL = new Set()
  for (const l of g.links || []) {
    if (seenL.has(l.id)) l.id = uid('lk')
    seenL.add(l.id)
  }
}

// The canvases grow endlessly toward the top/left while editing — the flow
// canvas pans by moving its origin, and origin is VIEW state: it is not saved,
// so a doc whose parts sit at negative coordinates loads with them past the
// unscrollable edge, invisible until something drags the origin back. Repair on
// load instead: shift every graph's parts — and the wire anchors steering
// between them, they are absolute surface coords too — into positive space.
const CANVAS_MARGIN = 40
function intoView(g) {
  const pts = [...(g.nodes || []), ...(g.links || []).flatMap((l) => l.anchors || [])]
  if (!pts.length) return
  const dx = pts.reduce((m, p) => Math.min(m, (p.x || 0) - CANVAS_MARGIN), 0)
  const dy = pts.reduce((m, p) => Math.min(m, (p.y || 0) - CANVAS_MARGIN), 0)
  if (dx >= 0 && dy >= 0) return
  const sx = dx < 0 ? -dx : 0
  const sy = dy < 0 ? -dy : 0
  for (const n of g.nodes || []) {
    n.x = (n.x || 0) + sx
    n.y = (n.y || 0) + sy
  }
  for (const l of g.links || []) for (const a of l.anchors || []) {
    a.x += sx
    a.y += sy
  }
}

export function parseDoc(text) {
  const d = JSON.parse(text)
  if (!d || d.app !== 'loopdoc-composer' || !d.design) throw new Error('not a loopdoc composer file')
  d.notes = { business: '', mood: '', ...(d.notes || {}) }
  d.assets = d.assets || []
  d.types = d.types || []
  d.vars = d.vars || []
  walkGraphs(d.design, (g) => {
    dedupeIds(g) // heal any doc corrupted by the old paste bug
    intoView(g) // pull edge-parked parts back inside the reachable canvas
  })
  return d
}
