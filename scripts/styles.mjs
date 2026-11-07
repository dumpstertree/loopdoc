#!/usr/bin/env node
/* ---------------------------------------------------------------------------
styles.json is the design surface; theme.css is structure.

  styles.json ──▶ src/styles.gen.css   a :root holding every styling value
               ──▶ src/styles.gen.js   the same values as JS, for the canvases

theme.css keeps selectors and properties only — each value is var(--token),
named <class>-<property>, grouped by the section comment above it, so the
whole look of loopdocs is editable in one json file.

  node scripts/styles.mjs          harvest theme.css into styles.json, rewrite
                                   theme.css to var()s, write the generated files
  node scripts/styles.mjs --gen    regenerate the generated files from styles.json
  node scripts/styles.mjs --check  report theme.css declarations still holding literals
  node scripts/styles.mjs --watch  regenerate whenever styles.json changes

Run `npm run styles` after editing styles.json; the dev server reloads.
---------------------------------------------------------------------------- */
import { readFileSync, writeFileSync, watchFile } from 'node:fs'

const THEME = 'src/theme.css'
const JSON_PATH = 'styles.json'
const GEN_CSS = 'src/styles.gen.css'
const GEN_JS = 'src/styles.gen.js'
const GENERATED = '/* GENERATED FROM styles.json — edit styles.json, not this file. */'

const KEYWORDS = new Set(
  ('none auto inherit initial unset revert transparent currentcolor flex inline inline-block ' +
  'inline-flex block inline-block grid contents hidden visible solid dashed dotted ' +
  'nowrap pre-wrap normal center left right top bottom baseline stretch inside uppercase ' +
  'relative absolute fixed sticky pointer-events auto-column circle disc square ' +
  'end start middle thin medium thick').split(' ')
)
const needsToken = (v) => {
  const t = v.trim()
  if (!t || KEYWORDS.has(t)) return false
  if (/^var\(--[\w-]+\)$/.test(t)) return false
  // a value that only combines tokens is structure, not a styling value:
  // calc(-1 * (var(--node-gutter) + var(--port-data-half))) stays as it is
  let bare = t
  while (/\bvar\(/.test(bare)) bare = bare.replace(/var\([^()]*\)/g, '')
  if (/\bvar\(/.test(t) && !/#[0-9a-fA-F]{3,8}|\b\d+(?:\.\d+)?(?:px|em|rem|%|ch|vh|vw|deg)\b/.test(bare)) return false
  return (
    /['"]/.test(t) ||
    /#[0-9a-fA-F]{3,8}/.test(t) ||
    /\b(?:rgba?|hsla?|calc|clamp|min|max|url|linear-gradient|radial-gradient)\(/.test(t) ||
    /[-+]?\d*\.?\d+(?:px|em|rem|ch|vh|vw|%|deg)/.test(t) ||
    /^[-+]?\d*\.?\d+$/.test(t)
  )
}
const classOf = (sel) => {
  const parts = sel
    .split(/\s+/)
    .map((piece) =>
      piece
        .replace(/&/g, 'self')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/[^A-Za-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, '-')
    )
  const name = parts.filter(Boolean).join('-') || 'self'
  return /^\d/.test(name) ? `k${name}` : name
}
const walk = (css) => {
  const out = []
  let section = 'defaults'
  let selector = null
  let depth = 0
  const lines = css.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const banner = /^\/\*[-*\s]*([A-Za-z][^*]*?)[-*\s]*\*\/$/.exec(line)
    if (banner) {
      const name = banner[1].replace(/[(),]/g, ' ').replace(/[^A-Za-z0-9]+/g, ' ').trim()
      if (name) section = name.slice(0, 40)
      continue
    }
    if (!line || line.startsWith('/*') || line.startsWith('*')) continue
    if (line.endsWith('{') && !line.includes('}')) {
      const head = line.slice(0, -1).trim()
      if (/^[A-Za-z.:#@[*]/.test(head)) selector = head
      depth++
      continue
    }
    if (line.startsWith('}')) {
      depth = depth > 0 ? depth - 1 : 0
      if (depth === 0) selector = null
      continue
    }
    // single-line rules — .nd-step { --kc: var(--clay); } — count too
    const one = /^([^{}]+)\{(.*)\}$/.exec(line)
    if (one) {
      const head = one[1].trim()
      for (const piece of one[2].split(';')) {
        const decl = /^([A-Za-z*-][\w-]*)\s*:\s*(.+?)\s*$/.exec(piece.trim())
        if (decl) out.push({ line: i, section, selector: head, prop: decl[1], value: decl[2], inline: true })
      }
      continue
    }
    const decl = /^([A-Za-z*-][\w-]*)\s*:\s*(.+?)\s*;?$/.exec(line)
    if (decl) out.push({ line: i, section, selector: selector || 'defaults', prop: decl[1], value: decl[2] })
  }
  return out
}

const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())
// dropping the palette left some blocks empty — remove those too
const compact = (lines) => {
  const kept = lines.filter((l) => l !== null)
  const out = []
  for (let i = 0; i < kept.length; i++) {
    const next = kept.slice(i + 1).find((l) => l.trim())
    if (kept[i].trim().endsWith('{') && next && next.trim() === '}') {
      i += 1
      continue
    }
    out.push(kept[i])
  }
  return out
}
const num = (v) => {
  const t = v.trim()
  return /^-?\d*\.?\d+px$/.test(t) ? Number(t.slice(0, -2)) : JSON.stringify(t)
}

function tokensOf(json) {
  const all = {}
  for (const [k, v] of Object.entries(json.palette ?? {})) all[k] = v
  for (const s of Object.values(json.sections ?? {})) for (const [k, v] of Object.entries(s)) all[k] = v
  return all
}

function generate(json) {
  const all = tokensOf(json)
  // values that read per-element vars (--kc is set on each card's own class rule)
  // can't live on :root — a custom property resolves its var()s where it is
  // declared, so on :root they would bake the fallback for every element.
  // declare them on `*` instead: every element computes its own copy, seeing
  // its own --kc
  const ctxVar = /var\(--(?:kc|accent-c)[,)]/
  const global = {}
  const perElem = {}
  for (const [k, v] of Object.entries(all)) (ctxVar.test(String(v)) ? perElem : global)[k] = v
  const css =
    `${GENERATED}\n:root {\n` +
    Object.entries(global).map(([k, v]) => `  --${k}: ${v};`).join('\n') +
    `\n}\n/* these read --kc (the per-kind color): declared on * so each element
   resolves its own — the card outline matches the kind color on the title */\n* {\n` +
    Object.entries(perElem).map(([k, v]) => `  --${k}: ${v};`).join('\n') +
    '\n}\n'
  writeFileSync(GEN_CSS, css)
  const js =
    `${GENERATED.replace('/*', '//').replace('*/', '')}\n` +
    `export const PAL = ${JSON.stringify(json.palette ?? {}, null, 2)}\n` +
    `export const T = {\n` +
    Object.entries(all).map(([k, v]) => `  ${camel(k)}: ${num(v)},`).join('\n') +
    `\n}\n`
  writeFileSync(GEN_JS, js)
  return all
}

function harvest() {
  const css = readFileSync(THEME, 'utf8')
  const lines = css.split('\n')
  const patched = lines.slice()
  let prev = {}
  try {
    prev = JSON.parse(readFileSync(JSON_PATH, 'utf8'))
  } catch {
    prev = {}
  }
  const palette = { ...(prev.palette ?? {}) }
  const sections = JSON.parse(JSON.stringify(prev.sections ?? {}))
  const taken = new Set()
  const inline = new Map()
  let literals = 0
  for (const d of walk(css)) {
    if (!needsToken(d.value)) continue
    literals += 1
    const base = d.prop.replace(/^--/, '')
    let name = d.selector === ':root' ? base : `${classOf(d.selector)}-${base}`
    if (taken.has(name)) name = `${name}-${d.section.replace(/[^A-Za-z0-9]+/g, '-')}`
    taken.add(name)
    if (d.selector === ':root') palette[name] = d.value
    else (sections[d.section] ??= {})[name] = d.value
    if (d.inline) {
      const hit = inline.get(d.line) ?? []
      hit.push([d.prop, name])
      inline.set(d.line, hit)
    } else if (d.selector === ':root') patched[d.line] = null
    else patched[d.line] = `  ${d.prop}: var(--${name});`
  }
  for (const [line, reps] of inline) {
    let text = lines[line]
    for (const [prop, name] of reps) text = text.replace(new RegExp(`${prop}\\s*:\\s*[^;{]*;`), `${prop}: var(--${name});`)
    patched[line] = text
  }
  const json = {
    note:
      'Every styling value in loopdocs — colors, sizes, offsets, borders, fonts, glyphs — ' +
      'named <class>-<property> as it appears in theme.css and grouped by the section ' +
      'comment above it. Edit a value and run `npm run styles`; to style something new, ' +
      'write var(--your-name) in theme.css and give it a value here.',
    palette,
    sections,
  }
  writeFileSync(JSON_PATH, `${JSON.stringify(json, null, 2)}\n`)
  writeFileSync(THEME, `${compact(patched).join('\n')}`)
  generate(json)
  console.log(`styles.json: ${Object.keys(palette).length} colors + ${taken.size - Object.keys(palette).length} values; theme.css literals left: 0`)
}

function check() {
  const css = readFileSync(THEME, 'utf8')
  const stray = walk(css).filter((d) => needsToken(d.value))
  for (const d of stray) console.log(`literal: ${d.section} ${d.selector} ${d.prop}: ${d.value}`)
  const json = JSON.parse(readFileSync(JSON_PATH, 'utf8'))
  const defined = new Set(Object.keys(tokensOf(json)))
  const used = new Set()
  for (const m of css.matchAll(/--([a-z][a-z0-9-]*)/g)) used.add(m[1])
  const missing = [...used].filter((n) => !defined.has(n) && !['kc', 'accent-c'].includes(n))
  for (const n of missing) console.log(`no value for var(--${n})`)
  const unused = [...defined].filter((n) => !used.has(n) && !['mono'].includes(n))
  for (const n of unused) console.log(`json value nothing uses: --${n}`)
  return stray.length + missing.length
}

const mode = process.argv[2]
if (mode === '--gen') generate(JSON.parse(readFileSync(JSON_PATH, 'utf8')))
else if (mode === '--check') process.exit(check() > 0 ? 1 : 0)
else if (mode === '--watch') {
  watchFile(JSON_PATH, { interval: 800 }, () => generate(JSON.parse(readFileSync(JSON_PATH, 'utf8'))))
  console.log('watching styles.json…')
} else harvest()
