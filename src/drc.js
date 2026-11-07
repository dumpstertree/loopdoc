// ---------------------------------------------------------------------------
// Design Rule Check — a PCB-style DRC for loopdocs.
//
// Pure static analysis over one graph or the whole doc, running the same
// reviews a human would: dropped-chain wiring, empty loop bodies, item reads
// bound to the last iteration, unreachable exits, dangling data wires and type drift. Every finding carries a severity:
//   error — a chain drops / nothing runs / a port is gone
//   warn  — almost certainly not what you meant
//   info  — works, but is a decision worth making on purpose
// Finding: { sev, path, graph, node, text } — path = breadcrumb node ids to
// the owning graph, so the panel can jump there.
// ---------------------------------------------------------------------------
import { kindMeta, resolveCall, dataPortType, BASIC_TYPES, walkGraphs, exitVarsOf, MATH } from './model.js'
import { isEntryPart } from './wireRules.js'

const label = (n) =>
  n ? `${kindMeta(n).label || n.kind}${n.name ? ` "${n.name}"` : ''}` : '?'

const hasVal = (v) => v !== undefined && v !== null && String(v) !== ''

// one graph in isolation -------------------------------------------------------
function scanGraph(g, assets, types, globals, add, funcs = [], ownerId = null) {
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

  // ---- both modes: wires into deleted nodes & dangling data ports -----------
  for (const l of g.links || [])
    if (!byId[l.from] || !byId[l.to]) {
      const other = byId[l.from] || byId[l.to]
      add('error', label(other || { kind: 'wire' }), 'a wire connects to a deleted part — remove or rewire it')
    }
  for (const l of data) {
    if (byId[l.from] && !dataPortType(g, assets, l.from, l.fromPort, 'out', funcs))
      add('error', label(byId[l.to]), `data wire ⇣ ${l.toPort} is dangling — ${label(byId[l.from])} no longer outputs that port`)
    if (byId[l.to] && !dataPortType(g, assets, l.to, l.toPort, 'in', funcs))
      add('error', label(byId[l.from]), `data wire from ⇡ ${l.fromPort} is dangling — ${label(byId[l.to])} no longer has that input`)
  }
  for (const n of nodes) {
    if (n.kind === 'getg' || n.kind === 'setg') {
      if (!n.gRef) add('error', label(n), 'no global variable selected — pick one on the card')
      else if (globals.length && !globals.some((g) => g.id === n.gRef))
        add('error', label(n), `global "${n.gName || '?'}" no longer exists — re-pick or remove (manage them in ⚙ GLOBALS)`)
      if (n.kind === 'setg' && n.gRef && !dataTo(n.id, '__val__'))
        add('warn', label(n), `⇣ ${n.gName || 'value'} unwired — the global is never actually set`)
    }
    if (n.kind === 'func') {
      if (!n.func)
        add('error', label(n), 'no ƒ function selected — pick one on the card (they live in ƒ FUNCTIONS on the DATA tab)')
      else if (ownerId && n.func === ownerId)
        add('error', label(n), 'calls the very function you are inside — a function may not call itself')
      else if (funcs.length && !funcs.some((f) => f.id === n.func))
        add('error', label(n), `ƒ function "${n.fName || '?'}" no longer exists — re-pick or remove`)
    }
    if (n.kind === 'inspect' && n.objType && n.objType !== 'any' && !isDeclared(n.objType))
      add('warn', label(n), `reads ${n.objType} — no longer a declared type`)
    if (n.kind === 'foreach' && n.itemType && !BASIC_TYPES.includes(n.itemType) && !isDeclared(n.itemType))
      add('warn', label(n), `item type ${n.itemType} is no longer declared`)
    if (n.kind === 'var') {
      const v = n.variable || {}
      if (!(v.name || '').trim()) add('warn', label(n), 'assigns to no name — the walkthrough can only show "?"')
      const vt = String(v.type || '').replace('[]', '').trim()
      if (vt && vt !== 'any' && !BASIC_TYPES.includes(vt) && !isDeclared(vt))
        add('warn', label(n), `makes a ${vt} — no longer a declared type`)
    }
  }

  if (g.mode === 'flow') {
    // ---- flow-graph rules ----------------------------------------------------
    for (const n of nodes) {
      const m = kindMeta(n)
      if (m.dataOnly) {
        if (g.entry === n.id) add('error', label(n), 'set as the graph entry — but it is pure data, no flow ever starts there')
        if (flows.some((l) => l.from === n.id || l.to === n.id))
          add('error', label(n), 'has flow wires — a pure-data part lives outside the chain, remove them')
      }
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
      if (n.kind === 'machine' && n.graph && (n.graph.nodes || []).length && !(n.graph.nodes || []).some((x) => x.kind === 'enter'))
        add('info', label(n), 'machine has no ENTER — nothing starts its chains')
      // a machine's ⇡ ports ARE its exits' variables — one nobody consumes is a
      // decision worth seeing, the mirror of a choice option that leads nowhere
      if (n.kind === 'machine')
        for (const v of exitVarsOf(n.graph))
          if (!data.some((l) => l.from === n.id && l.fromPort === v.id))
            add('info', label(n), `⇡ ${v.name}:${v.type} from the “${v.exit}” EXIT is never read above — the value announces itself and goes no further`)
      if (n.kind === 'graph' && portsOf(n).some((p) => p.dir === 'out') && hasIn(n.id) && !anyOut(n.id))
        add('info', label(n), 'sub graph returns here and nothing continues — flow ends')
      // 'both' kinds (FUNC) sit on graph canvases as much as on machines —
      // the flow rules see them as flow members there
      if (m.canvas.includes('flow') && !['condition', 'choice', 'graph', 'machine', 'exit'].includes(n.kind) && portsOf(n).some((p) => p.dir === 'out') && hasIn(n.id) && !anyOut(n.id))
        add('info', label(n), 'flow dead-ends here')
      if (m.canvas.includes('flow') && !linked(n.id) && !['event', 'step'].includes(n.kind))
        add('info', label(n), 'orphan — no wires at all')
    }
    return
  }

  // ---- machine rules -----------------------------------------------------------
  const entryNodes = nodes.filter((n) => isEntryPart(n, g.links))
  if (nodes.length && !entryNodes.length && (g.links || []).length)
    add('error', '', 'nothing can run — no entry: add an ENTER part (only ENTER starts chains)')
  const allReach = reach(entryNodes.map((n) => n.id))

  for (const n of nodes) {
    if (n.kind === 'enter' && !anyOut(n.id))
      add('info', label(n), 'chains fire into nothing — its out is unwired')
    for (const a of n.assets || []) {
      if (!a.asset) add('warn', label(n), `📦 row “${a.name || '?'}” has no asset picked yet`)
      else if (assets.length && !assets.some((x) => x.id === a.asset))
        add('error', label(n), `📦 "${a.name || '?'}" no longer exists — re-pick or remove (manage them in the 📦 panel)`)
    }
    if (n.kind === 'syscall') {
      const r = resolveCall((n.calls || [])[0], assets)
      if (!r) add('error', label(n), 'has no system fn selected')
      else
        for (const v of r.fn.inputs || []) {
          if (!v.name && !v.type) continue // blank API var, ignored everywhere
          if (!dataTo(n.id, v.id) && !hasVal((n.cVals || {})[v.id])) add('warn', label(n), `⇣ ${v.name || '?'}:${v.type || '?'} has no data wire — the call runs blind on it`)
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
    if (MATH[n.kind])
      for (const [port, key, nm] of [['__a__', 'aVal', 'a'], ['__b__', 'bVal', 'b']])
        if (!dataTo(n.id, port) && !hasVal(n[key]))
          add('warn', label(n), `⇣ ${nm} has no wire and no custom value — chains passing through leave an empty ⇡ result`)
    if (n.kind === 'for' && !dataTo(n.id, '__to__')) add('error', label(n), 'counted loop has no ⇣ to:int — nothing to count to')
    if (n.kind === 'foreach' && !dataTo(n.id, '__arr__')) add('error', label(n), 'foreach has no ⇣ arr source — it can never iterate')
    if (['append', 'join', 'remove', 'removeat', 'sort'].includes(n.kind) && !dataTo(n.id, '__arr__'))
      add('error', label(n), 'no ⇣ array wired — it has nothing to work on')
    if (n.kind === 'join' && dataTo(n.id, '__arr__') && !dataTo(n.id, '__b__'))
      add('error', label(n), '⇣ b is unwired — join needs two arrays')
    if ((n.kind === 'append' || n.kind === 'remove') && !dataTo(n.id, '__val__'))
      add('error', label(n), `⇣ val unwired — nothing to ${n.kind === 'append' ? 'append' : 'remove'}`)
    if (n.kind === 'removeat' && !dataTo(n.id, '__index__')) add('error', label(n), '⇣ at:int is unwired — no index to cut at')
    if (n.kind === 'clone' && !dataTo(n.id, '__val__')) add('error', label(n), '⇣ val unwired — nothing to clone')

    if ((n.kind === 'for' || n.kind === 'foreach') && hasIn(n.id)) {
      const body = outFrom(n.id, 'out').length > 0
      const end = outFrom(n.id, 'end').length > 0
      if (!body && !end) add('error', label(n), 'loop is wired to nothing — chains arrive and nothing happens')
      else if (!body && end)
        add('warn', label(n), 'loop body is empty — end fires at once; per-item work belongs on iter, end is only the round summary')
      else if (body && end) {
        // taint: everything that reads the loop's ⇡ item/index — directly or
        // through data wires (item → inspect → if …)
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

  const exits = nodes.filter((n) => n.kind === 'exit')
  if (nodes.length && !exits.length) add('info', '', 'no EXIT part — this machine never announces an outcome to its parent')
  for (const x of exits) {
    if (!allReach.has(x.id) && linked(x.id))
      add('warn', label(x), `exit "${x.name || '?'}" is unreachable — no flow path from any entry leads here`)
    // an EXIT variable is the mirror of an ENTER one: it grows a ⇡ port on the
    // MACHINE node above, so a door that announces nothing is a decision to make
    for (const v of x.vars || [])
      if (!dataTo(x.id, v.id))
        add(
          hasVal(v.value) ? 'info' : 'warn',
          label(x),
          `exit var "${v.name || '?'}:${v.type || 'int'}" has nothing wired into its ⇣ — it announces only the value set on the card${hasVal(v.value) ? '' : ', and none is set'}`,
        )
  }

  for (const n of nodes) if (n.kind !== 'text' && n.kind !== 'todo' && n.kind !== 'enter' && !n.parent && !linked(n.id)) add('info', label(n), 'orphan — no flow or data wires')
}

// whole doc ---------------------------------------------------------------------
function scanDocTypes(doc, add) {
  const declared = new Set((doc.types || []).map((t) => (t.name || '').toLowerCase()).filter(Boolean))
  for (const v of doc.vars || []) {
    const ty = String(v.type || 'int')
    if (!BASIC_TYPES.includes(ty) && !declared.has(ty.toLowerCase()))
      add('error', `⚙ ${v.name || '(unnamed global)'}`, `type "${ty}" is no longer declared`)
  }
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
  // function bodies live on the doc, not under a call site — scan each once,
  // reachable through the first FUNC node anywhere in the doc that picks it
  const sites = {}
  const seen = new Set()
  const queue = [[doc.design, []]]
  while (queue.length) {
    const [g, p] = queue.shift()
    const key = g.id || JSON.stringify(p)
    if (seen.has(key)) continue
    seen.add(key)
    for (const n of g.nodes || []) {
      if (n.kind === 'func' && n.func) {
        if (!sites[n.func]) sites[n.func] = [...p, n.id]
        const f = (doc.funcs || []).find((x) => x.id === n.func)
        if (f) queue.push([f.graph, [...p, n.id]])
      }
      if (n.graph) queue.push([n.graph, [...p, n.id]])
    }
  }
  for (const f of doc.funcs || []) {
    const path = sites[f.id]
    if (!path) continue
    // label the body graph with its own name under the call-site breadcrumb
    let g = doc.design
    const names = []
    for (const id of path) {
      const n = g.nodes.find((x) => x.id === id)
      if (n?.kind === 'func') {
        names.push(f.name || '(unnamed)')
        g = f.graph
      } else {
        names.push(n.name || 'sub graph')
        g = n.graph || g
      }
    }
    graphs.push({ g: f.graph, path, owner: f.id, label: [doc.design.name || 'Main Loop', ...names].join(' ▸ ') })
    // machines/graphs nested inside the body follow the same breadcrumb
    walkGraphs(f.graph, (g, p) => {
      if (!p.length) return
      graphs.push({
        g,
        path: [...path, ...p.map((n) => n.id)],
        label: [doc.design.name || 'Main Loop', ...names, ...p.map((n) => n.name || 'sub graph')].join(' ▸ '),
      })
    })
  }
  const scoped = scopePath === null ? graphs : graphs.filter((x) => JSON.stringify(x.path) === JSON.stringify(scopePath))
  for (const { g, path, owner, label: gname } of scoped) {
    const add = (sev, node, text) => findings.push({ sev, path, graph: gname, node, text })
    scanGraph(g, doc.assets, doc.types || [], doc.vars || [], add, doc.funcs || [], owner || null)
  }
  if (scopePath === null) {
    const add = (sev, node, text) => findings.push({ sev, path: [], graph: 'document', node, text })
    scanDocTypes(doc, add)
  }
  const rank = { error: 0, warn: 1, info: 2 }
  findings.sort((a, b) => rank[a.sev] - rank[b.sev])
  return findings
}
