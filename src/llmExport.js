// LLM export — flattens the whole document into one self-contained plain-text
// brief written FOR a language model to read and build a game from: every graph
// the design states gets a section of its own, written as a table of statements
// in the design's own code shape (one entry per part, a part declared exactly
// once, the entry for the next hop written one indent deeper so the indentation
// IS the chain's step, { braces } carrying what a part does — its own logic as
// code, a CODE part's script — and one slot notation covering wired values,
// values typed on a card and inputs nothing feeds). A machine, a sub-graph and
// an ƒ are different things the design is made of, so each gets its own section
// under its own heading rather than riding inside the braces of its call site;
// the sections are ordered so that everything a section calls is stated above
// it — ƒs first, then machines, then graphs — and a call site only names the
// handle whose parts are already on the page.
// The part reference for the kinds actually used is read BEFORE the tables are,
// so the vocabulary exists by the time the first chain does. Art assets are
// a legacy feature: the brief never mentions them. Content the design never
// reaches (unchained parts, dead values) is culled quietly rather than flagged.
// A Curio mapping closes the brief in three levels: the engine's own primitives,
// then how this design's canvases become them, then how each part does — so the
// model builds the game instead of guessing which Curio construct a part means.
// Not re-importable — this is the communication artifact, written so it stands
// alone: the model building from it is never handed the .json, so every handle
// the brief uses has to resolve inside the brief itself.
import { kindMeta, dataPorts, assetIcon, assetLabel, resolveCall, typedValue, MATH } from './model.js'
import { validateCode } from './codeLang.js'

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
    if (!r) return '⚠ no system fn picked'
    const ins = (r.fn.inputs || []).map((v) => `${v.name || '?'}:${v.type || '?'}`).join(', ')
    const outs = (r.fn.outputs || []).map((v) => `${v.name || '?'}:${v.type || '?'}`)
    return `${r.asset.name || 'system'}.${r.fn.name || '?'}(${ins})${outs.length ? ` ⇡ ${outs.join(', ')}` : ''}`
  }
  const fed = (port) => (g.links || []).some((l) => l.kind === 'data' && l.to === n.id && l.toPort === port)
  switch (n.kind) {
    case 'event':
      return (n.calls || []).map(callStr).map((c) => `calls ${c}`).join(' · ')
    case 'syscall':
      return `calls ${(n.calls || []).map(callStr).join(', ')}`
    case 'load':
      return `puts ${assetLabel(n.asset, A)} into memory`
    case 'unload':
      return `removes ${assetLabel(n.asset, A)} from memory`
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
      return 'flow graph the design nests inside another — its own parts are stated in their own section above it, and its RETURN leads back out here'
    case 'machine':
      return 'machine — its own parts are stated in their own section above it, and its ENTER/EXIT doors frame that section’s chain'
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
    case 'code': {
      const io = (arr) => (arr || []).map((v) => `${v.name || 'value'}:${v.type || 'int'}`)
      if (!String(n.code || '').trim()) return 'no script written yet — its ports stay'
      const ins = io(n.inVars)
      const outs = io(n.outVars)
      return `${n.lang || 'python'} script:${
        ins.length ? ` ⇣ ${ins.join(', ')} in` : ' no ⇣ inputs'
      }${outs.length ? ` · ⇡ ${outs.join(', ')} out` : ' · no ⇡ outputs'}`
    }
    case 'exit': {
      const parts = (n.vars || []).map((v) => `${v.name || 'var'}:${v.type || 'int'}`)
      if (g?.mode === 'func')
        return `returns from this ƒ here${parts.length ? ` · publishes ${parts.join(' · ')} as the ƒ’s ⇡ values` : ''}`
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
    case 'getledger': {
      const sys = (doc?.assets || []).find((a) => a.id === n.lRef)
      return `reads system ledger ${sys?.name || '⚠ no system picked'}.${n.lName || '?'}${n.lType ? ` (${n.lType})` : ''}`
    }
    case 'setledger': {
      const sys = (doc?.assets || []).find((a) => a.id === n.lRef)
      return `writes ⇣ value into system ledger ${sys?.name || '⚠ no system picked'}.${n.lName || '?'}`
    }
    case 'enter': {
      const parts = (n.vars || []).map((v) => `${v.name || 'var'}:${v.type || 'int'}${String(v.value ?? '') ? ` = ${v.value}` : ''}`)
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
      if (f) return `ƒ ${f.name || '(unnamed)'} — its body is stated in its own section above${f.note ? ` (${f.note})` : ''}`
      return n.func ? 'ƒ ⚠ picks a function that was deleted' : 'ƒ — no function picked yet'
    }
    default:
      return '' // note rides its own suffix below
  }
}

// lower one graph as a TABLE OF STATEMENTS, in the design's own code shape: one
// entry per part, stepped in the order its chain actually runs, and each hop
// written one indent deeper than the part that runs it — so the chain's order
// IS the indentation, and { braces } carry what a part's own operation is: a
// CODE part's script verbatim inside them, and the part's own logic written as
// code where the design has one (result=a+b, if a==b / else, for x in arr). A
// machine's or sub-graph's parts are NOT inside the braces of its call site:
// every graph the design states gets its own section under its own heading, and
// the sections are ordered so that a machine, a sub-graph or an ƒ is always
// written before the section that calls it — functionality that is written
// inside other functionality reads as one nesting tree, but a machine, a ƒ and
// a graph are different things the design is made of, and one nesting tree
// means a call site has to hold a name until the parts behind it appear below
// it. Section order removes that: by the time a call site names a handle, the
// parts behind it are already above it on the page. Nothing restates a part:
// the header line carries its handle, its ⇣ slots and its ⇡ slots, and the
// braces carry its operation. A slot is one notation for the three ways an
// input gets a value (type:name ~ SOURCE.part wired, type:name ~ value the
// design typed on a card, type:name alone when nothing wires it), which
// replaces the separate wire, card and call-gap lines a program form needs.
// Where the chain goes on rides at the end of the closing brace as
// [ PORT:slug ] — PORT is the name the design gives that exit (an IF arm, a
// machine's EXIT door, a CHOICE option, a loop's iter/end), left out for the
// plain out port, so a part with several successors names them where it is
// declared rather than in a block below. Those are alternatives, so they carry
// no ⚠: only two flow wires leaving the SAME port do, because those really do
// enqueue two events at once, and that second run prints at the end of the run
// above it. A part that names no successor has an arm or body the design left
// unwired — it does nothing, as an unwired branch does in code, so absence is
// carried by the shape and never flagged. The stair is stepped in walk order,
// not an order of the data, so a cycle is one hop back to a name declared above
// — no goto, and a loop-carried value simply reads a part printed further down.
// Value producers that join no chain ride ABOVE the chains that read them, so
// the stated-before-used rule keeps holding inside a section. Parts reached by
// nothing, and values that feed nothing, are dropped — the keep rule still
// grows from the chains until nothing new feeds it, because a value producer a
// live wire reads has to be declared or that wire would name a part the section
// never printed. refs collects the machines, sub-graphs and ƒs the parts this
// section prints call, so the caller can state them before it states this one
function graphBody(g, doc, slugs, kindsUsed, calledFuncs, refs) {
  const L = [] // the section's chains, printed after the value producers they read
  const labels = makeLabels(g)
  const nodes = g.nodes || []
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const flows = (g.links || []).filter((l) => l.kind !== 'data')
  const datas = (g.links || []).filter((l) => l.kind === 'data')
  const pad = (i) => '  '.repeat(i)
  const top = 0 // every graph is a section of its own now, so its chains open at the fence
  // a machine/ƒ section's doors frame it even when no chain walks them: ENTER
  // starts the table and every EXIT is a label the parent's [ ] list prints,
  // so their kinds belong to the vocabulary the brief opens with
  if (g.mode === 'machine' || g.mode === 'func')
    for (const n of nodes) if (n.kind === 'enter' || n.kind === 'exit') kindsUsed.add(n.kind)
  const ports = (n) => dataPorts(n, doc.assets, doc.funcs || [], g)
  // the name a port wears in a slot or a [ ] list: the name the design gives it,
  // or the EXIT door it belongs to (numbered when that door declares several) —
  // a synthetic port id the reader could not resolve inside the brief is never
  // worth printing
  const portHandle = (node, id, dir) => {
    const ps = ports(node)[dir] || []
    const p = ps.find((x) => x.id === id)
    if (!p) return id
    const nm = (p.name || '').trim()
    if (nm && !/^(var|field)$/.test(nm)) return nm
    // an unnamed ⇡ on a named EXIT: name it by the door it leaves through,
    // numbered when that door declares several — a synthetic port id the
    // reader cannot resolve anywhere inside the brief is never worth printing
    const exit = (p.exit || '').trim()
    if (!exit) return id
    const same = ps.filter((x) => (x.exit || '').trim() === exit)
    if (same.length === 1) return exit
    return `${exit}${same.findIndex((x) => x.id === id) + 1}`
  }
  // the source side of a data wire names only the part and the port it leaves
  // through: the slot it fills already says what type lands in it
  const wire = (l) => {
    const s = byId[l.from]
    if (!s) return `⚠ deleted part (id ${l.from})`
    return `${slugs[l.from] || labels[l.from]}.${portHandle(s, l.fromPort, 'out')}`
  }
  const outFlow = (id, port) => flows.filter((l) => l.from === id && (port == null || l.fromPort === port))
  const feed = (id) => datas.filter((l) => l.to === id)
  // one slot for one port. type:name normally; name :type when the type itself
  // carries a colon (a system ledger type, InputEngine:Input) — otherwise the
  // slot would read with two colons and the reader could not tell which
  const slot = (p, nm, extra) =>
    `${(p.type || '').includes(':') ? `${nm} :${p.type}` : `${p.type || '?'}:${nm}`}${extra}`
  // ⇣ slots: wired ~ SOURCE.part, a value the design typed on the card ~ value,
  // or the bare slot when the design feeds nothing — all three wear the same
  // ~ because the design itself calls a card value a custom value of that port
  const inSlots = (n) =>
    (ports(n).in || []).map((p) => {
      const nm = portHandle(n, p.id, 'in')
      const l = feed(n.id).find((x) => x.toPort === p.id)
      if (l) return slot(p, nm, ` ~ ${wire(l)}`)
      const card = MATH[n.kind] ? (p.id === '__a__' ? n.aVal : p.id === '__b__' ? n.bVal : undefined) : undefined
      if (card !== undefined && String(card).trim() !== '') return slot(p, nm, ` ~ ${String(card).trim()}`)
      return slot(p, nm, '')
    })
  const outSlots = (n) =>
    (ports(n).out || []).map((p) => {
      const nm = portHandle(n, p.id, 'out')
      const door = (p.exit || '').trim()
      return slot(p, nm, door && door !== nm ? ` @ ${q(door)}` : '')
    })
  // what the part does, as code where the design's own operation has a code
  // form: an equation for math, if/else for a test, a loop header for a loop,
  // the typed values a door declares. Kinds whose operation is an engine
  // statement (ledger, inspect, an annotation frame) keep the design's words.
  const pnameOf = (n, p, dir) => portHandle(n, p.id, dir)
  const op = (n) => {
    const P = ports(n)
    switch (n.kind) {
      case 'add':
      case 'sub':
      case 'mul':
      case 'div':
      case 'mod': {
        const a = (P.in || []).find((p) => p.id === '__a__')
        const b = (P.in || []).find((p) => p.id === '__b__')
        const o = (P.out || [])[0]
        if (a && b && o) return [`${pnameOf(n, o, 'out')}=${pnameOf(n, a, 'in')}${MATH[n.kind]}${pnameOf(n, b, 'in')}`]
        return [`⇡ = ⇣ a ${MATH[n.kind]} ⇣ b`]
      }
      case 'ifb': {
        const a = (P.in || []).find((p) => p.id === '__a__')
        const b = (P.in || []).find((p) => p.id === '__b__')
        return [`if ${a ? pnameOf(n, a, 'in') : 'a'}${n.op || '=='}${b ? pnameOf(n, b, 'in') : 'b'} [TRUE]`, 'else [FALSE]']
      }
      case 'condition':
        return [n.cond ? `if ${n.cond} [TRUE]` : 'if its ⇣ operands [TRUE]', 'else [FALSE]']
      case 'for': {
        const i = (P.out || []).find((p) => (p.name || '') === 'i' || p.id === 'i')
        const to = (P.in || []).find((p) => /to|count|n/.test(p.name || p.id || ''))
        return [`${i ? `for ${pnameOf(n, i, 'out')} = 1 .. ${to ? pnameOf(n, to, 'in') : '⇣to'}` : 'for ⇣to times'} [iter]`, 'end the loop [end]']
      }
      case 'foreach': {
        const items = (P.out || []).map((p) => pnameOf(n, p, 'out'))
        const arr = (P.in || []).find((p) => /arr|list|items/.test(p.name || p.id || ''))
        return [`${items.length ? `for ${items.join(', ')} in ${arr ? pnameOf(n, arr, 'in') : '⇣arr'}` : 'for each ⇣arr'} [iter]`, 'end the loop [end]']
      }
      case 'enter': {
        const v = (n.vars || []).filter((x) => String(x.value ?? '') !== '')
        return v.map((x) => `${x.name || 'var'} = ${x.value}`)
      }
      case 'exit':
      case 'exitinst': {
        if (n.kind === 'exit') {
          const v = (n.vars || []).filter((x) => String(x.value ?? '') !== '')
          return v.map((x) => `${x.name || 'var'} = ${x.value}`)
        }
        const t = (g?.nodes || []).find((x) => x.kind === 'exit' && x.id === n.exitRef)
        if (!t) return [n.exitRef ? '⚠ routes to an EXIT that no longer exists — re-pick' : 'no EXIT picked yet']
        return [`leave by the door ${q(t.name || 'exit')}`]
      }
      case 'step':
        return [] // its operation is the chain it steps on below it
      case 'machine':
      case 'graph': {
        if (!(n.graph || {}).nodes || !(n.graph || {}).nodes.length)
          return ['no parts written yet — its ports stay'] // nothing to state as a section
        return [
          `${slugs[n.id] || labels[n.id]} — its own parts are stated in the section for it above${
            n.kind === 'graph' ? ', its RETURN leads back out here' : ''}`,
        ]
      }
      case 'code':
        return String(n.code || '').trim() ? [] : ['no script written yet — its ports stay']
      default: {
        const d = detail(n, g, doc)
        return d ? [d] : []
      }
    }
  }
  // the part's header: KIND · handle · its ⇣ slots · its ⇡ slots, then the brace
  // that opens whatever its operation is; the handle is the slug the slots and
  // the [ ] lists use, and the design's own name rides beside it when it has one
  const head = (n, ind) => {
    const note = n.note && n.kind !== 'text' ? ` (note: ${q(n.note)})` : ''
    const named = (n.kind === 'machine' || n.kind === 'graph' ? (n.graph || {}).name : n.name) || ''
    const s = slugs[n.id] || labels[n.id]
    const ins = inSlots(n)
    const gets = outSlots(n)
    const lang = n.kind === 'code' && String(n.code || '').trim() ? ` ${(n.lang || 'python')} script` : ''
    return `${pad(ind)}${KIND(n)}: ${s}${named ? ` ${q(named)}` : ''}${note}${ins.length ? ` ( ${ins.join(', ')} )` : ''}${gets.length ? ` -> ( ${gets.join(', ')} )` : ''}${lang} {`
  }
  // where the chain goes on: [ PORT:slug ], PORT named by what the design calls
  // that exit (an IF arm, a machine's EXIT door, a CHOICE option, a loop's
  // iter/end), left out for the plain out port — the names here are the names
  // the parts stepped under the part are run as
  const portName = (n, port) => {
    if (port == null) return ''
    // a loop’s body port is id out but the design calls it iter — the name is
    // what tells the reader which run repeats and which one is after the loop
    if (n.kind === 'for' || n.kind === 'foreach') return port === 'out' ? 'iter' : port
    if (port === 'out' || port === '') return ''
    if (n.kind === 'machine' || n.kind === 'graph') {
      const e = ((n.graph || {}).nodes || []).find((x) => x.id === port)
      if (e) return q(e.name || 'exit')
    }
    if (n.kind === 'choice') {
      const e = (n.exits || []).find((x) => x.id === port)
      if (e) return q(e.label || '?')
    }
    if (n.kind === 'ifb' || n.kind === 'condition') return (port || '').toUpperCase()
    return port
  }
  const succName = (n, l) => {
    const nm2 = portName(n, l.fromPort)
    const dest = byId[l.to] ? slugs[l.to] || labels[l.to] : `id ${l.to}`
    return `${nm2 ? `${nm2}:` : ''}${dest}`
  }
  // a CODE part carries a script the design wrote itself: print it verbatim, so
  // its indentation stays relative and the brief never restates what the code
  // already says; blank lines stay blank so nothing outside a fence swallows
  // them. The braces around it are the part's own, so its script reads exactly
  // as the design wrote it, at the indent the part sits at
  const script = (n, ind) => {
    const raw = String(n.code || '').replace(/\r\n?/g, '\n').split('\n')
    while (raw.length && !raw[0].trim()) raw.shift()
    while (raw.length && !raw[raw.length - 1].trim()) raw.pop()
    const out = []
    for (const l of raw) out.push(l.trim() ? `${pad(ind)}${l.replace(/\t/g, '  ').replace(/\s+$/, '')}` : '')
    if (String(n.code || '').trim()) {
      const v = validateCode(String(n.code), n.lang || 'python', { outputs: n.outVars || [] })
      // a script the validator calls broken is a fact about the design, not an
      // open point: the app checked it, and this is the only place the reader
      // can learn the logic as written is broken
      for (const e of [...v.errors, ...v.warnings]) out.push(`${pad(ind)}⚠ its script does not validate at line ${e.line}: ${e.message}`)
    }
    return out
  }
  // a machine's or sub-graph's own parts belong to a section of their own, so all
  // this section has to remember is that it calls into it: the caller states that
  // section before it states this one, and the call site's own braces carry the
  // handle plus the values it passes
  const ownGraph = (n) =>
    n.graph && (n.kind === 'machine' || n.kind === 'graph') && (n.graph.nodes || []).length ? n : null

  const visited = new Set()

  // one run of a chain: the part's statement, then its successor one indent
  // deeper — the design's chain steps read as nested statements, which is why
  // the stair's order is the chain's order and a part never needs a second entry
  // where its chain comes back to it. The first wire on a port continues this
  // run; another wire on the SAME port is a second event enqueued at once, which
  // is the only real double enqueue, and is marked ⚠ and printed at the end of
  // this run. Wires on different ports are alternatives (an arm, a door, an
  // option) and carry no ⚠
  const chain = (id, ind) => {
    const pend = [] // this run's extra flow wires: named in the part's list, run after this one
    let cur = id
    let at = ind // the stair: every hop of this run sits one indent deeper
    while (cur) {
      const n = byId[cur]
      if (!n) {
        L.push(`${pad(at)}⚠ flow enters a deleted part (id ${cur})`)
        break
      }
      if (visited.has(cur)) {
        // the stair is stepped in walk order, so a hop back is a name already
        // declared above: it needs no second entry, and nothing is undecided
        L.push(`${pad(at)}# → ${slugs[cur] || labels[cur]} — this chain returns to a part declared above; the block above is its only entry`)
        break
      }
      visited.add(cur)
      kindsUsed.add(n.kind)
      // a FUNC part only earns its ƒ if it was actually written out, not merely
      // present in the graph — a call site nothing reaches calls nothing
      if (n.kind === 'func') {
        calledFuncs.add(n.func)
        refs.funcs.add(n.func)
      }

      const pname = slugs[cur] || labels[cur]
      const first = {}
      const fan = []
      const outs = outFlow(cur, null)
      for (const l of outs) {
        if (first[l.fromPort]) fan.push(l)
        else first[l.fromPort] = l
      }
      // the part's statement: header, its operation, then the brace that closes
      // it with the [ ] list of its successors — a machine or sub-graph names
      // itself inside its braces and asks nothing of the reader, because its
      // parts are in the section above this one
      L.push(head(n, at))
      if (n.kind === 'code' && String(n.code || '').trim()) L.push(...script(n, at + 1))
      else L.push(...op(n).map((l) => `${pad(at + 1)}${l}`))
      if (ownGraph(n)) refs.nodes.add(cur)
      const ss = outs.map((l) => succName(n, l))
      L.push(`${pad(at)}}${ss.length ? ` [ ${ss.join(', ')} ]` : ''}`)

      // which of a part's flow ports open a block under it, and which continue
      // at the next indent: an arm, a door and an option are blocks; a loop's
      // body is a block and its end continues; everything else is linear
      const portsOut = Object.keys(first)
      const branchPorts =
        n.kind === 'choice' ? (n.exits || []).map((e) => e.id)
        : n.kind === 'condition' || n.kind === 'ifb' ? ['true', 'false']
        : n.kind === 'machine' || n.kind === 'graph' ? portsOut // a machine's flow ports ARE its EXIT doors
        : n.kind === 'for' || n.kind === 'foreach' ? ['out'] // iter = body; end continues below
        : portsOut.length > 1 ? portsOut // more than one port = the part really does branch
        : []
      const blocks = branchPorts.filter((p) => first[p])
      for (const p of blocks) {
        const l = first[p]
        if (byId[l.to]) chain(l.to, at + 1)
        else L.push(`${pad(at + 1)}⚠ flow enters a deleted part (id ${l.to})`)
      }
      const isDoor = n.kind === 'exit' || n.kind === 'exitinst' // doors end their chain
      const rest = isDoor ? [] : portsOut.filter((p) => !blocks.includes(p))
      if (rest.length > 1) {
        for (const p of rest) chain(first[p].to, at + 1)
        cur = null
      } else if (rest.length === 1) {
        const l = first[rest[0]]
        if (byId[l.to]) {
          cur = l.to
          at += 1
        } else {
          L.push(`${pad(at)}⚠ flow enters a deleted part (id ${l.to})`)
          cur = null
        }
      } else cur = null
      // the second wire on the port this part already runs: both events are
      // enqueued, so the second run belongs at the end of this one
      for (const l of fan)
        pend.push({
          to: l.to,
          ind: at,
          why: `⚠ a second flow wire leaves ${pname} on its ${portName(n, l.fromPort) || l.fromPort} port — both get enqueued`,
        })
    }
    for (const p of pend) {
      L.push(`${pad(p.ind)}${p.why}`)
      if (byId[p.to]) chain(p.to, p.ind)
      else L.push(`${pad(p.ind)}⚠ flow enters a deleted part (id ${p.to})`)
    }
  }

  // the section's heading and ``` fence are printed by the caller, which knows
  // which graph this is and where it sits in the brief's section order

  const doors = nodes.filter((n) => n.kind === 'enter')
  let starts
  if ((g.mode === 'machine' || g.mode === 'func') && doors.length) starts = doors.map((d) => d.id)
  else if (g.entry && byId[g.entry]) starts = [g.entry]
  else {
    const roots = nodes.filter((n) => n.kind !== 'text' && n.kind !== 'todo' && !kindMeta(n).dataOnly && !flows.some((l) => l.to === n.id))
    starts = (roots.length ? roots : nodes.filter((n) => n.kind !== 'text' && n.kind !== 'todo' && !kindMeta(n).dataOnly)).map((n) => n.id)
  }
  for (let i = 0; i < starts.length; i++) {
    if (i) L.push(`${pad(top)}# a second chain runs alongside the one above:`)
    chain(starts[i], top)
  }

  // a part that joins no chain still belongs to the brief if its ⇡ value feeds
  // something that does — so the set of kept parts grows from the table until
  // nothing new feeds it; anything left over (an unchained part nothing reads,
  // a value nothing consumes) is content this design does not use, and is
  // dropped. Annotation frames and checklists ride always: they carry intent,
  // not logic
  const kept = new Set(visited)
  const feeds = (n) => datas.some((l) => l.from === n.id && kept.has(l.to))
  let grew = true
  while (grew) {
    grew = false
    for (const n of nodes) {
      if (visited.has(n.id) || kept.has(n.id)) continue
      if (n.kind === 'text' || n.kind === 'todo' || feeds(n)) {
        kept.add(n.id)
        grew = true
      }
    }
  }
  // the keep rule is not restricted to data-only kinds: a part that joins no
  // chain but hands a value to one that does must be declared, or the slot that
  // reads it would point at a part the table never printed
  const side = nodes.filter((n) => !visited.has(n.id) && kept.has(n.id))
  const pre = []
  if (side.length) {
    const rest = side.slice()
    while (rest.length) {
      const n = rest.find((x) => !rest.some((y) => y !== x && datas.some((l) => l.from === y.id && l.to === x.id))) || rest[0]
      rest.splice(rest.indexOf(n), 1)
      if (ownGraph(n)) refs.nodes.add(n.id)
      if (n.kind === 'func' && n.func) refs.funcs.add(n.func)
      kindsUsed.add(n.kind)
      if (!pre.length) pre.push(`${pad(top)}# declared here, reached by no chain — the chains below read their ⇡ values`)
      pre.push(head(n, top))
      if (n.kind === 'code' && String(n.code || '').trim()) pre.push(...script(n, top + 1))
      else pre.push(...op(n).map((l) => `${pad(top + 1)}${l}`))
      pre.push(`${pad(top)}}`)
    }
  }

  const dang = datas.filter((l) => !byId[l.to])
  const tail = []
  if (dang.length) {
    tail.push(`${pad(top)}⚠ wires into deleted parts`)
    for (const l of dang) tail.push(`${pad(top)}⚠ data wire ${wire(l)} goes to a deleted part (id ${l.to})`)
  }
  return [...(pre.length ? [...pre, ''] : []), ...L, ...(tail.length ? ['', ...tail] : [])]
}
const CURIO_HEAD = [
  '## Curio features — the engine primitives a built game is made of',
  'Handles in the brief are slugs; each one becomes the Rust name below it,',
  '  and every name the brief uses is defined in the brief itself — nothing here',
  '  needs the design file or any other source to look up.',
  '',
]
// the engine's own vocabulary: always printed, because both mappings below are
// phrased in it
const CURIO_FEATURES = [
  '- HABIT → a recurring loop: #[habit] on a struct, run every frame while its Scope.is_enabled()',
  '  says so. enable()/disable() fire on the transitions into and out of being enabled, tick()',
  '  is the per-frame body — the graph’s whole chain, written in order. Habits belong to no object:',
  '  they live for the whole Curio, and the macro registers them, so nothing hand-hooks them.',
  '- IMPULSE → a one-shot reaction to an event: #[impulse(MyStimulant)] on a struct whose',
  '  dequeue_event(…, stimulant) runs once when a stimulant it listens for is drained. This is',
  '  where a graph’s chain lands when the design only runs on an announcement.',
  '- STIMULANT → the engine’s event type: one #[stimulant] enum whose variants are the events the',
  '  game can send, passed to SystemComponentDefaultGameplay::<MyStimulant, MyUIEvent> at startup so',
  '  every event is typed. Sent with nerve.enqueue_event(MyStimulant::V) during a frame, drained at',
  '  the START of the next frame before anything else; a stimulant that sends another keeps that',
  '  chain going before the Tick phase resumes.',
  '- SCOPE → the trait every habit and impulse carries: is_enabled() decides whether it runs,',
  '  run_on_instance() → NetworkModes::all() which multiplayer instances run it.',
  '- LEDGER → where the Curio’s state lives: ledger.read::<T>() gives a read-only Rc<T>,',
  '  ledger.write::<T>(|rec| rec.field = …) edits it. Every ⇣/⇡ value hand-off in the brief ends',
  '  here or in a facet — a built game has nowhere else to keep a value.',
  '- RECORD → one struct of that state: #[record(name = "…", ownership = RecordScope::Instance)].',
  '  Made once when the Curio is created — records are edited, never added or removed — so every',
  '  field the brief names has to exist at startup. Built-ins come free: SysRecordTime',
  '  (ledger.time().scaled_delta_time / scaled_time), SysRecordInput, SysRecordCamera, SysRecordScreen.',
  '- FACET → a property a Form is built from: #[facet] on a struct plus a FieldOverride impl',
  '  (apply/get_state) so a COMPOSITION and the editor can edit its fields by name. Builders are',
  '  fluent, Facet::builder()….build(), and a facet alone does nothing: a HABIT queries and edits it.',
  '- FORM → an object that persists in the world: context.spawner("name").position(…).facet(…).spawn();',
  '  edit_facet::<T>(|t| …)/get_facet::<T>() reach its properties, .child(…spawn()) adds parts, destroy()',
  '  ends it. The usability wrapper over the ECS world underneath.',
  '- COMPOSITION → a serialized Form hierarchy (.comp): components whose type: matches a facet struct',
  '  name, each field string fed to that facet’s FieldOverride::apply, base: inheriting another one.',
  '  Spawned with .composition(Some(comp)) — how a repeated or authored object is data, not code.',
  '- CONTEXT → the world itself: spawner() makes Forms, edit::<(&mut Transform3D, &Foe)>(|q| …) queries',
  '  them in bulk. A system fn call in the brief is one of these queries.',
  '- NERVE → the event sender every habit/impulse body is handed: enqueue_event(…) is how one part’s',
  '  return reaches the next part.',
  '',
]
const CURIO_CANVAS = [
  // k: the kinds this entry explains; empty = always part of the mapping
  {
    k: [],
    l: [
      '- FLOW → the game loop itself: one #[habit] whose Scope.is_enabled is the “keep playing” test;',
      '  its chain, written in order, is that habit’s tick(). Use enable()/disable() for the game’s',
      '  start and teardown.',
    ],
  },
  {
    k: [],
    l: [
      '- chain hop A → B → nerve.enqueue_event(MyStimulant::B): B is a STIMULANT variant and the',
      '  IMPULSE listening for it runs B’s body at the start of the next frame — that is what one',
      '  token walking one hop per step means for the engine.',
    ],
  },
  {
    k: ['machine'],
    l: [
      '- MACHINE / GRAPH → either a #[habit] (recurring: runs every frame while its',
      '  Scope is enabled) for behaviour that is always live, or a #[impulse(MyStimulant)] (one-shot:',
      '  reacts to an event) for behaviour that only runs when something announces it. The design',
      '  chooses; a machine whose doors carry ⇣/⇡ values reads as the impulse. Both self-register',
      '  by macro, and Scope.run_on_instance() → NetworkModes::all() picks which instances run them.',
    ],
  },
  {
    k: ['func'],
    l: [
      '- FUNC / ƒ → a plain Rust fn, called rather than scheduled: its parameters are the ƒ’s ⇣ inputs',
      '  and its return its ⇡ outputs, and call sites pass those args inline. No #[habit]/#[impulse],',
      '  no Scope, no registration — nothing about a ƒ touches the engine’s loop.',
    ],
  },
]
const CURIO_NODE = [
  // k: the kinds this entry explains; empty = always part of the mapping
  {
    k: ['enter'],
    l: [
      '- ENTER door + ⇣ vars → the habit’s/impulse’s inputs: fields of a #[record(ownership = RecordScope::Instance)]',
      '  written with ledger.write::<T>(|rec| …) before the enqueue, a facet field, or plain fn parameters.',
    ],
  },
  {
    k: ['exit', 'exitinst'],
    l: [
      '- named EXIT (its ⇡ announce vars) → one variant of the #[stimulant] enum, plus the records that carry',
      '  its values: the door’s return is nerve.enqueue_event(MyStimulant::door). An EXIT REF re-enqueues',
      '  that variant — the one the named EXIT already owns, never a second event minted for it.',
      '  “kills the token” = form.destroy() or stop the habit’s Scope.',
    ],
  },
  {
    k: ['getg', 'setg'],
    l: [
      '- ⚙ GLOBALS → #[record] structs made once at Curio::create() (records are edited, never added):',
      '  read with ledger.read::<T>() (a read-only Rc<T>). Built-ins are yours for free: SysRecordTime',
      '  (ledger.time().scaled_delta_time / scaled_time), SysRecordInput, SysRecordCamera, SysRecordScreen.',
    ],
  },
  {
    k: [],
    l: [
      '- DATA TYPE (Foe { hp: int, pos: Vec }) → a #[facet] struct + FieldOverride::apply/get_state when a',
      '  .comp composition must edit it; a plain struct or record field set when only code touches it.',
      '  Vec → Vector3/Vector2, int → i32, float → f32, bool → bool, Foe[] → Vec<Form> or an ECS query.',
    ],
  },
  {
    k: ['var'],
    l: [
      '- VAR “hero” → context.spawner("hero").position(…).facet(Facet::builder()….build()).spawn();',
      '  hold the Form on the habit struct, destroy() it in disable(). A VAR of ⚙/record fields is a write.',
    ],
  },
  {
    k: [],
    l: [
      '- A part’s ( ⇣ slots ) and ( ⇡ slots ) — each one  type:name ~ SOURCE.part  wired,  type:name ~ value',
      '  the design typed on the card, or  type:name  alone fed by nothing — are its value hand-offs:',
      '  read the producer’s record/facet, then write it in or pass it; the ~ side names exactly which part',
      '  hands what over or what value lands in the slot, and  @ "door"  marks the EXIT door a ⇡ value',
      '  leaves its machine through. A call site’s own slots ARE its arguments, so a ƒ’s parameters and a',
      '  machine’s door vars are filled by the same slots the parts above feed it.',
    ],
  },
  {
    k: ['action'],
    l: [
      '- ACTION (chain waits for a click) → ledger.read::<SysRecordInput>(); raw.get_button(&ButtonCode::KeyW).is_down',
      '  for physical keys, or map logical names once in InputMapping::new(…) and read',
      '  mapped[seat].get_button_or_default("paddle_up") — the seat index is the multiplayer player.',
    ],
  },
  {
    k: ['choice'],
    l: [
      '- CHOICE options → each option is an input-mapped button that gates which stimulant gets enqueued;',
      '  an option with no name in the part’s [ ] list enqueues nothing, so the game waits.',
    ],
  },
  {
    k: ['condition', 'ifb', 'and', 'or', 'for', 'foreach'],
    l: [
      '- condition / IF / AND / OR / for / foreach → plain Rust if / match / for / while in the habit or',
      '  impulse body; foreach over an array of Forms = context.edit::<(&mut Transform3D, &Foe)>(|q| for (t, f) in q { … }).',
      '  The arm or body the chain takes is stepped one indent deeper and named on the closing brace as',
      '  [ TRUE:slug ] / [ iter:slug ] / [ "door":slug ]; an option with no name in its [ ] list enqueues',
      '  nothing, and the design’s if / else pair prints inside the part’s own braces.',
    ],
  },
  {
    k: ['add', 'sub', 'mul', 'div', 'mod', 'append', 'join', 'remove', 'removeat', 'sort', 'clone', 'inspect'],
    l: [
      '- math (+ − × ÷ %, with a  type:name ~ 1  slot for an operand the design typed on the card rather than',
      '  wired, and written inside its braces as  result=a+b) and',
      '  append / join / remove / removeat / sort / clone / INSPECT → plain Rust on the values the brief names: + - * / %,',
      '  push / concat / drop / sort, a by-value copy, a field read. They are expressions inside the body,',
      '  never engine calls of their own.',
    ],
  },
  {
    k: ['code'],
    l: [
      '- CODE part (its script is printed inside its own braces, verbatim) → the design wrote the logic itself:',
      '  translate it statement by statement into the habit/impulse body or a plain Rust fn — its def',
      '  parameters are the ⇣ inputs and its return values the ⇡ outputs. Keep its arithmetic and control',
      '  flow; replace only the reads/writes the brief already names with the ledger or facet calls it lists.',
      '  Where its script carries a ⚠ line under it, the design’s own validator called that script broken:',
      '  fix the logic once and say in a comment what you fixed — do not ship the fault.',
    ],
  },
  {
    k: ['getledger', 'setledger'],
    l: [
      '- GET LEDGER / SET LEDGER (system ledger variables, listed up top under Shared',
      '  state) → the ledger record for that system: read with ledger.read::<T>() and write with',
      '  ledger.write::<T>(|rec| rec.field = …) — records are made once at Curio::create() and edited, never added.',
    ],
  },
  {
    k: ['syscall', 'event', 'load', 'unload', 'input'],
    l: ['- system fn call (roster.foes()) → an ECS query over the context, not a lookup table; user fns are facets.'],
  },
  {
    k: ['text', 'todo'],
    l: ['- TEXT frame / TODO part → a comment and a // todo in the generated code: they carry intent, not logic.'],
  },
  {
    k: [],
    l: [
      '- ⚠ lines (a second flow wire leaving one part on the port it already runs, a flow wire into a',
      '  deleted part, a script the validator calls broken) → the document itself says this: state the',
      '  choice you made in a comment, and never invent an engine call the brief did not name.',
    ],
  },
]

// the mapping only carries what this brief actually has: the engine vocabulary is
// always there, the canvas and node entries only for kinds the walk printed
const keep = (e, kinds) => !e.k.length || e.k.some((x) => kinds.has(x))
const curioOf = (kinds) =>
  [
    ...CURIO_HEAD,
    ...CURIO_FEATURES,
    '## Canvas → Curio feature — how the design’s own canvases become engine constructs',
    ...CURIO_CANVAS.flatMap((e) => (keep(e, kinds) ? e.l : [])),
    '',
    '## Node → Curio feature — what each part in the tables above becomes',
    ...CURIO_NODE.flatMap((e) => (keep(e, kinds) ? e.l : [])),
    '',
    'Startup shape: Curio::create().identity(…).plugin(SystemComponentDefaultTime/Graphics/Input/',
    'Networking/Gameplay::<MyStimulant, MyUIEvent>::new()).formation(Formation::template_local_single(…)).imbue(),',
    'with #[curio_entry] on the fn that returns it — every habit, impulse, facet and record is macro-registered,',
    'so wiring the brief means declaring the parts, not hand-hooking them.',
    '',
  ]

export function exportForLLM(doc) {
  const out = []

  // document-wide code-style handles: one slug per part, derived from kind +
  // name — or from the part's note when that is all the design says about it —
  // made unique against the WHOLE document (container prefix only when the
  // plain form clashes with a part another graph already claimed), so every
  // cross-reference (a slot's wire source, the hop back to a declared part, a
  // name in a part's [ ] successor list) names one part and an unnamed part's
  // handle still reads as what it is for
  const slugs = {}
  {
    const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    const prefixOf = (k) => ({ machine: 'mach', graph: 'sub', condition: 'if', ifb: 'if', choice: 'pick', enter: 'enter', exit: 'exit', exitinst: 'exitref', func: 'fn', foreach: 'for', for: 'for' }[k] || slugify(k))
    const taken = new Set()
    const assign = (n, prefix) => {
      const base = prefixOf(n.kind)
      // a part with no name still needs a handle a reader can read: the note is
      // what the design says it is for, so derive the slug from it whole words at
      // a time (so the cut never lands mid-word), and the note itself keeps riding
      // after the line either way
      const noteWords = slugify(n.note || '').split('_').filter(Boolean)
      let fromNote = ''
      for (const w of noteWords) {
        if (fromNote.length + 1 + w.length > 20) break
        fromNote = fromNote ? `${fromNote}_${w}` : w
      }
      const nm = slugify(n.name || '') || fromNote
      let s = nm ? `${base}_${nm}` : base
      if (taken.has(s) && prefix) {
        const cont = `${prefix}_${s}`
        if (!taken.has(cont)) s = cont
      }
      if (taken.has(s)) {
        let i = 2
        while (taken.has(`${s}_${i}`)) i++
        s = `${s}_${i}`
      }
      slugs[n.id] = s
      taken.add(s)
    }
    const slugWalk = (g, prefix) => {
      for (const n of g.nodes || []) {
        assign(n, prefix)
        if (n.graph) slugWalk(n.graph, slugs[n.id])
      }
    }
    slugWalk(doc.design, '')
    for (const f of doc.funcs || []) slugWalk(f.graph || { nodes: [] }, `fn_${slugify(f.name || '') || 'fn'}`)
  }

  // the programs are lowered first and kept aside: the vocabulary section that
  // opens the brief can only be written once the walk has decided which kinds
  // survive
  const body = []
  const kindsUsed = new Set()

  // shared state the brief names: globals its GET/SET GLOBAL parts read and the
  // system ledger variables its GET/SET LEDGER parts name — declared values no
  // part touches are content this design does not use
  const usedGlobals = new Set()
  const ledgerRefs = new Map()
  const calledFuncs = new Set()
  const noteUse = (g) => {
    for (const n of g.nodes || []) {
      if (n.kind === 'getg' || n.kind === 'setg') usedGlobals.add(n.gName || '')
      if (n.kind === 'getledger' || n.kind === 'setledger') {
        const sys = (doc.assets || []).find((a) => a.id === n.lRef)
        const key = `${sys?.name || '?'}.${n.lName || '?'}`
        if (!ledgerRefs.has(key)) ledgerRefs.set(key, { type: n.lType || 'int', read: [], written: [] })
        ;(n.kind === 'getledger' ? ledgerRefs.get(key).read : ledgerRefs.get(key).written).push(slugs[n.id])
      }
      if (n.graph) noteUse(n.graph)
    }
  }
  noteUse(doc.design)
  for (const f of doc.funcs || []) noteUse(f.graph || { nodes: [] })

  // every graph the design states gets a section of its own, and a section is
  // written after the sections it leans on: an ƒ's body before the section that
  // calls it, a machine nested in a machine before the machine that runs it, a
  // sub-graph before the graph that runs it. Lowering a section is what reveals
  // the sections it calls, so the walk grows until nothing new is left to lower,
  // then the sections are sorted by that edge — so a call site that names a
  // machine, a ƒ or a sub-graph always has its parts above it on the page, and
  // the brief never asks the reader to hold a name until later. A machine or
  // sub-graph no chain ever reaches is content this design does not run, so it
  // is never lowered and earns no section
  const secs = new Map()
  const queue = [{
    id: '__top__',
    kind: 'graph',
    node: null,
    graph: doc.design,
    depth: 0,
  }]
  while (queue.length) {
    const q = queue.shift()
    if (secs.has(q.id)) continue
    const refs = {
      nodes: new Set(),
      funcs: new Set(),
    }
    const lines = graphBody(q.graph, doc, slugs, kindsUsed, calledFuncs, refs)
    const deps = new Set()
    for (const nid of refs.nodes) {
      const owner = (q.graph.nodes || []).find((x) => x.id === nid)
      if (!owner) continue
      const sid = `${q.id}/${nid}`
      deps.add(sid)
      if (!secs.has(sid)) queue.push({ id: sid, kind: owner.kind, node: owner, graph: owner.graph, depth: q.depth + 1 })
    }
    for (const fid of refs.funcs) {
      const f = (doc.funcs || []).find((x) => x.id === fid)
      if (!f) continue
      const sid = `ƒ/${fid}` // one ƒ body per function, however many call sites name it
      deps.add(sid)
      if (!secs.has(sid)) queue.push({ id: sid, kind: 'func', node: f, graph: f.graph || { mode: 'func', nodes: [], links: [] }, depth: 0 })
    }
    secs.set(q.id, {
      kind: q.kind,
      node: q.node,
      graph: q.graph,
      lines,
      deps,
      depth: q.depth,
    })
  }

  // the order the sections print in: a section comes after everything it calls,
  // and where nothing decides between two sections the design's own order of
  // what it is made of comes first — ƒs, then machines, then flow graphs
  const rankOf = (k) => k === 'func' ? 0 : k === 'machine' ? 1 : 2
  const remaining = new Set(secs.keys())
  const stated = new Set()
  const order = []
  while (remaining.size) {
    const ready = [...remaining].filter((id) => [...secs.get(id).deps].every((d) => stated.has(d) || !remaining.has(d)))
    const pool = ready.length ? ready : [...remaining] // sections that call each other break here
    pool.sort((a, b) => {
      const sa = secs.get(a)
      const sb = secs.get(b)
      if (rankOf(sa.kind) !== rankOf(sb.kind)) return rankOf(sa.kind) - rankOf(sb.kind)
      if (sa.depth !== sb.depth) return sb.depth - sa.depth // innermost first, so a nested machine precedes its caller
      return 0
    })
    const id = pool[0]
    order.push(id)
    stated.add(id)
    remaining.delete(id)
  }

  const groupOf = [
    '## Defined functions — ƒ isolated bodies a FUNC part calls by name',
    '## Machines — each machine’s own chain, in a section stated before the section that runs it',
    '## Graphs — one entry per part, stepped in the order its chain runs',
  ]
  let lastRank = -1
  for (const id of order) {
    const s = secs.get(id)
    const rank = rankOf(s.kind)
    if (rank !== lastRank) {
      if (lastRank !== -1) body.push('')
      body.push(groupOf[rank])
      lastRank = rank
    } else body.push('') // a blank line between two sections of the same kind
    const named = (s.graph || {}).name || ''
    const handle = s.node ? slugs[s.node.id] || '' : ''
    const title =
      s.kind === 'func'
        ? `### ƒ ${s.node.name || '(unnamed)'}${s.node.note ? ` — ${s.node.note}` : ''}`
        : s.kind === 'machine'
        ? `### Machine ${handle}${named ? ` ${q(named)}` : ''}`
        : id === '__top__'
        ? `### Flow Graph ${q(s.graph.name || '')}`
        : `### Sub-graph ${handle}${named ? ` ${q(named)}` : ''}`
    body.push(title.replace(/\s+$/, ''))
    body.push('```')
    body.push(...s.lines)
    body.push('```')
  }
  if (order.length) body.push('') // a blank line closes the last section before the mapping

  out.push(`# Game design brief — ${doc.name || 'Untitled Design'}`)
  out.push(
    'Exported from loopdoc-composer as a plain-text reading of a node-graph design.',
    'This brief is the whole design and the only thing a model gets: no design file,',
    'no project data, no other source is available while it builds — every handle it',
    'names (part slugs, systems, ledger variables, data types) is defined in it, and a',
    'value the design types on a card is printed rather than left to infer.',
    'Two canvases exist: FLOW graphs (control flow, one token walking the chain) and',
    'MACHINES (chain execution: ENTER/EXIT doors frame the chain, wires carry it forward,',
    'data wires ⇣/⇡ carry typed values between parts). A token moves one hop per step;',
    'ENTER doors start machine chains; flow graphs run from their entry.',
    'Every graph the design states gets a section of its own — a ƒ, a machine, a sub-graph and the',
    'flow graph each open under their own heading, with their own fenced table inside: one entry per',
    'part, a part declared exactly once, and the entry for the part the chain goes to next written',
    'one indent deeper — the indentation IS the chain’s step, and { braces } carry what a part does',
    'rather than where it sits. Sections are ordered so everything a section calls is stated above',
    'it — ƒs, then machines, then graphs — so a call site never has to hold a name until its parts',
    'appear below: it only writes  handle — its own parts are stated in the section for it above. An',
    'entry reads',
    '  KIND: handle "name" ( ⇣ slots ) -> ( ⇡ slots ) { its operation } [ PORT:successor ]',
    'a slot reads  type:name ~ SOURCE.part  wired by another part ·  type:name ~ value  the design',
    'typed on a card ·  type:name  alone when nothing in the design wires it; a ⇡ slot names the',
    'EXIT door it belongs to, as  type:name @ "door". The braces hold the part’s own operation: a',
    'CODE part’s script verbatim inside them, and the part’s own logic written as code where the',
    'design has one (result=a+b, if a==b / else, for item in arr). Where the chain goes on rides on',
    '[ PORT:slug ] — PORT is the name the design gives that exit (an IF arm, a machine’s EXIT door,',
    'a CHOICE option, a loop’s iter/end) and is left out for the plain out port, so a part with',
    'several successors names them where it is declared rather than in a block below. Those are',
    'alternatives, so they carry no ⚠: only two flow wires leaving the SAME port do, because those',
    'really do enqueue two events at once, and that second run prints at the end of the run above',
    'it, marked ⚠. A closing brace with no [ ] list has an arm or body the design left unwired —',
    'it does nothing, as an unwired branch does in code, so nothing else marks an unwired path.',
    'A line marked # → is the chain hopping back to a part declared above: the stair is stepped in',
    'walk order, not an order of the data, so the block above is that part’s only entry and a slot',
    'may read a value printed further down. Parts under',
    '  # declared here, reached by no chain — the chains below read their ⇡ values',
    'join no chain but hand a value to something that does, so they are printed above the chains',
    'that read them, and their slots stay resolvable. Every section is stated after the sections',
    'it calls into, so a ƒ body, a machine body and a sub-graph are all on the page before the',
    'call site that names their handle. A CODE part names its language',
    'on the entry line and carries its script verbatim inside its braces — the def’s parameters are',
    'its ⇣ inputs and its return values its ⇡ outputs, so the script is the logic and nothing else',
    'restates it.',
    'Read it in this order: the vocabulary of the parts this brief uses, then what',
    'the design is made of (systems, data types, shared state), then its programs — one section per',
    'graph, ƒs first, then machines, then graphs, each stated after everything it calls — and then',
    'the Curio features that carry them: first the engine’s own primitives, then how this design’s',
    'canvases and its individual parts become those primitives. Content the design never reaches',
    'is left out of the brief — if it is not here, it is not in the design.',
    '',
  )

  if (doc.notes?.business || doc.notes?.mood) {
    out.push('## Notes')
    if (doc.notes.business) out.push(`business: ${doc.notes.business}`)
    if (doc.notes.mood) out.push(`mood: ${doc.notes.mood}`)
    out.push('')
  }

  out.push('## Part reference — the kinds used by the parts this brief carries')
  // the kind hints live in model.js and still name the legacy asset layer;
  // this brief describes a design without that feature, so the clauses naming
  // assets are trimmed here rather than in the editor's own vocabulary
  const hintOf = (k) => {
    const m = kindMeta({ kind: k })
    let hint = (m.hint || '').replace(/ and 📦 assets publish ⇡ inside and appear as/, ' appear as')
    if (/assets?|📦/i.test(hint))
      hint = hint.split(' · ').filter((c) => !/assets?|📦/i.test(c)).join(' · ')
    return `${m.label || k} — ${hint}`
  }
  for (const k of [...kindsUsed].sort()) out.push(`- ${hintOf(k)}`)
  out.push('')

  const systems = (doc.assets || []).filter((a) => a.kind !== 'art')
  if (systems.length) {
    out.push('## Systems — what the engine hands this design, and the fns it can call')
    for (const a of systems) {
      out.push(`- ${assetIcon(a.kind)} ${a.name || '(unnamed)'} (${a.kind})${a.note ? ` — ${a.note}` : ''}`)
      for (const f of a.api || [])
        out.push(
          `  - fn ${f.name || '?'}( ${(f.inputs || []).map((v) => `${v.name || '?'}:${v.type || '?'}`).join(', ')}) ⇡ ${
            (f.outputs || []).map((v) => `${v.name || '?'}:${v.type || '?'}`).join(', ') || 'void'
          }${f.desc ? ` — ${f.desc}` : ''}`,
        )
    }
    out.push('')
  }

  if ((doc.types || []).length) {
    const byNs = new Map()
    for (const t of doc.types) {
      const nm = t.name || '(unnamed)'
      const ns = nm.includes(':') ? nm.split(':')[0] : '(no namespace)'
      if (!byNs.has(ns)) byNs.set(ns, [])
      byNs.get(ns).push(t)
    }
    out.push('## Data types — grouped by the namespace that owns them')
    for (const [ns, ts] of byNs) {
      if (byNs.size > 1) {
        // a blank line each side of the group label: markdown reads a `- ` line
        // straight under a bold line as that line's continuation, which swallows
        // the whole list into the label paragraph
        out.push(`**${ns}**`)
        out.push('')
      }
      for (const t of ts)
        out.push(`- ${t.name || '(unnamed)'} { ${(t.fields || []).map((f) => `${f.name || '?'}: ${f.typeId || '?'}`).join(', ')} }`)
      if (byNs.size > 1) out.push('')
    }
    if (byNs.size > 1) out.pop() // the section writes its own trailing blank below
    out.push('')
  }

  const liveVars = (doc.vars || []).filter((v) => usedGlobals.has(v.name || ''))
  if (liveVars.length || ledgerRefs.size) {
    out.push('## Shared state — named values every graph & machine reads or writes')
    for (const v of liveVars) out.push(`- ⚙ global ${v.name || '?'}:${v.type || 'int'} = ${v.value ?? ''}`)
    for (const [key, r] of ledgerRefs) {
      const who = [
        ...(r.read.length ? [`read by ${r.read.join(', ')}`] : []),
        ...(r.written.length ? [`written by ${r.written.join(', ')}`] : []),
        // a variable only read here is the engine's, not this design's: say so,
        // or the reader looks for a write that was never meant to exist
        ...(r.written.length ? [] : ['no part in this design writes it']),
      ].join(' · ')
      out.push(`- system ledger ${key} :${r.type}${who ? ` — ${who}` : ''}`)
    }
    out.push('')
  }

  out.push(...body)

  out.push(...curioOf(kindsUsed))
  out.push(
    '(end of brief — the text above is the whole design as it stands: every handle it',
    'uses is defined in it, and the model building from it is given nothing else. Where',
    'the brief marks a ⚠ the document is undecided or broken there — state what you',
    'decided and what you fixed, and never invent an engine call the brief did not name.)',
  )
  return out.join('\n')
}
