// graph canvas: node placement, drag-to-connect flow links, typed data
// wires, box-select, copy/paste, endless top/left growth. The machine canvas
// reuses the same vocabulary and the bezier helpers below.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import NodeCard, { NODE_W_FLOW, PORT_Y } from './NodeCard.jsx'
import { KINDS, kindsFor, kindMeta, uid, newNode, patchNode, removeNode, pruneLinks, reidGraph, dataPortType, groupKin, adoptInto } from './model.js'

export const bezier = (sx, sy, tx, ty) => {
  const dx = Math.max(40, Math.abs(tx - sx) / 2)
  return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`
}
export const throughPath = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ')

const GROW_STEP = 600
const GROW_AT = 64

export default function GraphCanvas({ graph, assets, onChange, onOpenGraph, toolbarExtra }) {
  const [selection, setSelection] = useState([])
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const [sel, setSel] = useState(null) // { link, anchor }
  const selRef = useRef(sel)
  selRef.current = sel
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(drag)
  dragRef.current = drag
  const [origin, setOrigin] = useState({ x: 40, y: 40 })
  const originRef = useRef(origin)
  originRef.current = origin
  const [size, setSize] = useState({ w: 2800, h: 1800 })
  const sizeRef = useRef(size)
  sizeRef.current = size
  const [portPos, setPortPos] = useState({})
  const portPosRef = useRef(portPos)
  const [msg, setMsg] = useState(null)
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
  const patch = (id, p) => mutate((g) => pruneLinks(patchNode(g, id, p), assets, id))
  const del = (id) => {
    mutate((g) => removeNode(g, id))
    setSelection([])
  }
  const addNodeAt = (kind, x, y) => {
    const n = newNode(kind, x, y)
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
    mutate((g) => {
      if (g.links.some((l) => l.kind !== 'data' && l.from === from && l.fromPort === fromPort && l.to === to)) return g
      return { ...g, links: [...g.links, { id: uid('lk'), kind: 'flow', from, fromPort, to, toPort: 'in', anchors: [] }] }
    })
  }
  const addDataLink = (from, fromPort, to, toPort) => {
    const ta = dataPortType(graphRef.current, assets, from, fromPort, 'out')
    const tb = dataPortType(graphRef.current, assets, to, toPort, 'in')
    if (!ta || !tb) return warn('⚠ that data port no longer exists')
    if (ta !== tb) return warn(`⚠ type mismatch — ⇡ ${ta} cannot feed ⇣ ${tb}`)
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
      sw: n.w || (el ? el.offsetWidth : 184),
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
      const p = ['node', 'flow', 'data', 'anchor', 'resize'].includes(drag.kind) ? growCheck(p0) : p0
      if (drag.kind === 'node') {
        const ps = { x: p.x - originRef.current.x, y: p.y - originRef.current.y }
        mutate((g) => ({
          ...g,
          nodes: g.nodes.map((n) => {
            if (drag.group)
              return drag.group.includes(n.id) && drag.starts[n.id]
                ? { ...n, x: Math.round(drag.starts[n.id].x + (ps.x - drag.sx)), y: Math.round(drag.starts[n.id].y + (ps.y - drag.sy)) }
                : n
            return n.id === drag.id ? { ...n, x: Math.round(ps.x - drag.dx), y: Math.round(ps.y - drag.dy) } : n
          }),
        }))
      } else if (drag.kind === 'resize') {
        const ps = { x: p.x - originRef.current.x, y: p.y - originRef.current.y }
        mutate((g) => ({
          ...g,
          nodes: g.nodes.map((n) =>
            n.id === drag.id
              ? { ...n, w: Math.max(150, Math.round(drag.sw + ps.x - drag.sx)), h: Math.max(48, Math.round(drag.sh + ps.y - drag.sy)) }
              : n,
          ),
        }))
      } else if (drag.kind === 'flow' || drag.kind === 'data') {
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
      } else if (drag.kind === 'box') {
        const end = surfacePoint(e.clientX, e.clientY)
        if (Math.abs(end.x - drag.x0) < 4 && Math.abs(end.y - drag.y0) < 4) {
          setSelection([])
          setSel(null)
        } else {
          const r = surfaceRef.current.getBoundingClientRect()
          const bx0 = Math.min(drag.x0, end.x) + r.left
          const by0 = Math.min(drag.y0, end.y) + r.top
          const bx1 = Math.max(drag.x0, end.x) + r.left
          const by1 = Math.max(drag.y0, end.y) + r.top
          const hit = [...surfaceRef.current.querySelectorAll('[data-node-id]')]
            .filter((el) => {
              const b = el.getBoundingClientRect()
              return b.left < bx1 && b.right > bx0 && b.top < by1 && b.bottom > by0
            })
            .map((el) => el.getAttribute('data-node-id'))
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
    if (e.target.closest('.nd') || e.target.closest('.edge')) return
    const p = surfacePoint(e.clientX, e.clientY)
    addNodeAt('step', p.x - originRef.current.x - 20, p.y - originRef.current.y - 10)
  }

  // ---- copy / cut / paste ----------------------------------------------------------
  const clipboardRef = useRef(null)
  const copySel = (cut) => {
    const ids = selectionRef.current
    if (!ids.length) return
    const g = graphRef.current
    const nodes = g.nodes.filter((n) => ids.includes(n.id))
    const links = g.links.filter((l) => ids.includes(l.from) && ids.includes(l.to))
    clipboardRef.current = JSON.parse(JSON.stringify({ nodes, links }))
    if (cut) {
      mutate((gg) => ({
        ...gg,
        nodes: gg.nodes.filter((n) => !ids.includes(n.id)),
        links: gg.links.filter((l) => !ids.includes(l.from) && !ids.includes(l.to)),
        entry: ids.includes(gg.entry) ? null : gg.entry,
      }))
      setSelection([])
    }
  }
  const paste = () => {
    const clip = clipboardRef.current
    if (!clip || !clip.nodes.length) return
    const fresh = reidGraph(JSON.parse(JSON.stringify({ id: 0, mode: graph.mode, name: '', entry: null, nodes: clip.nodes, links: clip.links })))
    const minx = Math.min(...fresh.nodes.map((n) => n.x))
    const miny = Math.min(...fresh.nodes.map((n) => n.y))
    const pt = lastPointerRef.current || { x: 200, y: 120 }
    const dx = pt.x - originRef.current.x - minx
    const dy = pt.y - originRef.current.y - miny
    fresh.nodes.forEach((n) => {
      n.x = Math.round(n.x + dx)
      n.y = Math.round(n.y + dy)
    })
    mutate((g) => ({ ...g, nodes: [...g.nodes, ...fresh.nodes], links: [...g.links, ...fresh.links] }))
    setSelection(fresh.nodes.map((n) => n.id))
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
  const selSet = new Set(selection)
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
    return a ? { x: a.x + origin.x + NODE_W_FLOW, y: a.y + origin.y + PORT_Y } : null
  }

  return (
    <>
      <div className="graph-toolbar">
        <span className="tb-label">ADD</span>
        {kindsFor('flow').map((k) => (
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
        <span className="tb-hint">dbl-click drops a STEP · drag ◆ to connect · teal squares wire typed data · click link = select (Del)</span>
        {msg && <span className="warn">{msg}</span>}
        <span className="spacer" />
        {toolbarExtra}
      </div>
      <div className="canvas-wrap">
        <div className="canvas-scroll" ref={scrollRef}>
          <div
            ref={surfaceRef}
            className={`canvas-surface ${drag ? 'canvas-dragging' : ''}`}
            style={{ width: size.w, height: size.h }}
            onPointerDown={onSurfaceDown}
            onDoubleClick={onDoubleClick}
            onPointerMove={(e) => (lastPointerRef.current = surfacePoint(e.clientX, e.clientY))}
          >
            <svg className="edges" width={size.w} height={size.h}>
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
                const d = anchors.length ? throughPath([s, ...anchors.map((p) => ({ x: p.x + origin.x, y: p.y + origin.y })), t]) : bezier(s.x, s.y, t.x, t.y)
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
                const d = bezier(s.x, s.y, t.x, t.y)
                return (
                  <g
                    key={l.id}
                    className={`edge edge-data ${sel && sel.link === l.id ? 'edge-sel' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelection([])
                      setSel({ link: l.id, anchor: null })
                    }}
                  >
                    <title>data wire — click selects · Del removes</title>
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
                      setSelection([])
                      setSel({ link: l.id, anchor: i })
                      setDrag({ kind: 'anchor', link: l.id, idx: i })
                    }}
                  />
                )),
              )}
              {drag && (drag.kind === 'flow' || drag.kind === 'data') && portPos[`${drag.from}:${drag.port}:out`] && (
                <path
                  d={bezier(portPos[`${drag.from}:${drag.port}:out`].x, portPos[`${drag.from}:${drag.port}:out`].y, drag.x, drag.y)}
                  className="edge-temp"
                  stroke={drag.kind === 'data' ? 'var(--mint)' : undefined}
                />
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
                  selected={selSet.has(n.id)}
                  isEntry={graph.entry === n.id}
                  sim={null}
                  onPatch={(p) => patch(n.id, p)}
                  onDelete={del}
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
                <p>▶ marks the entry · IF/CHOICE branch · GRAPH nests another loop · MACHINE nests an economy sim.</p>
                <p>EVENT nodes call ⚙️ systems; teal squares carry typed data between calls and pool amounts.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
