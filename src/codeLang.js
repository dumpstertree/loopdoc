// Script validation for CODE nodes (Python by default).
// Uses `filbert` for real Python syntax parsing (strict), plus checks that
// declared ⇡ output variables are produced, indentation is sane, and a few
// JS-habit keywords that are valid Python identifiers (true/false/null/undefined)
// are called out. Pure analysis, no runtime.
import * as filbertNS from 'filbert'
const filbert = filbertNS.default || filbertNS

function stripStringsComments(line) {
  // replace string literals and # comments with spaces, preserving length/indexes
  let s = line
  s = s.replace(/("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, (m) => ' '.repeat(m.length))
  const ci = s.indexOf('#')
  if (ci >= 0) s = s.slice(0, ci) + ' '.repeat(s.length - ci)
  return s
}

function scanBracketsAndStrings(src) {
  const errors = []
  const stack = []
  const open = { '(': ')', '[': ']', '{': '}' }
  const close = { ')': '(', ']': '[', '}': '{' }
  let i = 0, line = 1, col = 1
  const step = (n = 1) => { for (let k = 0; k < n; k++) { if (src[i] === '\n') { line++; col = 1 } else col++; i++ } }
  while (i < src.length) {
    const c = src[i]
    const at = { line, col }
    if (c === '#') { while (i < src.length && src[i] !== '\n') step(); continue }
    if (c === '"' || c === "'") {
      const q = c
      const triple = src.startsWith(q + q + q, i)
      const delim = triple ? q + q + q : q
      step(delim.length)
      let closed = false
      while (i < src.length) {
        if (src.startsWith(delim, i)) { step(delim.length); closed = true; break }
        if (!triple && src[i] === '\n') break
        if (src[i] === '\\' && i + 1 < src.length) step(2)
        else step()
      }
      if (!closed) { errors.push({ line: at.line, message: `unclosed ${triple ? 'triple-quoted ' : ''}string` }); break }
      continue
    }
    if (/[rRbBuUfF]/.test(c)) {
      let j = i; while (j < src.length && /[rRbBuUfF]/.test(src[j])) j++
      if (j < src.length && (src[j] === '"' || src[j] === "'")) { step(j - i); continue }
    }
    if (open[c]) stack.push({ ch: c, ...at })
    else if (close[c]) {
      const top = stack[stack.length - 1]
      if (!top) errors.push({ line, message: `unexpected '${c}'` })
      else if (top.ch !== close[c]) errors.push({ line, message: `'${top.ch}' opened at line ${top.line} closed by '${c}'` })
      else stack.pop()
    }
    step()
  }
  for (const un of stack) errors.push({ line: un.line, message: `unclosed '${un.ch}'` })
  return errors
}

function sanitizeForParse(src) {
  // filbert lacks some Python 3 syntax (param/return annotations). Strip them so
  // valid annotated code isn't rejected; we only need structural syntax.
  return src.replace(/^([ \t]*(?:async\s+)?def\s+\w+\s*\()([\s\S]*?)(\)\s*(?:->[^:\n]+)?\s*:)/gm, (m, pre, args) => {
    // remove `: annotation` from params (respecting defaults/commas/brackets roughly)
    let out = '', depth = 0
    for (let i = 0; i < args.length; i++) {
      const c = args[i]
      if ('([{'.includes(c)) { depth++; out += c; continue }
      if (')]}'.includes(c)) { depth = Math.max(0, depth - 1); out += c; continue }
      if (c === ':' && depth === 0) { while (i + 1 < args.length && args[i + 1] !== ',' && args[i + 1] !== '=') i++; continue }
      out += c
    }
    return pre + out + '):'
  })
}

function parseSyntax(src) {
  const tryParse = (s) => {
    if (filbert && typeof filbert.parse === 'function') filbert.parse(s)
    else if (filbert && filbert.default && typeof filbert.default.parse === 'function') filbert.default.parse(s)
  }
  try { tryParse(src); return null } catch (e) {
    // retry with annotations stripped (filbert subset limitation)
    try { tryParse(sanitizeForParse(src)); return null } catch (_) { /* report original */ }
    const line = (e && e.loc && e.loc.line) || e.lineNumber || 1
    const msg = (e && e.message) ? String(e.message).replace(/^SyntaxError:\s*/i, '') : 'syntax error'
    const hints = scanBracketsAndStrings(src)
    const blockHint = missingColonHint(src)
    const specific = hints[0] || blockHint
    if (specific && specific.line <= line + 1) return specific
    return { line, message: msg }
  }
}

// Infer ⇣ inputs / ⇡ outputs from Python `def` params and `return` values.
// Preserves existing var ids/types when names match so data wires stay connected.
export function inferCodeIO(code, prev = {}) {
  const src = String(code || '').replace(/\r\n?/g, '\n')
  const prevIn = prev.inVars || []
  const prevOut = prev.outVars || []
  // find first def signature (tolerate annotations/defaults)
  const dm = src.match(/^[ \t]*(?:async\s+)?def\s+(\w+)\s*\(([\s\S]*?)\)\s*(?:->[^:\n]+)?\s*:/m)
  let inNames = []
  let outNames = []
  if (dm) {
    const raw = dm[2]
    // split top-level commas
    const parts = []
    let depth = 0, cur = ''
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]
      if ('([{'.includes(c)) depth++
      else if (')]}'.includes(c)) depth = Math.max(0, depth - 1)
      if (c === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += c
    }
    if (cur.trim()) parts.push(cur)
    for (let p of parts) {
      p = p.trim()
      if (!p || p === '/' || p === '*') continue
      p = p.replace(/^\*+/, '') // *args/**kwargs -> name
      const nm = p.match(/^([A-Za-z_]\w*)/)?.[1]
      if (!nm || nm === 'self' || nm === 'cls') continue
      inNames.push(nm)
    }
    // outputs: collect identifier names from return expressions
    const seen = new Set()
    const rets = src.matchAll(/^[ \t]*return\b([^\n#]*)/gm)
    for (const rm of rets) {
      let expr = (rm[1] || '').trim()
      if (!expr) continue
      if (expr.startsWith('(') && expr.endsWith(')')) expr = expr.slice(1, -1).trim()
      const vals = []
      let depth2 = 0, cur2 = ''
      for (let i = 0; i < expr.length; i++) {
        const c = expr[i]
        if ('([{'.includes(c)) depth2++
        else if (')]}'.includes(c)) depth2 = Math.max(0, depth2 - 1)
        if (c === ',' && depth2 === 0) { vals.push(cur2.trim()); cur2 = '' } else cur2 += c
      }
      if (cur2.trim()) vals.push(cur2.trim())
      vals.forEach((v, idx) => {
        const isIdent = /^([A-Za-z_]\w*)$/.test(v)
        const lit = /^(None|True|False)$/.test(v) || /^\d/.test(v) || /^['"]/.test(v)
        const nm = isIdent && !lit ? v : (vals.length === 1 ? 'result' : `out${idx + 1}`)
        if (nm && !seen.has(nm)) { seen.add(nm); outNames.push(nm) }
      })
    }
  }
  if (!dm) return { inVars: prevIn, outVars: prevOut }
  const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 8)}`
  const reconcile = (names, prevArr, pref) => names.map((name) => {
    const old = prevArr.find((v) => v.name === name)
    return old ? { ...old, name } : { id: uid(pref), name, type: 'int' }
  })
  return { inVars: reconcile(inNames, prevIn, 'iv'), outVars: reconcile(outNames, prevOut, 'ov') }
}

function missingColonHint(src) {
  const blockHead = /^\s*(if|elif|else|for|while|def|class|try|except|finally|with|match|case|async\s+def|async\s+for|async\s+with)\b/
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const t = stripStringsComments(lines[i]).trim()
    if (!t) continue
    if (blockHead.test(t) && !t.endsWith(':') && !t.endsWith('\\')) return { line: i + 1, message: "missing ':' at end of block header" }
  }
  return null
}

export function validateCode(code, lang = 'python', opts = {}) {
  const src = String(code ?? '')
  const errors = []
  const warnings = []
  if (!src.trim()) return { ok: true, errors, warnings, empty: true }
  if (lang !== 'python') return { ok: true, errors, warnings }

  const norm = src.replace(/\r\n?/g, '\n')
  const lines = norm.split('\n')

  // indentation warnings
  let sawTab = false, sawSpace = false
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^[ \t]+/)
    if (!m) continue
    if (/\t/.test(m[0])) sawTab = true
    if (/ /.test(m[0])) sawSpace = true
    if (/\t /.test(m[0]) || / \t/.test(m[0])) warnings.push({ line: i + 1, message: 'mixed tabs and spaces in indentation' })
  }
  if (sawTab && sawSpace && !warnings.some((w) => w.message.includes('mixed tabs'))) warnings.push({ line: 1, message: 'file mixes tabs and spaces for indentation' })

  // strict syntax (real parser)
  const syn = parseSyntax(norm)
  if (syn) errors.push(syn)

  // intent keywords that are valid Python identifiers but almost always a JS mistake
  for (let i = 0; i < lines.length; i++) {
    const t = stripStringsComments(lines[i]).trim()
    if (!t) continue
    const ln = i + 1
    if (/\bnull\b/.test(t)) errors.push({ line: ln, message: "use 'None', not 'null'" })
    if (/\bundefined\b/.test(t)) errors.push({ line: ln, message: "use 'None', not 'undefined'" })
    if (/\btrue\b/.test(t)) errors.push({ line: ln, message: "use 'True' (capitalized), not 'true'" })
    if (/\bfalse\b/.test(t)) errors.push({ line: ln, message: "use 'False' (capitalized), not 'false'" })
  }

  // exactly one function definition drives this node's I/O
  const defs = []
  for (let i = 0; i < lines.length; i++) {
    const t = stripStringsComments(lines[i])
    if (/^\s*(?:async\s+)?def\b/.test(t)) defs.push(i + 1)
  }
  if (defs.length === 0) errors.push({ line: 1, message: 'define exactly one function (e.g. def run(...):)' })
  else if (defs.length > 1) errors.push({ line: defs[1], message: `define exactly one function (found ${defs.length})` })

  // declared ⇡ output variables must be produced (only meaningful when syntax parses)
  if (!syn) {
    const outs = (opts.outputs || []).map((v) => String(v && v.name || '').trim()).filter(Boolean)
    if (outs.length) {
      const body = stripStringsComments(norm)
      const hasReturnValue = /\breturn\b[^\n#]*\S/.test(body)
      for (const name of outs) {
        const n = String(name)
        const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const id = /^\w/.test(n)
        const assigned = id
          ? new RegExp(`\\b${esc}\\s*(?:[:+\\-*/%&|^@]|<<|>>|\\*\\*)?=(?!=)`).test(body) || new RegExp(`\\bfor\\s+${esc}\\b`).test(body) || new RegExp(`\\bdef\\s+${esc}\\b`).test(body)
          : body.includes(`${n} =`)
        const returned = id ? new RegExp(`\\breturn\\b[^\\n]*\\b${esc}\\b`).test(body) : body.includes('return') && body.includes(n)
        // synthetic inferred outputs (result/outN) are satisfied by any value return
        const synthetic = /^(result|out\d+)$/.test(n)
        if (!assigned && !returned && !(synthetic && hasReturnValue))
          errors.push({ line: 1, message: `output '${name}' is never assigned (and not returned)` })
      }
    }
  }

  const seen = new Set()
  const dedup = (arr) => arr.filter((e) => { const k = e.line + '\n' + e.message; if (seen.has(k)) return false; seen.add(k); return true })
  const e2 = dedup(errors)
  const w2 = dedup(warnings)
  return { ok: e2.length === 0, errors: e2, warnings: w2, empty: false }
}
