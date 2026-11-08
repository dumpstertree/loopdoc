// LLM export — flattens the whole document into one self-contained plain-text
// brief written FOR a language model to read and build a game from: each graph
// is lowered into an ordered pseudo-program (chains in run order, control
// structures as indented blocks, data wires as # lines under their consumer),
// nested graphs/machines/functions become sections the call site points into,
// and a part reference for every kind used explains the vocabulary itself.
// Not re-importable — this is the communication artifact; the .json is the
// lossless one.
import { kindMeta, dataPorts, assetIcon, assetLabel, resolveCall, typedValue, MATH } from './model.js'

const q = (s) => (s === undefined || s === null || s === '' ? '' : `"${s}"`)

const shortVal = (v) =>
  Array.isArray(v)
    ? `[${v.map(shortVal).join(', ')}]`
    : v && typeof v === 'object' && v !== null
      ? `{ ${Object.entries(v).map(([k, x]) => `${k}: ${shortVal(x)}`).join(', ')} }`
      : String(v)

// a label unique enough to read: KIND "name", or KIND#2 when unnamed repeats
function makeLabels(g) {
  const labels = {}
  const seen = {}
  for (const n of g.nodes || []) {
    const K = (KIND(n)).toUpperCase()
    const nm = (n.name || '').trim()
    seen[K] = (seen[K] || 0) + 1
    labels[n.id] = nm ? `${K} ${q(nm)}` : seen[K] > 1 ? `${K}#${seen[K]}` : K
  }
  // unnamed kinds repeated with names identical too — keep first, number later
  const used = new Set()
  for (const n of g.nodes || []) {
    let L = labels[n.id]
    if (used.has(L)) {
      let i = 2
      while (used.has(`${L} #${i}`)) i++
      L = `${L} #${i}`
      labels[n.id] = L
    }
    used.add(L)
  }
  return labels
}
const KIND = (n) => kindMeta(n).label || n.kind

// one-line what-it-is for a node — its config, not its wiring
function detail(n, g, doc) {
  const A = doc.assets
  const callStr = (c) => {
    const r = resolveCall(c, A)
    return r ? `${r.asset.name || 'system'}.${r.fn.name || '?'}()` : '⚠ no system fn picked'
  }
  const fed = (port) => (g.links || []).some((l) => l.kind === 'data' && l.to === n.id && l.toPort === port)
  switch (n.kind) {
    case 'event':
      return [
        ...(n.calls || []).map(callStr).map((c) => `calls ${c}`),
        n.gen && n.gen.name ? `✨ generates a new asset "${n.gen.name}" (graph-local)` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    case 'syscall':
      return `calls ${(n.calls || []).map(callStr).join(', ')}`
    case 'load':
      return `puts ${assetLabel(n.asset, A)} into asset memory`
    case 'unload':
      return `removes ${assetLabel(n.asset, A)} from asset memory`
    case 'input':
      return `applies 🎮 ${assetLabel(n.asset, A)} (player input)`
    case 'var': {
      const v = n.variable || {}
      if (!v.type) return `= ${q(v.value)}`
      return `makes ${v.name || 'value'}:${v.type} = ${shortVal(typedValue(v.type, v.value, doc.types))}`
    }
    case 'condition':
      return n.cond ? `test: ${n.cond}` : 'branch on its ⇣ operands'
    case 'ifb':
      return `verdict ⇡ = (⇣a ${n.op || '=='} ⇣b)`
    case 'choice':
      return `waits for player: ${(n.exits || []).map((e) => `"${e.label || '?'}"`).join(' | ')}`
    case 'graph':
      return `nested flow graph — ${n.graph?.nodes?.length || 0} parts (section below; RETURN leads back out)`
    case 'machine':
      return `nested machine — ${n.graph?.nodes?.length || 0} parts (section below; its ⇣ inputs feed the machine's ENTER doors and its ⇡ outputs are the EXIT doors' variables)`
    case 'getg':
      return `reads ⚙ ${n.gName || '?'} (${n.gType || '?'})`
    case 'setg':
      return `writes ⇣ value into ⚙ ${n.gName || '?'}`
    case 'for':
      return `counted loop — ⇡ i counts to ⇣ to:int; iter = body, end = after`
    case 'foreach':
      return `iterates ⇣ arr one at a time — ⇡ item (${n.itemType || '?'}) · ⇡ idx; iter = body, end = after`
    case 'inspect':
      return `reads ⇣ obj fields: ${(n.fields || []).map((f) => `${f.name}:${f.typeId}`).join(', ') || '— none picked'}`
    case 'append':
      return '⇡ = ⇣ arr with ⇣ val at the end'
    case 'join':
      return '⇡ = ⇣ a followed by ⇣ b'
    case 'remove':
      return '⇡ = ⇣ arr without any element equal to ⇣ val'
    case 'removeat':
      return '⇡ = ⇣ arr with element at ⇣ at:int dropped'
    case 'sort':
      return `⇡ = ⇣ arr ascending${n.field ? ` by ${n.field} of each item` : ' by value'}`
    case 'clone':
      return '⇡ = deep copy of ⇣ val — writes to it never reach the original'
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
    case 'mod':
      return `⇡ = ⇣ a ${MATH[n.kind]} ⇣ b — int/float operands, unwired sides take the card's custom value`
    case 'action':
      return 'chain waits here for a click'
    case 'exit': {
      const parts = (n.vars || []).map((v) => `${v.name || 'var'}:${v.type || 'int'}`)
      return `kills the token; appears as this machine’s output port in the parent${
        parts.length ? ` · announces ${parts.join(' · ')} as ⇡ outputs there` : ''
      }`
    }
    case 'exitinst': {
      const t = (g?.nodes || []).find((x) => x.kind === 'exit' && x.id === n.exitRef)
      const parts = t ? (t.vars || []).map((v) => `${v.name || 'var'}:${v.type || 'int'}`) : []
      return t
        ? `ends the machine via “${t.name || 'exit'}” — the target EXIT's door; ⇣ here mirror its vars${
            parts.length ? ` · feeds ${parts.join(' · ')}` : ''
          }`
        : n.exitRef ? '⚠ routes to an EXIT that no longer exists — re-pick' : 'no EXIT picked yet'
    }
    case 'enter': {
      const parts = [
        ...(n.vars || []).map((v) => `${v.name || 'var'}:${v.type || 'int'}${String(v.value ?? '') ? ` = ${v.value}` : ''}`),
        ...(n.assets || []).map((a) => `📦 ${a.name || 'unpicked'}`),
      ]
      return `the machine’s door — always starts chains${parts.length ? ` · vars: ${parts.join(' · ')}` : ''}`
    }
    case 'text':
      return `annotation frame — labels whatever sits inside it`
    case 'todo':
      return (n.todos || []).length
        ? `checklist: ${(n.todos || []).map((t) => `${t.done ? '[x]' : '[ ]'} ${t.text || '…'}`).join(' · ')}`
        : 'checklist — empty'
    case 'func': {
      const f = (doc?.funcs || []).find((x) => x.id === n.func)
      if (f) return `ƒ ${f.name || '(unnamed)'} — see Defined functions${f.note ? ` (${f.note})` : ''}`
      return n.func ? 'ƒ ⚠ picks a function that was deleted' : 'ƒ — no function picked yet'
    }
    default:
      return '' // note rides its own suffix below
  }
}

// lower one graph into an ordered pseudo-program: chains start at the entry /
// ENTER doors and run in the order they actually run; if/else, loops and
// player choices become indented blocks instead of arrow pairs; parts that
// never join a chain (pure values, notes, frames) ride as a side list; and
// anything the lowering cannot place — unwired branches, parallel chains,
// cycles, wires into deleted parts — is flagged ⚠ so nothing is lost quietly
function graphSection(g, doc, heading, parentNote) {
  const L = []
  const labels = makeLabels(g)
  const nodes = g.nodes || []
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const flows = (g.links || []).filter((l) => l.kind !== 'data')
  const datas = (g.links || []).filter((l) => l.kind === 'data')
  const pad = (i) => '  '.repeat(i)
  const sideKind = (n) => n.kind === 'text' || n.kind === 'todo' || kindMeta(n).dataOnly
  const portName = (node, id, dir) => {
    const dp = dataPorts(node, doc.assets, doc.funcs || [], g)
    const p = (dp[dir] || []).find((x) => x.id === id)
    return p ? p.name || id : id
  }
  const wire = (l) => {
    const s = byId[l.from]
    if (!s) return `⚠ deleted part (id ${l.from})`
    const out = dataPorts(s, doc.assets, doc.funcs || [], g).out.find((x) => x.id === l.fromPort)
    return `${labels[l.from]}.${out?.name || l.fromPort}${out?.type ? ` :${out.type}` : ''}`
  }
  const outFlow = (id, port) => flows.filter((l) => l.from === id && (port == null || l.fromPort === port))
  const feed = (id) => datas.filter((l) => l.to === id)
  const headLine = (n, ind) => {
    const d = detail(n, g, doc)
    return `${pad(ind)}${labels[n.id]}${d ? `: ${d}` : ''}${n.note && n.kind !== 'text' ? ` (note: ${q(n.note)})` : ''}`
  }
  const wires = (n, ind) => feed(n.id).map((l) => `${pad(ind + 1)}# ⇣ ${portName(n, l.toPort, 'in')} ← ${wire(l)}`)

  const visited = new Set()
  const extra = [] // parallel chains the walk forks off, lowered after the main one
  const residue = []

  const chain = (id, ind) => {
    const L2 = []
    let cur = id
    while (cur) {
      const n = byId[cur]
      if (!n) { L2.push(`${pad(ind)}⚠ flow enters a deleted part (id ${cur})`); break }
      if (visited.has(cur)) { L2.push(`${pad(ind)}goto ${labels[cur]} — ⚠ this chain returns to a part already written above`); break }
      visited.add(cur)
      const take = (port) => {
        const ls = port == null ? outFlow(cur) : outFlow(cur, port)
        for (const l of ls.slice(1)) extra.push({ id: l.to, why: `extra flow out of ${labels[cur]}` })
        return ls[0]
      }
      const step = (l) => {
        if (!l) return null
        if (byId[l.to]) return l.to
        L2.push(`${pad(ind)}⚠ flow enters a deleted part (id ${l.to})`)
        return null
      }
      const k = n.kind
      if (k === 'condition' || k === 'ifb') {
        const test = k === 'condition'
          ? n.cond || '(branches on its wired operands)'
          : ['a', 'b'].map((s) => {
              const l = feed(cur).find((x) => x.toPort === `__${s}__`)
              return l ? wire(l) : `⇣${s}`
            }).join(` ${n.op || '=='} `)
        L2.push(`${pad(ind)}if (${test}):  # ${labels[cur]}`)
        const tb = take('true')
        if (tb && byId[tb.to]) L2.push(...chain(tb.to, ind + 1))
        else if (tb) L2.push(`${pad(ind + 1)}⚠ deleted part (id ${tb.to})`)
        else L2.push(`${pad(ind)}# (true unwired — the chain stops when the test passes)`)
        L2.push(`${pad(ind)}else:`)
        const fb = take('false')
        if (fb && byId[fb.to]) L2.push(...chain(fb.to, ind + 1))
        else if (fb) L2.push(`${pad(ind + 1)}⚠ deleted part (id ${fb.to})`)
        else L2.push(`${pad(ind)}# (false unwired — the chain stops when the test fails)`)
        cur = null
      } else if (k === 'choice') {
        L2.push(`${pad(ind)}wait for player choice:  # ${labels[cur]}`)
        for (const e of n.exits || []) {
          const ls = outFlow(cur, e.id)
          for (const l of ls.slice(1)) extra.push({ id: l.to, why: `extra option ${q(e.label || '?')}` })
          if (ls[0]) {
            L2.push(`${pad(ind)}if player picks ${q(e.label || '?')}:`)
            if (byId[ls[0].to]) L2.push(...chain(ls[0].to, ind + 1))
            else L2.push(`${pad(ind + 1)}⚠ deleted part (id ${ls[0].to})`)
          } else L2.push(`${pad(ind)}# (option ${q(e.label || '?')} unwired — the chain stops if chosen)`)
        }
        cur = null
      } else if (k === 'for' || k === 'foreach') {
        const src = feed(cur).find((l) => l.toPort === (k === 'for' ? '__to__' : '__arr__'))
        L2.push(
          pad(ind) +
          (k === 'for'
            ? `for i:int up to ${src ? wire(src) : '?'}:  # ${labels[cur]}`
            : `for item:${n.itemType || '?'} (+index) in ${src ? wire(src) : '?'}:  # ${labels[cur]}`),
        )
        const body = take('out') // the loop's iter port
        if (body) {
          if (byId[body.to]) L2.push(...chain(body.to, ind + 1))
          else L2.push(`${pad(ind + 1)}⚠ deleted part (id ${body.to})`)
        } else L2.push(`${pad(ind)}# (body unwired — the loop runs empty)`)
        const end = take('end')
        if (end) cur = step(end)
        else { L2.push(`${pad(ind)}# (end unwired — after the loop the chain stops here)`); cur = null }
      } else {
        L2.push(headLine(n, ind), ...wires(n, ind))
        if (k === 'exit' || k === 'exitinst') cur = null // doors end their chain
        else if (k === 'enter') cur = step(take('out'))
        else if (k === 'graph') cur = step(take('return'))
        else cur = step(take(null)) // machines exit by name; everything linear by 'out'
      }
    }
    return L2
  }

  L.push(`${heading}${g.name ? ` ${q(g.name)}` : ''}${parentNote ? ` — ${parentNote}` : ''}`)
  const doors = nodes.filter((n) => n.kind === 'enter')
  let starts
  if ((g.mode === 'machine' || g.mode === 'func') && doors.length) starts = doors.map((d) => d.id)
  else if (g.entry && byId[g.entry]) starts = [g.entry]
  else {
    const roots = nodes.filter((n) => n.kind !== 'text' && n.kind !== 'todo' && !kindMeta(n).dataOnly && !flows.some((l) => l.to === n.id))
    starts = (roots.length ? roots : nodes.filter((n) => n.kind !== 'text' && n.kind !== 'todo' && !kindMeta(n).dataOnly)).map((n) => n.id)
  }
  for (let i = 0; i < starts.length; i++) {
    if (i) L.push(`# a second chain runs alongside the one above:`)
    L.push(...chain(starts[i], 0))
  }
  while (extra.length) {
    const x = extra.shift()
    if (visited.has(x.id)) continue
    L.push(`# ⚠ parallel chain — ${x.why}: starts at ${labels[x.id]}`)
    L.push(...chain(x.id, 0))
  }

  const side = nodes.filter((n) => sideKind(n) && !visited.has(n.id))
  if (side.length) {
    L.push('')
    L.push('# values, notes & frames — not in any chain; their ⇡ values reach parts through the ⇣ # lines above')
    for (const n of side) L.push(headLine(n, 0), ...wires(n, 0))
  }

  const missed = nodes.filter((n) => !visited.has(n.id) && !sideKind(n))
  const dang = datas.filter((l) => !byId[l.to])
  if (missed.length || dang.length) {
    L.push('')
    L.push('# ⚠ could not be placed in a chain')
    for (const n of missed) L.push(`⚠ ${headLine(n, 0)} — not reached by any chain start`)
    for (const l of dang) L.push(`⚠ data wire ${wire(l)} goes to a deleted part (id ${l.to})`)
  }
  return L
}

export function exportForLLM(doc) {
  const out = []
  const used = new Set()
  const collect = (g) => {
    for (const n of g.nodes || []) {
      used.add(n.kind)
      if (n.graph) collect(n.graph)
    }
  }
  collect(doc.design)
  for (const f of doc.funcs || []) collect(f.graph || { nodes: [] })

  out.push(`# Game design brief — ${doc.name || 'Untitled Design'}`)
  out.push(
    'Exported from loopdoc-composer as a plain-text reading of a node-graph design.',
    'Two canvases exist: FLOW graphs (control flow, one token walking the chain) and',
    'MACHINES (chain execution: ENTER/EXIT doors frame the chain, wires carry it forward,',
    'data wires ⇣/⇡ carry typed values between parts). A token moves',
    'one hop per step; ENTER doors start machine chains; flow graphs run from their entry.',
    'Each graph is written as a program: parts appear in the order their chain runs,',
    'and if/else, counted & array loops, and player choices are indented blocks —',
    'structure by containment, not by tracing arrows. A part’s indented # lines',
    'name the typed values its ⇣ inputs receive (# ⇣ port ← SOURCE.part :type).',
    '⚠ lines mark flow the document leaves open or wires into deleted parts —',
    'never assume past one; parts never reached by a chain are listed under ⚠.',
    '',
  )

  if (doc.notes?.business || doc.notes?.mood) {
    out.push('## Notes')
    if (doc.notes.business) out.push(`business: ${doc.notes.business}`)
    if (doc.notes.mood) out.push(`mood: ${doc.notes.mood}`)
    out.push('')
  }

  if ((doc.types || []).length) {
    out.push('## Data types')
    for (const t of doc.types)
      out.push(`- ${t.name || '(unnamed)'} { ${(t.fields || []).map((f) => `${f.name || '?'}: ${f.typeId || '?'}`).join(', ')} }`)
    out.push('')
  }

  if ((doc.vars || []).length) {
    out.push('## Globals — ⚙ named values shared by every graph & machine (live session state)')
    for (const v of doc.vars) out.push(`- ${v.name || '?'}:${v.type || 'int'} = ${v.value ?? ''}`)
    out.push('')
  }

  if ((doc.funcs || []).length) {
    out.push('## Defined functions — ƒ isolated bodies a FUNC part calls by name')
    for (const f of doc.funcs) {
      out.push(`- ${f.name || '(unnamed)'} · ${(f.graph?.nodes || []).length} parts${f.note ? ` — ${f.note}` : ''}`)
      out.push(...graphSection(f.graph || { mode: 'func', nodes: [], links: [] }, doc, '### ƒ', ''))
      out.push('')
    }
    out.push('')
  }

  if ((doc.assets || []).length) {
    out.push('## Assets')
    for (const a of doc.assets) {
      out.push(`- ${assetIcon(a.kind)} ${a.name || '(unnamed)'} (${a.kind})${a.note ? ` — ${a.note}` : ''}`)
      for (const f of a.api || [])
        out.push(
          `    fn ${f.name || '?'}( ${(f.inputs || []).map((v) => `${v.name || '?'}:${v.type || '?'}`).join(', ')}) ⇡ ${
            (f.outputs || []).map((v) => `${v.name || '?'}:${v.type || '?'}`).join(', ') || 'void'
          }${f.desc ? ` — ${f.desc}` : ''}`,
        )
    }
    out.push('')
  }

  out.push('## Graphs')
  const walkGraph = (g, depth, note) => {
    out.push(...graphSection(g, doc, `${'#'.repeat(3 + depth)} ${g.mode === 'machine' ? 'Machine' : 'Flow Graph'}`, note))
    out.push('')
    for (const n of g.nodes || [])
      if (n.graph)
        walkGraph(n.graph, depth + 1, `inside ${kindMeta(n).label} ${q(n.name || '')}`.trim())
  }
  walkGraph(doc.design, 0)

  out.push('## Part reference — kinds used in this document')
  for (const k of [...used].sort()) {
    const m = kindMeta({ kind: k })
    out.push(`- ${m.label || k} — ${m.hint || ''}`)
  }
  out.push('')
  out.push('(end of brief — lossless source of this design is the .json export of the same document.)')
  return out.join('\n')
}
