// The machine canvas: chain-engine machine editing + simulation. The engine
// itself is React-free in engine.js; this file is the editor — selection,
// clipboard, wires, anchors, toolbar — plus the sim driver around it.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import NodeCard from './NodeCard.jsx'
import { KINDS, kindsFor, uid, newNode, patchNode, pruneLinks, resolveCall, dataPortType, fnSig, fieldsOf, kindMeta, groupKin, adoptInto, snap, globalValue, orth, routePath } from './model.js'
import { fmt, dataValue, originRef, callSystem, stepOnce } from './engine.js'
import { isEntryPart, dataCanConnect, compatTargets } from './wireRules.js'
import { useCanvasEditor, measurePorts, boxHits } from './useCanvasEditor.js'

// ---- editor ------------------------------------------------------------------
// wire routing (orth / routePath) now lives in model.js — shared with the flow canvas

export default function MachineCanvas({ graph, assets, types, globals = [], gstore, onChange }) {
  const [sim, setSim] = useState(null)
  const [drag, setDrag] = useState(null)
  const [sel, setSel] = useState(null) // selected link id
  const selRef = useRef(sel)
  selRef.current = sel
  const [selAnchor, setSelAnchor] = useState(null) // { link, idx } — selected wire anchor
  const selAnchorRef = useRef(selAnchor)
  selAnchorRef.current = selAnchor
  const lastPointerRef = useRef(null) // where to drop a paste
  const [portXY, setPortXY] = useState({})
  const [msg, setMsg] = useState(null)
  const surfaceRef = useRef(null)
  const scrollRef = useRef(null) // the overflow container — auto-scrolled while dragging
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

  // selection + clipboard come from the shared canvas editor
  const { selection, setSelection, selectionRef, clipboardRef, copySel, paste } = useCanvasEditor({
    graphRef,
    mutate,
    mode: 'machine',
    warn,
    getPointer: () => lastPointerRef.current,
    clamp0: true,
  })
  const patch = (id, p) => mutate((g) => pruneLinks(patchNode(g, id, p), assets, id))
  const surfacePoint = (e) => {
    const r = surfaceRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const addNode = (kind) =>
    mutate((g) => ({ ...g, nodes: [...g.nodes, newNode(kind, snap(140 + Math.random() * 180), snap(100 + Math.random() * 140))] }))
  const delNode = (id) =>
    mutate((g) => ({
      ...g,
      nodes: g.nodes
        .filter((n) => n.id !== id)
        .map((n) => (n.parent === id ? { ...n, parent: undefined } : n)), // free the frame's children
      links: g.links.filter((l) => l.from !== id && l.to !== id),
    }))

  const onHeaderDown = (e, id) => {
    if (e.button !== 0) return
    const n = graphRef.current.nodes.find((x) => x.id === id)
    if (!n) return
    const p = surfacePoint(e)
    lastPointerRef.current = p
    // clicking one of many selected parts drags the whole group; a plain click
    // outside a selection collapses it to the clicked node
    if (!(e.shiftKey || e.ctrlKey || e.metaKey) && !selectionRef.current.includes(id)) setSelection([id])
    let group = selectionRef.current.length > 1 && selectionRef.current.includes(id) ? [...selectionRef.current] : null
    // dragging a TEXT frame carries everything grouped inside it
    if (n.kind === 'text') {
      const kin = [...groupKin(graphRef.current, id)]
      if (kin.length > 1) group = group ? [...new Set([...group, ...kin])] : kin
    }
    const starts = {}
    if (group) graphRef.current.nodes.forEach((x) => (starts[x.id] = { x: x.x, y: x.y }))
    setDrag({ kind: 'node', id, group, starts, dx: p.x - n.x, dy: p.y - n.y, sx: p.x, sy: p.y })
  }
  const onResizeDown = (e, id) => {
    const n = graphRef.current.nodes.find((x) => x.id === id)
    if (!n) return
    const p = surfacePoint(e)
    const el = e.target.closest('[data-node-id]')
    setDrag({ kind: 'resize', id, sx: p.x, sy: p.y, sw: n.w || (el ? el.offsetWidth : 184), sh: n.h || (el ? el.offsetHeight : 60) })
  }
  // pressing empty canvas starts a box-select — a click without drag just clears
  const onSurfaceDown = (e) => {
    if (e.button !== 0) return
    if (e.target.closest('.nd') || e.target.closest('.edge') || e.target.closest('.edge-anchor')) return
    const p = surfacePoint(e)
    lastPointerRef.current = p
    setDrag({ kind: 'box', x0: p.x, y0: p.y, x1: p.x, y1: p.y, shift: e.shiftKey })
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
    const chk = dataCanConnect(graphRef.current, assets, from, fromPort, to, toPort)
    if (!chk.ok) return warn(chk.why)
    const ta = dataPortType(graphRef.current, assets, from, fromPort, 'out')
    mutate((g) => ({
      ...g,
      links: [
        ...g.links.filter((l) => !(l.kind === 'data' && l.to === to && l.toPort === toPort)),
        { id: uid('lk'), kind: 'data', from, fromPort, to, toPort },
      ],
      // foreach learns its item type from the array wired in;
      // inspect learns its type and grows one ⇡ per field; if learns its compare type
      nodes: g.nodes.map((n) => {
        if (n.id !== to) return n
        if (toPort === '__arr__' && n.kind === 'foreach') return { ...n, itemType: ta.replace('[]', '') }
        if (toPort === '__obj__' && n.kind === 'inspect') {
          const td = (types || []).find((t) => (t.name || '').trim().toLowerCase() === ta)
          return { ...n, objType: td ? td.name : ta, fields: fieldsOf(types, ta) || [] }
        }
        if ((toPort === '__a__' || toPort === '__b__') && n.kind === 'ifb') return { ...n, cmpType: ta }
        return n
      }),
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
      // drag toward a viewport edge to auto-scroll, so far reaches stay
      // reachable (box-select excluded — scrolling would skew its rect)
      const sc = scrollRef.current
      if (sc && drag.kind !== 'box') {
        const r = sc.getBoundingClientRect()
        const near = 44
        if (e.clientX > r.right - near) sc.scrollLeft += 20
        else if (e.clientX < r.left + near) sc.scrollLeft -= 20
        if (e.clientY > r.bottom - near) sc.scrollTop += 20
        else if (e.clientY < r.top + near) sc.scrollTop -= 20
      }
      if (drag.kind === 'node') {
        // grid snap: the dragged part lands on the dot grid; a group snaps via
        // its leader so members keep their relative offsets
        const l = drag.starts && drag.starts[drag.id] ? drag.starts[drag.id] : { x: drag.sx, y: drag.sy }
        const ddx = snap(l.x + p.x - drag.sx) - l.x
        const ddy = snap(l.y + p.y - drag.sy) - l.y
        mutate((g) => ({
          ...g,
          nodes: g.nodes.map((n) => {
            if (drag.group) {
              const s = drag.starts[n.id]
              return drag.group.includes(n.id) && s ? { ...n, x: Math.max(0, s.x + ddx), y: Math.max(0, s.y + ddy) } : n
            }
            return n.id === drag.id ? { ...n, x: Math.max(0, snap(p.x - drag.dx)), y: Math.max(0, snap(p.y - drag.dy)) } : n
          }),
        }))
      } else if (drag.kind === 'resize')
        mutate((g) => ({
          ...g,
          nodes: g.nodes.map((n) =>
            n.id === drag.id
              ? { ...n, w: Math.max(150, snap(drag.sw + p.x - drag.sx)), h: Math.max(48, snap(drag.sh + p.y - drag.sy)) }
              : n,
          ),
        }))
      else if (drag.kind === 'anchor')
        mutate((g) => ({
          ...g,
          links: g.links.map((l) =>
            l.id === drag.link && Array.isArray(l.anchors)
              ? { ...l, anchors: l.anchors.map((a, i) => (i === drag.idx ? { x: Math.round(p.x), y: Math.round(p.y) } : a)) }
              : l,
          ),
        }))
      else if (drag.kind === 'box') setDrag((d) => ({ ...d, x1: p.x, y1: p.y }))
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
      } else if (drag.kind === 'box') {
        const end = surfacePoint(e)
        if (Math.abs(end.x - drag.x0) < 4 && Math.abs(end.y - drag.y0) < 4) {
          setSelection([])
          setSel(null)
          setSelAnchor(null)
        } else {
          const hit = boxHits(surfaceRef.current, drag.x0, drag.y0, end.x, end.y)
          setSelection(drag.shift ? [...new Set([...selectionRef.current, ...hit])] : hit)
        }
      } else if (drag.kind === 'node') {
        // dropped — adopt/unadopt the moved parts against TEXT frames
        const moved = drag.group || [drag.id]
        mutate((g) => ({ ...g, nodes: adoptInto(g, moved) }))
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
  }, [drag && drag.kind, drag && drag.id, drag && drag.from, drag && drag.link])

  // Del removes the selected link or node, Esc deselects
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === 'Escape') {
        setSel(null)
        setSelAnchor(null)
        setSelection([])
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) copySel(false)
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X')) copySel(true)
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) paste()
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        setSelection(graphRef.current.nodes.map((n) => n.id))
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && (selAnchorRef.current || selRef.current || selectionRef.current.length)) {
        e.preventDefault()
        if (selAnchorRef.current) {
          const { link, idx } = selAnchorRef.current
          setSelAnchor(null)
          mutate((g) => ({
            ...g,
            links: g.links.map((l) =>
              l.id === link && Array.isArray(l.anchors) ? { ...l, anchors: l.anchors.filter((_, i) => i !== idx) } : l,
            ),
          }))
        } else if (selRef.current) {
          const id = selRef.current
          setSel(null)
          const g = graphRef.current
          const dead = g.links.find((l) => l.id === id)
          let nodes = g.nodes
          let links = g.links.filter((l) => l.id !== id)
          // unwiring obj resets inspect — its field ports disappear with it
          let t =
            dead && dead.kind === 'data' && dead.toPort === '__obj__'
              ? g.nodes.find((n) => n.id === dead.to && n.kind === 'inspect')
              : null
          if (t) {
            nodes = nodes.map((n) => (n.id === t.id ? { ...n, objType: 'any', fields: [] } : n))
            links = links.filter((l) => !(l.kind === 'data' && l.from === t.id))
          }
          // unwiring an if-operand re-derives its compare type from whatever remains
          if (dead && dead.kind === 'data' && (dead.toPort === '__a__' || dead.toPort === '__b__')) {
            const ifn = g.nodes.find((n) => n.id === dead.to && n.kind === 'ifb')
            if (ifn) {
              const rest = links.find((l) => l.to === ifn.id && (l.toPort === '__a__' || l.toPort === '__b__'))
              const ot = rest && dataPortType({ nodes, links }, assets, rest.from, rest.fromPort, 'out')
              nodes = nodes.map((n) => (n.id === ifn.id ? { ...n, cmpType: ot && ot !== 'any' ? ot : null } : n))
            }
          }
          onChangeRef.current({ ...g, nodes, links })
        } else {
          const ids = selectionRef.current
          setSelection([])
          onChangeRef.current({
            ...graphRef.current,
            nodes: graphRef.current.nodes.filter((n) => !ids.includes(n.id)),
            links: graphRef.current.links.filter((l) => !ids.includes(l.from) && !ids.includes(l.to)),
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
    const pos = measurePorts(surfaceRef.current)
    if (!pos) return
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
    const entries = g.nodes.filter((n) => isEntryPart(n, g.links))
    if (!entries.length) out.push('⚠ nothing to run — parts with no flow input are chain entry points')
    else out.push(`ℹ ${entries.length} chain ${entries.length === 1 ? 'entry' : 'entry points'} — they re-run whenever their chain finishes`)
    if (!g.nodes.some((x) => x.kind === 'exit'))
      out.push('ℹ no EXIT part yet — add one per ending (e.g. victory, defeat) and the MACHINE node grows a port for it')
    for (const n of g.nodes.filter((x) => x.kind === 'syscall'))
      if (!resolveCall((n.calls || [])[0], assets)) out.push(`⚠ sys call "${n.name || ''}" has no system fn selected`)
    return out
  }
  const startSim = () =>
    setSim({
      amounts: Object.fromEntries(graphRef.current.nodes.filter((n) => n.kind === 'pool').map((n) => [n.id, n.init || 0])),
      // the SESSION store object itself, not a copy: SET here is visible in
      // every other machine's next run; only pools reset per run
      mem: { tokens: [], g: gstore ? gstore.vals(globals) : Object.fromEntries((globals || []).map((v) => [v.id, globalValue(v)])) },
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

  // typing a sys call's ⇡ answer while simulating — writes the live value
  // AND records it in callEdits, so the answer survives the call re-firing
  const setSimCallValue = (nodeId, vid, val) =>
    setSim((s) => {
      if (!s) return s
      const mem = JSON.parse(JSON.stringify(s.mem || {}))
      mem.call = mem.call || {}
      mem.call[nodeId] = { ...(mem.call[nodeId] || {}), [vid]: val }
      mem.callEdits = mem.callEdits || {}
      mem.callEdits[nodeId] = { ...(mem.callEdits[nodeId] || {}), [vid]: val }
      return { ...s, mem }
    })

  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]))
  // endless canvas: the surface always keeps a generous runway beyond the
  // farthest part, so building toward an edge just makes room, never clips
  // compatible drop targets while dragging a wire — mirrors the exact drop
  // rules (wireRules.js), so every ⇣ port that WOULD accept the wire glows
  // before you let go
  const compatPorts = drag && (drag.kind === 'flow' || drag.kind === 'data')
    ? compatTargets(graph, assets, drag, Object.keys(portXY))
    : null

  // auto-detected entry parts — same rule as the sim and DRC (wireRules.js),
  // shown with the flow canvas's ▶ flag so "where chains begin" reads
  // identically in both
  const entryIds = new Set(graph.nodes.filter((n) => isEntryPart(n, graph.links)).map((n) => n.id))
  const surfW = Math.max(2600, graph.nodes.reduce((m, n) => Math.max(m, (n.x || 0) + 600), 0))
  const surfH = Math.max(1800, graph.nodes.reduce((m, n) => Math.max(m, (n.y || 0) + 600), 0))
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
        <span className="tb-sep" />
        <button className="tb-btn" title="copy selected parts (Ctrl+C)" onClick={() => copySel(false)}>⧉ COPY</button>
        <button className="tb-btn" title="cut selected parts (Ctrl+X)" onClick={() => copySel(true)}>✂ CUT</button>
        <button className="tb-btn" title="paste at cursor (Ctrl+V)" onClick={paste}>⎘ PASTE</button>
        <span className="tb-hint">drag empty = box-select · shift-click adds · Ctrl+C/X/V · dbl-click a wire to drop a steering anchor · chains run from unconnected parts · click ⏳/▶ part to continue · Del removes selection</span>
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
          <div className="canvas-scroll" ref={scrollRef}>
            <div ref={surfaceRef} className="canvas-surface" style={{ width: surfW, height: surfH }} onPointerDown={onSurfaceDown}>
              <svg className="edges" width={surfW} height={surfH}>
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
                  const { d, mid } = routePath(a, b, l.anchors)
                  const isSel = sel === l.id
                  return (
                    <g
                      key={l.id}
                      className={`edge ${isSel ? 'edge-sel' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSel(l.id)
                        setSelAnchor(null)
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        const p = surfacePoint(e)
                        mutate((g) => ({
                          ...g,
                          links: g.links.map((x) =>
                            x.id === l.id ? { ...x, anchors: [...(x.anchors || []), { x: Math.round(p.x), y: Math.round(p.y) }] } : x,
                          ),
                        }))
                      }}
                    >
                      <title>flow — click selects · dbl-click drops an anchor to steer the line · Del removes</title>
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
                  const { d } = routePath(a, b, l.anchors)
                  return (
                    <g
                      key={l.id}
                      className={`edge edge-data ${sel === l.id ? 'edge-sel' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSel(l.id)
                        setSelAnchor(null)
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        const p = surfacePoint(e)
                        mutate((g) => ({
                          ...g,
                          links: g.links.map((x) =>
                            x.id === l.id ? { ...x, anchors: [...(x.anchors || []), { x: Math.round(p.x), y: Math.round(p.y) }] } : x,
                          ),
                        }))
                      }}
                    >
                      <title>data wire — click selects · dbl-click drops an anchor · Del removes</title>
                      <path d={d} className="edge-hit" />
                      <path d={d} className="edge-line" markerEnd={sel === l.id ? 'url(#marw-sel)' : 'url(#marw-data)'} />
                    </g>
                  )
                })}
                {/* dropped anchors — drag to steer, select + Del to remove */}
                {graph.links.map((l) =>
                  (l.anchors || []).map((ap, i) => (
                    <circle
                      key={`${l.id}:a${i}`}
                      className={`edge-anchor ${selAnchor && selAnchor.link === l.id && selAnchor.idx === i ? 'edge-anchor-sel' : ''}`}
                      cx={ap.x}
                      cy={ap.y}
                      r={5}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        setSel(null)
                        setSelAnchor({ link: l.id, idx: i })
                        setDrag({ kind: 'anchor', link: l.id, idx: i })
                      }}
                    >
                      <title>wire anchor — drag to move · Del removes</title>
                    </circle>
                  )),
                )}
                {drag && (drag.kind === 'flow' || drag.kind === 'data') && portXY[`${drag.from}:${drag.port}:out`] && (
                  <path
                    d={orth(portXY[`${drag.from}:${drag.port}:out`].x, portXY[`${drag.from}:${drag.port}:out`].y, drag.x, drag.y).d}
                    className="edge-temp"
                    stroke={drag.kind === 'data' ? 'var(--mint)' : undefined}
                  />
                )}
                {compatPorts &&
                  compatPorts.map((k) =>
                    portXY[k] ? <circle key={k} className={`port-compat${drag && drag.kind === 'data' ? ' pc-data' : ''}`} cx={portXY[k].x} cy={portXY[k].y} r={8} /> : null,
                  )}
              </svg>
              {/* TEXT frames render first so they sit behind their grouped parts */}
              {[...graph.nodes]
                .sort((a, b) => (a.kind === 'text' ? 0 : 1) - (b.kind === 'text' ? 0 : 1))
                .map((n) => (
                <NodeCard
                  key={n.id}
                  node={n}
                  graph={graph}
                  assets={assets}
                  types={types}
                  globals={globals}
                  gvals={gstore ? gstore.vals(globals) : null}
                  selected={selection.includes(n.id)}
                  isEntry={entryIds.has(n.id)}
                  sim={sim}
                  onCardClick={clickNode}
                  onPatch={(p) => patch(n.id, p)}
                  onDelete={delNode}
                  onSelect={(id, shift) => {
                    setSel(null)
                    setSelAnchor(null)
                    setSelection((s) => (shift ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]))
                  }}
                  onToggleEntry={() => {}}
                  onOpenGraph={() => {}}
                  onPortDown={onPortDown}
                  onDataPortDown={onDataPortDown}
                  onHeaderDown={onHeaderDown}
                  onResizeDown={onResizeDown}
                  onSimCall={(vid, val) => setSimCallValue(n.id, vid, val)}
                />
              ))}
              {drag && drag.kind === 'box' && (
                <div
                  className="select-box"
                  style={{
                    left: Math.min(drag.x0, drag.x1),
                    top: Math.min(drag.y0, drag.y1),
                    width: Math.abs(drag.x1 - drag.x0),
                    height: Math.abs(drag.y1 - drag.y0),
                  }}
                />
              )}
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
