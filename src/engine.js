// The chain engine — the composer's crown jewels, pure and React-free so it
// can be unit-tested and, one day, run headless ("the machine only asks and
// eventually gets an answer").
//
// Chain execution: parts with no flow input are ENTRY POINTS, and their
// chains self-pace — when every token from an entry has reached an end, the
// entry re-fires. A token moves one hop per step. Blocking sys calls and
// actions wait in place for a click. Pools never gate: chains pass through
// them, link circles add/remove pool amounts, and fed ⇣ in pools are live
// windows that write back to their origin value (incl. windows onto ⚙
// globals — the session store object passed as mem.g, shared across machines).
import { resolveCall, kindMeta } from './model.js'

const fmt = (v) =>
  Array.isArray(v)
    ? `[${v.join(', ')}]`
    : v && typeof v === 'object'
      ? `{ ${Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(', ')} }`
      : v

function dataValue(nodes, links, amounts, mem, nodeId, varId, depth = 0) {
  if (depth > 12) return null
  const w = links.find((l) => l.kind === 'data' && l.to === nodeId && l.toPort === varId)
  if (!w) return null
  const src = nodes.find((n) => n.id === w.from)
  if (!src) return null
  if (src.kind === 'pool') return { val: amounts[w.from] ?? 0, from: src.name || 'pool' }
  const cur = (mem.cur || {})[w.from]
  if (src.kind === 'for') return { val: cur?.i ?? null, from: src.name || 'for' }
  if (src.kind === 'foreach') {
    const v = w.fromPort === '__item__' ? cur?.item : w.fromPort === '__idx__' ? cur?.index : null
    return { val: v === undefined ? null : v, from: src.name || 'foreach' }
  }
  if (src.kind === 'inspect') {
    const o = dataValue(nodes, links, amounts, mem, src.id, '__obj__', depth + 1)
    const obj = o && typeof o.val === 'object' && o.val !== null && !Array.isArray(o.val) ? o.val : null
    const f = (src.fields || []).find((x) => x.id === w.fromPort)
    const v = obj && f ? obj[f.name || 'field'] : null
    return { val: v === undefined ? null : v, from: `${src.name || 'inspect'}.${f?.name || '?'}` }
  }
  if (src.kind === 'ifb') return { val: (mem.ifres || {})[w.from] ?? null, from: src.name || 'if' }
  if (src.kind === 'getg') return { val: (mem.g || {})[src.gRef] ?? null, from: `⚙ ${src.gName || 'global'}` }
  const v = (mem.call || {})[w.from]?.[w.fromPort]
  return { val: v === undefined ? null : v, from: src.name || 'sys call' }
}

// Trace where a ⇣ value comes from and return its mutable cell:
//   { key(), get(), set?(v) }
// key identifies the origin value — a new foreach iteration means a new key
// (re-seed). set exists when the machine may write the value back to origin.
function originRef(nodes, links, a, mem, nodeId, varId, depth = 0) {
  if (depth > 12) return null
  const w = links.find((l) => l.kind === 'data' && l.to === nodeId && l.toPort === varId)
  if (!w) return null
  const src = nodes.find((n) => n.id === w.from)
  if (!src) return null
  if (src.kind === 'pool') {
    return { key: () => 'pl:' + src.id, get: () => a[src.id] ?? 0, set: (v) => { a[src.id] = v } }
  }
  if (src.kind === 'getg') {
    // a window onto a ⚙ global — writes land in the SESSION store, so a pool
    // that an ADD pushes through permanently moves the global across machines
    if (!src.gRef) return null
    return {
      key: () => 'g:' + src.gRef,
      get: () => (mem.g || {})[src.gRef],
      set: (v) => {
        mem.g = mem.g || {}
        mem.g[src.gRef] = v
      },
    }
  }
  if (src.kind === 'for') {
    const c = (mem.cur || {})[src.id]
    return c ? { key: () => 'for:' + src.id, get: () => c.i } : null
  }
  if (src.kind === 'foreach') {
    const m = (mem.loops || {})[src.id]
    if (!m || !Array.isArray(m.arr) || m.i < 1) return null
    const idx = m.i - 1 // pinned — write back to THIS element even if the loop advances
    if (w.fromPort === '__idx__') return { key: () => `fe:${src.id}:${idx}`, get: () => idx }
    return { key: () => `fe:${src.id}:${idx}`, get: () => m.arr[idx], set: (v) => { m.arr[idx] = v } }
  }
  if (src.kind === 'inspect') {
    const f = (src.fields || []).find((x) => x.id === w.fromPort)
    if (!f) return null
    const parent = originRef(nodes, links, a, mem, src.id, '__obj__', depth + 1)
    if (!parent) return null
    const name = f.name || 'field'
    const obj = () => {
      const o = parent.get()
      return o && typeof o === 'object' && !Array.isArray(o) ? o : null
    }
    return {
      key: () => parent.key() + ':' + f.id,
      get: () => {
        const o = obj()
        return o ? o[name] : null
      },
      set: parent.set
        ? (v) => {
            const o = obj()
            if (o) o[name] = v
          }
        : undefined,
    }
  }
  // sys call output — its current value cell, writable until the call re-fires
  return {
    key: () => 'call:' + src.id + ':' + w.fromPort,
    get: () => (mem.call || {})[src.id]?.[w.fromPort],
    set: (v) => {
      mem.call = mem.call || {}
      ;(mem.call[src.id] = mem.call[src.id] || {})[w.fromPort] = v
    },
  }
}

function callSystem(n, nodes, links, a, mem, log, assets) {
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
    const d = dataValue(nodes, links, a, mem, n.id, v.id)
    if (!d) log.push(`    ⚠ in ${v.name || '?'}:${v.type || '?'} — no data wire`)
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

// Chain execution: parts with no flow input are ENTRY POINTS, and their
// chains self-pace — when every token from an entry has reached an end, the
// entry re-fires. A token moves one hop per step. Blocking sys calls and
// actions wait in place for a click. Pools never gate: chains pass through
// them, link circles add/remove pool amounts, and fed ⇣ in pools are live
// windows that write back to their origin value.
function stepOnce(nodes, links, prev, log, mem = {}, assets = []) {
  const a = { ...prev }
  const flows = links.filter((l) => l.kind !== 'data')
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const outsOf = (id) => flows.filter((e) => e.from === id)
  const insOf = (id) => flows.filter((e) => e.to === id)
  // fed pools are windows, not buckets — chain arithmetic never touches them
  const fed = new Set(
    links.filter((l) => l.kind === 'data' && l.toPort === '__in__').map((l) => l.to),
  )
  const p = (id) => (byId[id] && byId[id].kind === 'pool' && !fed.has(id) ? byId[id] : null)
  const hasPorts = (n) => ((kindMeta(n).ports || (() => []))(n) || []).length > 0

  // fed pools are live windows onto their origin value: seed here, write
  // back at the end of the step
  const windows = []
  for (const n of nodes) {
    if (n.kind !== 'pool') continue
    const ref = originRef(nodes, links, a, mem, n.id, '__in__')
    if (!ref) continue
    windows.push({ n, ref })
    const k = ref.key()
    const v = ref.get()
    if (!ref.set || (mem.fedKey || {})[n.id] !== k) {
      if (typeof v === 'number' && Number.isFinite(v)) a[n.id] = v
    }
    ;(mem.fedKey = mem.fedKey || {})[n.id] = k
  }

  // an entry fires whenever none of its chains are in flight
  mem.tseq = mem.tseq || 0
  const toks = (mem.tokens = mem.tokens || [])
  for (const e of nodes)
    if (e.kind !== 'drain' && e.kind !== 'add' && e.kind !== 'setg' && e.kind !== 'exit' && hasPorts(e) && !insOf(e.id).length && !toks.some((t) => t.entry === e.id))
      toks.push({ id: 't' + mem.tseq++, node: e.id, entry: e.id })

  const qBudget = {}
  for (const n of nodes) if (n.kind === 'queue') qBudget[n.id] = n.rate ?? 1

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
  const advance = (t, n, port, arith = true) => {
    // drains/adds subtract or add with their own rules — never double-charge on pass-through
    if (arith && n.kind !== 'drain' && n.kind !== 'add') for (const e of insOf(n.id)) if (p(e.from)) a[e.from] = Math.max(0, (a[e.from] || 0) - (e.amount ?? 1))
    const outs = outsOf(n.id).filter((e) => (port ? e.fromPort === port : e.fromPort !== 'end'))
    for (const e of outs) if (p(e.to)) a[e.to] = (a[e.to] || 0) + (e.amount ?? 1)
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

    // click-gated parts: actions wait to fire; blocking sys calls stay
    // "opened" until clicked — the chain freezes right here
    if (n.kind === 'action' || (n.kind === 'syscall' && n.block)) {
      if (!t.armed) {
        t.armed = true
        t.wait = n.kind === 'action' ? 'click' : 'block'
        log.push(
          n.kind === 'action'
            ? `▶ ${n.name || 'action'} — waiting for click`
            : `⏳ sys call "${n.name || ''}" opened — click to return`,
        )
        put(t)
        continue
      }
      if (n.kind === 'action') {
        if (insOf(n.id).some((e) => p(e.from) && (a[e.from] || 0) < (e.amount ?? 1))) {
          if (mem.short !== n.id) log.push(`▶ ${n.name || 'action'} — not enough pool tokens to fire`)
          mem.short = n.id
          put(t)
          continue
        }
        mem.short = null
        log.push(`▶ ${n.name || 'action'} fired`)
      } else {
        callSystem(n, nodes, links, a, mem, log, assets)
      }
      advance(t, n)
      continue
    }

    if (n.kind === 'syscall') {
      callSystem(n, nodes, links, a, mem, log, assets)
      advance(t, n)
      continue
    }

    if (n.kind === 'delay') {
      if (!t.armed) {
        t.armed = true
        t.hold = Math.max(1, n.delay ?? 3)
      }
      if (t.hold > 0) {
        t.hold -= 1
        put(t)
        continue
      }
      log.push(`⏳ ${n.name || 'delay'} released`)
      advance(t, n)
      continue
    }

    if (n.kind === 'queue') {
      if ((qBudget[n.id] || 0) > 0) {
        qBudget[n.id] -= 1
        advance(t, n)
      } else put(t) // backed up — waits its turn
      continue
    }

    if (n.kind === 'register') {
      const r = (mem.reg = mem.reg || {})
      r[n.id] = (r[n.id] || 0) + 1
      if (r[n.id] >= (n.countTo ?? 2)) {
        r[n.id] = 0
        log.push(`🔢 ${n.name || 'register'} pulsed (every ${n.countTo ?? 2})`)
        advance(t, n)
      } else kill(t) // absorbed until the count fills
      continue
    }

    if (n.kind === 'randgate') {
      if (Math.random() < 0.5) {
        log.push(`🎲 ${n.name || 'rand gate'} closed — chain dropped`)
        kill(t)
        continue
      }
      advance(t, n)
      continue
    }

    if (n.kind === 'ifb') {
      const side = (port, custom) => {
        const d = dataValue(nodes, links, a, mem, n.id, port)
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

    if (n.kind === 'drain') {
      // chain end — removes its amount from every upstream pool (fed ⇣ in:int dictates)
      const fedIn = links.some((l) => l.kind === 'data' && l.to === n.id && l.toPort === '__in__')
      let want = n.drain ?? null
      if (fedIn) {
        const d = dataValue(nodes, links, a, mem, n.id, '__in__')
        const x = d && Number.isFinite(Number(d.val)) ? Number(d.val) : 0
        want = Math.max(0, Math.floor(x))
      }
      for (const e of insOf(n.id)) {
        const s = byId[e.from] && byId[e.from].kind === 'pool' ? byId[e.from] : null
        if (!s) continue
        const take = Math.min(a[e.from] || 0, want ?? e.amount ?? 1)
        if (take > 0) {
          a[e.from] -= take
          log.push(`🕳 ${n.name || 'drain'} ⟵ −${take} ${s.name || 'pool'} = ${a[e.from]}`)
        }
      }
      advance(t, n) // the chain continues out — what follows reads the drained value
      continue
    }

    if (n.kind === 'add') {
      // drain's mirror — adds its (possibly negative) amount to every upstream pool
      const fedIn = links.some((l) => l.kind === 'data' && l.to === n.id && l.toPort === '__in__')
      let want = n.gain ?? 1
      if (fedIn) {
        const d = dataValue(nodes, links, a, mem, n.id, '__in__')
        want = d && Number.isFinite(Number(d.val)) ? Math.round(Number(d.val)) : 0
      }
      for (const e of insOf(n.id)) {
        const s = byId[e.from] && byId[e.from].kind === 'pool' ? byId[e.from] : null
        if (!s) continue
        a[e.from] = (a[e.from] || 0) + want
        log.push(`⊕ ${n.name || 'add'} ⟶ ${want >= 0 ? '+' : ''}${want} ${s.name || 'pool'} = ${a[e.from]}`)
      }
      advance(t, n)
      continue
    }

    if (n.kind === 'setg') {
      // write a global as the chain passes — unwired ⇣ leaves it untouched
      if (!n.gRef) {
        log.push(`⚠ ${n.name || 'SET'} — no global selected, chain continues`)
        advance(t, n)
        continue
      }
      const d = dataValue(nodes, links, a, mem, n.id, '__val__')
      if (d && d.val !== null && d.val !== undefined) {
        mem.g[n.gRef] = d.val
        log.push(`⚙ set ⚙ ${n.gName || 'global'} = ${fmt(d.val)} (from ${d.from})`)
      } else log.push(`⚠ ${n.name || 'SET'} — ⇣ ${n.gName || 'value'} unwired, ⚙ ${n.gName || 'global'} unchanged`)
      advance(t, n)
      continue
    }

    if (n.kind === 'for' || n.kind === 'foreach') {
      const loops = (mem.loops = mem.loops || {})
      const st = loops[n.id]
      if (st && st.left > 0) {
        if ((st.body || 0) > 0) {
          // previous iteration's body chain still walking — one iteration at a time,
          // so pool windows never bleed across iterations
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
        for (const e of body) if (p(e.to)) a[e.to] = (a[e.to] || 0) + (e.amount ?? 1)
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
        advance(t, n, 'end', false)
        continue
      }
      // fresh trigger (first, or restarting after a completed run) — load it
      if (n.kind === 'for') {
        const d = dataValue(nodes, links, a, mem, n.id, '__to__')
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
        for (const e of insOf(n.id)) if (p(e.from)) a[e.from] = Math.max(0, (a[e.from] || 0) - (e.amount ?? 1))
        loops[n.id] = { left: count, total: count, i: 0, body: 0 }
        log.push(`↻ ${n.name || 'for'}: loaded ${count} iterations`)
        put(t)
      } else {
        const d = dataValue(nodes, links, a, mem, n.id, '__arr__')
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
        for (const e of insOf(n.id)) if (p(e.from)) a[e.from] = Math.max(0, (a[e.from] || 0) - (e.amount ?? 1))
        loops[n.id] = { left: arr.length, total: arr.length, i: 0, arr, body: 0 }
        log.push(`≡ ${n.name || 'foreach'}: loaded [${arr.join(', ')}]`)
        put(t)
      }
      continue
    }

    if (n.kind === 'exit') {
      // the machine ends through this door — the parent graph continues from
      // the matching named port on the MACHINE node
      mem.lastExit = n.name || 'exit'
      log.push(`⏏ ${n.name || 'exit'} — machine exit`)
      kill(t)
      continue
    }

    // everything else passes the chain through: source, pool, converter, gate, trader
    advance(t, n)
  }

  // write pool windows back into their origins — the value is always written
  // back, so the next read anywhere sees the change
  for (const { n, ref } of windows) {
    if (!ref.set) continue
    const v = a[n.id]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    if (ref.get() === v) continue
    ref.set(Math.round(v * 1e6) / 1e6)
    log.push(`✎ ${n.name || 'pool'} ⇢ origin = ${Math.round(v * 1e6) / 1e6}`)
  }
  return a
}


export { fmt, dataValue, originRef, callSystem, stepOnce }
