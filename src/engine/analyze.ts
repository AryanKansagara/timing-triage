import { clocksCut, ioConstrained, lintSdc, parseSdc, pathCut, type LintFinding, type SdcModel } from './sdc.ts'
import type { Analysis, Cause, Clock, ParsedReport, Format, ReportMeta, Settings, TimingPath } from './types.ts'
import { DEFAULT_SETTINGS } from './types.ts'

export const CAUSES: Record<Cause, { label: string; short: string }> = {
  noclock: { label: 'No clock constraint: timed against a default 1 ns clock', short: 'No clock constraint' },
  cdc: { label: 'Clock-domain crossing without a constraint', short: 'Unconstrained CDC' },
  io: { label: 'I/O constraint missing or too tight', short: 'I/O constraint' },
  edge: { label: 'Opposite-edge transfer: only half the period is available', short: 'Half-cycle path' },
  logic: { label: 'Data path too long for the clock period', short: 'Logic depth' },
  fanout: { label: 'High-fanout net', short: 'High fanout' },
  skew: { label: 'Clock skew or uncertainty dominated', short: 'Clock skew' },
  route: { label: 'Placement and routing delay', short: 'Routing' },
}

export interface Classified extends TimingPath {
  cause: Cause | null
  /** SDC line that cuts this path (clock groups or false path), if any */
  cutBy: number | null
  cross: boolean
  /** For I/O causes: the end that is the device port */
  port?: 'from' | 'to'
}

export interface ClockStat {
  clock: string; period: number | null; wns: number; tns: number; failing: number; total: number; holdWns: number | null; holdTns: number
  /** MHz. Taken from the tool's own Fmax summary when the report has one, else estimated from same-clock setup slack. */
  fmax: number | null
  fmaxFrom: 'report' | 'estimate' | null
  /** Unrounded estimate from the listed same-clock paths, for the what-if slider */
  fmaxEst: number | null
  /** Failing setup endpoints the tool reports for this clock, which can exceed the paths listed in the export */
  endpoints?: number
  /** Timed against the 1 ns placeholder from derive_clocks -period 1.0 */
  isDefault: boolean
}
export interface Group { key: string; label: string; launch: string; latch: string; paths: string[]; failing: number; wns: number; tns: number }
export interface Crossing { launch: string; latch: string; status: 'cut' | 'related' | 'unconstrained'; cutBy: number | null; paths: number; failing: number; wns: number; toBuses: { bus: string; width: number; synchronized: boolean }[] }
export interface Retimed { clock: string; from: number; to: number; sdcName: string }
export interface CauseStat { cause: Cause; paths: string[]; wns: number; tns: number }

export interface Result {
  paths: Classified[]
  clocks: ClockStat[]
  pairs: Group[]
  buses: Group[]
  causes: CauseStat[]
  crossings: Crossing[]
  lint: LintFinding[]
  unconstrainedPorts: { kind: 'input' | 'output'; name: string }[]
  /** Null when the report has no setup or recovery result that the SDC leaves uncut: unknown, not met */
  wns: number | null
  tns: number
  holdWns: number | null
  holdTns: number
  failing: number
  total: number
  /** Clock definitions the analysis used: report clocks, SDC clocks and SDC periods applied to default clocks */
  clockDefs: Clock[]
  meta: ReportMeta
  /** Design-wide failing endpoint counts from the tool, when it reports them. Listed paths are usually a subset. */
  endpoints: { failing: number; total: number; holdFailing: number } | null
  /** Clocks still on the derive_clocks 1 ns placeholder */
  defaultClocks: string[]
  /** Default clocks given a real period by the SDC; same-clock setup slack is re-estimated for them */
  retimed: Retimed[]
  /** The report has summaries but no path tables */
  summaryOnly: boolean
  /** Unconstrained port counts when the report gives numbers but no names */
  portCounts: { inputs: number; outputs: number } | null
  /** Nodes the tool found driving clock pins without any clock constraint */
  unconstrainedClocks: string[]
  format: Format
  hasSdc: boolean
}

/** `u_rx|data[3]` -> `u_rx|data[*]` so register buses group together. */
export const bus = (n: string) => n.replace(/\/[A-Z]{1,3}$/, '').replace(/\[\d+\](?=[^[]*$)/, '[*]')
const bit = (n: string) => n.match(/\[(\d+)\](?=[^[]*$)/)?.[1]

// Video and framing syncs are data, not synchronizers: h_sync, vga_sync, frame_sync, sync_gen.
const NOT_SYNC_BEFORE = new Set(['h', 'v', 'c', 'a', 'hor', 'horiz', 'horizontal', 'vert', 'vertical', 'video', 'vga', 'hdmi', 'dvi', 'frame', 'line', 'field', 'composite'])
const NOT_SYNC_AFTER = new Set(['h', 'v', 'gen', 'generator', 'word', 'byte', 'pulse', 'pattern', 'detect', 'separator'])
/** Whole words of the name only: `rx_sync`, `busy_meta`, `data_ff1`, not `hsync`, `async` or `metadata`. */
export function isSyncName(name: string) {
  const w = (name.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? []).map(x => x.toLowerCase())
  return w.some((x, i) => {
    const prev = w[i - 1], next = w[i + 1]
    if (/^(re)?sync(h|er|ed|d|ff|reg|stages?|hroni[sz](er|ers|ed))?$/.test(x)) return !NOT_SYNC_BEFORE.has(prev) && !NOT_SYNC_AFTER.has(next)
    if (x === 'meta') return next !== 'data'
    if (x === 'cdc') return prev !== 'usb'
    return /^metastab/.test(x)
  }) || /_ff[12]\b|(?<![a-z])(dff|s_?reg)[12](?!\d)/i.test(name)
}
/** One bit into a synchronizer stage. Several bits can tear, and a bit above 0 is part of a wider register. */
const isSynchronized = (name: string, bits: Set<string>) => bits.size === 1 && bits.has('0') && isSyncName(name)

const bare = (name: string) => !/[|/:~]/.test(name)

interface PortCtx { clocks: Clock[]; ports: Set<string>; format?: Format; regs?: Set<string> }
/**
 * Which ends of a path are device ports. Quartus prints top-level registers without hierarchy, so a bare name is only
 * a port with evidence: it is listed as one, its clock is virtual, or the other end is inside the design.
 * Vivado always prints a register's pin (`cnt_reg[0]/C`), so there a bare name is a port.
 */
export function portEnds(p: TimingPath, ctx: PortCtx): { from: boolean; to: boolean } {
  const known = (n: string) => ctx.ports.has(n) || ctx.ports.has(bus(n))
  const virtual = (c: string) => ctx.clocks.find(x => x.name === c)?.kind === 'virtual'
  const pair = ctx.format !== 'vivado' && bare(p.from) && bare(p.to)
  const end = (n: string, clock: string) => known(n) || (bare(n) && (!pair || virtual(clock)) && !ctx.regs?.has(bus(n)))
  return { from: end(p.from, p.launch), to: end(p.to, p.latch) }
}

/** Bare Quartus names that other paths show to be registers: they launch and latch between top-level names. */
function topRegisters(paths: TimingPath[], ctx: PortCtx) {
  const pairs = ctx.format === 'vivado' ? [] : paths.filter(p => bare(p.from) && bare(p.to) && p.launch && p.latch && !portEnds(p, ctx).from && !portEnds(p, ctx).to)
  const from = new Set(pairs.map(p => bus(p.from)))
  return new Set(pairs.map(p => bus(p.to)).filter(n => from.has(n)))
}

/** The ultimate source clock: generated clocks resolve to their master, PLL outputs share a PLL instance. */
export function rootClock(name: string, clocks: Clock[]): string {
  const seen = new Set<string>()
  let n = name
  while (!seen.has(n)) {
    seen.add(n)
    const c = clocks.find(x => x.name === n)
    if (c?.master && c.master !== n) n = c.master
    else break
  }
  const pll = n.match(/^(.*?\|(?:pll\d*|altpll_component|auto_generated|iopll_0|pll_inst)[^|]*)\|/i)
  return pll ? pll[1] : n
}

export function mergeClocks(report: Clock[], sdc: SdcModel | null): Clock[] {
  const out = [...report]
  for (const c of sdc?.clocks ?? []) if (!out.some(x => x.name === c.name) && Number.isFinite(c.period)) out.push({ name: c.name, period: c.period, kind: c.kind, master: c.master, source: c.source })
  return out
}

const tooLong = (p: TimingPath) => p.dataDelay !== undefined && p.relationship !== undefined && p.dataDelay >= p.relationship

/** Launch and latch on opposite edges of the same clock: the requirement is half the period. */
export function isHalfCycle(p: TimingPath, clocks: Clock[]) {
  if (p.analysis !== 'setup' || p.relationship === undefined || !p.launch) return false
  const a = clocks.find(c => c.name === p.launch)?.period, b = clocks.find(c => c.name === p.latch)?.period
  return !!a && a === b && Math.abs(p.relationship - a / 2) <= a * 0.02
}

export function classify(p: TimingPath, ctx: { clocks: Clock[]; sdc: SdcModel | null; ports: Set<string>; s: Settings; defaults?: Set<string>; format?: Format; regs?: Set<string> }): Classified {
  const cross = !!p.launch && !!p.latch && p.launch !== p.latch
  const cutBy = cross ? clocksCut(ctx.sdc, p.launch, p.latch, p.analysis) ?? pathCut(ctx.sdc, p.from, p.to, p.analysis) : pathCut(ctx.sdc, p.from, p.to, p.analysis)
  const base: Classified = { ...p, cause: null, cutBy, cross }
  if (p.slack >= 0 || cutBy !== null) return base
  const s = ctx.s
  let cause: Cause
  const ends = portEnds(p, ctx)
  const unrelated = cross && rootClock(p.launch, ctx.clocks) !== rootClock(p.latch, ctx.clocks)
  if (ctx.defaults?.has(p.latch) || ctx.defaults?.has(p.launch)) cause = 'noclock'
  else if (ends.from || ends.to || !p.launch || !p.latch) cause = 'io'
  else if (unrelated) cause = 'cdc'
  // Hold and removal fail when the latch clock arrives later than the data: more logic cannot cause it.
  else if (p.analysis === 'hold' || p.analysis === 'removal') cause = 'skew'
  else if (isHalfCycle(p, ctx.clocks)) cause = 'edge'
  else if ((p.levels ?? 0) > s.maxLevels) cause = 'logic'
  else if ((p.fanout ?? 0) >= s.maxFanout) cause = 'fanout'
  // Skew is to blame when removing it (and the uncertainty) would close the path, and the data path alone fits.
  else if (Math.abs(p.skew ?? 0) + (p.uncertainty ?? 0) >= Math.abs(p.slack) && Math.abs(p.skew ?? 0) > 0.05 && !tooLong(p)) cause = 'skew'
  // Summary tables carry no logic depth or fanout. A data path longer than its requirement needs
  // restructuring whatever it is made of.
  else if (p.levels === undefined && p.fanout === undefined && tooLong(p)) cause = 'logic'
  // Few levels but mostly cell delay: a RAM, DSP or carry chain without an output register.
  else if (p.logicDelay !== undefined && p.dataDelay && p.logicDelay / p.dataDelay >= 0.6) cause = 'logic'
  else cause = 'route'
  return cause === 'io' && (ends.from || ends.to) ? { ...base, cause, port: ends.from ? 'from' : 'to' } : { ...base, cause }
}

const sumNeg = (paths: TimingPath[]) => {
  // TNS is the sum of the worst negative slack per endpoint.
  const worst = new Map<string, number>()
  for (const p of paths) if (p.slack < 0) worst.set(p.to + '\u0000' + p.latch, Math.min(worst.get(p.to + '\u0000' + p.latch) ?? 0, p.slack))
  return [...worst.values()].reduce((a, b) => a + b, 0)
}
const round = (n: number) => Math.round(n * 1000) / 1000

export function fmax(period: number, worstSlack: number) {
  const t = period - worstSlack
  return t > 0 ? 1000 / t : null
}

/**
 * How many periods a same-clock setup path has: 0.5 for opposite edges, 2 for a two-cycle multicycle.
 * Its requirement, and so its slack, moves by this much per ns of period. One when the report does not say.
 */
export const cycles = (p: Pick<TimingPath, 'relationship'>, period: number) => p.relationship !== undefined && p.relationship > 0 && period > 0 ? p.relationship / period : 1

export interface Inputs { report: ParsedReport; sdcText?: string; settings?: Partial<Settings> }

export function analyze({ report, sdcText, settings }: Inputs): Result {
  const s = { ...DEFAULT_SETTINGS, ...settings }
  const sdc = sdcText?.trim() ? parseSdc(sdcText) : null
  const isMax = (a: Analysis) => a === 'setup' || a === 'recovery'

  // A clock Quartus invented at 1 ns gets its real period as soon as the SDC constrains the same port.
  const retimed: Retimed[] = []
  for (const d of report.defaultClocks ?? []) {
    const c = sdc?.clocks.find(x => x.kind !== 'generated' && x.kind !== 'virtual' && Number.isFinite(x.period) && x.period > 0 && (x.name === d || x.source === d))
    const from = report.clocks.find(x => x.name === d)?.period ?? 1
    if (c && c.period !== from) retimed.push({ clock: d, from, to: c.period, sdcName: c.name })
  }
  const shift = new Map(retimed.map(x => [x.clock, x]))
  const defaults = new Set((report.defaultClocks ?? []).filter(d => !shift.has(d)))
  const alias = new Set(retimed.filter(x => x.sdcName !== x.clock).map(x => x.sdcName))
  const clocks = mergeClocks(report.clocks, sdc).filter(c => !alias.has(c.name)).map(c => shift.has(c.name) ? { ...c, period: shift.get(c.name)!.to } : c)

  const ports = new Set(report.unconstrained.filter(u => u.kind !== 'clock').map(u => u.name))
  for (const d of sdc?.io ?? []) for (const p of d.ports.patterns) ports.add(p)
  const ctx = { clocks, sdc, ports, s, defaults, format: report.format, regs: topRegisters(report.paths, { clocks, ports, format: report.format }) }
  const all = report.paths.filter(p => s.includeHold || isMax(p.analysis)).map(p => {
    const x = p.launch === p.latch && isMax(p.analysis) ? shift.get(p.latch) : undefined
    if (!x) return classify(p, ctx)
    const k = cycles(p, x.from)
    return classify({ ...p, slack: round(p.slack + k * (x.to - x.from)), relationship: p.relationship !== undefined && p.relationship > 0 ? round(k * x.to) : p.relationship }, ctx)
  })
  const live = all.filter(p => p.cutBy === null)
  const failing = live.filter(p => p.slack < 0)

  const period = (c: string) => clocks.find(x => x.name === c)?.period ?? null
  const clockNames = [...new Set([...live.map(p => p.latch).filter(Boolean), ...clocks.filter(c => c.kind !== 'virtual').map(c => c.name)])]
  const clockStats: ClockStat[] = clockNames.map(c => {
    const mine = live.filter(p => p.latch === c)
    const setup = mine.filter(p => isMax(p.analysis))
    const hold = mine.filter(p => !isMax(p.analysis))
    // The tool's own per-clock summary covers every endpoint, not just the listed paths. It goes stale
    // once the SDC in the app cuts paths of that kind on this clock.
    const stale = (a: Analysis) => all.some(p => p.cutBy !== null && p.latch === c && isMax(p.analysis) === isMax(a))
    const sum = (a: Analysis) => !stale(a) ? report.summary.find(x => x.clock === c && x.analysis === a) : undefined
    const moved = shift.get(c)
    // Recovery is a max-delay check and removal a min-delay one, like their path rows. Their endpoints are separate.
    // A retimed clock keeps its summary slack, shifted by the period change; its total is no longer known.
    const worst = (ans: Analysis[], listed: Classified[]) => {
      const rows = ans.map(sum)
      const shown = rows.map(x => x && moved && isMax(x.analysis) ? { ...x, slack: x.slack + moved.to - moved.from, tns: 0 } : x)
      // A met recovery or removal row alone does not say that setup or hold is met.
      if (!shown[0] && !listed.length && (shown[1]?.slack ?? 0) >= 0) shown[1] = undefined
      const tns = shown.reduce((t, x, i) => t + Math.min(x?.tns ?? 0, sumNeg(listed.filter(p => p.analysis === ans[i]))), 0)
      return { slack: Math.min(...shown.map(x => x?.slack ?? Infinity)), tns: shown.some(Boolean) ? Math.min(tns, sumNeg(listed)) : sumNeg(listed), failing: shown[0]?.failing }
    }
    const sumS = worst(['setup', 'recovery'], setup)
    const sumH = s.includeHold ? worst(['hold', 'removal'], hold) : { slack: Infinity, tns: sumNeg(hold) }
    const wns = Math.min(setup.length ? Math.min(...setup.map(p => p.slack)) : Infinity, sumS.slack)
    const same = setup.filter(p => p.launch === c)
    const per = period(c)
    const reported = report.fmax?.find(x => x.clock === c)
    // Each path needs its requirement minus its slack; divided by its cycles, that is the period it allows.
    const need = per && same.length ? Math.max(...same.map(p => per - p.slack / cycles(p, per))) : 0
    const est = need > 0 ? 1000 / need : null
    const holdWns = Math.min(hold.length ? Math.min(...hold.map(p => p.slack)) : Infinity, sumH.slack)
    return {
      clock: c, period: per, wns: round(wns), tns: round(sumS.tns),
      failing: mine.filter(p => p.slack < 0).length, total: mine.length,
      holdWns: Number.isFinite(holdWns) ? round(holdWns) : null, holdTns: round(sumH.tns),
      fmax: reported?.fmax ?? est, fmaxFrom: reported ? 'report' : est ? 'estimate' : null, fmaxEst: est,
      endpoints: sumS.failing, isDefault: defaults.has(c),
    } satisfies ClockStat
  }).sort((a, b) => a.wns - b.wns)

  const group = (keyOf: (p: Classified) => [string, string]) => {
    const m = new Map<string, Group>()
    for (const p of live) {
      const [key, label] = keyOf(p)
      const g = m.get(key) ?? { key, label, launch: p.launch, latch: p.latch, paths: [], failing: 0, wns: Infinity, tns: 0 }
      g.paths.push(p.id)
      if (p.slack < 0) g.failing++
      g.wns = Math.min(g.wns, p.slack)
      m.set(key, g)
    }
    for (const g of m.values()) g.tns = round(sumNeg(live.filter(p => g.paths.includes(p.id))))
    return [...m.values()].sort((a, b) => a.wns - b.wns)
  }
  const pairs = group(p => [`${p.launch}→${p.latch}`, p.launch === p.latch ? p.latch || '(no clock)' : `${p.launch || '(none)'} → ${p.latch || '(none)'}`])
  const buses = group(p => [`${bus(p.from)}→${bus(p.to)}`, `${bus(p.from)} → ${bus(p.to)}`])

  const causes: CauseStat[] = (Object.keys(CAUSES) as Cause[]).map(cause => {
    const ps = failing.filter(p => p.cause === cause)
    return { cause, paths: ps.map(p => p.id), wns: ps.length ? Math.min(...ps.map(p => p.slack)) : 0, tns: round(sumNeg(ps)) }
  }).filter(c => c.paths.length).sort((a, b) => a.tns - b.tns)

  const crossMap = new Map<string, Classified[]>()
  for (const p of all) if (p.cross) crossMap.set(p.launch + '\u0000' + p.latch, [...(crossMap.get(p.launch + '\u0000' + p.latch) ?? []), p])
  for (const t of report.transfers) if (t.from !== t.to && !crossMap.has(t.from + '\u0000' + t.to) && !t.falsePath) crossMap.set(t.from + '\u0000' + t.to, [])
  const crossings: Crossing[] = [...crossMap.entries()].map(([k, ps]) => {
    const [launch, latch] = k.split('\u0000')
    const cutBy = clocksCut(sdc, launch, latch)
    const related = rootClock(launch, clocks) === rootClock(latch, clocks)
    const byBus = new Map<string, Set<string>>()
    for (const p of ps) byBus.set(bus(p.to), (byBus.get(bus(p.to)) ?? new Set()).add(bit(p.to) ?? '0'))
    const transfer = report.transfers.find(t => t.from === launch && t.to === latch)
    // Vivado reports worst slack and failing endpoints per crossing even when no path is listed for it.
    const tell = { setup: clocksCut(sdc, launch, latch, 'setup') === null, hold: s.includeHold && clocksCut(sdc, launch, latch, 'hold') === null }
    const told = transfer ? { failing: (tell.setup ? transfer.failing ?? 0 : 0) + (tell.hold ? transfer.holdFailing ?? 0 : 0), wns: Math.min(tell.setup ? transfer.wns ?? Infinity : Infinity, tell.hold ? transfer.holdWns ?? Infinity : Infinity) } : { failing: 0, wns: Infinity }
    const wns = Math.min(ps.length ? Math.min(...ps.map(p => p.slack)) : Infinity, told.wns)
    return {
      launch, latch, cutBy, status: cutBy !== null || transfer?.falsePath ? 'cut' : related ? 'related' : 'unconstrained',
      paths: Math.max(ps.length, transfer?.paths ?? 0), failing: Math.max(ps.filter(p => p.slack < 0 && p.cutBy === null).length, told.failing),
      wns: Number.isFinite(wns) ? wns : 0,
      toBuses: [...byBus.entries()].map(([b, bits]) => ({ bus: b, width: bits.size, synchronized: isSynchronized(b, bits) })),
    } satisfies Crossing
  }).sort((a, b) => (a.status === 'unconstrained' ? 0 : 1) - (b.status === 'unconstrained' ? 0 : 1) || a.wns - b.wns)

  const setupLive = live.filter(p => isMax(p.analysis))
  const holdLive = live.filter(p => !isMax(p.analysis))
  // Design totals from the tool are exact until the SDC edited here cuts or retimes something.
  const fresh = all.length === live.length && !retimed.length
  const totFor = (max: boolean, t: 'setup' | 'hold') => !retimed.length && !all.some(p => p.cutBy !== null && isMax(p.analysis) === max) ? report.totals?.[t] : undefined
  const tot = { setup: totFor(true, 'setup'), hold: totFor(false, 'hold') }
  const finite = (n: number, or: number | null) => Number.isFinite(n) ? round(n) : or
  const names = report.unconstrained.filter((u): u is { kind: 'input' | 'output'; name: string } => u.kind !== 'clock' && !ioConstrained(sdc, u.name))
  const counts = report.counts
  return {
    paths: all, clocks: clockStats, pairs, buses, causes, crossings,
    lint: sdc ? lintSdc(sdc, report.clocks, report.format) : [],
    unconstrainedPorts: names,
    wns: finite(Math.min(...setupLive.map(p => p.slack), ...clockStats.map(c => c.wns), tot.setup?.wns ?? Infinity), null),
    tns: round(Math.min(sumNeg(setupLive), clockStats.reduce((a, c) => a + c.tns, 0), tot.setup?.tns ?? 0)),
    holdWns: s.includeHold ? finite(Math.min(...holdLive.map(p => p.slack), ...clockStats.map(c => c.holdWns ?? Infinity), tot.hold?.wns ?? Infinity), null) : null,
    holdTns: s.includeHold ? round(Math.min(sumNeg(holdLive), clockStats.reduce((a, c) => a + c.holdTns, 0), tot.hold?.tns ?? 0)) : 0,
    failing: failing.length, total: live.length,
    clockDefs: clocks, meta: report.meta ?? {},
    endpoints: fresh && tot.setup ? { failing: tot.setup.failing, total: tot.setup.total, holdFailing: s.includeHold ? tot.hold?.failing ?? 0 : 0 } : null,
    defaultClocks: [...defaults], retimed,
    summaryOnly: !report.paths.length && report.summary.length > 0,
    unconstrainedClocks: report.unconstrained.filter(u => u.kind === 'clock' && !sdc?.clocks.some(c => c.name === u.name || c.source === u.name)).map(u => u.name),
    format: report.format, hasSdc: !!sdc,
    portCounts: !report.unconstrained.some(u => u.kind !== 'clock') && !sdc?.io.length && ((counts?.inputPorts ?? 0) || (counts?.outputPorts ?? 0)) ? { inputs: counts?.inputPorts ?? 0, outputs: counts?.outputPorts ?? 0 } : null,
  }
}

/** What can be said when no failing path is classified. Only `met` when setup and hold are both known and met. */
export function verdict(r: Result): { met: boolean; text: string } {
  const bad = [r.wns !== null && r.wns < 0 && `setup (WNS ${r.wns.toFixed(3)} ns)`, r.holdWns !== null && r.holdWns < 0 && `hold (WNS ${r.holdWns.toFixed(3)} ns)`].filter(Boolean)
  if (bad.length || (r.endpoints && r.endpoints.failing + r.endpoints.holdFailing > 0)) return { met: false, text: `The report fails ${bad.join(' and ') || 'timing'}, but does not list the failing paths, so they cannot be classified.` }
  if (r.wns === null) return { met: false, text: 'No timed setup paths or setup summary here, so setup timing is unknown.' }
  if (r.holdWns === null) return { met: false, text: 'No failing setup paths. Hold is not part of this analysis, so it is unknown.' }
  return { met: true, text: 'No failing setup or hold paths. Timing is met.' }
}

/**
 * What-if: retime one clock to a new frequency. Same-clock setup paths shift by the period change times their number of cycles;
 * cross-clock paths are left alone because their relationship depends on both edges.
 */
export function whatIfFrequency(r: Result, clock: string, mhz: number) {
  const st = r.clocks.find(c => c.clock === clock)
  if (!st?.period || !(mhz > 0)) return null
  const base = st.period, delta = 1000 / mhz - base
  const same = r.paths.filter(p => p.cutBy === null && p.latch === clock && p.launch === clock && (p.analysis === 'setup' || p.analysis === 'recovery'))
  const shifted = same.map(p => ({ ...p, slack: round(p.slack + cycles(p, base) * delta) }))
  return {
    period: round(1000 / mhz), delta: round(delta), paths: same.length,
    failing: shifted.filter(p => p.slack < 0).length,
    wns: shifted.length ? Math.min(...shifted.map(p => p.slack)) : null,
    tns: round(sumNeg(shifted)),
    excluded: r.paths.filter(p => p.cutBy === null && p.cross && (p.launch === clock || p.latch === clock)).length,
  }
}
