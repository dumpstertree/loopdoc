// loopdoc.yaml — the small indentation dialect the web files speak:
//
//   Name: "myCustomPackage"
//   Types:
//       myCustomType:
//           - field: "myNum"
//             type: "int"
//   Ledger:
//       entry1:
//           - field: "ledger_val1"
//             type: "int"
//   Static:
//       name: "my_static_fn"
//       inputs:
//           - field: "input_a"
//             type: "int"
//       outputs:
//           - field: "output_a"
//             type: "string"
//
// One file = one ⚙ system package: Types → declared types, Ledger → the
// system's ledger variables, Static → its API functions — and the yaml's own
// `Name:` IS the package: the settings list holds only urls, so every web
// type carries a qualified `Name:Type`. A type reference splits at ':' —
// left names a package, right the type in it (`curio_core:vector3`) — and
// references never fetch anything: at fetch time they are checked against
// the set of packages this very fetch registers. A requirement passes when
// a registered package has that name AND declares that type; a package
// whose requirement misses simply does not register — and since its
// disappearance can break other packages' requirements too, resolution
// iterates until stable. Bare names resolve to the package's own namespace.
import { BASIC_TYPES } from './model.js'

// browser-fetchable url: GitHub blob/raw pages speak HTML and send no CORS
// headers — rewrite github.com/<user>/<repo>/(blob|raw)/<ref>/<path> to the
// raw host, which answers plain text with Access-Control-Allow-Origin: *
export function corsUrl(url) {
  const m = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)\/(?:blob|raw)\/([^/\s]+)\/(\S+)$/.exec(url)
  if (!m) return url
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`
}

// ---- line tokenizer ---------------------------------------------------------
// every meaningful line becomes {indent, dash, key, value}; comments (#)
// outside quotes drop, tabs count as 4 spaces, quoted values unwrap
export function tokenize(text) {
  const toks = []
  const warnings = []
  const lines = String(text || '').split(/\r?\n/)
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li]
    let s = ''
    let q = null
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]
      if (q) { s += c; if (c === q) q = null; continue }
      if (c === '"' || c === "'") { q = c; s += c; continue }
      if (c === '#') break
      s += c
    }
    s = s.replace(/\t/g, '    ').replace(/\s+$/, '')
    const trimmed = s.trim()
    if (!trimmed) continue
    const indent = s.length - trimmed.length
    let body = trimmed
    let dash = false
    if (body === '-' || body.startsWith('- ')) { dash = true; body = body.slice(1).trim() }
    if (!body) { toks.push({ indent, dash, key: '', value: '', line: li + 1 }); continue }
    const m = /^([^:]+?):\s*(.*)$/.exec(body)
    if (!m) { warnings.push(`line ${li + 1}: expected "key: value" — skipped`); continue }
    const key = m[1].trim()
    let value = m[2].trim()
    if (value.length > 1 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0])
      value = value.slice(1, -1)
    toks.push({ indent, dash, key, value, line: li + 1 })
  }
  return { toks, warnings }
}

// indent tree: nodes at one level own the deeper lines under them
export function parseBlock(toks, i, ind) {
  const out = []
  while (i < toks.length && toks[i].indent >= ind) {
    const t = toks[i]
    i++
    let children = []
    if (i < toks.length && toks[i].indent > t.indent) {
      const sub = parseBlock(toks, i, t.indent + 1)
      children = sub[0]
      i = sub[1]
    }
    out.push({ key: t.key, value: t.value, dash: t.dash, children })
  }
  return [out, i]
}

// a dashed item collects its inline key plus any deeper keys into one map:
// `- field: "x"` with `type: "y"` under it → {field:'x', type:'y'}
const pairOf = (item) => {
  const pair = {}
  if (item.key) pair[item.key] = item.value
  for (const c of item.children) pair[c.key] = c.value
  return pair
}
const pairList = (nodes) =>
  nodes.map((n) => n.dash ? pairOf(n) : (n.children.length ? pairOf(n) : { [n.key]: n.value }))

// parse one whole loopdoc.yaml text into {name, types, ledger, statics}
export function parseLoopDoc(text) {
  const { toks, warnings } = tokenize(text)
  const [top] = parseBlock(toks, 0, 0)
  const by = {}
  for (const n of top) (by[n.key] = by[n.key] || []).push(n)
  // `Requires:` is a legacy container kept by real-world files — requirements
  // actually ride inline on field types, so the section is accepted silently
  for (const k of Object.keys(by))
    if (!['Name', 'Types', 'Ledger', 'Static', 'Statics', 'Requires'].includes(k))
      warnings.push(`unknown section "${k}" — ignored`)
  const group = (keys) => keys.flatMap((k) => (by[k] || []).flatMap((n) => n.children))
  const fields = (node) => pairList(node.children).map((p) => ({ field: p.field ?? '', type: p.type ?? '' }))
  const records = (keys) =>
    group(keys).map((n) => ({ name: n.key, fields: fields(n) }))

  // Static: either one map (name/inputs/outputs) or a list of them
  const oneStatic = (node) => {
    const find = (k) => node.children.find((c) => c.key === k)
    return {
      name: node.key === 'name' && node.value ? node.value : find('name')?.value ?? '',
      inputs: fields(find('inputs') || { children: [] }),
      outputs: fields(find('outputs') || { children: [] }),
    }
  }
  const statics = []
  const pushStatic = (s) => {
    if (s.name || s.inputs.length || s.outputs.length) statics.push(s)
  }
  for (const k of ['Static', 'Statics'])
    for (const n of by[k] || [])
      if (n.children.some((c) => c.dash))
        for (const item of n.children.filter((c) => c.dash)) pushStatic(oneStatic(item))
      else pushStatic(oneStatic(n))

  const types = records(['Types'])
  const ledger = records(['Ledger'])
  const nameNode = (by['Name'] || [])[0]
  if (!nameNode && (types.length || ledger.length || statics.length))
    warnings.push('no Name: section — a package with content must name itself')
  return {
    ok: warnings.length === 0,
    warnings,
    name: nameNode ? nameNode.value : '',
    types,
    ledger,
    statics,
  }
}

// ---- namespace resolution ---------------------------------------------------
// a type string from a web file → the qualified doc name
//   int → int · Foe → pkg:Foe · core:Vector3 → core:Vector3 · Foe[] → pkg:Foe[]
// the pkg is the yaml's own Name: — references never fetch, they only state
// what must be registered for the package to land
export function resolveType(t, pkgName) {
  const s = String(t || '').trim()
  if (!s) return ''
  const arr = s.endsWith('[]') ? '[]' : ''
  const base = arr ? s.slice(0, -2).trim() : s
  if (!base) return s
  if (base.includes(':')) return base + arr
  if (BASIC_TYPES.includes(base)) return base + arr
  return `${pkgName}:${base}${arr}`
}

// a parsed package + its settings id → the doc items it contributes:
// qualified types (web-tagged) and one ⚙ system asset (web-tagged) whose
// Statics become api fns and whose Ledger entries flatten into ledger vars.
// Ids are POSITIONAL — slot-based, never name-based — so renaming a type,
// fn or ledger variable in the yaml keeps its id: SYS CALL parts (which
// store the fn id) and 📊 ledger picks (which store the variable id) stay
// attached and simply show the new name, and runWeb pairs old and new
// type names by position to cascade renames into VAR / GET GLOBAL nodes
export function buildPackage(pkgName, pkg) {
  const types = pkg.types.map((t, i) => ({
    id: `web~${pkgName}~t${i}`,
    name: `${pkgName}:${t.name}`,
    web: pkgName,
    fields: t.fields.map((f, j) => ({
      id: `web~${pkgName}~t${i}~f${j}`,
      name: f.field,
      typeId: resolveType(f.type, pkgName),
    })),
  }))
  const api = pkg.statics.map((s, k) => ({
    id: `web~${pkgName}~fn${k}`,
    name: s.name,
    inputs: s.inputs.map((v, j) => ({ id: `web~${pkgName}~fn${k}~in${j}`, name: v.field, type: resolveType(v.type, pkgName) })),
    outputs: s.outputs.map((v, j) => ({ id: `web~${pkgName}~fn${k}~out${j}`, name: v.field, type: resolveType(v.type, pkgName) })),
  }))
  let li = 0
  const ledger = pkg.ledger.flatMap((e) =>
    e.fields.map((f) => ({
      id: `web~${pkgName}~led${li++}`,
      name: f.field,
      type: resolveType(f.type, pkgName),
      size: '',
    })),
  )
  return {
    types,
    asset: {
      id: `web~${pkgName}`,
      kind: 'system',
      name: pkg.name || pkgName,
      note: `⌁ web loopdoc package — named "${pkgName}" by its yaml, fetched from the settings list`,
      web: pkgName,
      api,
      ledger,
    },
  }
}

// ---- fetch-time registration ------------------------------------------------
// requirements never fetch: an inline reference `pkg:Type` just claims that
// some registered package named pkg declares type Type. refsOf gathers every
// such claim of one package (bare names qualify to its own namespace, so a
// dangling local reference fails the package too — basic types carry no claim)
export function refsOf(pkg) {
  const refs = new Set()
  const eat = (t) => {
    const q = resolveType(t, pkg.name)
    if (!q.includes(':')) return
    const at = q.indexOf(':')
    const sys = q.slice(0, at)
    const tn = q.slice(at + 1).replace(/\[\]$/, '')
    if (sys && tn) refs.add([sys, tn])
  }
  for (const t of pkg.types) for (const f of t.fields) eat(f.type)
  for (const s of pkg.statics) {
    for (const v of s.inputs) eat(v.type)
    for (const v of s.outputs) eat(v.type)
  }
  for (const e of pkg.ledger) for (const f of e.fields) eat(f.type)
  return [...refs]
}

// one fetch's whole result → what actually registers. entries are [{key, pkg}]
// (key = settings row index) and pkgs may be null (the fetch failed — the row
// keeps its ✕/⌁ fetch status and registers nothing). Rules: a package with
// content needs a Name:; two fetched files claiming one Name collide and both
// refuse; a requirement that no registered package satisfies fails its row —
// and a failing package's disappearance can cascade, so resolution iterates
// until stable. Returns [{key, ok, msg, name?, built?}]
export function registerPackages(entries) {
  const rows = []
  const alive = []
  for (const e of entries) {
    if (!e.pkg) continue // fetch failed — runWeb reports the transport outcome
    const content = e.pkg.types.length + e.pkg.ledger.length + e.pkg.statics.length
    if (!content) { rows.push({ key: e.key, ok: true, msg: '' }); continue } // no loopdoc sections — contributes nothing
    if (!e.pkg.name) { rows.push({ key: e.key, ok: false, msg: 'no Name: section — a package with content must name itself' }); continue }
    alive.push({ key: e.key, name: e.pkg.name, refs: refsOf(e.pkg), pkg: e.pkg })
  }
  const byName = {}
  for (const a of alive) (byName[a.name] = byName[a.name] || []).push(a)
  for (const a of alive)
    if (byName[a.name].length > 1) a.dead = `two fetched files claim the name "${a.name}" — both refuse to register`
  const names = new Set(alive.filter((a) => !a.dead).map((a) => a.name))
  const declared = Object.fromEntries(alive.filter((a) => !a.dead).map((a) => [a.name, new Set(a.pkg.types.map((t) => t.name))]))
  let grew = true
  while (grew) {
    grew = false
    for (const a of alive) {
      if (a.dead) continue
      const miss = a.refs.find(([sys, tn]) => !names.has(sys) || !declared[sys].has(tn))
      if (miss) {
        a.dead = `requirement ${miss[0]}:${miss[1]} is not registered — no fetched package "${miss[0]}" declares type "${miss[1]}"`
        names.delete(a.name)
        grew = true
      }
    }
  }
  for (const a of alive) {
    if (a.dead) { rows.push({ key: a.key, ok: false, msg: a.dead }); continue }
    rows.push({ key: a.key, ok: true, msg: '', name: a.name, built: buildPackage(a.name, a.pkg) })
  }
  return rows
}
