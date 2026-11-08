# Game design brief — Untitled Design

**What this design is.** A roguelike level loop: each round generates a tile map
from a seeded `LevelEngine:Config`, one character walks it by d-pad input, and
walking onto a tile may descend or ascend a floor. Per-round state (map,
position, depth) lives in system ledgers; movement legality is one ƒ (`try_move`)
that every direction check calls.

**How to read the programs.** `slug — KIND "name"` is a part's definition.
Indented `# ⇣ port ← slug.part :type` lines say where that part's inputs get
their values. Indentation is containment: a block belongs to the statement above
it. Nothing is hidden — anything the design leaves open is collected at the foot
in ⚠ Open in this design, one entry per gap.

## Part reference — the only kinds this design uses

| kind | what it does |
|---|---|
| EVENT | fires when flow reaches it — calls system fns, may generate an asset |
| STEP | plain step in the loop — flow passes through |
| ACTION | (not used here) chain waits for a click |
| IF | compares ⇣a ⟨sign⟩ ⇣b — chain leaves via true or false · ⇡ result:bool |
| OR | chain passes through · ⇡ true when any fed ⇣ slot is true |
| SYS CALL | calls its system fn as the chain passes · ⏳ can block |
| MACHINE | nested machine — its EXIT parts become output ports here, its ENTER vars become ⇣ inputs on this card |
| ENTER / EXIT | the machine's doors — ENTER starts chains, EXIT ends one and announces ⇡ values |
| FUNC | calls one isolated ƒ body |
| VAR | makes a typed value — ⇡ publishes it |
| GET LEDGER / SET LEDGER | read / write a system ledger variable |
| INSPECT | pure data — ⇡ one value per field of the wired object's type |
| ADD | ⇡ = ⇣a + ⇣b (int/float) |

## Systems & assets — what the engine hands you

- ⚙️ **LevelData** (system) — ledger state only (no fns listed)
- ⚙️ **LevelEngine** (system) — ⌁ web loopdoc package, named by its yaml
    - fn `tile_type_for_location( map: LevelEngine:Map, location: CurioCore:Vector2 ) ⇡ tile_type:int`
    - fn `generate_level_data( min_map_size: Vector2, max_map_size: Vector2, min_room_size: Vector2, max_room_size: Vector2, num_rooms: Vector2 ) ⇡ map: LevelEngine:Map`
- ⚙️ **CurioCore** (system) — provides the vector types below
- ⚙️ **CharacterEngine** (system) — no fns used yet
- ⚙️ **InputEngine** (system) — provides the `Input` record below

## Data types — grouped by the system that owns them

**LevelEngine**
- `LevelEngine:Map { tiles: LevelEngine:Tile[], width: int, height: int }`
- `LevelEngine:Tile { tile_type: int }`
- `LevelEngine:Config { tile_type: int, num_rooms: int, min_width: int, max_width: int, min_height: int, max_height: int, min_room_size: int, max_room_size: int, seed: int }`

**CurioCore**
- `CurioCore:Vector2 { x: float, y: float }` (Vector3 and Vector4 also exist, unused here)

**InputEngine**
- `InputEngine:Input { up_is_down: bool, right_is_down: bool, down_is_down: bool, left_is_down: bool }`

## Shared state

- ⚙ global `newVar:int = (unset)` — nothing reads or writes it yet
- ledger `LevelData` / `LevelEngine` variables carried through the graphs:
  `position: CurioCore:Vector2`, `map: LevelEngine:Map`, `depth: int`, `input: InputEngine:Input`

## Defined functions

### ƒ `try_move` — 11 parts
signature: `enter delta:CurioCore:Vector2, tile:CurioCore:Vector2, map:LevelEngine:Map, have_moved:bool`
→ returns `new_pos:CurioCore:Vector2 · did_move:bool · did_descend:bool · did_ascend:bool`

    enter — ENTER "enter"
    if (tile_type_for_location(map ← enter.map, location ← var.value).tile_type:int != ⇣b):  # if
      if (… == ⇣b):                                                              # if_9
        exit — EXIT "exit": announces new_pos · did_move ← if.result · did_descend ← if_9.result · did_ascend ← if_10.result
      else:
        if (… == ⇣b):                                                            # if_10
          → goto exit   ⚠ the ascend branch re-enters the door already written above
    else:
      ⚠ false unwired — the chain stops when the test fails

values feeding it (pure data, no chain of their own):
- `var` makes `value:CurioCore:Vector2 = { x: 0, y: 0 }` ← `add.result` for x, `add_3.result` for y
- `add` = `inspect.x:float + inspect_2.x:float`; `add_3` = the same on `.y`
- `inspect`, `inspect_2` — read `x:float, y:float` off the delta/tile inputs

## Graphs

### Flow Graph "Main Loop" — one round of the game

    event: calls LevelEngine.generate_level_data()      # the round begins: build a map
    setledger                                           # write it into the ledger
    step (note: "display tiles based on the map.")      # ⇣ map ← getledger_3.map:LevelEngine:Map
    mach — MACHINE "machine": 27 parts, section below   # ⇣ location ← getledger_2.position:Vector2
                                                        # ⇣ map ← getledger_3.map:Map
                                                        # ⇣ input ← getledger_5.input:Input
    add: ⇡ = ⇣a + ⇣b   (⇣b ← getledger_4.depth:int)     # depth + 1 …
    setledger_2: depth ← add.result                     # … written
    step_2 (note: "unload all map asset")
    goto event  ⚠ cycle back to the top of the round

    # this door's out port carries three chains; the two beyond the first are siblings:
    sibling chain 1:  add_2 (⇣b ← getledger_4.depth) → setledger_3 (depth ← add_2.result) → goto step_2
    sibling chain 2:  setledger_4 (position ← mach.xv_mw6q3vth_1_aawv7) → goto mach

pure-data parts beside the round:
- `var  {50,50} · var_2 {200,200} · var_3 {10,10} · var_4 {20,20} · var_5 {3,6}` : CurioCore:Vector2
  (these are the `generate_level_data` size/room arguments — wired at the EVENT card)
- `getledger`, `getledger_2` (position), `getledger_3` (map), `getledger_4` (depth), `getledger_5` (input)

#### Machine "machine" — inside the main loop: read input, pick a direction

The door forks into four sibling chains — one per d-pad direction:

    enter — ENTER "enter": location:Vector2 · map:LevelEngine:Map · input:InputEngine:Input
    inspect — ⇡ up_is_down:bool · right_is_down:bool · down_is_down:bool · left_is_down:bool  (⇣ obj ← enter.input)

    chain 1 (right): if (inspect.right_is_down:bool == ⇣b):  # if     → ⚠ true unwired, false unwired
    chain 2 (up):    if (inspect.up_is_down:bool == ⇣b):     # if_2
      or_4 (⇣slot 1 ← if_2.result:bool)
      or_5
    chain 3 (down):  if (inspect.down_is_down:bool == ⇣b):   # mach_if → ⚠ both arms unwired
    chain 4 (left):  if (inspect.left_is_down:bool == ⇣b):   # if_3   → ⚠ both arms unwired

nothing currently routes to this machine's EXIT doors (see ⚠ below), so the
movement result — `try_move`'s `did_move / did_descend / did_ascend` — has
nowhere to go yet. The parts staged for that job are all present but unchained:
`fn`, `mach_fn`, `fn_2`, `fn_3` (ƒ try_move calls), `or_2`, `or_3`,
`if_4…if_8`, `exit_descend`, `exit_ascend`, `exit_continue`,
`exit_descend_2`, `exit_ascend_2`, `exit_continue_2`.

## ⚠ Open in this design — the gaps, grouped

**EXIT doors nothing reaches** (the machine announces outputs no chain can leave through):
- `exit_descend`, `exit_ascend`, `exit_continue` (announces `location:Vector2`),
  `exit_descend_2`, `exit_ascend_2`, `exit_continue_2` (announces `location:Vector2`)

**Parts staged but never chained in** (they would be flow parts if wired):
- ƒ calls: `fn`, `mach_fn`, `fn_2`, `fn_3` — all `try_move`
- bool combiners: `or_2`, `or_3` · comparisons: `if_4`, `if_5`, `if_6`, `if_7`, `if_8`

**Unwired branches** — a chain that stops where it should not:
- `if` / `if_2` / `mach_if` / `if_3` (the four direction tests): true and false arms both unwired
- `if_9`, `if_10` (inside ƒ try_move): false arm unwired

**Cycles written as goto** — the design loops, the lowering cannot say "repeat":
- Main Loop: `goto event` (round start), `goto step_2` (sibling chain 1), `goto mach` (sibling chain 2)
- ƒ try_move: `goto exit` from `if_10`

**Raw ids in a wire line** — a producer ⇡ port with no name:
- `setledger_4` reads `mach.xv_mw6q3vth_1_aawv7` — the MACHINE's ⇡ output port that
  carries `position` is an unnamed EXIT var; name it and this reads `mach.position`.

**Name mismatches** — worth fixing in the editor:
- the ƒ is listed as `try_move` but its body graph is named `newFn`
- the global `newVar:int` is never read or written

## Curio mapping — cheatsheet: graph part → engine feature

Handles in the brief are slugs; each one becomes the Rust name below it.

- FLOW graph (the Main Loop) → the game loop itself: one `#[habit]` whose `Scope.is_enabled` is the
  "keep playing" test; its chain, written in order, is that habit's `tick()`. Use `enable()`/`disable()`
  for the game's start and teardown.
- MACHINE part / nested machine → a `#[habit]` (recurring, runs every frame while its Scope is
  enabled) for loops, or a `#[impulse(MyStimulant)]` (one-shot, reacts to an event) for behaviour
  that only runs when something announces it. Habits and impulses self-register by macro;
  `Scope.run_on_instance() → NetworkModes::all()` picks which multiplayer instances run it.
- chain hop A → B → `nerve.enqueue_event(MyStimulant::B)`: stimulants are drained at the START of the
  next frame, and a stimulant that sends another keeps chaining before the Tick phase resumes.
- ENTER door + ⇣ vars → the habit's/impulse's inputs: fields of a `#[record(ownership = RecordScope::Instance)]`
  written with `ledger.write::<T>(|rec| …)` before the enqueue, a facet field, or plain fn parameters.
- named EXIT (its ⇡ announce vars) → one variant of the `#[stimulant]` enum, plus the records that carry
  its values. "kills the token" = `form.destroy()` or stop the habit's Scope.
- EXIT REF → enqueue the variant that named EXIT already owns — never mint a second event for it.
- ⚙ GLOBALS → `#[record]` structs made once at `Curio::create()` (records are edited, never added):
  read with `ledger.read::<T>()` (a read-only `Rc<T>`). Built-ins are yours for free: `SysRecordTime`
  (`ledger.time().scaled_delta_time / scaled_time`), `SysRecordInput`, `SysRecordCamera`, `SysRecordScreen`.
- DATA TYPE (`LevelEngine:Map { tiles: Tile[], width: int, height: int }`) → a `#[facet]` struct +
  `FieldOverride::apply`/`get_state` when a `.comp` composition must edit it; a plain struct or record
  field set when only code touches it. `Vector2 → Vector2`, `int → i32`, `float → f32`, `bool → bool`,
  `Tile[] → Vec<Form>` or an ECS query.
- VAR → `context.spawner("…").position(…).facet(Facet::builder()….build()).spawn()`; hold the Form on
  the habit struct, `destroy()` it in `disable()`. A VAR of ⚙/record fields is a write.
- GET LEDGER / SET LEDGER (this design's whole shared-state idiom) → ledger records:
  `ledger.read::<LevelMapRecord>()` and `ledger.write::<DepthRecord>(|rec| …)`.
- MACHINE ⇣/⇡ wires at a call site, and every `# ⇣ port ← slug.part :type` line, are value hand-offs:
  read the producer's record/facet, then write it in or pass it — the ← side names exactly which part.
- ACTION (chain waits for a click) → `ledger.read::<SysRecordInput>()`; `raw.get_button(&ButtonCode::KeyW).is_down`
  for physical keys, or map logical names once in `InputMapping::new(…)` and read
  `mapped[seat].get_button_or_default("paddle_up")` — the seat index is the multiplayer player.
- CHOICE options → each option is an input-mapped button that gates which stimulant gets enqueued;
  an unwired option means nothing gets enqueued, so the game waits — which is what the brief says.
- condition / IF / for / foreach / goto → plain Rust `if` / `match` / `for` / `while` in the habit or
  impulse body; foreach over an array of Forms = `context.edit::<(&mut Transform3D, &Tile)>(|q| for (t, f) in q { … })`.
- ƒ function / nested GRAPH section → a plain Rust fn (`try_move`'s ENTER vars = parameters, its EXIT
  vars = the return), or a separate `#[habit]` whose `Scope.is_enabled` is the condition under which it
  runs every frame.
- ASSETS (⚙️ LevelEngine, ⌁ web loopdoc packages) → `asset.manifest` entries with a unique i16 id and
  type `Embedded|Local|Remote`; `Assets::append_listing_group(generated_assets())` at startup, then
  `Assets::load_asset::<ModelAsset>(&2665)` at the use site, or `Assets::try_lookup_key_for_name("…")`.
  `build.rs` fails on a missing/empty or duplicated id/uri — ids in the brief must stay distinct.
- system fn call (`LevelEngine.generate_level_data()`, `roster.foes()`) → an ECS query over the context,
  not a lookup table; user fns are facets.
- TEXT frame / TODO part → a comment and a `// todo` in the generated code: they carry intent, not logic.
- ⚠ lines (goto, parallel chain, unwired branch, deleted part) → the design left this open: state the
  choice you made in a comment, and never invent an engine call the brief did not name.

Startup shape: `Curio::create().identity(…).plugin(SystemComponentDefaultTime/Graphics/Input/
Networking/Gameplay::<MyStimulant, MyUIEvent>::new()).formation(Formation::template_local_single(…)).imbue()`,
with `#[curio_entry]` on the fn that returns it — every habit, impulse, facet and record is macro-registered,
so wiring the brief means declaring the parts, not hand-hooking them.

(end of brief — lossless source of this design is the .json export of the same document.)
