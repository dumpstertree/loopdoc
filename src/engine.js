// The chain engine — the composer's crown jewels, pure and React-free so it
// can be unit-tested and, one day, run headless ("the machine only asks and
// eventually gets an answer").
//
// Chain execution: ENTER doors are ENTRY POINTS — nothing self-starts just
// by being unconnected. Entry chains self-pace — when every chain from an entry
// has reached an end, the entry re-fires. A token moves one hop per step.
// Blocking sys calls and actions wait in place for a click. Flow links only
// carry the chain along; the typed ⇣/⇡ data wires carry the values that parts
// read (incl. the ⚙ global session store passed as mem.g, shared across
// machines).
import { resolveCall, fnSig, varValue, assetIcon, typedValue, fieldsOf, MATH, BOOL } from './model.js'
import { isEntryPart } from './wireRules.js'

const fmt = (v) =>
  Array.isArray(v)
    ? `[${v.map((x) => fmt(x)).join(', ')}]`
    : v && typeof v === 'object'
      ? `{ ${Object.entries(v).map(([k, x]) => `${k}: ${fmt(x)}`).join(', ')} }`
      : v

// ascending order: numbers numerically, everything else as text
const cmpVals = (a, b) => {
  const x = Number(a)
  const y = Number(b)
  if (!Number.isNaN(x) && !Number.isNaN(y)) return x - y
  return String(a).localeCompare(String(b))
}

// math parts — number in both sides, number out; int ÷ int is integer
// division, a float operand makes the answer decimal; mod by zero is empty
const numSide = (v) => {
  const x = typeof v === 'boolean' ? Number(v) : Number(v)
  return Number.isFinite(x) ? x : null
}
const mathCustom = (n, port) => {
  const c = port === '__a__' ? n.aVal : n.bVal
  return String(c ?? '').trim() === '' ? null : numSide(c)
}
const randCustom = (n, port) => {
  const c = port === '__min__' ? n.minVal : n.maxVal
  return String(c ?? '').trim() === '' ? null : numSide(c)
}
export function mathVal(nodes, links, mem, n, depth = 0) {
  const side = (port) => {
    const d = dataValue(nodes, links, mem, n.id, port, depth + 1)
    if (d) return d.val === null || d.val === undefined ? null : numSide(d.val)
    return mathCustom(n, port)
  }
  const x = side('__a__')
  const y = side('__b__')
  if (x === null || y === null) return null
  const kind = n.kind
  if (kind === 'add') return x + y
  if (kind === 'sub') return x - y
  if (kind === 'mul') return x * y
  if (kind === 'div') return y === 0 ? null : Number.isInteger(x) && Number.isInteger(y) ? Math.trunc(x / y) : x / y
  return y === 0 ? null : x % y // mod
}

// RAND — one draw between its ⇣ bounds, every time it is read. int bounds draw
// a whole number inclusive of both ends; a float bound (or a ⇡ that learned
// float) draws any decimal in between. Reversed bounds still work — the range
// is normalized
export function randVal(nodes, links, mem, n, depth = 0) {
  const side = (port) => {
    const d = dataValue(nodes, links, mem, n.id, port, depth + 1)
    if (d) return d.val === null || d.val === undefined ? null : numSide(d.val)
    return randCustom(n, port)
  }
  const x = side('__min__')
  const y = side('__max__')
  if (x === null || y === null) return null
  const a = Math.min(x, y)
  const b = Math.max(x, y)
  const isFloat = n.rType === 'float' || !Number.isInteger(a) || !Number.isInteger(b)
  if (isFloat) return a + Math.random() * (b - a)
  const span = Math.trunc(b) - Math.trunc(a) + 1
  return Math.trunc(a) + Math.floor(Math.random() * (span > 0 ? span : 1))
}

// and/or parts — every fed bool slot counts (wired wire first, else the
// true/false typed on the card); slots neither wired nor typed are simply
// ignored, and no slot at all leaves the verdict empty
export function boolVal(nodes, links, mem, n, depth = 0) {
  const slots = Math.max(2, Number(n.slots ?? 2))
  const got = []
  for (let i = 0; i < slots; i++) {
    const pid = `__s${i}__`
    const d = dataValue(nodes, links, mem, n.id, pid, depth + 1)
    if (d && d.val !== null && d.val !== undefined) got.push(Boolean(d.val))
    else {
      const c = String((n.cVals || {})[pid] ?? '').trim()
      if (c !== '') got.push(c === 'true')
    }
  }
  if (!got.length) return null
  return n.kind === 'and' ? got.every(Boolean) : got.some(Boolean)
}

function dataValue(nodes, links, mem, nodeId, varId, depth = 0) {
  if (depth > 12) return null
  const w = links.find((l) => l.kind === 'data' && l.to === nodeId && l.toPort === varId)
  if (!w) return null
  const src = nodes.find((n) => n.id === w.from)
  if (!src) return null
  const cur = (mem.cur || {})[w.from]
  if (src.kind === 'for') return { val: cur?.i ?? null, from: src.name || 'for' }
  if (src.kind === 'foreach') {
    const v = w.fromPort === '__item__' ? cur?.item : w.fromPort === '__idx__' ? cur?.index : null
    return { val: v === undefined ? null : v, from: src.name || 'foreach' }
  }
  if (src.kind === 'inspect') {
    const o = dataValue(nodes, links, mem, src.id, '__obj__', depth + 1)
    const obj = o && typeof o.val === 'object' && o.val !== null && !Array.isArray(o.val) ? o.val : null
    const f = (src.fields || []).find((x) => x.id === w.fromPort)
    const v = obj && f ? obj[f.name || 'field'] : null
    return { val: v === undefined ? null : v, from: `${src.name || 'inspect'}.${f?.name || '?'}` }
  }
  if (src.kind === 'ifb') return { val: (mem.ifres || {})[w.from] ?? null, from: src.name || 'if' }
  if (MATH[src.kind])
    return { val: mathVal(nodes, links, mem, src, depth + 1), from: src.name || src.kind }
  if (src.kind === 'rand')
    return { val: randVal(nodes, links, mem, src, depth + 1), from: src.name || 'rand' }
  if (BOOL[src.kind])
    return { val: boolVal(nodes, links, mem, src, depth + 1), from: src.name || src.kind }
  if (src.kind === 'getg') return { val: (mem.g || {})[src.gRef] ?? null, from: `⚙ ${src.gName || 'global'}` }
  if (src.kind === 'var') {
    // a made value — coerced through its declared type (nested structs too).
    // Its ⇣ ports feed in: a struct VAR takes one port per ledger field
    // (the snapshot the card stored, else the ledger's shape) and a wired
    // field wins over the typed one; anything else has a single whole-value
    // ⇣ whose wire replaces the fill-in. mem.types lets the engine know
    // the doc's shapes, optional without it
    const v = src.variable || {}
    const t = String(v.type || '').trim()
    if (!t) return { val: null, from: `📝 ${v.name || 'var'}` }
    const isArr = t.endsWith('[]')
    const flds = !isArr && (v.fields && v.fields.length) ? v.fields : (!isArr ? fieldsOf(mem.types, t) : null)
    if (flds && flds.length) {
      const merged = typedValue(t, v.value, mem.types)
      const val = merged && typeof merged === 'object' && !Array.isArray(merged) ? { ...merged } : {}
      let wiredAny = false
      for (const f of flds) {
        const d = dataValue(nodes, links, mem, src.id, f.id, depth + 1)
        if (d) {
          val[f.name || 'field'] = d.val
          wiredAny = true
        }
      }
      if (wiredAny) return { val, from: `📝 ${v.name || 'var'}` }
    } else {
      const d = dataValue(nodes, links, mem, src.id, '__in__', depth + 1)
      if (d) return { val: d.val, from: `📝 ${v.name || 'var'}` }
    }
    return { val: typedValue(t, v.value, mem.types), from: `📝 ${v.name || 'var'}` }
  }
  if (src.kind === 'enter') {
    // one of the machine's door variables — set on the ENTER card (or fed
    // from the parent's MACHINE node), typed per its declared type; array
    // types come through as lists from their comma text
    const v = (src.vars || []).find((x) => x.id === w.fromPort)
    if (v) return { val: v ? varValue(v) : null, from: `⤷ ${src.name || 'enter'}.${v?.name || '?'}` }
    // …or a door 📦 asset — the handle to the picked asset itself
    const a = (src.assets || []).find((x) => x.id === w.fromPort)
    if (a) {
      const found = (mem.assets || []).find((x) => x.id === a.asset)
      return { val: found || null, from: `⤷ ${src.name || 'enter'}.${assetIcon(found?.kind)} ${a.name || 'asset'}` }
    }
    return { val: null, from: `⤷ ${src.name || 'enter'}` }
  }
  if (src.kind === 'clone') {
    // a deep copy — downstream writes hit the copy, never the origin value
    const d = dataValue(nodes, links, mem, src.id, '__val__', depth + 1)
    const v = d ? d.val : null
    if (v === null || v === undefined) return { val: null, from: src.name || 'clone' }
    let c = v
    try {
      c = JSON.parse(JSON.stringify(v))
    } catch {
      /* circular or unserializable — pass the value through */
    }
    return { val: c, from: src.name || 'clone' }
  }
  if (['append', 'join', 'remove', 'removeat', 'sort'].includes(src.kind)) {
    // pure array arithmetic — null (never fired / unwired) on any side means no value yet
    // JOIN reads its first array from ⇣ a — its __arr__ port is the output
    const d = dataValue(nodes, links, mem, src.id, src.kind === 'join' ? '__a__' : '__arr__', depth + 1)
    const arr = d ? d.val : null
    if (!Array.isArray(arr)) return { val: null, from: src.name || src.kind }
    const side = (port) => {
      const x = dataValue(nodes, links, mem, src.id, port, depth + 1)
      return x ? x.val : null
    }
    const from = { val: (x) => `${src.name || 'append'}.${x || '?'}` }
    if (src.kind === 'append') {
      const v = side('__val__')
      return v === null ? { val: null, from: src.name || 'append' } : { val: [...arr, v], from: from.val('val') }
    }
    if (src.kind === 'join') {
      const b = side('__b__')
      return Array.isArray(b) ? { val: [...arr, ...b], from: src.name || 'join' } : { val: null, from: src.name || 'join' }
    }
    if (src.kind === 'remove') {
      const v = side('__val__')
      return v === null
        ? { val: null, from: src.name || 'remove' }
        : { val: arr.filter((x) => !(x === v || String(x) === String(v))), from: from.val('val') }
    }
    if (src.kind === 'removeat') {
      const i = Math.trunc(Number(side('__index__')))
      if (!Number.isFinite(i)) return { val: null, from: src.name || 'remove at' }
      const out = [...arr]
      if (i >= 0 && i < out.length) out.splice(i, 1)
      return { val: out, from: src.name || 'remove at' }
    }
    const f = src.field // sort: by one field of struct items, else by value itself
    return {
      val: [...arr].sort((p, q) =>
        cmpVals(f && p && typeof p === 'object' ? p[f] : p, f && q && typeof q === 'object' ? q[f] : q),
      ),
      from: src.name || 'sort',
    }
  }
  const v = (mem.call || {})[w.from]?.[w.fromPort]
  return { val: v === undefined ? null : v, from: src.name || 'sys call' }
}

function callSystem(n, nodes, links, mem, log, assets) {
  const r = resolveCall((n.calls || [])[0], assets)
  if (!r) {
    log.push(`⚙️ sys call "${n.name || ''}" — ⚠ no system fn selected`)
    return
  }
  const sig = fnSig(r)
  log.push(`⚙️ ${r.asset.name || 'system'} → ${r.fn.name || '(unnamed)'}(${sig.in}) ⇡ ${sig.out}`)
  const made = ((mem.call = mem.call || {})[n.id] = {})
  for (const v of r.fn.inputs || []) {
    if (!v.name && !v.type) continue // blank var left in the API
    const d = dataValue(nodes, links, mem, n.id, v.id)
    if (!d) {
      // no wire — the value typed on the card's ⇣ takes its place, like math's aVal/bVal
      const c = (n.cVals || {})[v.id]
      if (c !== undefined && String(c).trim() !== '')
        log.push(`    ⇂ ${v.name || '?'}:${v.type || '?'} = ${fmt(c)} ← card value`)
      else log.push(`    ⚠ in ${v.name || '?'}:${v.type || '?'} — no data wire`)
    }
    else if (d.val === null) log.push(`    ⇂ ${v.name || '?'}:${v.type || '?'} = ⋯ ("${d.from}" never fired)`)
    else log.push(`    ⇂ ${v.name || '?'}:${v.type || '?'} = ${fmt(d.val)} ← "${d.from}"`)
  }
  for (const v of r.fn.outputs || []) {
    // answers typed on the card during sim (mem.callEdits) win over the
    // type default — a blocking call re-opened next round keeps your answer
    // until you change it, exactly like the old edit-time defaults used to
    const edits = (mem.callEdits || {})[n.id]
    const manual = edits && Object.prototype.hasOwnProperty.call(edits, v.id)
    made[v.id] = manual ? edits[v.id] : n.out?.[v.id] ?? (String(v.type || '').toLowerCase().endsWith('[]') ? [] : 0)
    log.push(`    ⇡ ${v.name || '?'}:${v.type || '?'} = ${fmt(made[v.id])}${manual ? ' (your value)' : ' (sim value)'}`)
  }
}

// One simulation step: every token in flight moves one hop, parts fire as
// they land, and an ENTER door relaunches when none of its chains are in
// flight anymore.
function stepOnce(nodes, links, log, mem = {}, assets = []) {
  // the doc's assets live on mem so ENTER 📦 ports (and anything downstream)
  // can resolve handles without threading a new argument through every read
  mem.assets = assets || []
  const flows = links.filter((l) => l.kind !== 'data')
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const outsOf = (id) => flows.filter((e) => e.from === id)

  // entries are explicit — ENTER doors always start chains; an entry fires
  // whenever none of its chains are in flight
  mem.tseq = mem.tseq || 0
  const toks = (mem.tokens = mem.tokens || [])
  for (const e of nodes)
    if (isEntryPart(e) && !toks.some((t) => t.entry === e.id)) toks.push({ id: 't' + mem.tseq++, node: e.id, entry: e.id })

  const kill = (t) => {
    // a dead iteration token frees its loop to advance
    if (t.owner && (mem.loops || {})[t.owner]) mem.loops[t.owner].body = Math.max(0, (mem.loops[t.owner].body || 0) - 1)
  }
  const put = (t) => {
    if (toks.length < 300) toks.push(t)
    else {
      if (!mem.boomed) {
        mem.boomed = true
        log.push('⚠ 300 chains in flight — check for runaway forks')
      }
      kill(t)
    }
  }
  const advance = (t, n, port) => {
    const outs = outsOf(n.id).filter((e) => (port ? e.fromPort === port : e.fromPort !== 'end'))
    if (!outs.length) {
      log.push(`◇ ${n.name || n.kind} — chain end`)
      kill(t)
      return
    }
    for (const e of outs) put({ id: 't' + mem.tseq++, node: e.to, entry: t.entry, owner: t.owner })
  }

  const live = toks.splice(0, toks.length)
  for (const t of live) {
    const n = byId[t.node]
    if (!n) {
      kill(t)
      continue
    }
    if (t.wait) {
      if (!t.ready) {
        put(t)
        continue
      }
      t.wait = null
    }
    if (!t.did) {
      t.did = true
      put(t)
      continue // landed this step — it acts on the next one
    }

    // blocking sys calls stay "opened" until clicked — the chain freezes
    // right here
    if (n.kind === 'syscall' && n.block) {
      if (!t.armed) {
        t.armed = true
        t.wait = 'block'
        log.push(`⏳ sys call "${n.name || ''}" opened — click to return`)
        put(t)
        continue
      }
      callSystem(n, nodes, links, mem, log, assets)
      advance(t, n)
      continue
    }

    if (n.kind === 'syscall') {
      callSystem(n, nodes, links, mem, log, assets)
      advance(t, n)
      continue
    }

    if (n.kind === 'func') {
      // the body lives with the ƒ FUNCTIONS list on the DATA tab; running its
      // parts is future work — today the call is announced and the chain keeps
      // walking, so a func part never breaks a machine
      log.push(n.func ? `ƒ ${n.fName || 'function'} — isolated function called` : 'ƒ ⚠ no function picked — chain passes through')
      advance(t, n)
      continue
    }

    if (n.kind === 'code') {
      // design-time script: validated on the card; no runtime executes it here.
      // The chain passes through so a code part never breaks a machine.
      const fed = (n.inVars || []).filter((v) => dataValue(nodes, links, mem, n.id, v.id))
      log.push(
        `⌨ ${n.name || 'code'} — ${n.lang || 'python'} script${fed.length ? ` (reads ${fed.map((v) => v.name || '?').join(', ')})` : ''}; chain continues`,
      )
      advance(t, n)
      continue
    }

    if (n.kind === 'ifb') {
      const side = (port, custom) => {
        const d = dataValue(nodes, links, mem, n.id, port)
        if (d) return d
        if (custom === undefined || custom === null || custom === '') return null
        const v =
          custom === true || custom === false
            ? custom
            : custom === 'true'
              ? true
              : custom === 'false'
                ? false
                : custom
        return { val: v, from: 'custom' }
      }
      const da = side('__a__', n.aVal)
      const db = side('__b__', n.bVal)
      if (!da || !db) {
        log.push(`⚠ ${n.name || 'if'} — ⇣ ${da ? 'b' : 'a'} has no wire and no custom value — chain dropped`)
        kill(t)
        continue
      }
      if (da.val === null || db.val === null) {
        if (!t.armed) {
          t.armed = true
          log.push(`⏳ ${n.name || 'if'} holding — operand "${da.val === null ? da.from : db.from}" has no value yet`)
        }
        put(t) // producer hasn't fired — wait and retry
        continue
      }
      const num = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : Number(v))
      const x = num(da.val)
      const y = num(db.val)
      const op = n.op || '=='
      if (Number.isNaN(x) || Number.isNaN(y)) {
        log.push(`⚠ ${n.name || 'if'} — cannot compare ${fmt(da.val)} ⟨${op}⟩ ${fmt(db.val)} (not int/bool) — chain dropped`)
        kill(t)
        continue
      }
      const res =
        op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : op === '>=' ? x >= y : op === '!=' ? x !== y : x === y
      ;(mem.ifres = mem.ifres || {})[n.id] = res
      log.push(`${res ? '✓' : '✗'} ${n.name || 'if'}: ${fmt(da.val)} ${op} ${fmt(db.val)} → ${res ? 'true' : 'false'}`)
      advance(t, n, res ? 'true' : 'false')
      continue
    }

    // SWITCH — one ⇣ value picks one flow-out arm by equality: the first case
    // whose typed match equals val fires; nothing matching leaves via default.
    // an unwired arm simply ends the chain — advance already kills on a port
    // with no wire
    if (n.kind === 'switch') {
      const d = dataValue(nodes, links, mem, n.id, '__val__')
      const cv = (n.cVals || {})['__val__']
      const dv = d || (cv === undefined || cv === null || String(cv).trim() === '' ? null : { val: cv, from: 'custom' })
      if (!dv) {
        log.push(`⚠ ${n.name || 'switch'} — ⇣ val has no wire and no custom value — chain dropped`)
        kill(t)
        continue
      }
      if (dv.val === null || dv.val === undefined) {
        if (!t.armed) {
          t.armed = true
          log.push(`⏳ ${n.name || 'switch'} holding — ⇣ val from "${dv.from}" has no value yet`)
        }
        put(t) // producer hasn't fired — wait and retry
        continue
      }
      const hit = (n.cases || []).find((c) => String(dv.val) === String(c.val ?? ''))
      if (hit) {
        log.push(`◆ ${n.name || 'switch'}: ⇣ val ${fmt(dv.val)} equals "${hit.val}" → arm "${hit.label || 'case'}" ▸`)
        advance(t, n, hit.id)
      } else {
        log.push(`◆ ${n.name || 'switch'}: ⇣ val ${fmt(dv.val)} matches no case — default ▸`)
        advance(t, n, 'default')
      }
      continue
    }

    if (MATH[n.kind]) {
      // the chain passes through as the part computes — wired operands wait for
      // their producers to fire (like if does), unwired sides read the card
      const da = dataValue(nodes, links, mem, n.id, '__a__')
      const db = dataValue(nodes, links, mem, n.id, '__b__')
      const waiting = (da && (da.val === null || da.val === undefined)) || (db && (db.val === null || db.val === undefined))
      if (waiting) {
        if (!t.armed)
          log.push(`⏳ ${n.name || n.kind} holding — operand from "${(da && (da.val === null || da.val === undefined) ? da : db).from}" has no number yet`)
        t.armed = true
        put(t)
        continue
      }
      const va = da ? da.val : mathCustom(n, '__a__')
      const vb = db ? db.val : mathCustom(n, '__b__')
      const r = mathVal(nodes, links, mem, n)
      log.push(
        r === null
          ? `∘ ${n.name || n.kind} — ⇡ result stays empty: a side has no number (or the divisor is 0)`
          : `∘ ${n.name || n.kind}: ${fmt(va)} ${MATH[n.kind]} ${fmt(vb)} = ${fmt(r)}`,
      )
      advance(t, n)
      continue
    }

    if (BOOL[n.kind]) {
      // the chain passes through as the part folds its ⇣ bool slots
      const slots = Math.max(2, Number(n.slots ?? 2))
      const sides = Array.from({ length: slots }, (_, i) => dataValue(nodes, links, mem, n.id, `__s${i}__`))
      const wait = sides.find((d) => d && (d.val === null || d.val === undefined))
      if (wait) {
        if (!t.armed)
          log.push(`⏳ ${n.name || n.kind} holding — slot from "${wait.from}" has no bool yet`)
        t.armed = true
        put(t)
        continue
      }
      const r = boolVal(nodes, links, mem, n)
      const fed = sides.filter((d) => d && d.val !== null && d.val !== undefined).length +
        Array.from({ length: slots }, (_, i) => String((n.cVals || {})[`__s${i}__`] ?? '').trim() !== '').filter(Boolean).length
      log.push(
        r === null
          ? `∘ ${n.name || n.kind} — ⇡ result stays empty: no ⇣ slot is wired or typed`
          : `∘ ${n.name || n.kind}: ${fed} fed ⇣ slot${fed === 1 ? '' : 's'} folded ${BOOL[n.kind] === 'all' ? 'all' : 'any'} = ${fmt(r)}`,
      )
      advance(t, n)
      continue
    }

    if (n.kind === 'setg') {
      // write a global as the chain passes — unwired ⇣ leaves it untouched
      if (!n.gRef) {
        log.push(`⚠ ${n.name || 'SET GLOBAL'} — no global selected, chain continues`)
        advance(t, n)
        continue
      }
      const d = dataValue(nodes, links, mem, n.id, '__val__')
      if (d && d.val !== null && d.val !== undefined) {
        ;(mem.g = mem.g || {})[n.gRef] = d.val
        log.push(`⚙ set ⚙ ${n.gName || 'global'} = ${fmt(d.val)} (from ${d.from})`)
      } else log.push(`⚠ ${n.name || 'SET GLOBAL'} — ⇣ ${n.gName || 'value'} unwired, ⚙ ${n.gName || 'global'} unchanged`)
      advance(t, n)
      continue
    }

    if (n.kind === 'for' || n.kind === 'foreach') {
      const loops = (mem.loops = mem.loops || {})
      const st = loops[n.id]
      if (st && st.left > 0) {
        if ((st.body || 0) > 0) {
          // previous iteration's body chain still walking — one iteration at a time
          put(t)
          continue
        }
        st.left -= 1
        st.i += 1
        const cur = ((mem.cur = mem.cur || {})[n.id] =
          n.kind === 'for' ? { i: st.i } : { item: st.arr[st.i - 1], index: st.i - 1 })
        log.push(
          n.kind === 'for'
            ? `↻ ${n.name || 'for'} ${st.i}/${st.total} →`
            : `≡ ${n.name || 'foreach'} ${st.i}/${st.total} item="${cur.item}" →`,
        )
        const body = outsOf(n.id).filter((e) => e.fromPort !== 'end')
        st.body = (st.body || 0) + body.length
        for (const e of body) put({ id: 't' + mem.tseq++, node: e.to, entry: t.entry, owner: n.id })
        put(t) // the loop keeps its token until exhausted
        continue
      }
      if (st && st.left === 0 && !st.ended) {
        if ((st.body || 0) > 0) {
          put(t) // wait for the last body chain to finish before pulsing end
          continue
        }
        st.ended = true
        log.push(`${n.kind === 'for' ? '↻' : '≡'} ${n.name || n.kind} finished (${st.total}) — end ⤳`)
        advance(t, n, 'end')
        continue
      }
      // fresh trigger (first, or restarting after a completed run) — load it
      if (n.kind === 'for') {
        const d = dataValue(nodes, links, mem, n.id, '__to__')
        if (!d) {
          log.push(`⚠ ${n.name || 'for'} — nothing wired to ⇣ to:int — chain dropped`)
          kill(t)
          continue
        }
        if (d.val === null) {
          if (!t.armed) {
            t.armed = true
            log.push(`⏳ ${n.name || 'for'} holding — ⇣ to:int from "${d.from}" hasn't a value yet`)
          }
          put(t) // wait and retry — the producer may still be down the chain
          continue
        }
        const count = Number.isFinite(Number(d.val)) ? Math.floor(Number(d.val)) : null
        if (!count || count <= 0) {
          log.push(`⚠ ${n.name || 'for'} — ⇣ to:int from "${d.from}" is ${fmt(d.val)} — chain dropped`)
          kill(t)
          continue
        }
        loops[n.id] = { left: count, total: count, i: 0, body: 0 }
        log.push(`↻ ${n.name || 'for'}: loaded ${count} iterations`)
        put(t)
      } else {
        const d = dataValue(nodes, links, mem, n.id, '__arr__')
        if (!d) {
          log.push(`⚠ ${n.name || 'foreach'} — nothing wired to ⇣ arr — chain dropped`)
          kill(t)
          continue
        }
        if (d.val === null) {
          if (!t.armed) {
            t.armed = true
            log.push(`⏳ ${n.name || 'foreach'} holding — ⇣ arr from "${d.from}" hasn't fired yet`)
          }
          put(t) // wait and retry — the producer may still be down the chain
          continue
        }
        const arr = Array.isArray(d.val) ? d.val : null
        if (!arr) {
          log.push(
            `⚠ ${n.name || 'foreach'} — ⇣ arr from "${d.from}" is not an array (${fmt(d.val)}) — ` +
              `edit the ⇡ list on "${d.from}"'s card`,
          )
          kill(t)
          continue
        }
        if (!arr.length) {
          log.push(`⚠ ${n.name || 'foreach'} — ⇣ arr from "${d.from}" is empty — add items to the producer's ⇡ list`)
          kill(t)
          continue
        }
        loops[n.id] = { left: arr.length, total: arr.length, i: 0, arr, body: 0 }
        log.push(`≡ ${n.name || 'foreach'}: loaded [${arr.join(', ')}]`)
        put(t)
      }
      continue
    }

    // while — the condition is re-evaluated every round, so a state that turns
    // false down the chain ends the loop honestly; 100 rounds without turning
    // false is a runaway condition, reported and dropped
    if (n.kind === 'while') {
      const loops = (mem.loops = mem.loops || {})
      const st = loops[n.id]
      const cond = () => dataValue(nodes, links, mem, n.id, '__cond__')
      const on = (d) => d.val === true || (typeof d.val === 'number' && d.val !== 0)
      if (st && !st.done) {
        if ((st.body || 0) > 0) {
          put(t) // this round's body chain still walking — one round at a time
          continue
        }
        const d = cond()
        if (!d) {
          log.push(`⚠ ${n.name || 'while'} — nothing wired to ⇣ cond — chain dropped`)
          kill(t)
          continue
        }
        if (d.val === null || d.val === undefined) {
          if (!t.armed) {
            t.armed = true
            log.push(`⏳ ${n.name || 'while'} holding — ⇣ cond from "${d.from}" hasn't a value yet`)
          }
          put(t) // wait and retry — the producer may still be down the chain
          continue
        }
        if (!on(d)) {
          st.done = true
          log.push(`↻ ${n.name || 'while'} ⇣ cond is ${fmt(d.val)} — end ⤳`)
          advance(t, n, 'end')
          continue
        }
        if (st.i >= 100) {
          st.done = true
          log.push(`⚠ ${n.name || 'while'} ran ${st.i} rounds — ⇣ cond never turned false — chain dropped`)
          kill(t)
          continue
        }
        st.i += 1
        log.push(`↻ ${n.name || 'while'} round ${st.i} — ⇣ cond true →`)
        const body = outsOf(n.id).filter((e) => e.fromPort !== 'end')
        st.body = (st.body || 0) + body.length
        for (const e of body) put({ id: 't' + mem.tseq++, node: e.to, entry: t.entry, owner: n.id })
        put(t) // the loop keeps its token until the condition turns false
        continue
      }
      // fresh trigger — evaluate the condition; false on arrival never runs a round
      const d = cond()
      if (!d) {
        log.push(`⚠ ${n.name || 'while'} — nothing wired to ⇣ cond — chain dropped`)
        kill(t)
        continue
      }
      if (d.val === null || d.val === undefined) {
        if (!t.armed) {
          t.armed = true
          log.push(`⏳ ${n.name || 'while'} holding — ⇣ cond from "${d.from}" hasn't a value yet`)
        }
        put(t) // wait and retry — the producer may still be down the chain
        continue
      }
      if (!on(d)) {
        log.push(`⚠ ${n.name || 'while'} — ⇣ cond from "${d.from}" is ${fmt(d.val)} — chain dropped`)
        kill(t)
        continue
      }
      loops[n.id] = { i: 0, body: 0 }
      log.push(`↻ ${n.name || 'while'}: ⇣ cond is true — rounds run until it turns false`)
      put(t)
      continue
    }

    if (n.kind === 'exit' || n.kind === 'exitinst') {
      // the machine ends through this door — the parent graph continues from
      // the matching named port on the MACHINE node, and the door announces
      // each of its variables: whatever is wired into ⇣ inside the machine,
      // else the value typed on the EXIT card. Values ride along in mem.exits
      // so the parent side can consume them one day without replumbing.
      // An EXIT REF behaves as reaching its target: same exit name/id in mem,
      // values read from the instance's ⇣ wires (mirroring the target's vars).
      let target = n
      if (n.kind === 'exitinst') {
        target = nodes.find((x) => x.id === n.exitRef && x.kind === 'exit')
        if (!target) {
          log.push(`⏏ ${n.name || 'exit ref'} — ⚠ target EXIT missing, machine exit dropped`)
          kill(t)
          continue
        }
      }
      const ename = target.name || 'exit'
      const bag = mem.exits || (mem.exits = {})
      const said = (target.vars || []).map((v) => {
        const fedv = dataValue(nodes, links, mem, n.id, v.id)
        const val = fedv && fedv.val !== null ? fedv.val : String(v.value ?? '') === '' ? null : varValue(v)
        return { id: v.id, name: v.name || 'var', type: v.type || 'int', val }
      })
      bag[target.id] = { name: ename, vars: said }
      mem.lastExit = ename
      log.push(
        said.length
          ? `⏏ ${ename} — machine exit${n.kind === 'exitinst' ? ' (via ref)' : ''} · announces ${said.map((v) => `${v.name}: ${v.val === null ? '—' : fmt(v.val)}`).join(' · ')}`
          : `⏏ ${ename} — machine exit${n.kind === 'exitinst' ? ' (via ref)' : ''}`,
      )
      kill(t)
      continue
    }

    // everything else passes the chain through
    advance(t, n)
  }
}

export { fmt, dataValue, callSystem, stepOnce }
