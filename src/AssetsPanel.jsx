// The registry, now its own two tabs instead of a docked side panel.
// ASSETS holds the media lists split by kind (art / ui / audio / input);
// DATA holds ⚙ systems (with their inline API editors), ⚙ global variables
// and ≡ declared types — the same content the right-hand menu used to carry.
// No modals: inline rename / kind switch / note / API, usage counts across
// every graph.
import React, { useState } from 'react'
import { ASSET_KINDS, BASIC_TYPES, assetIcon, newAsset, newFn, newFunc, newVar, newType, newGlobal, typeNames, walkGraphs } from './model.js'

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
  // function bodies use assets like any other canvas
  for (const f of doc.funcs || []) walkGraphs(f.graph || { nodes: [] }, (g) => {
    for (const n of g.nodes) {
      bump(n.asset)
      for (const c of n.calls || []) bump(c.asset)
      for (const ea of n.assets || []) bump(ea.asset)
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
          <option key={n} value={`${n}[]`}>{n}[]</option>
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
              <option key={`${n}[]`} value={`${n}[]`}>{n}[]</option>
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
  // ⌁ web types stay in the doc list (canvases pick them) but are fetched,
  // not declared — they render nowhere here; indices keep addressing the
  // full list so edits never drift off their doc slot
  const shown = types.filter((t) => !t.web).length
  return (
    <div className="types-box">
      <div className="io-label head">
        ≡ TYPES — named data shapes · {shown}
        <button className="tb-btn" style={{ marginLeft: 'auto' }} onClick={() => set((l) => [...l, newType('NewType')])}>
          + type
        </button>
      </div>
      {shown === 0 && <div className="reg-empty">declare the shapes your data travels in — every fn variable and ⇣ port picks from these</div>}
      {types.map((t, i) =>
        t.web ? null : (
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

// ƒ FUNCTIONS — isolated computations on the doc, picked by FUNC parts on any
// machine canvas. Each definition owns a `func` body graph right now empty but
// ready to hold its nodes and links, so a function is a first-class part of the
// document like a type or a system, not a node hiding inside another graph.
function FuncsSection({ funcs, onFuncs, uses }) {
  const set = (fn) => onFuncs(fn(funcs))
  const upd = (i, patch) => set((l) => l.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  return (
    <div className="types-box">
      <div className="io-label head">
        ƒ FUNCTIONS — isolated bodies picked by FUNC parts · {funcs.length}
        <button className="tb-btn" style={{ marginLeft: 'auto' }} onClick={() => set((l) => [...l, newFunc('newFn')])}>
          + function
        </button>
      </div>
      {funcs.length === 0 && (
        <div className="reg-empty">
          define one isolated computation — a FUNC part on any machine canvas picks it by name · the body graph keeps its
          nodes
        </div>
      )}
      {funcs.map((f, i) => (
        <div className="fn-card" key={f.id}>
          <div className="ty-head">
            <span className="ty-badge">ƒ</span>
            <input
              className="inp ty-name"
              placeholder="fn name…"
              value={f.name}
              onChange={(e) => upd(i, { name: e.target.value })}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <span className="io-label">{(f.graph?.nodes || []).length} parts · used by {uses[f.id] || 0}</span>
            <button
              className="icon-btn"
              title="delete function (FUNC parts still picking it get flagged)"
              onClick={() => set((l) => l.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
          <div className="fn-row">
            <span className="io-label">note</span>
            <input
              className="inp"
              style={{ flex: 1 }}
              placeholder="what it does…"
              value={f.note}
              onChange={(e) => upd(i, { note: e.target.value })}
              onKeyDown={(e) => e.stopPropagation()}
            />
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
      <div className="io-label head">API · {api.length} — exposed to SYS CALL nodes</div>
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

// ledger variables section for ⚙ systems: dropdowns offering every type
// (base + declared) and their array variants, plus array size hints
function LedgerVariables({ ledger, onUpdate, types = [] }) {
  if (!ledger || !Array.isArray(ledger)) return null
  const set = (fn) => onUpdate(fn(ledger))
  const upd = (i, patch) => set((l) => l.map((v, j) => (j === i ? { ...v, ...patch } : v)))
  const addVar = () => set((l) => [...l, { id: Date.now().toString(36), name: '', type: 'string', size: '' }])
  const removeVar = (i) => set((l) => l.filter((_, j) => j !== i))
  return (
    <div className="ledger-section">
      <div className="io-label head">
        📊 LEDGER VARIABLES · {ledger.length}
        <button className="tb-btn" style={{ marginLeft: 'auto' }} onClick={addVar}>
          + variable
        </button>
      </div>
      {ledger.length > 0 && (
        <div className={`gv-row gv-h`} style={{ marginTop: '6px' }}>
          <span />
          <span>VARIABLE</span>
          <span>TYPE</span>
          <span>SIZE</span>
          <span />
        </div>
      )}
      {ledger.map((v, i) => (
        <div className={`gv-row`} key={v.id} style={{ marginTop: '4px' }}>
          <span className="ty-badge">📊</span>
          <input
            className="inp ty-name"
            placeholder="var…"
            value={v.name}
            onChange={(e) => upd(i, { name: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <TypeSelect
            types={types}
            value={v.type}
            onChange={(type) => upd(i, { type })}
            title="ledger variable type"
          />
          <input
            className="inp"
            placeholder="size…"
            title="array size hint (optional)"
            value={v.size}
            onChange={(e) => upd(i, { size: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button className="icon-btn" onClick={() => upd(i, { size: '' })}>
            ↺ clear
          </button>
          <button className="icon-btn" onClick={() => removeVar(i)}>
            ×
          </button>
        </div>
      ))}
      {ledger.length === 0 && <div className="reg-empty">no ledger variables — add one to track state in this system</div>}
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
        {a.kind === 'system' && (
          <>
            <ApiEditor asset={a} onChange={upd} types={types} />
            <LedgerVariables ledger={a.ledger} onUpdate={(next) => upd({ ...a, ledger: next })} types={types} />
          </>
        )}
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
  system: 'No systems yet — a system is a black box with a typed API: add one, then declare its functions.',
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
export function DataTab({ doc, types, onTypes, funcs = [], onFuncs, globals = [], onGlobals, onResetGlobals, gstore, onAssets, onRemove }) {
  const [sub, setSub] = useState('systems')
  const ops = useAssetOps(doc, onAssets, onRemove)
  // DATA is application data only — ⌁ web loopdoc items live in the doc for
  // the canvases' pick dropdowns but are not declared here, so they stay off
  const systems = ops.assets.filter((a) => a.kind === 'system' && !a.web)
  // how many FUNC parts anywhere in the doc pick each function
  const uses = {}
  const countUses = (g) => {
    for (const n of g.nodes || []) if (n.kind === 'func' && n.func) uses[n.func] = (uses[n.func] || 0) + 1
  }
  walkGraphs(doc.design, countUses)
  for (const f of doc.funcs || []) walkGraphs(f.graph || { nodes: [] }, countUses)
  return (
    <div className="reg-tab">
      <SubTabs
        items={[
          ['systems', `⚙️ SYSTEMS · ${systems.length}`],
          ['globals', `⚙ GLOBAL VARIABLES · ${globals.length}`],
          ['types', `≡ TYPES · ${(types || []).filter((t) => !t.web).length}`],
          ['funcs', `ƒ FUNCTIONS · ${(funcs || []).length}`],
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
        {sub === 'funcs' && (
          <div className="reg-list">
            <FuncsSection funcs={funcs || []} onFuncs={onFuncs} uses={uses} />
          </div>
        )}
      </div>
    </div>
  )
}
