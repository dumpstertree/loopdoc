// ---------------------------------------------------------------------------
// Design Rule Check — a PCB-style DRC for loopdocs.
//
// Pure static analysis over one graph or the whole doc, running the same
// reviews a human would: dropped-chain wiring, empty loop bodies, item reads
// bound to the last iteration, unreachable exits, dangling data wires, value
// wires that read before their producer can have run (the racing wires both
// canvases draw red) and type drift. Every finding carries a severity:
//   error — a chain drops / nothing runs / a port is gone
//   warn  — almost certainly not what you meant
//   info  — works, but is a decision worth making on purpose
// Finding: { sev, path, graph, node, nid, text } — path = breadcrumb node ids to
// the owning graph, so the panel can jump there; nid = the flagged part's id,
// so the jump can also select it.
// ---------------------------------------------------------------------------
import { kindMeta, KINDS, resolveCall, dataPortType, BASIC_TYPES, walkGraphs, exitVarsOf, resolveExitRef, MATH, BOOL } from './model.js'
import { isEntryPart, valueWireRisks } from './wireRules.js'
import { validateCode } from './codeLang.js'

const label = (n) =>
  n ? `${kindMeta(n).label || n.kind}${n.name ? ` "${n.name}"` : ''}` : '?'

// the same words, boxed: nf() feeds add()'s node argument and text embeds alike,
// but the String object keeps the part's id — runDRC unwraps it into node (the
// printed label) + nid (the id a jumped-to graph selects); a template coerces it
// back to plain text
const nf = (n) => {
  const s = new String(label(n))
  s.id = n?.id ?? null
  return s
}

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
      add('error', nf(other || { kind: 'wire' }), 'a wire connects to a deleted part — remove or rewire it')
    }
  for (const l of data) {
    if (byId[l.from] && !dataPortType(g, assets, l.from, l.fromPort, 'out', funcs))
      add('error', nf(byId[l.to]), `data wire ⇣ ${l.toPort} is dangling — ${nf(byId[l.from])} no longer outputs that port`)
    if (byId[l.to] && !dataPortType(g, assets, l.to, l.toPort, 'in', funcs))
      add('error', nf(byId[l.from]), `data wire from ⇡ ${l.fromPort} is dangling — ${nf(byId[l.to])} no longer has that input`)
  }
  // racing value wires — the exact verdict both canvases draw red (wireRules'
  // ordering pass): the ⇡ behind this ⇣ may not have run when the reader does
  for (const r of valueWireRisks(g)) {
    const l = (g.links || []).find((x) => x.id === r.link)
    if (!l || !byId[l.to]) continue
    if (r.kind === 'cycle') {
      add('warn', nf(byId[l.to]), `⇣ ${l.toPort} reads a value that chains back to itself — the ⇡ can never hold anything (wire drawn red)`)
      continue
    }
    add(
      'warn',
      nf(byId[l.to]),
      `⇣ ${l.toPort} may read ${nf(byId[r.origin])} before it runs — every chain path from an entry to this reader must pass through it first (wire drawn red)`,
    )
  }
  for (const n of nodes) {
    if (n.kind === 'getg' || n.kind === 'setg') {
      if (!n.gRef) add('error', nf(n), 'no global variable selected — pick one on the card')
      else if (globals.length && !globals.some((g) => g.id === n.gRef))
        add('error', nf(n), `global "${n.gName || '?'}" no longer exists — re-pick or remove (manage them in ⚙ GLOBALS)`)
      if (n.kind === 'setg' && n.gRef && !dataTo(n.id, '__val__'))
        add('warn', nf(n), `⇣ ${n.gName || 'value'} unwired — the global is never actually set`)
    }
    if (n.kind === 'func') {
      if (!n.func)
        add('error', nf(n), 'no ƒ function selected — pick one on the card (they live in ƒ FUNCTIONS on the DATA tab)')
      else if (ownerId && n.func === ownerId)
        add('error', nf(n), 'calls the very function you are inside — a function may not call itself')
      else if (funcs.length && !funcs.some((f) => f.id === n.func))
        add('error', nf(n), `ƒ function "${n.fName || '?'}" no longer exists — re-pick or remove`)
    }
    if (n.kind === 'inspect' && n.objType && n.objType !== 'any' && !isDeclared(n.objType))
      add('warn', nf(n), `reads ${n.objType} — no longer a declared type`)
    if (n.kind === 'foreach' && n.itemType && !BASIC_TYPES.includes(n.itemType) && !isDeclared(n.itemType))
      add('warn', nf(n), `item type ${n.itemType} is no longer declared`)
    if (n.kind === 'var') {
      const v = n.variable || {}
      if (!(v.name || '').trim()) add('warn', nf(n), 'assigns to no name — the walkthrough can only show "?"')
      const vt = String(v.type || '').replace('[]', '').trim()
      if (vt && vt !== 'any' && !BASIC_TYPES.includes(vt) && !isDeclared(vt))
        add('warn', nf(n), `makes a ${vt} — no longer a declared type`)
    }
    if (n.kind === 'ifb') {
      for (const [port, key, nm] of [['__a__', 'aVal', 'a'], ['__b__', 'bVal', 'b']])
        if (!dataTo(n.id, port) && !hasVal(n[key]))
          add('error', nf(n), `⇣ ${nm} has no wire and no custom value — chains arriving here drop`)
      if (hasIn(n.id)) {
        if (!outFrom(n.id, 'true').length) add('info', nf(n), 'true branch unwired — a true chain simply ends here')
        if (!outFrom(n.id, 'false').length) add('info', nf(n), 'false branch unwired — a false chain simply ends here')
      }
    }
    if (n.kind === 'switch') {
      if (!dataTo(n.id, '__val__') && !hasVal((n.cVals || {})['__val__']))
        add('error', nf(n), '⇣ val has no wire and no custom value — chains arriving here drop')
      if (hasIn(n.id)) {
        for (const c of n.cases || [])
          if (!outFrom(n.id, c.id).length) add('info', nf(n), `the “${c.label || 'case'}” arm is unwired — a chain matching it simply ends here`)
        if (!outFrom(n.id, 'default').length) add('info', nf(n), 'default arm unwired — a chain that matches no case simply ends here')
        if (!(n.cases || []).length) add('info', nf(n), 'no cases yet — every chain here leaves via default')
      }
    }
    if (n.kind === 'code') {
      const check = validateCode(n.code, n.lang || 'python', { inputs: n.inVars || [], outputs: n.outVars || [] })
      if (!check.ok)
        add('warn', nf(n), `code: ${check.errors[0].message}${check.errors[0].line > 1 ? ` (line ${check.errors[0].line})` : ''}`)
      else if ((check.warnings || []).length)
        add('info', nf(n), `code: ${check.warnings[0].message} (line ${check.warnings[0].line})`)
    }
  }

  if (g.mode === 'flow') {
    // ---- flow-graph rules ----------------------------------------------------
    for (const n of nodes) {
      const m = kindMeta(n)
      if (m.dataOnly) {
        if (g.entry === n.id) add('error', nf(n), 'set as the graph entry — but it is pure data, no flow ever starts there')
        if (flows.some((l) => l.from === n.id || l.to === n.id))
          add('error', nf(n), 'has flow wires — a pure-data part lives outside the chain, remove them')
      }

      if ((n.kind === 'graph' || n.kind === 'machine') && n.graph && !(n.graph.nodes || []).length)
        add('warn', nf(n), `${m.label} opens an empty graph`)
      if (n.kind === 'machine' && n.graph && !(n.graph.nodes || []).some((x) => x.kind === 'exit'))
        add('info', nf(n), 'machine has no EXIT — the parent can only see a generic out, not outcomes')
      if (n.kind === 'machine' && n.graph && (n.graph.nodes || []).length && !(n.graph.nodes || []).some((x) => x.kind === 'enter'))
        add('info', nf(n), 'machine has no ENTER — nothing starts its chains')
      // a machine's ⇡ ports ARE its exits' variables — one nobody consumes is
      // itself a decision worth seeing
      if (n.kind === 'machine')
        for (const v of exitVarsOf(n.graph))
          if (!data.some((l) => l.from === n.id && l.fromPort === v.id))
            add('info', nf(n), `⇡ ${v.name}:${v.type} from the “${v.exit}” EXIT is never read above — the value announces itself and goes no further`)
      if (n.kind === 'graph' && portsOf(n).some((p) => p.dir === 'out') && hasIn(n.id) && !anyOut(n.id))
        add('info', nf(n), 'sub graph returns here and nothing continues — flow ends')
      // 'both' kinds (FUNC) sit on graph canvases as much as on machines —
      // the flow rules see them as flow members there
      if (m.canvas.includes('flow') && !['ifb', 'switch', 'graph', 'machine', 'exit'].includes(n.kind) && portsOf(n).some((p) => p.dir === 'out') && hasIn(n.id) && !anyOut(n.id))
        add('info', nf(n), 'flow dead-ends here')
      if (m.canvas.includes('flow') && !linked(n.id) && !['step'].includes(n.kind))
        add('info', nf(n), 'orphan — no wires at all')
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
      add('info', nf(n), 'chains fire into nothing — its out is unwired')
    for (const a of n.assets || []) {
      if (!a.asset) add('warn', nf(n), `📦 row “${a.name || '?'}” has no asset picked yet`)
      else if (assets.length && !assets.some((x) => x.id === a.asset))
        add('error', nf(n), `📦 "${a.name || '?'}" no longer exists — re-pick or remove (manage them in the 📦 panel)`)
    }
    if (n.kind === 'syscall') {
      const r = resolveCall((n.calls || [])[0], assets)
      if (!r) add('error', nf(n), 'has no system fn selected')
      else
        for (const v of r.fn.inputs || []) {
          if (!v.name && !v.type) continue // blank API var, ignored everywhere
          if (!dataTo(n.id, v.id) && !hasVal((n.cVals || {})[v.id])) add('warn', nf(n), `⇣ ${v.name || '?'}:${v.type || '?'} has no data wire — the call runs blind on it`)
        }
      if (n.block && !hasIn(n.id))
        add('warn', nf(n), '⏳ blocking call with no flow input — every round freezes for a click before anything runs')
    }
    if (MATH[n.kind])
      for (const [port, key, nm] of [['__a__', 'aVal', 'a'], ['__b__', 'bVal', 'b']])
        if (!dataTo(n.id, port) && !hasVal(n[key]))
          add('warn', nf(n), `⇣ ${nm} has no wire and no custom value — chains passing through leave an empty ⇡ result`)
    if (n.kind === 'rand')
      for (const [port, key, nm] of [['__min__', 'minVal', 'min'], ['__max__', 'maxVal', 'max']])
        if (!dataTo(n.id, port) && !hasVal(n[key]))
          add('warn', nf(n), `⇣ ${nm} has no wire and no custom value — nothing to draw between, the ⇡ result stays empty`)
    if (BOOL[n.kind]) {
      const slots = Math.max(2, Number(n.slots ?? 2))
      const fed = (i) => dataTo(n.id, `__s${i}__`) || hasVal((n.cVals || {})[`__s${i}__`])
      if (!(Array.from({ length: slots }, (_, i) => i).some(fed)))
        add('warn', nf(n), 'no ⇣ slot is wired or typed — the ⇡ verdict stays empty')
      else if (Array.from({ length: slots }, (_, i) => i).some((i) => !fed(i)))
        add('info', nf(n), 'an unwired, untyped ⇣ slot is simply ignored when folding')
    }
    if (n.kind === 'for' && !dataTo(n.id, '__to__')) add('error', nf(n), 'counted loop has no ⇣ to:int — nothing to count to')
    if (n.kind === 'foreach' && !dataTo(n.id, '__arr__')) add('error', nf(n), 'foreach has no ⇣ arr source — it can never iterate')
    if (n.kind === 'while' && !dataTo(n.id, '__cond__')) add('error', nf(n), 'while has no ⇣ cond:bool — it can never decide to run')
    if (['append', 'join', 'remove', 'removeat', 'sort'].includes(n.kind) && !dataTo(n.id, '__arr__'))
      add('error', nf(n), 'no ⇣ array wired — it has nothing to work on')
    if (n.kind === 'join' && dataTo(n.id, '__arr__') && !dataTo(n.id, '__b__'))
      add('error', nf(n), '⇣ b is unwired — join needs two arrays')
    if ((n.kind === 'append' || n.kind === 'remove') && !dataTo(n.id, '__val__'))
      add('error', nf(n), `⇣ val unwired — nothing to ${n.kind === 'append' ? 'append' : 'remove'}`)
    if (n.kind === 'removeat' && !dataTo(n.id, '__index__')) add('error', nf(n), '⇣ at:int is unwired — no index to cut at')
    if (n.kind === 'clone' && !dataTo(n.id, '__val__')) add('error', nf(n), '⇣ val unwired — nothing to clone')

    if ((n.kind === 'for' || n.kind === 'foreach' || n.kind === 'while') && hasIn(n.id)) {
      const body = outFrom(n.id, 'out').length > 0
      const end = outFrom(n.id, 'end').length > 0
      if (!body && !end) add('error', nf(n), 'loop is wired to nothing — chains arrive and nothing happens')
      else if (!body && end)
        add('warn', nf(n), 'loop body is empty — end fires at once; per-item work belongs on iter, end is only the round summary')
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
            nf(n),
            `end chain reads the loop item through ${offenders.map((o) => nf(byId[o])).join(', ')} — after the loop, item binds to the LAST iteration only`,
          )
      }
    }
  }

  const exits = nodes.filter((n) => n.kind === 'exit')
  if (nodes.length && !exits.length) add('info', '', 'no EXIT part — this machine never announces an outcome to its parent')
  // real EXIT names must be unique — instances pick a target by name/id
  const exitNames = new Map()
  for (const x of exits) {
    const key = String(x.name || '').trim().toLowerCase()
    if (key) {
      if (exitNames.has(key)) add('error', nf(x), `exit name "${x.name}" is used by more than one EXIT — names must be unique`)
      else exitNames.set(key, x.id)
    }
  }
  for (const x of exits) {
    if (!allReach.has(x.id) && linked(x.id))
      add('warn', nf(x), `exit "${x.name || '?'}" is unreachable — no flow path from any entry leads here`)
    // an EXIT variable is the mirror of an ENTER one: it grows a ⇡ port on the
    // MACHINE node above, so a door that announces nothing is a decision to make
    for (const v of x.vars || [])
      if (!dataTo(x.id, v.id))
        add(
          hasVal(v.value) ? 'info' : 'warn',
          nf(x),
          `exit var "${v.name || '?'}:${v.type || 'int'}" has nothing wired into its ⇣ — it announces only the value set on the card${hasVal(v.value) ? '' : ', and none is set'}`,
        )
  }
  // EXIT REFs route to a real EXIT — only real exits count as outcomes
  for (const n of nodes) {
    if (n.kind !== 'exitinst') continue
    const target = resolveExitRef(g, n)
    if (!n.exitRef) add('error', nf(n), 'no EXIT selected — pick the EXIT this route ends at')
    else if (!target) add('error', nf(n), 'target EXIT is missing — re-pick an existing EXIT')
    if (hasIn(n.id) && !allReach.has(n.id) && linked(n.id))
      add('warn', nf(n), 'exit ref is unreachable — no flow path from any entry leads here')
    if (target)
      for (const v of target.vars || [])
        if (!dataTo(n.id, v.id))
          add(
            hasVal(v.value) ? 'info' : 'warn',
            nf(n),
            `⇣ ${v.name || '?'}:${v.type || 'int'} (from “${target.name || 'exit'}”) has nothing wired in — it announces only the target’s fallback${hasVal(v.value) ? '' : ', and none is set'}`,
          )
  }

  for (const n of nodes) if (n.kind !== 'text' && n.kind !== 'todo' && n.kind !== 'enter' && !n.parent && !linked(n.id)) add('info', nf(n), 'orphan — no flow or data wires')
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
    // node arrives boxed from nf() — unwrap to the printed label + the nid to select
    const add = (sev, node, text) =>
      findings.push({
        sev,
        path,
        graph: gname,
        node: node instanceof String ? String(node) : node,
        nid: node instanceof String ? node.id : null,
        text,
      })
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

// counterpart of validateDoc — removes the floating data it flags, keeping
// nothing a human could defend: the FIRST copy of a part id wins (walk order
// matches validateDoc: the design tree, then ƒ bodies), later duplicates are
// dropped with their wires, second mounts of a twice-mounted graph are
// unhooked, unknown-kind parts are dropped, group links to a gone or wrong
// frame are cleared, and nested graphs on kinds that never open one are cut
// out; never-called ƒ bodies are left alone — a warn, not stale data
export function cleanDoc(doc) {
  const seen = new Set() // part ids kept, walk-wide
  const mounts = new Set() // graph ids mounted, walk-wide
  const cut = { parts: 0, mounts: 0, frames: 0, wires: 0 }

  const cleanGraph = (g) => {
    mounts.add(g.id)
    const kept = []
    const drop = new Set() // ids removed in THIS graph — their wires go too
    for (const n of g.nodes || []) {
      if (seen.has(n.id) || !KINDS[n.kind]) {
        drop.add(n.id)
        cut.parts++
        continue
      }
      seen.add(n.id)
      let m = n
      if (m.graph)
        if (mounts.has(m.graph.id) || !['graph', 'machine'].includes(m.kind)) {
          cut.mounts++
          m = { ...m, graph: undefined } // this mount is the stale copy — unhook it
        } else {
          mounts.add(m.graph.id)
          m = { ...m, graph: cleanGraph(m.graph) }
        }
      kept.push(m)
    }
    const keptIds = new Set(kept.map((n) => n.id))
    const byFrame = Object.fromEntries(kept.map((n) => [n.id, n]))
    const nodes = kept.map((n) => {
      if (!n.parent) return n
      const f = byFrame[n.parent]
      if (f && f.kind === 'text' && f.id !== n.id) return n
      cut.frames++
      return { ...n, parent: undefined }
    })
    const links = (g.links || []).filter((l) => !drop.has(l.from) && !drop.has(l.to))
    cut.wires += (g.links || []).length - links.length
    return { ...g, nodes, links, entry: drop.has(g.entry) ? null : g.entry }
  }

  const next = { ...doc, design: cleanGraph(doc.design), funcs: (doc.funcs || []).map((f) => ({ ...f, graph: cleanGraph(f.graph) })) }
  return { doc: next, cut, total: cut.parts + cut.mounts + cut.frames + cut.wires }
}

// whole-doc structural validation — not design rules but the integrity of the
// stored doc, meant to catch old floating data an edit left behind: a part id
// living in two graphs (the jump-then-select lands the survivor, the report
// lands both), the same graph mounted twice, a part still chained to a text
// frame that is gone, a nested graph hung on a kind that never opens one, and
// ƒ bodies no call site reaches — their findings carry nid when a part is
// involved, so clicking one selects the suspect itself
export function validateDoc(doc) {
  const findings = []
  const add = (sev, path, graph, node, text) =>
    findings.push({
      sev,
      path,
      graph,
      node: node instanceof String ? String(node) : node,
      nid: node instanceof String ? node.id : null,
      text,
    })

  // every graph, call-site breadcrumbs like runDRC takes; ƒ bodies have none
  // once no call site is left — they get the top path and their own name, so a
  // click still leaves the panel rather than landing on a dead breadcrumb
  const graphs = []
  walkGraphs(doc.design, (g, p) => graphs.push({ g, path: p.map((n) => n.id), label: [doc.design.name || 'Main Loop', ...p.map((n) => n.name || 'sub graph')].join(' ▸ ') }))
  for (const f of doc.funcs || [])
    walkGraphs(f.graph, (g, p) => graphs.push({ g, path: [], label: [`ƒ ${f.name || '(unnamed)'}`, ...p.map((n) => n.name || 'sub graph')].join(' ▸ ') }))
  const called = new Set()
  for (const { g } of graphs) for (const n of g.nodes || []) if (n.kind === 'func' && n.func) called.add(n.func)

  const seen = new Map() // part id → first graph whose label to name
  const mounts = new Map() // graph id → first label
  for (const { g, path, label: gname } of graphs) {
    const byId = Object.fromEntries((g.nodes || []).map((n) => [n.id, n]))
    if (mounts.has(g.id))
      add('error', path, gname, '', `the same graph is mounted here and under ${mounts.get(g.id)} — one mount is a stale copy`)
    else mounts.set(g.id, gname)
    const local = new Set()
    for (const n of g.nodes || []) {
      if (local.has(n.id))
        add('error', path, gname, nf(n), `part id ${n.id} sits twice in this graph — one copy is floating data`)
      else if (seen.has(n.id))
        add('error', path, gname, nf(n), `duplicate of ${seen.get(n.id)} — the same part lives in two graphs; one is floating data`)
      else {
        local.add(n.id)
        seen.set(n.id, gname)
      }
      if (!KINDS[n.kind])
        add('error', path, gname, nf(n), `kind "${n.kind}" is no part the app knows — floating data`)
      if (n.parent && !byId[n.parent])
        add('error', path, gname, nf(n), 'still chained to a text frame that is gone — it will never ride its group')
      else if (n.parent && byId[n.parent].kind !== 'text')
        add('error', path, gname, nf(n), 'group link points at a part that is not a text frame')
      if (n.graph && !['graph', 'machine'].includes(n.kind))
        add('error', path, gname, nf(n), `hangs a nested graph on kind "${n.kind}" the app never opens — floating data`)
    }
  }
  for (const f of doc.funcs || [])
    if (!called.has(f.id))
      add('warn', [], 'document', '', `ƒ "${f.name || '(unnamed)'}" is never called anywhere in the design — its whole body floats outside every chain`)

  const rank = { error: 0, warn: 1, info: 2 }
  findings.sort((a, b) => rank[a.sev] - rank[b.sev])
  return findings
}
