import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze } from './analyze.ts'
import { compare, snapshot, type Snapshot } from './snapshot.ts'

/** Endpoints r<from>..r499, worst first unless reversed; r0 is the worst. */
const run = (from: number, to = 500, flip = false) => {
  const paths = Array.from({ length: to - from }, (_, i) => i + from).map(i => ({ id: `p${i}`, analysis: 'setup' as const, slack: -6 + i / 100, from: 'u|a', to: `u|r${i}`, launch: 'clk', latch: 'clk', line: 1 }))
  return snapshot(analyze({ report: { format: 'quartus', paths: flip ? paths.reverse() : paths, clocks: [{ name: 'clk', period: 10 }], summary: [], unconstrained: [], transfers: [], issues: [], found: [] } }), 'x', 'x', 1)
}
const legacy = ({ endpointCount: _, ...s }: Snapshot): Snapshot => s
const counts = (a: Snapshot, b: Snapshot) => { const d = compare(a, b); return [d.knowsFixed ? d.fixed.length : null, d.knowsAdded ? d.added.length : null, d.still] }

test('endpoints past the stored limit are not called new or fixed', () => {
  for (const f of [(s: Snapshot) => s, legacy]) {
    assert.deepEqual(counts(f(run(0)), f(run(100))), [100, null, 300])
    assert.deepEqual(counts(f(run(100)), f(run(0))), [null, 100, 300])
    assert.deepEqual(counts(f(run(0)), f(run(50))), [null, null, 350])
  }
  assert.deepEqual(compare(run(0), run(100)).added, [])
})

test('complete lists compare exactly, up to the limit', () => {
  assert.deepEqual(counts(run(100), run(150)), [50, 0, 350])
  assert.deepEqual(counts(legacy(run(100)), run(150, 500)), [50, 0, 350])
  assert.deepEqual(counts(run(150), run(100)), [0, 50, 350])
})

test('the worst endpoints are the ones stored, in any report order', () => {
  assert.deepEqual(run(0, 500, true).endpoints, run(0).endpoints)
  assert.equal(run(0).endpoints[0], 'u|r0 @ clk')
  assert.equal(run(0).endpointCount, 500)
})
