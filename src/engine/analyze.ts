import { clocksCut, ioConstrained, lintSdc, parseSdc, pathCut, type LintFinding, type SdcModel } from './sdc.ts'
import type { Analysis, Cause, Clock, ParsedReport, Settings, TimingPath } from './types.ts'
import { DEFAULT_SETTINGS } from './types.ts'

export const CAUSES: Record<Cause, { label: string; short: string }> = {
  cdc: { label: 'Clock-domain crossing without a constraint', short: 'Unconstrained CDC' },
  io: { label: 'I/O constraint missing or too tight', short: 'I/O constraint' },
  logic: { label: 'Too many levels of logic', short: 'Logic depth' },
  fanout: { label: 'High-fanout net', short: 'High fanout' },
  skew: { label: 'Clock skew or uncertainty dominated', short: 'Clock skew' },
  route: { label: 'Placement and routing delay', short: 'Routing' },
}

export interface Classified extends TimingPath {
  cause: Cause | null
  /** SDC line that cuts this path (clock groups or false path), if any */
  cutBy: number | null
  cross: boolean
}

export interface ClockStat { clock: string; period: number | null; wns: number; tns: number; failing: number; total: number; holdWns: number | null; holdTns: number; fmax: number | null }
export interface Group { key: string; label: string; launch: string; latch: string; paths: string[]; failing: number; wns: number; tns: number }
export interface Crossing { launch: string; latch: string; status: 'cut' | 'related' | 'unconstrained'; cutBy: number | null; paths: number; failing: number; wns: number; toBuses: { bus: string; width: number; synchronized: boolean }[] }
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
  wns: number
  tns: number
  holdWns: number | null
  holdTns: number
  failing: number
  total: number
}

/** `u_rx|data[3]` -> `u_rx|data[*]` so register buses group together. */
export const bus = (n: string) => n.replace(/\/[A-Z]{1,3}$/, '').replace(/\[\d+\](?=[^[]*$)/, '[*]')
const bit = (n: string) => n.match(/\[(\d+)\](?=[^[]*$)/)?.[1]
const isSyncName = (n: string) => /sync|meta|cdc|_ff[12]\b|dff[12]|s(ync)?_?reg[12]|synchronizer/i.test(n)

export function isPort(name: string, known: Set<string>) {
  if (known.has(name) || known.has(bus(name))) return true
  return !/[|/:]/.test(name) && !/~/.test(name)
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

export function classify(p: TimingPath, ctx: { clocks: Clock[]; sdc: SdcModel | null; ports: Set<string>; s: Settings }): Classified {
  const cross = !!p.launch && !!p.latch && p.launch !== p.latch
  const cutBy = cross ? clocksCut(ctx.sdc, p.launch, p.latch) ?? pathCut(ctx.sdc, p.from, p.to) : pathCut(ctx.sdc, p.from, p.to)
  const base: Classified = { ...p, cause: null, cutBy, cross }
  if (p.slack >= 0 || cutBy !== null) return base
  const s = ctx.s
  let cause: Cause
  const unrelated = cross && rootClock(p.launch, ctx.clocks) !== rootClock(p.latch, ctx.clocks)
  if (isPort(p.from, ctx.ports) || isPort(p.to, ctx.ports) || !p.launch || !p.latch) cause = 'io'
  else if (unrelated) cause = 'cdc'
  else if ((p.levels ?? 0) > s.maxLevels) cause = 'logic'
  else if ((p.fanout ?? 0) >= s.maxFanout) cause = 'fanout'
  else if (Math.abs(p.skew ?? 0) + (p.uncertainty ?? 0) >= Math.abs(p.slack) * 0.5 && Math.abs(p.skew ?? 0) > 0.05) cause = 'skew'
  else cause = 'route'
  return { ...base, cause }
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

export interface Inputs { report: ParsedReport; sdcText?: string; settings?: Partial<Settings> }

export function analyze({ report, sdcText, settings }: Inputs): Result {
  const s = { ...DEFAULT_SETTINGS, ...settings }
  const sdc = sdcText?.trim() ? parseSdc(sdcText) : null
  const clocks = mergeClocks(report.clocks, sdc)
  const ports = new Set(report.unconstrained.filter(u => u.kind !== 'clock').map(u => u.name))
  for (const d of sdc?.io ?? []) for (const p of d.ports.patterns) ports.add(p)
  const ctx = { clocks, sdc, ports, s }
  const all = report.paths.filter(p => s.includeHold || p.analysis === 'setup' || p.analysis === 'recovery').map(p => classify(p, ctx))
  const live = all.filter(p => p.cutBy === null)
  const failing = live.filter(p => p.slack < 0)
  const isMax = (a: Analysis) => a === 'setup' || a === 'recovery'

  const period = (c: string) => clocks.find(x => x.name === c)?.period ?? null
  const clockNames = [...new Set([...live.map(p => p.latch).filter(Boolean), ...clocks.filter(c => c.kind !== 'virtual').map(c => c.name)])]
  const clockStats: ClockStat[] = clockNames.map(c => {
    const mine = live.filter(p => p.latch === c)
    const setup = mine.filter(p => isMax(p.analysis))
    const hold = mine.filter(p => !isMax(p.analysis))
    const fromSummary = report.summary.find(x => x.clock === c && x.analysis === 'setup')
    const wns = setup.length ? Math.min(...setup.map(p => p.slack)) : fromSummary?.slack ?? Infinity
    const same = setup.filter(p => p.launch === c)
    const per = period(c)
    return {
      clock: c, period: per, wns: round(wns), tns: round(setup.length ? sumNeg(setup) : fromSummary?.tns ?? 0),
      failing: mine.filter(p => p.slack < 0).length, total: mine.length,
      holdWns: hold.length ? round(Math.min(...hold.map(p => p.slack))) : null, holdTns: round(sumNeg(hold)),
      fmax: per && same.length ? fmax(per, Math.min(...same.map(p => p.slack))) : null,
    }
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
    return {
      launch, latch, cutBy, status: cutBy !== null || transfer?.falsePath ? 'cut' : related ? 'related' : 'unconstrained',
      paths: Math.max(ps.length, transfer?.paths ?? 0), failing: ps.filter(p => p.slack < 0 && p.cutBy === null).length,
      wns: ps.length ? Math.min(...ps.map(p => p.slack)) : 0,
      toBuses: [...byBus.entries()].map(([b, bits]) => ({ bus: b, width: bits.size, synchronized: isSyncName(b) })),
    } satisfies Crossing
  }).sort((a, b) => (a.status === 'unconstrained' ? 0 : 1) - (b.status === 'unconstrained' ? 0 : 1) || a.wns - b.wns)

  const setupLive = live.filter(p => isMax(p.analysis))
  const holdLive = live.filter(p => !isMax(p.analysis))
  return {
    paths: all, clocks: clockStats, pairs, buses, causes, crossings,
    lint: sdc ? lintSdc(sdc, report.clocks, report.format) : [],
    unconstrainedPorts: report.unconstrained.filter((u): u is { kind: 'input' | 'output'; name: string } => u.kind !== 'clock' && !ioConstrained(sdc, u.name)),
    wns: round(setupLive.length ? Math.min(...setupLive.map(p => p.slack)) : Math.min(0, ...report.summary.filter(x => x.analysis === 'setup').map(x => x.slack))),
    tns: round(setupLive.length ? sumNeg(setupLive) : report.summary.filter(x => x.analysis === 'setup').reduce((a, x) => a + x.tns, 0)),
    holdWns: holdLive.length ? round(Math.min(...holdLive.map(p => p.slack))) : null,
    holdTns: round(sumNeg(holdLive)),
    failing: failing.length, total: live.length,
  }
}

/**
 * What-if: retime one clock to a new frequency. Same-clock setup paths shift by the period change;
 * cross-clock paths are left alone because their relationship depends on both edges.
 */
export function whatIfFrequency(r: Result, clock: string, mhz: number) {
  const st = r.clocks.find(c => c.clock === clock)
  if (!st?.period || !(mhz > 0)) return null
  const delta = 1000 / mhz - st.period
  const same = r.paths.filter(p => p.cutBy === null && p.latch === clock && p.launch === clock && (p.analysis === 'setup' || p.analysis === 'recovery'))
  const shifted = same.map(p => ({ ...p, slack: round(p.slack + delta) }))
  return {
    period: round(1000 / mhz), delta: round(delta), paths: same.length,
    failing: shifted.filter(p => p.slack < 0).length,
    wns: shifted.length ? Math.min(...shifted.map(p => p.slack)) : null,
    tns: round(sumNeg(shifted)),
    excluded: r.paths.filter(p => p.cutBy === null && p.cross && (p.launch === clock || p.latch === clock)).length,
  }
}
