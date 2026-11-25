import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze } from './analyze.ts'
import { collection, lintSdc, parseSdc, pathCut, statements } from './sdc.ts'
import type { Clock, ParsedReport } from './types.ts'

const CLOCKS: Clock[] = [{ name: 'clkA', period: 10 }, { name: 'clkB', period: 8 }]
const run = (sdcText: string, launch = 'clkA', latch = 'clkB', o: Partial<ParsedReport> = {}) => analyze({ sdcText, report: { format: 'vivado', paths: [{ id: 'p', analysis: 'setup', slack: -5, from: 'u/a_reg/C', to: 'u/b_reg/D', launch, latch, line: 1 }], clocks: CLOCKS, summary: [], unconstrained: [], transfers: [], issues: [], found: [], ...o } })
const cut = (...a: Parameters<typeof run>) => run(...a).failing === 0
const groups = (a: string, b = '[get_clocks clkB]') => `set_clock_groups -asynchronous -group ${a} -group ${b}`

test('common ways to write clock groups are honoured', () => {
  for (const a of ['[get_clocks -include_generated_clocks clkA]', '[get_clocks clkA -include_generated_clocks]', '[get_clocks -quiet -include_generated {clkA}]', '[get_clocks [list clkA]]', '[list clkA]', '[list [get_clocks clkA] [get_clocks x]]', '[get_clocks {\n  clkA\n}]', '[get_clocks {\n  clkA\n  other\n}]', '[get_clocks {clkA \\\n other}]', '[\n get_clocks clkA\n]', '[get_clocks -nowarn clkA]', '{clkA}', 'clkA'])
    assert.ok(cut(groups(a)), a)
  assert.ok(cut('set_clock_groups -quiet -asynchronous -group [get_clocks {\nclkA}] -group [get_clocks {\nclkB}]\n'))
})

test('-include_generated_clocks covers generated children, plain get_clocks does not', () => {
  const clocks: Clock[] = [...CLOCKS, { name: 'mid', period: 5, kind: 'generated', master: 'clkA' }, { name: 'leaf', period: 5, kind: 'generated', master: 'mid' }]
  const on = (sdc: string) => cut(sdc, 'leaf', 'clkB', { clocks })
  assert.ok(on(groups('[get_clocks -include_generated_clocks clkA]')))
  assert.ok(on('set_false_path -from [get_clocks -include_generated_clocks clkA] -to [get_clocks clkB]'))
  assert.ok(!on(groups('[get_clocks clkA]')))
  assert.ok(!cut(groups('[get_clocks -include_generated_clocks clkA]', '[get_clocks x]'), 'leaf', 'clkB', { clocks }))
})

test('what is not understood leaves the path visible', () => {
  for (const a of ['[get_clocks -filter {PERIOD < 5} *]', '[get_clocks * -filter {PERIOD < 5}]', '[get_clocks -of_objects [get_pins x] clkA]', '[get_clocks -regexp clkA]', '[get_clocks -frobnicate clkA]', '[remove_from_collection [get_clocks *] [get_clocks clkA]]', '$clocks', '[list [get_clocks clkA] [get_ports clkA]]', '[get_clocks clkA'])
    assert.ok(!cut(groups(a)), a)
  for (const a of ['[get_cells -filter {REF_NAME =~ FD*} u/*]', '[get_cells u/* -filter {X}]', '[get_cells -of_objects [get_nets n]]', '[all_fanin -to u/a_reg/C]']) assert.equal(pathCut(parseSdc(`set_false_path -from ${a}`), 'u/a_reg/C', 'u/b_reg/D'), null, a)
})

test('get_cells names cells, reports name their pins', () => {
  const on = (from: string, node: string) => pathCut(parseSdc(`set_false_path -from ${from}`), node, 'z/D') !== null
  assert.ok(on('[get_cells a_reg]', 'a_reg/C'))
  assert.ok(on('[get_cells u/a_reg]', 'u/a_reg/C'))
  assert.ok(on('[get_cells {a_reg[3]}]', 'a_reg[3]/C'))
  assert.ok(on('[get_cells ram]', 'ram/CLKARDCLK'))
  assert.ok(on('[get_cells -hier sync_reg]', 'u_x/u_y/sync_reg/C'))
  assert.ok(on('[get_cells -hierarchical {sync_reg[*]}]', 'u/sync_reg[2]/C'))
  assert.ok(on('[get_pins a_reg/C]', 'a_reg/C'))
  assert.ok(!on('[get_cells a_reg]', 'u/a_reg/C'))
  assert.ok(!on('[get_cells *_reg]', 'u/a_reg/C'))
  assert.ok(!on('[get_cells u]', 'u/a_reg/C'))
  assert.ok(!on('[get_cells -hier sync_reg]', 'u/sync_reg2/C'))
  assert.ok(!on('[get_cells -hier sync]', 'u/sync_reg/C'))
  assert.ok(!on('[get_registers a_reg]', 'a_reg/C'))
})

test('-quiet does not swallow -from', () => {
  assert.equal(pathCut(parseSdc('set_false_path -quiet -from [get_registers a] -to [get_registers b]'), 'x', 'b'), null)
})

test('all_inputs and all_outputs constrain their own direction', () => {
  const left = (sdc: string) => run(sdc, 'clkA', 'clkB', { unconstrained: [{ kind: 'input', name: 'sw[0]' }, { kind: 'output', name: 'led' }] }).unconstrainedPorts.map(p => p.name)
  assert.deepEqual(left('set_input_delay -clock clkA 2 [all_inputs]'), ['led'])
  assert.deepEqual(left('set_output_delay -clock clkA 2 [all_outputs]'), ['sw[0]'])
  assert.deepEqual(left('set_output_delay -clock clkA 2 [all_inputs]'), ['sw[0]', 'led'])
  assert.deepEqual(left('set_input_delay -clock clkA 2 [remove_from_collection [all_inputs] [get_ports sw*]]'), ['sw[0]', 'led'])
})

test('an open brace does not swallow the commands after it', () => {
  const cmds = (t: string) => statements(t).map(s => `${s.cmd}@${s.line}`)
  assert.deepEqual(cmds('create_clock -period 10 [get_ports {a\ncreate_clock -period 8 [get_ports b]\nset_false_path -from x'), ['create_clock@1', 'create_clock@2', 'set_false_path@3'])
  assert.deepEqual(cmds('if {$x} {\n  set_false_path -from a\n}\n').slice(0, 2), ['if@1', 'set_false_path@2'])
  assert.deepEqual(cmds('# note {\nderive_pll_clocks\n'), ['derive_pll_clocks@2'])
  assert.deepEqual(cmds('derive_pll_clocks ;# note {\nfoo }\n'), ['derive_pll_clocks@1', 'foo@2'])
  assert.deepEqual(cmds(groups('[get_clocks {\n clkA\n}]') + '\nderive_pll_clocks'), ['set_clock_groups@1', 'derive_pll_clocks@4'])
})

test('lint knows the clocks in these forms', () => {
  const l = lintSdc(parseSdc(groups('[get_clocks -include_generated_clocks clkA]', '[get_clocks [list clkB]]')), CLOCKS, 'vivado')
  assert.deepEqual(l.filter(x => /unknown_clock|clock_groups/.test(x.rule)), [])
  assert.deepEqual(collection('[get_clocks {a b}]'), { kind: 'get_clocks', patterns: ['a', 'b'] })
})
