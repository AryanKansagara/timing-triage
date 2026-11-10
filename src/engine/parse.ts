// Parsers for Quartus Timing Analyzer panel text (report_timing -file, .sta.rpt, report_clocks,
// report_ucp, report_clock_transfers) and Vivado report_timing_summary / report_timing text.
import type { Analysis, Clock, ClockSummary, Format, Issue, ParsedReport, TimingPath } from './types.ts'

const num = (s: string | undefined) => {
  if (s === undefined) return undefined
  const m = s.replace(/,/g, '').match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/i)
  return m ? Number(m[0]) : undefined
}

export function detectFormat(text: string): Format {
  const head = text.slice(0, 200_000)
  if (/Slack \((VIOLATED|MET)\)\s*:|report_timing_summary|Design Timing Summary|\bVivado\b/.test(head)) return 'vivado'
  if (/^\s*[;|].*;\s*$/m.test(head) && /^\s*\+-{3,}/m.test(head)) return 'quartus'
  if (/^\s*(create_clock|create_generated_clock|derive_pll_clocks|derive_clock_uncertainty|set_clock_groups|set_false_path|set_input_delay|set_output_delay|set_multicycle_path)\b/m.test(head)) return 'sdc'
  return 'unknown'
}

export function parseReport(text: string): ParsedReport {
  const format = detectFormat(text)
  if (format === 'quartus') return parseQuartus(text)
  if (format === 'vivado') return parseVivado(text)
  return {
    format, paths: [], clocks: [], summary: [], unconstrained: [], transfers: [], found: [],
    issues: [{ line: 1, level: 'error', message: format === 'sdc' ? 'This is an SDC file, not a timing report. Add it as constraints instead.' : 'Not a recognised timing report. Expected Quartus Timing Analyzer panel text (tables drawn with + - ; characters) or Vivado report_timing_summary text.' }],
  }
}

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
  let rowsSeen = 0
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (isBorder(l)) continue
    if (/^\s*;.*;\s*$/.test(l)) {
      const c = cells(l)
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

const analysisOf = (s: string): Analysis | null => {
  const m = s.match(/\b(setup|hold|recovery|removal)\b/i)
  return m ? m[1].toLowerCase() as Analysis : null
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
      for (const [f, v] of Object.entries(p)) if (v !== undefined && v !== '' && f !== 'id' && f !== 'line' && f !== 'slack') (prev as unknown as Record<string, unknown>)[f] = v
      prev.slack = Math.min(prev.slack, p.slack)
      return prev
    }
    byKey.set(k, p)
    return p
  }
  let detail: TimingPath | null = null

  for (const t of tables) {
    const h = t.header
    const hl = h.map(x => x.toLowerCase())
    const title = t.title.toLowerCase()

    if (hl.includes('slack') && hl.includes('from node') && hl.includes('to node')) {
      note('Path summary table')
      const an = analysisOf(t.title) ?? analysisOf(t.context) ?? 'setup'
      const ix = { s: col(h, 'Slack'), f: col(h, 'From Node'), t: col(h, 'To Node'), lc: col(h, 'Launch Clock'), ll: col(h, 'Latch Clock'), rel: col(h, 'Relationship'), sk: col(h, 'Clock Skew'), dd: col(h, 'Data Delay') }
      for (const row of t.rows) {
        const c = row.cells
        const slack = num(c[ix.s])
        if (slack === undefined || !c[ix.f] || !c[ix.t]) { r.issues.push({ line: row.line, level: 'warn', message: `Skipped a path row without a numeric slack or node names: "${c.join(' ; ').slice(0, 90)}"` }); continue }
        add({ id: '', analysis: an, slack, from: c[ix.f], to: c[ix.t], launch: c[ix.lc] ?? '', latch: c[ix.ll] ?? '', relationship: num(c[ix.rel]), skew: num(c[ix.sk]), dataDelay: num(c[ix.dd]), line: row.line })
      }
      continue
    }

    if (title === 'path summary' && hl[0] === 'property') {
      note('Path detail sections')
      const kv = Object.fromEntries(t.rows.map(x => [x.cells[0].toLowerCase(), x.cells[1] ?? '']))
      const an = analysisOf(t.context) ?? 'setup'
      const slack = num(kv['slack']) ?? num(t.context.match(/slack is (-?[\d.]+)/i)?.[1])
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
        const slack = num(row.cells[1]), tns = num(row.cells[ti]) ?? 0
        if (slack === undefined) continue
        const prev = r.summary.find(s => s.clock === row.cells[0] && s.analysis === an)
        if (prev) { prev.slack = Math.min(prev.slack, slack); prev.tns = Math.min(prev.tns, tns) }
        else r.summary.push({ clock: row.cells[0], analysis: an, slack, tns })
      }
      continue
    }

    if (/unconstrained (input|output) ports?$/.test(title)) {
      note('Unconstrained ports')
      const kind = title.includes('input') ? 'input' : 'output'
      for (const row of t.rows) if (row.cells[0]) r.unconstrained.push({ kind, name: row.cells[0] })
      continue
    }

    if (/clock status summary/.test(title)) {
      note('Clock status')
      const si = hl.indexOf('status'), ci = hl.indexOf('clock')
      for (const row of t.rows) if (/unconstrained/i.test(row.cells[si] ?? '')) r.unconstrained.push({ kind: 'clock', name: row.cells[ci] || row.cells[0] })
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

  r.paths = [...byKey.values()].map((p, i) => ({ ...p, id: `p${i + 1}` }))
  for (const p of r.paths) if (!p.launch || !p.latch) r.issues.push({ line: p.line, level: 'warn', message: `Path to ${p.to} has no ${!p.launch ? 'launch' : 'latch'} clock; it is likely an unconstrained I/O path.` })
  if (!r.paths.length && !r.clocks.length && !r.summary.length && !r.unconstrained.length) r.issues.push({ line: 1, level: 'error', message: 'Found Quartus tables but none with paths, clocks or summaries. Export with report_timing -file (see Docs).' })
  else if (!r.paths.length) r.issues.push({ line: 1, level: 'info', message: 'No path tables in this file. Add a report_timing export to see failing paths.' })
  if (!r.clocks.length && r.paths.length) r.issues.push({ line: 1, level: 'info', message: 'No clock table found. Periods are taken from create_clock in your SDC, or estimated from path relationships.' })
  return r
}

// ---------- Vivado ----------

function parseVivado(text: string): ParsedReport {
  const lines = text.split(/\r?\n/)
  const r: ParsedReport = { format: 'vivado', paths: [], clocks: [], summary: [], unconstrained: [], transfers: [], issues: [], found: [] }
  const addClock = (name: string, period: number) => { if (name && period > 0 && !r.clocks.some(c => c.name === name)) r.clocks.push({ name, period, kind: 'base' }) }
  let p: TimingPath | null = null
  let sep = 0, inTable = false
  const flush = () => { if (p) r.paths.push(p); p = null }
  let inClockSummary = false

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^\|?\s*Clock Summary/.test(l)) { inClockSummary = true; continue }
    if (inClockSummary) {
      const m = l.match(/^\s*(\S+)\s+\{[^}]*\}\s+([\d.]+)\s+([\d.]+)/)
      if (m) { addClock(m[1], Number(m[2])); if (!r.found.includes('Clock summary')) r.found.push('Clock summary') }
      else if (/^\s*$/.test(l) && r.clocks.length) inClockSummary = false
      continue
    }
    const sm = l.match(/^\s*Slack(?: \((VIOLATED|MET)\))?\s*:\s*(-?[\d.]+|inf)ns/)
    if (sm) {
      flush()
      if (sm[2] === 'inf') continue
      p = { id: '', analysis: 'setup', slack: Number(sm[2]), from: '', to: '', launch: '', latch: '', line: i + 1 }
      sep = 0; inTable = false
      if (!r.found.includes('Path details')) r.found.push('Path details')
      continue
    }
    if (!p) continue
    const field = (name: string) => l.match(new RegExp(`^\\s*${name}:\\s+(.*)$`))?.[1]
    const cur: TimingPath = p
    let v: string | undefined
    if ((v = field('Source'))) { cur.from = v.trim(); const c = lines[i + 1]?.match(/clocked by (\S+)\s*\{[^}]*period=([\d.]+)ns/); if (c) { cur.launch = c[1]; addClock(c[1], Number(c[2])) } }
    else if ((v = field('Destination'))) { cur.to = v.trim(); const c = lines[i + 1]?.match(/clocked by (\S+)\s*\{[^}]*period=([\d.]+)ns/); if (c) { cur.latch = c[1]; addClock(c[1], Number(c[2])) } }
    else if ((v = field('Path Type'))) cur.analysis = analysisOf(v) ?? 'setup'
    else if ((v = field('Requirement'))) cur.relationship = num(v)
    else if ((v = field('Data Path Delay'))) cur.dataDelay = num(v)
    else if ((v = field('Logic Levels'))) cur.levels = num(v)
    else if ((v = field('Clock Path Skew'))) cur.skew = num(v)
    else if ((v = field('Clock Uncertainty'))) cur.uncertainty = num(v)
    else if (/^\s*Location\s+Delay type/.test(l)) { inTable = true; sep = 0 }
    else if (inTable && /^\s*-{20,}/.test(l)) sep++
    else if (inTable && sep === 2) {
      const fo = l.match(/fo=(\d+)/)
      if (fo) cur.fanout = Math.max(cur.fanout ?? 0, Number(fo[1]))
    }
    else if (inTable && /^\s*arrival time\s+(-?[\d.]+)/.test(l)) cur.arrival = Math.abs(num(l)!)
    else if (inTable && /^\s*required time\s+(-?[\d.]+)/.test(l)) cur.required = num(l)
  }
  flush()
  r.paths = r.paths.filter(x => {
    if (x.from && x.to) return true
    r.issues.push({ line: x.line, level: 'warn', message: 'Path block without Source or Destination; skipped.' })
    return false
  }).map((x, i) => ({ ...x, id: `p${i + 1}` }))
  for (const x of r.paths) if (!x.launch && /input port/i.test(lines[x.line] ?? '')) x.launch = ''
  const ni = text.match(/There (?:is|are) (\d+) input ports? with no input delay/i)
  const no = text.match(/There (?:is|are) (\d+) ports? with no output delay/i)
  if (ni && +ni[1]) r.issues.push({ line: 1, level: 'warn', message: `check_timing: ${ni[1]} input ports have no input delay.` })
  if (no && +no[1]) r.issues.push({ line: 1, level: 'warn', message: `check_timing: ${no[1]} output ports have no output delay.` })
  if (!r.paths.length) r.issues.push({ line: 1, level: 'error', message: 'No timing paths found. Run report_timing_summary -max_paths 50 -report_unconstrained -file (see Docs).' })
  return r
}
