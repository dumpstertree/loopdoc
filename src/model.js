// ---------------------------------------------------------------------------
// loopdoc composer — document model
//
// One vocabulary everywhere:
//   Doc  ▸ Graph ▸ Node + Link            (assets live on the Doc)
//
// A Graph is either `flow` (the game-loop canvas: control flow between nodes)
// or `machine` (a chain-execution sim: entry doors, steps, waits, data wires). Both share the same node
// and link shapes, the same port model and the same typed data-wire rules.
//
//   Node { id, kind, name, x, y, ...kind fields }
//   Link { id, kind:'flow'|'data', from, fromPort, to, toPort, anchors? }
//
// Flow links move control (flow graphs) or carry the chain forward (machines).
// Data links carry a typed value from a ⇡ output port to a ⇣ input port of
// the same type — doors, vars and system calls expose their typed values.
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

// An isolated function: one named computation living on the doc, picked by FUNC
// parts on any machine canvas. The body graph is a `func` graph — a machine-like
// graph scoped to this single function, and its nodes/links will live right here.
export function newFunc(name = '') {
  return { id: uid('fn'), name, note: '', graph: newFuncGraph(name) }
}

// The body of a function is a machine-like canvas that already knows its own
// door and its own end: ENTER and EXIT are born with the graph, so a function
// always has exactly one of each — they can never be spawned, copied or deleted.
export function newFuncGraph(name = '') {
  const g = newGraph('func', name)
  const en = newNode('enter', 100, 200)
  const ex = newNode('exit', 620, 200)
  en.name = 'enter'
  ex.name = 'exit'
  g.nodes.push(en, ex)
  g.entry = en.id
  return g
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
// document: machine sims READ and WRITE it in place (SET and GET parts).
// Globals only reset here (↺ / new doc / open file), which is what makes
// scenes one game instead of one sim each.
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
// plus the midpoint of the (vertical) leg where edge extras hang.
// ds/dt pin which way each end's first/last leg must run (+1 right, −1
// left, 0 free — only a wire's in-progress cursor end is free): a port
// always faces its own card edge, so ⇡ exits rightward and ⇣ is entered
// from the left — a flipped part reverses that facing.
const WIRE_STUB = 14
// the elbow's vertical lane for one hop: start at the preferred lane and
// slide it into the half-plane each fixed end demands (a flipped ⇡ keeps its
// lane on the port's left, a flipped ⇣ entered from the port's right). Sliding
// is what makes anchor hops behave — an anchor on the "wrong" side of a
// flipped port still exits the port facing outward and bends AT the anchor
// instead of stub-folding back through it. Only when the two ends' demands
// contradict (both fixed, facing away from each other) is there no legal
// single lane, and the hop stubs out of both port sides and crosses between.
const laneFor = (p, q, ds, dt, want) => {
  let lo = -Infinity
  let hi = Infinity
  if (ds > 0) lo = Math.max(lo, p.x + WIRE_STUB)
  if (ds < 0) hi = Math.min(hi, p.x - WIRE_STUB)
  if (dt > 0) hi = Math.min(hi, q.x - WIRE_STUB)
  if (dt < 0) lo = Math.max(lo, q.x + WIRE_STUB)
  if (lo > hi) return null
  return want < lo ? lo : want > hi ? hi : want
}
const hopPts = (p, q, ds, dt, want) => {
  const mx = laneFor(p, q, ds, dt, want)
  if (mx !== null)
    return { pts: [{ x: mx, y: p.y }, { x: mx, y: q.y }, q], mid: { x: mx, y: (p.y + q.y) / 2 } }
  const ex = p.x + (ds || 1) * WIRE_STUB
  const en = q.x - (dt || 1) * WIRE_STUB
  const my = (p.y + q.y) / 2
  return {
    pts: [{ x: ex, y: p.y }, { x: ex, y: my }, { x: en, y: my }, { x: en, y: q.y }, q],
    mid: { x: (ex + en) / 2, y: my },
  }
}
export function orth(sx, sy, tx, ty, ds = 0, dt = 0) {
  const p = { x: sx, y: sy }
  const q = { x: tx, y: ty }
  const h = hopPts(p, q, ds, dt, p.x + Math.max(30, (q.x - p.x) / 2))
  return { d: `M ${p.x} ${p.y} ` + h.pts.map((r) => `L ${r.x} ${r.y}`).join(' '), mid: h.mid }
}

// a wire's path: 90° breaks all the way through. Dropped anchors steer the
// run — every hop between two points is the same horizontal → vertical →
// horizontal elbow the plain wire uses, so placing a point on a line BENDS it
// instead of pulling it into a diagonal. Legs that land where they started
// collapse to nothing, so a hop sharing an x or a y is simply a straight run.
// mid lands on the middle hop's leg, where edge extras hang. Only the end
// hops honour flip dirs — anchors are free steering points, but a hop that
// touches a flipped end slides its elbow into that end's half-plane, so the
// wire never folds back at an anchor sitting on the flipped side.
export function routePath(a, b, anchors, ds = 0, dt = 0) {
  if (!anchors || !anchors.length) return orth(a.x, a.y, b.x, b.y, ds, dt)
  const pts = [a, ...anchors, b]
  let d = `M ${pts[0].x} ${pts[0].y}`
  const mids = []
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]
    const q = pts[i]
    const h = hopPts(p, q, i === 1 ? ds : 0, i === pts.length - 1 ? dt : 0, (p.x + q.x) / 2)
    d += ' ' + h.pts.map((r) => `L ${r.x} ${r.y}`).join(' ')
    mids.push(h.mid)
  }
  const h2 = Math.min(pts.length - 1, Math.max(1, Math.floor(pts.length / 2)))
  return { d, mid: mids[h2 - 1] }
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
      if (n.kind === 'var' && n.variable) {
        n.variable.type = fix(n.variable.type || '')
        for (const f of n.variable.fields || []) f.typeId = fix(f.typeId || '') // field-port snapshot rides along
      }
      for (const key of ['vars', 'inVars', 'outVars']) // ENTER/EXIT doors + STEP's ⇣/⇡ variables
        for (const v of n[key] || []) v.type = fix(v.type || '')
      if (n.kind === 'getg' || n.kind === 'setg') {
        n.gType = fix(n.gType || '')
        if (n.gName === oldName) n.gName = newName
      }
      if (n.graph) walk(n.graph)
    }
  }
  walk(d.design)
  for (const f of d.funcs || []) if (f.graph) walk(f.graph) // ƒ bodies live beside design, not under it
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

// A FUNC part's data ports ARE the interface of the definition it picks: the
// body's ENTER variables become ⇣ inputs the caller must feed, and its EXIT
// variables ⇡ outputs the caller can read. Because the body lives once on the
// doc, every call site shows the very same ports.
export function funcPorts(node, funcs) {
  const f = (funcs || []).find((x) => x.id === node.func)
  if (!f) return { in: [], out: [] }
  const g = f.graph || { nodes: [] }
  return {
    in: enterVarsOf(g).map((v) => ({ id: v.id, type: v.type, name: v.name })),
    out: exitVarsOf(g).map((v) => ({ id: v.id, type: v.type, name: v.name })),
  }
}

// The mirror image: every EXIT variable of a machine graph, in exit order —
// this is exactly what the MACHINE node shows as its ⇡ outputs. Each entry
// remembers which door declared it, so two exits may both announce 'score'
// without colliding (they keep their own ids and their own ⇡ port above).
export function exitVarsOf(graph) {
  const out = []
  for (const e of (graph || {}).nodes || []) {
    if (e.kind !== 'exit') continue
    for (const v of e.vars || [])
      out.push({ id: v.id, name: v.name || 'var', type: v.type || 'int', exit: e.name || 'exit' })
  }
  return out
}

// Resolve an EXIT REF's target inside the same graph. Only real EXIT nodes
// qualify — refs never chain through other refs.
export function resolveExitRef(graph, node) {
  if (!node || node.kind !== 'exitinst' || !node.exitRef) return null
  const t = ((graph || {}).nodes || []).find((n) => n.id === node.exitRef)
  return t && t.kind === 'exit' ? t : null
}

// The ⇣ input ports an EXIT REF mirrors from its target EXIT's variables —
// live from the target, so the instance follows every change to the original.
export function exitInstVars(graph, node) {
  const t = resolveExitRef(graph, node)
  if (!t) return []
  return (t.vars || []).map((v) => ({ id: v.id, type: v.type || 'int', name: v.name || 'var' }))
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

// ---- math ops ----------------------------------------------------------------
// ADD · SUBTRACT · MULTIPLY · DIVIDE · MOD share one card shape and one port
// layout: ⇣ a and ⇣ b are number operands (type 'num' — int or float only),
// ⇡ result carries the answer. Their ⇡ type learns from the operands: float
// when either side is a float, int otherwise.
export const MATH = { add: '+', sub: '−', mul: '×', div: '÷', mod: 'mod' }
const mathData = (n) => ({
  in: [{ id: '__a__', type: 'num', name: 'a' }, { id: '__b__', type: 'num', name: 'b' }],
  out: [{ id: '__val__', type: n.rType || 'int', name: 'result' }],
})

export const BOOL = { and: 'all', or: 'any' }
// and/or parts — bool ⇣ slots combined into one bool ⇡; the slot count lives
// on the node (n.slots, default 2) and the + ⇣ button at the card foot grows
// it; slot ids are positional so wiring never needs bookkeeping
const boolData = (n) => {
  const slots = Math.max(2, Number(n.slots ?? 2))
  return {
    in: Array.from({ length: slots }, (_, i) => ({ id: `__s${i}__`, type: 'bool', name: `slot ${i + 1}` })),
    out: [{ id: '__bool__', type: 'bool', name: 'result' }],
  }
}

// ---- node kinds --------------------------------------------------------------
// One registry for both graph modes. Each kind declares:
//   mode     'flow' | 'machine'
//   ports()  flow ports: [{ id, dir, label }]
//   data()   typed data ports from the node's system calls / func ports
//   fields   which kind-specific fields the editor shows
export const KINDS = {
  // ---- flow graph nodes -----------------------------------------------------
  step: {
    canvas: ['flow'],
    label: 'STEP',
    cls: 'nd-step',
    hint: 'plain step in the loop — flow passes through · its ⇣/⇡ variables are typed data ports any producer or consumer can wire',
    ports: () => [{ id: 'out', dir: 'out', label: 'out' }],
    data: (n) => ({
      in: (n.inVars || []).map((v) => ({ id: v.id, type: v.type || 'int', name: v.name || 'value' })),
      out: (n.outVars || []).map((v) => ({ id: v.id, type: v.type || 'int', name: v.name || 'value' })),
    }),
    shape: { title: true, in: true, outs: true, rows: 'step', actions: ['invar', 'outvar'] },
  },
  event: {
    canvas: ['flow'],
    label: 'EVENT',
    cls: 'nd-event',
    hint: 'an event that fires when flow reaches it — calls system fns, may generate an asset',
    ports: () => [{ id: 'out', dir: 'out', label: 'out' }],
    shape: { title: true, in: true, outs: true, rows: 'calls', actions: ['call', 'generate'] },
  },
  condition: {
    canvas: ['flow'],
    label: 'IF',
    cls: 'nd-cond',
    hint: 'test a condition — flow leaves through TRUE or FALSE',
    ports: () => [
      { id: 'true', dir: 'out', label: 'true' },
      { id: 'false', dir: 'out', label: 'false' },
    ],
    shape: { title: true, in: true, outs: true, rows: 'test' },
  },
  choice: {
    canvas: ['flow'],
    label: 'CHOICE',
    cls: 'nd-choice',
    hint: 'player/loop decision — one exit port per option',
    ports: (n) => (n.exits || []).map((e) => ({ id: e.id, dir: 'out', label: e.label || '?' })),
    shape: { title: true, in: true, outs: true, rows: 'options', actions: ['option'] },
  },
  load: {
    canvas: ['flow'],
    label: 'LOAD',
    cls: 'nd-load',
    hint: 'load a 📦 asset into memory',
    ports: () => [{ id: 'out', dir: 'out', label: 'loaded' }],
    shape: { title: true, in: true, outs: true, rows: 'asset' },
  },
  unload: {
    canvas: ['flow'],
    label: 'UNLOAD',
    cls: 'nd-unload',
    hint: 'remove a 📦 asset from memory',
    ports: () => [{ id: 'out', dir: 'out', label: 'unloaded' }],
    shape: { title: true, in: true, outs: true, rows: 'asset' },
  },
  input: {
    canvas: ['flow'],
    label: 'INPUT',
    cls: 'nd-input',
    hint: 'apply a 🎮 input asset',
    ports: () => [{ id: 'out', dir: 'out', label: 'out' }],
    shape: { title: true, in: true, outs: true, rows: 'asset' },
  },
  var: {
    canvas: ['flow', 'func'],
    // pure data like INSPECT — no flow ports at all (dataOnly keeps the
    // implicit flow in-port off it and the canvas off wiring flow into it)
    dataOnly: true,
    label: 'VAR',
    cls: 'nd-var',
    hint: 'makes a typed value — pick the type and fill in every field (child structs nest inside, arrays grow row by row) · ⇡ publishes it for any ⇣ of that type · drag its corner grip to widen the form',
    ports: () => [],
    data: (n) => {
      const v = n.variable || {}
      const t = String(v.type || '').trim()
      if (!t) return { in: [], out: [] }
      // the parts that make the value up get their own ⇣: a ledger struct
      // decomposes into per-field ports (ids mirror the ledger fields —
      // snapshot in variable.fields, stored when the type is picked, since
      // data() can't see the ledger); leaves and arrays take one whole-value ⇣.
      // Unwired ports fall back to the fill-in fields typed on the card.
      const ins = (v.fields || []).length && !t.endsWith('[]')
        ? v.fields.map((f) => ({ id: f.id, type: f.typeId, name: f.name || 'field' }))
        : [{ id: '__in__', type: t, name: v.name || 'value' }]
      return { in: ins, out: [{ id: '__val__', type: t, name: v.name || 'value' }] }
    },
    shape: { title: true, rows: 'fields', actions: ['row'], data: true, grip: 'form' },
  },
  graph: {
    canvas: ['flow'],
    label: 'GRAPH',
    cls: 'nd-graph',
    hint: 'nested flow graph — flow enters it; RETURN links lead back out',
    ports: () => [{ id: 'return', dir: 'out', label: 'return' }],
    shape: { title: true, in: true, outs: true, rows: 'nested', actions: ['open'], container: true },
  },
  machine: {
    canvas: ['flow'],
    label: 'MACHINE',
    cls: 'nd-machine',
    hint:
      'nested machine — chains run its economy · its EXIT parts become named output ports here · its ENTER variables become ⇣ data inputs · its EXIT variables become ⇡ data outputs',
    ports: (n) => {
      const xs = ((n.graph || {}).nodes || []).filter((x) => x.kind === 'exit')
      return xs.length
        ? xs.map((x) => ({ id: x.id, dir: 'out', label: x.name || 'exit' }))
        : [{ id: 'out', dir: 'out', label: 'out' }]
    },
    // every ENTER var of the nested machine, in enter order — ONE complete
    // ⇣ list on this card however many enter doors the machine has; its ⇡
    // mirror is every EXIT var, tagged with the door it leaves through
    data: (n) => ({ in: enterVarsOf(n.graph), out: exitVarsOf(n.graph) }),
    shape: { title: true, in: true, outs: true, rows: 'nested', actions: ['open'], data: true, container: true },
  },
  // ---- machine nodes ----------------------------------------------------------
  enter: {
    canvas: ['machine'],
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
    shape: { title: true, outs: true, rows: 'vars', actions: ['variable', 'asset'], data: true },
  },
  getg: {
    canvas: ['flow', 'machine', 'func'],
    // pure data like VAR — the value publishes through its ⇡ alone
    dataOnly: true,
    label: 'GET GLOBAL',
    cls: 'mc-getg',
    hint: 'reads a document-wide global — pick it here · ⇡ publishes its value (live during sim, the default while editing)',
    ports: () => [],
    data: (n) => ({ in: [], out: [{ id: '__val__', type: n.gType || 'string', name: n.gName || 'value' }] }),
    shape: { title: true, rows: 'global', data: true },
  },
  setg: {
    canvas: ['flow', 'machine', 'func'],
    label: 'SET GLOBAL',
    cls: 'mc-setg',
    hint: 'flow passes through as it writes its ⇣ value into a global — every GET GLOBAL reader (any machine, any round) sees it · unwired ⇣ leaves the global untouched',
    ports: () => [
      { id: 'in', dir: 'in', label: '' },
      { id: 'out', dir: 'out', label: '' },
    ],
    data: (n) => ({ in: [{ id: '__val__', type: n.gType || 'string', name: n.gName || 'value' }], out: [] }),
    shape: { title: true, in: true, outs: true, rows: 'global', data: true },
  },
  getledger: {
    canvas: ['flow', 'machine', 'func'],
    // pure data — the ledger value publishes through its ⇡, no chain touches it
    dataOnly: true,
    label: 'GET LEDGER',
    cls: 'mc-getledger',
    hint: 'reads a system ledger variable — pick the system and variable · ⇡ publishes its value',
    ports: () => [],
    data: (n) => ({ in: [], out: [{ id: '__val__', type: n.lType || 'string', name: n.lName || 'value' }] }),
    shape: { title: true, rows: 'ledger', data: true },
  },
  setledger: {
    canvas: ['flow', 'machine', 'func'],
    label: 'SET LEDGER',
    cls: 'mc-setledger',
    hint: 'flow passes through as it writes its ⇣ value into a system ledger variable · every GET LEDGER reader sees it',
    ports: () => [
      { id: 'in', dir: 'in', label: '' },
      { id: 'out', dir: 'out', label: '' },
    ],
    data: (n) => ({ in: [{ id: '__val__', type: n.lType || 'string', name: n.lName || 'value' }], out: [] }),
    // in the chain — its flow in/out pair is declared in ports(), and the
    // shape marks it as a pass-through part (SET GLOBAL wears the same pair)
    shape: { title: true, in: true, outs: true, rows: 'ledger', data: true },
  },
  func: {
    canvas: ['flow', 'machine', 'func'],
    // graph *and* machine canvases may call a function — the call site lives
    // wherever it is dropped, the body always lives on the doc
    label: 'FUNC',
    cls: 'mc-func',
    hint:
      'calls one isolated function — pick it from the ƒ FUNCTIONS list on the data tab · double-click or ▶ enter walks into its body · its ⇣/⇡ mirror the function’s ENTER/EXIT variables',
    ports: flowIO(),
    data: (n, funcs) => funcPorts(n, funcs),
    shape: { title: true, in: true, outs: true, rows: 'pick', actions: ['enter'], data: true, container: true },
  },
  ifb: {
    canvas: ['machine', 'func'],
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
    shape: { title: true, in: true, outs: true, rows: 'cmp', data: true },
  },
  and: {
    canvas: ['flow', 'machine', 'func'],
    label: 'AND',
    cls: 'mc-ifb',
    hint: 'chain passes through · ⇡ result:true only when every fed ⇣ slot is true · an unwired ⇣ takes the true/false typed on the card · + ⇣ bool grows another input slot',
    ports: flowIO(),
    data: boolData,
    shape: { title: true, in: true, outs: true, rows: 'bool', actions: ['slot'], data: true },
  },
  or: {
    canvas: ['flow', 'machine', 'func'],
    label: 'OR',
    cls: 'mc-ifb',
    hint: 'chain passes through · ⇡ result:true when any fed ⇣ slot is true · an unwired ⇣ takes the true/false typed on the card · + ⇣ bool grows another input slot',
    ports: flowIO(),
    data: boolData,
    shape: { title: true, in: true, outs: true, rows: 'bool', actions: ['slot'], data: true },
  },
  for: {
    canvas: ['machine', 'func'],
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
    shape: { title: true, in: true, outs: true, rows: 'count', data: true, actions: ['row'] },
  },
  foreach: {
    canvas: ['machine', 'func'],
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
    shape: { title: true, in: true, outs: true, rows: 'count', data: true, actions: ['row'] },
  },
  inspect: {
    canvas: ['machine', 'func'],
    label: 'INSPECT',
    cls: 'mc-inspect',
    hint: 'pure data — no flow needed · ⇣ obj any value; one ⇡ per field of its declared type',
    ports: () => [],
    data: (n) => ({
      in: [{ id: '__obj__', type: n.objType || 'any', name: 'obj' }],
      out: (n.fields || []).map((f) => ({ id: f.id, type: f.typeId, name: f.name || 'field' })),
    }),
    shape: { title: true, rows: 'args', actions: ['arg'], data: true },
  },
  append: {
    canvas: ['machine', 'func'],
    label: 'APPEND',
    cls: 'mc-append',
    hint: 'pure data — ⇡ a copy of ⇣ arr with ⇣ val added at the end',
    ports: () => [],
    data: (n) => ({ in: [arrIn(n), valIn(n)], out: [arrOut(n)] }),
    shape: { title: true, rows: 'list', data: true, actions: ['row'] },
  },
  join: {
    canvas: ['machine', 'func'],
    label: 'JOIN',
    cls: 'mc-join',
    hint: 'pure data — ⇡ ⇣ a followed by ⇣ b, one array',
    ports: () => [],
    data: (n) => ({ in: [arrIn(n, '__a__', 'a'), arrIn(n, '__b__', 'b')], out: [arrOut(n)] }),
    shape: { title: true, rows: 'list', data: true, actions: ['row'] },
  },
  remove: {
    canvas: ['machine', 'func'],
    label: 'REMOVE',
    cls: 'mc-remove',
    hint: 'pure data — ⇡ ⇣ arr without any element equal to ⇣ val',
    ports: () => [],
    data: (n) => ({ in: [arrIn(n), valIn(n)], out: [arrOut(n)] }),
    shape: { title: true, rows: 'list', data: true, actions: ['row'] },
  },
  removeat: {
    canvas: ['machine', 'func'],
    label: 'REMOVE AT',
    cls: 'mc-removeat',
    hint: 'pure data — ⇡ ⇣ arr with the element at ⇣ at:int dropped',
    ports: () => [],
    data: (n) => ({
      in: [arrIn(n), { id: '__index__', type: 'int', name: 'at' }],
      out: [arrOut(n)],
    }),
    shape: { title: true, rows: 'list', data: true, actions: ['row'] },
  },
  sort: {
    canvas: ['machine', 'func'],
    label: 'SORT',
    cls: 'mc-sort',
    hint: 'pure data — ⇡ ⇣ arr ordered ascending — by ⇡ field of the item type, or by value itself',
    ports: () => [],
    data: (n) => ({ in: [arrIn(n)], out: [arrOut(n)] }),
    shape: { title: true, rows: 'list', data: true },
  },
  clone: {
    canvas: ['machine', 'func'],
    label: 'CLONE',
    cls: 'mc-clone',
    hint: 'pure data — ⇡ a deep copy of ⇣ val: mutations of the copy never touch the base value',
    ports: () => [],
    data: (n) => ({
      in: [{ id: '__val__', type: 'any', name: 'val' }],
      out: [{ id: '__val__', type: n.vType || '?', name: 'copy' }],
    }),
    shape: { title: true, rows: 'list', data: true },
  },
  // ---- math ops — one card shape for all five, on every canvas ----------------
  add: {
    canvas: ['flow', 'machine', 'func'],
    label: 'ADD',
    cls: 'mc-math',
    hint: 'chain passes through · ⇡ result = ⇣ a + ⇣ b — operands only take int or float · an unwired ⇣ falls back to the custom value typed on the card',
    ports: flowIO(),
    data: mathData,
    shape: { title: true, in: true, outs: true, rows: 'math', data: true },
  },
  sub: {
    canvas: ['flow', 'machine', 'func'],
    label: 'SUBTRACT',
    cls: 'mc-math',
    hint: 'chain passes through · ⇡ result = ⇣ a − ⇣ b — operands only take int or float · an unwired ⇣ falls back to the custom value typed on the card',
    ports: flowIO(),
    data: mathData,
    shape: { title: true, in: true, outs: true, rows: 'math', data: true },
  },
  mul: {
    canvas: ['flow', 'machine', 'func'],
    label: 'MULTIPLY',
    cls: 'mc-math',
    hint: 'chain passes through · ⇡ result = ⇣ a × ⇣ b — operands only take int or float · an unwired ⇣ falls back to the custom value typed on the card',
    ports: flowIO(),
    data: mathData,
    shape: { title: true, in: true, outs: true, rows: 'math', data: true },
  },
  div: {
    canvas: ['flow', 'machine', 'func'],
    label: 'DIVIDE',
    cls: 'mc-math',
    hint: 'chain passes through · ⇡ result = ⇣ a ÷ ⇣ b — int ÷ int is integer division, a float operand makes it decimal · operands only take int or float',
    ports: flowIO(),
    data: mathData,
    shape: { title: true, in: true, outs: true, rows: 'math', data: true },
  },
  mod: {
    canvas: ['flow', 'machine', 'func'],
    label: 'MOD',
    cls: 'mc-math',
    hint: 'chain passes through · ⇡ result = remainder of ⇣ a ÷ ⇣ b — operands only take int or float · an unwired ⇣ falls back to the custom value typed on the card',
    ports: flowIO(),
    data: mathData,
    shape: { title: true, in: true, outs: true, rows: 'math', data: true },
  },
  action: {
    canvas: ['machine', 'func'],
    label: 'ACTION',
    cls: 'mc-action',
    hint: 'chain waits here — click to fire',
    ports: flowIO(),
    shape: { title: true, in: true, outs: true, rows: 'status' },
  },
  syscall: {
    canvas: ['machine', 'func'],
    label: 'SYS CALL',
    cls: 'mc-syscall',
    hint: 'calls its system fn as the chain passes · ⏳ can block — stays opened until clicked to return',
    ports: flowIO(),
    shape: { title: true, in: true, outs: true, rows: 'calls', actions: ['call'] },
  },
  text: {
    canvas: ['flow', 'machine', 'func'],
    label: 'TEXT',
    cls: 'mc-text',
    hint: 'annotation + group frame — drop other parts inside it and they move with the frame · drag its corner grip to size it over everything it labels',
    ports: () => [],
    shape: { title: true, in: true, outs: true, rows: 'text', grip: 'size' },
  },
  todo: {
    canvas: ['flow', 'machine', 'func'],
    label: 'TODO',
    cls: 'mc-todo',
    hint: 'checklist — add task lines and tick them off; a silent note that never joins the chain sim',
    ports: () => [],
    shape: { title: true, in: true, outs: true, rows: 'tasks', actions: ['task'] },
  },
  exit: {
    canvas: ['machine'],
    label: 'EXIT',
    cls: 'mc-exit',
    hint: 'the machine ends here — named exits become output ports on the MACHINE node in the parent graph · its typed variables publish ⇡ values out of the machine',
    ports: () => [{ id: 'in', dir: 'in', label: 'exit' }],
    // a variable's ⇣ is fed by a producer inside the machine; the value then
    // leaves through the matching ⇡ port on the MACHINE node above
    data: (n) => ({
      in: [...(n.vars || [])].map((v) => ({ id: v.id, type: v.type || 'int', name: v.name || 'var' })),
      out: [],
    }),
    shape: { title: true, in: true, rows: 'door', actions: ['variable'], data: true },
  },
  exitinst: {
    canvas: ['machine'],
    label: 'EXIT REF',
    cls: 'mc-exit',
    hint: 'exits through an existing EXIT for the same reason — pick the target door, wire its ⇣ variables here; the target’s name, ports and vars stay in sync',
    ports: () => [{ id: 'in', dir: 'in', label: 'exit' }],
    // ⇣ inputs mirror the target EXIT's variables live — no vars of its own
    data: (n, _funcs, graph) => ({ in: exitInstVars(graph, n), out: [] }),
    shape: { title: true, in: true, rows: 'exitref', data: true },
  },
}
function flowIO() {
  return () => [
    { id: 'in', dir: 'in', label: '' },
    { id: 'out', dir: 'out', label: '' },
  ]
}

export const kindsFor = (canvas) =>
  Object.keys(KINDS).filter((k) => KINDS[k].canvas.includes(canvas))

// A func canvas offers everything a machine canvas does — minus the doors.
// ENTER and EXIT are born with every func graph, so the palette must never
// offer a second pair.
export const funcKinds = kindsFor('func')

// ---- text-frame grouping ---------------------------------------------------------
// A TEXT node is a group frame: parts dropped so their anchor lands inside it are
// adopted (n.parent = frame id), and dragging the frame carries its children — and
// their children — along. Adoption is sticky: a part keeps its current frame as
// long as it stays inside it, so overlapping frames never steal members.
export function textFrame(n) {
  return { x: n.x, y: n.y, w: n.w || 216, h: n.h || 88 }
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
// ENTER/EXIT doors and VAR parts expose their typed values.
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

export function dataPorts(node, assets, funcs = [], graph = null) {
  const meta = KINDS[node.kind] || {}
  const d = meta.data ? meta.data(node, funcs, graph) : { in: [], out: [] }
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
export function dataPortType(graph, assets, nodeId, portId, dir, funcs = []) {
  const node = (graph.nodes || []).find((n) => n.id === nodeId)
  if (!node) return null
  const set = dataPorts(node, assets, funcs, graph)[dir]
  const p = set.find((x) => x.id === portId)
  return p ? (p.type || '').trim().toLowerCase() : null
}

// Keep math parts in step with their operands: after any wire lands or
// leaves, re-derive each ⇡ result type — float when either side (wired
// value or custom value typed on the card) is float, int otherwise.
export function syncMath(g, assets, funcs = []) {
  const rType = (n) => {
    for (const [port, custom] of [['__a__', n.aVal], ['__b__', n.bVal]]) {
      const w = (g.links || []).find((l) => l.kind === 'data' && l.to === n.id && l.toPort === port)
      if (w) {
        if (dataPortType(g, assets, w.from, w.fromPort, 'out', funcs) === 'float') return 'float'
      } else {
        const c = Number(custom)
        if (String(custom ?? '').trim() !== '' && Number.isFinite(c) && !Number.isInteger(c)) return 'float'
      }
    }
    return 'int'
  }
  return { ...g, nodes: (g.nodes || []).map((n) => (MATH[n.kind] ? { ...n, rType: rType(n) } : n)) }
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
  if (kind === 'func') n.func = null
  if (kind === 'foreach') n.itemType = '?'
  if (['append', 'join', 'remove', 'removeat', 'sort'].includes(kind)) n.itemType = null // learns from the first array wired in
  if (kind === 'sort') n.field = ''
  if (kind === 'clone') n.vType = ''
  if (MATH[kind]) {
    n.aVal = ''
    n.bVal = ''
    n.rType = 'int' // learns 'float' while any operand side is a float
  }
  if (BOOL[kind]) n.slots = 2 // + ⇣ at the card foot grows more bool inputs
  if (kind === 'inspect') n.objType = 'any'
  if (kind === 'syscall') n.calls = [{ asset: null, fn: null }]
  if (kind === 'syscall') n.out = {}
  if (kind === 'todo') n.todos = [{ id: uid('td'), text: '', done: false }]
  if (kind === 'enter') n.vars = [{ id: uid('ev'), name: '', type: 'int', value: '' }]
  if (kind === 'enter') n.assets = []
  // an EXIT's variables are its ⇡ outputs — it starts with none, so the card
  // only shows the + variable button until you decide what this door announces
  if (kind === 'exit') n.vars = []
  // an EXIT REF routes to a real EXIT by id — its ⇣ ports mirror the target
  if (kind === 'exitinst') n.exitRef = null
  if (kind === 'getledger' || kind === 'setledger') {
    n.lRef = null
    n.lName = ''
    n.lType = ''
    n.lVarId = null
  }
  return n
}

export function newGraph(mode, name) {
  return { id: uid('g'), mode, name: name || (mode === 'flow' ? 'Main Loop' : mode === 'func' ? 'function' : 'machine'), entry: null, nodes: [], links: [] }
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
    funcs: [],
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
export function pruneLinks(graph, assets, nodeId, funcs = []) {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return graph
  const meta = kindMeta(node)
  const flowIds = new Set(meta.ports ? meta.ports(node).map((p) => p.id) : [])
  // chained parts (STEP, EVENT…) take flow in through an implicit 'in' port
  // that ports() never declares — incoming flow links ride it
  if (!meta.dataOnly && (meta.shape?.in === true || (meta.ports ? meta.ports(node) : []).some((p) => p.dir === 'in')))
    flowIds.add('in')
  const dp = dataPorts(node, assets, funcs, graph)
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

// EXIT REFs mirror their target's ports live — when a real EXIT changes, prune
// every ref that points at it so stale ⇣ wires don't linger.
export function pruneExitInstLinks(graph, assets, exitId, funcs = []) {
  let g = graph
  for (const n of g.nodes || []) if (n.kind === 'exitinst' && n.exitRef === exitId) g = pruneLinks(g, assets, n.id, funcs)
  return g
}

// Prune every EXIT REF — safe after deletes/renames that may orphan targets.
export function pruneAllExitInstLinks(graph, assets, funcs = []) {
  let g = graph
  for (const n of g.nodes || []) if (n.kind === 'exitinst') g = pruneLinks(g, assets, n.id, funcs)
  return g
}

// ---- doc-wide walks -------------------------------------------------------------
export function walkGraphs(graph, fn, path = []) {
  fn(graph, path)
  for (const n of graph.nodes) if (n.graph) walkGraphs(n.graph, fn, [...path, n])
}

// ---- canvas navigation ------------------------------------------------------
// The breadcrumb is a chain of node ids from design down. Machine/graph nodes
// carry their sub-graph on themselves; a FUNC node hops to the definition it
// picks on the doc — the body lives once there, so walking into any call site
// of the same function shows (and edits) the very same graph.
export function resolveGraph(doc, path) {
  let g = doc.design
  for (const id of path) {
    const n = (g.nodes || []).find((x) => x.id === id)
    if (n?.kind === 'func') {
      const f = (doc.funcs || []).find((x) => x.id === n.func)
      if (!f) return g
      g = f.graph
      continue
    }
    if (!n?.graph) return g
    g = n.graph
  }
  return g
}

// Same chain, writing back. A func hop splices `next` into the function's
// entry on doc.funcs instead of a node's .graph — which is what makes "edit
// one call site edits them all" true.
export function replaceGraph(doc, path, next) {
  if (!path.length) return { ...doc, design: next }
  const root = { ...doc.design }
  const funcs = (doc.funcs || []).map((f) => ({ ...f }))
  let g = root
  for (let i = 0; i < path.length; i++) {
    const n = g.nodes.find((x) => x.id === path[i])
    if (!n) break
    if (n.kind === 'func') {
      const fi = funcs.findIndex((f) => f.id === n.func)
      if (fi < 0) break
      const f = { ...funcs[fi] }
      funcs[fi] = f
      if (i === path.length - 1) f.graph = next
      else {
        f.graph = { ...f.graph }
        g = f.graph
      }
      continue
    }
    const nn = { ...n }
    g.nodes = g.nodes.map((x) => (x.id === path[i] ? nn : x))
    if (i === path.length - 1) nn.graph = next
    else {
      nn.graph = { ...n.graph }
      g = nn.graph
    }
  }
  return { ...doc, design: root, funcs }
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
  // ENTER and EXIT variables ARE ports (inside the machine and on the parent
  // MACHINE node) — re-id and register both key forms so data wires follow
  ;(nn.vars || []).forEach((v) => {
    const old = v.id
    v.id = uid(nn.kind === 'exit' ? 'xv' : 'ev')
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
    // and its ⇡ data ports ARE the nested EXIT variables
    const oldVars = (nn.graph.nodes || [])
      .filter((x) => x.kind === 'enter' || x.kind === 'exit')
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
  // frame itself was not part of the clipboard map.get misses and it clears.
  // EXIT REFs keep their target when the target exit was copied alongside.
  graph.nodes.forEach((n) => {
    if (n.parent) n.parent = map.get(n.parent)
    if (n.exitRef) n.exitRef = map.get(n.exitRef) || n.exitRef
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

// Real EXIT names must be unique within a graph (instances pick by name).
export function exitNameTaken(graph, name, excludeId) {
  const key = String(name || '').trim().toLowerCase()
  if (!key) return false
  return (graph.nodes || []).some(
    (n) => n.kind === 'exit' && n.id !== excludeId && String(n.name || '').trim().toLowerCase() === key,
  )
}

function dedupeExitNames(g) {
  const seen = new Set()
  for (const n of g.nodes || []) {
    if (n.kind !== 'exit') continue
    let name = String(n.name || '').trim()
    if (!name) continue
    let key = name.toLowerCase()
    if (seen.has(key)) {
      let i = 2
      while (seen.has((name + ' ' + i).toLowerCase())) i++
      name = name + ' ' + i
      key = name.toLowerCase()
      n.name = name
    }
    seen.add(key)
  }
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
  // shift by WHOLE GRID steps — a part parked on a snap point must stay there
  // after the repair, or every snapped graph loads with the grid skewed under it
  const sx = dx < 0 ? Math.ceil(-dx / GRID) * GRID : 0
  const sy = dy < 0 ? Math.ceil(-dy / GRID) * GRID : 0
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
  d.funcs = d.funcs || []
  const repair = (g) => {
    dedupeIds(g) // heal any doc corrupted by the old paste bug
    dedupeExitNames(g) // real EXIT names must be unique (instances pick by name)
    intoView(g) // pull edge-parked parts back inside the reachable canvas
  }
  walkGraphs(d.design, repair)
  // defined functions own their own body graphs — heal those too
  for (const f of d.funcs) {
    f.id = f.id || uid('fn')
    f.name = f.name || ''
    f.note = f.note || ''
    f.graph = f.graph || newGraph('func', f.name)
    f.graph.mode = 'func'
    repair(f.graph)
    // ENTER and EXIT are permanent parts of every function body — a loaded
    // doc that lost one gets it born back at its usual spot
    if (!f.graph.nodes.some((n) => n.kind === 'enter')) {
      const en = newNode('enter', 100, 200)
      f.graph.nodes.push(en)
      f.graph.entry = en.id
    }
    if (!f.graph.nodes.some((n) => n.kind === 'exit')) f.graph.nodes.push(newNode('exit', 620, 200))
    if (f.graph.entry && !f.graph.nodes.some((n) => n.id === f.graph.entry)) {
      const en = f.graph.nodes.find((n) => n.kind === 'enter')
      if (en) f.graph.entry = en.id
    }
    if (!f.graph.entry) {
      const en = f.graph.nodes.find((n) => n.kind === 'enter')
      if (en) f.graph.entry = en.id
    }
    walkGraphs(f.graph, repair)
  }
  return d
}
