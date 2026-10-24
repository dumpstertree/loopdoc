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
| `Doc`    | `{ app, version, name, design: Graph, notes, assets: Asset[], types: Type[] }` |
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
`REGISTER` · `FOR` (⇣ `to:int` loads a count on trigger; passes 1 flow/step,
⇡ `i:int` is the current iteration) · `FOREACH` (⇣ any `T[]` array, from a
sys-call output; passes 1 flow/step, ⇡ `item:T` + ⇡ `index:int`) · `ACTION`
(click while simulating → fires + one tick) · `SYS CALL` (calls its system
fn whenever flow passes through — never clickable) · `INSPECT` (⇣ `obj` of
any declared type → grows one ⇡ per field of that type) · `TEXT`.

Array data: give a system fn an output typed `Foo[]` and edit its sim value
as a comma list (`goblin, orc, dragon`) — foreach consumes it and its live
`item` output can feed more ⇣ ports. Struct-typed outputs (`Foe`) grow a
mini-form with one input per declared field — wire that output into an
INSPECT node and it explodes into `⇡ name`, `⇡ hp`, … for each field.

## Systems & data wires

Declare **T**ypes in the docked 📦 panel: a name plus the fields it is made
up of (each field picks its type from the same dropdown). Basic types
(`int · float · string · bool`) and their `[]` array versions are always
available; declared types join the list — every fn variable type is picked,
never typed. Renaming a type cascades into fn variables and foreach item
types.

Define a ⚙️ **system** asset and give it an API: function names with typed
⇣ inputs and ⇡ outputs. EVENT nodes and SYS CALL nodes pick a system + fn
and grow typed port squares. Drag ⇡ → ⇣ to wire data; mismatches are refused
with a warning. In machines, pools feed `int` into fn inputs; sys calls log
their exchanged values into the sim log.

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
