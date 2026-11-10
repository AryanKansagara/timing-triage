import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectFormat, parseReport, quartusTables } from './parse.ts'
import { clocksCut, collection, lintSdc, parseSdc, pathCut, statements, tokenize } from './sdc.ts'
import { analyze, bus, classify, fmax, mergeClocks, rootClock, whatIfFrequency } from './analyze.ts'
import { applyToSdc, buildFixes, pathsCsv } from './fixes.ts'
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
  assert.equal(classify({ ...base, skew: -0.4 }, ctx).cause, 'skew')
  assert.equal(classify({ ...base, skew: -0.1 }, ctx).cause, 'route')
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
