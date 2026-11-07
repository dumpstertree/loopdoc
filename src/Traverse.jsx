// ▶ Traverse — a story walkthrough of the flow graphs (machines are not
// simulated here, only reported). Flow arrives at the entry, applies each
// node's effect (load/unload, input, var, events + their data wiring), and
// auto-advances through single-exit nodes. IF/CHOICE (and ambiguous wires)
// pause for a click. GRAPH nodes nest: their inner chain runs until it dead
// ends, then pops back through the node's RETURN exit.
import React, { useEffect, useState } from 'react'
import { kindMeta, resolveCall, fnSig, assetLabel } from './model.js'

const nameOf = (n) => n?.name || KINDLABEL[n?.kind] || n?.kind || '?'
const KINDLABEL = {
  step: 'step', event: 'event', condition: 'if', choice: 'choice', load: 'load', unload: 'unload',
  input: 'input', var: 'var', graph: 'graph', machine: 'machine',
}

// display a typed VAR value at full depth — arrays as lists, structs with
// every field, nesting exactly as the card's fill-in laid it out
const fmtV = (v) =>
  Array.isArray(v)
    ? `[${v.map(fmtV).join(', ')}]`
    : v && typeof v === 'object'
      ? `{ ${Object.entries(v).map(([k, x]) => `${k}: ${fmtV(x)}`).join(', ')} }`
      : v === '' || v === null || v === undefined
        ? '(empty)'
        : String(v)

function applyEnter(node, st, graph) {
  const L = st.log
  const A = st.assets
  switch (node.kind) {
    case 'event': {
      L.push(`⚡ ${node.name || '(unnamed event)'} fires`)
      if (node.gen && (node.gen.name || '').trim())
        L.push(`   ✨ generated: ${node.gen.name} (exists only in this graph)`)
      for (const call of node.calls || []) {
        const r = resolveCall(call, A)
        if (!r) {
          L.push(`   ⚙️ system call — ⚠ asset or fn not picked`)
          continue
        }
        const sig = fnSig(r)
        L.push(`   ⚙️ ${r.asset.name || 'system'} → ${r.fn.name || '?'}(${sig.in}) ⇡ ${sig.out}`)
        for (const v of r.fn.inputs || []) {
          const w = (graph.links || []).find((l) => l.kind === 'data' && l.to === node.id && l.toPort === v.id)
          if (!w) {
            const c = (node.cVals || {})[v.id]
            if (c !== undefined && String(c).trim() !== '')
              L.push(`      ⇂ input ${v.name || '?'}:${v.type || '?'} = ${fmtV(c)} (typed on the card)`)
            else L.push(`      ⚠ input ${v.name || '?'}:${v.type || '?'} has no data wire`)
          }
        }
      }
      break
    }
    case 'load': {
      if (!node.asset) L.push(`⬇ load node has no asset`)
      else if (st.loaded.includes(node.asset)) L.push(`⬇ ${assetLabel(node.asset, A)} already loaded`)
      else {
        st.loaded = [...st.loaded, node.asset]
        L.push(`⬇ loaded ${assetLabel(node.asset, A)}`)
      }
      break
    }
    case 'unload': {
      if (!node.asset) L.push(`⬆ unload node has no asset`)
      else if (!st.loaded.includes(node.asset)) L.push(`⬆ ${assetLabel(node.asset, A)} was not loaded`)
      else {
        st.loaded = st.loaded.filter((x) => x !== node.asset)
        L.push(`⬆ unloaded ${assetLabel(node.asset, A)}`)
      }
      break
    }
    case 'input': {
      if (!node.asset) L.push(`🎮 input node has no input asset`)
      else {
        st.lastInput = node.asset
        L.push(`🎮 applied ${assetLabel(node.asset, A)}`)
      }
      break
    }
    case 'var': {
      const v = node.variable || {}
      L.push(`📝 ${v.name || '?'}${v.type ? `:${v.type}` : ''} = ${fmtV(v.value)}`)
      break
    }
    case 'machine':
      L.push(`⚙ machine "${node.name || '?'}" — ${node.graph?.nodes.length || 0} parts (open it to simulate)`)
      break
    case 'func':
      L.push(`ƒ ${node.fName || 'function'} — isolated function called, chain continues`)
      break
    default:
      L.push(`· ${nameOf(node)}${node.note ? ` — ${node.note}` : ''}`)
  }
}

// candidates for the next hop from `node`
function nextOptions(node, graph, viaReturn) {
  const meta = kindMeta(node)
  const flows = (graph.links || []).filter((l) => l.kind !== 'data' && l.from === node.id)
  if (node.kind === 'graph' && viaReturn) return flows.filter((l) => l.fromPort === 'return')
  return flows
}

export default function Traverse({ doc, onClose }) {
  const [st, setSt] = useState(null)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const start = () => {
    const root = doc.design
    const entry = root.nodes.find((n) => n.id === root.entry) || root.nodes[0]
    if (!entry) return
    const s = { log: [`▶ walk starts — "${entry.name || entry.kind}"`], loaded: [], lastInput: null, assets: doc.assets, ask: null, done: false, frames: [{ graph: root, nodeId: entry.id }] }
    applyEnter(entry, s, root)
    settle(s)
    setSt(s)
  }

  const settle = (s) => {
    let guard = 0
    while (!s.done && !s.ask && guard++ < 500) {
      const f = s.frames[s.frames.length - 1]
      const node = f.graph.nodes.find((n) => n.id === f.nodeId)
      if (!node) {
        s.log.push('⚠ broken path — node missing')
        s.done = true
        break
      }
      // descend into nested graphs on arrival
      if (node.kind === 'graph' && !f.returned && node.graph && node.graph.nodes.length) {
        const inner = node.graph.nodes.find((n) => n.id === node.graph.entry) || node.graph.nodes[0]
        s.log.push(`▸ enter graph "${node.name || '?'}" → "${inner.name || inner.kind}"`)
        s.frames.push({ graph: node.graph, nodeId: inner.id })
        applyEnter(inner, s, node.graph)
        continue
      }
      if (node.kind === 'graph' && !node.graph?.nodes?.length) {
        s.log.push(`▸ graph "${node.name || '?'}" is empty — skipping through`)
      }
      const opts = nextOptions(node, f.graph, !!f.returned)
      if (node.kind === 'graph') f.returned = false
      const label = (link) => {
        const target = f.graph.nodes.find((n) => n.id === link.to)
        const exitLabel = kindMeta(node).ports(node).find((p) => p.id === link.fromPort)?.label
        return exitLabel ? `${exitLabel} → ${nameOf(target)}` : nameOf(target)
      }
      if (opts.length === 0) {
        if (s.frames.length > 1) {
          s.frames.pop()
          const parent = s.frames[s.frames.length - 1]
          parent.returned = true
          const pn = parent.graph.nodes.find((n) => n.id === parent.nodeId)
          s.log.push(`↩ "${nameOf(node)}" ends — back to "${nameOf(pn)}" via RETURN`)
          continue
        }
        s.log.push('■ chain ends here')
        s.done = true
        break
      }
      if (opts.length === 1) {
        const link = opts[0]
        const target = f.graph.nodes.find((n) => n.id === link.to)
        if (!target) {
          s.log.push('⚠ link points to a missing node')
          s.done = true
          break
        }
        s.log.push(`→ ${label(link)}`)
        f.nodeId = target.id
        applyEnter(target, s, f.graph)
        continue
      }
      // several possible next steps — ask
      s.ask = opts.map((link) => ({ label: label(link), nodeId: link.to, graph: f.graph }))
      s.log.push(`? ${nameOf(node)} → which way?`)
    }
    if (guard >= 500) s.log.push('⚠ step limit hit — possible loop without user input')
  }

  const answer = (choice) => {
    if (!st?.ask) return
    const s = { ...st, ask: null }
    const f = s.frames[s.frames.length - 1]
    s.log.push(`→ ${choice.label}`)
    f.nodeId = choice.nodeId
    const target = f.graph.nodes.find((n) => n.id === choice.nodeId)
    if (target) applyEnter(target, s, f.graph)
    settle(s)
    setSt(s)
  }

  return (
    <div className="traverse">
      <div className="traverse-head">
        <span className="modal-title">▶ TRAVERSE</span>
        <span className="spacer" />
        <button className="btn" onClick={start}>
          {st ? '↺ restart' : '▶ start'}
        </button>
        <button className="btn" onClick={onClose}>
          close ×
        </button>
      </div>
      {st && (
        <>
          <div className="traverse-input">
            loaded: <b>{st.loaded.length ? st.loaded.map((id) => assetLabel(id, doc.assets)).join(', ') : '—'}</b>
          </div>
          <div className="traverse-input">
            last input: <b>{st.lastInput ? assetLabel(st.lastInput, doc.assets) : '—'}</b>
          </div>
          {st.ask && (
            <div className="traverse-input" style={{ flexWrap: 'wrap', gap: 6 }}>
              <span style={{ color: 'var(--magenta)' }}>choose ▸</span>
              {st.ask.map((c, i) => (
                <button key={i} className="btn btn-hi" onClick={() => answer(c)}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div className="traverse-log">
        {st ? (
          st.log.map((l, i) => (
            <div key={i} className="log-line">
              {l}
            </div>
          ))
        ) : (
          <span className="modal-sub">
            Walks the flow from the ▶ START node: assets in/out, inputs, vars, events, system calls and their
            data wiring. Nested graphs run and return. Press start.
          </span>
        )}
      </div>
    </div>
  )
}
