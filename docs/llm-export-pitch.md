# Pitch: lower the graphs to pseudocode — stop exporting adjacency lists

**Thesis.** The current brief (`src/llmExport.js`) writes each graph as an
*adjacency list*: one line per part, indented arrow lines for its out-wires.
That is a good artifact for a *reader who can see the canvas* — it mirrors the
drawing. It is a bad artifact for an LLM *building the game from it*, because
every LLM must first re-run the graph traversal in its head. The better export
is a deterministic **lowering**: turn each graph into an indented, ordered
pseudo-program — loops become blocks, branches become `if/else`, machines
become functions with typed parameters — and keep the un-lowerable residue
explicit as `goto` lines.

## Why the current format taxes an LLM (with evidence from a real export)

Actual current output, machine "combat":

```
  - FOREACH: iterates ⇣ arr one at a time — ⇡ item (Foe) · ⇡ idx; iter = body, end = after
      iter→ ACTION "spend"
  - ACTION "spend": chain waits here for a click
      → EXIT "victory"
```

1. **Control flow is implicit; structure must be reconstructed.** Where does the
   loop body end, and where does control continue after the loop? The reader
   must trace `iter→` to `ACTION "spend"`, then its `→` to `EXIT`, and infer
   that the `end` port is unwired. That is exactly the multi-hop indirect
   reference pattern LLMs fail most often: chains of "the X on line 4 points to
   the Y on line 11". In pseudocode the answer is indentation — one hop, local.

2. **A notation the model has never seen.** `⇣ ⇡ → ⚙ 🎨 ✨ ⚠ ƒ` are rare,
   near-singleton tokens with no pretrained semantics. The whole header
   paragraph exists to teach this invented notation — a legend consumed once,
   never re-anchored deep in a long document. Code-like notation (`for`, `if`,
   `return`, indentation) is the *most* represented structure in any LLM's
   training data; it inherits its meaning from the weights instead of from
   a legend.

3. **Names are the only handles, and they repeat.** `KIND "name"` labels collide
   across graphs (two machines can each hold `ACTION "gold"`), and unnamed
   repeats become `ACTION#2` — a brittle indirection. Stable, unique, lowercase
   slugs (`foe_hero`, `mach_combat`) are cheap for a model to bind and compare.

4. **Data wires are split from their consumers across distant lines.**
   `⇣ lives ← VAR "hero".hero :Foe` attached under the MACHINE line means the
   binding lives anywhere in the list. In pseudocode, data flow *is scope*:
   `machine combat(hero)` at the call site, `combat(lives:Foe)` at the
   definition. Same information, zero searching, and it types-check in place.

5. **Node order is insertion order.** The model must learn execution order from
   arrows; a lowered program states order by construction.

## The proposed shape (same fixture, rewritten)

```
## Flow: Main Loop — runs top to bottom, one token

step start
foe hero = { hp: 3, pos: { x: 1, y: 2 } }
run machine "combat" feeding lives ← hero            # combat gets the Foe
if lives < 2:                                        # IF "rest?" — test: lives < 2
    step rest                                        # true branch
else:
    step fight on                                    # false branch

## Machine: combat — one chain, ENTER door starts it
combat(lives = 3; carries 📦 sprites):
    action gold — wait for click
    for item:Foe in arr:                             # FOREACH
        action spend — wait for click
    exit "victory" → return                          # kills the token
    # TODO "balance": [x] tune gold · [ ] boss drop
```

Rules that produce it, mechanically, in `graphSection`:

- Walk from `entry`/ENTER doors, following flow links; a unique successor
  becomes the next statement (indentation = containment).
- `condition`/`ifb` → `if/else` blocks from their `true`/`false` ports.
- `for`/`foreach` → loop header from `⇣` inputs; **body = iter chain**, closed
  with `end:` (or "continues at X"). The extent of a loop is now stated, not
  traceable.
- `choice` → `match: / case "option A":` per exit port.
- `machine`/nested `graph` → indented sub-program; its ENTER vars become
  typed parameters, its EXIT parts become `return`s, and the *data wires into
  the node become literal call-site arguments* — the wire edge disappears as
  an edge because scoping absorbs it.
- Anything that won't lower (multiple chains from one part, cycles,
  wires to deleted nodes) prints explicitly: `chain B starts here (in
  parallel)` / `goto STEP "rest"` / `⚠ wire to missing part`. Nothing is ever
  silently dropped — the residue list *is* the losslessness check.

The `## Part reference` and `## Data types` sections stay (they're already
vocabulary teaching); the notation legend in the header shrinks to one line
because the notation is now conventional.

## Why this is strictly better for the build task, not just prettier

- **The brief becomes executable-adjacent.** The LLM's job is "write the game".
  A pseudocode block is one edit away from a real function; an adjacency list
  is one mental graph-traversal away from a real function. We export toward the
  consumer's output distribution, not toward the canvas.
- **Locality.** Structure is carried by containment, so every fact a model
  needs to write a loop sits within a few lines of it. Attention no longer
  has to bridge 30 lines of arrow-chasing.
- **Auditable.** Lowering is total: `nodes = statements + residue heads`,
  `flow links = statement adjacency + gotos`. That gives a cheap property test
  (count coverage per graph) replacing brittle string-fragment assertions, and
  makes "did I read the brief faithfully?" answerable without re-reading it.
- **Keeps what already works.** Names, notes, todos, type expansions,
  per-kind detail text — all of `detail()` survives as trailing comments
  (`# note:`), so the human-scannable reading stays in the artifact.

## Cost

~100 lines in `src/llmExport.js`: a `lower(g)` walk replacing the flat list
emit inside `graphSection`; `detail()`, labels, and every other section stay
untouched. Ships in the same single-pass architecture. If we want both worlds,
emit the program first and keep the current flat list as an appendix "wiring
dump" — models read the program, auditors diff the dump.
