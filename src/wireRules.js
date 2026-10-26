// Wire rules — the single source of truth for what the wiring grammar allows.
// The chain engine (engine.js), both canvases' drop checks and drag-time
// port highlighting, and the DRC all consult these, so a rule can never be
// enforced in one place and forgotten in another.
import { kindMeta, dataPortType } from './model.js'

// silent parts — they act on a passing chain (drain/add), write globals on
// command (setg), or end one (exit); none of them may START a chain
const SILENT = new Set(['drain', 'add', 'setg', 'exit'])

// a part is an entry when it has ports but nothing feeds it flow-wise
export function isEntryPart(n, links) {
  if (SILENT.has(n.kind)) return false
  const ports = (kindMeta(n).ports || (() => []))(n) || []
  if (!ports.length) return false
  return !(links || []).some((l) => l.kind !== 'data' && l.to === n.id)
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
      if (pid === 'in' && ((kindMeta(tn).ports || (() => []))(tn) || []).some((p) => p.dir === 'in'))
        out.push(key)
    } else if (ta && dataCanConnect(g, assets, drag.from, drag.port, nid, pid).ok) out.push(key)
  }
  return out
}
