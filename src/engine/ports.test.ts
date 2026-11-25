import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze } from './analyze.ts'
import { buildFixes } from './fixes.ts'
import type { ParsedReport, TimingPath } from './types.ts'

const p = (from: string, to: string, o: Partial<TimingPath> = {}): TimingPath => ({ id: from + to, analysis: 'setup', slack: -1, from, to, launch: 'clk', latch: 'clk', relationship: 10, dataDelay: 11, line: 1, ...o })
const run = (paths: TimingPath[], o: Partial<ParsedReport> = {}, sdcText = '') => analyze({ sdcText, report: { format: 'quartus', paths, clocks: [{ name: 'clk', period: 10 }], summary: [], unconstrained: [], transfers: [], issues: [], found: [], ...o } })
const causes = (...a: Parameters<typeof run>) => run(...a).paths.map(x => x.cause)

test('top-level Quartus registers are not ports', () => {
  assert.deepEqual(causes([p('cnt[0]', 'cnt[25]')]), ['logic'])
  assert.deepEqual(causes([p('state', 'cnt[25]')]), ['logic'])
  // The counter is a register in the first path, so it still is one when it drives a submodule.
  assert.deepEqual(causes([p('cnt[0]', 'cnt[25]'), p('cnt[3]', 'u|x')]), ['logic', 'logic'])
  const r = run([p('cnt[0]', 'cnt[25]')])
  assert.ok(!buildFixes(r, r.clockDefs).some(f => /FAST_/.test(f.qsf ?? '')))
})

test('ports with evidence stay I/O', () => {
  assert.deepEqual(causes([p('KEY[0]', 'u|q')]), ['io'])
  assert.deepEqual(causes([p('u|q', 'LEDR[0]')]), ['io'])
  assert.deepEqual(causes([p('KEY[0]', 'cnt[1]')], { unconstrained: [{ kind: 'input', name: 'KEY[0]' }] }), ['io'])
  assert.deepEqual(causes([p('KEY[0]', 'cnt[1]')], {}, 'set_input_delay -clock clk 2 [get_ports KEY[0]]'), ['io'])
  assert.deepEqual(causes([p('KEY[0]', 'cnt[1]', { launch: 'v' })], { clocks: [{ name: 'clk', period: 10 }, { name: 'v', period: 10, kind: 'virtual' }] }), ['io'])
  assert.deepEqual(causes([p('KEY[0]', 'cnt[1]', { launch: '' })]), ['io'])
  // A bidirectional pin ends and starts paths, but never between two top-level names.
  assert.deepEqual(causes([p('DQ[0]', 'u|q'), p('u|r', 'DQ[0]')]), ['io', 'io'])
})

test('in Vivado a name without a pin is always a port', () => {
  assert.deepEqual(causes([p('btn', 'led')], { format: 'vivado' }), ['io'])
  assert.deepEqual(causes([p('cnt_reg[0]/C', 'cnt_reg[9]/D')], { format: 'vivado' }), ['logic'])
})

test('the I/O fix names the port, not the top-level register it goes to or from', () => {
  const r = run([p('cnt[0]', 'LEDR[0]')], { unconstrained: [{ kind: 'output', name: 'LEDR[0]' }] })
  assert.equal(buildFixes(r, r.clockDefs).find(f => f.id === 'io')!.qsf, 'set_instance_assignment -name FAST_OUTPUT_REGISTER ON -to {LEDR[*]}')
})
