// canvas geometry — the two rules both canvases share for drawing and loading:
// a steered wire still bends only at 90°, and a loaded graph always opens with
// its parts inside the reachable surface (the flow canvas's origin, which does
// the panning, is view state — nothing saves it).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orth, routePath, parseDoc, serializeDoc, newDoc, walkGraphs } from '../src/model.js'

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
  assert.deepEqual(mid, { x: 100, y: 50 }, 'the amount badge sits mid-way on the vertical leg')
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
    nodes: [{ id: 'p', kind: 'pool', x: -900, y: -10 }],
    links: [],
  }
  const back = parseDoc(serializeDoc(d))
  const coords = []
  walkGraphs(back.design, (g) => coords.push(...g.nodes.map((n) => [n.x, n.y])))
  assert.equal(coords.length, 2)
  assert.ok(coords.every(([x, y]) => x >= 0 && y >= 0), JSON.stringify(coords))
})
