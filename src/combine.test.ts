import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze } from './engine/analyze.ts'
import { parseReport } from './engine/parse.ts'
import type { ParsedReport, TimingPath } from './engine/types.ts'
import { combine } from './projectData.ts'

const path = (o: Partial<TimingPath>): TimingPath => ({ id: 'p1', analysis: 'setup', slack: 0, from: 'u|a', to: 'u|b', launch: 'clk', latch: 'clk', line: 1, ...o })
const rep = (paths: TimingPath[], o: Partial<ParsedReport> = {}): ParsedReport => ({ ...parseReport(''), format: 'quartus', issues: [], paths, ...o })
const both = (a: ParsedReport, b: ParsedReport, check: (r: ParsedReport) => void) => { check(combine([a, b])); check(combine([b, a])) }

test('the worst-slack copy of a path wins in either file order and the other copy fills gaps', () => {
  both(rep([path({ slack: 3, levels: 9, skew: 0.1 })]), rep([path({ slack: -1.5, skew: -0.2, corner: 'Slow' })]), r => {
    assert.equal(r.paths.length, 1)
    assert.deepEqual([r.paths[0].slack, r.paths[0].levels, r.paths[0].skew, r.paths[0].corner], [-1.5, 9, -0.2, 'Slow'])
    assert.equal(analyze({ report: r }).failing, 1)
  })
})

test('setup and hold of one path stay separate, and ids stay unique', () => {
  const r = combine([rep([path({ slack: 1 })]), rep([path({ analysis: 'hold', slack: -0.1 }), path({ id: 'p2', slack: -2 })])])
  assert.deepEqual(r.paths.map(p => [p.analysis, p.slack]), [['setup', -2], ['hold', -0.1]])
  assert.equal(new Set(r.paths.map(p => p.id)).size, 2)
})

test('inputs are not modified', () => {
  const a = rep([path({ slack: 3 })], { fmax: [{ clock: 'clk', fmax: 100 }] }), copy = structuredClone(a)
  combine([a, rep([path({ slack: -1 })], { fmax: [{ clock: 'clk', fmax: 50 }] })])
  assert.deepEqual(a, copy)
})

test('lowest Fmax and worst totals win in either order', () => {
  const t = (wns: number, failing: number) => ({ wns, tns: wns, failing, total: 10 })
  both(rep([], { fmax: [{ clock: 'clk', fmax: 120 }], totals: { setup: t(1, 0), hold: t(-0.1, 2) } }), rep([], { fmax: [{ clock: 'clk', fmax: 90 }], totals: { setup: t(-2, 5), hold: t(0.1, 0) } }), r => {
    assert.deepEqual(r.fmax, [{ clock: 'clk', fmax: 90 }])
    assert.deepEqual([r.totals!.setup!.wns, r.totals!.setup!.failing, r.totals!.hold!.wns, r.totals!.hold!.failing], [-2, 5, -0.1, 2])
  })
})
