import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectFormat, parseReport, quartusTables } from './parse.ts'
import { clocksCut, collection, lintSdc, parseSdc, pathCut, statements, tokenize } from './sdc.ts'
import { analyze, bus, classify, fmax, isHalfCycle, mergeClocks, rootClock, whatIfFrequency } from './analyze.ts'
import { applyToSdc, buildFixes, mhzFromName, pathsCsv, suggestPeriod } from './fixes.ts'
import { AVR_CPU_STA } from './fixtures/avrCpu.ts'
import { RED_PITAYA_TIMING, RED_PITAYA_XDC } from './fixtures/redPitaya.ts'
import { compare, snapshot } from './snapshot.ts'
import { quartusTable, renderQuartus, samples, VGA_CLOCKS, vgaPaths, type SamplePath } from './sample.ts'
import { DEFAULT_SETTINGS, type Clock, type TimingPath } from './types.ts'

const PIX = 'u_pll|altpll_component|auto_generated|pll1|clk[0]'
const vga = () => samples()[0]
const vgaRun = (sdc = vga().sdc) => { const report = parseReport(vga().report); return { report, r: analyze({ report, sdcText: sdc }) } }

const mini = (paths: Partial<SamplePath>[], clocks: Clock[] = [{ name: 'a', period: 10 }, { name: 'b', period: 8 }]) =>
  renderQuartus(paths.map(p => ({ analysis: 'setup', slack: -1, from: 'top:u|r[0]', to: 'top:u|q[0]', launch: 'a', latch: 'a', rel: 10, skew: 0, delay: 5, levels: 2, fanout: 1, ...p })), clocks, { design: 't', device: 'd' })

// ---------- Format detection and parsing ----------

test('detects Quartus, Vivado and SDC text', () => {
  assert.equal(detectFormat(vga().report), 'quartus')
  assert.equal(detectFormat(samples()[1].report), 'vivado')
  assert.equal(detectFormat(vga().sdc), 'sdc')
  assert.equal(detectFormat('hello world'), 'unknown')
})

test('splits Quartus panel text into titled tables and strips Info prefixes', () => {
  const t = quartusTables('Info (332115): ' + quartusTable('Summary of Paths', ['Slack', 'From Node'], [['-1.000', 'x|y']]).split('\n').join('\nInfo (332115): '))
  assert.equal(t.length, 1)
  assert.equal(t[0].title, 'Summary of Paths')
  assert.deepEqual(t[0].header, ['Slack', 'From Node'])
  assert.equal(t[0].rows[0].cells[1], 'x|y')
})

test('parses the sample Quartus report: paths, clocks, unconstrained ports, transfers', () => {
  const r = parseReport(vga().report)
  const truth = vgaPaths()
  assert.equal(r.paths.length, truth.length)
  assert.equal(r.clocks.length, 4)
  assert.equal(r.clocks.find(c => c.name === PIX)?.master, 'clk_50')
  assert.ok(Math.abs(r.clocks.find(c => c.name === PIX)!.period - 39.801) < 1e-9)
  assert.deepEqual(r.unconstrained.filter(u => u.kind === 'input').map(u => u.name), ['UART_RX', 'SW[0]', 'SW[1]'])
  assert.ok(r.transfers.some(t => t.from === 'uart_clk_10' && t.to === PIX))
  assert.equal(Math.min(...r.paths.map(p => p.slack)), Math.min(...truth.map(p => p.slack)))
})

test('merges path detail sections: logic levels, arrival and data-path fanout (not clock fanout)', () => {
  const r = parseReport(vga().report)
  const rst = r.paths.find(p => p.from === 'rst_sync:u_rst|rst_n_q')!
  assert.equal(rst.fanout, 1452)
  const blend = r.paths.filter(p => p.to.startsWith('alpha_blend:u_blend|pix_out'))
  assert.ok(blend.every(p => (p.levels ?? 0) >= 11))
  assert.ok(blend.every(p => p.arrival !== undefined && p.required !== undefined))
  assert.ok(Math.abs(blend[0].required! - blend[0].arrival! - blend[0].slack) < 0.002)
})

test('reports bad rows with line numbers instead of failing', () => {
  const txt = quartusTable('Summary of Paths', ['Slack', 'From Node', 'To Node', 'Launch Clock', 'Latch Clock'], [['-0.5', 'a|x', 'a|y', 'c', 'c'], ['oops', 'a|x', 'a|z', 'c', 'c']])
  const r = parseReport(txt)
  assert.equal(r.paths.length, 1)
  const bad = r.issues.find(i => i.level === 'warn')!
  assert.equal(bad.line, 7)
  assert.match(bad.message, /numeric slack/)
})

test('rejects text that is not a timing report', () => {
  const r = parseReport('just some notes')
  assert.equal(r.paths.length, 0)
  assert.equal(r.issues[0].level, 'error')
})

test('parses Vivado report_timing_summary path blocks and clock summary', () => {
  const r = parseReport(samples()[1].report)
  assert.equal(r.format, 'vivado')
  assert.equal(r.clocks.find(c => c.name === 'uart_clk')?.period, 100)
  const cdc = r.paths.filter(p => p.launch === 'uart_clk' && p.latch === 'clk_pix_clk_wiz_0')
  assert.equal(cdc.length, 4)
  assert.ok(cdc.every(p => p.slack < 0 && p.relationship === 0.199))
  assert.ok(r.paths.some(p => p.levels === 15 && p.fanout === 7))
  assert.ok(r.issues.some(i => /input ports have no input delay/.test(i.message)))
})

// ---------- SDC ----------

test('tokenizes Tcl words with braces, brackets and quotes', () => {
  assert.deepEqual(tokenize('set_false_path -from [get_clocks {a b}] -to "x y" {c[0]}'), ['set_false_path', '-from', '[get_clocks {a b}]', '-to', 'x y', '{c[0]}'])
  assert.deepEqual(collection('[get_clocks {pll|clk[0] clk_50}]'), { kind: 'get_clocks', patterns: ['pll|clk[0]', 'clk_50'] })
})

test('joins backslash continuations and drops comments, keeping the first line number', () => {
  const s = statements('# header\nset_clock_groups -asynchronous \\\n  -group {a} \\\n  -group {b}\ncreate_clock -period 10 [get_ports clk] ;# trailing')
  assert.equal(s.length, 2)
  assert.equal(s[0].line, 2)
  assert.equal(s[0].words.filter(w => w === '-group').length, 2)
  assert.equal(s[1].cmd, 'create_clock')
})

test('resolves generated clock periods from the master', () => {
  const m = parseSdc('create_clock -name clk_50 -period 20 [get_ports CLOCK_50]\ncreate_generated_clock -name pix -source [get_ports CLOCK_50] -multiply_by 2 -divide_by 4 [get_pins pll|clk[0]]')
  assert.equal(m.clocks[1].period, 40)
  assert.equal(m.clocks[1].master, 'clk_50')
})

test('clock groups cut crossings both ways, single-group form cuts against everything else', () => {
  const m = parseSdc('set_clock_groups -asynchronous -group [get_clocks {pll|*}] -group [get_clocks uart]')
  assert.ok(clocksCut(m, 'pll|clk[0]', 'uart') !== null)
  assert.ok(clocksCut(m, 'uart', 'pll|clk[1]') !== null)
  assert.equal(clocksCut(m, 'pll|clk[0]', 'pll|clk[1]'), null)
  const one = parseSdc('set_clock_groups -exclusive -group {uart}')
  assert.ok(clocksCut(one, 'uart', 'other') !== null)
})

test('node-level false paths cut matching paths only', () => {
  const m = parseSdc('set_false_path -from [get_registers {*|sync_ff1*}] -to [get_registers {*}]')
  assert.ok(pathCut(m, 'top|sync_ff1[0]', 'top|q') !== null)
  assert.equal(pathCut(m, 'top|data[0]', 'top|q'), null)
})

test('lint: missing derive_pll_clocks when the report has PLL clocks, and missing uncertainty', () => {
  const l = lintSdc(parseSdc('create_clock -name clk_50 -period 20 [get_ports CLOCK_50]'), VGA_CLOCKS)
  assert.equal(l.find(x => x.rule === 'derive_pll_clocks')?.level, 'error')
  assert.ok(l.some(x => x.rule === 'derive_clock_uncertainty'))
  assert.ok(!lintSdc(parseSdc('create_clock -name c -period 10 [get_ports c]'), [], 'vivado').some(x => x.rule.startsWith('derive')))
})

test('lint: period that is really a frequency, and sub-ns periods', () => {
  const l = lintSdc(parseSdc('create_clock -name clk_50 -period 50 [get_ports CLOCK_50]\ncreate_clock -name fast -period 0.5 [get_ports f]\nderive_pll_clocks\nderive_clock_uncertainty'))
  const f = l.find(x => x.rule === 'period' && x.line === 1)!
  assert.match(f.message, /20\.000 ns/)
  assert.match(f.fix!, /-period 20\.000/)
  assert.ok(l.some(x => x.rule === 'period' && x.line === 2))
})

test('lint: overly broad false paths and multicycle without hold', () => {
  const l = lintSdc(parseSdc('set_false_path -from *\nset_false_path\nset_multicycle_path -setup 3 -from [get_registers a*] -to [get_registers b*]\nderive_pll_clocks\nderive_clock_uncertainty'))
  assert.equal(l.filter(x => x.rule === 'broad_false_path').length, 2)
  const mc = l.find(x => x.rule === 'multicycle_hold')!
  assert.equal(mc.line, 3)
  assert.match(mc.fix!, /-hold 2 -from/)
  const ok = lintSdc(parseSdc('set_multicycle_path -setup 3 -from a -to b\nset_multicycle_path -hold 2 -from a -to b'))
  assert.ok(!ok.some(x => x.rule === 'multicycle_hold'))
})

test('lint: clocks without groups when there are unrelated clock families', () => {
  const l = lintSdc(parseSdc(vga().sdc), VGA_CLOCKS)
  assert.ok(l.some(x => x.rule === 'clock_groups'))
  const grouped = lintSdc(parseSdc(vga().sdc + `\nset_clock_groups -asynchronous -group [get_clocks {clk_50 u_pll*}] -group [get_clocks uart_clk_10]`), VGA_CLOCKS)
  assert.ok(!grouped.some(x => x.rule === 'clock_groups'))
})

// ---------- Analysis ----------

test('worst and total negative slack per clock match the tool summary', () => {
  const { report, r } = vgaRun()
  for (const s of report.summary.filter(x => x.analysis === 'setup')) {
    const c = r.clocks.find(x => x.clock === s.clock)!
    assert.equal(c.wns, s.slack, s.clock)
    assert.ok(Math.abs(c.tns - s.tns) < 0.002, s.clock)
  }
})

test('TNS counts each endpoint once, at its worst slack', () => {
  const r = analyze({ report: parseReport(mini([{ slack: -1, to: 'top:u|q[0]' }, { slack: -3, to: 'top:u|q[0]', from: 'top:u|r[1]' }, { slack: -2, to: 'top:u|q[1]' }])) })
  assert.equal(r.tns, -5)
  assert.equal(r.wns, -3)
  assert.equal(r.failing, 3)
})

test('classifies the planted root causes in the VGA sample', () => {
  const { r } = vgaRun()
  const by = Object.fromEntries(r.causes.map(c => [c.cause, c.paths.length]))
  assert.deepEqual(by, { cdc: 10, logic: 12, fanout: 6, io: 2, skew: 1 })
  const p = r.paths.find(x => x.to === 'uart_tx:u_tx|busy_meta')!
  assert.equal(p.cause, 'cdc')
})

test('classifier precedence: I/O before CDC, logic depth before fanout, skew only when it dominates', () => {
  const ctx = { clocks: [{ name: 'a', period: 10 }, { name: 'b', period: 7 }], sdc: null, ports: new Set<string>(), s: DEFAULT_SETTINGS }
  const base: TimingPath = { id: 'x', analysis: 'setup', slack: -0.5, from: 'u|r', to: 'u|q', launch: 'a', latch: 'a', line: 1 }
  assert.equal(classify({ ...base, from: 'KEY[0]', launch: 'b' }, ctx).cause, 'io')
  assert.equal(classify({ ...base, latch: 'b' }, ctx).cause, 'cdc')
  assert.equal(classify({ ...base, levels: 9, fanout: 500 }, ctx).cause, 'logic')
  assert.equal(classify({ ...base, levels: 2, fanout: 500 }, ctx).cause, 'fanout')
  assert.equal(classify({ ...base, skew: -0.6 }, ctx).cause, 'skew')
  assert.equal(classify({ ...base, skew: -0.4 }, ctx).cause, 'route')
  assert.equal(classify({ ...base, slack: 0.2 }, ctx).cause, null)
})

test('PLL outputs from one reference are related; separate oscillators are not', () => {
  assert.equal(rootClock(PIX, VGA_CLOCKS), 'clk_50')
  assert.equal(rootClock('uart_clk_10', VGA_CLOCKS), 'uart_clk_10')
  assert.equal(rootClock('top|pll_inst|outclk_0', []), rootClock('top|pll_inst|outclk_1', []))
})

test('CDC check reports unconstrained crossings and recognises synchronizer stages', () => {
  const { r } = vgaRun()
  const x = r.crossings.find(c => c.launch === 'uart_clk_10')!
  assert.equal(x.status, 'unconstrained')
  assert.equal(x.toBuses.find(b => b.bus === 'vga_text:u_txt|char_wr_data[*]')?.width, 8)
  const back = r.crossings.find(c => c.latch === 'uart_clk_10')!
  assert.ok(back.toBuses[0].synchronized)
})

test('applying the suggested set_clock_groups re-runs the analysis and removes the CDC failures', () => {
  const { report, r } = vgaRun()
  const fixes = buildFixes(r, mergeClocks(report.clocks, parseSdc(vga().sdc)))
  const cdc = fixes.find(f => f.cause === 'cdc')!
  assert.match(cdc.sdc!, /set_clock_groups -asynchronous/)
  const sdc2 = applyToSdc(vga().sdc, cdc, '2026-11-10')
  assert.equal(applyToSdc(sdc2, cdc), sdc2, 'applying twice is a no-op')
  const r2 = analyze({ report, sdcText: sdc2 })
  assert.equal(r2.failing, r.failing - 10)
  assert.ok(!r2.causes.some(c => c.cause === 'cdc'))
  assert.ok(r2.crossings.every(c => c.status === 'cut'))
  assert.ok(r2.tns > r.tns)
  assert.ok(!r2.lint.some(l => l.rule === 'clock_groups'))
})

test('fix list covers every failing cause and is ordered by recoverable TNS', () => {
  const { report, r } = vgaRun()
  const fixes = buildFixes(r, mergeClocks(report.clocks, parseSdc(vga().sdc)))
  for (const c of r.causes) assert.ok(fixes.some(f => f.cause === c.cause), c.cause)
  const withPaths = fixes.filter(f => f.pathIds.length)
  for (let i = 1; i < withPaths.length; i++) assert.ok(withPaths[i - 1].tns <= withPaths[i].tns)
  const io = fixes.find(f => f.cause === 'io')!
  assert.match(io.sdc!, /set_input_delay .* \[get_ports \{UART_RX\}\]/)
  assert.match(io.sdc!, /set_output_delay .* \[get_ports \{LEDR\[\*\]\}\]/)
  assert.match(fixes.find(f => f.cause === 'fanout')!.qsf!, /MAX_FANOUT/)
  assert.ok(fixes.some(f => f.id.startsWith('sdc:multicycle_hold')))
})

test('Fmax estimate and frequency what-if', () => {
  assert.equal(fmax(10, -2.5), 80)
  assert.equal(fmax(10, 0), 100)
  const { r } = vgaRun()
  const sys = 'u_pll|altpll_component|auto_generated|pll1|clk[1]'
  const st = r.clocks.find(c => c.clock === sys)!
  const atFmax = whatIfFrequency(r, sys, st.fmax!)!
  assert.equal(atFmax.failing, 0)
  assert.ok(Math.abs(atFmax.wns!) < 0.002)
  const at100 = whatIfFrequency(r, sys, 100)!
  assert.equal(at100.failing, r.paths.filter(p => p.latch === sys && p.launch === sys && p.slack < 0 && p.analysis === 'setup').length)
})

test('groups failing paths by clock pair and by register bus', () => {
  const { r } = vgaRun()
  const pair = r.pairs.find(g => g.launch === 'uart_clk_10' && g.latch === PIX)!
  assert.equal(pair.failing, 9)
  const b = r.buses.find(g => g.label === 'alpha_blend:u_blend|alpha_q[*] → alpha_blend:u_blend|pix_out[*]')!
  assert.equal(b.failing, 12)
  assert.equal(bus('u_rx/data_reg[3]/D'), 'u_rx/data_reg[*]')
})

test('snapshots compare: fixed and new failing endpoints', () => {
  const { report, r } = vgaRun()
  const a = snapshot(r, '1', 'Run 1', 1)
  const cdc = buildFixes(r, mergeClocks(report.clocks, parseSdc(vga().sdc))).find(f => f.cause === 'cdc')!
  const b = snapshot(analyze({ report, sdcText: applyToSdc(vga().sdc, cdc) }), '2', 'Run 2', 2)
  const d = compare(a, b)
  assert.equal(d.failing, -10)
  assert.ok(d.fixed.some(e => e.startsWith('vga_text:u_txt|char_wr_data[0]')))
  assert.equal(d.added.length, 0)
  assert.ok(d.wns >= 0)
})

test('CSV export has one row per path, quoting node names with commas', () => {
  const r = analyze({ report: parseReport(mini([{ to: 'top:u|q[0],x' }])) })
  const csv = pathsCsv(r).trim().split('\n')
  assert.equal(csv.length, 2)
  assert.match(csv[1], /"top:u\|q\[0\],x"/)
})

// ---------- Real public reports (see fixtures/ for sources and licences) ----------

const avr = () => parseReport(AVR_CPU_STA)
const pitaya = () => parseReport(RED_PITAYA_TIMING)

test('real Quartus II 14.0 .sta.rpt: summary, device, corners and the tool\'s own Fmax', () => {
  const r = avr()
  assert.equal(r.format, 'quartus')
  assert.deepEqual(r.meta, { tool: 'Quartus II 14.0.0 Web', design: 'MCU', device: 'EP4CE22F17C6', state: 'Cyclone IV E' })
  assert.deepEqual(r.clocks.map(c => [c.name, c.period]), [['clock', 1]])
  const setup = r.summary.find(s => s.analysis === 'setup')!
  assert.deepEqual([setup.slack, setup.tns, setup.corner], [-14.744, -5828.793, 'Slow 1200mV 85C Model'])
  assert.equal(r.summary.find(s => s.analysis === 'hold')!.corner, 'Fast 1200mV 0C Model')
  assert.equal(r.fmax![0].fmax, 63.52)
  // Hand check of the Fmax formula against the figure Quartus prints: 1000 / (1.000 + 14.744).
  assert.equal(Math.round(fmax(1, -14.744)! * 100) / 100, 63.52)
  assert.deepEqual(r.counts, { inputPorts: 18, outputPorts: 8, clocks: 0 })
})

test('real report with no SDC: the 1 ns derive_clocks placeholder is the root cause of every failure', () => {
  const report = avr()
  assert.deepEqual(report.defaultClocks, ['clock'])
  assert.ok(report.issues.some(i => /No SDC file was found \(MCU\.sdc\)/.test(i.message)))
  const r = analyze({ report })
  assert.ok(r.failing > 0)
  assert.deepEqual(r.causes.map(c => c.cause), ['noclock'])
  // Headline numbers come from the summary tables, which cover every endpoint, not just the listed rows.
  assert.equal(r.wns, -14.744)
  assert.equal(r.tns, -5828.793)
  assert.equal(r.clocks[0].fmaxFrom, 'report')
  const fix = buildFixes(r, r.clockDefs)[0]
  assert.equal(fix.cause, 'noclock')
  assert.match(fix.sdc!, /create_clock -name \{clock\} -period 20\.000 \[get_ports \{clock\}\]/)
  assert.match(fix.sdc!, /derive_clock_uncertainty/)
})

test('applying the clock fix re-times same-clock setup paths by the period change and leaves hold alone', () => {
  const report = avr()
  const before = analyze({ report })
  const sdc = applyToSdc('', buildFixes(before, before.clockDefs)[0], '2026-11-15')
  const after = analyze({ report, sdcText: sdc })
  assert.deepEqual(after.retimed, [{ clock: 'clock', from: 1, to: 20, sdcName: 'clock' }])
  assert.equal(after.wns, 4.256) // -14.744 + (20 - 1)
  assert.equal(after.failing, 0)
  assert.equal(after.tns, 0)
  assert.equal(after.holdWns, before.holdWns)
  assert.deepEqual(after.defaultClocks, [])
  assert.ok(!buildFixes(after, after.clockDefs).some(f => f.cause === 'noclock'))
})

test('an SDC clock under another name on the same pin also replaces the placeholder', () => {
  const r = analyze({ report: avr(), sdcText: 'create_clock -name sys_clk -period 15.000 [get_ports {clock}]' })
  assert.equal(r.retimed[0].to, 15)
  assert.deepEqual(r.clockDefs.map(c => c.name), ['clock'])
  assert.equal(r.clocks[0].period, 15)
  assert.ok(r.failing > 0) // 15.744 ns is needed, 15 ns is given
  assert.equal(r.wns, -0.744)
})

test('the same path in two operating corners is one path with the worst corner\'s numbers', () => {
  const head = ['Slack', 'From Node', 'To Node', 'Launch Clock', 'Latch Clock', 'Relationship', 'Clock Skew', 'Data Delay']
  const row = (slack: string, delay: string) => [[slack, 'a|r', 'a|q', 'clk', 'clk', '10.000', '-0.050', delay]]
  const text = [quartusTable("Slow 1200mV 0C Model Setup: 'clk'", head, row('-0.400', '10.300')), quartusTable("Slow 1200mV 85C Model Setup: 'clk'", head, row('-1.100', '11.000')), quartusTable("Fast 1200mV 0C Model Setup: 'clk'", head, row('4.200', '5.700'))].join('\n\n')
  const r = parseReport(text)
  assert.equal(r.paths.length, 1)
  assert.deepEqual([r.paths[0].slack, r.paths[0].dataDelay, r.paths[0].corner], [-1.1, 11, 'Slow 1200mV 85C Model'])
})

test('Quartus II 9.x messages have no numbers: the default clock is still detected from the text', () => {
  const text = [
    quartusTable('Clocks', ['Clock Name', 'Type', 'Period', 'Frequency', 'Rise', 'Fall', 'Master', 'Source', 'Targets'], [['SCLK', 'Base', '1.000', '1000.0 MHz', '0.000', '0.500', '', '', '{ SCLK }']]),
    quartusTable('Setup Summary', ['Clock', 'Slack', 'End Point TNS'], [['SCLK', '-8.800', '-131.200']]),
    'Info: No user constrained base clocks found in the design. Calling "derive_clocks -period 1.0"', 'Info: Deriving Clocks', '    Info: create_clock -period 1.000 -name SCLK SCLK', 'Critical Warning: Timing requirements not met',
  ].join('\n')
  const r = parseReport(text)
  assert.deepEqual(r.defaultClocks, ['SCLK'])
  const a = analyze({ report: r })
  assert.equal(a.summaryOnly, true)
  assert.deepEqual([a.wns, a.tns], [-8.8, -131.2])
  assert.equal(a.clocks[0].isDefault, true)
})

test('a constrained 1 ns clock is not mistaken for the placeholder', () => {
  const r = parseReport(mini([{ slack: -0.2, rel: 1 }], [{ name: 'a', period: 1 }]))
  assert.equal(r.defaultClocks, undefined)
  assert.notEqual(analyze({ report: r }).causes[0].cause, 'noclock')
})

test('opposite-edge transfers are found from a relationship of half the period', () => {
  const clocks = [{ name: 'pll|clk[0]', period: 13.468 }]
  assert.equal(isHalfCycle({ id: 'x', analysis: 'setup', slack: -6.9, from: 'a', to: 'b', launch: 'pll|clk[0]', latch: 'pll|clk[0]', relationship: 6.734, line: 1 }, clocks), true)
  assert.equal(isHalfCycle({ id: 'x', analysis: 'setup', slack: -6.9, from: 'a', to: 'b', launch: 'pll|clk[0]', latch: 'pll|clk[0]', relationship: 13.468, line: 1 }, clocks), false)
  const report = parseReport(mini([{ from: 'sync:u|y_out[8]', to: 'osd:u|rom:r|ram_block1a1~porta_address_reg4', launch: 'a', latch: 'a', rel: 5, delay: 9.2, slack: -4.4, levels: 3 }]))
  const r = analyze({ report })
  assert.equal(r.paths[0].cause, 'edge')
  const fix = buildFixes(r, r.clockDefs).find(f => f.cause === 'edge')!
  assert.match(fix.title, /get 5\.000 ns, not 10\.000 ns/)
  assert.match(fix.why, /would fit in a full cycle/)
})

test('hold failures are never blamed on logic depth, and summary-only paths longer than the period are', () => {
  const ctx = { clocks: [{ name: 'a', period: 10 }], sdc: null, ports: new Set<string>(), s: DEFAULT_SETTINGS }
  const base: TimingPath = { id: 'x', analysis: 'hold', slack: -0.3, from: 'u|r', to: 'u|q', launch: 'a', latch: 'a', levels: 12, fanout: 900, line: 1 }
  assert.equal(classify(base, ctx).cause, 'skew')
  assert.equal(classify({ ...base, analysis: 'setup', levels: undefined, fanout: undefined, relationship: 10, dataDelay: 13.2, skew: -0.4 }, ctx).cause, 'logic')
  assert.equal(classify({ ...base, analysis: 'setup', levels: 2, fanout: 3, relationship: 10, dataDelay: 9.9, logicDelay: 7.1, routeDelay: 2.8 }, ctx).cause, 'logic')
  assert.equal(classify({ ...base, analysis: 'setup', levels: 2, fanout: 3, relationship: 10, dataDelay: 9.9, logicDelay: 2.1, routeDelay: 7.8 }, ctx).cause, 'route')
})

test('unconstrained port tables repeated for setup and hold are counted once; undefined clocks get a fix', () => {
  const ports = quartusTable('Unconstrained Input Ports', ['Input Port', 'Comment'], [['KEY0', 'No input delay'], ['SW[1]', 'No input delay']])
  const text = [quartusTable('Clocks', ['Clock Name', 'Type', 'Period'], [['CLOCK_50', 'Base', '20.000']]), ports, ports, 'Warning (332060): Node: clk_div was determined to be a clock but was found without an associated clock assignment.'].join('\n\n')
  const report = parseReport(text)
  assert.equal(report.unconstrained.filter(u => u.kind === 'input').length, 2)
  const r = analyze({ report })
  assert.deepEqual(r.unconstrainedClocks, ['clk_div'])
  assert.ok(buildFixes(r, r.clockDefs).some(f => f.id === 'undefined-clocks' && /create_clock -name \{clk_div\}/.test(f.sdc!)))
  assert.deepEqual(analyze({ report, sdcText: 'create_clock -name clk_div -period 40 [get_ports clk_div]' }).unconstrainedClocks, [])
})

test('a report with no clocks at all says so instead of blaming the export', () => {
  const r = parseReport([quartusTable('Unconstrained Paths', ['Property', 'Setup', 'Hold'], [['Unconstrained Clocks', '0', '0']]), 'Warning (332068): No clocks defined in design.'].join('\n'))
  assert.match(r.issues.find(i => i.level === 'error')!.message, /no clocks and no timed paths/)
})

test('real Vivado 2024.2 report_timing_summary: design totals, clock tree and per-clock tables', () => {
  const r = pitaya()
  assert.equal(r.format, 'vivado')
  assert.deepEqual(r.meta, { tool: 'Vivado 2024.2', design: 'red_pitaya_top', device: '7z010-clg400', state: 'Routed' })
  assert.deepEqual(r.totals!.setup, { wns: -4.965, tns: -12868.471, failing: 11287, total: 36492 })
  assert.deepEqual(r.totals!.hold, { wns: -2.162, tns: -58.825, failing: 28, total: 36492 })
  assert.equal(r.clocks.length, 12)
  assert.deepEqual([r.clocks.find(c => c.name === 'pll_adc_clk')!.master, r.clocks.find(c => c.name === 'adc_clk')!.master, r.clocks.find(c => c.name === 'clk_fpga_0')!.master], ['adc_clk', undefined, undefined])
  const s = r.summary.find(x => x.clock === 'pll_adc_clk' && x.analysis === 'setup')!
  assert.deepEqual([s.slack, s.tns, s.failing, s.total], [-4.965, -12866.211, 11273, 34256])
  // Clocks with only pulse-width numbers in the Intra Clock Table have no setup or hold summary.
  assert.equal(r.summary.some(x => x.clock === 'clk_fb'), false)
  assert.deepEqual(r.transfers[0], { from: 'adc_clk', to: 'pll_adc_clk', paths: 28, falsePath: false, wns: 5.939, failing: 0, holdWns: -2.162, holdFailing: 28 })
  assert.deepEqual(r.counts, { inputPorts: 16, outputPorts: 46 })
})

test('real Vivado report: headline numbers are the design totals, not just the 14 listed paths', () => {
  const report = pitaya()
  const r = analyze({ report, sdcText: RED_PITAYA_XDC })
  assert.equal(report.paths.length, 14)
  assert.deepEqual([r.wns, r.tns, r.holdWns, r.holdTns], [-4.965, -12868.471, -2.162, -58.825])
  assert.deepEqual(r.endpoints, { failing: 11287, total: 36492, holdFailing: 28 })
  assert.equal(r.clocks.find(c => c.clock === 'pll_adc_clk')!.endpoints, 11273)
  // 8 ns period, -4.965 ns worst same-clock slack: 1000 / 12.965.
  assert.equal(Math.round(r.clocks.find(c => c.clock === 'pll_adc_clk')!.fmax! * 100) / 100, 77.13)
  const x = r.crossings.find(c => c.launch === 'adc_clk' && c.latch === 'pll_adc_clk')!
  assert.deepEqual([x.status, x.failing, x.wns], ['related', 28, -2.162])
})

test('real Vivado report: the worst path is a DSP48 and carry-chain cone, and the fix says so', () => {
  const r = analyze({ report: pitaya(), sdcText: RED_PITAYA_XDC })
  const worst = [...r.paths].sort((a, b) => a.slack - b.slack)[0]
  assert.deepEqual([worst.cause, worst.levels, worst.levelDetail, worst.logicDelay, worst.routeDelay, worst.dataDelay], ['logic', 19, 'CARRY4=14 DSP48E1=2 LUT1=1 LUT2=1 LUT5=1', 9.429, 3.333, 12.762])
  const fix = buildFixes(r, r.clockDefs).find(f => f.cause === 'logic')!
  assert.ok(fix.steps.some(s => /DSP48/.test(s) && /74%/.test(s)))
  assert.ok(fix.steps.some(s => /14 carry cells/.test(s)))
  // The ADC data inputs fail hold against the PLL clock: an I/O timing problem, not logic.
  const adc = r.paths.find(p => p.from === 'adc_dat_b_i[3]')!
  assert.deepEqual([adc.analysis, adc.cause, adc.slack], ['hold', 'io', -2.162])
  // A 77% routing, 3-level path with 0.117 ns of skew on -0.216 ns slack is routing, not skew.
  assert.equal(r.paths.find(p => p.slack === -0.216)!.cause, 'route')
})

test('real XDC: false paths that name clocks missing from the design are flagged, and check_timing clocks get a fix', () => {
  const r = analyze({ report: pitaya(), sdcText: RED_PITAYA_XDC })
  const unknown = r.lint.filter(l => l.rule === 'unknown_clock')
  assert.equal(unknown.length, 6)
  assert.match(unknown[0].message, /^dac_clk_out is not a clock/)
  assert.ok(!unknown.some(l => /\badc_clk\b is not/.test(l.message)))
  assert.deepEqual(r.unconstrainedClocks, ['i_hk/dna_clk_reg/Q'])
  const fix = buildFixes(r, r.clockDefs).find(f => f.id === 'undefined-clocks')!
  assert.match(fix.sdc!, /create_generated_clock -name dna_clk_reg -source \[get_pins \{i_hk\/dna_clk_reg\/C\}\] -divide_by 2 \[get_pins \{i_hk\/dna_clk_reg\/Q\}\]/)
})

test('clock periods are suggested from the pin name, then from Fmax', () => {
  assert.deepEqual([mhzFromName('CLOCK_50'), mhzFromName('CLOCK_27_0'), mhzFromName('CLK50M'), mhzFromName('clk_12mhz'), mhzFromName('clk'), mhzFromName('pll|clk[0]'), mhzFromName('clock2')], [50, 27, 50, 12, null, null, null])
  assert.deepEqual(suggestPeriod('CLOCK_50', 256.4), { period: 20, mhz: 50, from: 'name' })
  assert.deepEqual(suggestPeriod('clock', 63.52), { period: 20, mhz: 50, from: 'fmax' })
  assert.deepEqual(suggestPeriod('SCLK', 102.04), { period: 10, mhz: 100, from: 'fmax' })
  assert.equal(suggestPeriod('clk', null).from, 'guess')
})

test('all four samples parse without errors and the real ones carry their source and licence', () => {
  for (const s of samples()) {
    const r = parseReport(s.report)
    assert.equal(r.format, s.format, s.id)
    assert.equal(r.issues.filter(i => i.level === 'error').length, 0, s.id)
  }
  assert.deepEqual(samples().filter(s => s.real).map(s => [s.id, s.real!.licence]), [['avr-cpu', 'MIT'], ['red-pitaya', 'MIT']])
})

test('fixes speak the tool the report came from: no Quartus assignments on a Vivado design', () => {
  const r = analyze({ report: pitaya(), sdcText: RED_PITAYA_XDC })
  const fixes = buildFixes(r, r.clockDefs)
  const text = JSON.stringify(fixes)
  assert.doesNotMatch(text, /set_instance_assignment|set_global_assignment|get_registers|Chip Planner|Fitter/)
  assert.match(fixes.find(f => f.cause === 'io')!.qsf!, /set_property IOB TRUE \[get_ports \{adc_dat_b_i\[\*\]\}\]/)
  assert.ok(fixes.find(f => f.cause === 'io')!.steps.some(s => /failing check is hold/.test(s)))
  const q = analyze({ report: parseReport(vga().report), sdcText: vga().sdc })
  assert.match(JSON.stringify(buildFixes(q, q.clockDefs)), /set_instance_assignment/)
})
