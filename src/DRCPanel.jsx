// The design-rule-check panel: live findings for the open graph or the whole
// doc, grouped per graph; clicking a finding jumps to its graph.
import React, { useState } from 'react'

const SEV = {
  error: { icon: '✕', cls: 'drc-err', title: 'error — will misrun as wired' },
  warn: { icon: '⚠', cls: 'drc-warn', title: 'warning — almost certainly unintended' },
  info: { icon: 'ℹ', cls: 'drc-info', title: 'info — works, but decide on purpose' },
}

export default function DRCPanel({ findings, scope, onScope, onJump, onClose }) {
  const [filter, setFilter] = useState('all')
  const counts = { error: 0, warn: 0, info: 0 }
  for (const f of findings) counts[f.sev]++
  const shown = findings.filter((f) => filter === 'all' || f.sev === filter)
  const groups = []
  for (const f of shown) {
    const last = groups[groups.length - 1]
    if (last && last.graph === f.graph) last.items.push(f)
    else groups.push({ graph: f.graph, items: [f] })
  }
  const btn = (id, text) => (
    <button className={`tb-btn ${filter === id ? 'tb-btn-on' : ''}`} onClick={() => setFilter(id)}>
      {text}
    </button>
  )
  return (
    <aside className="drc-panel">
      <div className="panel-head">
        <span className="panel-title">⚑ DESIGN RULES</span>
        <span className="spacer" />
        <button className="icon-btn" title="close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="drc-controls">
        <span className="tb-btn drc-scope" title="run over the open graph only">
          <button className={`tb-btn ${scope === 'graph' ? 'tb-btn-on' : ''}`} onClick={() => onScope('graph')}>
            this graph
          </button>
          <button className={`tb-btn ${scope === 'doc' ? 'tb-btn-on' : ''}`} onClick={() => onScope('doc')}>
            whole doc
          </button>
        </span>
      </div>
      <div className="drc-controls">
        {btn('all', `all ${findings.length}`)}
        {btn('error', `✕ ${counts.error}`)}
        {btn('warn', `⚠ ${counts.warn}`)}
        {btn('info', `ℹ ${counts.info}`)}
      </div>
      <div className="drc-list">
        {shown.length === 0 && (
          <div className="drc-clean">
            ✓ no violations — <b>clean board</b>
          </div>
        )}
        {groups.map((grp) => (
          <div key={grp.graph}>
            <div className="drc-graph" title="graph path">
              {grp.graph}
            </div>
            {grp.items.map((f, i) => (
              <button
                key={i}
                className={`drc-row ${SEV[f.sev].cls}`}
                title={`${SEV[f.sev].title} — click to open that graph`}
                onClick={() => onJump(f.path)}
              >
                <span className="drc-sev">{SEV[f.sev].icon}</span>
                <span className="drc-text">
                  {f.node && <b>{f.node} </b>}
                  {f.text}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}
