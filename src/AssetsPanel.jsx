// Docked assets panel: everything asset-related lives here — quick-add per
// kind, inline rename / kind switch / note, usage counts across every graph,
// and for ⚙️ systems the API editor (functions with typed ⇣/⇡ variables)
// inline in the card. No modals.
import React, { useState } from 'react'
import { ASSET_KINDS, assetIcon, newAsset, newFn, newVar, walkGraphs } from './model.js'

function useCounts(doc) {
  const counts = {}
  const bump = (id) => {
    if (id) counts[id] = (counts[id] || 0) + 1
  }
  walkGraphs(doc.design, (g) => {
    for (const n of g.nodes) {
      bump(n.asset)
      for (const c of n.calls || []) bump(c.asset)
    }
  })
  return counts
}

function ApiEditor({ asset, onChange }) {
  const api = asset.api || []
  const set = (next) => onChange({ ...asset, api: next })
  const upd = (i, patch) => set(api.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  const updVar = (fi, key, vi, patch) =>
    upd(fi, { [key]: api[fi][key].map((v, j) => (j === vi ? { ...v, ...patch } : v)) })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="io-label">API — event & sys-call nodes expose these functions</div>
      {api.map((f, i) => (
        <div className="api-fn" key={f.id}>
          <div className="api-var">
            <span className="io-label">ƒ</span>
            <input
              className="inp"
              style={{ flex: 1 }}
              placeholder="fn name…"
              value={f.name}
              onChange={(e) => upd(i, { name: e.target.value })}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button className="icon-btn" title="delete fn" onClick={() => set(api.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
          {[
            ['inputs', '⇣ INPUTS (the call takes)'],
            ['outputs', '⇡ OUTPUTS (the call returns)'],
          ].map(([key, label]) => (
            <div className="api-io" key={key}>
              <div className="io-label">{label}</div>
              {(f[key] || []).map((v, j) => (
                <div className="api-var" key={v.id}>
                  <input
                    className="inp"
                    style={{ flex: 1 }}
                    placeholder="var…"
                    value={v.name}
                    onChange={(e) => updVar(i, key, j, { name: e.target.value })}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                  <input
                    className="inp t"
                    style={{ width: 84 }}
                    placeholder="type…"
                    title="free-form type: int, float, EnemyId, loot table…"
                    value={v.type}
                    onChange={(e) => updVar(i, key, j, { type: e.target.value })}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                  <button className="icon-btn" onClick={() => upd(i, { [key]: f[key].filter((_, j2) => j2 !== j) })}>
                    ×
                  </button>
                </div>
              ))}
              <button className="tb-btn" onClick={() => upd(i, { [key]: [...(f[key] || []), newVar()] })}>
                + {key.slice(0, -1)}
              </button>
            </div>
          ))}
        </div>
      ))}
      <button className="tb-btn" onClick={() => set([...api, newFn()])}>
        + function
      </button>
    </div>
  )
}

export default function AssetsPanel({ doc, onAssets, onRemove, onClose }) {
  const assets = doc.assets || []
  const counts = useCounts(doc)
  const [open, setOpen] = useState(null) // asset id whose card is expanded
  const set = (fnOrList) => onAssets(typeof fnOrList === 'function' ? fnOrList(assets) : fnOrList)
  const upd = (a) => set((list) => list.map((x) => (x.id === a.id ? a : x)))
  const cycleKind = (a) => {
    const i = ASSET_KINDS.findIndex((k) => k.id === a.kind)
    const kind = ASSET_KINDS[(i + 1) % ASSET_KINDS.length].id
    const next = { ...a, kind, api: kind === 'system' ? a.api || [] : undefined }
    upd(next)
  }

  return (
    <aside className="assets-panel">
      <div className="panel-head">
        <span className="panel-title">📦 ASSETS</span>
        <span className="modal-sub">{assets.length}</span>
        <span className="spacer" />
        <button className="icon-btn" title="hide panel" onClick={onClose}>
          —
        </button>
      </div>
      <div className="assets-list">
        {assets.map((a) => (
          <div key={a.id} className={`asset-card ${open === a.id ? 'sel' : ''}`}>
            <div className="asset-row">
              <button className="asset-kind-btn" title="click to switch kind" onClick={() => cycleKind(a)}>
                {assetIcon(a.kind)}
              </button>
              <input
                className="inp asset-name"
                placeholder="asset name…"
                value={a.name}
                onChange={(e) => upd({ ...a, name: e.target.value })}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <span className={`asset-used ${counts[a.id] ? '' : 'n'}`}>{counts[a.id] ? `${counts[a.id]}×` : '0×'}</span>
              <button className="icon-btn" title={open === a.id ? 'collapse' : 'edit — note & api'} onClick={() => setOpen(open === a.id ? null : a.id)}>
                ✎
              </button>
              <button className="icon-btn" title="delete asset (removes all links to it)" onClick={() => onRemove(a.id)}>
                🗑
              </button>
            </div>
            {open === a.id && (
              <div className="asset-detail">
                <select className="inp" value={a.kind} onChange={(e) => {
                  const kind = e.target.value
                  upd({ ...a, kind, api: kind === 'system' ? a.api || [] : undefined })
                }}>
                  {ASSET_KINDS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.icon} {k.label}
                    </option>
                  ))}
                </select>
                <textarea
                  className="inp"
                  rows={2}
                  placeholder="note — what is this asset?"
                  value={a.note || ''}
                  onChange={(e) => upd({ ...a, note: e.target.value })}
                  onKeyDown={(e) => e.stopPropagation()}
                />
                {a.kind === 'system' && <ApiEditor asset={a} onChange={upd} />}
              </div>
            )}
          </div>
        ))}
        {assets.length === 0 && (
          <div className="modal-sub" style={{ padding: 8 }}>
            No assets yet. Add one below — ⚙️ systems get an API you can wire into events & machines.
          </div>
        )}
      </div>
      <div className="add-row">
        {ASSET_KINDS.map((k) => (
          <button
            key={k.id}
            className="tb-btn"
            title={`add ${k.label} asset`}
            onClick={() => {
              const a = newAsset(k.id)
              set((list) => [...list, a])
              setOpen(a.id)
            }}
          >
            + {k.icon}
          </button>
        ))}
      </div>
    </aside>
  )
}
