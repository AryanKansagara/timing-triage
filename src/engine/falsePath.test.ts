import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze } from './analyze.ts'
import { clocksCut, lintSdc, parseSdc, pathCut } from './sdc.ts'
import type { Analysis, ParsedReport, TimingPath } from './types.ts'

const p = (analysis: Analysis, slack: number): TimingPath => ({ id: analysis, analysis, slack, from: 'u|a', to: 'u|b', launch: 'A', latch: 'B', line: 1 })
const report = (extra: Partial<ParsedReport> = {}): ParsedReport => ({ format: 'quartus', paths: [p('setup', -5), p('hold', -0.4)], clocks: [{ name: 'A', period: 10 }, { name: 'B', period: 8 }], summary: [], unconstrained: [], transfers: [], issues: [], found: [], ...extra })
const run = (sdcText: string, extra?: Partial<ParsedReport>) => { const r = analyze({ report: report(extra), sdcText }); return { setup: r.wns, hold: r.holdWns, failing: r.failing, status: r.crossings[0].status, crossFailing: r.crossings[0].failing } }

test('-hold and -setup false paths cut only their own check', () => {
  for (const ends of ['-from [get_clocks A] -to [get_clocks B]', '-from [get_registers u|a]', '-from [get_clocks A]', '-to [get_clocks B]']) {
    const h = run(`set_false_path -hold ${ends}`)
    assert.deepEqual([h.setup, h.hold, h.failing, h.status], [-5, null, 1, 'unconstrained'], ends)
    const s = run(`set_false_path -setup ${ends}`)
    assert.deepEqual([s.hold, s.failing], [-0.4, 1], ends)
    for (const t of ['', '-setup -hold ']) assert.equal(run(`set_false_path ${t}${ends}`).failing, 0, t + ends)
  }
  const m = parseSdc('set_false_path -setup -from [get_clocks A] -to [get_clocks B]')
  assert.equal(clocksCut(m, 'A', 'B', 'recovery'), 1)
  assert.equal(clocksCut(m, 'A', 'B', 'removal'), null)
  assert.equal(clocksCut(m, 'A', 'B'), null)
})

test('a crossing is cut when one line cuts setup and another cuts hold', () => {
  assert.equal(run('set_false_path -setup -from [get_clocks A] -to [get_clocks B]\nset_false_path -hold -from [get_clocks A] -to [get_clocks B]').status, 'cut')
})

test('-through and edge-limited false paths never hide a path', () => {
  for (const sdc of ['-from [get_clocks A] -through [get_pins z]', '-through [get_pins z] -to [get_clocks B]', '-rise_from [get_clocks z] -to [get_clocks B]', '-from [get_clocks A] -fall_to [get_clocks z]', '-from [get_registers u|a] -rise_through [get_pins z]', '-rise -from [get_registers u|a]']) {
    const r = run(`set_false_path ${sdc}`)
    assert.deepEqual([r.setup, r.hold, r.failing], [-5, -0.4, 2], sdc)
    assert.ok(lintSdc(parseSdc(`set_false_path ${sdc}`)).some(l => l.rule === 'partial_false_path'), sdc)
  }
})

test('lint: an edge-limited false path is not "every path", a bare one is', () => {
  const broad = (s: string) => lintSdc(parseSdc(s)).filter(l => l.rule === 'broad_false_path').map(l => l.level)
  assert.deepEqual(broad('set_false_path -rise_from [get_clocks A] -fall_to [get_clocks B]'), [])
  assert.deepEqual(broad('set_false_path'), ['error'])
  assert.deepEqual(broad('set_false_path -rise_from *'), ['warn'])
})

test('a hold-only cut keeps the tool\'s setup summary', () => {
  const extra = { summary: [{ clock: 'B', analysis: 'setup' as const, slack: -7, tns: -30 }, { clock: 'B', analysis: 'hold' as const, slack: -0.9, tns: -3 }] }
  const r = run('set_false_path -hold -from [get_clocks A] -to [get_clocks B]', extra)
  assert.deepEqual([r.setup, r.hold], [-7, null])
})

test('plain false paths and clock groups are unchanged', () => {
  assert.equal(pathCut(parseSdc('set_false_path -from [get_registers u|*]'), 'u|a', 'u|b'), 1)
  assert.equal(run('set_clock_groups -asynchronous -group A -group B').status, 'cut')
  const t = { transfers: [{ from: 'A', to: 'B', paths: 9, falsePath: false, wns: -6, failing: 4, holdWns: -1, holdFailing: 3 }] }
  assert.deepEqual([run('', t).crossFailing, run('set_clock_groups -asynchronous -group A -group B', t).crossFailing, run('set_false_path -hold -from [get_clocks A] -to [get_clocks B]', t).crossFailing], [7, 0, 4])
})

test('a hold-only cut keeps the design setup totals and drops the hold ones', () => {
  const t = (wns: number, tns: number, failing: number) => ({ wns, tns, failing, total: 100 })
  const r = analyze({ report: report({ totals: { setup: t(-8, -90, 30), hold: t(-2, -9, 12) } }), sdcText: 'set_false_path -hold -from [get_clocks A] -to [get_clocks B]' })
  assert.deepEqual([r.wns, r.tns, r.holdWns, r.endpoints], [-8, -90, null, null])
})
