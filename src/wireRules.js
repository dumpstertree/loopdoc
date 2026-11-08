// Wire rules — the single source of truth for what the wiring grammar allows.
// The chain engine (engine.js), both canvases' drop checks and drag-time
// port highlighting, and the DRC all consult these, so a rule can never be
// enforced in one place and forgotten in another.
import { kindMeta, dataPortType, uid, MATH, BOOL } from './model.js'

// Entry parts are EXPLICIT: ENTER is the machine's door — always a start,
// impossible to suppress. Nothing else enters a chain by being unconnected
// any more.
export function isEntryPart(n) {
  return n.kind === 'enter'
}

// may a flow wire land on this node at all? two declarations say yes: the
// shape's implicit flow-in slot (`in: true` — the pass-through convention on
// the canvases) or an explicit ⇣ flow port in ports() (SET GLOBAL/SET LEDGER
// wear the pair). A part flagged dataOnly (VAR, GET GLOBAL, GET LEDGER) lives
// outside the chain entirely — nothing flows into or out of it.
export function takesFlow(n) {
  const m = kindMeta(n)
  if (m.dataOnly) return false
  if (m.shape?.in === true) return true
  return (m.ports ? m.ports(n) : []).some((p) => p.dir === 'in')
}

// may data port A feed data port B? returns { ok } or { ok: false, why }
export function dataCanConnect(g, assets, from, fromPort, to, toPort, funcs = []) {
  if (to === from) return { ok: false, why: '⚠ a part cannot feed itself' }
  const ta = dataPortType(g, assets, from, fromPort, 'out', funcs)
  const tb = dataPortType(g, assets, to, toPort, 'in', funcs)
  if (!ta || !tb) return { ok: false, why: '⚠ that data port no longer exists' }
  const tn = g.nodes.find((x) => x.id === to)
  if (tn?.kind === 'ifb' && (toPort === '__a__' || toPort === '__b__')) {
    // if-operands: int or bool only, and both sides of one if compare like with like
    if (ta !== 'int' && ta !== 'bool')
      return { ok: false, why: `⚠ if-compares take int or bool — not ${ta}` }
    const otherPort = toPort === '__a__' ? '__b__' : '__a__'
    const other = (g.links || []).find((l) => l.kind === 'data' && l.to === to && l.toPort === otherPort)
    const ot = other && dataPortType(g, assets, other.from, other.fromPort, 'out', funcs)
    if (ot && ot !== ta)
      return { ok: false, why: `⚠ if-compares both sides alike — ⇣ ${otherPort} is already ${ot}` }
    return { ok: true }
  }
  // math-operands: int or float only — their ⇣ ports wear the type 'num'
  if (tb === 'num')
    return ta === 'int' || ta === 'float'
      ? { ok: true }
      : { ok: false, why: `⚠ math parts take int or float — not ${ta}` }
  if (!(ta === tb || tb === 'any' || (tb === 'array' && ta.includes('[]'))))
    return { ok: false, why: `⚠ type mismatch — ⇡ ${ta} cannot feed ⇣ ${tb}` }
  return { ok: true }
}

// every ⇣ port key (from the canvas's measured port map) that would accept
// the wire currently being dragged — so compatible ports glow before release
export function compatTargets(g, assets, drag, portKeys, funcs = []) {
  const out = []
  if (!drag || (drag.kind !== 'flow' && drag.kind !== 'data')) return out
  const ta = drag.kind === 'data' ? dataPortType(g, assets, drag.from, drag.port, 'out', funcs) : null
  for (const key of portKeys) {
    const [nid, pid, dir] = key.split(':')
    if (dir !== 'in' || nid === drag.from) continue
    const tn = g.nodes.find((x) => x.id === nid)
    if (!tn) continue
    if (drag.kind === 'flow') {
      if (pid === 'in' && takesFlow(tn)) out.push(key)
    } else if (ta && dataCanConnect(g, assets, drag.from, drag.port, nid, pid, funcs).ok) out.push(key)
  }
  return out
}

// Ctrl+drag branch-off — a new wire that shares an existing wire's run from
// the source port up to anchor `idx`, then breaks away to a new target. The
// canvases own the gesture and the drop point; this owns the grammar and the
// shared stem, so a branch can never dodge a rule a dragged wire obeys.
export function branchLink(g, assets, src, idx, to, toPort, funcs = []) {
  const tn = (g.nodes || []).find((x) => x.id === to)
  if (!tn) return { ok: false, why: '⚠ drop the branch on a part' }
  if (to === src.from) return { ok: false, why: '⚠ a part cannot feed itself' }
  const stem = (src.anchors || []).slice(0, idx + 1).map((a) => ({ x: a.x, y: a.y }))
  if (src.kind === 'data') {
    if (to === src.to && toPort === src.toPort) return { ok: false, why: '⚠ that wire already runs there' }
    const chk = dataCanConnect(g, assets, src.from, src.fromPort, to, toPort, funcs)
    if (!chk.ok) return chk
    return { ok: true, link: { id: uid('lk'), kind: 'data', from: src.from, fromPort: src.fromPort, to, toPort, anchors: stem } }
  }
  if (!takesFlow(tn)) return { ok: false, why: `⚠ ${kindMeta(tn).label || tn.kind} is pure data — no flow wires into or out of it` }
  if ((g.links || []).some((l) => l.kind !== 'data' && l.from === src.from && l.fromPort === src.fromPort && l.to === to))
    return { ok: false, why: '⚠ those ports are already wired' }
  return {
    ok: true,
    link: { id: uid('lk'), kind: 'flow', from: src.from, fromPort: src.fromPort, to, toPort: 'in', anchors: stem },
  }
}

// ---------------------------------------------------------------------------
// Value-wire ordering — "has the producer run?" — the one thing the grammar
// above cannot say: a wired value only EXISTS at the moment the part
// publishing it fired. Pull a ⇡ from a part that may run after (or beside)
// its reader and the read is a race. So every data wire carries an ordering
// requirement, resolved against the graph's flow:
//   · computed parts (math/bool folds, INSPECT, CLONE, array tools) publish
//     on demand — engine.js recomputes them at read time, so their ⇡ is
//     exactly as guaranteed as the wires feeding their own ⇣: the demand
//     chain is followed back through them
//   · made values (VAR, GET GLOBAL/GET LEDGER) and ENTER door variables exist
//     from the start of a run — order-free
//   · everything else (EVENT/SYS CALL, IF verdict, loop item/index, nested
//     MACHINE and FUNC results…) fires when a chain arrives: its ⇡ is
//     guaranteed when the reader runs only if it DOMINATES the reader — every
//     flow path from any entry (ENTER doors / the ▶ start) passes through it
//     first
// A wire whose demand chain misses that guarantee is a race: both canvases
// draw it red and the DRC reports the very same verdict. Pure static pass —
// one call per graph, tiny graphs, no canvas in sight.
const VALUE_FREE = new Set(['enter', 'var', 'getg', 'getledger'])
const VALUE_DEMAND = new Set([...Object.keys(MATH), ...Object.keys(BOOL), 'inspect', 'clone', 'append', 'join', 'remove', 'removeat', 'sort'])

export function valueWireRisks(g) {
  const nodes = g.nodes || []
  const links = g.links || []
  const byId = Object.fromEntries(nodes.map((x) => [x.id, x]))
  const flows = links.filter((x) => x.kind !== 'data')
  const data = links.filter((x) => x.kind === 'data')

  // entries: ENTER doors (machine/func canvas) or the ▶ start of a flow graph
  const rootSet = new Set(nodes.filter((x) => isEntryPart(x) || x.id === g.entry).map((x) => x.id))

  // reachable set over the flow edges
  const reach = new Set()
  for (const q = [...rootSet]; q.length; ) {
    const id = q.shift()
    if (reach.has(id) || !byId[id]) continue
    reach.add(id)
    for (const e of flows) if (e.from === id) q.push(e.to)
  }

  // must-already-have-run sets: the classic iterative dominator dataflow
  const all = [...reach]
  const dom = {}
  for (const id of all) dom[id] = rootSet.has(id) ? new Set([id]) : new Set(all)
  for (;;) {
    let changed = false
    for (const id of all) {
      if (rootSet.has(id)) continue
      let inter = null
      for (const e of flows) {
        if (e.to !== id || !reach.has(e.from)) continue
        const dp = dom[e.from]
        if (inter === null) inter = new Set(dp)
        else for (const d of [...inter]) if (!dp.has(d)) inter.delete(d)
      }
      if (!inter) continue
      inter.add(id)
      if (inter.size < dom[id].size) {
        dom[id] = inter
        changed = true
      }
    }
    if (!changed) break
  }
  // an unreachable reader never runs — nothing can race at it
  const firedBefore = (a, b) => reach.has(a) && a !== b && dom[b]?.has(a)

  // the stateful parts behind a part's ⇡: follow the demand chain back
  const memo = {}
  const left = { steps: 6000 }
  const origins = (id, path) => {
    if (!byId[id] || left.steps-- <= 0) return new Set()
    if (path.has(id)) return 'cycle'
    if (memo[id]) return memo[id]
    const kind = byId[id].kind
    if (!VALUE_FREE.has(kind) && !VALUE_DEMAND.has(kind)) {
      const own = new Set([id]) // fires when a chain arrives — that IS the demand
      memo[id] = own
      return own
    }
    const set = new Set()
    const deeper = new Set(path).add(id)
    for (const l of data)
      if (l.to === id) {
        const back = origins(l.from, deeper)
        if (back === 'cycle') return 'cycle'
        for (const o of back) set.add(o)
      }
    memo[id] = set
    return set
  }

  // per-wire verdict
  const risks = []
  for (const l of data) {
    if (!byId[l.from] || !byId[l.to] || !reach.has(l.to)) continue
    const back = origins(l.from, new Set([l.to]))
    if (back === 'cycle') {
      risks.push({ link: l.id, origin: l.from, kind: 'cycle', why: 'the value chains back to itself — it can never be built' })
      continue
    }
    const missed = [...back].filter((o) => !firedBefore(o, l.to))
    if (missed.length)
      risks.push({ link: l.id, origin: missed.sort()[0], kind: 'order', why: 'its producer is not guaranteed to run first — every chain path from an entry to the reader must pass through it' })
  }
  return risks
}
