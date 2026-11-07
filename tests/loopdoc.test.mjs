// loopdoc.yaml — the web dialect that feeds the DATA registries: parse the
// user's reference file, namespace its types, flatten ledger, map Statics
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLoopDoc, resolveType, buildPackage, registerPackages, corsUrl } from '../src/loopdoc.js'

const EXAMPLE = `
Name: "myCustomPackage"
Types:
    myCustomType:
        - field: "myNum"
          type: "int" 
    myCustomTypeWithRequirement1:
        - field: "fov"
          type: "camera:fov" 
    myCustomTypeWithRequirement2:
        - field: "vec"
          type: "core:Vector3" 

Ledger: 
    entry1:
        - field: "ledger_val1"
          type: "int" 
    entry2:
        - field: "val1"
          type: "string[]" 
        - field: "val2"
          type: "string[]" 

Static: 
    name: "my_static_fn"
    inputs:
        - field: "input_a"
          type: "int" 
        - field: "input_b"
          type: "core:Vector3[]" 
    outputs:
        - field: "output_a"
          type: "string" 
        - field: "output_b"
          type: "int[]" 
`

test('the reference file parses whole', () => {
  const pkg = parseLoopDoc(EXAMPLE)
  assert.equal(pkg.ok, true, 'the dialect parses without warnings')
  assert.equal(pkg.name, 'myCustomPackage', 'Name: names the package')
  assert.equal(pkg.types.length, 3, 'three declared types')
  assert.equal(pkg.types[0].name, 'myCustomType', 'types are keyed by name')
  assert.deepEqual(pkg.types[0].fields, [{ field: 'myNum', type: 'int' }], 'fields carry field + type')
  assert.deepEqual(pkg.types[1].fields, [{ field: 'fov', type: 'camera:fov' }], 'a cross-package reference survives')
  assert.deepEqual(pkg.types[2].fields, [{ field: 'vec', type: 'core:Vector3' }], 'and so does another')
  assert.equal(pkg.ledger.length, 2, 'two ledger entries')
  assert.deepEqual(pkg.ledger[1].fields, [{ field: 'val1', type: 'string[]' }, { field: 'val2', type: 'string[]' }], 'an entry can hold several fields')
  assert.equal(pkg.statics.length, 1, 'one Static function')
  assert.equal(pkg.statics[0].name, 'my_static_fn', 'named')
  assert.deepEqual(pkg.statics[0].inputs.map((v) => v.field), ['input_a', 'input_b'], 'typed inputs')
  assert.deepEqual(pkg.statics[0].outputs.map((v) => v.field), ['output_a', 'output_b'], 'typed outputs')
})

test('type references split at the first colon and keep the array suffix', () => {
  assert.equal(resolveType('int', 'core'), 'int', 'basic types pass through')
  assert.equal(resolveType('string[]', 'core'), 'string[]', 'basic arrays pass through')
  assert.equal(resolveType('Foe', 'core'), 'core:Foe', 'bare names join the package namespace')
  assert.equal(resolveType('core:Vector3', 'core'), 'core:Vector3', 'already-qualified names pass through')
  assert.equal(resolveType('core:Vector3[]', 'core'), 'core:Vector3[]', 'array suffix is kept')
  assert.equal(resolveType('Vector3[]', 'gfx'), 'gfx:Vector3[]', 'bare arrays join the namespace')
})

test('one package becomes qualified types plus one web-tagged ⚙ system', () => {
  const pkg = parseLoopDoc(EXAMPLE)
  const built = buildPackage('custom', pkg)
  assert.equal(built.types.length, 3, 'every declared type joins the doc')
  assert.equal(built.types[0].name, 'custom:myCustomType', 'web types carry a qualified pkg:Name')
  assert.equal(built.types[0].web, 'custom', 'web items are tagged with their settings id')
  assert.equal(built.types[0].fields[0].typeId, 'int', 'basic field types stay plain')
  assert.equal(built.types[1].fields[0].typeId, 'camera:fov', 'cross-package references stay qualified')
  assert.equal(built.types[0].id, 'web~custom~t0', 'item ids are slot-based — renaming a type keeps its id, so call sites and ledger picks stay attached')
  assert.equal(built.asset.api[0].id, 'web~custom~fn0', 'api fns are slot-based too')
  assert.equal(built.asset.id, 'web~custom', 'the system asset is addressable by its settings id')
  assert.equal(built.asset.kind, 'system', 'one file is one ⚙ system')
  assert.equal(built.asset.name, 'myCustomPackage', 'Name: names the system')
  assert.equal(built.asset.web, 'custom', 'the asset is web-tagged so re-fetches replace it')
  assert.equal(built.asset.api.length, 1, 'Static functions become api fns')
  assert.equal(built.asset.api[0].name, 'my_static_fn', 'named api fns')
  assert.deepEqual(
    built.asset.api[0].inputs.map((v) => v.type),
    ['int', 'core:Vector3[]'],
    'fn inputs resolve through the namespace (array suffix kept)',
  )
  assert.deepEqual(
    built.asset.api[0].outputs.map((v) => v.type),
    ['string', 'int[]'],
    'fn outputs likewise',
  )
  assert.equal(built.asset.ledger.length, 3, 'ledger entries flatten into named typed ledger vars')
  assert.deepEqual(built.asset.ledger.map((v) => `${v.name}:${v.type}`), ['ledger_val1:int', 'val1:string[]', 'val2:string[]'], 'flattened ledger vars keep their resolved types')
})

test('a rough file still parses and reports what went wrong', () => {
  const pkg = parseLoopDoc('Name pkg\nTypes:\n  A:\n    - field: "x"\n      type: "int"\nNope:\n  x: 1\n')
  assert.equal(pkg.ok, false, 'the warnings gate ok')
  assert.equal(pkg.types.length, 1, 'the good section still parsed')
  assert.ok(pkg.warnings.some((w) => w.includes('key: value')), 'a malformed line is reported')
  assert.ok(pkg.warnings.some((w) => w.includes('Nope')), 'an unknown section is reported and ignored')
})

test('a malformed dialect does not crash the parser', () => {
  const pkg = parseLoopDoc('')
  assert.equal(pkg.types.length, 0, 'an empty file contributes nothing')
  assert.equal(pkg.name, '', 'no name')
  assert.equal(pkg.ok, true, 'an empty file is not an error')
})

test('Static: also accepts a list form for several functions', () => {
  const pkg = parseLoopDoc('Name: "multi"\nStatic:\n    - name: "a_fn"\n      inputs:\n          - field: "x"\n            type: "int"\n      outputs: []\n    - name: "b_fn"\n      inputs: []\n      outputs: []\n')
  const built = buildPackage('multi', pkg)
  assert.equal(built.asset.api.length, 2, 'both functions join the api')
  assert.deepEqual(built.asset.api.map((f) => f.name), ['a_fn', 'b_fn'], 'in order')
})

test('real-world files: dash-listed types, empty [] sections, extra keys', () => {
  const pkg = parseLoopDoc(`
Name: "curio_core"
Requires: []
Types:
    - vector2:
        - field: "x"
          type: "float" 
        - field: "y"
          type: "float" 
    - vector3:
        - field: "x"
          type: "float" 
Ledger: []
Static: []
`)
  assert.equal(pkg.name, 'curio_core', 'the package is named')
  assert.equal(pkg.types.length, 2, 'dash-listed Types parse like map-listed ones')
  assert.deepEqual(pkg.types[0].fields, [{ field: 'x', type: 'float' }, { field: 'y', type: 'float' }], 'fields parse')
  assert.deepEqual(pkg.ledger, [], 'Ledger: [] contributes nothing')
  assert.deepEqual(pkg.statics, [], 'Static: [] contributes no phantom function')
  assert.ok(!pkg.warnings.some((w) => w.includes('Requires')), 'Requires: is a known legacy section — silently accepted')
  const built = buildPackage('curio', pkg)
  assert.equal(built.types[0].name, 'curio:vector2', 'types still join the qualified namespace')
  assert.deepEqual(built.asset.api, [], 'no api fns')
  assert.deepEqual(built.asset.ledger, [], 'no ledger vars')
})

test('registration names packages by their yaml Name, not by any row id', () => {
  const built = buildPackage(parseLoopDoc(EXAMPLE).name, parseLoopDoc(EXAMPLE))
  assert.equal(built.asset.name, 'myCustomPackage', 'the system is named by Name:')
  assert.equal(built.types[0].web, 'myCustomPackage', 'web items are tagged with the yaml Name')
  assert.equal(built.types[0].id, 'web~myCustomPackage~t0', 'slot ids carry the Name too — rows hold only urls')
})

test('requirements resolve against the fetched set — no recursive fetching', () => {
  const cam = parseLoopDoc('Name: "camera"\nTypes:\n    fov:\n        - field: "deg"\n          type: "float"\n')
  const core = parseLoopDoc('Name: "core"\nTypes:\n    pose:\n        - field: "angle"\n          type: "camera:fov"\n')
  const rows = registerPackages([{ key: 0, pkg: cam }, { key: 1, pkg: core }])
  assert.equal(rows.length, 2, 'both rows reported')
  assert.ok(rows.every((x) => x.ok), 'camera declares fov, so core\'s camera:fov requirement is satisfied at fetch time')
  const byKey = Object.fromEntries(rows.map((x) => [x.key, x]))
  assert.equal(byKey[1].built.asset.name, 'core', 'the package is named by its yaml')
  assert.equal(byKey[1].built.types[0].name, 'core:pose', 'types qualified with the yaml Name')
})

test('an unsatisfied requirement refuses the row outright', () => {
  const bad = parseLoopDoc('Name: "bad"\nTypes:\n    thing:\n        - field: "v"\n          type: "nope:Vector9"\n')
  const rows = registerPackages([{ key: 0, pkg: bad }])
  assert.equal(rows[0].ok, false, 'the package does not register at all')
  assert.ok(rows[0].msg.includes('nope:Vector9'), 'the row status names the missing requirement')
})

test('a refused package cascades to whoever depended on it', () => {
  const wants = parseLoopDoc('Name: "wants"\nTypes:\n    a:\n        - field: "m"\n          type: "mid:thing"\n')
  const mid = parseLoopDoc('Name: "mid"\nTypes:\n    thing:\n        - field: "q"\n          type: "gone:x"\n')
  const rows = registerPackages([{ key: 0, pkg: wants }, { key: 1, pkg: mid }])
  assert.ok(rows.every((x) => x.ok === false), 'mid fails on gone:x — wants then fails on its vanished provider')
  assert.ok(rows.some((x) => x.msg.includes('gone:x')), 'mid blames its own requirement')
  assert.ok(rows.some((x) => x.msg.includes('mid:thing')), 'wants blames the vanished package')
})

test('two fetched files claiming one Name collide and both refuse', () => {
  const dup = parseLoopDoc('Name: "dup"\nTypes:\n    t:\n        - field: "x"\n          type: "int"\n')
  const rows = registerPackages([{ key: 0, pkg: dup }, { key: 1, pkg: dup }])
  assert.ok(rows.every((x) => x.ok === false), 'silent overwrite replaced by a reported conflict')
  assert.ok(rows[0].msg.includes('claim the name "dup"'), 'the conflict names the contested Name')
})

test('content without Name: refuses, an empty file or failed fetch stays quiet', () => {
  const rows = registerPackages([
    { key: 0, pkg: parseLoopDoc('Types:\n    t:\n        - field: "x"\n          type: "int"\n') },
    { key: 1, pkg: parseLoopDoc('') },
    { key: 2, pkg: null },
  ])
  assert.equal(rows.length, 2, 'a failed fetch registers nothing — runWeb keeps its ✕ cors status')
  const byKey = Object.fromEntries(rows.map((x) => [x.key, x]))
  assert.equal(byKey[0].ok, false, 'a package with content must name itself')
  assert.ok(byKey[0].msg.includes('no Name'), 'the refusal says why')
  assert.ok(byKey[1].ok, 'an empty file contributes nothing without erroring')
})

test('github blob urls rewrite to the CORS-enabled raw host', () => {
  assert.equal(
    corsUrl('https://github.com/dumpstertree/curio-engine/blob/main/loopdoc.yaml'),
    'https://raw.githubusercontent.com/dumpstertree/curio-engine/main/loopdoc.yaml',
    'blob → raw host, same path',
  )
  assert.equal(
    corsUrl('https://github.com/dumpstertree/curio-engine/raw/main/loopdoc.yaml'),
    'https://raw.githubusercontent.com/dumpstertree/curio-engine/main/loopdoc.yaml',
    'raw pages hop to the raw host too',
  )
  assert.equal(corsUrl('https://example.com/pkg.loopdoc.yaml'), 'https://example.com/pkg.loopdoc.yaml', 'other urls pass through')
})
