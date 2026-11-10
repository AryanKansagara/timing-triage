import { useMemo, useState } from 'react'
import { CAUSES, type Classified } from './engine/analyze.ts'
import type { Snapshot } from './engine/snapshot.ts'
import type { Cause } from './engine/types.ts'
import { fmtNs } from './ui.tsx'

export const CAUSE_ORDER: Cause[] = ['cdc', 'logic', 'fanout', 'io', 'skew', 'route']
export const causeColor = (c: Cause) => `var(--c-${c})`

export function CauseDot({ cause }: { cause: Cause }) {
  return <i className="cause-dot" style={{ background: causeColor(cause) }} aria-hidden="true" />
}

interface Bin { lo: number; hi: number; pass: number; cut: number; by: Partial<Record<Cause, number>> }

export function bins(paths: Classified[], width = 0.25, cap = 5): Bin[] {
  const setup = paths.filter(p => p.analysis === 'setup' || p.analysis === 'recovery')
  if (!setup.length) return []
  const min = Math.floor(Math.min(0, ...setup.map(p => p.slack)) / width) * width
  const n = Math.round((cap - min) / width) + 1
  const out: Bin[] = Array.from({ length: n }, (_, i) => ({ lo: min + i * width, hi: min + (i + 1) * width, pass: 0, cut: 0, by: {} }))
  for (const p of setup) {
    const i = Math.min(n - 1, Math.floor((p.slack - min) / width + 1e-9))
    const b = out[i]
    if (p.cutBy !== null) b.cut++
    else if (p.cause) b.by[p.cause] = (b.by[p.cause] ?? 0) + 1
    else b.pass++
  }
  return out
}

/** Setup slack histogram. Failing paths are stacked by root cause; cut paths are drawn as ghosts. */
export function SlackHistogram({ paths, highlight, onPick, height = 220, cap = 5, width = 720 }: { paths: Classified[]; highlight?: Cause | null; onPick?(c: Cause | null): void; height?: number; cap?: number; width?: number }) {
  const data = useMemo(() => bins(paths, 0.25, cap), [paths, cap])
  const [hover, setHover] = useState<number | null>(null)
  if (!data.length) return <p className="muted small">No setup paths in this report.</p>
  const W = width, H = height, padL = 34, padB = 26, padT = 10
  const tot = (b: Bin) => b.pass + b.cut + Object.values(b.by).reduce((a, x) => a + (x ?? 0), 0)
  // The last bin collects everything above the cap; it is clipped so it does not flatten the rest.
  const max = Math.max(1, ...data.slice(0, -1).map(tot))
  const over = tot(data[data.length - 1])
  const bw = (W - padL - 6) / data.length
  const y = (v: number) => (H - padB - padT) * v / max
  const zeroI = data.findIndex(b => b.lo >= 0)
  const zx = padL + zeroI * bw
  const ticks = data.filter((b, i) => Math.abs(b.lo - Math.round(b.lo)) < 1e-9 && i < data.length - 1)
  const h = hover !== null ? data[hover] : null
  return (
    <div className="hist-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="hist" role="img" aria-label={`Setup slack histogram. ${paths.filter(p => p.slack < 0 && p.cutBy === null).length} failing paths left of zero.`} onMouseLeave={() => setHover(null)}>
        <rect x={padL} y={padT} width={Math.max(0, zx - padL)} height={H - padB - padT} className="fail-zone" />
        {[0.5, 1].map(f => <line key={f} x1={padL} x2={W - 6} y1={H - padB - (H - padB - padT) * f} y2={H - padB - (H - padB - padT) * f} className="grid" />)}
        <text x={padL - 6} y={padT + 8} className="axis" textAnchor="end">{max}</text>
        {data.map((b, i) => {
          let acc = 0
          const x = padL + i * bw + 1
          const seg = (key: string, v: number, cls: string, cause?: Cause) => {
            if (!v) return null
            const hh = Math.min(y(v), H - padB - padT - acc)
            const yy = H - padB - acc - hh
            acc += hh
            const dim = highlight && cause !== highlight
            return <rect key={key} x={x} y={yy} width={Math.max(1, bw - 2)} height={hh} rx={1.5} className={`${cls}${dim ? ' dim' : ''}${cause && highlight === cause ? ' hot' : ''}`} style={cause ? { fill: causeColor(cause) } : undefined} onClick={cause && onPick ? () => onPick(highlight === cause ? null : cause) : undefined} />
          }
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={x - 1} y={padT} width={bw} height={H - padB - padT} className="hit" />
              {CAUSE_ORDER.map(c => seg(c, b.by[c] ?? 0, 'bar', c))}
              {seg('pass', b.pass, `bar pass${highlight ? ' dim' : ''}`)}
              {seg('cut', b.cut, 'bar cut')}
            </g>
          )
        })}
        <line x1={zx} x2={zx} y1={padT - 4} y2={H - padB + 4} className="zero" />
        <text x={zx + 4} y={padT + 4} className="axis zero-l">0 ns</text>
        {ticks.map(b => <text key={b.lo} x={padL + data.indexOf(b) * bw} y={H - 8} className="axis" textAnchor="middle">{b.lo}</text>)}
        <text x={W - 6} y={H - 8} className="axis" textAnchor="end">{cap}+ ns</text>
        {over > max && <text x={W - 6 - bw / 2} y={padT + 10} className="axis over" textAnchor="middle">{over}</text>}
      </svg>
      <div className="hist-tip" aria-live="polite">
        {h ? <>
          <b>{fmtNs(h.lo, 2)} to {h.hi >= cap ? `${cap}+` : fmtNs(h.hi, 2)} ns</b>
          {CAUSE_ORDER.filter(c => h.by[c]).map(c => <span key={c}><CauseDot cause={c} />{h.by[c]} {CAUSES[c].short}</span>)}
          {h.pass > 0 && <span><i className="cause-dot pass" />{h.pass} passing</span>}
          {h.cut > 0 && <span><i className="cause-dot cut" />{h.cut} cut by SDC</span>}
        </> : <span className="muted">Hover a bar for counts. Click a coloured segment to highlight its root cause.</span>}
      </div>
    </div>
  )
}

/** WNS and failing-endpoint trend across saved runs. */
export function Trend({ snaps }: { snaps: Snapshot[] }) {
  const s = [...snaps].sort((a, b) => a.at - b.at)
  if (s.length < 2) return <p className="muted small">Save at least two runs to see a trend.</p>
  const W = 720, H = 200, pl = 44, pr = 44, pt = 14, pb = 34
  const wmin = Math.min(0, ...s.map(x => x.wns)), wmax = Math.max(0.2, ...s.map(x => x.wns))
  const fmax = Math.max(1, ...s.map(x => x.failing))
  const x = (i: number) => pl + (W - pl - pr) * (s.length === 1 ? 0.5 : i / (s.length - 1))
  const yw = (v: number) => pt + (H - pt - pb) * (wmax - v) / (wmax - wmin || 1)
  const yf = (v: number) => H - pb - (H - pt - pb) * v / fmax
  const bw = Math.min(36, (W - pl - pr) / s.length / 2)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend" role="img" aria-label={`Worst negative slack went from ${s[0].wns} to ${s.at(-1)!.wns} ns over ${s.length} runs`}>
      {s.map((p, i) => <rect key={p.id} x={x(i) - bw / 2} y={yf(p.failing)} width={bw} height={H - pb - yf(p.failing)} className="t-bar" rx={3}><title>{p.failing} failing paths</title></rect>)}
      <line x1={pl} x2={W - pr} y1={yw(0)} y2={yw(0)} className="zero" />
      <text x={pl - 6} y={yw(0) + 4} textAnchor="end" className="axis">0</text>
      <text x={pl - 6} y={yw(wmin) + 4} textAnchor="end" className="axis">{wmin.toFixed(1)}</text>
      <text x={W - pr + 6} y={yf(fmax) + 4} className="axis">{fmax}</text>
      <polyline points={s.map((p, i) => `${x(i)},${yw(p.wns)}`).join(' ')} className="t-line" />
      {s.map((p, i) => <g key={p.id}><circle cx={x(i)} cy={yw(p.wns)} r={4.5} className="t-dot"><title>{p.label}: WNS {p.wns} ns</title></circle><text x={x(i)} y={H - 12} textAnchor="middle" className="axis">{new Date(p.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</text></g>)}
    </svg>
  )
}
