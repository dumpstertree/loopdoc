// The registry, now its own two tabs instead of a docked side panel.
// ASSETS holds the media lists split by kind (art / ui / audio / input);
// DATA holds ⚙ systems (with their inline API editors), ⚙ global variables
// and ≡ declared types — the same content the right-hand menu used to carry.
// No modals: inline rename / kind switch / note / API, usage counts across
// every graph.
import React, { useState } from 'react'
import { ASSET_KINDS, BASIC_TYPES, assetIcon, newAsset, newFn, newVar, newType, newGlobal, typeNames, walkGraphs } from './model.js'

function useCounts(doc) {
  const counts = {}
  const bump = (id) => {
    if (id) counts[id] = (counts[id] || 0) + 1
  }
  walkGraphs(doc.design, (g) => {
    for (const n of g.nodes) {
      bump(n.asset)
      for (const c of n.calls || []) bump(c.asset)
      for (const ea of n.assets || []) bump(ea.asset) // ENTER 📦 doors count as users too
    }
  })
  return counts
}

// one dropdown of every type: base + declared types, each with its array form
export function TypeSelect({ value, onChange, types, title }) {
  const names = typeNames(types)
  const v = value || ''
  const known = names.includes(v.replace('[]', ''))
  return (
    <select
      className="inp t"
      title={title || 'data type'}
      value={known ? v : '__legacy__'}
      onChange={(e) => onChange(e.target.value === '__legacy__' ? v : e.target.value)}
    >
      {v && !known && <option value="__legacy__">{v} (undeclared)</option>}
      {!v && <option value="">type…</option>}
      <optgroup label="base">
        {names.filter((n) => BASIC_TYPES.includes(n)).map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </optgroup>
      <optgroup label="arrays">
        {names.filter((n) => BASIC_TYPES.includes(n)).map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </optgroup>
      {names.filter((n) => !BASIC_TYPES.includes(n)).length > 0 && (
        <>
          <optgroup label="declared">
            {names.filter((n) => !BASIC_TYPES.includes(n)).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </optgroup>
          <optgroup label="declared arrays">
            {names.filter((n) => !BASIC_TYPES.includes(n)).map((n) => (
              <option key={n} value={n}>{n}[]</option>
            ))}
          </optgroup>
        </>
      )}
    </select>
  )
}

// small underline-free tab group used inside the ASSETS and DATA tabs
function SubTabs({ items, value, onChange }) {
  return (
    <div className="subtabs">
      {items.map(([id, label]) => (
        <button key={id} className={`subtab ${value === id ? 'subtab-on' : ''}`} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  )
}

// document-wide global variables: named, typed, with a default the app
// starts from — GET GLOBAL parts read them anywhere, SET GLOBAL parts write them.
// Rendered as a labelled grid so names, types, defaults and live values scan
// in columns instead of one run-on row.
function GlobalsSection({ globals, onGlobals, onResetGlobals, types, gstore }) {
  const set = (fn) => onGlobals(fn(globals))
  const upd = (i, patch) => set((l) => l.map((v, j) => (j === i ? { ...v, ...patch } : v)))
  const live = gstore ? gstore.vals(globals) : null
  return (
    <div className="types-box">
      <div className="io-label head">
        ⚙ GLOBAL VARIABLES — live session state · {globals.length}
        <button className="tb-btn" style={{ marginLeft: 'auto' }} onClick={() => set((l) => [...l, newGlobal('newVar')])}>
          + global
        </button>
        {live && (
          <button className="tb-btn" title="discard session values — everything restarts from the defaults" onClick={onResetGlobals}>
            ↺ defaults
          </button>
        )}
      </div>
      {globals.length > 0 && (
        <div className={`gv-row gv-h ${live ? 'gv-live-on' : ''}`}>
          <span />
          <span>NAME</span>
          <span>TYPE</span>
          <span>DEFAULT</span>
          {live && <span>LIVE</span>}
          <span />
        </div>
      )}
      {globals.map((v, i) => (
        <div className={`gv-row ${live ? 'gv-live-on' : ''}`} key={v.id}>
          <span className="ty-badge">⚙</span>
          <input
            className="inp ty-name"
            placeholder="name…"
            value={v.name}
            onChange={(e) => upd(i, { name: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <select className="inp" title="value type" value={v.type} onChange={(e) => upd(i, { type: e.target.value })}>
            {typeNames(types).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input
            className="inp"
            placeholder="default…"
            title="default value — a fresh session starts here (SET overwrites it live)"
            value={v.value}
            onChange={(e) => upd(i, { value: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
          {live && (
            <span
              className={`gv-live ${String(live[v.id]) === String(v.value ?? '') ? '' : 'changed'}`}
              title={`live session value — shared by every machine until ↺ defaults, opening a file, or reloading${String(live[v.id]) === String(v.value ?? '') ? '' : ' (default: ' + (v.value ?? '') + ')'}`}
            >
              = {String(live[v.id])}
            </span>
          )}
          <button className="icon-btn" title="delete global (GET/SET GLOBAL cards using it get flagged)" onClick={() => set((l) => l.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      {globals.length === 0 && <div className="reg-empty">named values shared by every graph &amp; machine — read via GET GLOBAL parts, write via SET GLOBAL</div>}
    </div>
  )
}

// declared data shapes: one card per type — name in a highlighted header bar,
// fields in aligned FIELD | TYPE columns underneath
function TypesSection({ types, onTypes }) {
  const set = (fn) => onTypes(fn(types))
  const upd = (i, patch) => set((list) => list.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  return (
    <div className="types-box">
      <div className="io-label head">
        ≡ TYPES — named data shapes · {types.length}
        <button className="tb-btn" style={{ marginLeft: 'auto' }} onClick={() => set((l) => [...l, newType('NewType')])}>
          + type
        </button>
      </div>
      {types.length === 0 && <div className="reg-empty">declare the shapes your data travels in — every fn variable and ⇣ port picks from these</div>}
      {types.map((t, i) => (
        <div className="ty-card" key={t.id}>
          <div className="ty-head">
            <span className="ty-badge">≡</span>
            <input
              className="inp ty-name"
              placeholder="TypeName…"
              value={t.name}
              onChange={(e) => upd(i, { name: e.target.value })}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <span className="io-label">{(t.fields || []).length} fields</span>
            <button className="icon-btn" title="delete type (usages keep the name)" onClick={() => set((l) => l.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
          {(t.fields || []).length > 0 && (
            <div className="ty-row ty-h">
              <span>FIELD</span>
              <span>TYPE</span>
              <span />
            </div>
          )}
          {(t.fields || []).map((f, j) => (
            <div className="ty-row" key={f.id}>
              <input
                className="inp"
                placeholder="field…"
                value={f.name}
                onChange={(e) => upd(i, { fields: t.fields.map((x, k) => (k === j ? { ...x, name: e.target.value } : x)) })}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <TypeSelect
                types={types}
                value={f.typeId}
                onChange={(typeId) => upd(i, { fields: t.fields.map((x, k) => (k === j ? { ...x, typeId } : x)) })}
              />
              <button className="icon-btn" onClick={() => upd(i, { fields: t.fields.filter((_, k) => k !== j) })}>
                ×
              </button>
            </div>
          ))}
          <div className="ty-foot">
            <button
              className="tb-btn"
              onClick={() => upd(i, { fields: [...(t.fields || []), { id: `${t.id}_f${Date.now().toString(36)}`, name: '', typeId: 'int' }] })}
            >
              + field
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// API functions, always open for editing — same anatomy as a type card: a
// header bar (ƒ badge, name and description edited in place) over always-visible
// ⇣ input / ⇡ output columns. No expand button anywhere.
function ApiEditor({ asset, onChange, types }) {
  const api = asset.api || []
  const set = (next) => onChange({ ...asset, api: next })
  const upd = (i, patch) => set(api.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  const updVar = (fi, key, vi, patch) =>
    upd(fi, { [key]: api[fi][key].map((v, j) => (j === vi ? { ...v, ...patch } : v)) })
  return (
    <div className="api-box">
      <div className="io-label head">API · {api.length} — exposed to event & sys-call nodes</div>
      {api.map((f, i) => (
        <div className="fn-card" key={f.id}>
          <div className="ty-head">
            <span className="ty-badge">ƒ</span>
            <input
              className="inp ty-name"
              style={{ flex: '1 1 140px' }}
              placeholder="fn name…"
              value={f.name}
              onChange={(e) => upd(i, { name: e.target.value })}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <input
              className="inp fn-desc-in"
              placeholder="description — optional; the llm export reads it after the signature"
              value={f.desc || ''}
              onChange={(e) => upd(i, { desc: e.target.value })}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button className="icon-btn" title="delete fn" onClick={() => set(api.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
          <div className="fn-cols">
            {[
              ['inputs', '⇣ INPUTS (the call takes)'],
              ['outputs', '⇡ OUTPUTS (the call returns)'],
            ].map(([key, label]) => (
              <div className="fn-col" key={key}>
                <div className="io-label">{label}</div>
                {(f[key] || []).map((v, j) => (
                  <div className="api-var" key={v.id}>
                    <input
                      className="inp"
                      placeholder="var…"
                      value={v.name}
                      onChange={(e) => updVar(i, key, j, { name: e.target.value })}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                    <TypeSelect types={types} value={v.type} onChange={(type) => updVar(i, key, j, { type })} />
                    <button className="icon-btn" onClick={() => upd(i, { [key]: f[key].filter((_, j2) => j2 !== j) })}>
                      ×
                    </button>
                  </div>
                ))}
                {(f[key] || []).length === 0 && <div className="fn-none">— none —</div>}
                <button className="tb-btn" onClick={() => upd(i, { [key]: [...(f[key] || []), newVar()] })}>
                  + {key.slice(0, -1)}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      <button className="tb-btn" onClick={() => set([...api, newFn()])}>
        + function
      </button>
    </div>
  )
}

// one asset: the same card design as TYPES — name inline-edited right in the
// header bar (no edit button), body always visible: note, plus the API editor
// for ⚙ systems. Kind is concrete — set by the tab that creates the asset and
// never switched afterwards; a different kind means a new asset
function AssetCard({ a, upd, onRemove, count, types = [] }) {
  const kind = ASSET_KINDS.find((k) => k.id === a.kind)
  return (
    <div className="ty-card">
      <div className="ty-head">
        <span className="asset-kind-badge" title={kind ? kind.label : 'asset kind'}>
          {assetIcon(a.kind)}
        </span>
        <input
          className="inp ty-name"
          placeholder="asset name…"
          value={a.name}
          onChange={(e) => upd({ ...a, name: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <span className={`asset-used ${count ? '' : 'n'}`} title="uses across every graph">
          {count ? `${count}×` : '0×'}
        </span>
        {a.kind === 'system' && (
          <span className="fn-badge" title="API functions">
            {(a.api || []).length} ƒ
          </span>
        )}
        <button className="icon-btn" title="delete asset (removes all links to it)" onClick={() => onRemove(a.id)}>
          ×
        </button>
      </div>
      <div className="asset-body">
        <textarea
          className="inp"
          rows={1}
          placeholder="note — what is this asset?"
          value={a.note || ''}
          onChange={(e) => upd({ ...a, note: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {a.kind === 'system' && <ApiEditor asset={a} onChange={upd} types={types} />}
      </div>
    </div>
  )
}

// shared card-list machinery for both tabs: doc assets, mutations, counts
function useAssetOps(doc, onAssets, onRemove) {
  const assets = doc.assets || []
  const counts = useCounts(doc)
  const set = (fnOrList) => onAssets(typeof fnOrList === 'function' ? fnOrList(assets) : fnOrList)
  const upd = (a) => set((list) => list.map((x) => (x.id === a.id ? a : x)))
  return { assets, counts, set, upd, onRemove }
}

const KIND_TITLES = { art: '🎨 ART', ui: '🖥️ UI', audio: '🔊 AUDIO', input: '🎮 INPUT', system: '⚙️ SYSTEMS' }
const EMPTY_HINT = {
  art: 'No art assets yet — name the sprites, tiles and images this design needs.',
  ui: 'No UI assets yet — screens, buttons, HUD elements…',
  audio: 'No audio assets yet — music, sfx, ambiences…',
  input: 'No input assets yet — named key/button bindings systems can ask about.',
  system: 'No systems yet — a system is a black box with a typed API: add one, then declare its functions and events.',
}

// a media kind list with its add button (art / ui / audio / input)
function KindList({ kind, ops, onAdd, types }) {
  const items = ops.assets.filter((a) => a.kind === kind)
  return (
    <div className="reg-list">
      <div className="io-label head">
        {KIND_TITLES[kind]} · {items.length}
        <button className="tb-btn" style={{ marginLeft: 'auto' }} onClick={onAdd}>
          + {kind}
        </button>
      </div>
      {items.map((a) => (
        <AssetCard key={a.id} a={a} upd={ops.upd} onRemove={ops.onRemove} count={ops.counts[a.id]} types={types} />
      ))}
      {items.length === 0 && <div className="modal-sub" style={{ padding: 8 }}>{EMPTY_HINT[kind]}</div>}
    </div>
  )
}

// the ASSETS tab — media lists by kind; ⚙ systems live in the DATA tab
export function AssetsTab({ doc, types = [], onAssets, onRemove }) {
  const kinds = ASSET_KINDS.filter((k) => k.id !== 'system')
  const [sub, setSub] = useState('art')
  const ops = useAssetOps(doc, onAssets, onRemove)
  return (
    <div className="reg-tab">
      <SubTabs
        items={kinds.map((k) => [k.id, `${k.icon} ${k.label.toUpperCase()} · ${ops.assets.filter((a) => a.kind === k.id).length}`])}
        value={sub}
        onChange={setSub}
      />
      <div className="reg-body">
        <KindList
          kind={sub}
          ops={ops}
          types={types}
          onAdd={() => {
            ops.set((list) => [...list, newAsset(sub)])
          }}
        />
      </div>
    </div>
  )
}

// the DATA tab — ⚙ systems & their APIs, global variables, declared types
export function DataTab({ doc, types, onTypes, globals = [], onGlobals, onResetGlobals, gstore, onAssets, onRemove }) {
  const [sub, setSub] = useState('systems')
  const ops = useAssetOps(doc, onAssets, onRemove)
  const systems = ops.assets.filter((a) => a.kind === 'system')
  return (
    <div className="reg-tab">
      <SubTabs
        items={[
          ['systems', `⚙️ SYSTEMS · ${systems.length}`],
          ['globals', `⚙ GLOBAL VARIABLES · ${globals.length}`],
          ['types', `≡ TYPES · ${(types || []).length}`],
        ]}
        value={sub}
        onChange={setSub}
      />
      <div className="reg-body">
        {sub === 'systems' && (
          <div className="reg-list">
            <div className="io-label head">
              ⚙️ SYSTEMS — black boxes with typed APIs · {systems.length}
              <button
                className="tb-btn"
                style={{ marginLeft: 'auto' }}
                onClick={() => {
                  ops.set((list) => [...list, newAsset('system')])
                }}
              >
                + system
              </button>
            </div>
            {systems.map((a) => (
              <AssetCard key={a.id} a={a} upd={ops.upd} onRemove={ops.onRemove} count={ops.counts[a.id]} types={types || []} />
            ))}
            {systems.length === 0 && <div className="modal-sub" style={{ padding: 8 }}>{EMPTY_HINT.system}</div>}
          </div>
        )}
        {sub === 'globals' && (
          <div className="reg-list">
            <GlobalsSection globals={globals} onGlobals={onGlobals} onResetGlobals={onResetGlobals} gstore={gstore} types={types} />
          </div>
        )}
        {sub === 'types' && (
          <div className="reg-list">
            <TypesSection types={types || []} onTypes={onTypes} />
          </div>
        )}
      </div>
    </div>
  )
}
