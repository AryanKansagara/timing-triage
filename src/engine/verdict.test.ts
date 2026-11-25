import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, verdict } from './analyze.ts'
import { compare, snapshot } from './snapshot.ts'
import type { ParsedReport, TimingPath } from './types.ts'

const p = (slack: number, o: Partial<TimingPath> = {}): TimingPath => ({ id: `${slack}`, analysis: 'setup', slack, from: 'u|a', to: 'u|b', launch: 'clk', latch: 'clk', line: 1, ...o })
const run = (o: Partial<ParsedReport>, sdcText = '') => analyze({ report: { format: 'quartus', paths: [], clocks: [{ name: 'clk', period: 10 }], summary: [], unconstrained: [], transfers: [], issues: [], found: [], ...o }, sdcText })
const row = (analysis: 'setup' | 'hold', slack: number) => ({ clock: 'clk', analysis, slack, tns: Math.min(0, slack) })
const tot = (wns: number, failing: number) => ({ wns, tns: wns, failing, total: 9 })

test('setup is unknown without a setup result, and 0 ns is still met', () => {
  assert.equal(run({}).wns, null)
  assert.equal(run({ paths: [p(0.2, { analysis: 'hold' })] }).wns, null)
  assert.equal(run({ paths: [p(-1)] }, 'set_false_path -from [get_registers u|a]').wns, null)
  assert.equal(run({ paths: [p(0)] }).wns, 0)
  assert.equal(run({ summary: [row('setup', -5)] }).wns, -5)
})

test('met only when setup and hold are both known and met', () => {
  const met = (o: Partial<ParsedReport>) => verdict(run(o)).met
  assert.equal(met({ paths: [p(1), p(0.1, { analysis: 'hold' })] }), true)
  assert.equal(met({ summary: [row('setup', 1), row('hold', 0)] }), true)
  assert.equal(met({ totals: { setup: tot(1, 0), hold: tot(0.1, 0) } }), true)
  for (const o of [{}, { paths: [p(1)] }, { paths: [p(0.1, { analysis: 'hold' as const })] }, { summary: [row('setup', -5)] }, { summary: [row('setup', 1), row('hold', -1)] }, { totals: { setup: tot(-1, 3), hold: tot(1, 0) } }]) assert.equal(met(o), false, JSON.stringify(o))
  assert.match(verdict(run({ summary: [row('setup', -5)] })).text, /fails setup \(WNS -5\.000 ns\)/)
})

test('saved runs keep unknown as unknown, and old runs still compare', () => {
  const none = snapshot(run({}), '1', 'a', 1), old = snapshot(run({ paths: [p(-2)] }), '2', 'b', 2)
  assert.equal(JSON.parse(JSON.stringify(none)).wns, null)
  assert.deepEqual(none.clocks.map(c => c.wns), [null])
  assert.deepEqual([compare(none, old).wns, compare(none, old).tns], [NaN, NaN])
  assert.deepEqual([compare(old, { ...old, wns: -0.5, tns: -0.5 }).wns, compare(old, { ...old, wns: -0.5, tns: -0.5 }).tns], [1.5, 1.5])
})
