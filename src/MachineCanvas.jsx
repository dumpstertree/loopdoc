// The machine canvas: full-screen Machinations-style economy sim editing.
// Same node card / port / data-wire machinery as the flow canvas — only the
// simulation semantics are unique: tokens move between pools each step,
// actions fire on click (and advance one tick), sys calls fire on flow.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import NodeCard from './NodeCard.jsx'
import { KINDS, kindsFor, uid, newNode, patchNode, pruneLinks, resolveCall, dataPortType, fnSig, fieldsOf, kindMeta } from './model.js'

// ---- simulation ------------------------------------------------------------
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
    const d = dataValue(nodes, links, a, mem, n.id, v.id)
    if (!d) log.push(`    ⚠ in ${v.name || '?'}:${v.type || '?'} — no data wire`)
    else if (d.val === null) log.push(`    ⇂ ${v.name || '?'}:${v.type || '?'} = ⋯ ("${d.from}" never fired)`)
    else log.push(`    ⇂ ${v.name || '?'}:${v.type || '?'} = ${fmt(d.val)} ← "${d.from}"`)
  }
  for (const v of r.fn.outputs || []) {
    made[v.id] = n.out?.[v.id] ?? 0
    log.push(`    ⇡ ${v.name || '?'}:${v.type || '?'} = ${fmt(made[v.id])} (sim value)`)
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
    if (e.kind !== 'drain' && hasPorts(e) && !insOf(e.id).length && !toks.some((t) => t.entry === e.id))
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
    if (arith) for (const e of insOf(n.id)) if (p(e.from)) a[e.from] = Math.max(0, (a[e.from] || 0) - (e.amount ?? 1))
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
      kill(t) // the drain is an end of the chain
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
        const count = d && d.val !== null && Number.isFinite(Number(d.val)) ? Math.floor(Number(d.val)) : null
        if (!count || count <= 0) {
          log.push(`⚠ ${n.name || 'for'} — ⇣ to:int is ${d ? 'not a number' : 'unwired'} — chain dropped`)
          kill(t)
          continue
        }
        for (const e of insOf(n.id)) if (p(e.from)) a[e.from] = Math.max(0, (a[e.from] || 0) - (e.amount ?? 1))
        loops[n.id] = { left: count, total: count, i: 0, body: 0 }
        log.push(`↻ ${n.name || 'for'}: loaded ${count} iterations`)
        put(t)
      } else {
        const d = dataValue(nodes, links, a, mem, n.id, '__arr__')
        const arr = d && Array.isArray(d.val) && d.val.length ? d.val : null
        if (!arr) {
          log.push(`⚠ ${n.name || 'foreach'} — ⇣ arr is ${d ? 'not a wired array' : 'unwired'} — chain dropped`)
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

// ---- editor ------------------------------------------------------------------
// straight lines with 90° turns: horizontal → vertical → horizontal,
// plus the midpoint of the (vertical) leg where the amount circle sits
const orth = (sx, sy, tx, ty) => {
  const mx = sx + Math.max(30, (tx - sx) / 2)
  return { d: `M ${sx} ${sy} L ${mx} ${sy} L ${mx} ${ty} L ${tx} ${ty}`, mid: { x: mx, y: (sy + ty) / 2 } }
}

export default function MachineCanvas({ graph, assets, types, onChange }) {
  const [sim, setSim] = useState(null)
  const [drag, setDrag] = useState(null)
  const [sel, setSel] = useState(null) // selected link id
  const selRef = useRef(sel)
  selRef.current = sel
  const [selNode, setSelNode] = useState(null) // selected node id
  const selNodeRef = useRef(selNode)
  selNodeRef.current = selNode
  const [portXY, setPortXY] = useState({})
  const [msg, setMsg] = useState(null)
  const surfaceRef = useRef(null)
  const graphRef = useRef(graph)
  graphRef.current = graph
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const simRef = useRef(sim)
  simRef.current = sim

  const warn = (m) => {
    setMsg(m)
    setTimeout(() => setMsg((x) => (x === m ? null : x)), 3200)
  }

  const mutate = (fn) => onChange(fn(graphRef.current))
  const patch = (id, p) => mutate((g) => pruneLinks(patchNode(g, id, p), assets, id))
  const surfacePoint = (e) => {
    const r = surfaceRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const addNode = (kind) =>
    mutate((g) => ({ ...g, nodes: [...g.nodes, newNode(kind, 140 + Math.random() * 180, 100 + Math.random() * 140)] }))
  const delNode = (id) =>
    mutate((g) => ({ ...g, nodes: g.nodes.filter((n) => n.id !== id), links: g.links.filter((l) => l.from !== id && l.to !== id) }))

  const onHeaderDown = (e, id) => {
    if (e.button !== 0) return
    const n = graphRef.current.nodes.find((x) => x.id === id)
    const p = surfacePoint(e)
    setDrag({ kind: 'node', id, dx: p.x - n.x, dy: p.y - n.y })
  }
  const onPortDown = (e, id, portId) => {
    const p = surfacePoint(e)
    setDrag({ kind: 'flow', from: id, port: portId || 'out', x: p.x, y: p.y })
  }
  const onDataPortDown = (e, id, portId) => {
    const p = surfacePoint(e)
    setDrag({ kind: 'data', from: id, port: portId, x: p.x, y: p.y })
  }
  const addDataLink = (from, fromPort, to, toPort) => {
    const ta = dataPortType(graphRef.current, assets, from, fromPort, 'out')
    const tb = dataPortType(graphRef.current, assets, to, toPort, 'in')
    if (!ta || !tb) return warn('⚠ that data port no longer exists')
    if (!(ta === tb || tb === 'any' || (tb === 'array' && ta.includes('[]'))))
      return warn(`⚠ type mismatch — ⇡ ${ta} cannot feed ⇣ ${tb}`)
    mutate((g) => ({
      ...g,
      links: [
        ...g.links.filter((l) => !(l.kind === 'data' && l.to === to && l.toPort === toPort)),
        { id: uid('lk'), kind: 'data', from, fromPort, to, toPort },
      ],
      // foreach learns its item type from the array wired in;
      // inspect learns its type and grows one ⇡ per field
      nodes:
        toPort === '__arr__'
          ? g.nodes.map((n) => (n.id === to && n.kind === 'foreach' ? { ...n, itemType: ta.replace('[]', '') } : n))
          : toPort === '__obj__'
            ? g.nodes.map((n) => {
                if (n.id !== to || n.kind !== 'inspect') return n
                const td = (types || []).find((t) => (t.name || '').trim().toLowerCase() === ta)
                return { ...n, objType: td ? td.name : ta, fields: fieldsOf(types, ta) || [] }
              })
            : g.nodes,
    }))
  }

  // keep inspect in sync with the type registry (fields declared or edited
  // after wiring, legacy lowercase objTypes) and drop any flow links that
  // passed through it — inspect is pure data now
  useEffect(() => {
    const g = graphRef.current
    let nodesChanged = false
    let nodes = g.nodes.map((n) => {
      if (n.kind !== 'inspect' || !n.objType || n.objType === 'any') return n
      const f = fieldsOf(types, n.objType)
      if (!f) return n
      if (JSON.stringify(f) === JSON.stringify(n.fields || [])) return n
      nodesChanged = true
      const td = (types || []).find((t) => (t.name || '').trim().toLowerCase() === n.objType.toLowerCase())
      return { ...n, objType: td.name, fields: f }
    })
    let g2 = { ...g, nodes }
    for (const n of g.nodes) if (n.kind === 'inspect') g2 = pruneLinks(g2, assets, n.id)
    if (nodesChanged || g2.links.length !== g.links.length) onChangeRef.current(g2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types])

  useEffect(() => {
    if (!drag) return
    const onMove = (e) => {
      const p = surfacePoint(e)
      if (drag.kind === 'node')
        mutate((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === drag.id ? { ...n, x: Math.max(0, p.x - drag.dx), y: Math.max(0, p.y - drag.dy) } : n)) }))
      else setDrag((d) => ({ ...d, x: p.x, y: p.y }))
    }
    const onUp = (e) => {
      if (drag.kind === 'flow') {
        const el = document.elementFromPoint(e.clientX, e.clientY)
        const t = el && el.closest('[data-node-id]')
        if (t) {
          const to = t.getAttribute('data-node-id')
          const tn = graphRef.current.nodes.find((x) => x.id === to)
          const noFlowIn =
            tn && !((kindMeta(tn).ports || (() => []))(tn) || []).some((p) => p.dir === 'in')
          if (noFlowIn)
            warn(`⚠ ${(kindMeta(tn).label || tn.kind || '').toUpperCase()} takes no flow — it is pure data`)
          else if (to !== drag.from)
            mutate((g) => ({
              ...g,
              links: [
                ...g.links.filter((l) => l.kind === 'data' || !(l.from === drag.from && l.to === to)),
                { id: uid('lk'), kind: 'flow', from: drag.from, fromPort: drag.port || 'out', to, toPort: 'in', amount: 1 },
              ],
            }))
        }
      } else if (drag.kind === 'data') {
        const el = document.elementFromPoint(e.clientX, e.clientY)
        const pin = el && el.closest('[data-port]')
        if (pin) {
          const [toNode, toPort, dir] = pin.getAttribute('data-port').split(':')
          if (dir !== 'in') warn('⚠ data flows ⇡ out → ⇣ in')
          else if (toNode === drag.from) warn('⚠ a part cannot feed itself')
          else addDataLink(drag.from, drag.port, toNode, toPort)
        }
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag && drag.kind, drag && drag.id, drag && drag.from])

  // Del removes the selected link or node, Esc deselects
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === 'Escape') {
        setSel(null)
        setSelNode(null)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && (selRef.current || selNodeRef.current)) {
        e.preventDefault()
        if (selRef.current) {
          const id = selRef.current
          setSel(null)
          const g = graphRef.current
          const dead = g.links.find((l) => l.id === id)
          let nodes = g.nodes
          let links = g.links.filter((l) => l.id !== id)
          // unwiring obj resets inspect — its field ports disappear with it
          const t =
            dead && dead.kind === 'data' && dead.toPort === '__obj__'
              ? g.nodes.find((n) => n.id === dead.to && n.kind === 'inspect')
              : null
          if (t) {
            nodes = nodes.map((n) => (n.id === t.id ? { ...n, objType: 'any', fields: [] } : n))
            links = links.filter((l) => !(l.kind === 'data' && l.from === t.id))
          }
          onChangeRef.current({ ...g, nodes, links })
        } else {
          const id = selNodeRef.current
          setSelNode(null)
          onChangeRef.current({
            ...graphRef.current,
            nodes: graphRef.current.nodes.filter((n) => n.id !== id),
            links: graphRef.current.links.filter((l) => l.from !== id && l.to !== id),
          })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // measure flow + data ports
  const portPosRef = useRef(portXY)
  const measure = () => {
    const surf = surfaceRef.current
    if (!surf) return
    const r = surf.getBoundingClientRect()
    const pos = {}
    surf.querySelectorAll('[data-port]').forEach((el) => {
      const b = el.getBoundingClientRect()
      pos[el.getAttribute('data-port')] = { x: b.left + b.width / 2 - r.left, y: b.top + b.height / 2 - r.top }
    })
    const prev = portPosRef.current
    const keys = Object.keys(pos)
    const same = keys.length === Object.keys(prev).length && keys.every((k) => prev[k] && prev[k].x === pos[k].x && prev[k].y === pos[k].y)
    if (same) return
    portPosRef.current = pos
    setPortXY(pos)
  }
  useLayoutEffect(measure)

  // ---- sim controls ----------------------------------------------------------
  const diagnostics = () => {
    const out = []
    const g = graphRef.current
    const flows = g.links.filter((l) => l.kind !== 'data')
    const entries = g.nodes.filter(
      (n) => n.kind !== 'drain' && ((KINDS[n.kind]?.ports || (() => []))(n) || []).length > 0 && !flows.some((l) => l.to === n.id),
    )
    if (!entries.length) out.push('⚠ nothing to run — parts with no flow input are chain entry points')
    else out.push(`ℹ ${entries.length} chain ${entries.length === 1 ? 'entry' : 'entry points'} — they re-run whenever their chain finishes`)
    for (const n of g.nodes.filter((x) => x.kind === 'syscall'))
      if (!resolveCall((n.calls || [])[0], assets)) out.push(`⚠ sys call "${n.name || ''}" has no system fn selected`)
    return out
  }
  const startSim = () =>
    setSim({
      amounts: Object.fromEntries(graphRef.current.nodes.filter((n) => n.kind === 'pool').map((n) => [n.id, n.init || 0])),
      mem: { tokens: [] },
      log: ['— chain simulation started —', ...diagnostics()],
      steps: 0,
    })
  const stepN = (k = 1) =>
    setSim((s) => {
      if (!s) return s
      const g = graphRef.current
      let amounts = s.amounts
      const log = [...s.log]
      const mem = JSON.parse(JSON.stringify(s.mem || {}))
      for (let i = 0; i < k; i++) {
        amounts = stepOnce(g.nodes, g.links, amounts, log, mem, assets)
        log.push(`— step ${s.steps + i + 1} —`)
      }
      return { amounts, mem, log: log.slice(-400), steps: s.steps + k }
    })
  // clicking a part releases the chain token waiting there (action / ⏳ block)
  const clickNode = (id) => {
    if (!simRef.current) return
    setSim((s) => {
      if (!s) return s
      const g = graphRef.current
      const mem = JSON.parse(JSON.stringify(s.mem || {}))
      const toks = (mem.tokens || []).filter((t) => t.node === id && t.wait)
      if (!toks.length) return s
      toks.forEach((t) => {
        t.ready = true
      })
      const log = [...s.log]
      const amounts = stepOnce(g.nodes, g.links, s.amounts, log, mem, assets)
      return { amounts, mem, log: log.slice(-400), steps: s.steps + 1 }
    })
  }

  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]))
  const startOf = (l) => portXY[`${l.from}:${l.fromPort}:out`] || (byId[l.from] ? { x: byId[l.from].x + 184, y: byId[l.from].y + 16 } : null)
  const endOf = (l) => portXY[`${l.to}:${l.toPort}:in`] || (byId[l.to] ? { x: byId[l.to].x, y: byId[l.to].y + 16 } : null)

  return (
    <>
      <div className="graph-toolbar">
        <span className="tb-label">ADD</span>
        {kindsFor('machine').map((k) => (
          <button key={k} className="tb-btn" title={KINDS[k].hint} onClick={() => addNode(k)}>
            {KINDS[k].label}
          </button>
        ))}
        <span className="tb-hint">chains run from unconnected parts · drag ▢ out → part · click ○ = amount · click ⏳/▶ part to continue · Del removes selection</span>
        <span className="spacer" />
        {sim ? (
          <>
            <button className="btn" onClick={() => stepN(1)}>step</button>
            <button className="btn" onClick={() => stepN(10)}>step ×10</button>
            <button className="btn" onClick={() => setSim(null)}>■ stop</button>
            <button className="btn" onClick={startSim}>↺ reset</button>
          </>
        ) : (
          <button className="btn btn-hi" onClick={startSim} disabled={!graph.nodes.some((n) => n.kind === 'pool' || n.kind === 'syscall')}>
            ▶ simulate
          </button>
        )}
        {msg && <span className="warn">{msg}</span>}
      </div>
      <div className="machine-view">
        <div className="canvas-wrap">
          <div className="canvas-scroll">
            <div ref={surfaceRef} className="canvas-surface" style={{ width: 2600, height: 1800 }} onPointerDown={(e) => { if (!e.target.closest('.edge') && !e.target.closest('.nd')) { setSel(null); setSelNode(null) } }}>
              <svg className="edges" width={2600} height={1800}>
                <defs>
                  <marker id="marw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" className="arrow-head-flow" />
                  </marker>
                  <marker id="marw-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" className="arrow-head-sel" />
                  </marker>
                  <marker id="marw-data" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" className="arrow-head-data" />
                  </marker>
                </defs>
                {graph.links.map((l) => {
                  if (l.kind === 'data') return null
                  const a = startOf(l)
                  const b = endOf(l)
                  if (!a || !b) return null
                  const { d, mid } = orth(a.x, a.y, b.x, b.y)
                  const isSel = sel === l.id
                  return (
                    <g
                      key={l.id}
                      className={`edge ${isSel ? 'edge-sel' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSel(l.id)
                      }}
                    >
                      <title>flow — click selects · Del removes</title>
                      <path d={d} className="edge-hit" />
                      <path d={d} className="edge-line" markerEnd={isSel ? 'url(#marw-sel)' : 'url(#marw)'} />
                      <circle
                        className="edge-amt"
                        cx={mid.x}
                        cy={mid.y}
                        r={9}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSel(l.id)
                          const v = window.prompt('tokens transferred per flow:', String(l.amount ?? 1))
                          if (v === null) return
                          const n = Number(v)
                          if (Number.isFinite(n) && n >= 0) mutate((g) => ({ ...g, links: g.links.map((x) => (x.id === l.id ? { ...x, amount: n } : x)) }))
                        }}
                      >
                        <title>amount — click to change</title>
                      </circle>
                      <text className="edge-amt-text" x={mid.x} y={mid.y + 3.5} textAnchor="middle">
                        {l.amount ?? 1}
                      </text>
                    </g>
                  )
                })}
                {graph.links.map((l) => {
                  if (l.kind !== 'data') return null
                  const a = portXY[`${l.from}:${l.fromPort}:out`]
                  const b = portXY[`${l.to}:${l.toPort}:in`]
                  if (!a || !b) return null
                  const { d } = orth(a.x, a.y, b.x, b.y)
                  return (
                    <g
                      key={l.id}
                      className={`edge edge-data ${sel === l.id ? 'edge-sel' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSel(l.id)
                      }}
                    >
                      <title>data wire — click selects · Del removes</title>
                      <path d={d} className="edge-hit" />
                      <path d={d} className="edge-line" markerEnd={sel === l.id ? 'url(#marw-sel)' : 'url(#marw-data)'} />
                    </g>
                  )
                })}
                {drag && (drag.kind === 'flow' || drag.kind === 'data') && portXY[`${drag.from}:${drag.kind === 'flow' ? 'out' : drag.port}:out`] && (
                  <path
                    d={
                      orth(
                        portXY[`${drag.from}:${drag.kind === 'flow' ? 'out' : drag.port}:out`].x,
                        portXY[`${drag.from}:${drag.kind === 'flow' ? 'out' : drag.port}:out`].y,
                        drag.x,
                        drag.y,
                      ).d
                    }
                    className="edge-temp"
                    stroke={drag.kind === 'data' ? 'var(--mint)' : undefined}
                  />
                )}
              </svg>
              {graph.nodes.map((n) => (
                <NodeCard
                  key={n.id}
                  node={n}
                  graph={graph}
                  assets={assets}
                  types={types}
                  selected={selNode === n.id}
                  isEntry={false}
                  sim={sim}
                  onCardClick={clickNode}
                  onPatch={(p) => patch(n.id, p)}
                  onDelete={delNode}
                  onSelect={(id) => {
                    setSelNode(id)
                    setSel(null)
                  }}
                  onToggleEntry={() => {}}
                  onOpenGraph={() => {}}
                  onPortDown={onPortDown}
                  onDataPortDown={onDataPortDown}
                  onHeaderDown={onHeaderDown}
                />
              ))}
              {graph.nodes.length === 0 && (
                <div className="canvas-empty">
                  <p>
                    <b>Empty machine.</b> Add parts from the bar above: POOLS hold tokens, SOURCES pour them in,
                    CONVERTERS/GATES move them around, ACTIONs fire on click, SYS CALLs call ⚙️ systems on flow.
                  </p>
                  <p>chain sim — every part with no flow input is an entry point; chains walk downstream one hop per step and the entry re-runs when its chains end · click ○ = amount · teal squares wire typed data · click ⏳/▶ parts to continue a frozen chain · pools with ⇣ in write back to their origin.</p>
                </div>
              )}
            </div>
          </div>
        </div>
        {sim && (
          <aside className="sim-panel">
            <div className="log-title">SIM LOG — {sim.steps} STEPS</div>
            <div className="log-box">
              {sim.log.map((l, i) => (
                <div key={i} className="log-line">
                  {l}
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
    </>
  )
}
