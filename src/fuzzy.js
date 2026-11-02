// ---------------------------------------------------------------------------
// tiny fuzzy matcher for the node palette (space bar).
//
// A candidate matches when the query appears as a subsequence of its label,
// or of one word of its hint. Score rewards matches that read like what the
// user meant:
//   • string start          +40   ("sta" → "START")
//   • word start            +15   ("fire" → "FIRES" in a hint)
//   • consecutive run       +8    ("tra" → "TRANSFORM" beats scattered letters)
//   • each gap              -3    keeps scattered hits below tight ones
//   • label substring       huge  a label containing the query beats all prose
//   • label vs prose        ×3 / ×0.3  prose only surfaces a node, never
//                                       outranks a real label match
//   • shorter candidates     -len/100  ties go to the more specific name
// ---------------------------------------------------------------------------

const BONUS_START = 40
const BONUS_WORD = 15
const BONUS_RUN = 8
const PENALTY_GAP = 3

// score of `query` (already lowercased) against one lowercased text; 0 = no match
function matchText(text, q) {
  if (!q) return 0
  let score = 0
  let ti = 0
  let prev = -2 // index in text of the previous matched char
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi]
    const found = text.indexOf(c, ti)
    if (found === -1) return 0 // subsequence required
    if (found === 0) score += BONUS_START
    else if (/[^\w]/.test(text[found - 1]) && /[a-z0-9]/.test(c)) score += BONUS_WORD
    if (found === prev + 1 && qi > 0) score += BONUS_RUN
    else if (qi > 0) score -= PENALTY_GAP * (found - prev - 1)
    score += 1 // every matched char counts a little
    prev = found
    ti = found + 1
  }
  return score
}

// hint prose matches word-by-word, so the word-start bonus applies to every
// token and stray letter pairs spanning two words ("l…o" in "line console")
// never create a false hit
function matchHint(hint, q) {
  let best = 0
  for (const w of hint.split(/[^\p{L}\p{N}]+/u)) {
    const s = matchText(w, q)
    if (s > best) best = s
  }
  return best
}

// score one candidate { label, hint } against a lowercased query
function scoreCandidate(cand, q) {
  if (!q) return 1
  const label = (cand.label || '').toLowerCase()
  const hint = (cand.hint || '').toLowerCase()
  const ls = matchText(label, q)
  const hs = matchHint(hint, q)
  if (ls <= 0 && hs <= 0) return 0
  // a label that literally contains the query beats every scattered match;
  // among those, better-placed (prefix, tight) matches rank first
  if (label.includes(q)) return 1e6 + ls * 3 - label.length / 100
  // prose is supporting evidence only: it surfaces a node but never outranks
  // a real label match, so scale it below the smallest label score
  return Math.max(ls * 3, hs * 0.3) - label.length / 100
}

// rank candidates by relevance; empty query keeps the given order
export function fuzzyRank(items, query) {
  const q = (query || '').trim().toLowerCase().replace(/\s+/g, '')
  const scored = items.map((item, i) => ({ item, i, s: scoreCandidate(item, q) }))
  if (!q) return items
  return scored
    .filter((e) => e.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((e) => e.item)
}
