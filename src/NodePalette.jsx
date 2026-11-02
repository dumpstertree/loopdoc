import React, { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyRank } from './fuzzy.js'

// Space-bar node palette — the quick-add search every canvas shares.
// Fuzzy-matches the query against each node's label and hint, ranks by
// relevance, and drops the highlighted node where the cursor was when
// space was pressed. ↑/↓ move, Enter or click picks, Escape or clicking
// off closes. Rendered inside .canvas-wrap (position:relative), so it sits
// at viewport coordinates and never scrolls away with the surface.
export function NodePalette({ items, x, y, noun = 'node', onPick, onClose }) {
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const matches = useMemo(() => fuzzyRank(items, q), [items, q])
  const qRef = useRef(q)
  qRef.current = q
  const matchesRef = useRef(matches)
  matchesRef.current = matches
  const pickRef = useRef(null)

  const pick = (item) => {
    if (!item) return
    pickRef.current = item // set last, checked by the outside-click guard
    onClose()
    onPick(item.id) // canvases take the kind string, not the palette row
  }

  useEffect(() => {
    const el = inputRef.current
    if (el) el.focus()
  }, [])

  // keep the highlighted row scrolled into view
  useEffect(() => {
    const el = listRef.current?.querySelector('.np-sel')
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [hi])

  const onKeyDown = (e) => {
    e.stopPropagation() // canvas window-shortcuts must not see these
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi((h) => (matchesRef.current.length ? (h + 1) % matchesRef.current.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((h) => (matchesRef.current.length ? (h - 1 + matchesRef.current.length) % matchesRef.current.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(matchesRef.current[Math.min(hi, matchesRef.current.length - 1)])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <>
      <div
        className="np-backdrop"
        onPointerDown={(e) => {
          e.stopPropagation() // no box-select / drag starts under the palette
          if (pickRef.current) return // picked — the closing click does nothing
          onClose()
        }}
      />
      <div className="node-palette" style={{ left: Math.max(8, x), top: Math.max(8, y), maxWidth: 'calc(100% - 16px)' }}>
        <input
          ref={inputRef}
          className="np-input"
          placeholder={`find ${noun}…  ↑↓ move · enter add · esc close`}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setHi(0)
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
        <div className="np-list" ref={listRef}>
          {matches.map((it, i) => (
            <div
              key={it.id}
              className={`np-item ${i === Math.min(hi, matches.length - 1) ? 'np-sel' : ''}`}
              onPointerMove={() => setHi(i)}
              onPointerDown={(e) => {
                e.stopPropagation()
                pick(it)
              }}
            >
              <span className="np-kind">{it.label}</span>
              <span className="np-hint">{it.hint}</span>
            </div>
          ))}
          {matches.length === 0 && <div className="np-none">no {noun} matches “{qRef.current}”</div>}
        </div>
        <div className="np-foot">
          {matches.length}/{items.length} {noun}{matches.length === 1 ? '' : 's'}
        </div>
      </div>
    </>
  )
}
