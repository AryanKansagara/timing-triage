import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, verdict } from './analyze.ts'
import type { Analysis, ParsedReport, TimingPath } from './types.ts'

const row = (analysis: Analysis, slack: number, tns = 0) => ({ clock: 'clk', analysis, slack, tns })
const p = (analysis: Analysis, slack: number, to = 'u|b'): TimingPath => ({ id: analysis + to, analysis, slack, from: 'u|a', to, launch: 'clk', latch: 'clk', line: 1 })
const run = (o: Partial<ParsedReport>, sdcText = '', includeHold = true) => analyze({ report: { format: 'quartus', paths: [], clocks: [{ name: 'clk', period: 10 }], summary: [], unconstrained: [], transfers: [], issues: [], found: [], ...o }, sdcText, settings: { includeHold } })

test('recovery and removal summaries count in the clock and headline numbers', () => {
  const r = run({ summary: [row('setup', 1), row('recovery', -3.2, -40), row('removal', -0.5, -2)] })
  assert.deepEqual([r.wns, r.tns, r.holdWns, r.holdTns], [-3.2, -40, -0.5, -2])
  assert.deepEqual([r.clocks[0].wns, r.clocks[0].tns, r.clocks[0].holdWns, r.clocks[0].holdTns], [-3.2, -40, -0.5, -2])
  assert.match(verdict(r).text, /fails setup .* and hold/)
})

test('setup and recovery totals add up, and a met recovery changes nothing', () => {
  assert.deepEqual(((r) => [r.wns, r.tns])(run({ summary: [row('setup', -1, -5), row('recovery', -0.5, -2)] })), [-1, -7])
  assert.deepEqual(((r) => [r.wns, r.tns])(run({ summary: [row('setup', -1, -5), row('recovery', 4)] })), [-1, -5])
  // A listed recovery path without a recovery summary is not part of the setup total.
  assert.equal(run({ summary: [row('setup', -1, -5)], paths: [p('recovery', -3)] }).tns, -8)
})

test('listed paths alone keep one worst slack per endpoint', () => {
  assert.equal(run({ paths: [p('setup', -1), p('recovery', -3)] }).tns, -3)
})

test('removal is left out when hold is not analysed', () => {
  assert.deepEqual(((r) => [r.holdWns, r.holdTns])(run({ summary: [row('removal', -0.5, -2)] }, '', false)), [null, 0])
})

test('a re-timed clock moves its recovery summary too, removal stays', () => {
  const r = run({ clocks: [{ name: 'clk', period: 1 }], defaultClocks: ['clk'], summary: [row('setup', -4, -9), row('recovery', -5, -9), row('removal', -0.5, -2)] }, 'create_clock -name clk -period 10 [get_ports clk]')
  assert.deepEqual([r.wns, r.tns, r.holdWns], [4, 0, -0.5])
})

test('a cut of the same kind makes the recovery summary stale', () => {
  const r = run({ paths: [p('recovery', -3.2), p('setup', 1, 'u|c')], summary: [row('recovery', -3.2, -40)] }, 'set_false_path -from [get_registers u|a] -to [get_registers u|b]')
  assert.deepEqual([r.wns, r.tns], [1, 0])
})

test('a met recovery or removal summary alone leaves setup and hold unknown', () => {
  const r = run({ summary: [row('recovery', 4), row('removal', 0.2)] })
  assert.deepEqual([r.wns, r.holdWns, verdict(r).met], [null, null, false])
})
