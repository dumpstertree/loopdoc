// graph canvas: node placement, drag-to-connect flow links, typed data
// wires, box-select, copy/paste, endless top/left growth. Shares the machine
// canvas vocabulary: orthogonal wires, right-edge exit ports, anchors.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import NodeCard, { NODE_W, PORT_Y } from './NodeCard.jsx'
import { NodePalette } from './NodePalette.jsx'
import { KINDS, kindsFor, kindMeta, uid, newNode, patchNode, removeNode, pruneLinks, groupKin, adoptInto, snap, orth, routePath } from './model.js'
import { dataCanConnect, compatTargets, takesFlow, branchLink } from './wireRules.js'
import { useCanvasEditor, measurePorts, boxHits } from './useCanvasEditor.js'

const GROW_STEP = 600
const GROW_AT = 64

// Where a fresh canvas starts looking. The surface grows endlessly toward the
// top/left while editing (drag to the edge and the origin shifts to make room),
// and the origin is VIEW state — nothing stores it. So a canvas that mounts on
// content parked at negative coordinates would open with those parts past the
// unscrollable edge, invisible; start at the margin instead, or wherever the
// content needs the pan to be, so everything always opens on screen.
const homeOrigin = (g) => {
  const pts = [...(g.nodes || []), ...(g.links || []).flatMap((l) => l.anchors || [])]
  const minX = pts.reduce((m, p) => Math.min(m, p.x || 0), 0)
  const minY = pts.reduce((m, p) => Math.min(m, p.y || 0), 0)
  return { x: 40 - Math.min(0, minX), y: 40 - Math.min(0, minY) }
}

export default function GraphCanvas({ graph, assets, types = [], globals = [], funcs = [], onChange, onOpenGraph, toolbarExtra }) {
  const [sel, setSel] = useState(null) // { link, anchor }
  const selRef = useRef(sel)
  selRef.current = sel
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(drag)
  dragRef.current = drag
  const [origin, setOrigin] = useState(() => homeOrigin(graph))
  const originRef = useRef(origin)
  originRef.current = origin
  const [size, setSize] = useState({ w: 2800, h: 1800 })
  const sizeRef = useRef(size)
  sizeRef.current = size
  const [portPos, setPortPos] = useState({})
  const portPosRef = useRef(portPos)
  const [msg, setMsg] = useState(null)
  const [palette, setPalette] = useState(null) // { x, y } while the space-bar finder is open
  const paletteRef = useRef(palette)
  paletteRef.current = palette
  const scrollRef = useRef(null)
  const surfaceRef = useRef(null)
  const lastPointerRef = useRef(null)
  const graphRef = useRef(graph)
  graphRef.current = graph

  const warn = (m) => {
    setMsg(m)
    setTimeout(() => setMsg((x) => (x === m ? null : x)), 3200)
  }

  // ---- commit helpers ---------------------------------------------------------
  const mutate = (fn) => onChange(fn(graphRef.current))

  // selection + clipboard come from the shared canvas editor; the flow canvas
  // pans, so the paste pointer is mapped from viewport to surface coords
  const { selection, setSelection, selectionRef, clipboardRef, copySel, paste } = useCanvasEditor({
    graphRef,
    mutate,
    mode: graph.mode,
    warn,
    getPointer: () => {
      const pt = lastPointerRef.current || { x: 200, y: 120 }
      return { x: pt.x - originRef.current.x, y: pt.y - originRef.current.y }
    },
  })
  const patch = (id, p) => mutate((g) => pruneLinks(patchNode(g, id, p), assets, id))
  const addNodeAt = (kind, x, y) => {
    const n = newNode(kind, snap(x), snap(y))
    mutate((g) => ({ ...g, nodes: [...g.nodes, n] }))
    setSelection([n.id])
    return n.id
  }
  const addNode = (kind) => addNodeAt(kind, 120, 90)

  // ---- endless growth -----------------------------------------------------------
  const grow = (dx, dy) => {
    const sc = scrollRef.current
    if (sc) {
      sc.scrollLeft += dx
      sc.scrollTop += dy
    }
    originRef.current = { x: originRef.current.x + dx, y: originRef.current.y + dy }
    sizeRef.current = { w: sizeRef.current.w + dx, h: sizeRef.current.h + dy }
    setOrigin(originRef.current)
    setSize(sizeRef.current)
  }
  const growCheck = (p) => {
    let q = p
    if (p.x < GROW_AT) {
      grow(GROW_STEP, 0)
      q = { ...q, x: q.x + GROW_STEP }
    }
    if (p.y < GROW_AT) {
      grow(0, GROW_STEP)
      q = { ...q, y: q.y + GROW_STEP }
    }
    return q
  }

  const surfacePoint = (cx, cy) => {
    const r = surfaceRef.current.getBoundingClientRect()
    return { x: cx - r.left, y: cy - r.top }
  }

  // ---- links ---------------------------------------------------------------------
  const addFlowLink = (from, fromPort, to) => {
    if (from === to) return
    // pure-data parts (VAR) sit outside the flow — neither end may take it
    const byId = (id) => graphRef.current.nodes.find((x) => x.id === id)
    for (const end of [byId(from), byId(to)])
      if (end && !takesFlow(end))
        return warn(`⚠ ${kindMeta(end).label || end.kind} is pure data — no flow wires into or out of it`)
    mutate((g) => {
      if (g.links.some((l) => l.kind !== 'data' && l.from === from && l.fromPort === fromPort && l.to === to)) return g
      return { ...g, links: [...g.links, { id: uid('lk'), kind: 'flow', from, fromPort, to, toPort: 'in', anchors: [] }] }
    })
  }
  const addDataLink = (from, fromPort, to, toPort) => {
    // same rules as the machine canvas — any feeds everything, arrays feed
    // ⇣ list, and every mismatch explains itself
    const chk = dataCanConnect(graphRef.current, assets, from, fromPort, to, toPort, funcs)
    if (!chk.ok) return warn(chk.why)
    mutate((g) => ({
      ...g,
      // a data input has exactly one producer
      links: [
        ...g.links.filter((l) => !(l.kind === 'data' && l.to === to && l.toPort === toPort)),
        { id: uid('lk'), kind: 'data', from, fromPort, to, toPort },
      ],
    }))
  }

  // ---- dragging -------------------------------------------------------------------
  const onHeaderDown = (e, id) => {
    if (e.button !== 0) return
    if (!(e.shiftKey || e.ctrlKey || e.metaKey) && !selectionRef.current.includes(id)) setSelection([id])
    const p = surfacePoint(e.clientX, e.clientY)
    const n = graphRef.current.nodes.find((x) => x.id === id)
    if (!n) return
    let group = selectionRef.current.length > 1 && selectionRef.current.includes(id) ? [...selectionRef.current] : null
    // dragging a TEXT frame carries everything grouped inside it
    if (n.kind === 'text') {
      const kin = [...groupKin(graphRef.current, id)]
      if (kin.length > 1) group = group ? [...new Set([...group, ...kin])] : kin
    }
    const starts = {}
    if (group) graphRef.current.nodes.forEach((x) => (starts[x.id] = { x: x.x, y: x.y }))
    setDrag({
      kind: 'node',
      id,
      group,
      starts,
      dx: p.x - originRef.current.x - n.x,
      dy: p.y - originRef.current.y - n.y,
      sx: p.x - originRef.current.x,
      sy: p.y - originRef.current.y,
    })
  }
  const onPortDown = (e, id, portId) => {
    const p = surfacePoint(e.clientX, e.clientY)
    setDrag({ kind: 'flow', from: id, port: portId, x: p.x, y: p.y })
  }
  // TEXT card corner grip
  const onResizeDown = (e, id) => {
    const n = graphRef.current.nodes.find((x) => x.id === id)
    if (!n) return
    const p = surfacePoint(e.clientX, e.clientY)
    const el = e.target.closest('[data-node-id]')
    setDrag({
      kind: 'resize',
      id,
      sx: p.x - originRef.current.x,
      sy: p.y - originRef.current.y,
      sw: n.w || (el ? el.offsetWidth : NODE_W),
      sh: n.h || (el ? el.offsetHeight : 60),
    })
  }
  // data ports use the same attribute — the card marks ⇡ ones with onPointerDown
  const onDataPortDown = (e, id, portId) => {
    const p = surfacePoint(e.clientX, e.clientY)
    setDrag({ kind: 'data', from: id, port: portId, x: p.x, y: p.y })
  }

  useEffect(() => {
    if (!drag) return
    const onMove = (e) => {
      const p0 = surfacePoint(e.clientX, e.clientY)
      const p = ['node', 'flow', 'data', 'anchor', 'branch', 'resize'].includes(drag.kind) ? growCheck(p0) : p0
      // drag toward the right/bottom edge to auto-scroll (growCheck already
      // handles left/top by extending the origin; box excluded — scrolling
      // would skew its rect)
      const sc = scrollRef.current
      if (sc && drag.kind !== 'box') {
        const r = sc.getBoundingClientRect()
        const near = 44
        if (e.clientX > r.right - near) sc.scrollLeft += 20
        if (e.clientY > r.bottom - near) sc.scrollTop += 20
      }
      if (drag.kind === 'node') {
        const ps = { x: p.x - originRef.current.x, y: p.y - originRef.current.y }
        // grid snap: leader lands on the dot grid, group keeps relative offsets
        const l = drag.starts && drag.starts[drag.id] ? drag.starts[drag.id] : { x: drag.sx, y: drag.sy }
        const ddx = snap(l.x + ps.x - drag.sx) - l.x
        const ddy = snap(l.y + ps.y - drag.sy) - l.y
        mutate((g) => ({
          ...g,
          nodes: g.nodes.map((n) => {
            if (drag.group)
              return drag.group.includes(n.id) && drag.starts[n.id]
                ? { ...n, x: drag.starts[n.id].x + ddx, y: drag.starts[n.id].y + ddy }
                : n
            return n.id === drag.id ? { ...n, x: snap(ps.x - drag.dx), y: snap(ps.y - drag.dy) } : n
          }),
        }))
      } else if (drag.kind === 'resize') {
        const ps = { x: p.x - originRef.current.x, y: p.y - originRef.current.y }
        mutate((g) => ({
          ...g,
          nodes: g.nodes.map((n) =>
            n.id === drag.id
              ? {
                  ...n,
                  w: Math.max(150, snap(drag.sw + ps.x - drag.sx)),
                  // TODO and VAR size their own height from their content — width only
                  ...(n.kind === 'todo' || n.kind === 'var' ? {} : { h: Math.max(48, snap(drag.sh + ps.y - drag.sy)) }),
                }
              : n,
          ),
        }))
      } else if (drag.kind === 'flow' || drag.kind === 'data' || drag.kind === 'branch') {
        setDrag((d) => ({ ...d, x: p.x, y: p.y }))
      } else if (drag.kind === 'anchor') {
        const x = Math.round(p.x - originRef.current.x)
        const y = Math.round(p.y - originRef.current.y)
        mutate((g) => ({
          ...g,
          links: g.links.map((l) =>
            l.id === drag.link && Array.isArray(l.anchors)
              ? { ...l, anchors: l.anchors.map((a, i) => (i === drag.idx ? { x, y } : a)) }
              : l,
          ),
        }))
      } else if (drag.kind === 'box') {
        setDrag((d) => ({ ...d, x1: p.x, y1: p.y }))
      }
    }
    const onUp = (e) => {
      if (drag.kind === 'flow') {
        const el = document.elementFromPoint(e.clientX, e.clientY)
        const targetEl = el && el.closest('[data-node-id]')
        if (targetEl) addFlowLink(drag.from, drag.port, targetEl.getAttribute('data-node-id'))
      } else if (drag.kind === 'data') {
        const el = document.elementFromPoint(e.clientX, e.clientY)
        const pin = el && el.closest('[data-port]')
        if (pin) {
          const [toNode, toPort, dir] = pin.getAttribute('data-port').split(':')
          if (dir !== 'in') warn('⚠ data flows ⇡ out → ⇣ in — drop on an input square')
          else if (toNode === drag.from) warn('⚠ a node cannot feed itself')
          else addDataLink(drag.from, drag.port, toNode, toPort)
        }
      } else if (drag.kind === 'branch') {
        // Ctrl+drag released — the branch lands where a normal wire would:
        // flow on a part, data on a ⇣ square. wireRules.branchLink shares the
        // source wire's run up to the grabbed anchor and enforces every rule.
        const src = graphRef.current.links.find((x) => x.id === drag.link)
        const el = document.elementFromPoint(e.clientX, e.clientY)
        const pin = el && el.closest('[data-port]')
        const card = el && el.closest('[data-node-id]')
        let res = null
        if (src && drag.branchKind === 'data' && pin) {
          const [toNode, toPort, dir] = pin.getAttribute('data-port').split(':')
          if (dir !== 'in') warn('⚠ data flows ⇡ out → ⇣ in — drop on an input square')
          else {
            res = branchLink(graphRef.current, assets, src, drag.idx, toNode, toPort, funcs)
            if (!res.ok) warn(res.why)
          }
        } else if (src && card) {
          res = branchLink(graphRef.current, assets, src, drag.idx, card.getAttribute('data-node-id'), 'in', funcs)
          if (!res.ok) warn(res.why)
        }
        if (res && res.ok) {
          const ln = res.link
          mutate((g) => ({
            ...g,
            links: [
              // a data input still has exactly one producer, branch included
              ...g.links.filter((l) => !(ln.kind === 'data' && l.kind === 'data' && l.to === ln.to && l.toPort === ln.toPort)),
              ln,
            ],
          }))
          setSel({ link: ln.id, anchor: null })
        }
      } else if (drag.kind === 'box') {
        const end = surfacePoint(e.clientX, e.clientY)
        if (Math.abs(end.x - drag.x0) < 4 && Math.abs(end.y - drag.y0) < 4) {
          setSelection([])
          setSel(null)
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

  const onSurfaceDown = (e) => {
    if (e.button !== 0) return
    if (e.target.closest('.nd') || e.target.closest('.edge')) return
    const p = surfacePoint(e.clientX, e.clientY)
    setDrag({ kind: 'box', x0: p.x, y0: p.y, x1: p.x, y1: p.y, shift: e.shiftKey })
  }
  const onDoubleClick = (e) => {
    if (e.target.closest('.nd') || e.target.closest('.edge') || e.target.closest('.edge-anchor')) return
    const p = surfacePoint(e.clientX, e.clientY)
    addNodeAt('step', p.x - originRef.current.x - 20, p.y - originRef.current.y - 10)
  }

  // ---- keyboard ---------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key === 'c') copySel(false)
      else if (mod && e.key === 'x') copySel(true)
      else if (mod && e.key === 'v') paste()
      else if (mod && e.key === 'a') {
        e.preventDefault()
        setSelection(graphRef.current.nodes.map((n) => n.id))
      } else if (e.key === ' ' && !mod && !e.altKey && !dragRef.current) {
        // space opens the fuzzy node finder at the cursor
        e.preventDefault()
        if (!paletteRef.current) {
          paletteRef.current = { x: 0, y: 0 } // claim it before a second listener reacts
          // x/y place the panel in the viewport (wrap) space, sx/sy remember the
          // surface point the node should land on (the canvas may be scrolled)
          const pt = lastPointerRef.current || { x: 160, y: 120 }
          const sc = scrollRef.current
          setPalette({ x: pt.x - (sc?.scrollLeft || 0), y: pt.y - (sc?.scrollTop || 0), sx: pt.x, sy: pt.y })
        }
      } else if (e.key === 'Escape') setSel(null)
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        const s = selRef.current
        if (s && s.anchor != null) {
          e.preventDefault()
          mutate((g) => ({
            ...g,
            links: g.links.map((l) => (l.id === s.link && Array.isArray(l.anchors) ? { ...l, anchors: l.anchors.filter((_, i) => i !== s.anchor) } : l)),
          }))
          setSel({ link: s.link, anchor: null })
        } else if (s) {
          e.preventDefault()
          mutate((g) => ({ ...g, links: g.links.filter((l) => l.id !== s.link) }))
          setSel(null)
        } else if (selectionRef.current.length) {
          e.preventDefault()
          selectionRef.current.forEach((id) => mutate((g) => removeNode(g, id)))
          setSelection([])
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- measurement -------------------------------------------------------------------
  const measure = () => {
    const pos = measurePorts(surfaceRef.current)
    if (!pos) return
    const prev = portPosRef.current
    const keys = Object.keys(pos)
    const same = keys.length === Object.keys(prev).length && keys.every((k) => prev[k] && prev[k].x === pos[k].x && prev[k].y === pos[k].y)
    if (same) return
    portPosRef.current = pos
    setPortPos(pos)
  }
  useLayoutEffect(measure)
  useEffect(() => {
    const surf = surfaceRef.current
    if (!surf) return
    const ro = new ResizeObserver(() => measure())
    surf.querySelectorAll('.nd').forEach((el) => ro.observe(el))
    window.addEventListener('resize', measure)
    return () => ro.disconnect()
  })

  // ---- render --------------------------------------------------------------------------
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]))
  const paletteItems = kindsFor(graph.mode).map((k) => ({ id: k, label: KINDS[k].label, hint: KINDS[k].hint }))
  // endless canvas: the surface keeps a generous runway beyond the farthest
  // node so building toward the right/bottom edge just makes room, never clips
  const surfW = Math.max(size.w, graph.nodes.reduce((m, n) => Math.max(m, (n.x || 0) + origin.x + 600), 0))
  const surfH = Math.max(size.h, graph.nodes.reduce((m, n) => Math.max(m, (n.y || 0) + origin.y + 600), 0))
  const selSet = new Set(selection)
  // compatible drop targets while dragging a wire — same shared rules as the
  // machine canvas, so every ⇣ port that WOULD accept the wire glows first.
  // A branch drag poses as the wire it grew from, so the same ports pulse.
  const compatDrag =
    drag && (drag.kind === 'flow' || drag.kind === 'data')
      ? drag
      : drag && drag.kind === 'branch'
        ? { kind: drag.branchKind, from: drag.from, port: drag.port }
        : null
  const compatPorts = compatDrag ? compatTargets(graph, assets, compatDrag, Object.keys(portPos), funcs) : null
  const flowEnd = (l) => {
    const key = `${l.to}:in:in`
    if (portPos[key]) return portPos[key]
    const b = byId[l.to]
    return b ? { x: b.x + origin.x, y: b.y + origin.y + PORT_Y } : null
  }
  const flowStart = (l) => {
    const key = `${l.from}:${l.fromPort}:out`
    if (portPos[key]) return portPos[key]
    const a = byId[l.from]
    return a ? { x: a.x + origin.x + NODE_W, y: a.y + origin.y + PORT_Y } : null
  }

  return (
    <>
      <div className="graph-toolbar">
        <span className="tb-label">ADD</span>
        {kindsFor(graph.mode).map((k) => (
          <button
            key={k}
            className="tb-btn"
            style={{ '--accent-c': `var(--${k === 'event' ? 'magenta' : k === 'condition' ? 'cyan' : 'mint'})` }}
            title={KINDS[k].hint}
            onClick={() => addNode(k)}
          >
            {KINDS[k].label}
          </button>
        ))}
        <span className="tb-hint">drag empty = box-select · shift-click adds · Ctrl+C/X/V · dbl-click a wire drops an anchor · drag anchor = move · Ctrl+drag anchor = branch · dbl-click GRAPH/MACHINE enters it · dbl-click surface adds a STEP · space finds nodes · Del deletes</span>
        {msg && <span className="warn">{msg}</span>}
        <span className="spacer" />
        {toolbarExtra}
      </div>
      <div className="canvas-wrap">
        {palette && (
          <NodePalette
            items={paletteItems}
            x={palette.x}
            y={palette.y}
            onPick={(kind) => addNodeAt(kind, palette.sx - originRef.current.x - 20, palette.sy - originRef.current.y - 10)}
            onClose={() => setPalette(null)}
          />
        )}
        <div className="canvas-scroll" ref={scrollRef}>
          <div
            ref={surfaceRef}
            className={`canvas-surface ${drag ? 'canvas-dragging' : ''}`}
            style={{ width: surfW, height: surfH, backgroundPosition: `${origin.x}px ${origin.y}px` }}
            onPointerDown={onSurfaceDown}
            onDoubleClick={onDoubleClick}
            onPointerMove={(e) => (lastPointerRef.current = surfacePoint(e.clientX, e.clientY))}
          >
            <svg className="edges" width={surfW} height={surfH}>
              <defs>
                <marker id="arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" className="arrow-head-flow" />
                </marker>
                <marker id="arw-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" className="arrow-head-sel" />
                </marker>
                <marker id="arw-data" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" className="arrow-head-data" />
                </marker>
              </defs>
              {graph.links.map((l) => {
                if (l.kind === 'data') return null
                const a = byId[l.from]
                const b = byId[l.to]
                if (!a || !b) return null
                const s = flowStart(l)
                const t = flowEnd(l)
                if (!s || !t) return null
                const anchors = l.anchors || []
                const d = routePath(s, t, anchors.map((p) => ({ x: p.x + origin.x, y: p.y + origin.y }))).d
                const isReturn = kindMeta(a).ports(a).find((p) => p.id === l.fromPort)?.label === 'return'
                return (
                  <g
                    key={l.id}
                    className={`edge ${isReturn ? 'edge-return' : ''} ${sel && sel.link === l.id ? 'edge-sel' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelection([])
                      setSel({ link: l.id, anchor: null })
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      const p = surfacePoint(e.clientX, e.clientY)
                      mutate((g) => ({
                        ...g,
                        links: g.links.map((x) =>
                          x.id === l.id
                            ? { ...x, anchors: [...(x.anchors || []), { x: Math.round(p.x - originRef.current.x), y: Math.round(p.y - originRef.current.y) }] }
                            : x,
                        ),
                      }))
                    }}
                  >
                    <title>
                      {`${a.name || a.kind}${isReturn ? ' (return)' : ''} → ${b.name || b.kind}`} — click selects · dbl-click adds anchor · Del removes
                    </title>
                    <path d={d} className="edge-hit" />
                    <path d={d} className="edge-line" markerEnd={sel && sel.link === l.id ? 'url(#arw-sel)' : 'url(#arw)'} />
                  </g>
                )
              })}
              {graph.links.map((l) => {
                if (l.kind !== 'data') return null
                const s = portPos[`${l.from}:${l.fromPort}:out`]
                const t = portPos[`${l.to}:${l.toPort}:in`]
                if (!s || !t) return null
                const d = routePath(s, t, (l.anchors || []).map((p) => ({ x: p.x + origin.x, y: p.y + origin.y }))).d
                return (
                  <g
                    key={l.id}
                    className={`edge edge-data ${sel && sel.link === l.id ? 'edge-sel' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelection([])
                      setSel({ link: l.id, anchor: null })
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      const p = surfacePoint(e.clientX, e.clientY)
                      mutate((g) => ({
                        ...g,
                        links: g.links.map((x) =>
                          x.id === l.id
                            ? { ...x, anchors: [...(x.anchors || []), { x: Math.round(p.x - originRef.current.x), y: Math.round(p.y - originRef.current.y) }] }
                            : x,
                        ),
                      }))
                    }}
                  >
                    <title>data wire — click selects · dbl-click adds anchor · Del removes</title>
                    <path d={d} className="edge-hit" />
                    <path d={d} className="edge-line" markerEnd="url(#arw-data)" />
                  </g>
                )
              })}
              {graph.links.map((l) =>
                (l.anchors || []).map((ap, i) => (
                  <circle
                    key={`${l.id}:a${i}`}
                    className={`edge-anchor ${sel && sel.link === l.id && sel.anchor === i ? 'edge-anchor-sel' : ''}`}
                    cx={ap.x + origin.x}
                    cy={ap.y + origin.y}
                    r={5}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      if (e.ctrlKey || e.metaKey) {
                        // Ctrl+drag: split a branch off this anchor — the new
                        // wire shares the run up to this point, then follows
                        // the cursor to a new target
                        setDrag({
                          kind: 'branch',
                          link: l.id,
                          idx: i,
                          branchKind: l.kind,
                          from: l.from,
                          port: l.fromPort,
                          x: ap.x + origin.x,
                          y: ap.y + origin.y,
                        })
                        return
                      }
                      setSelection([])
                      setSel({ link: l.id, anchor: i })
                      setDrag({ kind: 'anchor', link: l.id, idx: i })
                    }}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    <title>{l.kind === 'data' ? 'data anchor' : 'wire anchor'} — drag to move · Ctrl+drag branches off · Del removes</title>
                  </circle>
                )),
              )}
              {drag && (drag.kind === 'flow' || drag.kind === 'data') && portPos[`${drag.from}:${drag.port}:out`] && (
                <path
                  d={orth(portPos[`${drag.from}:${drag.port}:out`].x, portPos[`${drag.from}:${drag.port}:out`].y, drag.x, drag.y).d}
                  className="edge-temp"
                  stroke={drag.kind === 'data' ? 'var(--mint)' : undefined}
                />
              )}
              {drag && drag.kind === 'branch' &&
                (() => {
                  // the branch follows the cursor from the anchor it grew off —
                  // read live from the graph so edge-growth keeps it anchored
                  const sl = graph.links.find((x) => x.id === drag.link)
                  const ap = sl && (sl.anchors || [])[drag.idx]
                  if (!ap) return null
                  return (
                    <path
                      d={orth(ap.x + origin.x, ap.y + origin.y, drag.x, drag.y).d}
                      className="edge-temp"
                      stroke={drag.branchKind === 'data' ? 'var(--mint)' : undefined}
                    />
                  )
                })()}
              {compatPorts &&
                compatPorts.map((k) =>
                  portPos[k] ? <circle key={k} className={`port-compat${compatDrag.kind === 'data' ? ' pc-data' : ''}`} cx={portPos[k].x} cy={portPos[k].y} r={8} /> : null,
                )}
            </svg>
            <div style={{ transform: `translate(${origin.x}px, ${origin.y}px)` }}>
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
                  funcs={funcs}
                  systems={assets.filter((a) => a.kind === 'system')}
                  selected={selSet.has(n.id)}
                  isEntry={graph.entry === n.id}
                  sim={null}
                  onPatch={(p) => patch(n.id, p)}
                  onSelect={(id, shift) => setSelection(shift ? [...new Set([...selection, id])] : [id])}
                  onToggleEntry={(id) => mutate((g) => ({ ...g, entry: g.entry === id ? null : id }))}
                  onOpenGraph={() => onOpenGraph(n.id)}
                  onPortDown={onPortDown}
                  onDataPortDown={onDataPortDown}
                  onHeaderDown={onHeaderDown}
                  onResizeDown={onResizeDown}
                />
              ))}
            </div>
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
                  <b>Empty graph.</b> Add nodes from the bar above or double-click here to drop a STEP.
                </p>
                <p>▶ marks the entry · IF/CHOICE branch · GRAPH nests another loop · MACHINE nests a chain sim.</p>
                <p>EVENT nodes call ⚙️ systems; teal squares carry typed data between calls.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
