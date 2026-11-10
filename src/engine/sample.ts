// Synthetic sample designs. Every number here is generated; the reports are rendered in the same
// text format the real tools write, so the samples go through the same parsers as your files.
import type { Analysis, Clock } from './types.ts'

export interface SamplePath { analysis: Analysis; slack: number; from: string; to: string; launch: string; latch: string; rel: number; skew: number; delay: number; levels: number; fanout: number }
export interface SampleDef { id: string; name: string; blurb: string; device: string; format: 'quartus' | 'vivado'; report: string; sdc: string; sdcName: string; reportName: string }

function rng(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
const r3 = (n: number) => Math.round(n * 1000) / 1000

// ---------- VGA + UART on Cyclone V (Quartus) ----------

const PIX = 'u_pll|altpll_component|auto_generated|pll1|clk[0]'
const SYS = 'u_pll|altpll_component|auto_generated|pll1|clk[1]'
const UART = 'uart_clk_10'
export const VGA_CLOCKS: Clock[] = [
  { name: 'clk_50', period: 20, kind: 'base', source: 'CLOCK_50' },
  { name: UART, period: 100, kind: 'base', source: 'UART_CLK' },
  { name: PIX, period: 39.801, kind: 'generated', master: 'clk_50', source: 'u_pll|altpll_component|auto_generated|pll1|inclk[0]' },
  { name: SYS, period: 10, kind: 'generated', master: 'clk_50', source: 'u_pll|altpll_component|auto_generated|pll1|inclk[0]' },
]

export function vgaPaths(seed = 7): SamplePath[] {
  const rnd = rng(seed)
  const out: SamplePath[] = []
  const p = (x: Omit<SamplePath, 'slack'>, slack?: number) => {
    const s = slack ?? r3(x.rel + x.skew - x.delay - 0.06)
    out.push({ ...x, slack: r3(s) })
  }
  // Planted: UART RX byte crossing straight into the pixel domain (no synchronizer, no clock groups).
  for (let b = 0; b < 8; b++) p({ analysis: 'setup', from: `uart_rx:u_rx|rx_data[${b}]`, to: `vga_text:u_txt|char_wr_data[${b}]`, launch: UART, latch: PIX, rel: 0.199, skew: r3(-0.21 - rnd() * 0.15), delay: r3(1.6 + rnd() * 0.9), levels: 1, fanout: 2 })
  p({ analysis: 'setup', from: 'uart_rx:u_rx|rx_valid', to: 'vga_text:u_txt|char_wr_en', launch: UART, latch: PIX, rel: 0.199, skew: -0.244, delay: 1.912, levels: 2, fanout: 3 })
  // Planted: busy flag back into the UART domain. Destination is already a synchronizer stage.
  p({ analysis: 'setup', from: 'vga_text:u_txt|busy', to: 'uart_tx:u_tx|busy_meta', launch: PIX, latch: UART, rel: 0.801, skew: 0.12, delay: 1.744, levels: 0, fanout: 1 })
  // Planted: alpha blend cone at 100 MHz with too many levels of logic.
  for (let b = 0; b < 12; b++) {
    const levels = 11 + Math.floor(rnd() * 4)
    p({ analysis: 'setup', from: `alpha_blend:u_blend|alpha_q[${b % 8}]`, to: `alpha_blend:u_blend|pix_out[${b}]`, launch: SYS, latch: SYS, rel: 10, skew: r3(-0.05 + rnd() * 0.08), delay: r3(8.9 + levels * 0.21 + rnd() * 0.5), levels, fanout: 9 })
  }
  // Planted: reset register with huge fanout.
  for (let k = 0; k < 6; k++) p({ analysis: 'setup', from: 'rst_sync:u_rst|rst_n_q', to: `sprite_engine:u_spr|x_pos[${k * 2}]`, launch: SYS, latch: SYS, rel: 10, skew: -0.08, delay: r3(9.95 + rnd() * 0.45), levels: 1, fanout: 1452 })
  // Planted: VGA sync outputs with a tight output delay.
  for (const port of ['VGA_HS', 'VGA_VS']) p({ analysis: 'setup', from: `vga_text:u_txt|${port.toLowerCase()}_q`, to: port, launch: PIX, latch: PIX, rel: 39.801, skew: -1.9, delay: 7.4, levels: 0, fanout: 1 }, port === 'VGA_HS' ? -0.418 : -0.231)
  // Planted: hold failure on a clock routed through local interconnect.
  p({ analysis: 'hold', from: 'uart_tx:u_tx|baud_cnt[3]', to: 'uart_tx:u_tx|baud_cnt[4]', launch: UART, latch: UART, rel: 0, skew: 0.952, delay: 0.771, levels: 1, fanout: 4 }, -0.184)
  // Passing paths across the design.
  const blocks: [string, string, string, number][] = [
    ['vga_timing:u_tim|h_cnt', 'vga_timing:u_tim|h_cnt', PIX, 39.801], ['vga_timing:u_tim|v_cnt', 'vga_text:u_txt|row_addr', PIX, 39.801],
    ['vga_text:u_txt|glyph_q', 'vga_text:u_txt|pixel_q', PIX, 39.801], ['sprite_engine:u_spr|y_pos', 'sprite_engine:u_spr|hit', SYS, 10],
    ['fifo:u_fifo|wr_ptr', 'fifo:u_fifo|mem', SYS, 10], ['uart_rx:u_rx|bit_cnt', 'uart_rx:u_rx|shift_reg', UART, 100],
    ['uart_tx:u_tx|shift_reg', 'uart_tx:u_tx|tx_q', UART, 100], ['ctrl:u_ctrl|state', 'ctrl:u_ctrl|cfg', 'clk_50', 20],
  ]
  for (let i = 0; i < 150; i++) {
    const [f, t, c, per] = blocks[i % blocks.length]
    const levels = 1 + Math.floor(rnd() * (per < 15 ? 6 : 8))
    const delay = r3(0.9 + levels * 0.55 + rnd() * (per < 15 ? 3.5 : per * 0.6))
    p({ analysis: 'setup', from: `${f}[${i % 11}]`, to: `${t}[${(i * 7) % 13}]`, launch: c, latch: c, rel: per, skew: r3(-0.12 + rnd() * 0.2), delay: Math.min(delay, per - 0.4), levels, fanout: 1 + Math.floor(rnd() * 20) })
  }
  for (let i = 0; i < 40; i++) {
    const [f, t, c] = blocks[i % blocks.length]
    p({ analysis: 'hold', from: `${f}[${i % 9}]`, to: `${t}[${(i * 5) % 11}]`, launch: c, latch: c, rel: 0, skew: r3(0.02 + rnd() * 0.1), delay: 0, levels: 1, fanout: 2 }, r3(0.12 + rnd() * 0.6))
  }
  return out
}

export const VGA_SDC = `# vga_uart_top.sdc  (synthetic sample)
# Board: 50 MHz oscillator for video, separate 10 MHz oscillator for the UART.

create_clock -name clk_50 -period 20.000 [get_ports {CLOCK_50}]
create_clock -name uart_clk_10 -period 100.000 [get_ports {UART_CLK}]

derive_pll_clocks

# VGA sync to the DAC: 2 ns setup at the monitor connector buffer
set_output_delay -clock [get_clocks {u_pll|altpll_component|auto_generated|pll1|clk[0]}] 2.000 [get_ports {VGA_HS VGA_VS}]

# Scaler coefficients only update during blanking
set_multicycle_path -setup 2 -from [get_registers {scaler:u_scl|coef*}] -to [get_registers {scaler:u_scl|acc*}]

set_false_path -from [get_ports {KEY[*]}]
`

// ---------- Text rendering in Quartus Timing Analyzer panel format ----------

export function quartusTable(title: string, header: string[], rows: (string | number)[][]) {
  const all = [header, ...rows.map(r => r.map(String))]
  const w = header.map((_, i) => Math.max(...all.map(r => (r[i] ?? '').length)))
  const border = '+' + w.map(x => '-'.repeat(x + 2)).join('+') + '+'
  const row = (r: string[]) => '; ' + r.map((c, i) => (c ?? '').padEnd(w[i])).join(' ; ') + ' ;'
  const full = border.length - 4
  return ['+' + '-'.repeat(border.length - 2) + '+', '; ' + title.padEnd(full) + ' ;', border, row(header), border, ...rows.map(r => row(r.map(String))), border].join('\n')
}

const ns = (n: number) => n.toFixed(3)

export function renderQuartus(paths: SamplePath[], clocks: Clock[], extra: { unconstrainedIn?: string[]; unconstrainedOut?: string[]; device: string; design: string }) {
  const parts: string[] = []
  parts.push(`Timing Analyzer report for ${extra.design}`, `Device: ${extra.device}`, `This report is synthetic sample data generated by Timing Triage.`, '')
  parts.push(quartusTable('Clocks', ['Clock Name', 'Type', 'Period', 'Frequency', 'Rise', 'Fall', 'Duty Cycle', 'Master', 'Source', 'Targets'],
    clocks.map(c => [c.name, c.kind === 'generated' ? 'Generated' : c.kind === 'virtual' ? 'Virtual' : 'Base', ns(c.period), `${(1000 / c.period).toFixed(2)} MHz`, '0.000', ns(c.period / 2), '50.00', c.master ?? '', c.kind === 'generated' ? c.source ?? '' : '', c.source ?? ''])), '')
  for (const an of ['setup', 'hold'] as const) {
    const ps = paths.filter(p => p.analysis === an)
    const per = [...new Set(ps.map(p => p.latch))].map(c => {
      const mine = ps.filter(p => p.latch === c)
      const worst = new Map<string, number>()
      for (const p of mine) if (p.slack < 0) worst.set(p.to, Math.min(worst.get(p.to) ?? 0, p.slack))
      return [c, ns(Math.min(...mine.map(p => p.slack))), ns([...worst.values()].reduce((a, b) => a + b, 0))]
    }).sort((a, b) => Number(a[1]) - Number(b[1]))
    parts.push(quartusTable(`Slow 1100mV 85C Model ${an === 'setup' ? 'Setup' : 'Hold'} Summary`, ['Clock', 'Slack', 'End Point TNS'], per), '')
  }
  const xfer = new Map<string, number>()
  for (const p of paths.filter(p => p.analysis === 'setup')) xfer.set(p.launch + '\u0000' + p.latch, (xfer.get(p.launch + '\u0000' + p.latch) ?? 0) + 1)
  parts.push(quartusTable('Setup Transfers', ['From Clock', 'To Clock', 'RR Paths', 'FR Paths', 'RF Paths', 'FF Paths'], [...xfer].map(([k, n]) => [...k.split('\u0000'), n, 0, 0, 0])), '')
  if (extra.unconstrainedIn?.length) parts.push(quartusTable('Unconstrained Input Ports', ['Input Port', 'Comment'], extra.unconstrainedIn.map(p => [p, 'No input delay, min/max delays, false-path exceptions, or max skew assignments found'])), '')
  if (extra.unconstrainedOut?.length) parts.push(quartusTable('Unconstrained Output Ports', ['Output Port', 'Comment'], extra.unconstrainedOut.map(p => [p, 'No output delay, min/max delays, false-path exceptions, or max skew assignments found'])), '')

  for (const an of ['setup', 'hold'] as const) {
    const ps = paths.filter(p => p.analysis === an).sort((a, b) => a.slack - b.slack)
    const bad = ps.filter(p => p.slack < 0)
    parts.push(`Info: Report Timing: Found ${ps.length} ${an} paths (${bad.length} violated).  Worst case slack is ${ns(ps[0]?.slack ?? 0)}`)
    parts.push(quartusTable('Summary of Paths', ['Slack', 'From Node', 'To Node', 'Launch Clock', 'Latch Clock', 'Relationship', 'Clock Skew', 'Data Delay'],
      ps.map(p => [ns(p.slack), p.from, p.to, p.launch, p.latch, ns(p.rel), ns(p.skew), ns(p.delay)])), '')
    bad.forEach((p, i) => {
      const launchT = an === 'setup' ? 0 : 0
      const clkLat = 2.8
      const arrival = r3(launchT + clkLat + p.delay)
      const required = r3(arrival + p.slack)
      parts.push(`Info: Path #${i + 1}: ${an === 'setup' ? 'Setup' : 'Hold'} slack is ${ns(p.slack)} (VIOLATED)`)
      parts.push(quartusTable('Path Summary', ['Property', 'Value'], [['From Node', p.from], ['To Node', p.to], ['Launch Clock', p.launch], ['Latch Clock', p.latch], ['Data Arrival Time', ns(arrival)], ['Data Required Time', ns(required)], ['Slack', `${ns(p.slack)} (VIOLATED)`]]), '')
      parts.push(quartusTable('Statistics', ['Property', 'Value', 'Count', 'Total Name', 'Min', 'Avg', 'Max'], [[`${an === 'setup' ? 'Setup' : 'Hold'} Relationship`, ns(p.rel), '', '', '', '', ''], ['Clock Skew', ns(p.skew), '', '', '', '', ''], ['Data Delay', ns(p.delay), '', '', '', '', ''], ['Number of Logic Levels', String(p.levels), '', '', '', '', '']]), '')
      const rows: (string | number)[][] = [[ns(0), ns(0), '', '', '', '', 'launch edge time'], [ns(clkLat), ns(clkLat), '', '', '', '', 'clock path'], [ns(0), ns(0), 'R', '', '', '', 'clock network delay'], [ns(clkLat), ns(clkLat), 'R', 'CELL', 2140, 'CLKCTRL_G3', `${p.launch}~clkctrl|outclk`], [ns(clkLat + p.delay), ns(p.delay), '', '', '', '', 'data path']]
      let t = clkLat
      const step = p.delay / (p.levels + 1)
      rows.push([ns(t += 0.232), ns(0.232), 'RR', 'uTco', p.fanout, 'FF_X40_Y12_N1', p.from])
      for (let k = 0; k < p.levels; k++) rows.push([ns(t += step), ns(step), 'RR', 'CELL', k === 0 ? p.fanout : 1 + (k % 3), `LCCOMB_X41_Y${12 + k}_N${k % 4}`, `${p.to.split('|')[0]}|add_${k}~combout`])
      rows.push([ns(t += 0.1), ns(0.1), 'RR', 'CELL', 1, 'FF_X44_Y20_N9', p.to])
      parts.push(quartusTable('Data Arrival Path', ['Total', 'Incr', 'RF', 'Type', 'Fanout', 'Location', 'Element'], rows), '')
    })
  }
  return parts.join('\n')
}

// ---------- Vivado report_timing_summary text ----------

export function renderVivado(paths: SamplePath[], clocks: Clock[], design: string) {
  const out: string[] = [
    'Copyright 1986-2026 Xilinx, Inc. All Rights Reserved. (synthetic sample generated by Timing Triage)',
    '------------------------------------------------------------------------------------',
    `| Tool Version : Vivado v.2025.1`, `| Design       : ${design}`, '| Command      : report_timing_summary -max_paths 10 -report_unconstrained', '------------------------------------------------------------------------------------', '',
    'Clock Summary', '-------------', '', 'Clock               Waveform(ns)         Period(ns)      Frequency(MHz)', '-----               ------------         ----------      --------------',
    ...clocks.map(c => `${c.name.padEnd(20)}{0.000 ${(c.period / 2).toFixed(3)}}`.padEnd(41) + `${ns(c.period).padEnd(16)}${(1000 / c.period).toFixed(3)}`), '', '',
    '1. checking no_input_delay (2)', 'There are 2 input ports with no input delay specified.', '',
  ]
  for (const p of [...paths].sort((a, b) => a.slack - b.slack)) {
    const per = (n: string) => clocks.find(c => c.name === n)?.period ?? 10
    out.push(
      `Slack (${p.slack < 0 ? 'VIOLATED' : 'MET'}) :        ${ns(p.slack)}ns  (required time - arrival time)`,
      `  Source:                 ${p.from}/C`, `                            (rising edge-triggered cell FDRE clocked by ${p.launch}  {rise@0.000ns fall@${ns(per(p.launch) / 2)}ns period=${ns(per(p.launch))}ns})`,
      `  Destination:            ${p.to}/D`, `                            (rising edge-triggered cell FDRE clocked by ${p.latch}  {rise@0.000ns fall@${ns(per(p.latch) / 2)}ns period=${ns(per(p.latch))}ns})`,
      `  Path Group:             ${p.latch}`, `  Path Type:              ${p.analysis === 'setup' ? 'Setup (Max at Slow Process Corner)' : 'Hold (Min at Fast Process Corner)'}`,
      `  Requirement:            ${ns(p.rel)}ns  (${p.latch} rise - ${p.launch} rise)`,
      `  Data Path Delay:        ${ns(p.delay)}ns  (logic ${ns(p.delay * 0.35)}ns  route ${ns(p.delay * 0.65)}ns)`,
      `  Logic Levels:           ${p.levels}`, `  Clock Path Skew:        ${ns(p.skew)}ns`, `  Clock Uncertainty:      0.035ns`, '',
      '    Location             Delay type                Incr(ns)  Path(ns)    Netlist Resource(s)',
      '  -------------------------------------------------------------------    -------------------',
      `                         (clock ${p.launch} rise edge)    0.000     0.000 r`, '                         net (fo=1890, routed)        1.400     1.400    clk_IBUF_BUFG',
      '  -------------------------------------------------------------------    -------------------',
      `                         FDRE (Prop_fdre_C_Q)         0.456     1.856 r  ${p.from}/Q`, `                         net (fo=${p.fanout}, routed)          ${ns(p.delay * 0.6)}     ${ns(1.856 + p.delay * 0.6)}    ${p.from}`,
      '  -------------------------------------------------------------------    -------------------',
      `                         (clock ${p.latch} rise edge)    ${ns(p.rel)}    ${ns(p.rel)} r`, '', '',
    )
  }
  return out.join('\n')
}

// ---------- Vivado sample: the same UART-to-video crossing on an Artix-7 ----------

export function arty(seed = 11): { paths: SamplePath[]; clocks: Clock[] } {
  const rnd = rng(seed)
  const clocks: Clock[] = [{ name: 'sys_clk_pin', period: 10 }, { name: 'clk_pix_clk_wiz_0', period: 39.801 }, { name: 'uart_clk', period: 100 }]
  const paths: SamplePath[] = []
  for (let b = 0; b < 4; b++) paths.push({ analysis: 'setup', from: `u_rx/rx_data_reg[${b}]`, to: `u_txt/char_wr_data_reg[${b}]`, launch: 'uart_clk', latch: 'clk_pix_clk_wiz_0', rel: 0.199, skew: -0.31, delay: r3(1.2 + rnd() * 0.6), levels: 0, fanout: 1, slack: 0 })
  for (let b = 0; b < 4; b++) { const lv = 12 + b; paths.push({ analysis: 'setup', from: `u_blend/alpha_q_reg[${b}]`, to: `u_blend/pix_out_reg[${b}]`, launch: 'sys_clk_pin', latch: 'sys_clk_pin', rel: 10, skew: -0.04, delay: r3(9.6 + lv * 0.11), levels: lv, fanout: 7, slack: 0 }) }
  for (let i = 0; i < 36; i++) { const c = clocks[i % 3]; const lv = 1 + Math.floor(rnd() * 5); paths.push({ analysis: 'setup', from: `u_core/s${i % 7}_reg[${i % 8}]`, to: `u_core/d${i % 5}_reg[${i % 6}]`, launch: c.name, latch: c.name, rel: c.period, skew: -0.05, delay: r3(1 + lv * 0.6 + rnd() * c.period * 0.5), levels: lv, fanout: 1 + Math.floor(rnd() * 12), slack: 0 }) }
  for (const p of paths) p.slack = r3(p.rel + p.skew - p.delay - 0.035)
  return { paths, clocks }
}

export const ARTY_XDC = `## arty_uart_vga.xdc  (synthetic sample)
create_clock -period 10.000 -name sys_clk_pin -waveform {0.000 5.000} [get_ports {CLK100MHZ}]
create_clock -period 100.000 -name uart_clk [get_ports {UART_CLK}]
set_input_delay -clock [get_clocks sys_clk_pin] -max 2.000 [get_ports {btn[*]}]
set_input_delay -clock [get_clocks sys_clk_pin] -min 0.500 [get_ports {btn[*]}]
`

let cache: SampleDef[] | null = null
export function samples(): SampleDef[] {
  if (cache) return cache
  const a = arty()
  cache = [
    {
      id: 'vga-uart', name: 'VGA text console + UART (Cyclone V)', device: '5CSEMA5F31C6 (synthetic)', format: 'quartus',
      blurb: 'A 25.125 MHz pixel clock from a PLL, a separate 10 MHz UART clock, an alpha-blend cone at 100 MHz and a reset with 1,452 loads.',
      reportName: 'vga_uart_top.sta.rpt', sdcName: 'vga_uart_top.sdc', sdc: VGA_SDC,
      report: renderQuartus(vgaPaths(), VGA_CLOCKS, { design: 'vga_uart_top', device: '5CSEMA5F31C6', unconstrainedIn: ['UART_RX', 'SW[0]', 'SW[1]'], unconstrainedOut: ['LEDR[0]', 'LEDR[1]', 'LEDR[2]', 'UART_TX'] }),
    },
    {
      id: 'arty', name: 'UART to VGA bridge (Artix-7, Vivado)', device: 'xc7a35ticsg324-1L (synthetic)', format: 'vivado',
      blurb: 'The same crossing ported to Vivado: report_timing_summary text with an MMCM pixel clock and an unconstrained UART crossing.',
      reportName: 'timing_summary.rpt', sdcName: 'arty_uart_vga.xdc', sdc: ARTY_XDC,
      report: renderVivado(a.paths, a.clocks, 'arty_uart_vga'),
    },
  ]
  return cache
}
