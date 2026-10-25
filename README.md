# loopdoc composer

A design-doc authoring tool for game loops. One vocabulary, two canvases:

- **flow graphs** — the game-loop canvas: control flow between typed nodes
- **machines** — chain-execution sims: entry points, running chains, pools of data

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

A `flow` graph moves **control** between nodes. A `machine` graph runs
**chains**: every part with no flow input is an *entry point*; a chain walks
downstream one hop per step, and the entry re-fires when all of its chains
reach an end. Link circles set the `amount` a chain adds/removes from pools
it passes through. `data` links carry a typed value from a ⇡ output
to a ⇣ input **of the same type** (types compare case-insensitively).

## Node kinds

canvas: `STEP` · `EVENT` (calls 0..n system fns, may ✨generate a
graph-local asset) · `IF` (true/false) · `CHOICE` (one port per option) ·
`LOAD` / `UNLOAD` (📦 asset memory) · `INPUT` (🎮 input asset) · `VAR` (assign) · `GRAPH` (nested flow graph, RETURN exits back out) · `MACHINE`
(nested machine — opens full-screen like any nested graph; the machine's
EXIT parts appear here as named output ports).

machine canvas: `SOURCE` (chain entry) · `DRAIN` (removes its amount from
upstream pools — and its `out` lets the chain continue **after** the subtraction,
so an `IF` placed there reads drained values; set `n` on the card, or wire ⇣
`in:int` and the field hides) · `ADD` (drain's mirror — adds its amount to
upstream pools per pass, **signed**: `+1` for descend, `−1` for ascend; ⇣
`in:int` dictates) · `GLOBAL` (reads a ⚙ doc-wide variable) · `SET` (writes
one as the chain passes) · `POOL` (its amount is ⇡
`int` data — wire ⇣ `in:int` for a write-back window, see below) ·
`CONVERTER` · `GATE` · `RAND GATE` (half the chains that arrive drop) ·
`TRADER` · `DELAY` (holds the chain N steps) · `QUEUE` (releases at most
rate chains/step) · `IF` (compares ⇣ `a` ⟨sign⟩ ⇣ `b` — `< · <= · == · != · >= · >` — over `int`
or `bool`, both sides alike; an unwired side takes a **custom value** typed on
the card; chain leaves via **true** or **false**, and ⇡ `result:bool`
republishes the verdict) ·
`REGISTER` (absorbs chains, pulses every N) · `FOR` (⇣ `to:int` loads a
count on trigger; one iteration per step once the previous body chain has
ended, ⇡ `i:int` is the current iteration) · `FOREACH` (⇣ any `T[]` array,
from a sys-call output; one iteration per step, ⇡ `item:T` + ⇡ `index:int`;
**end** out continues the chain once the last body chain finishes) ·
`ACTION` (the chain waits here — click to fire; refuses to fire while input
pools are short) · `SYS CALL` (calls its system fn as the chain
passes · tick **⏳ can block** and it stays *opened* — the chain freezes
until you click it to return) · `INSPECT` (pure data —
no flow ports at all; ⇣ `obj` of any declared type → one ⇡ per field) · `TEXT` ·
`EXIT` (the machine ends here; name it — `victory`, `defeat`, `flee` — and the
parent graph's MACHINE node grows a matching output port to continue from).

Chain sim visuals: parts with a chain token in flight glow teal; waiting
parts (⏳ ACTION / blocked SYS CALL) pulse amber and are clickable.

Pool windows: wire a value into a pool's ⇣ `in:int` and it becomes a live
window onto that value — chains never add or subtract from it; only `drain`
edits the number, and at the end of every step it is **written back to its
origin** (e.g. the `Entity` inside a foreach's array), so the next read
anywhere — next iteration, next round — sees the change. The sim log marks
writes with ✎.

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
with a warning. In machines, pools feed `int` into fn inputs. A sys call is a
black box: while **simulating**, its ⇡ rows become editable so you type the
answer the black box returns (a blocking call stays open until you click it);
typed answers persist across rounds and show as `(your value)` in the sim log.

## Interactions

- dbl-click canvas → drop a STEP · drag ◆ out-port onto a node → flow link
- click link → select (Del removes) · dbl-click link → add anchor, drag it
- **box-select**: drag on empty canvas (both canvases) · `Shift`-click or
  box-add to grow a selection · drag one selected node to move the whole group
- `Ctrl+C/X/V` copy/cut/paste (nested graphs & wires included) · `Ctrl+A`
- machines mirror all of the above: box-select, group-drag, `Ctrl+C/X/V`,
  dbl-click a wire to drop **anchors** that steer its route (Del removes)
- **TEXT** frames (flow *and* machine canvases) resize via the corner grip and
  work as **group containers**: drop parts inside one and they parent to it —
  dragging the frame carries everything grouped inside (nested frames too;
  copy/paste keeps groups, deleting a frame frees its children)
- everything **snaps to the 26px dot grid** — drags, group drags (leader-snapped,
  members keep their offsets), resizes, pastes and new parts; existing positions
  are never moved, they snap the next time you touch them
- ▶ on a node marks the graph entry · ▶ **traverse** walks the flow,
  pausing at IF/CHOICE; nested graphs run and RETURN pops back
- **⚙ GLOBALS** (assets panel): document-wide named variables with defaults —
  every machine sim starts from the default; **GLOBAL** parts (flow & machine)
  read them as typed ⇡ data, **SET** parts (machine) write them as the chain
  passes, so machines and rounds can share state (score, depth, game flags)
- **⚑ check** opens the design-rule panel — a PCB-style DRC over the open
  graph or the whole doc: dropped-chain wiring (unwired IF operand, empty
  loop body, no entry), last-iteration item reads on end chains, drain vs
  reader races, unreachable exits, dangling data wires, deleted-type drift;
  ✕ errors · ⚠ warnings · ℹ info, click a finding to jump to its graph
- **Ctrl+S** save / open `.json` (File System Access API; autosaves to
  localStorage meanwhile)

## Files

```
src/model.js         schema, kind registry, factories, graph ops — single source of truth
src/drc.js           design rule check — pure static analysis over graphs/doc
src/DRCPanel.jsx     docked live DRC results with scope + severity filters
src/NodeCard.jsx     the node renderer shared by both canvases
src/GraphCanvas.jsx  flow canvas: drag/connect/select/paste/data wires
src/MachineCanvas.jsx machine canvas: full-screen editor + chain simulation
src/MachineCanvasLegacy.jsx previous machinations step-tick sim (backup)
src/AssetsPanel.jsx  docked asset registry + system API editor
src/Traverse.jsx     flow-graph walkthrough
src/App.jsx          shell: tabs, doc store, save/open, breadcrumbs
src/theme.css        waybar-flavored theme (near-black, magenta, square)
```

> loopdoc-composer reads only composer files (`"app": "loopdoc-composer"`).
> It does not import legacy loopdoc documents — port them by hand (they're small).
