// render-check: every kind through the card renderer, in node, so a broken card
// shows up without a browser. `esbuild --bundle scripts/render-check.jsx` then run
// the bundle. Each kind gets a real node from model.js and a graph of a canvas
// that kind may sit on; anything that throws or renders nothing loudly is a bug.
import React from 'react'
import { renderToString } from 'react-dom/server'
import NodeCard from '../src/NodeCard.jsx'
import { KINDS, newNode, newGraph, uid, newAsset, newGlobal, newFuncGraph } from '../src/model.js'

const noop = () => {}
const handlers = {
  onPatch: noop,
  onSelect: noop,
  onToggleEntry: noop,
  onOpenGraph: noop,
  onPortDown: noop,
  onDataPortDown: noop,
  onHeaderDown: noop,
  onCardClick: noop,
  onResizeDown: noop,
  onSimCall: noop,
}

const assets = [newAsset('art', 'an art asset'), newAsset('system', 'a system asset')]
assets[1].ledger = [{ id: uid('lv'), name: 'gold', type: 'int', value: 3 }]
const globals = [newGlobal('score')]
const funcs = [newFuncGraph('a function')]

// what each card must show: the shape marker, the dock buttons, the nest frame
const expect = {
  graph: ['nd-container', '▸', 'open →'],
  machine: ['nd-container', '▸', 'open →'],
  func: ['nd-container', '▸', '▶ enter'],
  event: ['·', '+ call system', '+ generate asset'],
  choice: ['·', '+ option'],
  todo: ['·', '+ task'],
  enter: ['·', '+ variable', '+ asset'],
  exit: ['·', '+ variable', 'nd-exit'],
  var: ['·'],
  step: ['·'],
}
let bad = 0
for (const [kind, meta] of Object.entries(KINDS)) {
  for (const canvas of meta.canvas) {
    const graph = newGraph(canvas, 'the canvas')
    const node = newNode(kind, 0, 0)
    graph.nodes = [node]
    if (kind === 'graph' || kind === 'machine' || kind === 'func') {
      // nests need their own body so the count row has something to count
      node.graph = newGraph(canvas === 'flow' ? 'flow' : 'machine', 'the nest')
    }
    if (kind === 'func') node.func = funcs[0].id
    try {
      const html = renderToString(
        NodeCard({
          node,
          graph,
          assets,
          types: [],
          globals,
          funcs,
          systems: assets.filter((a) => a.kind === 'system'),
          gvals: null,
          selected: false,
          isEntry: canvas === 'flow',
          sim: null,
          ...handlers,
        }),
      )
      if (!html.includes('nd-head')) {
        bad++
        console.log(`?? ${kind} on ${canvas}: no title bar`)
      }
      for (const want of expect[kind] ?? []) {
        if (!html.includes(want)) {
          bad++
          console.log(`?? ${kind} on ${canvas}: no ${want}`)
        }
      }
      if (html.includes('dashed')) {
        bad++
        console.log(`?? ${kind}: a dashed outline inside the card`)
      }
      // cramped content swaps the card to the wide width — a long name, note
      // or label must render as nd-wide, and ordinary content must not
      if (kind === 'step' && html.includes('nd-wide')) {
        bad++
        console.log(`?? ${kind} on ${canvas}: wide for content that fits`)
      }
      if (['step', 'choice', 'var'].includes(kind)) {
        const big = { ...node }
        if (kind === 'step') big.note = 'a sentence of prose far too long to fit the regular card'
        if (kind === 'choice') big.exits = [{ id: uid('ex'), label: 'the one genuinely wide option label' }]
        if (kind === 'var') big.variable = { name: 'a longish variable', type: 'aWideType[]', value: '' }
        const wideHtml = renderToString(
          NodeCard({ node: big, graph, assets, types: [], globals, funcs, systems: assets.filter((a) => a.kind === 'system'), gvals: null, selected: false, isEntry: canvas === 'flow', sim: null, ...handlers }),
        )
        if (!wideHtml.includes('nd-wide')) {
          bad++
          console.log(`?? ${kind} on ${canvas}: cramped but stayed regular`)
        }
      }
    } catch (e) {
      bad++
      console.log(`!! ${kind} on ${canvas} threw: ${String(e.message).slice(0, 160)}\n     ${String(e.stack).split('\n')[1] ?? ''}`)
    }
  }
}
console.log(bad ? `\n${bad} cards failed` : `\nall ${Object.values(KINDS).reduce((n, m) => n + m.canvas.length, 0)} card/canvas pairs rendered`)
