import { useEffect, useMemo, useRef, useState } from 'react'

// Animated markers that travel along a connection path while a node is hovered.
// Flow (control) wires get triangles; data/variable wires get circles. The
// motion follows the path direction: away from an out port, into an in port.

const SPEED = 140 // px/s — constant travel speed regardless of wire length
const SPACING = 72 // px between markers, so spacing stays even across wire lengths
const FADE_MS = 160

const lenCache = new Map()
function pathLength(d) {
  if (!d || typeof document === 'undefined') return 0
  let v = lenCache.get(d)
  if (v !== undefined) return v
  try {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    p.setAttribute('d', d)
    const len = p.getTotalLength()
    v = Number.isFinite(len) ? len : 0
  } catch {
    v = 0
  }
  if (lenCache.size > 4000) lenCache.clear()
  lenCache.set(d, v)
  return v
}

export default function WireFlow({ d, kind = 'flow', stale = false, active = true }) {
  const [show, setShow] = useState(active)
  const [vis, setVis] = useState(false)
  const animRefs = useRef([])
  animRefs.current = []

  useEffect(() => {
    if (active) {
      setShow(true)
      const id = requestAnimationFrame(() => setVis(true))
      return () => cancelAnimationFrame(id)
    }
    setVis(false)
    const t = setTimeout(() => setShow(false), FADE_MS)
    return () => clearTimeout(t)
  }, [active])

  const geom = useMemo(() => {
    const len = pathLength(d)
    const durNum = Math.max(0.6, Math.min(12, len > 0 ? len / SPEED : 1.5))
    // place markers at a consistent pixel spacing regardless of wire length
    const count = Math.max(2, Math.min(14, len > 0 ? Math.round(len / SPACING) : 3))
    const offsets = Array.from({ length: count }, (_, i) => -(durNum * i) / count)
    return { dur: `${durNum}s`, offsets }
  }, [d])

  useEffect(() => {
    if (!vis || !show) return
    // start SMIL after paint to avoid a mount-time stutter
    const { offsets } = geom
    const id = requestAnimationFrame(() => {
      animRefs.current.forEach((a, i) => {
        try {
          a && a.beginElementAt ? a.beginElementAt(offsets[i] ?? 0) : a && a.beginElement && a.beginElement()
        } catch {}
      })
    })
    return () => cancelAnimationFrame(id)
  }, [vis, show, d, geom])

  if (!d || !show) return null
  const isFlow = kind === 'flow'
  const color = isFlow ? 'var(--cyan)' : stale ? 'var(--urgent)' : 'var(--mint)'
  const { dur, offsets } = geom
  return (
    <g
      className="wire-flow"
      pointerEvents="none"
      style={{ opacity: vis ? 1 : 0, transition: `opacity ${FADE_MS}ms ease` }}
    >
      {offsets.map((_, i) =>
        isFlow ? (
          <polygon key={i} points="-5,-3.5 6,0 -5,3.5" fill={color} opacity="0.9">
            <animateMotion
              ref={(el) => { if (el) animRefs.current[i] = el }}
              dur={dur}
              repeatCount="indefinite"
              begin="indefinite"
              path={d}
              rotate="auto"
            />
          </polygon>
        ) : (
          <circle key={i} r="3" fill={color} opacity="0.9">
            <animateMotion
              ref={(el) => { if (el) animRefs.current[i] = el }}
              dur={dur}
              repeatCount="indefinite"
              begin="indefinite"
              path={d}
            />
          </circle>
        ),
      )}
    </g>
  )
}
