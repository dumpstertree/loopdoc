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
export const BASIC_TYPES = ['int', 'float', 'string', 'bool']

export function newType(name = '') {
  return { id: uid('ty'), name, fields: [{ id: uid('f'), name: '', typeId: 'int' }] }
}

// every pickable type name, base first then arrays
export function typeNames(types) {
  const seen = []
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

// rename a type everywhere it is referenced (fn vars, foreach item types)
export function renameTypeInDoc(doc, oldName, newName) {
  const d = JSON.parse(JSON.stringify(doc))
  const fix = (t) => (t === oldName ? newName : t === oldName + '[]' ? newName + '[]' : t)
  for (const a of d.assets || [])
    for (const f of a.api || [])
      for (const key of ['inputs', 'outputs'])
        for (const v of f[key] || []) v.type = fix(v.type)
  const walk = (g) => {
    for (const n of g.nodes) {
      if (n.kind === 'foreach') n.itemType = fix(n.itemType || '')
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
  return { id: uid('asset'), kind, name, note: '', api: kind === 'system' ? [] : undefined }
}

// Resolve an asset's chosen API function: { asset, fn } or null.
export function resolveCall(call, assets) {
  if (!call || !call.asset || !call.fn) return null
  const a = (assets || []).find((x) => x.id === call.asset)
  const fn = a && (a.api || []).find((f) => f.id === call.fn)
  return a && fn ? { asset: a, fn } : null
}

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
    label: 'VAR',
    cls: 'nd-var',
    hint: 'assign a value to a named variable',
    ports: () => [{ id: 'out', dir: 'out', label: 'out' }],
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
    hint: 'nested machine — chains run its economy · its EXIT parts become named output ports here',
    ports: (n) => {
      const xs = ((n.graph || {}).nodes || []).filter((x) => x.kind === 'exit')
      return xs.length
        ? xs.map((x) => ({ id: x.id, dir: 'out', label: x.name || 'exit' }))
        : [{ id: 'out', dir: 'out', label: 'out' }]
    },
  },
  // ---- machine nodes ----------------------------------------------------------
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
  if (kind === 'var') n.variable = { name: '', value: '' }
  if (kind === 'graph') n.graph = newGraph('flow', n.name || 'sub graph')
  if (kind === 'machine') n.graph = newGraph('machine', n.name || 'machine')
  if (kind === 'pool') n.init = 10
  if (kind === 'drain') n.drain = 1
  if (kind === 'source' || kind === 'drain') n.auto = true
  if (kind === 'delay') n.delay = 3
  if (kind === 'queue') n.rate = 1
  if (kind === 'register') n.countTo = 2
  if (kind === 'foreach') n.itemType = '?'
  if (kind === 'inspect') n.objType = 'any'
  if (kind === 'syscall') n.calls = [{ asset: null, fn: null }]
  if (kind === 'syscall') n.out = {}
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
  if (nn.gen) nn.gen = { ...nn.gen, id: uid('asset') }
  if (nn.graph) {
    // MACHINE node: its parent-side ports ARE the nested exit nodes, so
    // links wired to those ports (fromPort = exit node id) must follow the
    // exit re-id — register `oldNode:oldExit → newExit` after reidding
    const oldExits = (nn.graph.nodes || []).filter((x) => x.kind === 'exit').map((x) => x.id)
    reidGraph(nn.graph, map)
    for (const old of oldExits) {
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

export function parseDoc(text) {
  const d = JSON.parse(text)
  if (!d || d.app !== 'loopdoc-composer' || !d.design) throw new Error('not a loopdoc composer file')
  d.notes = { business: '', mood: '', ...(d.notes || {}) }
  d.assets = d.assets || []
  d.types = d.types || []
  walkGraphs(d.design, dedupeIds) // heal any doc corrupted by the old paste bug
  return d
}
