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

  // func bodies own permanent doors: ENTER/EXIT can be neither copied, cut
  // nor pasted — they are born with the graph. Read the mode from the live
  // graph, so canvas-level setup never goes stale.
  const gmode = () => (graphRef.current && graphRef.current.mode) || mode
  const prot = (n) => gmode() === 'func' && (n.kind === 'enter' || n.kind === 'exit')

  const copySel = (cut) => {
    const ids = selectionRef.current
    if (!ids.length) return
    const g = graphRef.current
    const nodes = g.nodes.filter((n) => ids.includes(n.id))
    const kept = nodes.filter((n) => !prot(n))
    if (nodes.length && !kept.length) {
      warn('⊘ ENTER and EXIT are permanent to the function — they cannot be copied or cut')
      return
    }
    const keepIds = kept.map((n) => n.id)
    const links = g.links.filter((l) => keepIds.includes(l.from) && keepIds.includes(l.to))
    clipboardRef.current = JSON.parse(JSON.stringify({ nodes: kept, links }))
    if (cut) {
      mutate((gg) => ({
        ...gg,
        nodes: gg.nodes.filter((n) => !(ids.includes(n.id) && !prot(n))),
        links: gg.links.filter((l) => !(keepIds.includes(l.from) && keepIds.includes(l.to))),
        ...(gmode() === 'flow' ? { entry: ids.includes(gg.entry) ? null : gg.entry } : {}),
      }))
      setSelection([])
    } else if (warn) warn(`⧉ ${keepIds.length} part${keepIds.length > 1 ? 's' : ''} copied`)
  }

  const paste = () => {
    const clip = clipboardRef.current
    if (!clip || !clip.nodes.length) return
    // permanent doors never survive a paste either — a clipboard filled
    // before the rule applied, or carried from another canvas, can't
    // clone a function's ENTER/EXIT
    const safe = clip.nodes.filter((n) => !prot(n))
    if (!safe.length) return
    const safeIds = safe.map((n) => n.id)
    const fresh = reidGraph(
      JSON.parse(JSON.stringify({ id: uid('g'), mode: gmode(), name: '', entry: null, nodes: safe, links: clip.links.filter((l) => safeIds.includes(l.from) && safeIds.includes(l.to)) })),
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
