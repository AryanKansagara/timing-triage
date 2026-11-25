import type { Result } from './analyze.ts'
import type { Cause } from './types.ts'

export interface Snapshot {
  id: string
  label: string
  at: number
  /** Null when the run had no setup result */
  wns: number | null
  tns: number
  holdWns: number | null
  failing: number
  total: number
  clocks: { clock: string; wns: number | null; tns: number; failing: number; fmax: number | null }[]
  causes: Partial<Record<Cause, number>>
  /** Failing endpoints as "to @ latch clock", worst first, capped so snapshots stay small */
  endpoints: string[]
  /** How many failing endpoints the run had. Runs saved before this was recorded do not have it. */
  endpointCount?: number
}

const CAP = 400
/** True when the stored endpoint list may be incomplete. Older runs only tell by a full list. */
export const isCut = (s: Snapshot) => s.endpointCount !== undefined ? s.endpointCount > s.endpoints.length : s.endpoints.length >= CAP && s.failing > CAP

export function snapshot(r: Result, id: string, label: string, at = Date.now()): Snapshot {
  const fail = r.paths.filter(p => p.slack < 0 && p.cutBy === null).sort((a, b) => a.slack - b.slack)
  const endpoints = [...new Set(fail.map(p => `${p.to} @ ${p.latch}`))]
  return {
    id, label, at, wns: r.wns, tns: r.tns, holdWns: r.holdWns, failing: r.failing, total: r.total,
    clocks: r.clocks.map(c => ({ clock: c.clock, wns: Number.isFinite(c.wns) ? c.wns : null, tns: c.tns, failing: c.failing, fmax: c.fmax })),
    causes: Object.fromEntries(r.causes.map(c => [c.cause, c.paths.length])),
    endpoints: endpoints.slice(0, CAP), endpointCount: endpoints.length,
  }
}

export interface Compare {
  /** NaN when either run had no setup result */
  wns: number; tns: number; failing: number
  clocks: { clock: string; before: number | null; after: number | null }[]
  /** An empty list is not "none" when the matching flag is unset: see knowsFixed and knowsAdded */
  fixed: string[]; added: string[]; still: number
  /** False when the later run's list was cut: an endpoint missing from it may still fail */
  knowsFixed: boolean
  /** False when the earlier run's list was cut: an endpoint missing from it may have failed already */
  knowsAdded: boolean
}

export function compare(a: Snapshot, b: Snapshot): Compare {
  const names = [...new Set([...a.clocks.map(c => c.clock), ...b.clocks.map(c => c.clock)])]
  const ea = new Set(a.endpoints), eb = new Set(b.endpoints), knowsFixed = !isCut(b), knowsAdded = !isCut(a)
  return {
    wns: a.wns === null || b.wns === null ? NaN : round(b.wns - a.wns), tns: a.wns === null || b.wns === null ? NaN : round(b.tns - a.tns), failing: b.failing - a.failing,
    clocks: names.map(n => ({ clock: n, before: a.clocks.find(c => c.clock === n)?.wns ?? null, after: b.clocks.find(c => c.clock === n)?.wns ?? null })),
    knowsFixed, knowsAdded,
    fixed: knowsFixed ? a.endpoints.filter(e => !eb.has(e)) : [], added: knowsAdded ? b.endpoints.filter(e => !ea.has(e)) : [], still: b.endpoints.filter(e => ea.has(e)).length,
  }
}
const round = (n: number) => Math.round(n * 1000) / 1000
