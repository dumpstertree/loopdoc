// Canvas interaction layer shared by both canvases: selection state, the
// copy/cut/paste clipboard, port measurement, and box-selection hit tests.
// Behavior that genuinely differs (flow pans via origin, machine clamps to 0)
// is injected, never forked.
import { useRef, useState } from 'react'
import { reidGraph, snap, uid } from './model.js'

// measure every [data-port] element's center relative to the surface
export function measurePorts(surfaceEl) {
  if (!surfaceEl) return null
  const r = surfaceEl.getBoundingClientRect()
  const pos = {}
  surfaceEl.querySelectorAll('[data-port]').forEach((el) => {
    const b = el.getBoundingClientRect()
    pos[el.getAttribute('data-port')] = { x: b.left + b.width / 2 - r.left, y: b.top + b.height / 2 - r.top }
  })
  return pos
}

// ids of every [data-node-id] element overlapping the rectangle given in
// SURFACE coords (what surfacePoint hands the drag state)
export function boxHits(surfaceEl, x0, y0, x1, y1) {
  if (!surfaceEl) return []
  const r = surfaceEl.getBoundingClientRect()
  const bx0 = Math.min(x0, x1) + r.left
  const by0 = Math.min(y0, y1) + r.top
  const bx1 = Math.max(x0, x1) + r.left
  const by1 = Math.max(y0, y1) + r.top
  return [...surfaceEl.querySelectorAll('[data-node-id]')]
    .filter((el) => {
      const b = el.getBoundingClientRect()
      return b.left < bx1 && b.right > bx0 && b.top < by1 && b.bottom > by0
    })
    .map((el) => el.getAttribute('data-node-id'))
}

export function useCanvasEditor({ graphRef, mutate, mode, warn, getPointer, clamp0 = false }) {
  const [selection, setSelection] = useState([])
  const selectionRef = useRef(selection)
  selectionRef.current = selection
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
        ...(mode === 'flow' ? { entry: ids.includes(gg.entry) ? null : gg.entry } : {}),
      }))
      setSelection([])
    } else if (warn) warn(`⧉ ${ids.length} part${ids.length > 1 ? 's' : ''} copied`)
  }

  const paste = () => {
    const clip = clipboardRef.current
    if (!clip || !clip.nodes.length) return
    const fresh = reidGraph(
      JSON.parse(JSON.stringify({ id: uid('g'), mode, name: '', entry: null, nodes: clip.nodes, links: clip.links })),
    )
    // group leader-snap: the copy's top-left corner lands on the grid at the
    // pointer, members keep their offsets — and the routed-wire anchors come
    // along, since they are absolute surface coords (left behind they render
    // offset and "stick" in place when the pasted parts move)
    let sx = 26
    let sy = 26
    const pt = getPointer ? getPointer() : null
    if (pt) {
      sx = snap(pt.x - Math.min(...fresh.nodes.map((n) => n.x)))
      sy = snap(pt.y - Math.min(...fresh.nodes.map((n) => n.y)))
    }
    fresh.nodes.forEach((n) => {
      n.x = clamp0 ? Math.max(0, n.x + sx) : n.x + sx
      n.y = clamp0 ? Math.max(0, n.y + sy) : n.y + sy
    })
    fresh.links.forEach((l) => {
      if (Array.isArray(l.anchors) && l.anchors.length)
        l.anchors = l.anchors.map((a) => ({ x: a.x + sx, y: a.y + sy }))
    })
    mutate((g) => ({ ...g, nodes: [...g.nodes, ...fresh.nodes], links: [...g.links, ...fresh.links] }))
    setSelection(fresh.nodes.map((n) => n.id))
  }

  return { selection, setSelection, selectionRef, clipboardRef, copySel, paste }
}
