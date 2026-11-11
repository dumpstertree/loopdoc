// App shell: tabs (design / business / mood / assets / data), the doc store
// with autosave + file open/save, breadcrumb navigation through nested graphs,
// the machine modal and the traverse overlay.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import GraphCanvas from './GraphCanvas.jsx'
import MachineCanvas from './MachineCanvas.jsx'
import { AssetsTab, DataTab } from './AssetsPanel.jsx'
import DRCPanel from './DRCPanel.jsx'
import Traverse from './Traverse.jsx'
import BusinessDashboard from './BusinessDashboard.jsx'
import { newDoc, parseDoc, serializeDoc, removeAssetRefs, renameTypeInDoc, makeGlobalsStore, resolveGraph, replaceGraph } from './model.js'
import { exportForLLM } from './llmExport.js'
import { runDRC, validateDoc, cleanDoc } from './drc.js'
import { parseLoopDoc, registerPackages, corsUrl } from './loopdoc.js'

const LS_KEY = 'loopdoc-composer:doc'
// the settings list of web loopdoc files (id + url per row) + their fetch cache
const WEB_LS = 'loopdoc-composer:webfiles'
const WEB_CACHE = 'loopdoc-composer:webcache'

export default function App() {
  const [doc, setDoc] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) return parseDoc(raw)
    } catch {}
    return newDoc()
  })
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [tab, setTab] = useState('design')
  const [path, setPath] = useState([]) // breadcrumb: node ids from design down
  const [showTraverse, setShowTraverse] = useState(false)
  const [showDRC, setShowDRC] = useState(false)
  const [drcScope, setDrcScope] = useState('doc') // 'doc' | 'graph'
  const [drcSel, setDrcSel] = useState(null) // part a DRC jump selects, handed to the canvas as focus
  const [drcValidate, setDrcValidate] = useState(false) // ⚿ also merge whole-doc structural validation — catches floating data
  const [drcClean, setDrcClean] = useState(null) // ✂ last clean-up summary, shown on the button
  const [menu, setMenu] = useState(false) // ☰ dial: opens the menu modal
  const [settings, setSettings] = useState(false) // ⚙ dial: opens the settings modal
  const [rail, setRail] = useState(true) // the vertical add-buttons rail on the left of canvases
  const [stylesSrc, setStylesSrc] = useState('') // styles.json text shown in the settings editor
  const [stylesNote, setStylesNote] = useState('') // last editor outcome, shown under the textarea
  const [webFiles, setWebFiles] = useState(() => {
    try { return JSON.parse(localStorage.getItem(WEB_LS) || '[]').map((e) => ({ url: String(e.url || '') })) } catch { return [] }
  }) // ⌁ loopdoc files: plain [{url}] — the yaml's own Name: is the package identity
  const [webStatus, setWebStatus] = useState([]) // per-row outcome: {row, url, ok, msg} — fetch status or the registration refusal
  const handleRef = useRef(null)
  const docRef = useRef(doc)
  docRef.current = doc
  // live session values for ⚙ globals — shared by every machine sim so scene
  // changes hand state straight through (depth, position, flags). Fresh page
  // load, new document or open file starts a fresh session from defaults.
  const gstore = useMemo(makeGlobalsStore, [])

  const commit = (next) => {
    setDoc(next)
    setDirty(true)
  }
  const updateGraph = (next) => commit(replaceGraph(docRef.current, path, next))

  // autosave to localStorage (debounced)
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, serializeDoc(doc))
      } catch {}
    }, 600)
    return () => clearTimeout(t)
  }, [doc, dirty])

  // ---- file io -------------------------------------------------------------
  const docFileName = () => `${(docRef.current.name || 'design').replace(/[^\w\- ]+/g, '')}.json`
  // fallback for browsers without the File System Access API (e.g. Firefox)
  const hasFS = () => typeof window.showSaveFilePicker === 'function'
  const doDownload = () => {
    const blob = new Blob([serializeDoc(docRef.current)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = docFileName()
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    setDirty(false)
    setSavedAt(new Date().toLocaleTimeString())
  }
  // ⤓ llm — one plain-text brief of everything (graphs, machines, types,
  // globals, assets) written to be read by a language model, not re-imported
  // the settings editor: POST the edited styles.json text to the dev server
  // (vite.config.js route), which writes the file and reruns the generator
  const applyStylesJson = (t) => {
    if (!t.trim()) {
      setStylesNote('✕ nothing typed yet')
      return
    }
    try {
      JSON.parse(t)
    } catch {
      setStylesNote('✕ invalid json — not saved')
      return
    }
    fetch('/styles.json', { method: 'POST', body: t })
      .then(async (r) => {
        const msg = await r.text()
        if (r.ok) {
          setStylesSrc(t)
          setStylesNote('✓ written to styles.json · styles.gen.css regenerated')
        } else setStylesNote('✕ ' + msg)
      })
      .catch(() => setStylesNote('✕ no route — this only works on the vite dev server'))
  }

  // ---- ⌁ loopdoc web packages ------------------------------------------------
  // the settings list holds plain url rows — the yaml's own `Name:` IS the
  // package (namespace, web tag and slot-id prefix all come from it), and
  // inline `pkg:Type` references resolve at fetch time against what this very
  // fetch registers: a package whose requirement misses (or whose Name
  // collides, or forgets Name:) simply refuses to land, so its ⚙ system and
  // types stay out of the doc and the row says why
  const saveWebFiles = (list) => {
    setWebFiles(list)
    try { localStorage.setItem(WEB_LS, JSON.stringify(list)) } catch {}
  }
  const runWeb = (list) => {
    let cache = {}
    try { cache = JSON.parse(localStorage.getItem(WEB_CACHE) || '{}') } catch {}
    // every fetch run is a genuine fresh read: raw hosts answer with long
    // Cache-Control heads, so a plain re-fetch would happily hand back the
    // previous revision of the file and ↻ fetch now would never see the user's
    // edit — bypass the browser cache AND bust the CDN's with a run-unique ?c=
    const bust = '?c=' + Date.now()
    const grab = (u) => fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : null))
    Promise.all(
      list.map(async (e, row) => {
        const url = (e.url || '').trim()
        if (!url) return { row, url, ok: false, msg: 'no url yet', text: null }
        const raw = corsUrl(url) // GitHub blob/raw pages are html w/o CORS — the raw host is text with it
        try {
          const text = (await grab(raw + bust)) ?? (await grab(raw)) // hosts that choke on the param get a plain shot
          if (text == null) throw new Error('http')
          cache[raw] = { at: Date.now(), text } // WEB_CACHE stays keyed on the bare url — ⌁ fallback reads it
          return { row, url, ok: true, msg: '', text }
        } catch (err) {
          const c = cache[raw]
          if (c) return { row, url, ok: '⌁ cached', msg: String(err.message || err), text: c.text }
          return { row, url, ok: false, msg: '✕ cors / unreachable', text: null }
        }
      }),
    ).then((rs) => {
      // registration happens against the whole fetch at once — requirements
      // never pull more urls, they only check the registered Name set
      const reg = new Map(registerPackages(rs.map((r) => ({ key: r.row, pkg: r.text == null ? null : parseLoopDoc(r.text) }))).map((x) => [x.key, x]))
      const built = { types: [], assets: [] }
      let d = docRef.current
      const status = rs.map((r) => {
        const g = reg.get(r.row)
        if (g && g.ok === false) return { row: r.row, url: r.url, ok: false, msg: g.msg } // the yaml itself refused — ✕ with its reason
        if (g?.built) {
          // a rename in the yaml keeps its slot: pair this package's old and
          // new qualified type names by position and cascade each change —
          // renameTypeInDoc rewrites the name through api fn var types,
          // globals, foreach itemTypes and VAR `variable.type` in every graph,
          // so a VAR typed curio:vector2 becomes curio:vec2 the moment its
          // definition renames upstream, instead of keeping a dead old name
          const oldNames = (docRef.current.types || []).filter((t) => t.web === g.name).map((t) => t.name)
          for (let i = 0; i < Math.min(oldNames.length, g.built.types.length); i++)
            if (oldNames[i] !== g.built.types[i].name) d = renameTypeInDoc(d, oldNames[i], g.built.types[i].name)
          built.types.push(...g.built.types)
          built.assets.push(g.built.asset)
        }
        return { row: r.row, url: r.url, ok: r.ok, msg: r.msg } // ✓ ok · ⌁ cached · ✕ cors
      })
      try { localStorage.setItem(WEB_CACHE, JSON.stringify(cache)) } catch {}
      setWebStatus(status)
      commit({
        ...d,
        types: [...(d.types || []).filter((t) => !t.web), ...built.types],
        assets: [...(d.assets || []).filter((a) => !a.web), ...built.assets],
      })
    })
  }
  // the list itself (and only the list) drives the fetch: boot with saved rows,
  // every add / remove / edit of a row re-runs all of them (debounced so typing
  // a url does not fire a fetch per keystroke)
  useEffect(() => {
    if (webFiles.length === 0) return
    const t = setTimeout(() => runWeb(webFiles), 400)
    return () => clearTimeout(t)
  }, [webFiles])

  const doExportLLM = () => {
    const text = exportForLLM(docRef.current)
    const name = `${(docRef.current.name || 'design').replace(/[^\w\- ]+/g, '')}.llm.md`
    const blob = new Blob([text], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }
  const doUpload = () =>
    new Promise((resolve, reject) => {
      const inp = document.createElement('input')
      inp.type = 'file'
      inp.accept = 'application/json,.json'
      inp.onchange = async () => {
        try {
          const f = inp.files?.[0]
          if (!f) return reject(new DOMException('', 'AbortError'))
          resolve({ name: f.name, text: await f.text() })
        } catch (e) {
          reject(e)
        }
      }
      inp.click()
    })
  const doSave = async () => {
    const text = serializeDoc(docRef.current)
    try {
      if (!hasFS()) return doDownload()
      if (handleRef.current) {
        const w = await handleRef.current.createWritable()
        await w.write(text)
        await w.close()
      } else {
        const h = await window.showSaveFilePicker({
          suggestedName: docFileName(),
          types: [{ description: 'loopdoc composer', accept: { 'application/json': ['.json'] } }],
        })
        handleRef.current = h
        const w = await h.createWritable()
        await w.write(text)
        await w.close()
      }
      setDirty(false)
      setSavedAt(new Date().toLocaleTimeString())
    } catch (e) {
      if (e?.name !== 'AbortError') alert(`save failed: ${e.message}`)
    }
  }
  const doOpen = async () => {
    try {
      let text
      if (!hasFS()) {
        const up = await doUpload()
        text = up.text
      } else {
        const [h] = await window.showOpenFilePicker({
          types: [{ description: 'loopdoc composer', accept: { 'application/json': ['.json'] } }],
        })
        const f = await h.getFile()
        text = await f.text()
      }
      const d = parseDoc(text)
      gstore.reset()
      setDoc(d)
      setPath([])
      setTab('design')
      setDirty(false)
      if (webFiles.length) runWeb(webFiles) // the doc's ⌁ packages rejoin its web list
    } catch (e) {
      if (e?.name === 'AbortError') return
      alert(e?.message === 'not a loopdoc composer file' ? 'open failed: not a loopdoc composer file' : `open failed: ${e.message}`)
    }
  }
  const newDocument = () => {
    if (!window.confirm('Start a new empty document? Unsaved changes are lost.')) return
    handleRef.current = null
    gstore.reset()
    setDoc(newDoc())
    setPath([])
    setDirty(false)
    if (webFiles.length) runWeb(webFiles) // the new doc still pulls its ⌁ packages
  }
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        doSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- derived view state ----------------------------------------------------
  const graph = resolveGraph(doc, path)
  const crumbs = useMemo(() => {
    const out = [{ name: doc.design.name || 'Main Loop', path: [] }]
    let g = doc.design
    for (let i = 0; i < path.length; i++) {
      const n = g.nodes.find((x) => x.id === path[i])
      let ng = null
      let nm = null
      if (n?.kind === 'func') {
        const f = (doc.funcs || []).find((x) => x.id === n.func)
        if (!f) break
        ng = f.graph
        nm = f.name || n.fName || n.name || 'function'
      } else if (n?.graph) ng = n.graph
      else break
      out.push({ name: nm || n.name || 'sub graph', path: path.slice(0, i + 1) })
      g = ng
    }
    return out
  }, [doc, path])

  // assets visible on the current canvas: the registry + ✨ generated by this graph
  const scopedAssets = useMemo(() => {
    const gen = []
    for (const n of graph.nodes)
      if (n.gen && (n.gen.name || '').trim()) gen.push({ id: n.gen.id, kind: n.gen.kind, name: n.gen.name, note: '', __local: true })
    return [...doc.assets, ...gen]
  }, [doc.assets, graph.nodes])

  // ⚿ validate bolts the whole-doc structural scan onto the panel's list
  const drcStruct = useMemo(() => (drcValidate ? validateDoc(doc) : []), [doc, drcValidate])
  const drc = useMemo(() => (showDRC ? [...runDRC(doc, drcScope === 'graph' ? path : null), ...drcStruct] : []), [doc, showDRC, drcScope, path, drcStruct])
  const drcErr = drc.filter((f) => f.sev === 'error').length
  const drcWarn = drc.filter((f) => f.sev === 'warn').length
  const drcStructErr = drcStruct.filter((f) => f.sev === 'error').length
  const drcStructWarn = drcStruct.filter((f) => f.sev === 'warn').length

  // registry mutations shared by the ASSETS and DATA tabs
  const updateAssets = (fnOrList) =>
    commit({ ...docRef.current, assets: typeof fnOrList === 'function' ? fnOrList(docRef.current.assets) : fnOrList })
  const updateTypes = (next) => {
    const prev = docRef.current.types || []
    let d = { ...docRef.current, types: next }
    for (const t of next) {
      const p = prev.find((x) => x.id === t.id)
      if (p && p.name && p.name !== t.name) d = renameTypeInDoc(d, p.name, t.name)
    }
    commit(d)
  }

  return (
    <div className="app">
      <header className="topbar">
        <button
          className={`rail-toggle ${rail ? 'rail-toggle-on' : ''}`}
          onClick={() => setRail(!rail)}
          title="node kinds rail — slides the add-buttons list in and out on the left"
        >
          {rail ? '⋮' : '⊘'}
        </button>
        <div className="topbar-block">
          <input
            className="doc-name"
            value={doc.name}
            onChange={(e) => commit({ ...doc, name: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            spellCheck={false}
          />
        </div>
        <nav className="tabs">
          {[
            ['design', 'DESIGN'],
            ['business', 'BUSINESS'],
            ['mood', 'MOOD'],
            ['assets', 'ASSETS'],
            ['data', 'DATA'],
          ].map(([id, label]) => (
            <button key={id} className={`tab ${tab === id ? 'tab-on' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <span className={`save-state ${dirty ? 'dirty' : 'saved'}`}>{dirty ? '● unsaved' : savedAt ? `✓ ${savedAt}` : '✓ saved'}</span>
        {/* the two dials top right: only one modal can be open at a time */}
        <button
          className={`round-btn ${menu ? 'round-on' : ''}`}
          onClick={() => {
            if (menu) setMenu(false)
            else {
              setMenu(true)
              setSettings(false)
            }
          }}
          title="menu — open · save · export llm · new · check · validate · clean · traverse"
        >
          ☰
        </button>
        <button
          className={`round-btn ${settings ? 'round-on' : ''}`}
          onClick={() => {
            if (settings) setSettings(false)
            else {
              setSettings(true)
              setMenu(false)
              fetch('/styles.json')
                .then(async (r) => {
                  const t = await r.text()
                  if (r.ok) {
                    setStylesSrc(t)
                    setStylesNote('')
                  } else setStylesNote('✕ styles.json could not load')
                })
                .catch(() => setStylesNote('✕ styles.json could not load'))
            }
          }}
          title="settings"
        >
          ⚙
        </button>
      </header>

      {/* a click on the panel itself, not on an item, closes the modal */}
      {menu && (
        <div className="modal modal-menu" onClick={(e) => { if (e.target === e.currentTarget) setMenu(false) }}>
          <div className="modal-title">menu</div>
          <button className="modal-item" onClick={() => { doOpen(); setMenu(false) }} title="open .json">
            open
          </button>
          <button className="modal-item" onClick={() => { doSave(); setMenu(false) }} title="Ctrl+S">
            💾 save
          </button>
          <button className="modal-item" onClick={() => { doExportLLM(); setMenu(false) }} title="export the whole document as one plain-text brief written for an LLM to build a game from (.llm.md)">
            ⤓ export llm
          </button>
          <button className="modal-item" onClick={() => { newDocument(); setMenu(false) }} title="start a fresh document">
            new
          </button>
          <button
            className="modal-item"
            onClick={() => {
              setShowDRC(!showDRC)
              if (showDRC) setDrcValidate(false) // closing the panel also drops ⚿
              setMenu(false)
            }}
            title="design rule check — scans the open graph or the whole doc"
          >
            ⚑ check
            {showDRC && drc.length > 0 && (
              <span className="drc-badge">
                {drcErr ? <b className="drc-err">✕{drcErr}</b> : null}
                {drcWarn ? <b className="drc-warn">⚠{drcWarn}</b> : null}
              </span>
            )}
            {showDRC && drc.length === 0 && <span className="drc-badge drc-clean-badge">✓</span>}
          </button>
          <button
            className="modal-item"
            onClick={() => {
              setShowDRC(true)
              setDrcScope('doc')
              setDrcValidate(true)
              setMenu(false)
            }}
            title="validate every node in the whole doc — integrity checks that catch floating data left by edits (duplicate part ids, mounted-twice graphs, dead group links, never-called ƒ bodies); results ride in the ⚑ panel, click one to select the suspect part"
          >
            ⚿ validate
            {drcValidate && (drcStruct.length > 0) && (
              <span className="drc-badge">
                {drcStructErr ? <b className="drc-err">✕{drcStructErr}</b> : null}
                {drcStructWarn ? <b className="drc-warn">⚠{drcStructWarn}</b> : null}
              </span>
            )}
            {drcValidate && drcStruct.length === 0 && <span className="drc-badge drc-clean-badge">✓</span>}
          </button>
          <button
            className="modal-item"
            onClick={() => {
              const cleaned = cleanDoc(doc)
              if (cleaned.total) commit(cleaned.doc)
              setDrcClean(cleaned) // { doc, cut, total } — the button reads total
              setMenu(false)
            }}
            title="✂ fix what ⚿ flags — drop duplicate part copies (the first copy wins) with their wires, unhook twice-mounted graphs, drop parts of an unknown kind, clear group links to a gone frame; ƒ bodies are never removed"
          >
            ✂ clean up
            {drcClean && (
              drcClean.total
                ? <span className="drc-badge"><b className="drc-err">✂{drcClean.total}</b></span>
                : <span className="drc-badge drc-clean-badge">✓ nothing to clean</span>
            )}
          </button>
          <button className="modal-item" onClick={() => { setShowTraverse(!showTraverse); setMenu(false) }} title="walk the doc part by part, one screen at a time">
            ▶ traverse
          </button>
          <button className="modal-close" onClick={() => setMenu(false)}>
            ✕ close
          </button>
        </div>
      )}
      {settings && (
        <div
          className="modal modal-settings"
          onClick={(e) => { if (e.target === e.currentTarget) setSettings(false) }}
        >
          <div className="modal-title">settings</div>

          <div className="settings-section">
            <div className="panel-head">
              <span className="panel-title">⚙ styles.json</span>
            </div>
            <textarea
              className="styles-edit"
              spellCheck={false}
              value={stylesSrc}
              onChange={(e) => {
                setStylesSrc(e.target.value)
                setStylesNote('✎ edited — press 💾 apply to write it to styles.json')
              }}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button className="modal-item" onClick={() => applyStylesJson(stylesSrc)} title="write this text to styles.json and regenerate the theme">
              💾 apply
            </button>
            <div className="modal-note">{stylesNote}</div>
          </div>

          <div className="settings-section">
            <div className="panel-head">
              <span className="panel-title">⌁ loopdoc files</span>
              <span className="spacer" />
              <button className="btn" onClick={() => saveWebFiles([...webFiles, { url: '' }])} title="add a loopdoc file row">
                + add
              </button>
            </div>
            <div className="modal-note">
              one url per row — the yaml&apos;s own Name: is the package · its Types · Ledger · Statics join the doc
            </div>
            <div className="settings-list">
              {webFiles.map((w, i) => {
                const s = webStatus.find((x) => x.row === i)
                // the row's last fetch, in the app's own ✓ · ⌁ · ✕ vocabulary
                const [status, tone] = !s
                  ? ['… not fetched yet', '']
                  : s.ok === true
                    ? ['✓ ok', 'web-ok']
                    : s.ok === '⌁ cached'
                      ? [`⌁ cached${s.msg ? ` · ${s.msg}` : ''}`, 'web-cache']
                      : [`✕ ${s.msg}`, 'web-bad']
                return (
                  <div key={`webrow${i}`} className="web-row">
                    <input
                      className="inp"
                      placeholder="https://…/loopdoc.yaml"
                      value={w.url}
                      onChange={(e) => {
                        const next = [...webFiles]
                        next[i] = { ...next[i], url: e.target.value }
                        saveWebFiles(next)
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                    <span className={`web-status ${tone}`} title="last fetch — ⌁ packages resolve their requirements against each other at fetch time">
                      {status}
                    </span>
                    <button
                      className="icon-btn"
                      title="remove this loopdoc file (its types · system drop out of the doc)"
                      onClick={() => saveWebFiles(webFiles.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </div>
                )
              })}
              {webFiles.length === 0 && (
                <div className="reg-empty">no files yet — paste a raw url of any loopdoc yaml</div>
              )}
            </div>
            <button className="modal-item" onClick={() => runWeb(webFiles)} title="re-fetch every loopdoc file right now — bypasses browser · CDN caches and rebuilds every ⌁ connection">
              ↻ fetch now
            </button>
          </div>

          <button className="modal-close" onClick={() => setSettings(false)}>
            ✕ close
          </button>
        </div>
      )}

      <div className="main">
        <div className="stage">
          {tab === 'design' ? (
            <>
              {['machine', 'func'].includes(graph.mode) ? (
                <MachineCanvas graph={graph} assets={doc.assets} types={doc.types || []} globals={doc.vars || []} funcs={doc.funcs || []} gstore={gstore} onChange={updateGraph} onOpenNode={(id) => setPath([...path, id])} focus={drcSel} rail={rail} />
              ) : (
                <GraphCanvas
                  graph={graph}
                  assets={scopedAssets}
                  types={doc.types || []}
                  globals={doc.vars || []}
                  funcs={doc.funcs || []}
                  onChange={updateGraph}
                  onOpenGraph={(id) => setPath([...path, id])}
                  focus={drcSel}
                  rail={rail}
                />
              )}
              {path.length > 0 && (
                <div className="crumb" style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 5 }}>
                  {crumbs.map((c, i) => (
                    <React.Fragment key={i}>
                      <span style={{ color: 'var(--dim)' }}>/</span>
                      <button
                        className={i === crumbs.length - 1 ? 'crumb-now' : ''}
                        onClick={() => setPath(c.path)}
                        title={i === crumbs.length - 1 ? 'you are here' : 'go back'}
                      >
                        {c.name}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </>
          ) : tab === 'assets' ? (
            <AssetsTab
              doc={doc}
              types={doc.types || []}
              onAssets={updateAssets}
              onRemove={(id) => commit(removeAssetRefs(docRef.current, id))}
            />
          ) : tab === 'data' ? (
            <DataTab
              doc={doc}
              types={doc.types || []}
              onTypes={updateTypes}
              globals={doc.vars || []}
              funcs={doc.funcs || []}
              onFuncs={(next) => commit({ ...docRef.current, funcs: next })}
              onGlobals={(next) => commit({ ...docRef.current, vars: next })}
              onResetGlobals={() => gstore.reset()}
              gstore={gstore}
              onAssets={updateAssets}
              onRemove={(id) => commit(removeAssetRefs(docRef.current, id))}
            />
          ) : (
            <div className="notes-tab">
              {tab === 'business' && (
                <BusinessDashboard
                  doc={doc}
                  setDoc={commit}
                />
              )}
              <textarea
                className="inp"
                placeholder={`${tab} notes — free-form markdown-ish text, saved with the document…`}
                value={doc.notes[tab]}
                onChange={(e) => commit({ ...doc, notes: { ...doc.notes, [tab]: e.target.value } })}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          )}
        </div>

        {tab === 'design' && showDRC && (
          <DRCPanel
            findings={drc}
            scope={drcScope}
            onScope={setDrcScope}
            onJump={(p, nid) => {
              setTab('design')
              setPath(p)
              setDrcSel(nid ?? null)
            }}
            onClose={() => setShowDRC(false)}
          />
        )}
      </div>

      {showTraverse && <Traverse doc={doc} onClose={() => setShowTraverse(false)} />}
    </div>
  )
}
