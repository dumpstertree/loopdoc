// LLM export — flattens the whole document into one self-contained plain-text
// brief written FOR a language model to read and build a game from: named
// things by name, nesting as indented sections, wiring as arrow lines, and a
// part reference for every kind used so the vocabulary explains itself.
// Not re-importable — this is the communication artifact; the .json is the
// lossless one.
import { kindMeta, dataPorts, assetIcon, assetLabel, resolveCall, typedValue } from './model.js'

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
      return `nested machine — ${n.graph?.nodes?.length || 0} parts (section below; its ⇣ inputs feed the machine's ENTER doors)`
    case 'getg':
      return `reads ⚙ ${n.gName || '?'} (${n.gType || '?'})`
    case 'setg':
      return `writes ⇣ value into ⚙ ${n.gName || '?'}`
    case 'pool':
      return fed('__in__') ? `fed window ⇣ in — reads AND writes its origin value` : `number bucket = ${n.init ?? 0}`
    case 'drain':
      return 'chain passes: subtracts its amount from every upstream pool (⇣ in:int dictates)'
    case 'add':
      return 'chain passes: adds its amount to every upstream pool (negative subtracts)'
    case 'delay':
      return `⏳ holds ${n.delay ?? 3} steps`
    case 'queue':
      return `releases at most ×${n.rate ?? 1} per step`
    case 'register':
      return `pulses 1 every ${n.countTo ?? 2} counted`
    case 'converter':
    case 'gate':
    case 'randgate':
    case 'trader':
      // no per-node config — their semantics live in the Part reference below
      return ''
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
    case 'action':
      return 'chain waits here for a click, then consumes from input pools'
    case 'exit':
      return 'kills the token; appears as this machine’s output port in the parent'
    case 'enter': {
      const parts = [
        ...(n.vars || []).map((v) => `${v.name || 'var'}:${v.type || 'int'}${String(v.value ?? '') ? ` = ${v.value}` : ''}`),
        ...(n.assets || []).map((a) => `📦 ${a.name || 'unpicked'}`),
      ]
      return `the machine’s door — always starts chains${parts.length ? ` · vars: ${parts.join(' · ')}` : ''}`
    }
    case 'source':
      return 'legacy chain entry — re-fires when its chain ends'
    case 'text':
      return `annotation frame — labels whatever sits inside it`
    case 'todo':
      return (n.todos || []).length
        ? `checklist: ${(n.todos || []).map((t) => `${t.done ? '[x]' : '[ ]'} ${t.text || '…'}`).join(' · ')}`
        : 'checklist — empty'
    default:
      return '' // note rides its own suffix below
  }
}

function graphSection(g, doc, heading, parentNote) {
  const L = []
  const labels = makeLabels(g)
  const flows = (g.links || []).filter((l) => l.kind !== 'data')
  const datas = (g.links || []).filter((l) => l.kind === 'data')
  const portName = (node, id, dir) => {
    const dp = dataPorts(node, doc.assets)
    const p = (dp[dir] || []).find((x) => x.id === id)
    return p ? p.name || id : id
  }
  L.push(`${heading}${g.name ? ` ${q(g.name)}` : ''}${parentNote ? ` — ${parentNote}` : ''}`)
  if (g.mode !== 'machine' && g.entry && labels[g.entry]) L.push(`  entry: ${labels[g.entry]}`)
  for (const n of g.nodes || []) {
    const meta = kindMeta(n)
    const d = detail(n, g, doc)
    L.push(`  - ${labels[n.id]}${d ? `: ${d}` : ''}${n.note && n.kind !== 'text' ? ` (note: ${q(n.note)})` : ''}`)
    for (const l of flows.filter((x) => x.from === n.id)) {
      const t = (g.nodes || []).find((x) => x.id === l.to)
      if (!t) continue
      const port = (meta.ports && meta.ports(n)) || []
      const p = port.find((x) => x.id === l.fromPort)
      const amt = g.mode === 'machine' && l.amount !== 1 ? ` ×${l.amount}` : ''
      L.push(`      ${(p && p.label ? p.label + '→' : '→')} ${labels[l.to]}${amt}`)
    }
    for (const l of datas.filter((x) => x.to === n.id)) {
      const s = (g.nodes || []).find((x) => x.id === l.from)
      if (!s) continue
      const out = dataPorts(s, doc.assets).out.find((x) => x.id === l.fromPort)
      const t = out?.type ? ` :${out.type}` : ''
      L.push(`      ⇣ ${portName(n, l.toPort, 'in')} ← ${labels[l.from]}.${out?.name || l.fromPort}${t}`)
    }
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

  out.push(`# Game design brief — ${doc.name || 'Untitled Design'}`)
  out.push(
    'Exported from loopdoc-composer as a plain-text reading of a node-graph design.',
    'Two canvases exist: FLOW graphs (control flow, one token walking the chain) and',
    'MACHINES (economy chains: POOLS hold numbers, wires carry flow passes, DRAIN/ADD',
    'move pool amounts, data wires ⇣/⇡ carry typed values between parts). A token moves',
    'one hop per step; ENTER doors start machine chains; flow graphs run from their entry.',
    'Reading a list: each part is a line; its indented lines are where its flow goes',
    '(→) and where its typed inputs get their value (⇣ ← source).',
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
