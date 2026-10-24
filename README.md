# loopdoc composer

A design-doc authoring tool for game loops. One vocabulary, two canvases:

- **flow graphs** — the game-loop canvas: control flow between typed nodes
- **machines** — Machinations-style economy sims (tokens, pools, rates)

Both are `Graph ▸ Node + Link`. Both use the same node card, the same port
model, and the same **typed data wires**.

## Run

```sh
npm install
npm run dev
```

## Vocabulary

| concept  | shape                                                              |
| -------- | ------------------------------------------------------------------ |
| `Doc`    | `{ app, version, name, design: Graph, notes, assets: Asset[] }`    |
| `Graph`  | `{ id, mode:'flow'│'machine', name, entry, nodes[], links[] }`     |
| `Node`   | `{ id, kind, name, x, y, …kind fields }`                           |
| `Link`   | `{ id, kind:'flow'│'data', from, fromPort, to, toPort, amount? }`  |
| `Asset`  | `{ id, kind, name, note, api? }` — systems carry an `api`          |
| `api fn` | `{ id, name, inputs:[{id,name,type}], outputs:[…] }`               |

A `flow` graph moves **control** between nodes; a `machine` graph moves
**resource tokens** between pools. `flow` links inside machines carry an
`amount` (tokens per flow). `data` links carry a typed value from a ⇡ output
to a ⇣ input **of the same type** (types compare case-insensitively).

## Node kinds

canvas: `STEP` · `EVENT` (calls 0..n system fns, may ✨generate a
graph-local asset) · `IF` (true/false) · `CHOICE` (one port per option) ·
`LOAD` / `UNLOAD` (📦 asset memory) · `INPUT` (🎮 input asset) · `VAR`
(assign) · `GRAPH` (nested flow graph, RETURN exits back out) · `MACHINE`
(nested economy sim — opens full-screen like any nested graph).

machine canvas: `SOURCE` · `DRAIN` · `POOL` (its amount is ⇡ `int` data) ·
`CONVERTER` · `GATE` · `RAND GATE` · `TRADER` · `DELAY` · `QUEUE` ·
`REGISTER` · `ACTION` (click while simulating → fires + one tick) ·
`SYS CALL` (calls its system fn whenever flow passes through — never
clickable) · `TEXT`.

## Systems & data wires

Define a ⚙️ **system** asset in the docked 📦 panel and give it an API:
function names with typed ⇣ inputs and ⇡ outputs (free-form types: `int`,
`loot table`, …). EVENT nodes and SYS CALL nodes pick a system + fn and grow
typed port squares. Drag ⇡ → ⇣ to wire data; mismatches are refused with a
warning. In machines, pools feed `int` into fn inputs; sys calls log their
exchanged values into the sim log.

## Interactions

- dbl-click canvas → drop a STEP · drag ◆ out-port onto a node → flow link
- click link → select (Del removes) · dbl-click link → add anchor, drag it
- `Ctrl+C/X/V` copy/cut/paste (nested graphs & wires included) · `Ctrl+A`
- ▶ on a node marks the graph entry · ▶ **traverse** walks the flow,
  pausing at IF/CHOICE; nested graphs run and RETURN pops back
- **Ctrl+S** save / open `.json` (File System Access API; autosaves to
  localStorage meanwhile)

## Files

```
src/model.js         schema, kind registry, factories, graph ops — single source of truth
src/NodeCard.jsx     the node renderer shared by both canvases
src/GraphCanvas.jsx  flow canvas: drag/connect/select/paste/data wires
src/MachineCanvas.jsx machine canvas: full-screen editor + token simulation
src/AssetsPanel.jsx  docked asset registry + system API editor
src/Traverse.jsx     flow-graph walkthrough
src/App.jsx          shell: tabs, doc store, save/open, breadcrumbs
src/theme.css        waybar-flavored theme (near-black, magenta, square)
```

> loopdoc-composer reads only composer files (`"app": "loopdoc-composer"`).
> It does not import legacy loopdoc documents — port them by hand (they're small).
