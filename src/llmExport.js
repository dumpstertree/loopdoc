// LLM export — flattens the whole document into one self-contained plain-text
// brief written FOR a language model to read and build a game from: each graph
// is lowered into an ordered pseudo-program (chains in run order, control
// structures as indented blocks, data wires as # lines under their consumer),
// nested graphs/machines/functions become sections the call site points into,
// and the part reference for the kinds actually used is read BEFORE the programs
// are, so the vocabulary exists by the time the first chain does. Art assets are
// a legacy feature: the brief never mentions them. Content the design never
// reaches (unchained parts, dead values) is culled quietly rather than flagged.
// A Curio cheatsheet closes the brief, mapping each concept onto the engine
// feature that carries it, so the model builds the game instead of guessing.
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
      return 'nested flow graph — its section is below (called here with its ⇣ args; RETURN leads back out)'
    case 'machine':
      return 'nested machine — its section is below (called here with its ⇣ args; its EXIT returns are its ⇡ outputs)'
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
      if (f) return `ƒ ${f.name || '(unnamed)'} — see Defined functions${f.note ? ` (${f.note})` : ''}`
      return n.func ? 'ƒ ⚠ picks a function that was deleted' : 'ƒ — no function picked yet'
    }
    default:
      return '' // note rides its own suffix below
  }
}

// lower one graph into an ordered pseudo-program written like real code: chains
// start at the entry / ENTER doors and run in the order they actually run; if/else,
// loops and player choices become indented blocks instead of arrow pairs; a machine
// or ƒ with a single door gets a function signature — the door's ⇣ vars become the
// parameter list (`machine "name"(params):`) and its body is indented under it with
// EXIT parts printing as returns; call sites fold their data wires into call
// arguments `slug(port ← SOURCE.part, …)`. An unwired arm prints nothing: like real
// code, a branch that goes nowhere does nothing, so it is not flagged. The body rides
// inside a ``` fence so the # lines and indentation survive markdown rendering. Parts
// that never join a chain ride as a side list only if they actually feed one, and
// anything the lowering cannot place — parallel chains, cycles, wires into deleted
// parts — stays marked ⚠ where it happens. Parts reached by nothing, and values that
// feed nothing, are simply left out: unused content is not part of this design
function graphSection(g, doc, heading, parentNote, slugs, kindsUsed, calledFuncs) {
  const L = []
  const labels = makeLabels(g)
  const nodes = g.nodes || []
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const flows = (g.links || []).filter((l) => l.kind !== 'data')
  const datas = (g.links || []).filter((l) => l.kind === 'data')
  const pad = (i) => '  '.repeat(i)
  const sideKind = (n) => n.kind === 'text' || n.kind === 'todo' || kindMeta(n).dataOnly
  const doors = nodes.filter((n) => n.kind === 'enter')
  // a single-door machine/ƒ reads as a function: the door is the section's
  // signature, not a line in its body
  const sigDoor = (g.mode === 'machine' || g.mode === 'func') && doors.length === 1 ? doors[0] : null
  const sigDoors = new Set(sigDoor ? [sigDoor.id] : [])
  const portName = (node, id, dir) => {
    const dp = dataPorts(node, doc.assets, doc.funcs || [], g)
    const p = (dp[dir] || []).find((x) => x.id === id)
    return p ? p.name || id : id
  }
  const wire = (l) => {
    const s = byId[l.from]
    if (!s) return `⚠ deleted part (id ${l.from})`
    const out = dataPorts(s, doc.assets, doc.funcs || [], g).out.find((x) => x.id === l.fromPort)
    return `${slugs[l.from] || labels[l.from]}.${out?.name || l.fromPort}${out?.type ? ` :${out.type}` : ''}`
  }
  const outFlow = (id, port) => flows.filter((l) => l.from === id && (port == null || l.fromPort === port))
  const feed = (id) => datas.filter((l) => l.to === id)
  // a named part shows both handles (slug — KIND "name") so the line stays
  // scannable; an unnamed one shows its slug alone, whose kind prefix carries
  // what the bare KIND label would have said
  const disp = (id) => {
    const s = slugs[id] || labels[id]
    return labels[id].includes('"') ? `${s} — ${labels[id]}` : s
  }
  const headLine = (n, ind) => {
    const d = detail(n, g, doc)
    return `${pad(ind)}${disp(n.id)}${d ? `: ${d}` : ''}${n.note && n.kind !== 'text' ? ` (note: ${q(n.note)})` : ''}`
  }
  const wires = (n, ind) => feed(n.id).map((l) => `${pad(ind + 1)}# ⇣ ${portName(n, l.toPort, 'in')} ← ${wire(l)}`)
  // a CODE part carries a script the design wrote itself: print it verbatim, pushed
  // in one level under the part's own line so its indentation stays relative and
  // the brief never restates what the code already says; blank lines stay blank so
  // nothing outside a fence swallows them
  const codeLines = (n, ind) => {
    const raw = String(n.code || '').replace(/\r\n?/g, '\n').split('\n')
    while (raw.length && !raw[0].trim()) raw.shift()
    while (raw.length && !raw[raw.length - 1].trim()) raw.pop()
    return raw.map((l) => (l.trim() ? pad(ind) + l.replace(/\t/g, '  ').replace(/\s+$/, '') : ''))
  }

  const visited = new Set()
  const extra = [] // parallel chains the walk forks off, lowered after the main one
  const residue = []

  const chain = (id, ind) => {
    const L2 = []
    let cur = id
    while (cur) {
      const n = byId[cur]
      if (!n) {
        L2.push(`${pad(ind)}⚠ flow enters a deleted part (id ${cur})`)
        break
      }
      if (visited.has(cur)) {
        L2.push(`${pad(ind)}goto ${slugs[cur] || labels[cur]} — ⚠ this chain returns to a part already written above`)
        break
      }
      visited.add(cur)
      kindsUsed.add(n.kind)
      // a FUNC part only earns its ƒ if it was actually written out, not merely
      // present in the graph — a call site nothing reaches calls nothing
      if (n.kind === 'func') calledFuncs.add(n.func)
      const take = (port) => {
        const ls = port == null ? outFlow(cur) : outFlow(cur, port)
        for (const l of ls.slice(1)) extra.push({ id: l.to, why: `extra flow out of ${slugs[cur] || labels[cur]}` })
        return ls[0]
      }
      const step = (l) => {
        if (!l) return null
        if (byId[l.to]) return l.to
        L2.push(`${pad(ind)}⚠ flow enters a deleted part (id ${l.to})`)
        return null
      }
      // a link whose far end no longer exists — the id is all the document has
      const dead = (id, ind2) => L2.push(`${pad(ind2)}⚠ deleted part (id ${id})`)
      const k = n.kind
      if (k === 'condition' || k === 'ifb') {
        const test = k === 'condition'
          ? n.cond || '(branches on its wired operands)'
          : ['a', 'b'].map((s) => {
              const l = feed(cur).find((x) => x.toPort === `__${s}__`)
              return l ? wire(l) : `⇣${s}`
            }).join(` ${n.op || '=='} `)
        L2.push(`${pad(ind)}if (${test}):  # ${disp(cur)}`)
        const tb = take('true')
        if (tb && byId[tb.to]) L2.push(...chain(tb.to, ind + 1))
        else if (tb) dead(tb.to, ind + 1)
        else L2.push(`${pad(ind + 1)}pass`) // an empty block is still a block: the shape stays legal
        const fb = take('false')
        if (fb) {
          L2.push(`${pad(ind)}else:`)
          if (byId[fb.to]) L2.push(...chain(fb.to, ind + 1))
          else dead(fb.to, ind + 1)
        }
        cur = null
      } else if (k === 'choice') {
        L2.push(`${pad(ind)}wait for player choice:  # ${disp(cur)}`)
        for (const e of n.exits || []) {
          const ls = outFlow(cur, e.id)
          for (const l of ls.slice(1)) extra.push({ id: l.to, why: `extra option ${q(e.label || '?')}` })
          L2.push(`${pad(ind)}if player picks ${q(e.label || '?')}:`)
          if (ls[0] && byId[ls[0].to]) L2.push(...chain(ls[0].to, ind + 1))
          else if (ls[0]) dead(ls[0].to, ind + 1)
          else L2.push(`${pad(ind + 1)}pass`) // the option exists; picking it enqueues nothing
        }
        cur = null
      } else if (k === 'for' || k === 'foreach') {
        const src = feed(cur).find((l) => l.toPort === (k === 'for' ? '__to__' : '__arr__'))
        L2.push(
          pad(ind) +
          (k === 'for'
            ? `for i:int up to ${src ? wire(src) : '?'}:  # ${disp(cur)}`
            : `for item:${n.itemType || '?'} (+index) in ${src ? wire(src) : '?'}:  # ${disp(cur)}`),
        )
        const body = take('out') // the loop's iter port
        if (body) {
          if (byId[body.to]) L2.push(...chain(body.to, ind + 1))
          else dead(body.to, ind + 1)
        } else L2.push(`${pad(ind + 1)}pass`) // the loop runs; its body is empty
        const end = take('end')
        if (end) cur = step(end)
        else cur = null
      } else {
        const d = detail(n, g, doc)
        const ws = feed(n.id)
        const note = n.note && n.kind !== 'text' ? ` (note: ${q(n.note)})` : ''
        if (k === 'exit')
          L2.push(`${pad(ind)}return${n.name ? ` ${q(n.name)}` : ''}  # ${disp(n.id)}${d ? `: ${d}` : ''}${note}`)
        else if ((k === 'machine' || k === 'graph' || k === 'func') && ws.length) {
          const args = ws.map((l) => `${portName(n, l.toPort, 'in')} ← ${wire(l)}`).join(', ')
          const s = slugs[n.id] || labels[n.id]
          L2.push(`${pad(ind)}${s}(${args})${labels[n.id].includes('"') ? ` — ${labels[n.id]}` : ''}${d ? `: ${d}` : ''}${note}`)
        } else if (sigDoors.has(n.id)) { /* the door is the section's signature, printed above */ }
        else if (k === 'code') {
          // the script rides under its own line: its params are fed by the ⇣ wires above it
          L2.push(headLine(n, ind), ...wires(n, ind), ...codeLines(n, ind + 1))
        } else L2.push(headLine(n, ind), ...wires(n, ind))
        if (k === 'exit' || k === 'exitinst') cur = null // doors end their chain
        else if (k === 'enter') cur = step(take('out'))
        else if (k === 'graph') cur = step(take('return'))
        else cur = step(take(null)) // machines exit by name; everything linear by 'out'
      }
    }
    return L2
  }

  L.push(`${heading}${g.name ? ` ${q(g.name)}` : ''}${parentNote ? ` — ${parentNote}` : ''}`)
  L.push('```')
  if (sigDoor) {
    const ps = (sigDoor.vars || []).map((v) => `${v.name || 'var'}:${v.type || 'int'}${String(v.value ?? '') ? ` = ${v.value}` : ''}`)
    const nm = g.name || sigDoor.name || ''
    L.push(`${g.mode === 'machine' ? 'machine' : 'fn'} ${nm ? q(nm) : ''}(${ps.join(', ')}):  # ${disp(sigDoor.id)} starts it · its vars are parameters`)
    for (const l of feed(sigDoor.id)) L.push(`  # ⇣ ${portName(sigDoor, l.toPort, 'in')} ← ${wire(l)}`)
  }
  let starts
  if ((g.mode === 'machine' || g.mode === 'func') && doors.length) starts = doors.map((d) => d.id)
  else if (g.entry && byId[g.entry]) starts = [g.entry]
  else {
    const roots = nodes.filter((n) => n.kind !== 'text' && n.kind !== 'todo' && !kindMeta(n).dataOnly && !flows.some((l) => l.to === n.id))
    starts = (roots.length ? roots : nodes.filter((n) => n.kind !== 'text' && n.kind !== 'todo' && !kindMeta(n).dataOnly)).map((n) => n.id)
  }
  for (let i = 0; i < starts.length; i++) {
    if (i) L.push(`# a second chain runs alongside the one above:`)
    L.push(...chain(starts[i], sigDoor ? 1 : 0))
  }
  while (extra.length) {
    const x = extra.shift()
    if (visited.has(x.id)) continue
    L.push(`# ⚠ parallel chain — ${x.why}: starts at ${slugs[x.id] || labels[x.id]}`)
    L.push(...chain(x.id, 0))
  }

  // a part that joins no chain still belongs to the brief if its ⇡ value feeds
  // something that is in the brief — so the set of kept parts grows from the
  // chain until nothing new feeds it; anything left over (an unchained part
  // nothing reads, a value nothing consumes) is content this design does not
  // use, and is dropped. Annotation frames and checklists ride always: they
  // carry intent, not logic
  const kept = new Set(visited)
  const feeds = (n) => datas.some((l) => l.from === n.id && kept.has(l.to))
  let grew = true
  while (grew) {
    grew = false
    for (const n of nodes) {
      if (visited.has(n.id) || kept.has(n.id) || !sideKind(n)) continue
      if (n.kind === 'text' || n.kind === 'todo' || feeds(n)) {
        kept.add(n.id)
        grew = true
      }
    }
  }
  const side = nodes.filter((n) => sideKind(n) && !visited.has(n.id) && kept.has(n.id))
  if (side.length) {
    L.push('')
    L.push('# values, notes & frames — not in any chain; their ⇡ values reach parts through the wires above')
    for (const n of side) {
      kindsUsed.add(n.kind)
      L.push(headLine(n, 0), ...wires(n, 0))
    }
  }

  const dang = datas.filter((l) => !byId[l.to])
  if (dang.length) {
    L.push('')
    L.push('# ⚠ wires into deleted parts')
    for (const l of dang) L.push(`⚠ data wire ${wire(l)} goes to a deleted part (id ${l.to})`)
  }
  L.push('```')
  return L
}

// the target engine this brief is written for: curio-engine (Rust, ECS on hecs,
// wgpu). The cheatsheet below maps every concept the lowering can emit onto the
// engine construct that carries it, in the engine's own words — so the model
// building the game never has to guess which Curio primitive a graph part means.
const CURIO = [
  '## Curio mapping — cheatsheet: graph part → engine feature',
  'Handles in the brief are slugs; each one becomes the Rust name below it.',
  '',
  '- FLOW graph (the Main Loop) → the game loop itself: one #[habit] whose Scope.is_enabled is the',
  '  “keep playing” test; its chain, written in order, is that habit’s tick(). Use enable()/disable()',
  '  for the game’s start and teardown.',
  '- MACHINE part / nested machine → a #[habit] (recurring, runs every frame while its Scope is',
  '  enabled) for loops, or a #[impulse(MyStimulant)] (one-shot, reacts to an event) for behaviour',
  '  that only runs when something announces it. Habits and impulses self-register by macro;',
  '  Scope.run_on_instance() → NetworkModes::all() picks which multiplayer instances run it.',
  '- chain hop A → B → nerve.enqueue_event(MyStimulant::B): stimulants are drained at the START of the',
  '  next frame, and a stimulant that sends another keeps chaining before the Tick phase resumes.',
  '- ENTER door + ⇣ vars → the habit’s/impulse’s inputs: fields of a #[record(ownership = RecordScope::Instance)]',
  '  written with ledger.write::<T>(|rec| …) before the enqueue, a facet field, or plain fn parameters.',
  '- named EXIT (its ⇡ announce vars) → one variant of the #[stimulant] enum, plus the records that carry',
  '  its values. “kills the token” = form.destroy() or stop the habit’s Scope.',
  '- EXIT REF → enqueue the variant that named EXIT already owns — never mint a second event for it.',
  '- ⚙ GLOBALS → #[record] structs made once at Curio::create() (records are edited, never added):',
  '  read with ledger.read::<T>() (a read-only Rc<T>). Built-ins are yours for free: SysRecordTime',
  '  (ledger.time().scaled_delta_time / scaled_time), SysRecordInput, SysRecordCamera, SysRecordScreen.',
  '- DATA TYPE (Foe { hp: int, pos: Vec }) → a #[facet] struct + FieldOverride::apply/get_state when a',
  '  .comp composition must edit it; a plain struct or record field set when only code touches it.',
  '  Vec → Vector3/Vector2, int → i32, float → f32, bool → bool, Foe[] → Vec<Form> or an ECS query.',
  '- VAR “hero” → context.spawner("hero").position(…).facet(Facet::builder()….build()).spawn();',
  '  hold the Form on the habit struct, destroy() it in disable(). A VAR of ⚙/record fields is a write.',
  '- MACHINE ⇣/⇡ wires at a call site — printed name(port ← SOURCE.part) — and every # ⇣ port ← slug.part',
  '  :type line, are value hand-offs: read the producer’s record/facet, then write it in or pass it — the',
  '  ← side names exactly which part hands what over.',
  '- ACTION (chain waits for a click) → ledger.read::<SysRecordInput>(); raw.get_button(&ButtonCode::KeyW).is_down',
  '  for physical keys, or map logical names once in InputMapping::new(…) and read',
  '  mapped[seat].get_button_or_default("paddle_up") — the seat index is the multiplayer player.',
  '- CHOICE options → each option is an input-mapped button that gates which stimulant gets enqueued;',
  '  an option whose only line is pass enqueues nothing, so the game waits.',
  '- condition / IF / for / foreach / goto → plain Rust if / match / for / while in the habit or impulse body;',
  '  foreach over an array of Forms = context.edit::<(&mut Transform3D, &Foe)>(|q| for (t, f) in q { … }).',
  '  pass is an empty block: nothing gets enqueued and nothing gets written — an arm, loop body',
  '  or option the design left unwired.',
  '- machine "name"(params): section / ƒ section / nested GRAPH → a #[habit]/#[impulse] or a plain Rust',
  '  fn: the signature’s parameters are the ENTER door’s vars, and a return is an EXIT part — call',
  '  sites pass their ⇣ args inline, so the machine call maps to a habit/impulse fired with its record',
  '  fields written, and ƒ maps to the fn.',
  '- CODE part (its script is printed under the part, verbatim) → the design wrote the logic itself:',
  '  translate it statement by statement into the habit/impulse body or a plain Rust fn — its def',
  '  parameters are the ⇣ inputs and its return values the ⇡ outputs. Keep its arithmetic and control',
  '  flow; replace only the reads/writes the brief already names with the ledger or facet calls it lists.',
  '- GET LEDGER / SET LEDGER (system ledger variables, listed up top under Shared',
  '  state) → the ledger record for that system: read with ledger.read::<T>() and write with',
  '  ledger.write::<T>(|rec| rec.field = …) — records are made once at Curio::create() and edited, never added.',
  '- system fn call (roster.foes()) → an ECS query over the context, not a lookup table; user fns are facets.',
  '- TEXT frame / TODO part → a comment and a // todo in the generated code: they carry intent, not logic.',
  '- ⚠ lines (goto, parallel chain, deleted part) → the design left this open: state the choice you made',
  '  in a comment, and never invent an engine call the brief did not name.',
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
  // name, made unique against the WHOLE document (container prefix only when
  // the plain form clashes with a part another graph already claimed) — so
  // every cross-reference (wire source, goto, parallel chain) is unambiguous
  const slugs = {}
  {
    const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    const prefixOf = (k) => ({ machine: 'mach', graph: 'sub', condition: 'if', ifb: 'if', choice: 'pick', enter: 'enter', exit: 'exit', exitinst: 'exitref', func: 'fn', foreach: 'for', for: 'for' }[k] || slugify(k))
    const taken = new Set()
    const assign = (n, prefix) => {
      const base = prefixOf(n.kind)
      const nm = slugify(n.name || '')
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

  // the graphs are lowered first and aside, because a ƒ earns its section only
  // if a FUNC part that survived the walk calls it — and a ƒ named only by a
  // part nothing reaches is dead code like that part
  const graphsOut = []
  const walkGraph = (g, depth, note) => {
    graphsOut.push(...graphSection(g, doc, `${'#'.repeat(3 + depth)} ${g.mode === 'machine' ? 'Machine' : 'Flow Graph'}`, note, slugs, kindsUsed, calledFuncs))
    graphsOut.push('')
    for (const n of g.nodes || [])
      if (n.graph) walkGraph(n.graph, depth + 1, `inside ${kindMeta(n).label} ${q(n.name || '')}`.trim())
  }
  walkGraph(doc.design, 0)

  const funcsOut = []
  const lowered = new Set()
  let more = true
  while (more) {
    more = false
    for (const f of doc.funcs || []) {
      if (lowered.has(f.id) || !calledFuncs.has(f.id)) continue
      lowered.add(f.id)
      more = true
      funcsOut.push(`- ${f.name || '(unnamed)'}${f.note ? ` — ${f.note}` : ''}`)
      funcsOut.push(...graphSection(f.graph || { mode: 'func', nodes: [], links: [] }, doc, '### ƒ', '', slugs, kindsUsed, calledFuncs))
      funcsOut.push('')
    }
  }
  if (lowered.size) {
    body.push('## Defined functions — ƒ isolated bodies a FUNC part calls by name')
    body.push(...funcsOut)
    body.push('')
  }
  body.push('## Graphs')
  body.push(...graphsOut)

  out.push(`# Game design brief — ${doc.name || 'Untitled Design'}`)
  out.push(
    'Exported from loopdoc-composer as a plain-text reading of a node-graph design.',
    'Two canvases exist: FLOW graphs (control flow, one token walking the chain) and',
    'MACHINES (chain execution: ENTER/EXIT doors frame the chain, wires carry it forward,',
    'data wires ⇣/⇡ carry typed values between parts). A token moves one hop per step;',
    'ENTER doors start machine chains; flow graphs run from their entry.',
    'Each graph is written as a program inside a fenced code block: parts appear in the',
    'order their chain runs, and if/else, counted & array loops, and player choices are',
    'indented blocks — structure by containment, not by tracing arrows. Machines and ƒs',
    'read as functions: machine "name"(params): takes the ENTER door’s vars as parameters,',
    'EXIT parts return, and call sites pass their ⇣ args inline (name(port ← SOURCE.part)).',
    'A CODE part prints its own script verbatim under its line, in the language the part names',
    '— the def’s parameters are its ⇣ inputs and its return values its ⇡ outputs, so the code',
    'under it is the logic and nothing else restates it. A block whose only line is pass was left',
    'unwired in the design — that branch or option exists and does nothing; nothing else marks an',
    'unwired path. Read it in this order: the vocabulary of the parts this brief uses, then what',
    'the design is made of (systems, data types, shared state), then the programs, then how Curio',
    'carries each part. Content the design never reaches is left out of the brief — if it is',
    'not here, it is not in the design.',
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
      ].join(' · ')
      out.push(`- system ledger ${key} :${r.type}${who ? ` — ${who}` : ''}`)
    }
    out.push('')
  }

  out.push(...body)

  out.push(...CURIO)
  out.push('(end of brief — lossless source of this design is the .json export of the same document.)')
  return out.join('\n')
}
