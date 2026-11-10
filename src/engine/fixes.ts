import { bus, CAUSES, rootClock, type Classified, type Result } from './analyze.ts'
import type { Cause, Clock, Settings } from './types.ts'
import { DEFAULT_SETTINGS } from './types.ts'

export interface Fix {
  id: string
  cause: Cause | 'sdc'
  title: string
  why: string
  /** Lines to append to the .sdc file. Applying them re-runs the analysis. */
  sdc?: string
  /** Quartus settings (.qsf) assignments, applied in the project, not the SDC */
  qsf?: string
  steps: string[]
  pathIds: string[]
  /** Sum of negative slack on the paths this fix addresses (ns, negative) */
  tns: number
  severity: 'error' | 'warn' | 'info'
}

const brace = (n: string) => `{${n}}`
const f3 = (n: number) => n.toFixed(3)

function tnsOf(ps: Classified[]) {
  const worst = new Map<string, number>()
  for (const p of ps) if (p.slack < 0) worst.set(p.to, Math.min(worst.get(p.to) ?? 0, p.slack))
  return Math.round([...worst.values()].reduce((a, b) => a + b, 0) * 1000) / 1000
}

export function buildFixes(r: Result, clocks: Clock[], settings: Partial<Settings> = {}): Fix[] {
  const s = { ...DEFAULT_SETTINGS, ...settings }
  const out: Fix[] = []
  const failing = r.paths.filter(p => p.slack < 0 && p.cutBy === null)

  // Unconstrained crossings: one set_clock_groups per pair of clock families.
  const fam = (c: string) => rootClock(c, clocks)
  const famMembers = (root: string) => [...new Set([...clocks.map(c => c.name), ...r.paths.flatMap(p => [p.launch, p.latch])].filter(n => n && fam(n) === root))]
  const pairs = new Map<string, Classified[]>()
  for (const x of r.crossings.filter(c => c.status === 'unconstrained')) {
    const [a, b] = [fam(x.launch), fam(x.latch)].sort()
    const key = `${a}\u0000${b}`
    pairs.set(key, [...(pairs.get(key) ?? []), ...failing.filter(p => p.launch === x.launch && p.latch === x.latch)])
  }
  for (const [key, ps] of pairs) {
    const [a, b] = key.split('\u0000')
    const ga = famMembers(a), gb = famMembers(b)
    const crossings = r.crossings.filter(x => x.status === 'unconstrained' && [fam(x.launch), fam(x.latch)].sort().join('\u0000') === key)
    const steps: string[] = []
    for (const x of crossings) for (const t of x.toBuses) {
      if (t.synchronized) steps.push(`${t.bus} (${x.launch} → ${x.latch}) already looks like a synchronizer stage. Keep it and cut the path.`)
      else if (t.width <= 1) steps.push(`${t.bus}: single bit. Add a two-flop synchronizer in ${x.latch} before any logic uses it.`)
      else steps.push(`${t.bus}: ${t.width} bits cross together. Two-flop synchronizers per bit can tear the word; use a dual-clock FIFO (dcfifo), a valid/ack handshake, or Gray-code it if it is a counter.`)
    }
    out.push({
      id: `cdc:${key}`, cause: 'cdc', severity: ps.length ? 'error' : 'warn',
      title: `Declare ${short(a)} and ${short(b)} asynchronous`,
      why: `Timing Analyzer assumes ${short(a)} and ${short(b)} are related and times ${crossings.reduce((n, x) => n + x.paths, 0)} crossing path${crossings.length === 1 && crossings[0].paths === 1 ? '' : 's'} against the closest pair of edges, which is not a real requirement. The crossing needs a synchronizer in RTL and a constraint that says the clocks are unrelated.`,
      sdc: `set_clock_groups -asynchronous \\\n  -group [get_clocks {${ga.join(' ')}}] \\\n  -group [get_clocks {${gb.join(' ')}}]`,
      steps: [...new Set(steps)].slice(0, 8),
      pathIds: ps.map(p => p.id), tns: tnsOf(ps),
    })
  }

  // Logic depth, grouped by destination bus.
  const groupBy = (cause: Cause, key: (p: Classified) => string) => {
    const m = new Map<string, Classified[]>()
    for (const p of failing.filter(p => p.cause === cause)) m.set(key(p), [...(m.get(key(p)) ?? []), p])
    return [...m.entries()].sort((a, b) => tnsOf(a[1]) - tnsOf(b[1]))
  }
  for (const [to, ps] of groupBy('logic', p => bus(p.to))) {
    const lv = Math.max(...ps.map(p => p.levels ?? 0))
    const stages = Math.max(2, Math.ceil(lv / s.maxLevels))
    const worst = Math.min(...ps.map(p => p.slack))
    const from = bus(ps[0].from)
    out.push({
      id: `logic:${to}`, cause: 'logic', severity: 'error',
      title: `Pipeline ${to} (${lv} levels of logic)`,
      why: `${ps.length} path${ps.length > 1 ? 's' : ''} into ${to} go through up to ${lv} levels of logic and miss by up to ${f3(-worst)} ns on ${ps[0].latch}. Each LUT level plus routing costs roughly 0.4 to 0.7 ns, so the budget at this clock is about ${s.maxLevels} levels.`,
      steps: [
        `Split the cone from ${from} into ${stages} register stages (about ${Math.ceil(lv / stages)} levels each) and add matching latency on any parallel path.`,
        `If the datapath is a wide add, compare or multiply, use the DSP block or a carry-chain friendly form instead of LUT logic.`,
        `On Quartus Pro (Stratix 10 / Agilex), Hyper-Retiming can move registers into the cone once a pipeline register exists.`,
        `Only if the destination is enabled every 2nd cycle, a multicycle exception is valid instead (shown below with its hold pair).`,
      ],
      qsf: `set_global_assignment -name ALLOW_REGISTER_RETIMING ON`,
      sdc: `# Only valid if ${to} is enabled every 2nd clock:\n# set_multicycle_path -setup 2 -from [get_registers {${from}}] -to [get_registers {${to}}]\n# set_multicycle_path -hold 1 -from [get_registers {${from}}] -to [get_registers {${to}}]`,
      pathIds: ps.map(p => p.id), tns: tnsOf(ps),
    })
  }

  for (const [from, ps] of groupBy('fanout', p => p.from)) {
    const fo = Math.max(...ps.map(p => p.fanout ?? 0))
    out.push({
      id: `fanout:${from}`, cause: 'fanout', severity: 'error',
      title: `Duplicate ${from} (fanout ${fo})`,
      why: `${from} drives ${fo} loads, so its net is spread across the die and every load waits for the slowest branch. ${ps.length} failing path${ps.length > 1 ? 's' : ''} start here.`,
      qsf: `set_instance_assignment -name MAX_FANOUT ${Math.max(16, Math.min(64, Math.round(fo / 16)))} -to ${brace(from)}`,
      steps: [
        'Let the Fitter duplicate the register with the MAX_FANOUT assignment below, or duplicate it by hand per consuming block.',
        /rst|reset/i.test(from) ? 'This looks like a reset: make it synchronous per clock domain and pipeline it through a reset tree, or drive it on a global with GLOBAL_SIGNAL.' : 'Add a pipeline register per consumer group so each copy has a local, small fanout.',
      ],
      pathIds: ps.map(p => p.id), tns: tnsOf(ps),
    })
  }

  // I/O: failing port paths plus ports the report lists as unconstrained.
  const ioPaths = failing.filter(p => p.cause === 'io')
  const inPorts = new Set(r.unconstrainedPorts.filter(u => u.kind === 'input').map(u => bus(u.name)))
  const outPorts = new Set(r.unconstrainedPorts.filter(u => u.kind === 'output').map(u => bus(u.name)))
  if (ioPaths.length || inPorts.size || outPorts.size) {
    const clk = r.clocks.find(c => c.period)?.clock ?? 'clk'
    const per = r.clocks.find(c => c.clock === clk)?.period ?? 10
    const lines = ['# Board-level clock that launches/captures the external device; adjust to the real interface.', `create_clock -name virt_${clk.replace(/[^\w]/g, '_')} -period ${f3(per)}`]
    for (const p of inPorts) lines.push(`set_input_delay -clock virt_${clk.replace(/[^\w]/g, '_')} -max ${f3(per * 0.4)} [get_ports {${p}}]`, `set_input_delay -clock virt_${clk.replace(/[^\w]/g, '_')} -min 0.000 [get_ports {${p}}]`)
    for (const p of outPorts) lines.push(`set_output_delay -clock virt_${clk.replace(/[^\w]/g, '_')} -max ${f3(per * 0.3)} [get_ports {${p}}]`, `set_output_delay -clock virt_${clk.replace(/[^\w]/g, '_')} -min 0.000 [get_ports {${p}}]`)
    const ports = [...new Set(ioPaths.map(p => bus(p.from.includes('|') || p.from.includes('/') ? p.to : p.from)))]
    out.push({
      id: 'io', cause: 'io', severity: ioPaths.length ? 'error' : 'warn',
      title: inPorts.size || outPorts.size ? `Constrain ${inPorts.size + outPorts.size} unconstrained I/O port group${inPorts.size + outPorts.size > 1 ? 's' : ''}` : `Fix I/O timing on ${ports.slice(0, 2).join(', ')}`,
      why: `${inPorts.size + outPorts.size ? `Ports without set_input_delay or set_output_delay are not timed at all, so the Fitter can place their registers anywhere. ` : ''}${ioPaths.length ? `${ioPaths.length} I/O path${ioPaths.length > 1 ? 's' : ''} fail: the external budget leaves too little time inside the FPGA.` : ''}`.trim(),
      sdc: inPorts.size || outPorts.size ? lines.join('\n') : undefined,
      qsf: ports.length ? ports.map(p => `set_instance_assignment -name ${ioPaths.some(x => bus(x.from) === p) ? 'FAST_INPUT_REGISTER' : 'FAST_OUTPUT_REGISTER'} ON -to ${brace(p)}`).join('\n') : undefined,
      steps: [
        'Take -max/-min from the external device datasheet and board trace delay; the values below are placeholders sized from the clock period.',
        'Asynchronous inputs (buttons, UART RX) need a synchronizer, then a set_false_path -from the port instead of an input delay.',
        ports.length ? 'Pack the first/last register into the I/O cell (FAST_INPUT_REGISTER / FAST_OUTPUT_REGISTER) to make the path deterministic.' : '',
      ].filter(Boolean),
      pathIds: ioPaths.map(p => p.id), tns: tnsOf(ioPaths),
    })
  }

  const skewPaths = failing.filter(p => p.cause === 'skew')
  if (skewPaths.length) {
    const worstSkew = Math.max(...skewPaths.map(p => Math.abs(p.skew ?? 0)))
    out.push({
      id: 'skew', cause: 'skew', severity: 'error',
      title: `Reduce clock skew (up to ${f3(worstSkew)} ns)`,
      why: `${skewPaths.length} path${skewPaths.length > 1 ? 's' : ''} fail mostly because the launch and latch clocks arrive at different times, not because the data path is slow. That points at a clock routed on local interconnect, a gated or derived (ripple) clock, or missing uncertainty modelling.`,
      steps: [
        'Never derive a clock from a register output (clk_div <= ~clk_div). Use a clock enable in the fast clock or a PLL output.',
        'Make sure the clock is on a global or regional network (Fitter report: Global & Other Fast Signals).',
        'Hold failures here are usually fixed automatically once the clock is global; do not add delay by hand.',
      ],
      qsf: [...new Set(skewPaths.map(p => p.latch))].map(c => `set_instance_assignment -name GLOBAL_SIGNAL "GLOBAL CLOCK" -to ${brace(c)}`).join('\n'),
      pathIds: skewPaths.map(p => p.id), tns: tnsOf(skewPaths),
    })
  }

  const routePaths = failing.filter(p => p.cause === 'route')
  if (routePaths.length) out.push({
    id: 'route', cause: 'route', severity: 'warn',
    title: `Routing-dominated paths (${routePaths.length})`,
    why: 'These paths have few logic levels and modest fanout, so most of the delay is wire. The registers are probably far apart or the region is congested.',
    steps: ['Add a pipeline register in the middle of long paths between distant blocks.', 'Check the Chip Planner for congestion; relax LogicLock regions that force distant placement.', 'Try a few Fitter seeds (Design Space Explorer) once the real causes above are fixed.'],
    pathIds: routePaths.map(p => p.id), tns: tnsOf(routePaths),
  })

  for (const l of r.lint) if (l.fix && (l.level !== 'info')) out.push({
    id: `sdc:${l.rule}:${l.line}`, cause: 'sdc', severity: l.level, title: l.rule === 'derive_pll_clocks' ? 'Add derive_pll_clocks' : l.rule === 'derive_clock_uncertainty' ? 'Add derive_clock_uncertainty' : l.rule === 'multicycle_hold' ? `Add the hold multicycle for line ${l.line}` : `Fix line ${l.line}`,
    why: l.message, sdc: l.fix, steps: [], pathIds: [], tns: 0,
  })

  return out.sort((a, b) => a.tns - b.tns || sev(a.severity) - sev(b.severity))
}
const sev = (s: Fix['severity']) => s === 'error' ? 0 : s === 'warn' ? 1 : 2
const short = (n: string) => n.length > 34 ? '…' + n.slice(-32) : n

/** Appends fix lines to the SDC once, with a dated comment header. */
export function applyToSdc(sdc: string, fix: Fix, date = new Date().toISOString().slice(0, 10)) {
  if (!fix.sdc || sdc.includes(fix.sdc)) return sdc
  return `${sdc.replace(/\s*$/, '')}\n\n# Timing Triage ${date}: ${fix.title}\n${fix.sdc}\n`
}

export const causeLabel = (c: Fix['cause']) => c === 'sdc' ? 'Constraint lint' : CAUSES[c].short

// ---------- Exports ----------

const csvCell = (v: unknown) => { const s = v === undefined || v === null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

export function pathsCsv(r: Result) {
  const head = ['analysis', 'slack_ns', 'from', 'to', 'launch_clock', 'latch_clock', 'relationship_ns', 'clock_skew_ns', 'data_delay_ns', 'logic_levels', 'max_fanout', 'root_cause', 'cut_by_sdc_line', 'source_line']
  const rows = [...r.paths].sort((a, b) => a.slack - b.slack).map(p => [p.analysis, p.slack, p.from, p.to, p.launch, p.latch, p.relationship, p.skew, p.dataDelay, p.levels, p.fanout, p.cause ? CAUSES[p.cause].short : '', p.cutBy ?? '', p.line])
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n'
}

export function fixesSdc(fixes: Fix[], design: string) {
  const parts = fixes.filter(f => f.sdc).map(f => `# ${f.title}\n${f.sdc}`)
  return `# Suggested constraints for ${design}\n# Review every line before adding it to your project .sdc.\n\n${parts.join('\n\n')}\n`
}
