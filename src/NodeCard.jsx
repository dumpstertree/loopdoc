// The node card shared by both canvases. Everything about how a node *looks*
// and what it can be edited to lives here; the canvases own placement, ports
// measurement and drag/selection. Ports carry `data-port="node:port:in|out"`
// so the canvas can measure them for edge routing; out-ports are drag
// handles, ⇣ in-ports are drop targets.
import React from 'react'
import { kindMeta, dataPorts, assetIcon, ASSET_KINDS, resolveCall, uid } from './model.js'

export const NODE_W_FLOW = 216
export const NODE_W_MC = 184
export const PORT_Y = 16

const portKey = (nodeId, portId, dir) => `${nodeId}:${portId}:${dir}`

// one flow exit port with its label, rendered as a row
function ExitRow({ node, port, onPortDown }) {
  return (
    <div className="exit-row" style={{ position: 'relative' }}>
      <span className="exit-label">{port.label || '▸'}</span>
      <span
        className="port port-flow-out"
        data-port={portKey(node.id, port.id, 'out')}
        title="drag to connect"
        onPointerDown={(e) => {
          e.stopPropagation()
          e.preventDefault()
          onPortDown(e, node.id, port.id)
        }}
      />
    </div>
  )
}

// system-call picker rows shared by EVENT (flow) and SYS CALL (machine):
// pick ⚙️ asset, then one fn of its api; shows typed ⇣/⇡ rows as data ports
function CallsEditor({ node, assets, types, multiple, simValues, onPatch, onSimOut, onDataOut }) {
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
                    {simValues && <span className="dval">{simValues[`${i}:${v.id}`] ?? '∅'}</span>}
                  </div>
                ))}
                {(fn.outputs || []).map((v) => (
                  <div className="dvar out" key={v.id} title={`data returned (${v.type || '?'})`}>
                    <span>
                      ⇡ {v.name || '?'}:<b>{v.type || '?'}</b>
                    </span>
                    {onSimOut ? (
                      (types || []).some((t) => t.name === v.type) ? (
                        <StructInputs v={v} node={node} types={types} onSimOut={onSimOut} />
                      ) : String(v.type || '').includes('[') ? (
                        <input
                          className="inp"
                          style={{ width: 82 }}
                          placeholder="a, b, c…"
                          title="list values, comma separated — this is the array the sim publishes"
                          value={Array.isArray(node.out?.[v.id]) ? node.out[v.id].join(', ') : ''}
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
                          title="value returned while simulating"
                          value={node.out?.[v.id] ?? 0}
                          onPointerDown={(e) => e.stopPropagation()}
                          onChange={(e) => onSimOut(v.id, Number(e.target.value) || 0)}
                        />
                      )
                    ) : (
                      simValues && <span className="dval">{simValues[`out:${i}:${v.id}`] ?? '⋯'}</span>
                    )}
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
      {multiple && (
        <button className="tb-btn" style={{ width: '100%' }} onClick={() => patch([...calls, { asset: null, fn: null }])}>
          + call system
        </button>
      )}
    </>
  )
}

function StructInputs({ v, node, types, onSimOut }) {
  const tdef = (types || []).find((t) => t.name === v.type)
  const val = (node.out || {})[v.id] || {}
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

function GenerateAsset({ node, onPatch }) {
  const gen = node.gen || null
  const set = (g) => onPatch({ gen: g })
  if (!gen)
    return (
      <button className="tb-btn" style={{ width: '100%' }} onClick={() => set({ id: uid('gen'), kind: 'art', name: '' })}>
        + generate asset
      </button>
    )
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

export default function NodeCard({
  node,
  graph, // the owning graph (needed for data port lookups / sub counts)
  assets, // registry visible here (plus local generated assets, __local: true)
  types, // declared doc data types (struct value editing)
  selected,
  isEntry,
  sim, // machine sim state for display, or null
  onPatch,
  onDelete,
  onSelect,
  onToggleEntry,
  onOpenGraph,
  onPortDown,
  onDataPortDown,
  onHeaderDown,
  onCardClick,
}) {
  const meta = kindMeta(node)
  const mode = graph.mode
  const isMachineKind = meta.mode === 'machine'
  const ports = (meta.ports && meta.ports(node)) || []
  const flowOuts = ports.filter((p) => p.dir === 'out')
  const hasIn = meta.mode === 'flow' ? true : ports.some((p) => p.dir === 'in')
  const W = isMachineKind ? NODE_W_MC : NODE_W_FLOW

  // machine live values
  let amount
  let held
  if (sim) {
    if (node.kind === 'pool') amount = sim.amounts[node.id] ?? node.init ?? 0
    if (['delay', 'queue', 'register'].includes(node.kind)) {
      const m = sim.mem[node.id]
      held = node.kind === 'register' ? m?.count ?? 0 : m?.items.reduce((s, it) => s + it.amt, 0) ?? 0
    }
  }

  return (
    <div
      className={`nd ${meta.cls} ${selected ? 'nd-selected' : ''} ${isEntry ? 'nd-entry' : ''}`}
      data-node-id={node.id}
      style={{ left: node.x, top: node.y, width: W }}
      onMouseDown={(e) => onSelect(node.id, e.shiftKey)}
      onClick={() => onCardClick && onCardClick(node.id)}
    >
      {hasIn && <span className="port port-flow-in" data-port={portKey(node.id, 'in', 'in')} title="flow in" />}

      <div className="nd-head" onPointerDown={(e) => onHeaderDown(e, node.id)}>
        <span className="nd-kind">{meta.label}</span>
        {node.kind === 'pool' && (
          <span className={`mc-amount ${amount > 0 ? 'full' : ''}`}>{sim ? amount : node.init ?? 0}</span>
        )}
        {held !== undefined && (
          <span className={`mc-amount ${held > 0 ? 'full' : ''}`} title="held / counted">
            {held}
          </span>
        )}
        {isMachineKind && !sim && ['delay', 'queue', 'register'].includes(node.kind) && (
          <span className="mc-amount" title="setting (edit below)">
            {node.kind === 'delay' ? `⏳${node.delay ?? 3}` : node.kind === 'queue' ? `×${node.rate ?? 1}` : `÷${node.countTo ?? 2}`}
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
        {mode === 'flow' && (
          <button className="icon-btn" title="delete node" onPointerDown={(e) => e.stopPropagation()} onClick={() => onDelete(node.id)}>
            ×
          </button>
        )}
      </div>

      <div className="nd-body" onPointerDown={(e) => e.stopPropagation()}>
        {(mode === 'flow' || node.kind === 'text') && (
          <input
            className="nd-name"
            placeholder={meta.label.toLowerCase() + ' name…'}
            value={node.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
        )}

        {node.kind === 'event' && (
          <>
            <CallsEditor node={node} assets={assets} multiple onDataOut={onDataPortDown} onPatch={onPatch} />
            <GenerateAsset node={node} onPatch={onPatch} />
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
            onSimOut={(vid, val) => onPatch({ out: { ...(node.out || {}), [vid]: val } })}
          />
        )}
        {(node.kind === 'for' || node.kind === 'foreach' || node.kind === 'inspect') &&
          (() => {
            const dp = dataPorts(node, assets)
            const cur = sim?.mem?.cur?.[node.id]
            const live = (pid) =>
              !cur ? null : pid === '__i__' ? cur.i : pid === '__item__' ? String(cur.item ?? '') : pid === '__idx__' ? cur.index : null
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
                    {sim && live(p.id) !== null && <span className="dval">{live(p.id)}</span>}
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
          })()}
        {node.kind === 'condition' && (
          <input className="inp" placeholder="if… (the test)" value={node.cond || ''} onChange={(e) => onPatch({ cond: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        )}
        {node.kind === 'choice' && (
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
            <button className="tb-btn" style={{ width: '100%' }} onClick={() => onPatch({ exits: [...(node.exits || []), { id: uid('ex'), label: 'option' }] })}>
              + option
            </button>
          </>
        )}
        {node.kind === 'load' && <AssetPick node={node} assets={assets} placeholder="asset to load…" onPatch={onPatch} />}
        {node.kind === 'unload' && <AssetPick node={node} assets={assets} placeholder="asset to unload…" onPatch={onPatch} />}
        {node.kind === 'input' && <AssetPick node={node} assets={assets} kindFilter="input" placeholder="input to apply…" onPatch={onPatch} />}
        {node.kind === 'var' && (
          <div className="nd-row">
            <input
              className="inp"
              style={{ flex: 1 }}
              placeholder="var…"
              value={node.variable?.name || ''}
              onChange={(e) => onPatch({ variable: { ...(node.variable || {}), name: e.target.value } })}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <span className="nd-sub">=</span>
            <input
              className="inp"
              style={{ flex: 1 }}
              placeholder="value…"
              value={node.variable?.value || ''}
              onChange={(e) => onPatch({ variable: { ...(node.variable || {}), value: e.target.value } })}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
        )}
        {node.kind === 'graph' && (
          <div className="nd-row">
            <span className="nd-sub">
              {node.graph.nodes.length} nodes · {node.graph.links.length} links
            </span>
            <button className="tb-btn" onClick={() => onOpenGraph(node.id)}>
              open →
            </button>
          </div>
        )}
        {node.kind === 'machine' && (
          <div className="nd-row">
            <span className="nd-sub">
              {node.graph.nodes.length} parts · {node.graph.links.length} flows
            </span>
            <button className="tb-btn" onClick={() => onOpenGraph(node.id)}>
              open →
            </button>
          </div>
        )}
        {node.kind === 'step' && (
          <input className="inp" placeholder="note (optional)" value={node.note || ''} onChange={(e) => onPatch({ note: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        )}
        {isMachineKind && !sim && node.kind === 'pool' && (
          <div className="nd-row">
            <span className="nd-sub">initial</span>
            <input className="inp" style={{ width: 52 }} type="number" value={node.init ?? 0} onChange={(e) => onPatch({ init: Math.max(0, Number(e.target.value) || 0) })} />
          </div>
        )}
        {isMachineKind && !sim && node.kind === 'pool' && (
          <div className="dvar out" title="the pool's amount as int data">
            <span className="nd-sub">⇡</span>
            <span>
              <b>int</b>
            </span>
            <span
              className="port-data out"
              data-port={portKey(node.id, '__int__', 'out')}
              title="drag onto an ⇣ int input"
              onPointerDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onDataPortDown(e, node.id, '__int__')
              }}
            />
          </div>
        )}
        {isMachineKind && sim && node.kind === 'pool' && (
          <div className="dvar out">
            <span>
              ⇡ <b>int</b>
            </span>
            <span className="dval">{amount}</span>
            <span
              className="port-data out"
              data-port={portKey(node.id, '__int__', 'out')}
              onPointerDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onDataPortDown(e, node.id, '__int__')
              }}
            />
          </div>
        )}
        {isMachineKind && !sim && ['delay', 'queue', 'register'].includes(node.kind) && (
          <div className="nd-row">
            <span className="nd-sub">{node.kind === 'delay' ? 'steps' : node.kind === 'queue' ? 'rate' : 'count to'}</span>
            <input
              className="inp"
              style={{ width: 52 }}
              type="number"
              value={node.kind === 'delay' ? node.delay ?? 3 : node.kind === 'queue' ? node.rate ?? 1 : node.countTo ?? 2}
              onChange={(e) =>
                onPatch(
                  node.kind === 'delay'
                    ? { delay: Math.max(0, Number(e.target.value) || 0) }
                    : node.kind === 'queue'
                      ? { rate: Math.max(1, Number(e.target.value) || 1) }
                      : { countTo: Math.max(1, Number(e.target.value) || 1) },
                )
              }
            />
          </div>
        )}
        {(node.kind === 'source' || node.kind === 'drain') && !sim && (
          <label className="nd-sub" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <input type="checkbox" checked={node.auto !== false} onChange={(e) => onPatch({ auto: e.target.checked })} />
            fires every step
          </label>
        )}
        {sim && node.kind === 'action' && <div className="mc-click">click to fire</div>}
        {sim && node.kind === 'syscall' && <div className="mc-click info">auto-calls on flow</div>}
        {!sim && node.kind === 'syscall' && !resolveCall((node.calls || [])[0], assets) && (
          <div className="mc-click warn">pick a system + fn</div>
        )}

        {/* flow exit ports — rows on the flow canvas, pinned top-right on machine parts */}
        {mode === 'machine'
          ? flowOuts.map((p) => (
              <span
                key={p.id}
                className="port port-flow-out port-out-mc"
                data-port={portKey(node.id, p.id, 'out')}
                title="drag to connect"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  onPortDown(e, node.id, p.id)
                }}
              />
            ))
          : flowOuts.map((p) => <ExitRow key={p.id} node={node} port={p} onPortDown={onPortDown} />)}
      </div>
    </div>
  )
}
