# loopdoc.yaml — what goes in the file, and how to build one

A **loopdoc.yaml** is the header file for an external package: one yaml file =
one ⚙ **system package** on the web. The composer never imports these as
documents — it *fetches* them from the ⌁ settings list, parses the dialect
(`src/loopdoc.js`), and lands each one as a **⌁ web-tagged system asset** plus
its **namespaced types**, which the canvases' pick dropdowns read straight from
the doc.

Author it like a small, plain contract: **a name, some types, a ledger, an API**.

---

## What goes in the file

Five sections, in this dialect. Everything else is either ignored (legacy) or
reported as a warning.

| Section | What goes in | What it becomes |
| ------- | ------------ | --------------- |
| `Name:` | one plain value — the package identity | names the ⚙ system **and** is the namespace every web type carries (`camera:fov`) |
| `Types:` | declared types, each a list of `{field, type}` pairs | doc types named `Name:Type`, tagged ⌁ web |
| `Ledger:` | entries, each a list of `{field, type}` pairs | the system's 📊 ledger variables (entries **flatten** — variable names come from `field:`, entries only group) |
| `Static:` (or `Statics:`) | the API: one function `{name, inputs[], outputs[]}`, or a list of them | the system asset's `api` fns; `SYS CALL` / `EVENT` parts pick them and grow typed ⇣/⇡ ports |
| `Requires:` | legacy container | accepted silently, ignored — real requirements ride **inline** on field types |

The minimal legal package is one type and a name:

```yaml
Name: "camera"
Types:
    fov:
        - field: "deg"
          type: "float"
```

Rules the registration enforces (each one shows up as `✕ <reason>` on its
settings row):

- **content requires a `Name:`** — a file with types/ledger/statics but no name
  refuses: `no Name: section — a package with content must name itself`
- **one name, one package** — two fetched files claiming the same `Name:` *both*
  refuse: `two fetched files claim the name "X" — both refuse to register`
- **every `pkg:Type` claim must land** — a package registers only when some
  *fetched* package named `pkg` declares type `Type` exactly; otherwise:
  `requirement pkg:Type is not registered — no fetched package "pkg" declares type "Type"`
- **refusals cascade** — a package that dies can break whoever depended on it;
  resolution iterates until stable, so a whole dependency chain can go out
  together
- an **empty file** (no sections) is fine and contributes nothing; a **failed
  fetch** never registers anything (the row keeps its `✕ cors / unreachable`)

---

## The dialect itself

The parser (`src/loopdoc.js`) is a small indentation dialect, not full YAML.
Stay inside these rules and any YAML-looking file parses identically:

- every meaningful line is **`key: value`** — split at the **first colon**; a
  line that doesn't match is skipped with `expected "key: value" — skipped`
  (e.g. writing `Name pkg` instead of `Name: pkg`)
- **nesting is indentation**: children are simply the lines indented deeper than
  their parent; any consistent step works, tabs count as 4 spaces
- a leading **`- `** (or bare `-`) marks a list item; a dashed item collects its
  inline pair *plus* any deeper keys into one map — `- field: "x"` with
  `type: "y"` under it reads as `{field:'x', type:'y'}`
- **`#` outside quotes is a comment**; inside quotes it survives
- values may be **quoted** (`"…"` or `'…'`) and the quotes are unwrapped — a
  trailing quote mismatch keeps the quotes; quoting is optional, but keep
  comments after values on the quoted side
- **keys never contain colons** — put colons in the value
- unknown top-level sections are ignored with `unknown section "X" — ignored`
- empty sections `Ledger: []` contribute nothing (no phantom rows)
- both shapes of `Types:` / `Ledger:` work — map-listed (`myType:` then dashed
  fields) and dash-listed (`- myType:` then deeper fields); pick one and keep it

## Types and namespaces

- basic types are **`int · float · string · bool · asset`** (plus `asset`, the
  handle to a 📦 doc asset) and always their `[]` array forms (`int[]`, `Foe[]`)
- a **bare name** that is not a basic type resolves to **this package's own
  namespace**: `Foe` inside package `core` is `core:Foe`. So a bare reference to
  a type the package *doesn't* declare is a dangling local claim and **fails the
  whole package**
- a **qualified name** `pkg:Type` splits at the **first `:`** — left half names a
  package, right half the type there; already-qualified names pass through
  unchanged; the `[]` suffix always stays attached
- references **never fetch**: at fetch time every claim is checked against only
  the packages this very fetch registers — you cannot depend on something the
  user hasn't also put in a settings row
- requirement matching is **exact** (case-sensitive on both package and type
  names) — spell `core:Vector3` with exactly the declared spelling, even though
  wire typing elsewhere compares types case-insensitively

---

## How to build one

1. **Name the package.** `Name:` is the whole identity — system name, namespace,
   ⌁ web tag. Pick something distinctive and never reused (`curio_core`,
   `camera`); a rename propagates on the next fetch, so keep the *position* of
   declarations stable when you rename.
2. **Declare the types bottom-up.** Fields pick basic types, `[]` forms, bare
   local names, or `otherpkg:Type` references. Order inside the file doesn't
   matter — a package's whole declared set counts.
3. **State cross-package needs inline.** Want a type from elsewhere? Write
   `type: "camera:fov"` — that *is* the requirement; no `Requires:` list exists.
   It passes only if a fetched package named `camera` declares `fov`.
4. **Give the system its API** under `Static:` — one `name:` + `inputs:` +
   `outputs:` per function (or a dashed list of several). Ports are typed;
   `SYS CALL` parts and `EVENT` parts grow them.
5. **Add 📊 ledger variables** under `Ledger:` if the system keeps state — one
   or more `entry:` groups of `{field, type}` pairs; they flatten into named,
   typed ledger vars.
6. **Host it where the browser can fetch it.** The row must answer plain text
   with CORS. GitHub works: `https://github.com/<user>/<repo>/blob/<ref>/<path>`
   is rewritten automatically to `raw.githubusercontent.com` (the CORS-enabled
   raw host) — paste either form; any other host must send
   `Access-Control-Allow-Origin: *`.
7. **Register it.** Add the URL as a row in the ⌁ **loopdoc files** list in the
   ⚙ settings dial (rows hold only URLs — ids are the yaml's `Name:`). The list
   re-fetches when it changes; check the row status: **✓ ok** · **✕ cors /
   unreachable** · **⌁ cached** from localStorage · **✕ + registration reason**.
   Hit the ⌁ button to force a fresh fetch past caches.
8. **Use it in the doc.** `SYS CALL`/`EVENT` pick the system + fn; `VAR`,
   `ENTER`, `EXIT`, `GET/SET GLOBAL` and function bodies pick `pkg:Type` in
   dropdowns; FOREACH items get item types from array outputs. Fetched items
   never render in the DATA tab — application DATA stays yours.
9. **Iterate by renaming.** Type/fn/ledger ids are *slot-based* (`web~pkg~t0`,
   `fn0`, `led0`), so a rename in the yaml keeps every `SYS CALL` part and 📊
   ledger pick attached and just shows the new name; type renames pair old↔new
   **by position** and cascade into every VAR card, GLOBAL, FOREACH and fn body
   on the next fetch.

To sanity-check a file before hosting it, parse it with the project itself —
either read it against `examples/loopdoc.yaml`, or run the dialect tests
(`npm test`) and extend `tests/loopdoc.test.mjs` with your own file:

```js
const pkg = parseLoopDoc(myYaml)
assert.ok(pkg.ok, 'parses without warnings')
const rows = registerPackages([{ key: 0, pkg }, { key: 1, pkg: providerPkg }])
```

---

## Worked example — two packages, one requirement

`camera.yaml` (the provider — fetched first on the same list):

```yaml
Name: "camera"
Types:
    fov:
        - field: "deg"
          type: "float"
Ledger: []
Static: []
```

`core.yaml` (depends on `camera`):

```yaml
Name: "core"
Types:
    vector3:
        - field: "x"
          type: "float"
        - field: "y"
          type: "float"
        - field: "z"
          type: "float"
    pose:
        - field: "pos"
          type: "vector3"          # bare → resolves to core:vector3, declared here
        - field: "angle"
          type: "camera:fov"       # requirement — camera must be fetched too, declaring fov
Ledger:
    session:
        - field: "depth"
          type: "int"
Static:
    - name: "traceRay"
      inputs:
          - field: "origin"
            type: "vector3"
          - field: "dir"
            type: "vector3"
      outputs:
          - field: "hit"
            type: "bool"
          - field: "distance"
            type: "float"
    - name: "pan"
      inputs:
          - field: "amount"
            type: "camera:fov"
      outputs: []
```

Landed, this contributes: system asset **`core`** with api fns `traceRay`/`pan`
and ledger vars `depth:int`, plus doc types `core:vector3`, `core:pose` — and
remove `camera.yaml` from the list and `core` refuses to register with
`requirement camera:fov is not registered`.

## Pitfalls

- `Name pkg` (no colon) → malformed line, whole package may come out unnamed
- two rows fetching files that both say `Name: "core"` → **both** disappear;
  fix the name, not the row
- a bare field type like `pose2` that the package never declares → the package
  kills itself (`requirement core:pose2 …`) — declare it or qualify it
- forgetting `[]` on an array port is a different type (`Foe` ≠ `Foe[]`)
- keep section names exactly `Name · Types · Ledger · Static · Statics ·
  Requires` — anything else is warned and ignored, so a typo'd section drops
  silently
- re-fetch **replaces** web items; deleting a row **drops** them — anything the
  doc wired to them shows drift, which the ⚑ DRC reports; local declarations
  are never touched
