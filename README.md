# loopdoc composer

A design-doc authoring tool for game loops. One vocabulary, two canvases:

- **flow graphs** — the game-loop canvas: control flow between typed nodes
- **machines** — chain-execution sims: entry doors, running chains, typed data wires

Both are `Graph ▸ Node + Link`. Both use the same node card, the same port
model, and the same **typed data wires**.

## Layout

Top-level tabs split the document: **DESIGN** (the canvases, breadcrumb through
nested graphs) · **BUSINESS** / **MOOD** notes · **ASSETS**, with a sub-tab
group for 🎨 **Art** · 🖥 **UI** · 🔊 **Audio** · 🎮 **Input** · **DATA**, with a
sub-tab group for ⚙️ **Systems** (typed APIs) · ⚙ **Global variables** ·
≡ **Types** · ƒ **Functions** (isolated bodies picked by FUNC parts). Every registry lives inside those two tabs — no side panel.

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
| `Link`   | `{ id, kind:'flow'│'data', from, fromPort, to, toPort, anchors? }` |
| `Asset`  | `{ id, kind, name, note, api? }` — systems carry an `api`          |
| `api fn` | `{ id, name, inputs:[{id,name,type}], outputs:[…] }`               |

A `flow` graph moves **control** between nodes. A `machine` graph runs
**chains**: `ENTER` parts are its *entry points* — always the start, never
implicit; a chain walks
downstream one hop per step, and the entry re-fires when all of its chains
reach an end. `data` links carry a typed value from a ⇡ output
to a ⇣ input **of the same type** (types compare case-insensitively).

## Node kinds

canvas: `STEP` · `CODE` (edits a script — Python syntax validated on the card —
with `+ ⇣ input` / `+ ⇡ output` buttons for typed data ports, like STEP;
available on flow, machine and func canvases, chain passes through) · `SYS CALL` (picks a ⚙️ system + fn, calls it as the chain
passes — ⏳ can block; see machines) · `IF` (true/false) ·
`LOAD` / `UNLOAD` (📦 asset memory) · `INPUT` (🎮 input asset) · `VAR` (**pure data, no flow ports** — make a typed
value: pick any type and fill in every field, recursively; child structs nest
inside, arrays grow row by row, `bool` is a pick and `asset` a 📦 dropdown;
recursive types collapse to a ↻ nest-deeper click; **⇡ publishes the typed
value** for any ⇣ of that type · corner grip widens the form) · `GRAPH` (nested flow graph, RETURN exits back out) · `MACHINE`
(nested machine — opens full-screen like any nested graph; the machine's
EXIT parts appear here as named output ports, every ENTER variable and
📦 asset of every enter door appears here as a ⇣ data input — one complete
list, and every EXIT variable appears here as a ⇡ data output tagged with the
door it leaves through) ·
both canvases also carry `GET GLOBAL` (reads a ⚙ doc-wide variable) and
`SET GLOBAL` (flow passes through as it writes the ⚙ — ⇣ takes the value,
same type as the picked variable).

flow graphs carry the same loop and data parts machines do — `FOR`, `FOREACH`,
`WHILE`, `SWITCH`, `INSPECT` and the **array tools** work identically on a flow
chain, and so do
the math parts (`+ − × ÷ mod`), `AND`/`OR` and `RAND` on every canvas.

machine canvas: `ENTER` (**the machine's door** — always the chain start,
nothing else self-starts · a dynamic list of typed **variables** you set on
the card — every type and its `[]` array form, arrays typed as comma lists —
each publishes ⇡ data inside the machine and grows a matching
⇣ input on the parent's MACHINE node · plus **📦 assets** — `+ asset` picks
any doc asset on the card, and its handle publishes ⇡ inside as the base
type `asset`, likewise growing a ⇣ asset input on the MACHINE node above) ·
`GET GLOBAL` (reads a ⚙ doc-wide variable) · `SET GLOBAL` (writes
one as the chain passes) · `FUNC` (its dropdown picks one **ƒ function** defined on
the DATA tab — the call names an isolated computation whose parts live in the
function's own `func` graph, not here) ·
`IF` (compares ⇣ `a` ⟨sign⟩ ⇣ `b` — `< · <= · == · != · >= · >` — over `int`
or `bool`, both sides alike; an unwired side takes a **custom value** typed on
the card; chain leaves via **true** or **false**, and ⇡ `result:bool`
republishes the verdict) ·
`SWITCH` (⇣ `val:any` picks one flow-out **arm** by equality — `+ case` grows
arms, each naming an arm and typing the value it matches on the card; the first
arm whose match equals `val` fires, **default** out continues when none match;
removing a case prunes the wires on its arm) ·
`FOR` (⇣ `to:int` loads a
count on trigger; one iteration per step once the previous body chain has
ended, ⇡ `i:int` is the current iteration) · `FOREACH` (⇣ any `T[]` array,
from a sys-call output; one iteration per step, ⇡ `item:T` + ⇡ `index:int`;
**end** out continues the chain once the last body chain finishes) ·
`WHILE` (⇣ `cond:bool` re-checked every round — **iter** out runs the body
while it stays true, **end** out continues once it turns false; a cond that
never flips is reported as a runaway at 100 rounds) ·
`SYS CALL` (calls its system fn as the chain
passes · tick **⏳ can block** and it stays *opened* — the chain freezes
until you click it to return) · `INSPECT` (pure data —
no flow ports at all; ⇣ `obj` of any declared type → one ⇡ per field) · `TEXT` ·
**array tools** (pure data, no flow) — `APPEND` (⇣ arr + ⇣ val → ⇡ arr with the
value at the end) · `JOIN` (⇣ a + ⇣ b → one array) · `REMOVE` (drops every
element equal to ⇣ val) · `REMOVE AT` (cuts the element at ⇣ `at:int`) ·
`SORT` (ascending — by a chosen field of struct items, or by value) · they all
learn their item type from the first array wired in; `CLONE` takes any ⇣ value
and ⇡ a deep copy — the copy is what downstream write-backs (e.g. a foreach item) touch,
**never** the base value ·
`TODO` (checklist leaf on **both** canvases — add task lines, tick the
checkboxes, `Enter` adds the next task; drag its corner grip to widen it and
long tasks wrap onto further lines; a silent note that never joins wires or
the chain sim) ·
`EXIT` (the machine ends here; name it — `victory`, `defeat`, `flee` — and the
parent graph's MACHINE node grows a matching output port to continue from ·
it is also the mirror image of `ENTER`: hit **`+ variable`** on the card and it
grows a row of **name · type dropdown (every declared type plus its `[]` array
form) · a ⇣ input port of that type**, so a producer inside the machine wires the
value in and the MACHINE node above grows a matching **⇡ output port**, tagged
`↳ exit-name`, that any part above can read — two exits may announce the same
name and keep their own ports; the sim logs each door's announcements as `⏏
victory — gold: 12 · party: [goblin, orc]`)
.

Chain sim visuals: parts with a chain token in flight glow teal; waiting
parts (⏳ blocked SYS CALL) pulse amber and are clickable.

Array data: give a system fn an output typed `Foo[]` and edit its sim value
as a comma list (`goblin, orc, dragon`) — foreach consumes it and its live
`item` output can feed more ⇣ ports. Struct-typed outputs (`Foe`) grow a
mini-form with one input per declared field — wire that output into an
INSPECT node and it explodes into `⇡ name`, `⇡ hp`, … for each field.

## Systems & data wires

Declare **T**ypes in the **DATA** tab: a name plus the fields it is made
up of (each field picks its type from the same dropdown). Basic types
(`int · float · string · bool · asset`) and their `[]` array versions are always
available — `asset` carries a handle to one of the doc's 📦 assets, what
ENTER doors pass in; declared types join the list — every fn variable type is picked,
never typed. Renaming a type cascades into fn variables and foreach item
types.

Define a ⚙️ **system** asset and give it an API: function names with typed
⇣ inputs and ⇡ outputs. SYS CALL nodes pick a system + fn
and grow typed port squares. Drag ⇡ → ⇣ to wire data; mismatches are refused
with a warning. In machines, typed wires feed values into fn inputs. A sys call is a
black box: while **simulating**, its ⇡ rows become editable so you type the
answer the black box returns (a blocking call stays open until you click it);
typed answers persist across rounds and show as `(your value)` in the sim log.

### Has the producer run? — value wires never race

A wired value only exists once the part publishing it **fired**, so a data
wire also carries an ordering demand, checked against the graph's flow.
`wireRules.valueWireRisks(graph)` answers it once per graph, and both canvases
plus the DRC read the same verdict:

- **computed parts** (`+ − × ÷ mod`, `RAND`, `all/any`, `INSPECT`, `CLONE`, array
  tools) are recomputed the moment they are read — their ⇡ is exactly as
  guaranteed as the wires feeding their own ⇣, so the demand chain is walked
  back through them (`M → ⇡` is only as safe as `SYS CALL → M`)
- **made values** (`VAR`, `GET GLOBAL`, `GET LEDGER`, ENTER-door variables)
  exist from the start of a run — order-free
- **everything else** (`SYS CALL` results, `IF` verdicts, `FOR`/`FOREACH`
  items and indices, nested `MACHINE`/`FUNC` outputs…) fires when a chain
  arrives: its ⇡ is guaranteed at a reader only if it **dominates** it — every
  flow path from an entry (`ENTER` door / the ▶ start) passes through it first

A wire whose demand misses that guarantee is a race: it draws **red** (dashed
red line + red arrowhead) instead of mint, and the ⚑ DRC warns at the reader
naming the part that may not have run. The hover tooltip on the wire says the
same. Nothing is refused — the wiring stays editable, so you see the hazard and
fix it by moving the producer onto the chain. The verdict is static: parts
reachable only through the wire itself are skipped (they never run), and
demand cycles that can never be built are flagged as `cycle`.

## ⌁ Loopdoc files on the web

The bulk of the DATA comes from the web: the ⚙ **settings** dial keeps a list
of **loopdoc files** — one plain **URL row** each, no ids. Every URL holds a
`loopdoc.yaml` (a small indentation dialect: `Name:` · `Types:` · `Ledger:` ·
`Static:`), fetched live when the list changes (per-row status: ✓ ok · ✕ cors /
unreachable · ⌁ cached from localStorage — or ✕ with a registration reason, see
below). **One file = one ⚙ system package**, and the yaml's own **`Name:` IS the
package**: it names the system, is the namespace every web type carries, and is
the `⌁ web` tag — a type `fov` in a file named `camera` is `camera:fov`. Every
type reference splits at the **first `:`**: the left half names a **package**,
the right half the type there (`curio_core:vector3`);
a bare name inside a package resolves to that package's own namespace.
Requirements **resolve on fetch, never by fetching more**: at fetch time every
`pkg:Type` claim is checked against the packages this very fetch registers — it
passes when a registered package has that name **and** declares that type
(basic types like `int` carry no claim). A package whose requirement misses —
or that has no `Name:` while carrying content, or collides with another
fetched file under the same `Name` — refuses to land and its row shows ✕ with
the reason; since one refusal can break another package's requirement,
resolution iterates until stable. **DATA stays application-only**: ⌁ fetched
systems and types never render there — the canvases' pick dropdowns read them
straight from the doc. Fetched items are tagged `⌁ web` — re-fetching replaces
them, deleting a row drops them, and local declarations stay yours. A rename
in the yaml propagates on the next fetch: type names are paired old↔new by
position and cascaded through every VAR card, GET/SET GLOBAL, FOREACH and
function body, and since fetched items keep their slot ids, SYS CALL parts and
📊 ledger picks stay attached and just show the new name.

## Interactions

- both canvases share one look & feel: **orthogonal wires** (90° turns), exit
  ports on the **right edge** of every card, `▶ START` flags where chains
  begin, hover glow on wires, and while dragging a wire every ⇣ port that
  would accept it **pulses** (type-checked live — ifb side rules included)
- dbl-click canvas → drop a STEP · drag ◆ out-port onto a node → flow link
- click link → select (Del removes) · dbl-click link → add anchor · **drag an
  anchor** to bend the run (90° breaks only) · **Ctrl+drag an anchor** splits a
  new branch off that point to another part — the branch shares the wire's run
  up to the anchor, then elbows away (flow *and* data wires, both canvases)
- **dbl-click a GRAPH, MACHINE or FUNC card walks inside it** (the `open →` /
  `▶ enter` buttons still do too); the breadcrumb walks back out
- **box-select**: drag on empty canvas (both canvases) · `Shift`-click or
  box-add to grow a selection · drag one selected node to move the whole group
- `Ctrl+C/X/V` copy/cut/paste (nested graphs & wires included) · `Ctrl+A`
- **space opens the node finder** on both canvases: type to fuzzy-search every
  droppable node/part (labels first, hint prose second, best match on top),
  `↑`/`↓` move the highlight, `Enter` or click drops it at the cursor,
  `Esc` or clicking away closes
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
  pausing at IF; nested graphs run and RETURN pops back
- **⚙ GLOBALS** (DATA tab): document-wide named variables with defaults —
  the **live session state of the game**: machine sims read and write the one
  shared store (SET GLOBAL parts write as the chain passes), so
  exploration's `depth` hands straight through to combat's next run; only
  ↺ defaults / opening a file starts a new session
  (**GET GLOBAL** parts, flow & machine, read; **SET GLOBAL** parts write)
- **ƒ FUNCTIONS** (DATA tab): document-wide **isolated functions** — each one is a
  name, a note and its own `func` body graph holding its parts; a `FUNC` part on
  any machine **or graph** canvas picks one from a dropdown, so shared logic is defined once
  and called everywhere — and every FUNC picking the same definition **shares one
  body**: the parts never live on the call sites, so editing the body from any one
  of them edits all the others
- **func canvases navigate like machines**: `▶ enter` or a dbl-click on a FUNC
  card walks into the function's body — a canvas as close to a machine canvas as
  can be, same toolbar and interactions, minus the ENTER/EXIT buttons: every body
  is **born with a permanent ENTER and EXIT** (left and right, named `enter`/`exit`
  to start) that you can move, rename and give variables to — but never create,
  duplicate, copy, cut or delete (the depth bar bottom-left walks back out, as
  into any nested graph) · the body's ENTER vars grow a ⇣ on every call site, its
  EXIT vars a ⇡, so a function reads typed inputs and announces typed outputs
  wherever it is called · a body may call other FUNC parts — recursion is open —
  but a FUNC can never pick the function you are inside (the dropdown hides it,
  the DRC flags any slip) · func bodies are editing-only for now: no ▶ simulate
  inside one yet — the engine logs the call and passes the chain through
- **⚑ check** opens the design-rule panel — a PCB-style DRC over the open
  graph or the whole doc: dropped-chain wiring (unwired IF operand, empty
  loop body, no entry), last-iteration item reads on end chains, unreachable exits, dangling data wires, value wires reading before their producer can have run (the wires drawn red — "has the producer run?" per `wireRules`), deleted-type drift;
  ✕ errors · ⚠ warnings · ℹ info, click a finding to jump to its graph — the flagged
  part opens selected in the middle of the view — the canvas pans to it, so even
  a part parked far from the last view lands on screen
- **⚿ validate** (in the same menu) bolts whole-doc integrity checks onto that
  panel — the same part id living in two graphs, a graph mounted twice, a part
  chained to a text frame that is gone, a nested graph on a kind that never
  opens one, ƒ bodies no call site reaches: the old floating data an edit can
  leave behind, which otherwise shows as errors whose click leads nowhere;
  clicking a ⚿ finding selects the suspect part
- **✂ clean up** (also in the menu) removes what ⚿ flags as stale — duplicate
  part copies (the first copy wins) with their wires, the second mount of a
  twice-mounted graph, unknown-kind parts, group links chained to a frame that
  is gone — and reports the cut counts on the button; ƒ bodies are never
  removed, so ⚿ keeps listing never-called ones
- **Ctrl+S** save / open `.json` (File System Access API; autosaves to
  localStorage meanwhile)

## Files

```
src/model.js         schema, kind registry, factories, graph ops — single source of truth
src/loopdoc.js       loopdoc.yaml dialect parser + web package builder (⌁ settings list)
src/drc.js           design rule check — pure static analysis over graphs/doc
src/DRCPanel.jsx     docked live DRC results with scope + severity filters
src/NodeCard.jsx     the node renderer shared by both canvases
src/GraphCanvas.jsx  flow canvas: drag/connect/select/paste/data wires
src/MachineCanvas.jsx machine canvas: full-screen editor + chain simulation
src/MachineCanvasLegacy.jsx previous machinations step-tick sim (backup)
src/AssetsPanel.jsx  ASSETS + DATA tabs: asset registry + system API editor
src/Traverse.jsx     flow-graph walkthrough
src/App.jsx          shell: tabs, doc store, save/open, breadcrumbs
src/theme.css        waybar-flavored theme (near-black, magenta, square)
```

> loopdoc-composer reads only composer files (`"app": "loopdoc-composer"`).
> It does not import legacy loopdoc documents — port them by hand (they're small).
