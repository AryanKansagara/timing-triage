import { bus, CAUSES, rootClock, type Classified, type Result } from './analyze.ts'
import { tclSafe } from './sdc.ts'
import type { Cause, Clock, Settings } from './types.ts'
import { DEFAULT_SETTINGS } from './types.ts'

export interface Fix {
  id: string
  cause: Cause | 'sdc'
  title: string
  why: string
  /** Lines to append to the .sdc file. Applying them re-runs the analysis. */
  sdc?: string
  /** Tool settings applied in the project, not the SDC: Quartus .qsf assignments, or Vivado Tcl/XDC properties */
  qsf?: string
  steps: string[]
  pathIds: string[]
  /** Sum of negative slack on the paths this fix addresses (ns, negative) */
  tns: number
  severity: 'error' | 'warn' | 'info'
}

export const LEFT_OUT = '# Left out: a name here has characters that could run as Tcl code.'
/** Tcl lines for these names, or a note when one of the names could break out of its braces. */
const tcl = (names: (string | undefined)[], lines: string) => names.every(n => n === undefined || tclSafe(n)) ? lines : LEFT_OUT
/** Text inside a # comment: nothing may end the line or continue it. */
const comment = (s: string) => s.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, ' ').replace(/[\\\s]+$/, '')
const brace = (n: string) => `{${n}}`
const f3 = (n: number) => n.toFixed(3)

function tnsOf(ps: Classified[]) {
  const worst = new Map<string, number>()
  for (const p of ps) if (p.slack < 0) worst.set(p.to, Math.min(worst.get(p.to) ?? 0, p.slack))
  return Math.round([...worst.values()].reduce((a, b) => a + b, 0) * 1000) / 1000
}

const COMMON_MHZ = [200, 150, 125, 100, 80, 50, 48, 40, 27, 25, 24, 20, 16, 12, 10, 8, 4, 2, 1]

/** Frequency in MHz for a clock named after its oscillator: CLOCK_50, CLOCK_27_0, clk100, CLK50M, clk_12mhz. */
export function mhzFromName(name: string): number | null {
  const m = name.match(/(\d+)(?:_?m(?:hz)?)?(?:_\d)?$/i)
  const n = m ? Number(m[1]) : NaN
  return n >= 4 && n <= 500 ? n : null
}

/** A starting period for a clock that has none: the frequency in its name, else the fastest common oscillator under its Fmax. */
export function suggestPeriod(name: string, fmaxMhz: number | null): { period: number; mhz: number; from: 'name' | 'fmax' | 'guess' } {
  const named = mhzFromName(name)
  if (named) return { period: 1000 / named, mhz: named, from: 'name' }
  const fit = fmaxMhz ? COMMON_MHZ.find(f => f <= fmaxMhz) : undefined
  return fit ? { period: 1000 / fit, mhz: fit, from: 'fmax' } : { period: 20, mhz: 50, from: 'guess' }
}

const isHier = (n: string) => /[|/:]/.test(n)

export function buildFixes(r: Result, clocks: Clock[], settings: Partial<Settings> = {}): Fix[] {
  const s = { ...DEFAULT_SETTINGS, ...settings }
  const out: Fix[] = []
  const failing = r.paths.filter(p => p.slack < 0 && p.cutBy === null)
  // The same diagnosis needs different commands in each tool.
  const viv = r.format === 'vivado'
  const regs = viv ? 'get_cells' : 'get_registers'
  const cell = (n: string) => n.replace(/\/[A-Z][A-Z0-9]*$/, '')

  // Clocks on the derive_clocks 1 ns placeholder: nothing else is worth fixing until these have a real period.
  r.defaultClocks.forEach((clk, i) => {
    const st = r.clocks.find(c => c.clock === clk)
    const ps = failing.filter(p => p.cause === 'noclock' && (p.latch === clk || p.launch === clk))
    const sug = suggestPeriod(clk, st?.fmax ?? null)
    const basis = sug.from === 'name' ? `${sug.mhz} MHz, read from the pin name` : sug.from === 'fmax' ? `${sug.mhz} MHz, the fastest common oscillator under the reported Fmax` : `${sug.mhz} MHz, a placeholder`
    const target = isHier(clk) ? `[get_registers {${clk}}]` : `[get_ports {${clk}}]`
    out.push({
      id: `noclock:${clk}`, cause: 'noclock', severity: 'error',
      title: `Give ${short(clk)} a real clock constraint`,
      why: `${r.hasSdc ? 'The SDC does not constrain this clock' : 'The project has no SDC'}, so Quartus ran derive_clocks -period 1.0 and timed ${clk} at 1000 MHz. ${ps.length ? `All ${ps.length} failing path${ps.length > 1 ? 's' : ''} on it are` : 'Its slack is'} measured against that placeholder.${st?.fmax ? ` The design runs at up to ${st.fmax.toFixed(2)} MHz on this clock${st.fmaxFrom === 'report' ? ' (Quartus Fmax summary)' : ''}, so any real target at or below that already meets setup.` : ''}`,
      sdc: [`# Set -period to the real clock on this pin. Value below: ${basis}.`, tcl([clk], `create_clock -name {${clk}} -period ${f3(sug.period)} ${target}`), ...(i === 0 && !r.hasSdc ? ['derive_pll_clocks', 'derive_clock_uncertainty'] : [])].join('\n'),
      steps: [
        'Save the lines as <revision>.sdc next to the .qpf and add it to the project (Assignments > Settings > Timing Analyzer), then recompile so the Fitter optimises for the real target.',
        'Applying the fix here re-estimates same-clock setup slack at the new period; hold slack does not depend on the period.',
        ...(isHier(clk) ? ['This clock is a register output (a ripple or divided clock). Prefer a clock enable in the source clock domain; if it must stay, describe it with create_generated_clock -divide_by from its source clock instead.'] : []),
      ],
      pathIds: ps.map(p => p.id), tns: Math.min(tnsOf(ps), st?.tns ?? 0),
    })
  })

  // Nodes the tool found driving clock pins with no constraint at all: their registers are not timed.
  if (r.unconstrainedClocks.length) {
    const base = r.clocks.find(c => c.period && !c.isDefault)
    const vivado = r.format === 'vivado'
    const lines = r.unconstrainedClocks.slice(0, 12).map(n => {
      if (![n, base?.clock ?? ''].every(tclSafe)) return LEFT_OUT
      if (!isHier(n) && /\[\d+\]$/.test(n) && !vivado) return `create_generated_clock -name {${n}} -source [get_ports {${base?.clock ?? 'clk'}}] -divide_by 2 [get_registers {${n}}]`
      const nm = n.replace(/\/[A-Z]+$/, '').split(/[|/]/).pop()!.replace(/[^\w]/g, '_')
      if (!isHier(n)) { const sug = suggestPeriod(n, null); return `create_clock -name {${n}} -period ${f3(sug.period)} [get_ports {${n}}]` }
      return vivado
        ? `create_generated_clock -name ${nm} -source [get_pins {${n.replace(/\/Q$/, '/C')}}] -divide_by 2 [get_pins {${n}}]`
        : `create_generated_clock -name {${nm}} -source [get_ports {${base?.clock ?? 'clk'}}] -divide_by 2 [get_registers {${n}}]`
    })
    out.push({
      id: 'undefined-clocks', cause: 'sdc', severity: 'error',
      title: `Constrain ${r.unconstrainedClocks.length} undefined clock${r.unconstrainedClocks.length > 1 ? 's' : ''}`,
      why: `${r.unconstrainedClocks.slice(0, 3).join(', ')}${r.unconstrainedClocks.length > 3 ? ` and ${r.unconstrainedClocks.length - 3} more` : ''} drive${r.unconstrainedClocks.length === 1 ? 's' : ''} register clock pins but ${r.unconstrainedClocks.length === 1 ? 'has' : 'have'} no clock constraint. Every register they clock is left out of timing analysis, so the report looks cleaner than the design is.`,
      sdc: lines.join('\n'),
      steps: [
        'For a pin, set -period to the real oscillator. For a register output used as a clock, set -divide_by to the real ratio and -source to the clock that register runs on.',
        'A register output used as a clock is a ripple clock: it adds skew and often hold failures. Where you can, replace it with a clock enable.',
      ],
      pathIds: [], tns: 0,
    })
  }

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
      else steps.push(`${t.bus}: ${t.width} bits cross together. Two-flop synchronizers per bit can tear the word; use a dual-clock FIFO (${viv ? 'xpm_fifo_async' : 'dcfifo'}), a valid/ack handshake, or Gray-code it if it is a counter.`)
    }
    out.push({
      id: `cdc:${key}`, cause: 'cdc', severity: ps.length ? 'error' : 'warn',
      title: `Declare ${short(a)} and ${short(b)} asynchronous`,
      why: `${viv ? 'Vivado' : 'Timing Analyzer'} assumes ${short(a)} and ${short(b)} are related and times ${crossings.reduce((n, x) => n + x.paths, 0)} crossing path${crossings.length === 1 && crossings[0].paths === 1 ? '' : 's'} against the closest pair of edges, which is not a real requirement. The crossing needs a synchronizer in RTL and a constraint that says the clocks are unrelated.`,
      sdc: tcl([...ga, ...gb], `set_clock_groups -asynchronous \\\n  -group [get_clocks {${ga.join(' ')}}] \\\n  -group [get_clocks {${gb.join(' ')}}]`),
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
    const worst = Math.min(...ps.map(p => p.slack))
    const wp = ps.find(p => p.slack === worst)!
    // Without a level count, size the pipeline from how many requirements the data delay spans.
    const stages = Math.max(2, lv ? Math.ceil(lv / s.maxLevels) : Math.ceil((wp.dataDelay ?? 0) / (wp.relationship || Infinity)))
    const from = bus(ps[0].from)
    out.push({
      id: `logic:${to}`, cause: 'logic', severity: 'error',
      title: lv ? `Pipeline ${to} (${lv} levels of logic)` : `Pipeline ${to} (${f3(wp.dataDelay ?? 0)} ns of data path in a ${f3(wp.relationship ?? 0)} ns requirement)`,
      why: lv
        ? `${ps.length} path${ps.length > 1 ? 's' : ''} into ${to} ${ps.length > 1 ? 'go' : 'goes'} through up to ${lv} levels of logic and ${ps.length > 1 ? 'miss' : 'misses'} by up to ${f3(-worst)} ns on ${ps[0].latch}. Each LUT level plus routing costs roughly 0.4 to 0.7 ns, so the budget at this clock is about ${s.maxLevels} levels.`
        : `${ps.length} path${ps.length > 1 ? 's' : ''} into ${to} need up to ${f3(wp.dataDelay ?? 0)} ns of data delay but the clock allows ${f3(wp.relationship ?? 0)} ns, so they miss by up to ${f3(-worst)} ns on ${ps[0].latch}. This report has no logic-level count; export report_timing -detail full_path to see whether cells or routing dominate.`,
      steps: [
        ...cellHints(ps),
        `Split the cone from ${from} into ${stages} register stages${lv ? ` (about ${Math.ceil(lv / stages)} levels each)` : ''} and add matching latency on any parallel path.`,
        `If the datapath is a wide add, compare or multiply, use the DSP block or a carry-chain friendly form instead of LUT logic.`,
        viv ? 'Once a pipeline register exists, synthesis retiming (below) or phys_opt_design -retime can balance the stages for you.' : 'On Quartus Pro (Stratix 10 / Agilex), Hyper-Retiming can move registers into the cone once a pipeline register exists.',
        `Only if the destination is enabled every 2nd cycle, a multicycle exception is valid instead (shown below with its hold pair).`,
      ],
      qsf: viv ? 'set_property STEPS.SYNTH_DESIGN.ARGS.RETIMING true [get_runs synth_1]' : 'set_global_assignment -name ALLOW_REGISTER_RETIMING ON',
      sdc: tcl([from, to], `# Only valid if ${to} is enabled every 2nd clock:\n# set_multicycle_path -setup 2 -from [${regs} {${from}}] -to [${regs} {${to}}]\n# set_multicycle_path -hold 1 -from [${regs} {${from}}] -to [${regs} {${to}}]`),
      pathIds: ps.map(p => p.id), tns: tnsOf(ps),
    })
  }

  function cellHints(ps: Classified[]): string[] {
    const cells = ps.map(p => p.levelDetail ?? '').join(' ')
    const worst = [...ps].sort((a, b) => a.slack - b.slack)[0]
    const share = worst.logicDelay !== undefined && worst.dataDelay ? ` Cells are ${Math.round(100 * worst.logicDelay / worst.dataDelay)}% of the ${f3(worst.dataDelay)} ns data path; routing is the rest.` : ''
    const out: string[] = []
    if (/DSP48/.test(cells)) out.push(`The path runs through a DSP48 block.${share} Turn on its internal registers (AREG/BREG, MREG, PREG) by registering the multiplier inputs, product and output in RTL so synthesis can absorb them.`)
    if (/RAMB/.test(cells)) out.push('The path starts or ends in block RAM. Enable the RAM output register (DOA_REG/DOB_REG = 1) or register the read data before using it.')
    const carry = Number(cells.match(/CARRY\d*=(\d+)/)?.[1] ?? 0)
    if (carry >= 6) out.push(`${carry} carry cells in a row means a ${carry * 4}-bit or wider add or compare in one cycle. Split it into two narrower stages or register the operands and the result.`)
    return out
  }

  for (const [from, ps] of groupBy('fanout', p => p.from)) {
    const fo = Math.max(...ps.map(p => p.fanout ?? 0))
    out.push({
      id: `fanout:${from}`, cause: 'fanout', severity: 'error',
      title: `Duplicate ${from} (fanout ${fo})`,
      why: `${from} drives ${fo} loads, so its net is spread across the die and every load waits for the slowest branch. ${ps.length} failing path${ps.length > 1 ? 's' : ''} start here.`,
      qsf: tcl([viv ? cell(from) : from], viv ? `set_property MAX_FANOUT ${Math.max(16, Math.min(64, Math.round(fo / 16)))} [get_cells ${brace(cell(from))}]` : `set_instance_assignment -name MAX_FANOUT ${Math.max(16, Math.min(64, Math.round(fo / 16)))} -to ${brace(from)}`),
      steps: [
        viv ? 'Let synthesis replicate the register with the MAX_FANOUT property below, run phys_opt_design -fanout_opt, or duplicate it by hand per consuming block.' : 'Let the Fitter duplicate the register with the MAX_FANOUT assignment below, or duplicate it by hand per consuming block.',
        /rst|reset/i.test(from) ? 'This looks like a reset: make it synchronous per clock domain and pipeline it through a reset tree, or put it on a global buffer.' : 'Add a pipeline register per consumer group so each copy has a local, small fanout.',
      ],
      pathIds: ps.map(p => p.id), tns: tnsOf(ps),
    })
  }

  // I/O: failing port paths plus ports the report lists as unconstrained.
  const ioPaths = failing.filter(p => p.cause === 'io')
  const inPorts = new Set(r.unconstrainedPorts.filter(u => u.kind === 'input').map(u => bus(u.name)))
  const outPorts = new Set(r.unconstrainedPorts.filter(u => u.kind === 'output').map(u => bus(u.name)))
  if (r.portCounts && !inPorts.size && !outPorts.size) out.push({
    id: 'io-counts', cause: 'io', severity: 'warn',
    title: `Constrain ${r.portCounts.inputs} input and ${r.portCounts.outputs} output ports`,
    why: `The report counts ${r.portCounts.inputs} input and ${r.portCounts.outputs} output ports with no set_input_delay or set_output_delay. They are not timed at all, so the tool can place their registers anywhere and the board interface is unchecked. This export does not name them.`,
    steps: [
      r.format === 'vivado' ? 'List them in Vivado with: check_timing -verbose -file check_timing.rpt' : 'List them in Quartus with: report_ucp -file ucp.rpt, then import that file here to get a per-port template.',
      'Constrain synchronous interfaces with set_input_delay / set_output_delay against the interface clock, using the external device datasheet.',
      'Buttons, switches, LEDs and other asynchronous pins should get set_false_path -from [get_ports ...] or -to [get_ports ...] instead, after a synchronizer on inputs.',
    ],
    pathIds: [], tns: 0,
  })
  if (ioPaths.length || inPorts.size || outPorts.size) {
    const st = r.clocks.find(c => c.period)
    const clk = st?.clock ?? 'clk'
    const per = st?.isDefault ? suggestPeriod(clk, st.fmax).period : st?.period ?? 10
    const lines = ['# Board-level clock that launches/captures the external device; adjust to the real interface.', `create_clock -name virt_${clk.replace(/[^\w]/g, '_')} -period ${f3(per)}`]
    for (const p of inPorts) lines.push(...!tclSafe(p) ? [LEFT_OUT] : [`set_input_delay -clock virt_${clk.replace(/[^\w]/g, '_')} -max ${f3(per * 0.4)} [get_ports {${p}}]`, `set_input_delay -clock virt_${clk.replace(/[^\w]/g, '_')} -min 0.000 [get_ports {${p}}]`])
    for (const p of outPorts) lines.push(...!tclSafe(p) ? [LEFT_OUT] : [`set_output_delay -clock virt_${clk.replace(/[^\w]/g, '_')} -max ${f3(per * 0.3)} [get_ports {${p}}]`, `set_output_delay -clock virt_${clk.replace(/[^\w]/g, '_')} -min 0.000 [get_ports {${p}}]`])
    const ports = [...new Set(ioPaths.map(p => bus(p.port ? p[p.port] : p.from.includes('|') || p.from.includes('/') ? p.to : p.from)))]
    out.push({
      id: 'io', cause: 'io', severity: ioPaths.length ? 'error' : 'warn',
      title: inPorts.size || outPorts.size ? `Constrain ${inPorts.size + outPorts.size} unconstrained I/O port group${inPorts.size + outPorts.size > 1 ? 's' : ''}` : `Fix I/O timing on ${ports.slice(0, 2).join(', ')}`,
      why: `${inPorts.size + outPorts.size ? `Ports without set_input_delay or set_output_delay are not timed at all, so the Fitter can place their registers anywhere. ` : ''}${ioPaths.length ? `${ioPaths.length} I/O path${ioPaths.length > 1 ? 's fail' : ' fails'}: the external budget leaves too little time inside the FPGA.` : ''}`.trim(),
      sdc: inPorts.size || outPorts.size ? lines.join('\n') : undefined,
      qsf: !ports.length ? undefined : viv ? ports.map(p => tcl([p], `set_property IOB TRUE [get_ports ${brace(p)}]`)).join('\n') : ports.map(p => tcl([p], `set_instance_assignment -name ${ioPaths.some(x => x.port !== 'to' && bus(x.from) === p) ? 'FAST_INPUT_REGISTER' : 'FAST_OUTPUT_REGISTER'} ON -to ${brace(p)}`)).join('\n'),
      steps: [
        'Take -max/-min from the external device datasheet and board trace delay; the values below are placeholders sized from the clock period.',
        'Asynchronous inputs (buttons, UART RX) need a synchronizer, then a set_false_path -from the port instead of an input delay.',
        ioPaths.some(p => p.analysis === 'hold') ? 'The failing check is hold: the pin changes too soon after the capture edge. Check the -min delay first. If the capture clock is a PLL or MMCM output of the pin clock, its insertion delay is the skew; shift that output\'s phase or delay the data in the I/O cell.' : '',
        ports.length ? `Pack the first/last register into the I/O cell (${viv ? 'the IOB property' : 'FAST_INPUT_REGISTER / FAST_OUTPUT_REGISTER'}) to make the path deterministic.` : '',
      ].filter(Boolean),
      pathIds: ioPaths.map(p => p.id), tns: tnsOf(ioPaths),
    })
  }

  for (const [clk, ps] of groupBy('edge', p => p.latch)) {
    const per = r.clocks.find(c => c.clock === clk)?.period ?? 0
    const worst = [...ps].sort((a, b) => a.slack - b.slack)[0]
    const fits = worst.dataDelay !== undefined && worst.dataDelay < per
    out.push({
      id: `edge:${clk}`, cause: 'edge', severity: 'error',
      title: `Opposite-edge paths on ${short(clk)} get ${f3(per / 2)} ns, not ${f3(per)} ns`,
      why: `${ps.length} failing path${ps.length > 1 ? 's' : ''} launch on one edge of ${clk} and latch on the other, so the requirement is half the period. The worst needs ${f3(worst.dataDelay ?? 0)} ns of data delay${fits ? ', which would fit in a full cycle' : ', which is over a full cycle too, so it also needs pipelining'}.`,
      steps: [
        `Find the falling-edge register: ${bus(worst.from)} or ${bus(worst.to)} is clocked on negedge (or through an inverted clock). Clock both ends on the same edge unless the interface needs otherwise.`,
        'If a half-cycle shift is intended (SDRAM, DDR or SPI capture), use a phase-shifted PLL output for that register and constrain it, instead of inverting the clock in logic.',
        'Block RAM address registers clocked on the opposite edge are a common cause: use the same edge and accept one cycle of read latency.',
      ],
      pathIds: ps.map(p => p.id), tns: tnsOf(ps),
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
        viv ? 'Make sure the clock is on a BUFG or BUFR (report_clock_utilization), not on general routing.' : 'Make sure the clock is on a global or regional network (Fitter report: Global & Other Fast Signals).',
        'Hold failures here are usually fixed automatically once the clock is global; do not add delay by hand.',
      ],
      qsf: viv ? undefined : [...new Set(skewPaths.map(p => p.latch))].map(c => tcl([c], `set_instance_assignment -name GLOBAL_SIGNAL "GLOBAL CLOCK" -to ${brace(c)}`)).join('\n'),
      pathIds: skewPaths.map(p => p.id), tns: tnsOf(skewPaths),
    })
  }

  const routePaths = failing.filter(p => p.cause === 'route')
  if (routePaths.length) out.push({
    id: 'route', cause: 'route', severity: 'warn',
    title: `Routing-dominated paths (${routePaths.length})`,
    why: 'These paths have few logic levels and modest fanout, so most of the delay is wire. The registers are probably far apart or the region is congested.',
    steps: ['Add a pipeline register in the middle of long paths between distant blocks.', viv ? 'Check report_design_analysis -congestion and the Device view; relax Pblocks that force distant placement.' : 'Check the Chip Planner for congestion; relax LogicLock regions that force distant placement.', viv ? 'Try other implementation strategies (Performance_Explore, ExtraTimingOpt) once the real causes above are fixed.' : 'Try a few Fitter seeds (Design Space Explorer) once the real causes above are fixed.'],
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
  return `${sdc.replace(/\s*$/, '')}\n\n# Timing Triage ${date}: ${comment(fix.title)}\n${fix.sdc}\n`
}

export const causeLabel = (c: Fix['cause']) => c === 'sdc' ? 'Constraint lint' : CAUSES[c].short

// ---------- Exports ----------

/** A spreadsheet runs text that starts like a formula, so it gets a leading apostrophe. Numbers stay numbers. */
const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : typeof v === 'string' && /^\s*[=+\-@＝＋－＠]/.test(v) ? `'${v}` : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function pathsCsv(r: Result) {
  const head = ['analysis', 'slack_ns', 'from', 'to', 'launch_clock', 'latch_clock', 'relationship_ns', 'clock_skew_ns', 'data_delay_ns', 'logic_levels', 'max_fanout', 'root_cause', 'cut_by_sdc_line', 'source_line']
  const rows = [...r.paths].sort((a, b) => a.slack - b.slack).map(p => [p.analysis, p.slack, p.from, p.to, p.launch, p.latch, p.relationship, p.skew, p.dataDelay, p.levels, p.fanout, p.cause ? CAUSES[p.cause].short : '', p.cutBy ?? '', p.line])
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n'
}

export function fixesSdc(fixes: Fix[], design: string) {
  const parts = fixes.filter(f => f.sdc).map(f => `# ${comment(f.title)}\n${f.sdc}`)
  return `# Suggested constraints for ${comment(design)}\n# Review every line before adding it to your project .sdc.\n\n${parts.join('\n\n')}\n`
}
