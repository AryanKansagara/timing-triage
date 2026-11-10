import type { Result } from './analyze.ts'
import type { Cause } from './types.ts'

export interface Snapshot {
  id: string
  label: string
  at: number
  wns: number
  tns: number
  holdWns: number | null
  failing: number
  total: number
  clocks: { clock: string; wns: number; tns: number; failing: number; fmax: number | null }[]
  causes: Partial<Record<Cause, number>>
  /** Failing endpoints as "to @ latch clock", capped so snapshots stay small */
  endpoints: string[]
}

export function snapshot(r: Result, id: string, label: string, at = Date.now()): Snapshot {
  const fail = r.paths.filter(p => p.slack < 0 && p.cutBy === null)
  return {
    id, label, at, wns: r.wns, tns: r.tns, holdWns: r.holdWns, failing: r.failing, total: r.total,
    clocks: r.clocks.map(c => ({ clock: c.clock, wns: Number.isFinite(c.wns) ? c.wns : 0, tns: c.tns, failing: c.failing, fmax: c.fmax })),
    causes: Object.fromEntries(r.causes.map(c => [c.cause, c.paths.length])),
    endpoints: [...new Set(fail.map(p => `${p.to} @ ${p.latch}`))].slice(0, 400),
  }
}

export interface Compare {
  wns: number; tns: number; failing: number
  clocks: { clock: string; before: number | null; after: number | null }[]
  fixed: string[]; added: string[]; still: number
}

export function compare(a: Snapshot, b: Snapshot): Compare {
  const names = [...new Set([...a.clocks.map(c => c.clock), ...b.clocks.map(c => c.clock)])]
  const ea = new Set(a.endpoints), eb = new Set(b.endpoints)
  return {
    wns: round(b.wns - a.wns), tns: round(b.tns - a.tns), failing: b.failing - a.failing,
    clocks: names.map(n => ({ clock: n, before: a.clocks.find(c => c.clock === n)?.wns ?? null, after: b.clocks.find(c => c.clock === n)?.wns ?? null })),
    fixed: a.endpoints.filter(e => !eb.has(e)), added: b.endpoints.filter(e => !ea.has(e)), still: b.endpoints.filter(e => ea.has(e)).length,
  }
}
const round = (n: number) => Math.round(n * 1000) / 1000
