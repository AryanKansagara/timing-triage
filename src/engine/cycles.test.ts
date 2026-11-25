import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, whatIfFrequency } from './analyze.ts'
import type { ParsedReport, TimingPath } from './types.ts'

const p = (slack: number, relationship?: number, o: Partial<TimingPath> = {}): TimingPath => ({ id: `${slack}`, analysis: 'setup', slack, from: `u|f${slack}`, to: `u|t${slack}`, launch: 'clk', latch: 'clk', relationship, line: 1, ...o })
const report = (period: number, paths: TimingPath[], extra: Partial<ParsedReport> = {}): ParsedReport => ({ format: 'quartus', paths, clocks: [{ name: 'clk', period }], summary: [], unconstrained: [], transfers: [], issues: [], found: [], ...extra })
const near = (a: number | null | undefined, b: number) => assert.ok(a != null && Math.abs(a - b) < 1e-3, `${a} is not ${b}`)

test('re-timing a placeholder clock: half-cycle -5.2, one cycle +4.3, two cycles +23.3', () => {
  // Each needs relationship + 14.7 ns: 15.2 of 10, 15.7 of 20, 16.7 of 40.
  for (const [rel, want, next] of [[0.5, -5.2, 10], [1, 4.3, 20], [2, 23.3, 40], [undefined, 4.3, undefined]] as const) {
    const r = analyze({ report: report(1, [p(-14.7, rel)], { defaultClocks: ['clk'] }), sdcText: 'create_clock -name clk -period 20 [get_ports clk]' })
    near(r.wns, want)
    assert.equal(r.paths[0].relationship, next)
  }
})

test('a re-timed half-cycle failure is still called half-cycle', () => {
  const r = analyze({ report: report(1, [p(-14.7, 0.5)], { defaultClocks: ['clk'] }), sdcText: 'create_clock -name clk -period 20 [get_ports clk]' })
  assert.equal(r.paths[0].cause, 'edge')
})

test('what-if at 80 MHz on a 10 ns clock gains 1.25, 2.5 and 5 ns', () => {
  for (const [rel, want] of [[5, 0.25], [10, 1.5], [20, 4], [undefined, 1.5], [0, 1.5]] as const) {
    near(whatIfFrequency(analyze({ report: report(10, [p(-1, rel)]) }), 'clk', 80)!.wns, want)
  }
})

test('Fmax uses the path that needs the longest period, not the worst slack', () => {
  // Half-cycle: 6 ns per half period = 12 ns. One cycle: 11.5 ns, although its slack is worse.
  near(analyze({ report: report(10, [p(-1, 5)]) }).clocks[0].fmax, 1000 / 12)
  near(analyze({ report: report(10, [p(-1, 5), p(-1.5, 10)]) }).clocks[0].fmax, 1000 / 12)
  near(analyze({ report: report(10, [p(-2, 10)]) }).clocks[0].fmax, 1000 / 12)
  near(analyze({ report: report(10, [p(-2, 20)]) }).clocks[0].fmax, 1000 / 11)
  const r = analyze({ report: report(10, [p(-1, 5), p(-1.5, 10), p(3, 20)]) })
  near(whatIfFrequency(r, 'clk', r.clocks[0].fmaxEst!)!.wns, 0)
})
