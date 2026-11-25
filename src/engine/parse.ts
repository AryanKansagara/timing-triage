// Parsers for Quartus Timing Analyzer panel text (report_timing -file, .sta.rpt, report_clocks,
// report_ucp, report_clock_transfers) and Vivado report_timing_summary / report_timing text.
import type { Analysis, Issue, Format, ParsedReport, TimingPath } from './types.ts'

const num = (s: string | undefined) => {
  if (s === undefined) return undefined
  const m = s.replace(/,/g, '').match(/-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i)
  return m ? Number(m[0]) : undefined
}
/** Slack decides pass or fail, so the whole cell has to be a number (with or without "ns"). */
const slackNum = (s: string | undefined) => s !== undefined && /^[+-]?(?:\d[\d,]*(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*(?:ns)?$/i.test(s.trim()) ? num(s) : undefined
/** Word, PDFs and web pages turn the minus of a number into U+2212 or an en dash. */
const asciiMinus = (t: string) => t.replace(/(^|[\s;:(])[\u2212\u2013](?=\.?\d)/gm, '$1-')

export function detectFormat(text: string): Format {
  const head = text.slice(0, 200_000)
  if (/Slack \((VIOLATED|MET)\)\s*:|report_timing_summary|Design Timing Summary|\bVivado\b/.test(head)) return 'vivado'
  if (/^\s*[;|].*;\s*$/m.test(head) && /^\s*\+-{3,}/m.test(head)) return 'quartus'
  if (/^\s*(create_clock|create_generated_clock|derive_pll_clocks|derive_clock_uncertainty|set_clock_groups|set_false_path|set_input_delay|set_output_delay|set_multicycle_path)\b/m.test(head)) return 'sdc'
  return 'unknown'
}

export function parseReport(raw: string): ParsedReport {
  const text = asciiMinus(raw)
  const format = detectFormat(text)
  if (format === 'quartus') return parseQuartus(text)
  if (format === 'vivado') return parseVivado(text)
  return {
    format, paths: [], clocks: [], summary: [], unconstrained: [], transfers: [], found: [],
    issues: [{ line: 1, level: 'error', message: format === 'sdc' ? 'This is an SDC file, not a timing report. Add it as constraints instead.' : 'Not a recognised timing report. Expected Quartus Timing Analyzer panel text (tables drawn with + - ; characters) or Vivado report_timing_summary text.' }],
  }
}

/** False when a file had a report's format but nothing in it was read: there is nothing to analyze. */
export const hasData = (r: ParsedReport) =>
  !!(r.paths.length || r.summary.length || r.clocks.length || r.transfers.length || r.unconstrained.length || r.totals || r.fmax?.length || r.pulse?.length || r.counts)

// ---------- Quartus ----------

interface Table { title: string; header: string[]; rows: { cells: string[]; line: number }[]; line: number; context: string }

const cells = (line: string) => line.trim().replace(/^;/, '').replace(/;$/, '').split(';').map(c => c.trim())
const isBorder = (l: string) => /^\s*\+[-+=]+\+?\s*$/.test(l)
const stripInfo = (l: string) => l.replace(/^\s*(Info|Warning|Critical Warning)\s*(\(\d+\))?:\s?/, '')

/** Splits Quartus panel text into tables. `context` is the most recent "Path #n" or "Found n setup paths" line. */
export function quartusTables(text: string): Table[] {
  const lines = text.split(/\r?\n/).map(stripInfo)
  const out: Table[] = []
  let context = ''
  let cur: Table | null = null
  let rowsSeen = 0, afterBorder = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (isBorder(l)) { afterBorder = true; continue }
    if (/^\s*;.*;\s*$/.test(l)) {
      const c = cells(l)
      // Pasted text often loses the blank lines between tables: a one-cell row right after a border is a new title.
      if (cur && cur.rows.length && c.length === 1 && afterBorder) { out.push(cur); cur = null }
      afterBorder = false
      if (!cur) { cur = { title: '', header: [], rows: [], line: i + 1, context }; rowsSeen = 0 }
      rowsSeen++
      if (rowsSeen === 1 && c.length === 1) cur.title = c[0]
      else if (!cur.header.length) cur.header = c
      else cur.rows.push({ cells: c, line: i + 1 })
      continue
    }
    if (cur) { out.push(cur); cur = null }
    if (/Path #\d+:\s*(Setup|Hold|Recovery|Removal) slack is/i.test(l) || /Found \d+ (setup|hold|recovery|removal) paths/i.test(l)) context = l.trim()
  }
  if (cur) out.push(cur)
  return out
}

/** Rows that lost their closing ; and a last table that never closes: the rest of the table is missing. */
function quartusCutOff(text: string, r: ParsedReport) {
  const lines = text.split(/\r?\n/).map(stripInfo)
  let open = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], row = /^\s*;/.test(l)
    if (row && !/;\s*$/.test(l)) r.issues.push({ line: i + 1, level: 'warn', message: `This table row is cut off, so it was not read and paths may be missing: "${l.trim().slice(0, 90)}"` })
    if (row) open = true
    else if (isBorder(l) || l.trim()) open = false
    // Pasted text can lose its borders, but a blank line still ends a table; only the end of the file does not.
    else if (i < lines.length - 1 && lines.slice(i).some(x => x.trim())) open = false
  }
  if (open && /^\s*\+-{3,}/m.test(text)) r.issues.push({ line: lines.length, level: 'warn', message: 'The file is cut off inside a table (no closing border), so rows may be missing. Export it again.' })
}

const analysisOf = (s: string): Analysis | null => {
  const m = s.match(/\b(setup|hold|recovery|removal)\b/i)
  return m ? m[1].toLowerCase() as Analysis : null
}

const defined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([k, v]) => v !== undefined && v !== '' && k !== 'id')) as Partial<T>
/** "Slow 1200mV 85C Model Setup: 'clk'" -> "Slow 1200mV 85C Model" */
const cornerOf = (title: string) => title.match(/^((?:slow|fast)\b.*?\bmodel)\b/i)?.[1]
const mhz = (s: string | undefined) => { const v = num(s); return v === undefined || !s ? undefined : /ghz/i.test(s) ? v * 1000 : /khz/i.test(s) ? v / 1000 : v }

/**
 * Reads the "Timing Analyzer Messages" section of a .sta.rpt: missing SDC, default 1 ns clocks,
 * ignored constraints and undefined clocks. Matches on message text because Quartus II before 12
 * prints no message numbers. Returns true when Quartus says there are no clocks at all.
 */
function quartusMessages(text: string, r: ParsedReport, unc: (kind: 'clock', name: string) => void): boolean {
  const lines = text.split(/\r?\n/)
  let derived = false, noClocks = false
  const named: string[] = []
  const seen = new Set<string>()
  let extra = 0
  const push = (line: number, level: Issue['level'], message: string) => {
    if (seen.has(message)) return
    seen.add(message)
    if (seen.size > 40) { extra++; return }
    r.issues.push({ line, level, message })
  }
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(Critical Warning|Warning|Info)\s*(?:\((\d+)\))?:\s*(.*)$/)
    if (!m) continue
    const [, kind, id, msg] = m
    let c: RegExpMatchArray | null
    if (/Calling "derive_clocks -period 1\.0"/.test(msg)) derived = true
    else if ((c = msg.match(/^create_clock\s+-period\s+1\.0+\s+-name\s+(\S+)/))) { named.push(c[1]); derived = true }
    else if (/^No clocks defined in design|^No clocks to report/.test(msg)) noClocks = true
    else if ((c = msg.match(/^Node:\s*(\S+) was determined to be a clock/))) { unc('clock', c[1]); push(i + 1, 'warn', `${c[1]} is used as a clock but has no clock constraint, so paths it clocks are not timed.`) }
    else if ((c = msg.match(/Synopsys Design Constraints File file not found: '([^']+)'/))) push(i + 1, 'warn', `No SDC file was found (${c[1]}), so nothing in this design was constrained by you.`)
    else if (/^Timing requirements not met/.test(msg)) push(i + 1, 'warn', 'Quartus reports: timing requirements not met.')
    else if (kind !== 'Info' && /^Ignored \w+ at |is not a proper SDC command|PLL cross checking found inconsistent|could not be matched with/.test(msg)) push(i + 1, 'warn', `Quartus ${kind.toLowerCase()}${id ? ` ${id}` : ''}: ${msg}`)
  }
  if (extra) r.issues.push({ line: 1, level: 'info', message: `${extra} more constraint warnings in the messages section are not shown.` })
  if (derived) {
    const set = r.clocks.filter(c => c.period === 1 && (named.length ? named.includes(c.name) : c.kind !== 'generated')).map(c => c.name)
    if (set.length) {
      r.defaultClocks = set
      r.issues.unshift({ line: 1, level: 'warn', message: `No clock constraints: Quartus ran derive_clocks -period 1.0, so ${set.join(', ')} ${set.length > 1 ? 'are' : 'is'} timed at 1000 MHz. Every slack in this report is measured against that placeholder, not your real clock.` })
    }
  }
  return noClocks
}

function parseQuartus(text: string): ParsedReport {
  const tables = quartusTables(text)
  const r: ParsedReport = { format: 'quartus', paths: [], clocks: [], summary: [], unconstrained: [], transfers: [], issues: [], found: [] }
  const byKey = new Map<string, TimingPath>()
  const note = (s: string) => { if (!r.found.includes(s)) r.found.push(s) }
  const col = (h: string[], ...names: string[]) => h.findIndex(x => names.some(n => x.toLowerCase() === n.toLowerCase()))
  const key = (p: Pick<TimingPath, 'analysis' | 'from' | 'to' | 'launch' | 'latch'>) => [p.analysis, p.from, p.to, p.launch, p.latch].join('\u0000')
  const add = (p: TimingPath) => {
    const k = key(p)
    const prev = byKey.get(k)
    if (prev) {
      // The same path shows up once per operating corner and again in report_timing detail.
      // Keep the numbers of the worst-slack copy; the other copy only fills gaps.
      const [win, lose] = p.slack < prev.slack ? [p, prev] : [prev, p]
      Object.assign(prev, { ...defined(lose), ...defined(win) })
      return prev
    }
    byKey.set(k, p)
    return p
  }
  let detail: TimingPath | null = null
  const unc = (kind: 'input' | 'output' | 'clock', name: string) => { if (name && !r.unconstrained.some(u => u.kind === kind && u.name === name)) r.unconstrained.push({ kind, name }) }

  for (const t of tables) {
    const h = t.header
    const hl = h.map(x => x.toLowerCase())
    const title = t.title.toLowerCase()

    if (hl.includes('slack') && hl.includes('from node') && hl.includes('to node')) {
      note('Path summary table')
      const an = analysisOf(t.title) ?? analysisOf(t.context) ?? 'setup'
      const corner = cornerOf(t.title)
      const ix = { s: col(h, 'Slack'), f: col(h, 'From Node'), t: col(h, 'To Node'), lc: col(h, 'Launch Clock'), ll: col(h, 'Latch Clock'), rel: col(h, 'Relationship'), sk: col(h, 'Clock Skew'), dd: col(h, 'Data Delay') }
      for (const row of t.rows) {
        const c = row.cells
        const slack = slackNum(c[ix.s])
        if (slack === undefined || !c[ix.f] || !c[ix.t]) { r.issues.push({ line: row.line, level: 'warn', message: `Skipped a path row without a numeric slack or node names: "${c.join(' ; ').slice(0, 90)}"` }); continue }
        add({ id: '', analysis: an, slack, from: c[ix.f], to: c[ix.t], launch: c[ix.lc] ?? '', latch: c[ix.ll] ?? '', relationship: num(c[ix.rel]), skew: num(c[ix.sk]), dataDelay: num(c[ix.dd]), corner, line: row.line })
      }
      continue
    }

    if (title === 'path summary' && hl[0] === 'property') {
      note('Path detail sections')
      const kv = Object.fromEntries(t.rows.map(x => [x.cells[0].toLowerCase(), x.cells[1] ?? '']))
      const an = analysisOf(t.context) ?? 'setup'
      const slack = slackNum(kv['slack']) ?? num(t.context.match(/slack is (-?[\d.]+)/i)?.[1])
      if (slack === undefined || !kv['from node'] || !kv['to node']) { r.issues.push({ line: t.line, level: 'warn', message: 'Path Summary without slack or node names; skipped.' }); detail = null; continue }
      detail = add({ id: '', analysis: an, slack, from: kv['from node'], to: kv['to node'], launch: kv['launch clock'] ?? '', latch: kv['latch clock'] ?? '', arrival: num(kv['data arrival time']), required: num(kv['data required time']), line: t.line })
      continue
    }

    if (title === 'statistics' && detail && hl[0] === 'property') {
      for (const row of t.rows) {
        const name = row.cells[0].toLowerCase(), v = num(row.cells[1])
        if (v === undefined) continue
        if (/relationship/.test(name)) detail.relationship = v
        else if (name === 'clock skew') detail.skew = v
        else if (name === 'data delay') detail.dataDelay = v
        else if (/number of logic levels/.test(name)) detail.levels = v
      }
      continue
    }

    if (/data arrival path/.test(title) && detail && hl.includes('fanout')) {
      const fi = col(h, 'Fanout'), ei = col(h, 'Element'), ti = col(h, 'Type')
      let inData = false, max = 0, cells = 0
      for (const row of t.rows) {
        const el = (row.cells[ei] ?? '').toLowerCase()
        if (el === 'data path') { inData = true; continue }
        if (!inData) continue
        const f = num(row.cells[fi])
        if (f !== undefined) max = Math.max(max, f)
        if ((row.cells[ti] ?? '').toUpperCase() === 'CELL') cells++
      }
      if (max) detail.fanout = max
      if (detail.levels === undefined && cells) detail.levels = Math.max(0, cells - 1)
      continue
    }

    if (hl.includes('clock name') && hl.includes('period')) {
      note('Clocks')
      const ix = { n: col(h, 'Clock Name'), ty: col(h, 'Type'), p: col(h, 'Period'), m: col(h, 'Master'), s: col(h, 'Source'), tg: col(h, 'Targets') }
      for (const row of t.rows) {
        const period = num(row.cells[ix.p])
        const name = row.cells[ix.n]
        if (!name || period === undefined || period <= 0) { r.issues.push({ line: row.line, level: 'warn', message: `Clock row without a positive period: "${row.cells.join(' ; ').slice(0, 80)}"` }); continue }
        const ty = (row.cells[ix.ty] ?? '').toLowerCase()
        if (!r.clocks.some(c => c.name === name)) r.clocks.push({ name, period, kind: ty.startsWith('gen') ? 'generated' : ty.startsWith('vir') ? 'virtual' : 'base', master: row.cells[ix.m] || undefined, source: row.cells[ix.s] || row.cells[ix.tg] || undefined })
      }
      continue
    }

    if (/(setup|hold|recovery|removal) summary/.test(title) && hl.includes('slack') && hl[0] === 'clock') {
      note('Per-clock summary')
      const an = analysisOf(t.title)!
      const ti = hl.findIndex(x => x.includes('tns'))
      for (const row of t.rows) {
        const slack = slackNum(row.cells[1]), tns = num(row.cells[ti]) ?? 0
        if (slack === undefined) { r.issues.push({ line: row.line, level: 'warn', message: `Skipped a summary row without a numeric slack: "${row.cells.join(' ; ').slice(0, 90)}"` }); continue }
        const prev = r.summary.find(s => s.clock === row.cells[0] && s.analysis === an)
        const corner = cornerOf(t.title)
        if (prev) { if (slack < prev.slack) { prev.slack = slack; prev.corner = corner } prev.tns = Math.min(prev.tns, tns) }
        else r.summary.push({ clock: row.cells[0], analysis: an, slack, tns, corner })
      }
      continue
    }

    if (/unconstrained (input|output) ports?$/.test(title)) {
      note('Unconstrained ports')
      const kind = title.includes('input') ? 'input' : 'output'
      for (const row of t.rows) unc(kind, row.cells[0])
      continue
    }

    if (/clock status summary/.test(title)) {
      note('Clock status')
      const si = hl.indexOf('status'), ci = hl.indexOf('clock')
      for (const row of t.rows) if (/unconstrained/i.test(row.cells[si] ?? '')) unc('clock', row.cells[ci] || row.cells[0])
      continue
    }

    if (/fmax summary/.test(title) && hl.includes('fmax') && hl.includes('clock name')) {
      note('Fmax summary')
      const fi = hl.indexOf('fmax'), ri = hl.indexOf('restricted fmax'), ci = hl.indexOf('clock name')
      r.fmax ??= []
      for (const row of t.rows) {
        const f = mhz(row.cells[fi]), clock = row.cells[ci]
        if (f === undefined || !clock) continue
        const prev = r.fmax.find(x => x.clock === clock)
        const next = { clock, fmax: f, restricted: mhz(row.cells[ri]), corner: cornerOf(t.title) }
        if (!prev) r.fmax.push(next)
        else if (f < prev.fmax) Object.assign(prev, next)
      }
      continue
    }

    if (/minimum pulse width summary/.test(title) && hl[0] === 'clock' && hl.includes('slack')) {
      r.pulse ??= []
      for (const row of t.rows) {
        const slack = num(row.cells[1])
        if (slack === undefined) continue
        const prev = r.pulse.find(x => x.clock === row.cells[0])
        if (prev) prev.slack = Math.min(prev.slack, slack)
        else r.pulse.push({ clock: row.cells[0], slack })
      }
      continue
    }

    if (/timing analyzer summary$/.test(title)) {
      const kv = new Map([h, ...t.rows.map(x => x.cells)].map(c => [c[0].toLowerCase(), c[1] ?? '']))
      const ver = [...kv].find(([k]) => /^quartus.*version$/.test(k))
      const edition = ver?.[1].match(/(\w+) Edition/)?.[1]
      r.meta = {
        tool: ver ? `${/prime/.test(ver[0]) ? 'Quartus Prime' : 'Quartus II'} ${ver[1].match(/Version (\S+)/)?.[1] ?? ''}${edition ? ` ${edition}` : ''}`.trim() : undefined,
        design: kv.get('revision name') || undefined,
        device: kv.get('device name') || kv.get('device') || undefined,
        state: kv.get('device family') || undefined,
      }
      continue
    }

    if (/^unconstrained paths( summary)?$/.test(title) && hl[0] === 'property') {
      note('Unconstrained paths summary')
      const get = (name: string) => { const row = t.rows.find(x => x.cells[0].toLowerCase() === name); return row ? Math.max(...row.cells.slice(1).map(c => num(c) ?? 0)) : undefined }
      r.counts = { inputPorts: get('unconstrained input ports'), outputPorts: get('unconstrained output ports'), clocks: get('unconstrained clocks') }
      continue
    }

    if (/(setup|hold) transfers/.test(title) && hl[0] === 'from clock') {
      note('Clock transfers')
      if (!/setup/.test(title)) continue
      for (const row of t.rows) {
        const rest = row.cells.slice(2)
        r.transfers.push({ from: row.cells[0], to: row.cells[1], paths: rest.reduce((s, c) => s + (num(c) ?? 0), 0), falsePath: rest.some(c => /false path/i.test(c)) })
      }
      continue
    }
  }

  quartusCutOff(text, r)
  const empty = quartusMessages(text, r, unc)
  r.paths = [...byKey.values()].map((p, i) => ({ ...p, id: `p${i + 1}` }))
  for (const p of r.pulse ?? []) if (p.slack < 0 && !r.defaultClocks?.includes(p.clock)) r.issues.push({ line: 1, level: 'warn', message: `Minimum pulse width fails on ${p.clock} (slack ${p.slack.toFixed(3)} ns): the clock is faster than the device's clock network, RAM or DSP blocks allow.` })
  for (const p of r.paths) if (!p.launch || !p.latch) r.issues.push({ line: p.line, level: 'warn', message: `Path to ${p.to} has no ${!p.launch ? 'launch' : 'latch'} clock; it is likely an unconstrained I/O path.` })
  if (!r.paths.length && !r.clocks.length && !r.summary.length && !r.unconstrained.length) r.issues.push({ line: 1, level: 'error', message: empty ? 'This report has no clocks and no timed paths: the design has no registers clocked from a pin, or the clock was optimised away. There is nothing to triage.' : 'Found Quartus tables but none with paths, clocks or summaries. Export with report_timing -file (see Docs).' })
  else if (!r.paths.length) r.issues.push({ line: 1, level: 'info', message: r.summary.length ? 'This file has per-clock summaries but no path tables, so failing paths cannot be listed or classified. Add a report_timing -npaths export (see Docs).' : 'No path tables in this file. Add a report_timing export to see failing paths.' })
  if (!r.clocks.length && r.paths.length) r.issues.push({ line: 1, level: 'info', message: 'No clock table found. Periods are taken from create_clock in your SDC, or estimated from path relationships.' })
  return r
}

// ---------- Vivado ----------

function parseVivado(text: string): ParsedReport {
  const lines = text.split(/\r?\n/)
  const r: ParsedReport = { format: 'vivado', paths: [], clocks: [], summary: [], unconstrained: [], transfers: [], issues: [], found: [] }
  const addClock = (name: string, period: number, master?: string) => { if (name && period > 0 && !r.clocks.some(c => c.name === name)) r.clocks.push({ name, period, kind: master ? 'generated' : 'base', master }) }
  const note = (s: string) => { if (!r.found.includes(s)) r.found.push(s) }
  const head = (k: string) => text.slice(0, 4000).match(new RegExp(`^\\|\\s*${k}\\s*:\\s*(.+?)\\s*$`, 'm'))?.[1]
  const tool = head('Tool Version')?.match(/Vivado v\.?(\S+)/)
  if (tool || head('Design')) r.meta = { tool: tool ? `Vivado ${tool[1]}` : undefined, design: head('Design'), device: head('Device'), state: head('Design State') }
  // Indentation in the Clock Summary and Intra Clock Table marks generated clocks under their master.
  const parents: { indent: number; name: string }[] = []
  const masterOf = (indent: number) => { while (parents.length && parents[parents.length - 1].indent >= indent) parents.pop(); return parents[parents.length - 1]?.name }
  const nums = (s: string) => s.trim().split(/\s+/).map(Number)
  let section = ''
  let p: TimingPath | null = null
  let inTable = false
  // The path table is split by dashed lines into launch clock, data and capture clock sections.
  // Fanout only counts in data sections: clock nets have thousands of loads and say nothing about the path.
  let secs: { clock: boolean; input: boolean; fo: number; seen: boolean }[] = []
  let typed = false
  const flush = () => {
    // Without a Path Type line there is no telling setup from hold.
    if (p && !typed) r.issues.push({ line: p.line, level: 'warn', message: 'This path block is cut off before Path Type, so it was skipped. The file may be incomplete; export it again.' })
    else if (p) {
      const data = secs.filter(x => x.seen && (!x.clock || x.input))
      const fo = Math.max(0, ...data.map(x => x.fo))
      if (data.length && (fo > 0 || secs.some(x => x.fo > 0))) p.fanout = fo
      r.paths.push(p)
    }
    p = null; secs = []
  }
  let inClockSummary = false

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const sec = l.match(/^\|\s*(Design Timing Summary|Intra Clock Table|Inter Clock Table|Other Path Groups Table|Timing Details|Clock Summary)\s*$/)
    if (sec) { section = sec[1]; inClockSummary = section === 'Clock Summary'; parents.length = 0; continue }
    if (!section && /^\s*Clock Summary\s*$/.test(l)) { inClockSummary = true; continue }
    if (inClockSummary) {
      const m = l.match(/^(\s*)(\S+)\s+\{[^}]*\}\s+([\d.]+)\s+([\d.]+)/)
      if (m) { const master = masterOf(m[1].length); addClock(m[2], Number(m[3]), master); parents.push({ indent: m[1].length, name: m[2] }); note('Clock summary') }
      else if (/^\s*$/.test(l) && r.clocks.length) inClockSummary = false
      continue
    }
    if (section === 'Design Timing Summary') {
      const v = /^\s*-?\d/.test(l) ? nums(l) : []
      if (v.length >= 8 && v.slice(0, 8).every(Number.isFinite)) {
        r.totals = { setup: { wns: v[0], tns: v[1], failing: v[2], total: v[3] }, hold: { wns: v[4], tns: v[5], failing: v[6], total: v[7] } }
        note('Design timing summary'); section = ''
      }
      continue
    }
    if (section === 'Intra Clock Table') {
      const m = l.match(/^(\s*)(\S+)((?:\s+-?\d[\d.]*)+)\s*$/)
      if (m && !/^-+$/.test(m[2])) {
        const v = nums(m[3])
        // Clocks with only pulse-width checks have three or four numbers; timed clocks have setup and hold first.
        if (v.length >= 8) {
          r.summary.push({ clock: m[2], analysis: 'setup', slack: v[0], tns: v[1], failing: v[2], total: v[3] }, { clock: m[2], analysis: 'hold', slack: v[4], tns: v[5], failing: v[6], total: v[7] })
          note('Per-clock summary')
        }
      }
      continue
    }
    if (section === 'Inter Clock Table') {
      const m = l.match(/^\s*(\S+)\s+(\S+)((?:\s+-?\d[\d.]*){8})\s*$/)
      if (m) {
        const v = nums(m[3])
        r.transfers.push({ from: m[1], to: m[2], paths: v[3], falsePath: false, wns: v[0], failing: v[2], holdWns: v[4], holdFailing: v[6] })
        note('Clock transfers')
      }
      continue
    }
    const sm = l.match(/^\s*Slack(?: \((VIOLATED|MET)\))?\s*:\s*(-?[\d.]+|inf)ns/)
    if (sm) {
      flush()
      if (sm[2] === 'inf') continue
      p = { id: '', analysis: 'setup', slack: Number(sm[2]), from: '', to: '', launch: '', latch: '', line: i + 1 }
      inTable = false; typed = false
      if (!r.found.includes('Path details')) r.found.push('Path details')
      continue
    }
    if (!p) continue
    const field = (name: string) => l.match(new RegExp(`^\\s*${name}:\\s+(.*)$`))?.[1]
    const cur: TimingPath = p
    let v: string | undefined
    if ((v = field('Source'))) { cur.from = v.trim(); const c = lines[i + 1]?.match(/clocked by (\S+)\s*\{[^}]*period=([\d.]+)ns/); if (c) { cur.launch = c[1]; addClock(c[1], Number(c[2])) } }
    else if ((v = field('Destination'))) { cur.to = v.trim(); const c = lines[i + 1]?.match(/clocked by (\S+)\s*\{[^}]*period=([\d.]+)ns/); if (c) { cur.latch = c[1]; addClock(c[1], Number(c[2])) } }
    else if ((v = field('Path Type'))) { const an = analysisOf(v); if (an) { cur.analysis = an; typed = true } }
    else if ((v = field('Requirement'))) cur.relationship = num(v)
    else if ((v = field('Data Path Delay'))) { cur.dataDelay = num(v); cur.logicDelay = num(v.match(/logic\s+(-?[\d.]+)ns/)?.[1]); cur.routeDelay = num(v.match(/route\s+(-?[\d.]+)ns/)?.[1]) }
    else if ((v = field('Logic Levels'))) { cur.levels = num(v); cur.levelDetail = v.match(/\(([^)]+)\)/)?.[1] }
    else if ((v = field('Clock Path Skew'))) cur.skew = num(v)
    else if ((v = field('Clock Uncertainty'))) cur.uncertainty = num(v)
    else if (/^\s*Location\s+Delay type/.test(l)) { inTable = true; secs = [] }
    else if (inTable && /^\s*-{20,}/.test(l)) secs.push({ clock: false, input: false, fo: 0, seen: false })
    else if (inTable && /^\s*arrival time\s+(-?[\d.]+)/.test(l)) cur.arrival = Math.abs(num(l)!)
    else if (inTable && /^\s*required time\s+(-?[\d.]+)/.test(l)) cur.required = num(l)
    else if (inTable && secs.length && l.trim()) {
      const sec = secs[secs.length - 1]
      if (!sec.seen) { sec.seen = true; sec.clock = /^\s*\(clock /.test(l) }
      if (/^\s*input delay\b/.test(l)) sec.input = true
      const fo = l.match(/fo=(\d+)/)
      if (fo) sec.fo = Math.max(sec.fo, Number(fo[1]))
    }
  }
  flush()
  r.paths = r.paths.filter(x => {
    if (x.from && x.to) return true
    r.issues.push({ line: x.line, level: 'warn', message: 'Path block without Source or Destination; skipped.' })
    return false
  }).map((x, i) => ({ ...x, id: `p${i + 1}` }))
  for (const x of r.paths) if (!x.launch && /input port/i.test(lines[x.line] ?? '')) x.launch = ''
  // check_timing findings: one "There are N ..." line per check, HIGH/MEDIUM ones matter.
  for (let i = 0; i < lines.length && i < 400; i++) {
    const m = lines[i].match(/^\s*There (?:is|are) (\d+) (.+?)\.?\s*(?:\((HIGH|MEDIUM|LOW)\))?\s*$/)
    if (!m || !+m[1]) continue
    const n = +m[1], what = m[2]
    if (/^input ports? with no input delay specified/.test(what)) { r.counts = { ...r.counts, inputPorts: n }; r.issues.push({ line: i + 1, level: 'warn', message: `check_timing: ${n} input ports have no input delay.` }) }
    else if (/^ports? with no output delay specified/.test(what)) { r.counts = { ...r.counts, outputPorts: n }; r.issues.push({ line: i + 1, level: 'warn', message: `check_timing: ${n} output ports have no output delay.` }) }
    else if (/with no clock driven by root clock pin: (\S+)/.test(what)) {
      const pin = what.match(/root clock pin: (\S+)/)![1]
      if (!r.unconstrained.some(u => u.kind === 'clock' && u.name === pin)) r.unconstrained.push({ kind: 'clock', name: pin })
      r.issues.push({ line: i + 1, level: 'warn', message: `check_timing: ${n} register pin${n > 1 ? 's are' : ' is'} clocked by ${pin}, which has no clock constraint, so those paths are not timed.` })
    }
    else if (m[3] === 'HIGH') r.issues.push({ line: i + 1, level: 'warn', message: `check_timing: ${n} ${what}.` })
  }
  if (r.totals?.setup && r.totals.setup.failing > r.paths.filter(x => x.slack < 0 && (x.analysis === 'setup' || x.analysis === 'recovery')).length) r.issues.push({ line: 1, level: 'info', message: `The design has ${r.totals.setup.failing} failing setup endpoints but this export lists only the worst path per clock group. Re-run report_timing_summary with -max_paths 100 to triage more of them.` })
  if (!r.paths.length) r.issues.push({ line: 1, level: 'error', message: 'No timing paths found. Run report_timing_summary -max_paths 50 -report_unconstrained -file (see Docs).' })
  return r
}
