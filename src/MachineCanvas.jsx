// The machine canvas: full-screen Machinations-style economy sim editing.
// Same node card / port / data-wire machinery as the flow canvas — only the
// simulation semantics are unique: tokens move between pools each step,
// actions fire on click (and advance one tick), sys calls fire on flow.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import NodeCard from './NodeCard.jsx'
import { KINDS, kindsFor, uid, newNode, patchNode, pruneLinks, resolveCall, dataPortType, fnSig } from './model.js'

// ---- simulation ------------------------------------------------------------
const fmt = (v) => (Array.isArray(v) ? `[${v.join(', ')}]` : v)

function dataValue(nodes, links, amounts, mem, nodeId, varId) {
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
  const v = (mem.call || {})[w.from]?.[w.fromPort]
  return { val: v === undefined ? null : v, from: src.name || 'sys call' }
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

function stepOnce(nodes, links, prev, log, mem = {}, assets = []) {
  const a = { ...prev }
  const pool = (id) => nodes.find((n) => n.id === id && n.kind === 'pool')
  const flows = links.filter((l) => l.kind !== 'data')
  // sources fill downstream pools
  for (const n of nodes) {
    if (n.kind !== 'source' || n.auto === false) continue
    for (const e of flows.filter((e) => e.from === n.id)) {
      const s = pool(e.to)
      if (!s) continue
      a[e.to] = (a[e.to] || 0) + (e.amount ?? 1)
      log.push(`⤴ ${n.name || 'source'} → +${e.amount ?? 1} ${s.name || 'pool'} = ${a[e.to]}`)
    }
  }
  // converters cascade
  const fired = new Set()
  for (let pass = 0; pass < nodes.length; pass++) {
    let any = false
    for (const n of nodes) {
      if (n.kind !== 'converter' || fired.has(n.id)) continue
      const ins = flows.filter((e) => e.to === n.id)
      const outs = flows.filter((e) => e.from === n.id)
      if (!ins.length || ins.some((e) => !pool(e.from))) continue
      if (ins.some((e) => (a[e.from] || 0) < (e.amount ?? 1))) continue
      fired.add(n.id)
      any = true
      for (const e of ins) a[e.from] -= e.amount ?? 1
      for (const e of outs) {
        const s = pool(e.to)
        if (s) a[e.to] = (a[e.to] || 0) + (e.amount ?? 1)
      }
      log.push(`⚗ ${n.name || 'converter'}: in ${ins.map((e) => e.amount ?? 1).join('+')} → out ${outs.map((e) => e.amount ?? 1).join('+') || '—'}`)
    }
    if (!any) break
  }
  // counted / array loops first, so downstream nodes see their fresh tokens in the same step
  for (const n of nodes) {
    if (n.kind !== 'for' && n.kind !== 'foreach') continue
    const loops = (mem.loops = mem.loops || {})
    const st = loops[n.id]
    const ins = flows.filter((e) => e.to === n.id)
    const outs = flows.filter((e) => e.from === n.id)
    const srcOk = (id) => nodes.some((x) => x.id === id && x.kind === 'source' && x.auto !== false)

    if (st && st.left > 0) {
      st.left -= 1
      st.i += 1
      for (const e of outs) {
        const s = pool(e.to)
        if (s) a[e.to] = (a[e.to] || 0) + (e.amount ?? 1)
      }
      const cur = (mem.cur = mem.cur || {})[n.id] = n.kind === 'for' ? { i: st.i } : { item: st.arr[st.i - 1], index: st.i - 1 }
      log.push(n.kind === 'for' ? `↻ ${n.name || 'for'} ${st.i}/${st.total} →` : `≡ ${n.name || 'foreach'} ${st.i}/${st.total} item="${cur.item}" →`)
      if (st.left === 0) log.push(`${n.kind === 'for' ? '↻' : '≡'} ${n.name || n.kind} finished (${st.total})`)
      continue
    }

    // idle: consume a full trigger to start (restarts if a previous run completed)
    if (!ins.length || ins.some((e) => !pool(e.from) && !srcOk(e.from))) continue
    if (ins.some((e) => pool(e.from) && (a[e.from] || 0) < (e.amount ?? 1))) continue
    if (n.kind === 'for') {
      const d = dataValue(nodes, links, a, mem, n.id, '__to__')
      const count = d && d.val !== null && Number.isFinite(Number(d.val)) ? Math.floor(Number(d.val)) : null
      if (count === null || count <= 0) {
        if (!((mem.loopWarn = mem.loopWarn = mem.loopWarn || {})[n.id])) {
          mem.loopWarn[n.id] = true
          log.push(`⚠ ${n.name || 'for'} — ⇣ to:int is ${d ? 'not a number' : 'unwired'}`)
        }
        continue
      }
      for (const e of ins) if (pool(e.from)) a[e.from] -= e.amount ?? 1
      loops[n.id] = { left: count, total: count, i: 0 }
      log.push(`↻ ${n.name || 'for'}: loaded ${count} iterations`)
    } else {
      const d = dataValue(nodes, links, a, mem, n.id, '__arr__')
      const arr = d && Array.isArray(d.val) ? d.val : null
      if (!arr || !arr.length) {
        if (!((mem.loopWarn = mem.loopWarn || {})[n.id])) {
          mem.loopWarn[n.id] = true
          log.push(`⚠ ${n.name || 'foreach'} — ⇣ arr is ${d ? 'not a wired array' : 'unwired'}`)
        }
        continue
      }
      for (const e of ins) if (pool(e.from)) a[e.from] -= e.amount ?? 1
      loops[n.id] = { left: arr.length, total: arr.length, i: 0, arr }
      log.push(`≡ ${n.name || 'foreach'}: loaded [${arr.join(', ')}]`)
    }
  }
  // flow nodes
  for (const n of nodes) {
    if (!['gate', 'randgate', 'trader', 'delay', 'queue', 'register', 'syscall'].includes(n.kind)) continue
    const ins = flows.filter((e) => e.to === n.id)
    const outs = flows.filter((e) => e.from === n.id)

    if (n.kind === 'syscall') {
      const srcOk = (id) => nodes.some((x) => x.id === id && x.kind === 'source' && x.auto !== false)
      if (!ins.length || ins.some((e) => !pool(e.from) && !srcOk(e.from))) continue
      if (ins.some((e) => pool(e.from) && (a[e.from] || 0) < (e.amount ?? 1))) {
        if (!((mem.waited = mem.waited || {})[n.id])) {
          mem.waited[n.id] = true
          log.push(`⏸ sys call "${n.name || ''}" waiting — trigger pool is empty`)
        }
        continue
      }
      callSystem(n, nodes, links, a, mem, log, assets)
      for (const e of ins) if (pool(e.from)) a[e.from] -= e.amount ?? 1
      for (const e of outs) {
        const s = pool(e.to)
        if (s) a[e.to] = (a[e.to] || 0) + (e.amount ?? 1)
      }
      continue
    }

    if (!ins.length || ins.some((e) => !pool(e.from))) continue
    const ready = !ins.some((e) => (a[e.from] || 0) < (e.amount ?? 1))

    if (n.kind === 'gate' || n.kind === 'randgate' || n.kind === 'trader') {
      const icon = (KINDS[n.kind]?.label || '').slice(0, 1)
      let take = 0
      if (ready) take = Math.min(...ins.map((e) => e.amount ?? 1))
      else if (n.kind === 'trader') take = Math.min(...ins.map((e) => Math.min(a[e.from] || 0, e.amount ?? 1)))
      if (take <= 0) continue
      if (n.kind === 'randgate' && Math.random() < 0.5) continue
      for (const e of ins) a[e.from] = Math.max(0, (a[e.from] || 0) - Math.min(take, e.amount ?? 1))
      for (const e of outs) {
        const s = pool(e.to)
        if (s) a[e.to] = (a[e.to] || 0) + (e.amount ?? 1)
      }
      log.push(`${icon} ${n.name || n.kind}: ${take} in → ${outs.map((e) => e.amount ?? 1).join('+') || '—'} out`)
      continue
    }

    const m = (mem[n.id] = mem[n.id] || { items: [], count: 0 })
    if (!ready) continue
    const take = Math.min(...ins.map((e) => e.amount ?? 1))
    for (const e of ins) a[e.from] -= take
    if (n.kind === 'delay') {
      const hold = n.delay ?? 3
      m.items.push({ amt: take, age: 0 })
      const due = m.items.filter((it) => it.age >= hold).reduce((s, it) => s + it.amt, 0)
      m.items = m.items.filter((it) => it.age < hold)
      m.items.forEach((it) => (it.age += 1))
      if (due > 0) {
        for (const e of outs) {
          const s = pool(e.to)
          if (s) a[e.to] = (a[e.to] || 0) + due
        }
        log.push(`⏳ ${n.name || 'delay'} released ${due} (held ${hold} steps)`)
      }
    } else if (n.kind === 'queue') {
      m.items.push({ amt: take, age: 0 })
      let released = Math.min(m.items.reduce((s, it) => s + it.amt, 0), n.rate ?? 1)
      let left = released
      while (left > 0 && m.items.length) {
        const used = Math.min(m.items[0].amt, left)
        m.items[0].amt -= used
        left -= used
        if (m.items[0].amt === 0) m.items.shift()
      }
      if (released > 0) {
        for (const e of outs) {
          const s = pool(e.to)
          if (s) a[e.to] = (a[e.to] || 0) + released
        }
        log.push(`📥 ${n.name || 'queue'} released ${released} (holding ${m.items.reduce((s, it) => s + it.amt, 0)})`)
      }
    } else if (n.kind === 'register') {
      m.count += take
      if (m.count >= (n.countTo ?? 2)) {
        m.count -= n.countTo ?? 2
        for (const e of outs) {
          const s = pool(e.to)
          if (s) a[e.to] = (a[e.to] || 0) + (e.amount ?? 1)
        }
        log.push(`🔢 ${n.name || 'register'} pulsed 1 (every ${n.countTo ?? 2})`)
      }
    }
  }
  // drains
  for (const n of nodes) {
    if (n.kind !== 'drain' || n.auto === false) continue
    for (const e of flows.filter((e) => e.to === n.id)) {
      const s = pool(e.from)
      if (!s) continue
      const take = Math.min(a[e.from] || 0, e.amount ?? 1)
      if (take > 0) {
        a[e.from] -= take
        log.push(`🕳 ${n.name || 'drain'} ⟵ −${take} ${s.name || 'pool'} = ${a[e.from]}`)
      }
    }
  }
  return a
}

function fireAction(nodes, links, prev, nodeId, log) {
  const a = { ...prev }
  const n = nodes.find((x) => x.id === nodeId)
  if (!n) return a
  const pool = (id) => nodes.find((x) => x.id === id && x.kind === 'pool')
  const ins = links.filter((e) => e.kind !== 'data' && e.to === n.id)
  const outs = links.filter((e) => e.kind !== 'data' && e.from === n.id)
  if (ins.some((e) => pool(e.from) && (a[e.from] || 0) < (e.amount ?? 1))) {
    log.push(`▶ ${n.name || 'action'} — not enough resources`)
    return a
  }
  for (const e of ins) if (pool(e.from)) a[e.from] -= e.amount ?? 1
  for (const e of outs) {
    const s = pool(e.to)
    if (s) a[e.to] = (a[e.to] || 0) + (e.amount ?? 1)
  }
  log.push(`▶ ${n.name || 'action'} fired — tick +1`)
  return a
}

// ---- editor ------------------------------------------------------------------
// straight lines with 90° turns: horizontal → vertical → horizontal,
// plus the midpoint of the (vertical) leg where the amount circle sits
const orth = (sx, sy, tx, ty) => {
  const mx = sx + Math.max(30, (tx - sx) / 2)
  return { d: `M ${sx} ${sy} L ${mx} ${sy} L ${mx} ${ty} L ${tx} ${ty}`, mid: { x: mx, y: (sy + ty) / 2 } }
}

export default function MachineCanvas({ graph, assets, onChange }) {
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
  const onPortDown = (e, id) => {
    const p = surfacePoint(e)
    setDrag({ kind: 'flow', from: id, x: p.x, y: p.y })
  }
  const onDataPortDown = (e, id, portId) => {
    const p = surfacePoint(e)
    setDrag({ kind: 'data', from: id, port: portId, x: p.x, y: p.y })
  }
  const addDataLink = (from, fromPort, to, toPort) => {
    const ta = dataPortType(graphRef.current, assets, from, fromPort, 'out')
    const tb = dataPortType(graphRef.current, assets, to, toPort, 'in')
    if (!ta || !tb) return warn('⚠ that data port no longer exists')
    if (!(ta === tb || (tb === 'array' && ta.includes('[]')))) return warn(`⚠ type mismatch — ⇡ ${ta} cannot feed ⇣ ${tb}`)
    mutate((g) => ({
      ...g,
      links: [
        ...g.links.filter((l) => !(l.kind === 'data' && l.to === to && l.toPort === toPort)),
        { id: uid('lk'), kind: 'data', from, fromPort, to, toPort },
      ],
      // foreach learns its item type from the array wired in
      nodes:
        toPort === '__arr__'
          ? g.nodes.map((n) => (n.id === to && n.kind === 'foreach' ? { ...n, itemType: ta.replace('[]', '') } : n))
          : g.nodes,
    }))
  }

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
          if (to !== drag.from)
            mutate((g) => ({
              ...g,
              links: [
                ...g.links.filter((l) => l.kind === 'data' || !(l.from === drag.from && l.to === to)),
                { id: uid('lk'), kind: 'flow', from: drag.from, fromPort: 'out', to, toPort: 'in', amount: 1 },
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
          onChangeRef.current({ ...graphRef.current, links: graphRef.current.links.filter((l) => l.id !== id) })
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
    const srcOk = (id) => graphRef.current.nodes.some((x) => x.id === id && x.kind === 'source' && x.auto !== false)
    for (const n of graphRef.current.nodes.filter((x) => x.kind === 'syscall')) {
      const ins = graphRef.current.links.filter((l) => l.kind !== 'data' && l.to === n.id)
      if (!resolveCall((n.calls || [])[0], assets)) out.push(`⚠ sys call "${n.name || ''}" has no system fn selected`)
      if (!ins.length) out.push(`⚠ sys call "${n.name || ''}" has no flow input — it will never be called`)
      else if (ins.some((e) => !srcOk(e.from) && !graphRef.current.nodes.some((x) => x.id === e.from && x.kind === 'pool')))
        out.push(`⚠ sys call "${n.name || ''}" — flow inputs must come from pools or sources`)
    }
    return out
  }
  const startSim = () =>
    setSim({
      amounts: Object.fromEntries(graphRef.current.nodes.filter((n) => n.kind === 'pool').map((n) => [n.id, n.init || 0])),
      mem: {},
      log: ['— simulation started —', ...diagnostics()],
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
  const clickNode = (id) => {
    const g = graphRef.current
    const n = g.nodes.find((x) => x.id === id)
    if (!simRef.current || !n || n.kind !== 'action') return
    setSim((s) => {
      const log = [...s.log]
      const mem = JSON.parse(JSON.stringify(s.mem || {}))
      let amounts = fireAction(g.nodes, g.links, s.amounts, id, log)
      amounts = stepOnce(g.nodes, g.links, amounts, log, mem, assets)
      return { ...s, amounts, mem, log: log.slice(-400), steps: s.steps + 1 }
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
        <span className="tb-hint">drag ▢ out → part = flow · click ○ = amount · click part/line + Del = remove</span>
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
                  <p>drag ▢ out → part = flow · click the ○ on a line to set its token amount · click a line + Del to remove it · teal squares wire typed data (pool ⇡ int).</p>
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
