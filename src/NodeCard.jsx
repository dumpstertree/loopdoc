// The node card shared by both canvases. Everything about how a node *looks*
// and what it can be edited to lives here; the canvases own placement, ports
// measurement and drag/selection. Ports carry `data-port="node:port:in|out"`
// so the canvas can measure them for edge routing; out-ports are drag
// handles, ⇣ in-ports are drop targets.
import React from 'react'
import { T } from './styles.gen.js' // every styling value, generated from styles.json
import { kindMeta, dataPorts, assetIcon, ASSET_KINDS, resolveCall, uid, enterVarsOf, exitVarsOf, fieldsOf, emptyValue, typedValue } from './model.js'
import { dataValue, fmt } from './engine.js'
import { TypeSelect } from './AssetsPanel.jsx'

// one width for every kind — the card is one shape, so both canvases agree
export const NODE_W = T.nodeW
const EMPTY_CALL = {} // stable empty while a call hasn't fired yet this sim
// a port's centre sits on the header line: top offset plus half its size
export const PORT_Y = T.nodePortTop + T.nodePortHalf

const portKey = (nodeId, portId, dir) => `${nodeId}:${portId}:${dir}`

// the foot of a card: the + grow buttons it offers, in the order its shape lists
// them. a component, so it renders after the body has registered its buttons.
function Dock({ actions, dock }) {
  const ids = (actions || []).filter((id) => dock[id])
  if (!ids.length) return null
  return (
    <div className="nd-actions">
      {ids.map((id) => (
        <button key={id} onClick={() => dock[id].fn()}>
          {dock[id].label}
        </button>
      ))}
    </div>
  )
}

// system-call picker rows shared by EVENT (flow) and SYS CALL (machine):
// pick ⚙️ asset, then one fn of its api; shows typed ⇣/⇡ rows as data ports
function CallsEditor({ node, assets, types, multiple, simCall, onPatch, onSimOut, onDataOut, onGrow }) {
  const calls = node.calls || []
  const systems = assets.filter((a) => a.kind === 'system')
  const patch = (next) => onPatch({ calls: next })

  return (
    <>
      {calls.map((call, i) => {
        const sys = systems.find((a) => a.id === call.asset)
        const fns = (sys && sys.api) || []
        const fn = fns.find((f) => f.id === call.fn)
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div className="nd-row">
              <select
                className="inp"
                style={{ flex: 1 }}
                value={call.asset || ''}
                onChange={(e) => {
                  e.stopPropagation()
                  const next = calls.map((c, j) => (j === i ? { asset: e.target.value || null, fn: null } : c))
                  patch(next)
                }}
              >
                <option value="">{systems.length ? '⚙️ system…' : 'no ⚙️ assets'}</option>
                {systems.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || '(unnamed)'}
                  </option>
                ))}
              </select>
              <select
                className="inp"
                style={{ flex: 1 }}
                value={call.fn || ''}
                disabled={!fns.length}
                title={fns.length ? 'the fn this node calls' : 'define the API in the assets panel (ƒ)'}
                onChange={(e) => {
                  e.stopPropagation()
                  const next = calls.map((c, j) => (j === i ? { ...c, fn: e.target.value || null } : c))
                  patch(next)
                }}
              >
                <option value="">{fns.length ? 'fn…' : 'no api'}</option>
                {fns.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name || '(unnamed)'}
                  </option>
                ))}
              </select>
              {multiple && (
                <button
                  className="icon-btn"
                  title="remove call"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => patch(calls.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              )}
            </div>
            {fn && (
              <>
                {(fn.inputs || []).map((v) => (
                  <div className="dvar" key={v.id} title={`data needed (${v.type || '?'}) — wire a matching ⇡ in`}>
                    <span className="port-data in" data-port={portKey(node.id, v.id, 'in')} />
                    <span>
                      ⇣ {v.name || '?'}:<b>{v.type || '?'}</b>
                    </span>
                  </div>
                ))}
                {(fn.outputs || []).map((v) => (
                  <div className="dvar out" key={v.id} title={`data returned (${v.type || '?'})`}>
                    <span>
                      ⇡ {v.name || '?'}:<b>{v.type || '?'}</b>
                    </span>
                    {simCall !== undefined ? (
                      // simulating — this black box's answer, editable so the machine can be stepped
                      (types || []).some((t) => t.name.toLowerCase() === String(v.type || '').toLowerCase()) ? (
                        <StructInputs v={v} simCall={simCall} types={types} onSimOut={onSimOut} />
                      ) : String(v.type || '').includes('[') &&
                        (types || []).some(
                          (t) =>
                            t.name.toLowerCase() === String(v.type).replace(/\[\s*\]$/, '').trim().toLowerCase(),
                        ) ? (
                        <StructArrayInputs v={v} simCall={simCall} types={types} onSimOut={onSimOut} />
                      ) : String(v.type || '').includes('[') ? (
                        <input
                          className="inp"
                          style={{ width: 82 }}
                          placeholder="a, b, c…"
                          title="answer published while simulating — list values, comma separated"
                          value={Array.isArray(simCall[v.id]) ? simCall[v.id].join(', ') : ''}
                          onPointerDown={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            onSimOut(
                              v.id,
                              e.target.value
                                .split(/[,\s]+/)
                                .filter(Boolean)
                                .map((s) => (isNaN(s) ? s : Number(s))),
                            )
                          }
                        />
                      ) : (
                        <input
                          className="inp"
                          style={{ width: 44 }}
                          type="number"
                          title="answer published while simulating"
                          value={simCall[v.id] ?? 0}
                          onPointerDown={(e) => e.stopPropagation()}
                          onChange={(e) => onSimOut(v.id, Number(e.target.value) || 0)}
                        />
                      )
                    ) : null}
                    <span
                      className="port-data out"
                      data-port={portKey(node.id, v.id, 'out')}
                      title="drag to feed a ⇣ of the same type"
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        if (onDataOut) onDataOut(e, node.id, v.id)
                      }}
                    />
                  </div>
                ))}
              </>
            )}
            {fn && <div className="nd-sub">ƒ {sys?.name || '?'}.{fn.name || '?'}</div>}
          </div>
        )
      })}
      {/* the + button belongs to the card's dock when the card owns one */}
      {multiple && onGrow && onGrow('+ call system', () => patch([...calls, { asset: null, fn: null }]))}
      {multiple && !onGrow && (
        <button className="tb-btn" style={{ width: '100%' }} onClick={() => patch([...calls, { asset: null, fn: null }])}>
          + call system
        </button>
      )}
    </>
  )
}

function StructInputs({ v, simCall, types, onSimOut }) {
  const tdef = (types || []).find((t) => t.name === v.type)
  const val = (simCall || {})[v.id] || {}
  const setField = (fname, raw) =>
    onSimOut(v.id, { ...val, [fname]: raw !== '' && !isNaN(raw) ? Number(raw) : raw })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
      {(tdef.fields || []).map((f) => (
        <div className="nd-row" key={f.id}>
          <span className="nd-sub" style={{ width: 52, textAlign: 'right' }}>{f.name || '·'}</span>
          <input
            className="inp"
            style={{ flex: 1 }}
            title={`${f.typeId}`}
            value={val[f.name || 'field'] ?? ''}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setField(f.name || 'field', e.target.value)}
          />
        </div>
      ))}
    </div>
  )
}

function StructArrayInputs({ v, simCall, types, onSimOut }) {
  const base = String(v.type || '').replace(/\[\s*\]$/, '').trim()
  const tdef = (types || []).find((t) => t.name.toLowerCase() === base.toLowerCase())
  const list = Array.isArray((simCall || {})[v.id]) ? simCall[v.id] : []
  const set = (next) => onSimOut(v.id, next)
  const blank = () => Object.fromEntries((tdef.fields || []).map((f) => [f.name || 'field', 0]))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%' }}>
      {list.map((item, i) => (
        <div key={i} style={{ border: '1px solid var(--line)', padding: '2px 4px' }}>
          <div className="nd-row" style={{ justifyContent: 'space-between' }}>
            <span className="nd-sub">{tdef.name} {i + 1}</span>
            <button
              className="icon-btn"
              title="remove item"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => set(list.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
          {(tdef.fields || []).map((f) => (
            <div className="nd-row" key={f.id}>
              <span className="nd-sub" style={{ width: 52, textAlign: 'right' }}>{f.name || '·'}</span>
              <input
                className="inp"
                style={{ flex: 1 }}
                title={`${f.typeId}`}
                value={item[f.name || 'field'] ?? ''}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const raw = e.target.value
                  set(
                    list.map((x, j) =>
                      j === i ? { ...x, [f.name || 'field']: raw !== '' && !isNaN(raw) ? Number(raw) : raw } : x,
                    ),
                  )
                }}
              />
            </div>
          ))}
        </div>
      ))}
      <button
        className="tb-btn"
        style={{ width: '100%' }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => set([...list, blank()])}
      >
        + {tdef.name || 'item'}
      </button>
    </div>
  )
}

// one checklist line — a textarea that wraps long tasks onto further lines and
// grows its own height; Enter adds the next task, Shift+Enter breaks the line
function TaskLine({ value, done, onChange, onEnter }) {
  const ref = React.useRef(null)
  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = el.scrollHeight + 'px'
  }
  React.useLayoutEffect(fit, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      className={`inp todo-line${done ? ' todo-done' : ''}`}
      placeholder="task…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          onEnter(e.currentTarget)
        }
      }}
    />
  )
}

function GenerateAsset({ node, onPatch, onGrow }) {
  const gen = node.gen || null
  const set = (g) => onPatch({ gen: g })
  const fresh = () => set({ id: uid('gen'), kind: 'art', name: '' })
  if (!gen) {
    // the + button belongs to the card's dock, when the card owns one
    if (onGrow) {
      onGrow('+ generate asset', fresh)
      return null
    }
    return (
      <button className="tb-btn" style={{ width: '100%' }} onClick={fresh}>
        + generate asset
      </button>
    )
  }
  return (
    <div className="nd-row">
      <span title="this event generates an asset that exists only in this graph">✨</span>
      <select
        className="inp"
        value={gen.kind}
        onChange={(e) => set({ ...gen, kind: e.target.value })}
        style={{ width: 78 }}
      >
        {ASSET_KINDS.map((k) => (
          <option key={k.id} value={k.id}>
            {k.icon} {k.label}
          </option>
        ))}
      </select>
      <input
        className="inp"
        style={{ flex: 1 }}
        placeholder="asset name…"
        value={gen.name}
        onChange={(e) => set({ ...gen, name: e.target.value })}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <button className="icon-btn" onClick={() => set(null)} title="remove">
        ×
      </button>
    </div>
  )
}

function AssetPick({ node, assets, kindFilter, placeholder, onPatch }) {
  const options = assets.filter((a) => !kindFilter || a.kind === kindFilter)
  return (
    <select
      className="inp"
      value={node.asset || ''}
      title={placeholder}
      onChange={(e) => {
        e.stopPropagation()
        onPatch({ asset: e.target.value || null })
      }}
    >
      <option value="">{options.length ? placeholder : `no ${kindFilter || 'asset'}s — add in 📦 panel`}</option>
      {options.map((a) => (
        <option key={a.id} value={a.id}>
          {assetIcon(a.kind)} {a.name || '(unnamed)'}
          {a.__local ? ' ✨' : ''}
        </option>
      ))}
    </select>
  )
}

// ---- VAR typed fill-in --------------------------------------------------------
// One editor per value, recursing through the type: a struct opens into an
// indented block of EVERY field (child structs nest inside, arrays grow row
// by row), leaves are inputs — bool a true/false pick, asset a 📦 dropdown.
// A type that contains itself collapses to a ↻ button: nesting deeper is one
// deliberate click, so a recursive type can't runaway-grow the card.
function ValueEditor({ types, assets, typeId, value, onValue, path = [] }) {
  const t = String(typeId || '').trim()
  if (!t) return <span className="nd-sub">pick a type…</span>
  if (t.endsWith('[]'))
    return (
      <ArrayEditor
        types={types}
        assets={assets}
        base={t.replace(/\[\s*\]$/, '').trim()}
        items={Array.isArray(value) ? value : []}
        onItems={onValue}
        path={path}
      />
    )
  const fields = fieldsOf(types, t)
  if (fields)
    return (
      <StructEditor
        types={types}
        assets={assets}
        typeId={t}
        fields={fields}
        value={value}
        onValue={onValue}
        path={path}
      />
    )
  if (t === 'bool')
    return (
      <select
        className="inp"
        value={value === true || value === 'true' ? 'true' : 'false'}
        onChange={(e) => onValue(e.target.value)}
        title="true or false"
      >
        <option value="false">false</option>
        <option value="true">true</option>
      </select>
    )
  if (t === 'asset')
    return (
      <select
        className="inp"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onValue(e.target.value || null)}
        title="one of the doc's 📦 assets — the handle itself"
      >
        <option value="">{assets.length ? 'pick an asset…' : 'no assets — add in 📦 panel'}</option>
        {assets.map((a) => (
          <option key={a.id} value={a.id}>
            {assetIcon(a.kind)} {a.name || '(unnamed)'}
          </option>
        ))}
      </select>
    )
  // int · float · string · legacy undeclared — a plain text cell
  return (
    <input
      className="inp"
      style={{ width: '100%' }}
      placeholder={t + '…'}
      value={value == null || typeof value === 'object' ? '' : String(value)}
      onChange={(e) => onValue(e.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
    />
  )
}

function ArrayEditor({ types, assets, base, items, onItems, path }) {
  const isStruct = !!fieldsOf(types, base)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {items.map((x, i) => (
        <div key={i} className="nd-row" style={{ alignItems: 'flex-start', gap: 4 }}>
          <span className="nd-sub" style={{ width: 16, textAlign: 'right', paddingTop: 4 }}>
            {i + 1}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ValueEditor
              types={types}
              assets={assets}
              typeId={base}
              value={x}
              onValue={(v) => onItems(items.map((y, j) => (j === i ? v : y)))}
              path={path}
            />
          </div>
          <button
            className="icon-btn"
            title="remove item"
            onClick={() => onItems(items.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button className="tb-btn" title={`add a ${base} item`} onClick={() => onItems([...items, emptyValue(base, types)])}>
        {isStruct ? '+ ' + base : `+ ${base} item`}
      </button>
    </div>
  )
}

function StructEditor({ types, assets, typeId, fields, value, onValue, path }) {
  const [open, setOpen] = React.useState(false)
  const cyc = path.includes(typeId)
  if (cyc && !open)
    return (
      <button className="tb-btn" title={`${typeId} contains itself — nest one level deeper`} onClick={() => setOpen(true)}>
        ↻ {typeId} — nest deeper
      </button>
    )
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        borderLeft: '1px solid var(--line)',
        paddingLeft: 8,
      }}
    >
      {fields.map((f) => (
        <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="nd-sub">
            {f.name}:<b>{f.typeId}</b>
          </span>
          <ValueEditor
            types={types}
            assets={assets}
            typeId={f.typeId}
            value={obj[f.name]}
            onValue={(v) => onValue({ ...obj, [f.name]: v })}
            path={[...path, typeId]}
          />
        </div>
      ))}
    </div>
  )
}

export default function NodeCard({
  node,
  graph, // the owning graph (needed for data port lookups / sub counts)
  assets, // registry visible here (plus local generated assets, __local: true)
  types, // declared doc data types (struct value editing)
  globals = [], // document-wide global variables (GET/SET GLOBAL cards)
  funcs = [], // ƒ functions defined on the data tab (FUNC cards pick one)
  systems = [], // system assets with ledger variables
  gvals = null, // live session values of the globals (shared across machines)
  selected,
  isEntry,
  sim, // machine sim state for display, or null
  onPatch,
  onSelect,
  onToggleEntry,
  onOpenGraph,
  onPortDown,
  onDataPortDown,
  onHeaderDown,
  onCardClick,
  onResizeDown, // drag the corner of a text cell
  onSimCall, // set a live sys-call return value during sim
}) {
  const meta = kindMeta(node)
  // a func body is a machine canvas as far as looks go — same card width,
  // same ports stacked top-right, so style it as one
  const mode = graph.mode === 'func' ? 'machine' : graph.mode
  // one shape for every kind: the slots it wears come from the shape registry,
  // which also says which canvases it may sit on
  const shape = meta.shape || { in: false, outs: [], rows: [], actions: [] }
  const isMachineKind = (meta.canvas || []).includes(mode)
  const ports = (meta.ports && meta.ports(node)) || []
  const flowOuts = ports.filter((p) => p.dir === 'out')
  const hasIn = mode === 'flow' ? true : ports.some((p) => p.dir === 'in')
  const isText = node.kind === 'text'
  // TEXT and TODO carry their own width (corner grip); TODO grows its height
  // from the task lines and VAR from its typed fill-in, so those store w only
  const sized = isText || node.kind === 'todo' || node.kind === 'var'
  const W = sized ? node.w || NODE_W : NODE_W
  const H = isText ? node.h || undefined : undefined

  // the dock at the foot: the grow buttons this card registers, keyed by
  // slot id, so the order the shape lists them in is the order they stack in
  const dock = {}
  const showName = shape.title && (mode === 'flow' || isText || node.kind === 'todo')

  // ── the slots ────────────────────────────────────────────────────────────
  // one card shape for every kind: the shape registry in model.js says which
  // slots it wears, and each slot is one renderer here. the title bar is always
  // there, flow ports sit in the gutters on the header line (one ⇣ in, ⇡ out-
  // ports stacked at one rhythm), typed ⇣/⇡ rows carry their glyphs on the
  // card border, and every grow button docks in one list at the foot.
  const grow = (id, label, fn, when = true) => {
    if (when && (shape.actions || []).includes(id)) dock[id] = { label, fn }
  }

  // machine live values
  let tokHere = 0
  let tokWait = false
  if (sim) {
    const tk = ((sim.mem || {}).tokens || []).filter((t) => t.node === node.id)
    tokHere = tk.length
    tokWait = tk.some((x) => x.wait)
  }

  // the row family this card wears, and the buttons it docks at the foot
  const rows =
    {
      // STEP — a line of prose
      note: () =>
        node.kind === 'step'
          ? <input className="inp" placeholder="note (optional)" value={node.note || ''} onChange={(e) => onPatch({ note: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          : null,

      // IF — the test
      test: () =>
        node.kind === 'condition'
          ? <input className="inp" placeholder="if… (the test)" value={node.cond || ''} onChange={(e) => onPatch({ cond: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          : null,

      // CHOICE — one row per option, + option docks
      options: () =>
        node.kind === 'choice' && (
          <>
            {(node.exits || []).map((ex, i) => (
              <div className="nd-row" key={ex.id}>
                <span className="exit-label">?</span>
                <input
                  className="inp"
                  style={{ flex: 1 }}
                  placeholder="option label…"
                  value={ex.label}
                  onChange={(e) =>
                    onPatch({ exits: node.exits.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })
                  }
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <button
                  className="icon-btn"
                  onClick={() => onPatch({ exits: node.exits.filter((_, j) => j !== i) })}
                  title="remove option"
                >
                  ×
                </button>
              </div>
            ))}
            {grow('option', '+ option', () => onPatch({ exits: [...(node.exits || []), { id: uid('ex'), label: 'option' }] }))}
          </>
        ),

      // LOAD · UNLOAD · INPUT — pick an asset
      asset: () =>
        node.kind === 'load' ? <AssetPick node={node} assets={assets} placeholder="asset to load…" onPatch={onPatch} />
          : node.kind === 'unload' ? <AssetPick node={node} assets={assets} placeholder="asset to unload…" onPatch={onPatch} />
          : node.kind === 'input' ? <AssetPick node={node} assets={assets} kindFilter="input" placeholder="input to apply…" onPatch={onPatch} />
          : null,

      // VAR — a typed value, filled in field by field
      fields: () =>
        node.kind === 'var' ? (
          <>
            <div className="nd-row">
              <input
                className="inp"
                style={{ flex: 1, minWidth: 0 }}
                placeholder="var…"
                value={node.variable?.name || ''}
                onChange={(e) => onPatch({ variable: { ...(node.variable || {}), name: e.target.value } })}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <span className="nd-sub">=</span>
              <TypeSelect
                types={types}
                value={node.variable?.type || ''}
                title="make it any type — structs and their [] forms fill in every field below, nested types included"
                onChange={(type) =>
                  onPatch({ variable: { ...(node.variable || {}), type, value: emptyValue(type, types) } })
                }
              />
            </div>
            {node.variable?.type ? (
              <ValueEditor
                types={types}
                assets={assets}
                typeId={node.variable.type}
                value={node.variable.value}
                onValue={(value) => onPatch({ variable: { ...node.variable, value } })}
              />
            ) : (
              <input
                className="inp"
                style={{ width: '100%' }}
                placeholder="value…"
                value={node.variable?.value ?? ''}
                onChange={(e) => onPatch({ variable: { ...(node.variable || {}), value: e.target.value } })}
                onKeyDown={(e) => e.stopPropagation()}
              />
            )}
            {/* the value this VAR makes ⇡ — a data port like any other, no flow */}
            {node.variable?.type && (
              <div className="dvar out" title="what ⇣ wires read — drag to feed any ⇣ of the same type">
                <span>
                  ⇡ {node.variable.name || 'value'}:<b>{node.variable.type}</b>
                </span>
                {(() => {
                  const s = fmt(typedValue(node.variable.type, node.variable.value, types))
                  return s === '' || s === null || s === undefined ? null : <span className="dval">{s}</span>
                })()}
                <span
                  className="port-data out"
                  data-port={portKey(node.id, '__val__', 'out')}
                  title="drag to feed a ⇣ of the same type"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    onDataPortDown(e, node.id, '__val__')
                  }}
                />
              </div>
            )}
          </>
        ) : null,

      // GRAPH · MACHINE — how big the nest is, and the doors gathered up
      nested: () =>
        ['graph', 'machine'].includes(node.kind) && (
          <>
            <div className="nd-row">
              <span className="nd-sub">
                {node.graph.nodes.length} {node.kind === 'graph' ? 'nodes' : 'parts'} · {node.graph.links.length}{' '}
                {node.kind === 'graph' ? 'links' : 'flows'}
              </span>
            </div>
            {/* one ⇣ per ENTER variable of the nested machine — every door's
                vars gathered into one complete input list */}
            {node.kind === 'machine' &&
              enterVarsOf(node.graph).map((v) => (
                <div className="dvar" key={v.id} title={`feeds ⇡ ${v.name} on the ENTER “${v.enter}” inside — wire any ${v.type} in`}>
                  <span className="port-data in" data-port={portKey(node.id, v.id, 'in')} />
                  <span>
                    ⇣ {v.name}:<b>{v.type}</b>
                  </span>
                  <span className="nd-sub">↳ {v.enter}</span>
                </div>
              ))}
            {/* the mirror image: one ⇡ per EXIT variable of the nested machine,
                tagged with the door it leaves through — two exits may each
                announce a same-named variable and keep their own port */}
            {node.kind === 'machine' &&
              exitVarsOf(node.graph).map((v) => (
                <div className="dvar out" key={'x' + v.id} title={`leaves the “${v.exit}” EXIT inside — wire any ${v.type} out of this machine`}>
                  <span>
                    ⇡ {v.name}:<b>{v.type}</b>
                  </span>
                  <span className="nd-sub">↳ {v.exit}</span>
                  <span
                    className="port-data out"
                    data-port={portKey(node.id, v.id, 'out')}
                    title="drag to feed a ⇣ of the same type"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      onDataPortDown(e, node.id, v.id)
                    }}
                  />
                </div>
              ))}
            {grow('open', 'open →', () => onOpenGraph(node.id), onOpenGraph)}
          </>
        ),

      // IF — the comparison and its two ⇣
      cmp: () =>
        node.kind === 'ifb' &&
        (() => {
          const dp = dataPorts(node, assets)
          const wired = (pid) => (graph.links || []).some((l) => l.kind === 'data' && l.to === node.id && l.toPort === pid)
          const res = sim ? (sim.mem?.ifres || {})[node.id] : undefined
          return (
            <>
              {!sim && (
                <div className="nd-row" title="the comparison applied between ⇣ a and ⇣ b">
                  <span className="nd-sub">⇣ a</span>
                  <select
                    className="inp"
                    style={{ width: 56 }}
                    value={node.op || '=='}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) => onPatch({ op: e.target.value })}
                  >
                    {['<', '<=', '==', '!=', '>=', '>'].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <span className="nd-sub">⇣ b</span>
                </div>
              )}
              {dp.in.map((p) => {
                const key = p.id === '__a__' ? 'aVal' : 'bVal'
                return (
                  <div
                    className="dvar"
                    key={p.id}
                    title={
                      wired(p.id)
                        ? `reads ${p.type} from the wire`
                        : `no wire — this ${p.type === 'bool' ? 'true/false' : 'value'} is used instead`
                    }
                  >
                    <span className="port-data in" data-port={portKey(node.id, p.id, 'in')} />
                    <span>
                      ⇣ {p.name}:<b>{p.type}</b>
                    </span>
                    {!wired(p.id) && !sim && (
                      <input
                        className="inp"
                        style={{ flex: 1 }}
                        placeholder="custom value…"
                        value={node[key] ?? ''}
                        onPointerDown={(e) => e.stopPropagation()}
                        onChange={(e) => onPatch({ [key]: e.target.value })}
                      />
                    )}
                    {sim && !wired(p.id) && String(node[key] ?? '') !== '' && (
                      <span className="dval">{String(node[key])}</span>
                    )}
                  </div>
                )
              })}
              {dp.out.map((p) => (
                <div className="dvar out" key={p.id} title="the verdict — other parts can read it">
                  <span>
                    ⇡ {p.name}:<b>{p.type}</b>
                  </span>
                  {res !== undefined && res !== null && <span className="dval">{String(res)}</span>}
                  <span
                    className="port-data out"
                    data-port={portKey(node.id, p.id, 'out')}
                    title="drag to feed a ⇣ of the same type"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      onDataPortDown(e, node.id, p.id)
                    }}
                  />
                </div>
              ))}
            </>
          )
        })(),

      // FOR · FOREACH — the values the loop carries
      count: () =>
        ['for', 'foreach'].includes(node.kind) && dataRows(),

      // INSPECT — one ⇣ to look at
      args: () => node.kind === 'inspect' && dataRows(),

      // APPEND · JOIN · REMOVE · REMOVE AT · SORT · CLONE — arrays in, array out
      list: () =>
        ['append', 'join', 'remove', 'removeat', 'sort', 'clone'].includes(node.kind) &&
        (() => {
          const dp = dataPorts(node, assets)
          const fields = node.kind === 'sort' ? fieldsOf(types, node.itemType) : null
          return (
            <>
              {node.kind === 'sort' && (
                <div className="nd-row" title="order by one field of struct items, or by the values themselves">
                  <span className="nd-sub">by</span>
                  <select
                    className="inp"
                    style={{ flex: 1 }}
                    value={node.field || ''}
                    onChange={(e) => onPatch({ field: e.target.value })}
                  >
                    <option value="">value</option>
                    {(fields || []).map((f) => (
                      <option key={f.id} value={f.name}>
                        {f.name}:{f.typeId}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {dp.in.map((p) => (
                <div className="dvar" key={p.id} title={`needs ${p.type} wired in`}>
                  <span className="port-data in" data-port={portKey(node.id, p.id, 'in')} />
                  <span>
                    ⇣ {p.name}:<b>{p.type}</b>
                  </span>
                </div>
              ))}
              {dp.out.map((p) => {
                const d = sim ? dataValue(graph.nodes, graph.links, sim.mem || {}, node.id, p.id) : null
                return (
                  <div className="dvar out" key={p.id} title="the computed array — any consumer can read it">
                    <span>
                      ⇡ {p.name}:<b>{p.type}</b>
                    </span>
                    {d && d.val !== null && <span className="dval">{fmt(d.val)}</span>}
                    <span
                      className="port-data out"
                      data-port={portKey(node.id, p.id, 'out')}
                      title="drag to feed a ⇣ of the same type"
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        onDataPortDown(e, node.id, p.id)
                      }}
                    />
                  </div>
                )
              })}
            </>
          )
        })(),

      // GLOBALS — pick one, and its value reads/writes as a ⇣/⇡
      global: () =>
        ['getg', 'setg'].includes(node.kind) && (
          <>
            <div className="nd-row">
              <span className="nd-sub">global</span>
              <select
                className="inp"
                style={{ flex: 1 }}
                value={node.gRef || ''}
                onChange={(e) => {
                  const g = (globals || []).find((x) => x.id === e.target.value)
                  onPatch(g ? { gRef: g.id, gName: g.name, gType: g.type } : { gRef: null, gName: '', gType: '' })
                }}
              >
                <option value="">— pick a global —</option>
                {(globals || []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name || '(unnamed)'} : {g.type}
                  </option>
                ))}
              </select>
            </div>
            {node.kind === 'getg' && (
              <div className="dvar out" title="the global's value — readers wire here (default while editing, live during sim)">
                <span>
                  ⇡ {node.gName || 'value'}:<b>{node.gType || '?'}</b>
                </span>
                {node.gRef && (
                  <span className="dval" title={sim || gvals ? "the session value — shared across machines" : 'default — set by the run'}>
                    {String(
                      sim
                        ? (sim.mem.g || {})[node.gRef]
                        : gvals && gvals[node.gRef] !== undefined
                          ? gvals[node.gRef]
                          : (globals || []).find((g) => g.id === node.gRef)?.value ?? '',
                    )}
                  </span>
                )}
                {!sim && (
                  <span
                    className="port-data out"
                    data-port={portKey(node.id, '__val__', 'out')}
                    title="drag to feed a ⇣ of the same type"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      onDataPortDown(e, node.id, '__val__')
                    }}
                  />
                )}
              </div>
            )}
            {node.kind === 'setg' && (
              <div className="dvar" title="wire the value to write — the chain carries the write the moment it passes">
                <span className="port-data in" data-port={portKey(node.id, '__val__', 'in')} />
                <span>
                  ⇣ {node.gName || 'value'}:<b>{node.gType || '?'}</b>
                </span>
                {sim && node.gRef && <span className="dval">{String((sim.mem.g || {})[node.gRef])}</span>}
              </div>
            )}
          </>
        ),

      // LEDGERS — pick a system and one of its variables
      ledger: () =>
        ['getledger', 'setledger'].includes(node.kind) && (
          <>
            <div className="nd-row">
              <span className="nd-sub">system</span>
              <select
                className="inp"
                style={{ flex: 1 }}
                value={node.lRef || ''}
                onChange={(e) => {
                  e.stopPropagation()
                  const sys = (systems || []).find((x) => x.id === e.target.value)
                  onPatch(sys ? { lRef: sys.id, lName: '', lType: '' } : { lRef: null, lName: '', lType: '' })
                }}
              >
                <option value="">— pick a system —</option>
                {(systems || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || '(unnamed)'}
                  </option>
                ))}
              </select>
            </div>
            {node.lRef && (
              <div className="nd-row">
                <span className="nd-sub">variable</span>
                <select
                  className="inp"
                  style={{ flex: 1 }}
                  value={node.lVarId || ''}
                  onChange={(e) => {
                    e.stopPropagation()
                    const ledger = (systems.find((s) => s.id === node.lRef)?.ledger || [])
                    const v = ledger.find((x) => x.id === e.target.value)
                    onPatch(v ? { lVarId: v.id, lName: v.name, lType: v.type } : { lVarId: null, lName: '', lType: '' })
                  }}
                >
                  <option value="">— pick a ledger variable —</option>
                  {(systems.find((s) => s.id === node.lRef)?.ledger || []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name || '(unnamed)'} : {v.type}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div
              className="dvar"
              title={node.kind === 'getledger' ? "wire the value to read — the node publishes it" : "wire the value to write — the chain carries it"}
            >
              <span className="port-data in" data-port={portKey(node.id, '__val__', 'in')} />
              <span>
                ⇣ {node.lName || 'value'}:<b>{node.lType || '?'}</b>
              </span>
              {sim && node.lRef && (
                <span className="dval">
                  {(() => {
                    const sys = systems.find((s) => s.id === node.lRef)
                    if (!sys) return ''
                    const v = (sys.ledger || []).find((lv) => lv.id === node.lVarId)
                    if (!v) return ''
                    return String(v.value ?? '')
                  })()}
                </span>
              )}
            </div>
          </>
        ),

      // EVENT · SYS CALL — system calls, and what they need
      calls: () =>
        ['event', 'syscall'].includes(node.kind) && (
          <>
            {node.kind === 'event' && (
              <>
                <CallsEditor
                  node={node}
                  assets={assets}
                  multiple
                  onDataOut={onDataPortDown}
                  onPatch={onPatch}
                  onGrow={(label, fn) => grow('call', label, fn)}
                />
                <GenerateAsset node={node} onPatch={onPatch} onGrow={(label, fn) => grow('generate', label, fn)} />
              </>
            )}
            {node.kind === 'syscall' && (
              <CallsEditor
                node={node}
                assets={assets}
                types={types}
                multiple={false}
                onDataOut={onDataPortDown}
                onPatch={onPatch}
                simCall={sim ? ((sim.mem || {}).call || {})[node.id] || EMPTY_CALL : undefined}
                onSimOut={onSimCall}
              />
            )}
            {node.kind === 'syscall' && sim && (
              <div className={`mc-click${tokWait ? '' : ' info'}`}>
                {tokWait ? '⏳ click to return' : node.block ? 'blocks the chain — opens here' : 'calls fn as chain passes'}
              </div>
            )}
            {node.kind === 'syscall' && !sim && !resolveCall((node.calls || [])[0], assets) && (
              <div className="mc-click warn">pick a system + fn</div>
            )}
            {node.kind === 'syscall' && !sim && (
              <label className="nd-sub" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <input type="checkbox" checked={!!node.block} onChange={(e) => onPatch({ block: e.target.checked })} />
                ⏳ can block — chain waits until clicked to return
              </label>
            )}
          </>
        ),

      // FUNC — pick a ƒ defined on the data tab
      pick: () =>
        node.kind === 'func' &&
        (() => {
          // a body may call every function except the one you are inside —
          // the enclosing definition never appears among its own picks
          const here = (graph || {}).id
          const picks = (funcs || []).filter((f) => !f.graph || f.graph.id !== here)
          const picked = (funcs || []).find((x) => x.id === node.func)
          const dp = dataPorts(node, assets, funcs)
          return (
            <>
              <div className="nd-row">
                <span className="nd-sub">function</span>
                <select
                  className="inp"
                  style={{ flex: 1 }}
                  value={node.func || ''}
                  onChange={(e) => {
                    e.stopPropagation()
                    const f = (funcs || []).find((x) => x.id === e.target.value)
                    onPatch(f ? { func: f.id, fName: f.name } : { func: null, fName: '' })
                  }}
                >
                  <option value="">— pick a ƒ function —</option>
                  {picks.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name || '(unnamed)'}
                    </option>
                  ))}
                </select>
              </div>
              {picked && picked.graph && (
                <div className="nd-row">
                  <span className="nd-sub">
                    {(picked.graph.nodes || []).length} parts · {(picked.graph.links || []).length} flows
                  </span>
                </div>
              )}
              {/* one ⇣ per ENTER variable of the definition, one ⇡ per EXIT —
                  the body lives once on the doc so every call site mirrors it */}
              {dp.in.map((p) => (
                <div className="dvar" key={p.id} title={`feeds ⇡ ${p.name} at the ENTER inside — wire any ${p.type} in`}>
                  <span className="port-data in" data-port={portKey(node.id, p.id, 'in')} />
                  <span>
                    ⇣ {p.name}:<b>{p.type}</b>
                  </span>
                </div>
              ))}
              {dp.out.map((p) => (
                <div className="dvar out" key={p.id} title={`reads ⇣ ${p.name} at the EXIT inside — drag to feed a ⇣ of the same type`}>
                  <span>
                    ⇡ {p.name}:<b>{p.type}</b>
                  </span>
                  <span
                    className="port-data out"
                    data-port={portKey(node.id, p.id, 'out')}
                    title="drag to feed a ⇣ of the same type"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onDataPortDown(e, node.id, p.id)
                    }}
                  />
                </div>
              ))}
              {sim && node.func && (
                <div className="mc-click info">
                  ƒ {((funcs || []).find((x) => x.id === node.func)?.name || '(gone)').trim() || '(unnamed)'} runs as the
                  chain passes
                </div>
              )}
              {!sim && !node.func && <div className="mc-click warn">pick a ƒ function</div>}
              {!sim && node.func && !picked && <div className="mc-click warn">⚠ the function it picks was deleted</div>}
              {grow('enter', '▶ enter', () => onOpenGraph(node.id), onOpenGraph && picked && picked.graph)}
            </>
          )
        })(),

      // ACTION — the chain pauses here
      status: () =>
        node.kind === 'action' && sim && (
          <div className={`mc-click${tokWait ? '' : ' info'}`}>{tokWait ? '▶ click to fire' : 'chain passing…'}</div>
        ),

      // TEXT — an annotation you size with the corner grip
      text: () =>
        node.kind === 'text' ? (
          <textarea
            className="inp"
            value={node.text || ''}
            onChange={(e) => onPatch({ text: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            onDoubleClick={() => onCardClick && onCardClick(node.id)}
          />
        ) : null,

      // TODO — task lines you tick off
      tasks: () =>
        node.kind === 'todo' && (
          <>
            {(node.todos || []).map((t, i) => (
              <div className="nd-row todo-row" key={t.id}>
                <input
                  type="checkbox"
                  className="todo-check"
                  checked={!!t.done}
                  title={t.done ? 'done — click to reopen' : 'tick when this task is done'}
                  onChange={(e) =>
                    onPatch({ todos: node.todos.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })
                  }
                />
                <TaskLine
                  value={t.text}
                  done={!!t.done}
                  onChange={(text) =>
                    onPatch({ todos: node.todos.map((x, j) => (j === i ? { ...x, text } : x)) })
                  }
                  onEnter={(el) => {
                    onPatch({ todos: [...node.todos, { id: uid('td'), text: '', done: false }] })
                    // move the caret into the fresh line as soon as it renders
                    setTimeout(() => {
                      const lines = el.closest('.nd')?.querySelectorAll('.todo-line')
                      if (lines?.length) lines[lines.length - 1].focus()
                    }, 0)
                  }}
                />
                <button
                  className="icon-btn"
                  title="remove task"
                  onClick={() => onPatch({ todos: node.todos.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              </div>
            ))}
            {grow('task', '+ task', () => onPatch({ todos: [...(node.todos || []), { id: uid('td'), text: '', done: false }] }))}
          </>
        ),

      // ENTER — the doors of a nested machine: its variables and assets
      vars: () =>
        node.kind === 'enter' && (
          <>
            <div className="nd-sub" title="entries are explicit — chains start here, always">▶ always a chain start</div>
            {(node.vars || []).map((v, i) => (
              <div key={v.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div className="nd-row">
                  <input
                    className="inp"
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder="variable name…"
                    value={v.name}
                    title="this variable also appears as a ⇣ input on the MACHINE node above"
                    onChange={(e) => onPatch({ vars: node.vars.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                  <TypeSelect
                    types={types}
                    value={v.type}
                    title="the variable’s data type — every type with its [] array form"
                    onChange={(type) => onPatch({ vars: node.vars.map((x, j) => (j === i ? { ...x, type } : x)) })}
                  />
                  <button
                    className="icon-btn"
                    title="remove variable"
                    onClick={() => onPatch({ vars: node.vars.filter((_, j) => j !== i) })}
                  >
                    ×
                  </button>
                </div>
                <div className="dvar out" title="the value chains read — set it here; it persists across rounds">
                  <span>
                    ⇡ {v.name || '?'}:<b>{v.type}</b>
                  </span>
                  <input
                    className="inp"
                    style={String(v.type || '').endsWith('[]') ? { flex: 1, minWidth: 60 } : { width: 46 }}
                    placeholder={String(v.type || '').endsWith('[]') ? 'a, b, c…' : 'set…'}
                    title={
                      String(v.type || '').endsWith('[]')
                        ? 'list values, comma separated'
                        : "set the variable's value"
                    }
                    value={v.value ?? ''}
                    onChange={(e) => onPatch({ vars: node.vars.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                  <span
                    className="port-data out"
                    data-port={portKey(node.id, v.id, 'out')}
                    title="drag to feed a ⇣ of the same type"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      onDataPortDown(e, node.id, v.id)
                    }}
                  />
                </div>
              </div>
            ))}
            {grow('variable', '+ variable', () => onPatch({ vars: [...(node.vars || []), { id: uid('ev'), name: '', type: 'int', value: '' }] }))}
            {/* 📦 door assets — same deal as variables, but the value IS one
                of the doc's assets: pick it, ⇡ carries the handle inside,
                and the MACHINE node above grows a matching ⇣ asset input */}
            {(node.assets || []).map((a, i) => (
              <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div className="nd-row">
                  <select
                    className="inp"
                    style={{ flex: 1, minWidth: 0 }}
                    value={a.asset || ''}
                    title="the asset this door passes in — its name follows the pick"
                    onChange={(e) =>
                      onPatch({
                        assets: node.assets.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                asset: e.target.value || null,
                                name: (assets.find((z) => z.id === e.target.value) || {}).name || '',
                              }
                            : x,
                        ),
                      })
                    }
                  >
                    <option value="">{assets.length ? 'pick an asset…' : 'no assets — add in 📦 panel'}</option>
                    {assets.map((z) => (
                      <option key={z.id} value={z.id}>
                        {assetIcon(z.kind)} {z.name || '(unnamed)'}
                      </option>
                    ))}
                  </select>
                  <button
                    className="icon-btn"
                    title="remove asset"
                    onClick={() => onPatch({ assets: node.assets.filter((_, j) => j !== i) })}
                  >
                    ×
                  </button>
                </div>
                <div
                  className="dvar out"
                  title="the asset handle chains read inside — it also appears as a ⇣ input on the MACHINE node above"
                >
                  <span>
                    ⇡ {a.name || 'asset'}:<b>asset</b>
                  </span>
                  <span
                    className="port-data out"
                    data-port={portKey(node.id, a.id, 'out')}
                    title="drag to feed a ⇣ of the same type"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      onDataPortDown(e, node.id, a.id)
                    }}
                  />
                </div>
              </div>
            ))}
            {grow('asset', '+ asset', () => onPatch({ assets: [...(node.assets || []), { id: uid('ev'), asset: null, name: '' }] }))}
          </>
        ),

      // EXIT — the mirror door: producers inside wire in, values leave above
      door: () =>
        node.kind === 'exit' && (
          <>
            {!sim && (
              <input
                className="inp"
                style={{ width: '100%' }}
                placeholder="exit name — victory, defeat…"
                title="the MACHINE node in the parent graph grows an output port with this name"
                value={node.name || ''}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => onPatch({ name: e.target.value })}
              />
            )}
            {/* EXIT variables are the mirror image of ENTER ones: a producer
                inside the machine wires INTO ⇣ here, and the value leaves
                through a matching ⇡ port on the MACHINE node above */}
            {(node.vars || []).map((v, i) => {
              const live = sim ? dataValue(graph.nodes, graph.links, sim.mem || {}, node.id, v.id) : null
              return (
                <div key={v.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div className="nd-row">
                    <input
                      className="inp"
                      style={{ flex: 1, minWidth: 0 }}
                      placeholder="variable name…"
                      title="this variable also appears as a ⇡ output on the MACHINE node above"
                      value={v.name}
                      onChange={(e) =>
                        onPatch({ vars: node.vars.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })
                      }
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                    <TypeSelect
                      types={types}
                      value={v.type}
                      title="the variable’s data type — every type with its [] array form"
                      onChange={(type) =>
                        onPatch({ vars: node.vars.map((x, j) => (j === i ? { ...x, type } : x)) })
                      }
                    />
                    <button
                      className="icon-btn"
                      title="remove variable"
                      onClick={() => onPatch({ vars: node.vars.filter((_, j) => j !== i) })}
                    >
                      ×
                    </button>
                  </div>
                  <div
                    className="dvar"
                    title="wire a producer’s ⇡ into this ⇣ inside the machine — the value then leaves through the ⇡ port on the MACHINE node above"
                  >
                    <span className="port-data in" data-port={portKey(node.id, v.id, 'in')} />
                    <span>
                      ⇣ {v.name || '?'}:<b>{v.type}</b>
                    </span>
                    {sim && live && live.val !== null && <span className="dval">{fmt(live.val)}</span>}
                    {!sim && (
                      <input
                        className="inp"
                        style={String(v.type || '').endsWith('[]') ? { flex: 1, minWidth: 60 } : { width: 46 }}
                        placeholder={String(v.type || '').endsWith('[]') ? 'a, b, c…' : 'announce…'}
                        title={
                          String(v.type || '').endsWith('[]')
                            ? 'list values, comma separated — used only while nothing is wired into ⇣'
                            : "the value announced while nothing is wired into ⇣"
                        }
                        value={v.value ?? ''}
                        onChange={(e) =>
                          onPatch({ vars: node.vars.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })
                        }
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    )}
                  </div>
                </div>
              )
            })}
            {grow('variable', '+ variable', () => onPatch({ vars: [...(node.vars || []), { id: uid('xv'), name: '', type: 'int', value: '' }] }))}
            {sim && <div className="mc-click info">⏏ ends the machine here</div>}
          </>
        ),
    }[shape.rows] || (() => null)

  // the typed ⇣/⇡ rows FOR, FOREACH and INSPECT share
  const dataRows = (pid) => {
    const dp = dataPorts(node, assets)
    const cur = sim?.mem?.cur?.[node.id]
    const live = (p) =>
      !cur ? null : p.id === '__i__' ? cur.i : p.id === '__item__' ? String(cur.item ?? '') : p.id === '__idx__' ? cur.index : null
    return (
      <>
        {dp.in.map((p) => (
          <div className="dvar" key={p.id} title={`needs ${p.type} data wired in`}>
            <span className="port-data in" data-port={portKey(node.id, p.id, 'in')} />
            <span>
              ⇣ {p.name}:<b>{p.type}</b>
            </span>
          </div>
        ))}
        {dp.out.map((p) => (
          <div className="dvar out" key={p.id} title="current loop value — wires read this live">
            <span>
              ⇡ {p.name}:<b>{p.type}</b>
            </span>
            {sim && live(p) !== null && <span className="dval">{live(p)}</span>}
            <span
              className="port-data out"
              data-port={portKey(node.id, p.id, 'out')}
              title="drag to feed a ⇣ of the same type"
              onPointerDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onDataPortDown(e, node.id, p.id)
              }}
            />
          </div>
        ))}
      </>
    )
  }

  return (
    <div
      className={`nd ${meta.cls} ${
        shape.container ? 'nd-container' : ''
      } ${selected ? 'nd-selected' : ''} ${isEntry ? 'nd-entry' : ''} ${
        sim && tokWait ? 'nd-wait' : sim && tokHere ? 'nd-tok' : ''
      }`}
      data-node-id={node.id}
      style={{ left: node.x, top: node.y, width: W, height: H }}
      onMouseDown={(e) => onSelect(node.id, e.shiftKey)}
      onClick={() => onCardClick && onCardClick(node.id)}
      onDoubleClick={(e) => {
        // dbl-click a GRAPH/MACHINE/FUNC card walks into it — the open → /
        // ▶ enter buttons stay for one-clickers; typing or clicking a control never enters
        if (!shape.container || !onOpenGraph) return
        if (e.target.closest('input, textarea, select, button, [contenteditable]')) return
        onOpenGraph(node.id)
      }}
    >
      {/* the flow gutter on the left of the title bar: one chain enters here */}
      {hasIn && <span className="port port-in" data-port={portKey(node.id, 'in', 'in')} title="flow in" />}

      {/* the title bar — always there, on every kind */}
      <div className="nd-head" onPointerDown={(e) => onHeaderDown(e, node.id)}>
        <span className="nd-kind">{meta.label}</span>
        {/* the header chip is the shape marker: ▸ walks into a nest, · is a leaf */}
        <span className="nd-chip">{shape.container ? T.ndGlyphContainer : T.ndGlyphLeaf}</span>
        {showName && (
          <input
            className="nd-name"
            placeholder={meta.label.toLowerCase() + ' name…'}
            value={node.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
        )}
        {sim && tokHere > 0 && (
          <span
            className={`mc-amount ${tokWait ? 'wait' : 'full'}`}
            title={tokWait ? 'chain waiting here — click to continue' : `chain token${tokHere > 1 ? 's' : ''} here`}
          >
            {tokWait ? '⏳' : `●${tokHere > 1 ? tokHere : ''}`}
          </span>
        )}
        {node.kind === 'todo' && (node.todos || []).length > 0 && (
          <span
            className={`mc-amount ${node.todos.every((t) => t.done) ? 'full' : ''}`}
            title={`${node.todos.filter((t) => t.done).length} of ${node.todos.length} tasks done`}
          >
            ✓{node.todos.filter((t) => t.done).length}/{node.todos.length}
          </span>
        )}
        {isEntry && <span className="entry-flag">▶ START</span>}
        {mode === 'flow' && (
          <button
            className="icon-btn"
            title={isEntry ? 'unset entry' : 'entry point of this graph'}
            style={{ color: isEntry ? 'var(--lime)' : undefined }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onToggleEntry(node.id)
            }}
          >
            ▶
          </button>
        )}
      </div>

      <div className="nd-body" onPointerDown={(e) => e.stopPropagation()}>{rows()}</div>

      {/* the dock at the foot: every grow button of this card, in the order its
          shape lists them. it renders as a component so it is built after the
          body — the row editors register their + button as the body renders. */}
      <Dock actions={shape.actions || []} dock={dock} />

      {/* flow out-ports — one rhythm down the right gutter, both canvases */}
      {flowOuts.map((p, i) => (
        <span
          key={p.id}
          className={`port port-out${p.id === 'true' ? ' pt-true' : p.id === 'false' ? ' pt-false' : ''}`}
          style={{ top: T.nodePortTop + i * T.nodePortStep }}
          data-port={portKey(node.id, p.id, 'out')}
          title={
            p.label
              ? `${p.label} — drag to connect`
              : p.id === 'end'
                ? 'loop completion pulse — drag to connect'
                : 'drag to connect'
          }
          onPointerDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onPortDown(e, node.id, p.id)
          }}
        >
          {p.label && <span className="port-tag">{p.label}</span>}
        </span>
      ))}

      {/* the corner grip — only the kinds that size themselves wear it */}
      {shape.grip && !sim && onResizeDown && (
        <span
          className="nd-resize"
          title={
            shape.grip === 'size'
              ? 'drag to size the note — cover as many cells as it describes'
              : 'drag to widen the fill-in — long values and nested fields get room'
          }
          onPointerDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onResizeDown(e, node.id)
          }}
        />
      )}
    </div>
  )
}