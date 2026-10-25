// ---------------------------------------------------------------------------
// Design Rule Check — a PCB-style DRC for loopdocs.
//
// Pure static analysis over one graph or the whole doc, running the same
// reviews a human would: dropped-chain wiring, empty loop bodies, item reads
// bound to the last iteration, drain/reader races, unreachable exits,
// dangling data wires and type drift. Every finding carries a severity:
//   error — a chain drops / nothing runs / a port is gone
//   warn  — almost certainly not what you meant
//   info  — works, but is a decision worth making on purpose
// Finding: { sev, path, graph, node, text } — path = breadcrumb node ids to
// the owning graph, so the panel can jump there.
// ---------------------------------------------------------------------------
import { kindMeta, resolveCall, dataPortType, BASIC_TYPES, walkGraphs } from './model.js'

const label = (n) =>
  n ? `${kindMeta(n).label || n.kind}${n.name ? ` "${n.name}"` : ''}` : '?'

const hasVal = (v) => v !== undefined && v !== null && String(v) !== ''

// one graph in isolation -------------------------------------------------------
function scanGraph(g, assets, types, add) {
  const nodes = g.nodes || []
  const flows = (g.links || []).filter((l) => l.kind !== 'data')
  const data = (g.links || []).filter((l) => l.kind === 'data')
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const portsOf = (n) => ((kindMeta(n).ports || (() => []))(n) || [])
  const anyOut = (id) => flows.some((l) => l.from === id)
  const outFrom = (id, port) => flows.filter((l) => l.from === id && l.fromPort === port)
  const hasIn = (id) => flows.some((l) => l.to === id)
  const dataTo = (id, port) => data.some((l) => l.to === id && (port === undefined || l.toPort === port))
  const linked = (id) =>
    flows.some((l) => l.to === id || l.from === id) || data.some((l) => l.to === id || l.from === id)
  const reach = (starts) => {
    const seen = new Set()
    const q = [...starts]
    while (q.length) {
      const id = q.shift()
      if (seen.has(id) || !byId[id]) continue
      seen.add(id)
      for (const e of flows) if (e.from === id) q.push(e.to)
    }
    return seen
  }
  const declared = new Set((types || []).map((t) => (t.name || '').toLowerCase()).filter(Boolean))
  const isDeclared = (t) => declared.has(String(t || '').toLowerCase())

  // ---- both modes: dangling data wires & orphan type references -------------
  for (const l of data) {
    if (byId[l.from] && !dataPortType(g, assets, l.from, l.fromPort, 'out'))
      add('error', label(byId[l.to]), `data wire ⇣ ${l.toPort} is dangling — ${label(byId[l.from])} no longer outputs that port`)
    if (byId[l.to] && !dataPortType(g, assets, l.to, l.toPort, 'in'))
      add('error', label(byId[l.from]), `data wire from ⇡ ${l.fromPort} is dangling — ${label(byId[l.to])} no longer has that input`)
  }
  for (const n of nodes) {
    if (n.kind === 'inspect' && n.objType && n.objType !== 'any' && !isDeclared(n.objType))
      add('warn', label(n), `reads ${n.objType} — no longer a declared type`)
    if (n.kind === 'foreach' && n.itemType && !BASIC_TYPES.includes(n.itemType) && !isDeclared(n.itemType))
      add('warn', label(n), `item type ${n.itemType} is no longer declared`)
  }

  if (g.mode !== 'machine') {
    // ---- flow-graph rules ----------------------------------------------------
    for (const n of nodes) {
      const m = kindMeta(n)
      if (n.kind === 'condition') {
        if (!outFrom(n.id, 'true').length) add('warn', label(n), 'no TRUE exit wired')
        if (!outFrom(n.id, 'false').length) add('warn', label(n), 'no FALSE exit wired')
      }
      if (n.kind === 'choice')
        for (const e of n.exits || [])
          if (!outFrom(n.id, e.id).length) add('info', label(n), `option "${e.label || '?'}" leads nowhere`)
      if ((n.kind === 'graph' || n.kind === 'machine') && n.graph && !(n.graph.nodes || []).length)
        add('warn', label(n), `${m.label} opens an empty graph`)
      if (n.kind === 'machine' && n.graph && !(n.graph.nodes || []).some((x) => x.kind === 'exit'))
        add('info', label(n), 'machine has no EXIT — the parent can only see a generic out, not outcomes')
      if (n.kind === 'graph' && portsOf(n).some((p) => p.dir === 'out') && hasIn(n.id) && !anyOut(n.id))
        add('info', label(n), 'sub graph returns here and nothing continues — flow ends')
      if (m.mode === 'flow' && !['condition', 'choice', 'graph', 'machine', 'exit'].includes(n.kind) && portsOf(n).some((p) => p.dir === 'out') && hasIn(n.id) && !anyOut(n.id))
        add('info', label(n), 'flow dead-ends here')
      if (m.mode === 'flow' && !linked(n.id) && !['event', 'step'].includes(n.kind))
        add('info', label(n), 'orphan — no wires at all')
    }
    return
  }

  // ---- machine rules -----------------------------------------------------------
  const entryNodes = nodes.filter(
    (n) => n.kind !== 'drain' && n.kind !== 'exit' && portsOf(n).length > 0 && !hasIn(n.id),
  )
  if (nodes.length && !entryNodes.length && (g.links || []).length)
    add('error', '', 'nothing can run — every part has a flow input (closed cycle, no entry)')
  const allReach = reach(entryNodes.map((n) => n.id))

  for (const n of nodes) {
    if (n.kind === 'syscall') {
      const r = resolveCall((n.calls || [])[0], assets)
      if (!r) add('error', label(n), 'has no system fn selected')
      else
        for (const v of r.fn.inputs || []) {
          if (!v.name && !v.type) continue // blank API var, ignored everywhere
          if (!dataTo(n.id, v.id)) add('warn', label(n), `⇣ ${v.name || '?'}:${v.type || '?'} has no data wire — the call runs blind on it`)
        }
      if (n.block && !hasIn(n.id))
        add('warn', label(n), '⏳ blocking call with no flow input — every round freezes for a click before anything runs')
    }
    if (n.kind === 'ifb') {
      for (const [port, key, nm] of [['__a__', 'aVal', 'a'], ['__b__', 'bVal', 'b']])
        if (!dataTo(n.id, port) && !hasVal(n[key]))
          add('error', label(n), `⇣ ${nm} has no wire and no custom value — chains arriving here drop`)
      if (hasIn(n.id)) {
        if (!outFrom(n.id, 'true').length) add('info', label(n), 'true branch unwired — a true chain simply ends here')
        if (!outFrom(n.id, 'false').length) add('info', label(n), 'false branch unwired — a false chain simply ends here')
      }
    }
    if (n.kind === 'for' && !dataTo(n.id, '__to__')) add('error', label(n), 'counted loop has no ⇣ to:int — nothing to count to')
    if (n.kind === 'foreach' && !dataTo(n.id, '__arr__')) add('error', label(n), 'foreach has no ⇣ arr source — it can never iterate')

    if ((n.kind === 'for' || n.kind === 'foreach') && hasIn(n.id)) {
      const body = outFrom(n.id, 'out').length > 0
      const end = outFrom(n.id, 'end').length > 0
      if (!body && !end) add('error', label(n), 'loop is wired to nothing — chains arrive and nothing happens')
      else if (!body && end)
        add('warn', label(n), 'loop body is empty — end fires at once; per-item work belongs on iter, end is only the round summary')
      else if (body && end) {
        // taint: everything that reads the loop's ⇡ item/index — directly or
        // through data wires (item → inspect → pool → if …)
        const tainted = new Set()
        const q = data
          .filter((l) => l.from === n.id && (l.fromPort === '__item__' || l.fromPort === '__idx__'))
          .map((l) => l.to)
          .filter((id) => id !== n.id)
        while (q.length) {
          const id = q.shift()
          if (tainted.has(id) || !byId[id]) continue
          tainted.add(id)
          for (const l of data) if (l.from === id && !tainted.has(l.to)) q.push(l.to)
        }
        const bodyReach = reach(outFrom(n.id, 'out').map((e) => e.to))
        const endReach = reach(outFrom(n.id, 'end').map((e) => e.to))
        const offenders = [...tainted].filter((id) => endReach.has(id) && !bodyReach.has(id))
        if (offenders.length)
          add(
            'warn',
            label(n),
            `end chain reads the loop item through ${offenders.map((o) => label(byId[o])).join(', ')} — after the loop, item binds to the LAST iteration only`,
          )
      }
    }
  }

  // drain vs reader race: a pool forked into a drain AND another part at once
  for (const d of nodes.filter((x) => x.kind === 'drain')) {
    for (const e of flows.filter((l) => l.to === d.id)) {
      const pool = byId[e.from]
      if (!pool || pool.kind !== 'pool') continue
      const others = flows.filter((l) => l.from === pool.id && byId[l.to] && byId[l.to].kind !== 'drain')
      if (others.length)
        add(
          'warn',
          label(pool),
          `feeds drain ${label(d)} and ${others.map((o) => label(byId[o.to])).join(', ')} in parallel — reads may run before the subtraction lands; wire pool → drain → reader`,
        )
    }
  }

  const exits = nodes.filter((n) => n.kind === 'exit')
  if (nodes.length && !exits.length) add('info', '', 'no EXIT part — this machine never announces an outcome to its parent')
  for (const x of exits)
    if (!allReach.has(x.id) && linked(x.id)) add('warn', label(x), `exit "${x.name || '?'}" is unreachable — no flow path from any entry leads here`)

  for (const n of nodes) if (n.kind !== 'text' && !n.parent && !linked(n.id)) add('info', label(n), 'orphan — no flow or data wires')
}

// whole doc ---------------------------------------------------------------------
function scanDocTypes(doc, add) {
  const declared = new Set((doc.types || []).map((t) => (t.name || '').toLowerCase()).filter(Boolean))
  for (const a of doc.assets || [])
    for (const f of a.api || [])
      for (const v of [...(f.inputs || []), ...(f.outputs || [])]) {
        const ty = String(v.type || '')
        if (!ty) continue
        const base = ty.replace(/\[\s*\]$/, '').trim()
        if (!BASIC_TYPES.includes(base) && !declared.has(base.toLowerCase()))
          add('error', `ƒ ${f.name || '?'}`, `type "${base}" is no longer declared (system "${a.name || '?'}")`)
      }
}

// scopePath: null = whole doc; [] = top graph; [id,…] = that nested graph
export function runDRC(doc, scopePath = null) {
  const findings = []
  const graphs = []
  walkGraphs(doc.design, (g, p) => graphs.push({ g, path: p.map((n) => n.id), label: [doc.design.name || 'Main Loop', ...p.map((n) => n.name || 'sub graph')].join(' ▸ ') }))
  const scoped = scopePath === null ? graphs : graphs.filter((x) => JSON.stringify(x.path) === JSON.stringify(scopePath))
  for (const { g, path, label: gname } of scoped) {
    const add = (sev, node, text) => findings.push({ sev, path, graph: gname, node, text })
    scanGraph(g, doc.assets, doc.types || [], add)
  }
  if (scopePath === null) {
    const add = (sev, node, text) => findings.push({ sev, path: [], graph: 'document', node, text })
    scanDocTypes(doc, add)
  }
  const rank = { error: 0, warn: 1, info: 2 }
  findings.sort((a, b) => rank[a.sev] - rank[b.sev])
  return findings
}
