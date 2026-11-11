// The node card shared by both canvases. Everything about how a node *looks*
// and what it can be edited to lives here; the canvases own placement, ports
// measurement and drag/selection. Ports carry `data-port="node:port:in|out"`
// so the canvas can measure them for edge routing; out-ports are drag
// handles, ⇣ in-ports are drop targets.
import React from 'react'
import { T } from './styles.gen.js' // every styling value, generated from styles.json
import { kindMeta, dataPorts, assetIcon, ASSET_KINDS, resolveCall, uid, enterVarsOf, exitVarsOf, exitNameTaken, resolveExitRef, exitInstVars, fieldsOf, emptyValue, typedValue, MATH, BOOL } from './model.js'
import { takesFlow } from './wireRules.js'
import { dataValue, fmt, mathVal, boolVal, randVal } from './engine.js'
import { TypeSelect } from './AssetsPanel.jsx'
import { validateCode, inferCodeIO } from './codeLang.js'

// one width for every kind — the card is one shape, so both canvases agree
export const NODE_W = T.nodeW
const EMPTY_CALL = {} // stable empty while a call hasn't fired yet this sim
// a port's centre sits on the header line: top offset plus half its size
export const PORT_Y = T.nodePortTop + T.nodePortHalf

const portKey = (nodeId, portId, dir) => `${nodeId}:${portId}:${dir}`

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function highlightCode(code, names) {
  const src = String(code || '')
  const words = [...new Set((names || []).map((n) => String(n || '').trim()).filter(Boolean))].sort((a, b) => b.length - a.length)
  if (!words.length) return escHtml(src)
  // \b needs a word char on the name edge; fall back to plain escaped match
  const parts = words.map((w) => (/^\w/.test(w) ? `\\b${escRe(w)}\\b` : escRe(w)))
  const re = new RegExp(`(${parts.join('|')})`, 'g')
  let out = ''
  let last = 0
  let m
  while ((m = re.exec(src))) {
    out += escHtml(src.slice(last, m.index))
    out += `<span class="code-ref">${escHtml(m[0])}</span>`
    last = m.index + m[0].length
  }
  out += escHtml(src.slice(last))
  return out + (src.endsWith('\n') ? '\n' : '') // keep trailing newline height in pre
}

// script editor: Tab inserts spaces (no focus jump) + highlights referenced ⇣/⇡ names
function CodeBox({ value, onChange, names, placeholder, title }) {
  const ref = React.useRef(null)
  const back = React.useRef(null)
  const onKeyDown = (e) => {
    e.stopPropagation()
    if (e.key !== 'Tab') return
    e.preventDefault()
    const el = e.currentTarget
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    const ins = '  ' // 2 spaces — friendlier for compact cards
    const next = String(value || '').slice(0, start) + ins + String(value || '').slice(end)
    onChange(next)
    // restore caret after React commits the value
    requestAnimationFrame(() => {
      if (ref.current) { ref.current.selectionStart = ref.current.selectionEnd = start + ins.length }
    })
  }
  const onScroll = (e) => {
    if (back.current) {
      back.current.scrollTop = e.currentTarget.scrollTop
      back.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }
  const font = { fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.35, whiteSpace: 'pre-wrap', wordWrap: 'break-word', overflowWrap: 'break-word' }
  return (
    <div className="inp code-box" style={{ position: 'relative', padding: 0, overflow: 'hidden' }} title={title}>
      <pre
        aria-hidden
        ref={back}
        className="code-hilite"
        style={{ position: 'absolute', inset: 0, margin: 0, padding: '2px 6px', border: '1px solid transparent', overflow: 'hidden', pointerEvents: 'none', color: 'var(--text)', ...font }}
        dangerouslySetInnerHTML={{ __html: highlightCode(value, names) }}
      />
      <textarea
        ref={ref}
        className="code-input"
        style={{ position: 'relative', zIndex: 1, display: 'block', width: '100%', minHeight: 72, margin: 0, padding: '2px 6px', border: 'none', outline: 'none', resize: 'vertical', background: 'transparent', color: 'transparent', caretColor: 'var(--text)', ...font }}
        placeholder={placeholder}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={onScroll}
        spellCheck={false}
      />
    </div>
  )
}

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

// system-call picker rows on SYS CALL: pick ⚙️ asset, then one fn of its api;
// shows typed ⇣/⇡ rows as data ports
function CallsEditor({ node, assets, types, multiple, simCall, sim, links, onPatch, onSimOut, onDataOut, onGrow }) {
  // an unwired ⇣ call input falls back to a custom value typed on the card,
  // kept per port in node.cVals — exactly like math parts' aVal/bVal
  const wired = (pid) => (links || []).some((l) => l.kind === 'data' && l.to === node.id && l.toPort === pid)
  // custom-value editor shared with the FUNC card — scalars take a text field,
  // declared structs grow one field row per member, struct[] lists grow rows
  const unwiredValue = (v) => {
    const cur = (node.cVals || {})[v.id]
    if (sim)
      return (
        cur !== undefined && cur !== '' &&
        <div className="nd-row">
          <span className="dval">{fmt(cur)}</span>
        </div>
      )
    return UnwiredValue({ v, cVals: node.cVals || {}, types, onPatch })
  }
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
                {(fn.inputs || []).map((v) => {
                  const hasWire = wired(v.id)
                  return (
                    <div key={v.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div
                        className="dvar"
                        key={v.id}
                        title={
                          hasWire
                            ? `data needed (${v.type || '?'}) — fed by the wire from a matching ⇡`
                            : `data needed (${v.type || '?'}) — wire a matching ⇡ in, or type the value below`
                        }
                      >
                        <span className="port-data in" data-port={portKey(node.id, v.id, 'in')} />
                        <span>
                          ⇣ {v.name || '?'}:<b>{v.type || '?'}</b>
                        </span>
                      </div>
                      {!hasWire && unwiredValue(v)}
                    </div>
                  )
                })}
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

// custom value for an unwired ⇣ port — same editors the sim answers use:
// a declared struct grows one field row per member, a struct list grows rows
// per item (with + add / × remove), plain lists take comma-separated fields,
// scalars take a single text field
function UnwiredValue({ v, cVals, types, onPatch }) {
  const t = String(v.type || '')
  const set = (val) => onPatch({ cVals: { ...(cVals || {}), [v.id]: val } })
  if ((types || []).some((x) => x.name.toLowerCase() === t.toLowerCase()))
    return <StructInputs v={v} simCall={cVals || {}} types={types} onSimOut={(_, val) => set(val)} />
  const base = t.replace(/\[\s*\]$/, '').trim()
  if (t.includes('[') && (types || []).some((x) => x.name.toLowerCase() === base.toLowerCase()))
    return <StructArrayInputs v={v} simCall={cVals || {}} types={types} onSimOut={(_, val) => set(val)} />
  const cur = (cVals || {})[v.id]
  if (t.includes('['))
    return (
      <input
        className="inp"
        style={{ flex: 1, minWidth: 0 }}
        placeholder="a, b, c…"
        title="custom value while nothing is wired into ⇣ — comma-separated list"
        value={Array.isArray(cur) ? cur.map((x) => String(x)).join(', ') : cur ?? ''}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) =>
          set(
            e.target.value.trim() === ''
              ? []
              : e.target.value.split(',').map((s) => {
                  const s2 = s.trim()
                  return s2 !== '' && !isNaN(s2) ? Number(s2) : s2
                }),
          )
        }
        onKeyDown={(e) => e.stopPropagation()}
      />
    )
  return (
    <input
      className="inp"
      style={{ flex: 1, minWidth: 0 }}
      placeholder={`${t || 'value'}…`}
      title="custom value while nothing is wired into ⇣"
      value={cur ?? ''}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => set(e.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
    />
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
  onNodeEnter, // hover starts — canvases use it to animate attached wires
  onNodeLeave, // hover ends
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
  // what flow slots the card wears — same rule the canvases enforce, so a
  // phantom ⇣ never decorates a part that refuses flow (VAR, GET …)
  const hasIn = mode === 'flow' ? takesFlow(node) : ports.some((p) => p.dir === 'in')
  const isText = node.kind === 'text'
  // TEXT and TODO carry their own width (corner grip); TODO/VAR/CODE grow their
  // height from content, so those store w only
  const sized = isText || node.kind === 'todo' || node.kind === 'var' || node.kind === 'code'
  const H = isText ? node.h || undefined : undefined

  // the dock at the foot: the grow buttons this card registers, keyed by
  // slot id, so the order the shape lists them in is the order they stack in
  const dock = {}
  // an EXIT / EXIT REF wears a red bar on its right edge — the mirror of ▶
  // chains begin (the lime bar on entry cards), marking where chains end
  const isExit = node.kind === 'exit' || node.kind === 'exitinst'

  // two card widths, both plain rectangles: the regular one fits nearly
  // everything; a card whose cells are cramped horizontally — a long name, a
  // fat type tag on a ⇣/⇡ row, a prose line, a wide option label — wears the
  // wide width instead. character estimate, not layout: content decides, never
  // the kind
  const approx = (s, fs) => String(s).length * fs * 0.62
  const labelW = (p) => approx(`${p.name || '?'}:${p.type || '?'}`, 10) + 30
  const dp = dataPorts(node, assets, funcs, graph)
  const innerW = NODE_W - 2 - 2 * T.nodeGutter
  const need = Math.max(
    approx(meta.label, 10) + 36,
    ...dp.in.map((p) => labelW(p)),
    ...dp.out.map((p) => labelW(p)),
    approx(node.note || '', 12) + 6,
    approx(node.cond || '', 12) + 6,
    ...(node.exits || []).map((ex) => approx(ex.label || '', 12) + 46),
    node.variable ? approx(node.variable.name || '', 12) + approx(node.variable.type || '', 10) + 70 : 0,
  )
  const wide = need > innerW
  const W = sized ? node.w || (wide ? T.nodeWWide : NODE_W) : wide ? T.nodeWWide : NODE_W

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
      // STEP — a line of prose plus typed ⇣ input / ⇡ output variables
      step: () =>
        node.kind === 'step' && (
          <>
            <input
              className="inp"
              placeholder="note (optional)"
              value={node.note || ''}
              onChange={(e) => onPatch({ note: e.target.value })}
              onKeyDown={(e) => e.stopPropagation()}
            />
            {(node.inVars || []).map((v, i) => (
              <div key={v.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div className="nd-row">
                  <input
                    className="inp"
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder="input name…"
                    value={v.name}
                    onChange={(e) => onPatch({ inVars: node.inVars.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                  <TypeSelect
                    types={types}
                    value={v.type}
                    title="the variable’s data type — every type with its [] array form"
                    onChange={(type) => onPatch({ inVars: node.inVars.map((x, j) => (j === i ? { ...x, type } : x)) })}
                  />
                  <button
                    className="icon-btn"
                    title="remove input"
                    onClick={() => onPatch({ inVars: node.inVars.filter((_, j) => j !== i) })}
                  >
                    ×
                  </button>
                </div>
                <div className="dvar" title="wire the value this step reads — any producer’s ⇡ of this type lands here">
                  <span className="port-data in" data-port={portKey(node.id, v.id, 'in')} />
                  <span>
                    ⇣ {v.name || '?'}:<b>{v.type}</b>
                  </span>
                </div>
              </div>
            ))}
            {(node.outVars || []).map((v, i) => (
              <div key={v.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div className="nd-row">
                  <input
                    className="inp"
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder="output name…"
                    value={v.name}
                    onChange={(e) => onPatch({ outVars: node.outVars.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                  <TypeSelect
                    types={types}
                    value={v.type}
                    title="the variable’s data type — every type with its [] array form"
                    onChange={(type) => onPatch({ outVars: node.outVars.map((x, j) => (j === i ? { ...x, type } : x)) })}
                  />
                  <button
                    className="icon-btn"
                    title="remove output"
                    onClick={() => onPatch({ outVars: node.outVars.filter((_, j) => j !== i) })}
                  >
                    ×
                  </button>
                </div>
                <div className="dvar out" title="the value this step publishes — drag to feed any ⇣ of this type">
                  <span>
                    ⇡ {v.name || '?'}:<b>{v.type}</b>
                  </span>
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
            {grow('invar', '+ ⇣ input', () => onPatch({ inVars: [...(node.inVars || []), { id: uid('iv'), name: '', type: 'int' }] }))}
            {grow('outvar', '+ ⇡ output', () => onPatch({ outVars: [...(node.outVars || []), { id: uid('ov'), name: '', type: 'int' }] }))}
          </>
        ),

      // CODE — a script with typed ⇣ inputs / ⇡ outputs; validated as Python
      code: () =>
        node.kind === 'code' &&
        (() => {
          const check = validateCode(node.code, node.lang || 'python', { inputs: node.inVars || [], outputs: node.outVars || [] })
          return (
            <>
              <div className="nd-row">
                <span className="nd-sub">{(node.lang || 'python').toUpperCase()}</span>
                {!check.empty && (
                  <span
                    className={check.ok ? 'mc-amount full' : 'mc-amount wait'}
                    title={
                      check.ok
                        ? 'syntax looks valid'
                        : check.errors.map((e) => `line ${e.line}: ${e.message}`).join('\n')
                    }
                  >
                    {check.ok ? '✓ valid' : `✗ ${check.errors.length} error${check.errors.length === 1 ? '' : 's'}`}
                  </span>
                )}
              </div>
              <CodeBox
                value={node.code || ''}
                onChange={(code) => onPatch({ code, ...inferCodeIO(code, node) })}
                names={[...(node.inVars || []), ...(node.outVars || [])].map((v) => v.name)}
                placeholder={"def run(a, b):\n    # ⇣ inputs = def params, ⇡ outputs = return values\n    return a"}
                title="script body (Python syntax is validated) · Tab indents · ⇣/⇡ names follow def/return"
              />
              <div className="nd-row"><span className="nd-sub">⇣ / ⇡ follow <code>def</code> params and <code>return</code></span></div>
              {!check.ok &&
                check.errors.slice(0, 2).map((e, i) => (
                  <div key={i} className="mc-click warn" title={e.message}>
                    line {e.line}: {e.message}
                  </div>
                ))}
              {check.ok &&
                (check.warnings || []).slice(0, 1).map((w, i) => (
                  <div key={i} className="mc-click info" title={w.message}>
                    line {w.line}: {w.message}
                  </div>
                ))}
              {(node.inVars || []).map((v, i) => (
                <div key={v.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div className="nd-row">
                    <span className="nd-sub" style={{ flex: 1, minWidth: 0 }} title="derived from def parameter name">⇣ {v.name || '?'}</span>
                    <TypeSelect
                      types={types}
                      value={v.type}
                      title="data type for this input (name follows def)"
                      onChange={(type) => onPatch({ inVars: node.inVars.map((x, j) => (j === i ? { ...x, type } : x)) })}
                    />
                  </div>
                  <div className="dvar" title="wire the value this code reads — any producer’s ⇡ of this type lands here">
                    <span className="port-data in" data-port={portKey(node.id, v.id, 'in')} />
                    <span>
                      ⇣ {v.name || '?'}:<b>{v.type}</b>
                    </span>
                  </div>
                </div>
              ))}
              {(node.outVars || []).map((v, i) => (
                <div key={v.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div className="nd-row">
                    <span className="nd-sub" style={{ flex: 1, minWidth: 0 }} title="derived from return value">⇡ {v.name || '?'}</span>
                    <TypeSelect
                      types={types}
                      value={v.type}
                      title="data type for this output (name follows return)"
                      onChange={(type) => onPatch({ outVars: node.outVars.map((x, j) => (j === i ? { ...x, type } : x)) })}
                    />
                  </div>
                  <div className="dvar out" title="the value this code publishes — drag to feed any ⇣ of this type">
                    <span>
                      ⇡ {v.name || '?'}:<b>{v.type}</b>
                    </span>
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
            </>
          )
        })(),



      // LOAD · UNLOAD · INPUT — pick an asset
      asset: () =>
        node.kind === 'load' ? <AssetPick node={node} assets={assets} placeholder="asset to load…" onPatch={onPatch} />
          : node.kind === 'unload' ? <AssetPick node={node} assets={assets} placeholder="asset to unload…" onPatch={onPatch} />
          : node.kind === 'input' ? <AssetPick node={node} assets={assets} kindFilter="input" placeholder="input to apply…" onPatch={onPatch} />
          : null,

      // VAR — a typed value, filled in field by field
      fields: () =>
        node.kind === 'var' ? (() => {
          const v = node.variable || {}
          const t = String(v.type || '').trim()
          const isArr = t.endsWith('[]')
          // one ⇣ per type that makes the value up: struct fields keep their
          // ledger port ids (snapshot picked with the type, else ledger shape);
          // everything else takes a single whole-value ⇣ — and while a port is
          // unwired its fill-in cell stays open on the card
          const fields = !isArr && (v.fields && v.fields.length) ? v.fields : (!isArr ? fieldsOf(types, t) : null)
          const hasFields = !!fields && fields.length > 0
          const wired = (pid) => (graph.links || []).some((l) => l.kind === 'data' && l.to === node.id && l.toPort === pid)
          const wiredIn = hasFields ? fields.some((f) => wired(f.id)) : wired('__in__')
          const obj = v.value && typeof v.value === 'object' && !Array.isArray(v.value) ? v.value : {}
          return (
            <>
              <div className="nd-row">
                <input
                  className="inp"
                  style={{ flex: 1, minWidth: 0 }}
                  placeholder="var…"
                  value={v.name || ''}
                  onChange={(e) => onPatch({ variable: { ...v, name: e.target.value } })}
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <span className="nd-sub">=</span>
                <TypeSelect
                  types={types}
                  value={v.type || ''}
                  title="make it any type — structs and their [] forms fill in every field below, nested types included"
                  onChange={(type) =>
                    onPatch({
                      variable: {
                        ...v,
                        type,
                        value: emptyValue(type, types),
                        fields: fieldsOf(types, type) && !type.endsWith('[]') ? fieldsOf(types, type) : undefined,
                      },
                    })
                  }
                />
              </div>
              {hasFields
                ? fields.map((f) => (
                    <div
                      className="dvar"
                      key={f.id}
                      title={`wire any ${f.typeId} into ⇣ ${f.name || 'field'} — the cell types it while unwired`}
                    >
                      <span className="port-data in" data-port={portKey(node.id, f.id, 'in')} />
                      <span>
                        ⇣ {f.name || 'field'}:<b>{f.typeId}</b>
                      </span>
                      {wired(f.id) ? (
                        <span className="nd-sub">wire lands here ⇣</span>
                      ) : (
                        <ValueEditor
                          types={types}
                          assets={assets}
                          typeId={f.typeId}
                          value={obj[f.name || 'field']}
                          onValue={(x) => onPatch({ variable: { ...v, value: { ...obj, [f.name || 'field']: x } } })}
                        />
                      )}
                    </div>
                  ))
                : t
                  ? (
                      <div className="dvar" title="feed the whole value through ⇣ — the cell types it while unwired">
                        <span className="port-data in" data-port={portKey(node.id, '__in__', 'in')} />
                        <span>
                          ⇣ {v.name || 'value'}:<b>{t}</b>
                        </span>
                        {wired('__in__') ? (
                          <span className="nd-sub">wire lands here ⇣</span>
                        ) : (
                          <ValueEditor
                            types={types}
                            assets={assets}
                            typeId={t}
                            value={v.value}
                            onValue={(value) => onPatch({ variable: { ...v, value } })}
                          />
                        )}
                      </div>
                    )
                  : (
                      <input
                        className="inp"
                        style={{ width: '100%' }}
                        placeholder="value…"
                        value={v.value ?? ''}
                        onChange={(e) => onPatch({ variable: { ...v, value: e.target.value } })}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    )}
              {/* the value this VAR makes ⇡ — a data port like any other, no flow */}
              {t && (
                <div className="dvar out" title="what ⇣ wires read — drag to feed any ⇣ of the same type">
                  <span>
                    ⇡ {v.name || 'value'}:<b>{t}</b>
                  </span>
                  {(() => {
                    // the shown value is the typed fill-in — once any ⇣ feeds
                    // this VAR, the real value comes from the wires, and only
                    // the engine walkthrough knows it
                    if (wiredIn) return null
                    const s = fmt(typedValue(t, v.value, types))
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
          )
        })() : null,

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
          const dp = dataPorts(node, assets, funcs, graph)
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

      // SWITCH — its ⇣ value and the ⇡ arms the value picks between;
      // each case row names an arm and types the value it matches
      sw: () =>
        node.kind === 'switch' &&
        (() => {
          const dp = dataPorts(node, assets, funcs, graph)
          const wired = (pid) => (graph.links || []).some((l) => l.kind === 'data' && l.to === node.id && l.toPort === pid)
          const cs = node.cases || []
          return (
            <>
              {!sim && (
                <div className="nd-row" title="⇣ val leaves through the arm whose match equals it — default when nothing does">
                  <span className="nd-sub">⇣ val ⟨case⟩ → ⇡ arm</span>
                </div>
              )}
              {dp.in.map((p) => (
                <div
                  className="dvar"
                  key={p.id}
                  title={wired(p.id) ? 'reads any value from the wire' : 'no wire — the value typed here is what gets matched'}
                >
                  <span className="port-data in" data-port={portKey(node.id, p.id, 'in')} />
                  <span>
                    ⇣ {p.name}:<b>{p.type}</b>
                  </span>
                  {!wired(p.id) && !sim && (
                    <input
                      className="inp"
                      style={{ flex: 1, minWidth: 0 }}
                      placeholder="value to match…"
                      value={(node.cVals || {})[p.id] ?? ''}
                      onPointerDown={(e) => e.stopPropagation()}
                      onChange={(e) => onPatch({ cVals: { ...(node.cVals || {}), [p.id]: e.target.value } })}
                    />
                  )}
                  {!wired(p.id) && sim && String((node.cVals || {})[p.id] ?? '') !== '' && (
                    <span className="dval">{String((node.cVals || {})[p.id])}</span>
                  )}
                </div>
              ))}
              {cs.map((c) => (
                <div className="nd-row" key={c.id} title="this ⇡ arm fires when ⇣ val equals the match — its name labels the port">
                  <input
                    className="inp"
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder="case name…"
                    value={c.label ?? ''}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) => onPatch({ cases: cs.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)) })}
                  />
                  <span className="nd-sub">= ⇣val</span>
                  <input
                    className="inp"
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder="match…"
                    value={c.val ?? ''}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) => onPatch({ cases: cs.map((x) => (x.id === c.id ? { ...x, val: e.target.value } : x)) })}
                  />
                  <button className="icon-btn" title="remove case" onClick={() => onPatch({ cases: cs.filter((x) => x.id !== c.id) })}>
                    ×
                  </button>
                </div>
              ))}
              <div className="nd-row" title="the arm that runs when ⇣ val matches no case">
                <span className="nd-sub">default ⇡</span>
              </div>
              {grow('case', '+ case', () => onPatch({ cases: [...cs, { id: uid('cs'), label: `case ${cs.length + 1}`, val: '' }] }))}
            </>
          )
        })(),

      // ADD · SUBTRACT · MULTIPLY · DIVIDE · MOD — two number operands, one
      // number out; unwired sides fall back to the custom value on the card
      math: () =>
        MATH[node.kind] !== undefined &&
        (() => {
          const dp = dataPorts(node, assets, funcs, graph)
          const wired = (pid) => (graph.links || []).some((l) => l.kind === 'data' && l.to === node.id && l.toPort === pid)
          const live = sim ? mathVal(graph.nodes, graph.links, sim.mem || {}, node) : null
          return (
            <>
              {!sim && (
                <div className="nd-row" title="the operation applied between ⇣ a and ⇣ b">
                  <span className="nd-sub">⇣ a</span>
                  <span className="nd-sub">{MATH[node.kind]}</span>
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
                        ? 'reads int or float from the wire'
                        : 'no wire — the custom value typed here is used instead'
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
                        placeholder="number…"
                        title="custom value while ⇣ is unwired — int or float"
                        value={node[key] ?? ''}
                        onPointerDown={(e) => e.stopPropagation()}
                        onChange={(e) => onPatch({ [key]: e.target.value })}
                      />
                    )}
                    {!wired(p.id) && sim && String(node[key] ?? '') !== '' && (
                      <span className="dval">{String(node[key])}</span>
                    )}
                  </div>
                )
              })}
              {dp.out.map((p) => (
                <div className="dvar out" key={p.id} title="the computed number — any consumer of this type can read it">
                  <span>
                    ⇡ {p.name}:<b>{p.type}</b>
                  </span>
                  {live !== null && <span className="dval">{live}</span>}
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

      // RAND — one draw between its ⇣ bounds; unwired bounds fall back to the
      // value typed on the card. Pure data: no flow ports around it
      rand: () =>
        node.kind === 'rand' &&
        (() => {
          const dp = dataPorts(node, assets, funcs, graph)
          const wired = (pid) => (graph.links || []).some((l) => l.kind === 'data' && l.to === node.id && l.toPort === pid)
          const live = sim ? randVal(graph.nodes, graph.links, sim.mem || {}, node) : null
          return (
            <>
              {!sim && (
                <div className="nd-row" title="the draw taken between ⇣ min and ⇣ max">
                  <span className="nd-sub">⇣ min</span>
                  <span className="nd-sub">rand..</span>
                  <span className="nd-sub">⇣ max</span>
                </div>
              )}
              {dp.in.map((p) => {
                const key = p.id === '__min__' ? 'minVal' : 'maxVal'
                return (
                  <div
                    className="dvar"
                    key={p.id}
                    title={
                      wired(p.id)
                        ? 'reads int or float from the wire'
                        : 'no wire — the bound typed here is used instead'
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
                        placeholder="number…"
                        title="custom bound while ⇣ is unwired — int or float"
                        value={node[key] ?? ''}
                        onPointerDown={(e) => e.stopPropagation()}
                        onChange={(e) => onPatch({ [key]: e.target.value })}
                      />
                    )}
                    {!wired(p.id) && sim && String(node[key] ?? '') !== '' && (
                      <span className="dval">{String(node[key])}</span>
                    )}
                  </div>
                )
              })}
              {dp.out.map((p) => (
                <div className="dvar out" key={p.id} title="the drawn number — any consumer of this type can read it">
                  <span>
                    ⇡ {p.name}:<b>{p.type}</b>
                  </span>
                  {live !== null && <span className="dval">{live}</span>}
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

      // AND · OR — combine bool inputs into one bool verdict
      bool: () =>
        BOOL[node.kind] !== undefined &&
        (() => {
          const dp = dataPorts(node, assets, funcs, graph)
          const wired = (pid) => (graph.links || []).some((l) => l.kind === 'data' && l.to === node.id && l.toPort === pid)
          const live = sim ? boolVal(graph.nodes, graph.links, sim.mem || {}, node) : null
          return (
            <>
              {grow('slot', '+ ⇣ bool', () => onPatch({ slots: Math.max(2, Number(node.slots || 2)) + 1 }))}
              {!sim && (
                <div className="nd-row" title="how the fed ⇣ slots make one ⇡ verdict">
                  <span className="nd-sub">
                    {node.kind === 'and' ? 'all ⇣ → ⇡' : 'any ⇣ → ⇡'}
                  </span>
                </div>
              )}
              {dp.in.map((p) => {
                const cur = (node.cVals || {})[p.id] ?? ''
                return (
                  <div
                    className="dvar"
                    key={p.id}
                    title={
                      wired(p.id)
                        ? 'reads bool from the wire'
                        : 'no wire — pick true or false here, or leave it blank and this slot is ignored'
                    }
                  >
                    <span className="port-data in" data-port={portKey(node.id, p.id, 'in')} />
                    <span>
                      ⇣ {p.name}:<b>{p.type}</b>
                    </span>
                    {!wired(p.id) && !sim && (
                      <select
                        className="inp"
                        style={{ flex: 1, minWidth: 0 }}
                        title="value used while unwired"
                        value={cur}
                        onChange={(e) => onPatch({ cVals: { ...(node.cVals || {}), [p.id]: e.target.value } })}
                      >
                        <option value="">pick…</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    )}
                    {!wired(p.id) && sim && String(cur) !== '' && <span className="dval">{String(cur)}</span>}
                    {wired(p.id) && <span className="nd-sub">wire lands here ⇣</span>}
                  </div>
                )
              })}
              {dp.out.map((p) => (
                <div className="dvar out" key={p.id} title="the verdict — any consumer of bool can read it">
                  <span>
                    ⇡ {p.name}:<b>{p.type}</b>
                  </span>
                  {live !== null && <span className="dval">{live}</span>}
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

      // FOR · FOREACH · WHILE — the values the loop carries
      count: () =>
        ['for', 'foreach', 'while'].includes(node.kind) && dataRows(),

      // INSPECT — one ⇣ to look at
      args: () => node.kind === 'inspect' && dataRows(),

      // APPEND · JOIN · REMOVE · REMOVE AT · GET AT · SORT · CLONE · LENGTH — data in,
      // computed value out
      list: () =>
        ['append', 'join', 'remove', 'removeat', 'getat', 'sort', 'clone', 'length'].includes(node.kind) &&
        (() => {
          const dp = dataPorts(node, assets, funcs, graph)
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
            {node.kind === 'getledger' && (
              <div className="dvar out" title="the ledger's value — readers wire here (live during sim, the registry value while editing)">
                <span>
                  ⇡ {node.lName || 'value'}:<b>{node.lType || '?'}</b>
                </span>
                {node.lRef && (
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
            {node.kind === 'setledger' && (
              <div className="dvar" title="wire the value to write — the chain carries the write the moment it passes">
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
            )}
          </>
        ),

      // SYS CALL — system calls, and what they need
      calls: () =>
        node.kind === 'syscall' && (
          <>
            {node.kind === 'syscall' && (
              <CallsEditor
                node={node}
                links={graph.links || []}
                assets={assets}
                types={types}
                multiple={false}
                sim={!!sim}
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
              {dp.in.map((p) => {
                const hasWire = (graph?.links || []).some((l) => l.kind === 'data' && l.to === node.id && l.toPort === p.id)
                const cv = (node.cVals || {})[p.id]
                return (
                  <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div
                      className="dvar"
                      title={
                        hasWire
                          ? `feeds ⇡ ${p.name} at the ENTER inside — fed by the wire from a matching ⇡`
                          : `feeds ⇡ ${p.name} at the ENTER inside — wire any ${p.type} in, or type the value below`
                      }
                    >
                      <span className="port-data in" data-port={portKey(node.id, p.id, 'in')} />
                      <span>
                        ⇣ {p.name}:<b>{p.type}</b>
                      </span>
                    </div>
                    {!hasWire &&
                      (sim
                        ? cv !== undefined &&
                          cv !== '' && (
                            <div className="nd-row">
                              <span className="dval">{fmt(cv)}</span>
                            </div>
                          )
                        : UnwiredValue({ v: { id: p.id, type: p.type, name: p.name }, cVals: node.cVals || {}, types, onPatch }))}
                  </div>
                )
              })}
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
                title="the MACHINE node in the parent graph grows an output port with this name — must be unique in this machine"
                value={node.name || ''}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const name = e.target.value
                  if (exitNameTaken(graph, name, node.id)) return
                  onPatch({ name })
                }}
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

      // EXIT REF — routes to an existing EXIT; ⇣ ports mirror the target live
      exitref: () =>
        node.kind === 'exitinst' &&
        (() => {
          const exits = (graph.nodes || []).filter((n) => n.kind === 'exit')
          const target = resolveExitRef(graph, node)
          const vars = target ? target.vars || [] : []
          return (
            <>
              {!sim && (
                <div className="nd-row">
                  <span className="nd-sub">exit</span>
                  <select
                    className="inp"
                    style={{ flex: 1 }}
                    value={node.exitRef || ''}
                    title="exits through this EXIT for the same reason — its name and ⇣ variables follow the target"
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) => onPatch({ exitRef: e.target.value || null })}
                  >
                    <option value="">— pick an EXIT —</option>
                    {exits.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name || '(unnamed exit)'}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {sim && target && <div className="nd-sub">↳ {target.name || 'exit'}</div>}
              {!sim && node.exitRef && !target && <div className="mc-click warn">⚠ target EXIT is missing</div>}
              {!sim && !node.exitRef && <div className="nd-sub">pick the EXIT this route ends at</div>}
              {target && vars.length === 0 && <div className="nd-sub">target has no variables</div>}
              {vars.map((v) => {
                const live = sim ? dataValue(graph.nodes, graph.links, sim.mem || {}, node.id, v.id) : null
                return (
                  <div
                    className="dvar"
                    key={v.id}
                    title={`mirrors ⇣ ${v.name || 'var'} on “${target.name || 'exit'}” — wire a producer in here; the value leaves through that EXIT`}
                  >
                    <span className="port-data in" data-port={portKey(node.id, v.id, 'in')} />
                    <span>
                      ⇣ {v.name || '?'}:<b>{v.type || 'int'}</b>
                    </span>
                    {sim && live && live.val !== null && <span className="dval">{fmt(live.val)}</span>}
                  </div>
                )
              })}
              {sim && <div className="mc-click info">⏏ exits via {target ? target.name || 'exit' : '—'}</div>}
            </>
          )
        })(),
    }[shape.rows] || (() => null)

  // the typed ⇣/⇡ rows FOR, FOREACH and INSPECT share
  const dataRows = (pid) => {
    const dp = dataPorts(node, assets, funcs, graph)
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
      className={`nd ${meta.cls} ${wide ? 'nd-wide' : ''} ${
        shape.container ? 'nd-container' : ''
      } ${selected ? 'nd-selected' : ''} ${isEntry ? 'nd-entry' : ''} ${
        isExit ? 'nd-exit' : ''
      } ${node.flip ? 'nd-flip' : ''} ${sim && tokWait ? 'nd-wait' : sim && tokHere ? 'nd-tok' : ''}`}
      data-node-id={node.id}
      style={{ left: node.x, top: node.y, width: W, height: H }}
      onMouseDown={(e) => onSelect(node.id, e.shiftKey)}
      onMouseEnter={() => onNodeEnter && onNodeEnter(node.id)}
      onMouseLeave={() => onNodeLeave && onNodeLeave(node.id)}
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
          className="port port-out"
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