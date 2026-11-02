// Wire rules — the single source of truth for what the wiring grammar allows.
// The chain engine (engine.js), both canvases' drop checks and drag-time
// port highlighting, and the DRC all consult these, so a rule can never be
// enforced in one place and forgotten in another.
import { kindMeta, dataPortType, uid } from './model.js'

// Entry parts are EXPLICIT: ENTER is the machine's door — always a start,
// impossible to suppress — and SOURCE keeps its legacy self-firing. Nothing
// else enters a chain by being unconnected any more.
export function isEntryPart(n) {
  return n.kind === 'enter' || n.kind === 'source'
}

// may a flow wire touch this node at all? Pure-data parts (VAR) say no —
// flow-mode parts otherwise take flow at their implicit in port, and
// machine parts at their declared one.
export function takesFlow(n) {
  if (kindMeta(n).dataOnly) return false
  const ports = (kindMeta(n).ports || (() => []))(n) || []
  return ports.some((p) => p.dir === 'in') || kindMeta(n).mode === 'flow'
}

// may data port A feed data port B? returns { ok } or { ok: false, why }
export function dataCanConnect(g, assets, from, fromPort, to, toPort) {
  if (to === from) return { ok: false, why: '⚠ a part cannot feed itself' }
  const ta = dataPortType(g, assets, from, fromPort, 'out')
  const tb = dataPortType(g, assets, to, toPort, 'in')
  if (!ta || !tb) return { ok: false, why: '⚠ that data port no longer exists' }
  const tn = g.nodes.find((x) => x.id === to)
  if (tn?.kind === 'ifb' && (toPort === '__a__' || toPort === '__b__')) {
    // if-operands: int or bool only, and both sides of one if compare like with like
    if (ta !== 'int' && ta !== 'bool')
      return { ok: false, why: `⚠ if-compares take int or bool — not ${ta}` }
    const otherPort = toPort === '__a__' ? '__b__' : '__a__'
    const other = (g.links || []).find((l) => l.kind === 'data' && l.to === to && l.toPort === otherPort)
    const ot = other && dataPortType(g, assets, other.from, other.fromPort, 'out')
    if (ot && ot !== ta)
      return { ok: false, why: `⚠ if-compares both sides alike — ⇣ ${otherPort} is already ${ot}` }
    return { ok: true }
  }
  if (!(ta === tb || tb === 'any' || (tb === 'array' && ta.includes('[]'))))
    return { ok: false, why: `⚠ type mismatch — ⇡ ${ta} cannot feed ⇣ ${tb}` }
  return { ok: true }
}

// every ⇣ port key (from the canvas's measured port map) that would accept
// the wire currently being dragged — so compatible ports glow before release
export function compatTargets(g, assets, drag, portKeys) {
  const out = []
  if (!drag || (drag.kind !== 'flow' && drag.kind !== 'data')) return out
  const ta = drag.kind === 'data' ? dataPortType(g, assets, drag.from, drag.port, 'out') : null
  for (const key of portKeys) {
    const [nid, pid, dir] = key.split(':')
    if (dir !== 'in' || nid === drag.from) continue
    const tn = g.nodes.find((x) => x.id === nid)
    if (!tn) continue
    if (drag.kind === 'flow') {
      if (pid === 'in' && takesFlow(tn)) out.push(key)
    } else if (ta && dataCanConnect(g, assets, drag.from, drag.port, nid, pid).ok) out.push(key)
  }
  return out
}

// Ctrl+drag branch-off — a new wire that shares an existing wire's run from
// the source port up to anchor `idx`, then breaks away to a new target. The
// canvases own the gesture and the drop point; this owns the grammar and the
// shared stem, so a branch can never dodge a rule a dragged wire obeys.
export function branchLink(g, assets, src, idx, to, toPort) {
  const tn = (g.nodes || []).find((x) => x.id === to)
  if (!tn) return { ok: false, why: '⚠ drop the branch on a part' }
  if (to === src.from) return { ok: false, why: '⚠ a part cannot feed itself' }
  const stem = (src.anchors || []).slice(0, idx + 1).map((a) => ({ x: a.x, y: a.y }))
  if (src.kind === 'data') {
    if (to === src.to && toPort === src.toPort) return { ok: false, why: '⚠ that wire already runs there' }
    const chk = dataCanConnect(g, assets, src.from, src.fromPort, to, toPort)
    if (!chk.ok) return chk
    return { ok: true, link: { id: uid('lk'), kind: 'data', from: src.from, fromPort: src.fromPort, to, toPort, anchors: stem } }
  }
  if (!takesFlow(tn)) return { ok: false, why: `⚠ ${kindMeta(tn).label || tn.kind} is pure data — no flow wires into or out of it` }
  if ((g.links || []).some((l) => l.kind !== 'data' && l.from === src.from && l.fromPort === src.fromPort && l.to === to))
    return { ok: false, why: '⚠ those ports are already wired' }
  return {
    ok: true,
    link: { id: uid('lk'), kind: 'flow', from: src.from, fromPort: src.fromPort, to, toPort: 'in', amount: src.amount ?? 1, anchors: stem },
  }
}
