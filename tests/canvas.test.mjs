// canvas geometry — the two rules both canvases share for drawing and loading:
// a steered wire still bends only at 90°, and a loaded graph always opens with
// its parts inside the reachable surface (the flow canvas's origin, which does
// the panning, is view state — nothing saves it). Plus the paste rule: a copied
// MACHINE's ⇡ exit wires follow the copy's own EXIT variables.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orth, routePath, parseDoc, serializeDoc, newDoc, walkGraphs, reidGraph, exitVarsOf } from '../src/model.js'

// "M 0 0 L 10 0 L 10 5" → [[0,0],[10,0],[10,5]]
const pts = (d) => {
  const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number)
  const out = []
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]])
  return out
}

const axisAligned = (path) => {
  const p = pts(path)
  for (let i = 1; i < p.length; i++)
    assert.ok(p[i - 1][0] === p[i][0] || p[i - 1][1] === p[i][1], `segment ${p[i - 1]}→${p[i]} is diagonal`)
}

// a point is on the drawn path when some axis-aligned leg spans it
const onPath = (p, m) =>
  p.some((q, i) => {
    if (i === 0) return false
    const a = p[i - 1]
    return (
      (a[0] === q[0] && m.x === a[0] && m.y >= Math.min(a[1], q[1]) && m.y <= Math.max(a[1], q[1])) ||
      (a[1] === q[1] && m.y === a[1] && m.x >= Math.min(a[0], q[0]) && m.x <= Math.max(a[0], q[0]))
    )
  })

test('a plain wire is one horizontal → vertical → horizontal elbow', () => {
  const { d, mid } = orth(0, 0, 200, 100)
  assert.equal(d, 'M 0 0 L 100 0 L 100 100 L 200 100')
  assert.deepEqual(mid, { x: 100, y: 50 }, 'the elbow mid lands mid-way on the vertical leg')
})

test('a steered wire keeps the 90° breaks — dropping a point bends it, never diagonalises it', () => {
  axisAligned(routePath({ x: 0, y: 0 }, { x: 400, y: 300 }, [{ x: 150, y: 80 }]).d)
  axisAligned(routePath({ x: 40, y: 40 }, { x: 900, y: 40 }, [{ x: 300, y: 260 }, { x: 620, y: 260 }]).d)
  axisAligned(routePath({ x: 500, y: 0 }, { x: 0, y: 400 }, [{ x: -120, y: 130 }]).d) // backwards run
})

test('the run starts at the out port, ends at the in port and passes every anchor', () => {
  const a = { x: 10, y: 20 }
  const b = { x: 500, y: 440 }
  const anchors = [{ x: 120, y: 300 }, { x: 320, y: 90 }]
  const { d, mid } = routePath(a, b, anchors)
  const p = pts(d)
  assert.deepEqual(p[0], [a.x, a.y])
  assert.deepEqual(p[p.length - 1], [b.x, b.y])
  for (const an of anchors)
    assert.ok(p.some(([x, y]) => x === an.x && y === an.y), `the path passes through (${an.x}, ${an.y})`)
  assert.ok(onPath(p, mid), `the badge point ${JSON.stringify(mid)} lies on the path`)
})

test('anchors on a port axis collapse to a straight run instead of forcing a jog', () => {
  const p = pts(routePath({ x: 100, y: 0 }, { x: 100, y: 200 }, [{ x: 100, y: 100 }]).d)
  assert.ok(p.every(([x]) => x === 100), `purely vertical: ${JSON.stringify(p)}`)
  const h = pts(routePath({ x: 0, y: 60 }, { x: 300, y: 60 }, [{ x: 150, y: 60 }]).d)
  assert.ok(h.every(([, y]) => y === 60), `purely horizontal: ${JSON.stringify(h)}`)
})

// ---- loading: content parked on the edges comes back on screen -------------------

const docWith = (nodes, links = []) => {
  const d = newDoc('T')
  d.design.nodes = nodes
  d.design.links = links
  return d
}

test('loading pulls negative-coordinate parts back inside the surface', () => {
  const back = parseDoc(
    serializeDoc(
      docWith([
        { id: 'a', kind: 'step', x: -1066, y: -234 },
        { id: 'b', kind: 'step', x: 300, y: 100 },
      ]),
    ),
  )
  const ns = back.design.nodes
  assert.ok(ns.every((n) => n.x >= 0 && n.y >= 0), `parts load on the reachable surface: ${JSON.stringify(ns)}`)
  const [a, b] = ns
  assert.equal(b.x - a.x, 1366, 'the layout is preserved — only the whole run moved')
  assert.equal(b.y - a.y, 334)
})

test('wire anchors travel with the parts they steer', () => {
  const back = parseDoc(
    serializeDoc(
      docWith(
        [
          { id: 'a', kind: 'step', x: 0, y: 0 },
          { id: 'b', kind: 'step', x: 400, y: 200 },
        ],
        [{ id: 'l1', kind: 'flow', from: 'a', fromPort: 'out', to: 'b', toPort: 'in', anchors: [{ x: -120, y: 60 }] }],
      ),
    ),
  )
  const [a] = back.design.nodes
  const [an] = back.design.links[0].anchors
  assert.ok(an.x >= 0 && an.y >= 0, 'the anchor is reachable too')
  assert.deepEqual([a.x - an.x, a.y - an.y], [120, -60], 'anchor-to-part offset unchanged')
})

test('a graph already inside the surface is not moved at all', () => {
  const back = parseDoc(
    serializeDoc(
      docWith([
        { id: 'a', kind: 'step', x: 40, y: 80 },
        { id: 'b', kind: 'step', x: 640, y: 280 },
      ]),
    ),
  )
  assert.deepEqual(back.design.nodes.map((n) => [n.x, n.y]), [
    [40, 80],
    [640, 280],
  ])
})

test('nested graphs are repaired too — machines included', () => {
  const d = docWith([{ id: 'm', kind: 'machine', x: -500, y: -40 }])
  d.design.nodes[0].graph = {
    id: 'g2',
    mode: 'machine',
    name: 'inner',
    entry: null,
    nodes: [{ id: 'p', kind: 'action', x: -900, y: -10 }],
    links: [],
  }
  const back = parseDoc(serializeDoc(d))
  const coords = []
  walkGraphs(back.design, (g) => coords.push(...g.nodes.map((n) => [n.x, n.y])))
  assert.equal(coords.length, 2)
  assert.ok(coords.every(([x, y]) => x >= 0 && y >= 0), JSON.stringify(coords))
})

test('pasting a machine keeps ⇡ exit wires — they follow the copy’s own EXIT variables', () => {
  const machine = {
    id: 'm',
    kind: 'machine',
    x: 0,
    y: 0,
    graph: {
      id: 'g2',
      mode: 'machine',
      name: 'inner',
      entry: null,
      nodes: [
        {
          id: 'x',
          kind: 'exit',
          name: 'win',
          x: 0,
          y: 0,
          vars: [{ id: 'v1', name: 'gold', type: 'int', value: '' }],
        },
      ],
      links: [],
    },
  }
  const sink = { id: 'p', kind: 'ifb', x: 200, y: 0 }
  // the clipboard clip is the machine AND its consumer, so the ⇡ wire is part
  // of the paste and must be rewired to the copy’s freshly re-id’d exit var
  const clip = { id: 'g1', mode: 'flow', name: '', entry: null, nodes: [machine, sink], links: [{ id: 'l1', kind: 'data', from: 'm', fromPort: 'v1', to: 'p', toPort: '__a__' }] }
  const pasted = reidGraph(JSON.parse(JSON.stringify(clip)))
  const copy = pasted.nodes.find((n) => n.kind === 'machine')
  const wire = pasted.links[0]
  assert.notEqual(copy.id, 'm', 'the pasted machine is a fresh part')
  assert.notEqual(wire.fromPort, 'v1', 'the ⇡ wire no longer names the original’s variable')
  assert.ok(
    exitVarsOf(copy.graph).some((v) => v.id === wire.fromPort),
    `the ⇡ wire lands on one of the copy’s own exit variables (${exitVarsOf(copy.graph).map((v) => v.id)})`,
  )
  assert.equal(wire.to, pasted.nodes.find((n) => n.kind === 'ifb').id, 'and still reaches the pasted consumer')
})

// ---- load repair must keep parts on the 26px snap grid ----
test('load repair keeps snapped parts snapped — shifts are whole GRID steps', () => {
  const back = parseDoc(
    serializeDoc(
      docWith([
        { id: 'a', kind: 'step', x: 0, y: 26 },
        { id: 'b', kind: 'step', x: -52, y: 260 },
      ]),
    ),
  )
  const ns = back.design.nodes
  assert.ok(ns.every((n) => n.x % 26 === 0 && n.y % 26 === 0), `every snapped part loads snapped: ${JSON.stringify(ns)}`)
})

// ---- flipped parts: wires must leave/enter on the flipped side ----
test('a flipped end routes out of its own side, never through the card', () => {
  // source port at x=100 belongs to a flipped part (⇡ sits on the LEFT edge)
  const r = orth(100, 100, 500, 160, -1, 0)
  const p = pts(r.d)
  assert.ok(p[1][0] < 100, 'first leg stubs LEFT out of a flipped ⇡')
  axisAligned(r.d)
  // target on a flipped part: last leg comes in from the right side
  const s = orth(100, 100, 500, 160, 0, -1)
  const q = pts(s.d)
  assert.ok(q[q.length - 2][0] > q[q.length - 1][0], 'enters a flipped ⇣ from the right')
  axisAligned(s.d)
  // classic routing untouched: dirs 0 keep the plain elbow
  axisAligned(orth(0, 0, 100, 40).d)
  const plain = pts(orth(0, 0, 100, 40).d)
  assert.ok(plain[1][0] >= 30, 'unflipped still exits rightward at x+30')
})

test('anchors beside a flipped end bend AT the anchor — no fold-back, no card cut', () => {
  // flipped source (⇡ on the left edge, ds=−1) with an anchor dropped to the
  // RIGHT of its port: the elbow lane slides just left of the port, the wire
  // exits leftward, then runs to the anchor and on — never doubling at it
  const d = routePath({ x: 100, y: 100 }, { x: 700, y: 300 }, [{ x: 500, y: 200 }], -1, 0).d
  axisAligned(d)
  const p = pts(d)
  assert.ok(p[1][0] < 100, 'first leg still exits LEFT out of the flipped ⇡')
  const i = p.findIndex(([x, y]) => x === 500 && y === 200)
  assert.ok(i > 0, 'the anchor stays a vertex of the drawn run')
  assert.ok(p[i - 1][0] < 500 && p[i + 1][0] > 500, 'wire runs one way through the anchor, no hairpin')
  // flipped target entered via an anchor on its left: lane slides to the
  // port's right side, the anchor passes through consistently
  const e = routePath({ x: 0, y: 0 }, { x: 600, y: 200 }, [{ x: 300, y: 100 }], 0, -1).d
  axisAligned(e)
  const q = pts(e)
  const j = q.findIndex(([x, y]) => x === 300 && y === 100)
  assert.ok(q[j - 1][0] < 300 && q[j + 1][0] > 300, 'anchor keeps a single run direction')
  assert.ok(q[q.length - 2][0] > 600, 'enters the flipped ⇣ from the right')
})

test('ordinary ports keep their sides even when the wire loops back', () => {
  // ⇡ on the right edge at x=700, an anchor placed to its left, gutter at
  // x=100 approached from below: no leg may cut through either card
  const d = routePath({ x: 700, y: 100 }, { x: 100, y: 300 }, [{ x: 500, y: 400 }], 1, 1).d
  axisAligned(d)
  const p = pts(d)
  assert.ok(p[1][0] > 700, '⇡ still exits RIGHT even though the wire runs left overall')
  const i = p.findIndex(([x, y]) => x === 500 && y === 400)
  assert.ok(i > 0, 'the anchor stays an exact vertex')
  assert.ok(p[i - 1][1] === 400 && p[i + 1][1] === 400 &&
    Math.sign(p[i][0] - p[i - 1][0]) === Math.sign(p[i + 1][0] - p[i][0]), 'wire passes the anchor in one direction, no fold')
  assert.ok(p[p.length - 2][0] < 100, '⇣ is entered from its LEFT, never from behind the card')
  // a bare port-to-port loopback still exits right and enters from the left,
  // crossing between the cards
  const e = orth(600, 250, 100, 250, 1, 1).d
  axisAligned(e)
  const q = pts(e)
  assert.ok(q[1][0] > 600 && q[q.length - 2][0] < 100, 'loopback honours both port faces')
})
