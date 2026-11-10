import { useMemo, useState } from 'react'
import { CauseDot, SlackHistogram } from './charts.tsx'
import { CAUSES } from './engine/analyze.ts'
import { applyToSdc } from './engine/fixes.ts'
import { samples } from './engine/sample.ts'
import type { Cause } from './engine/types.ts'
import { runAnalysis } from './projectData.ts'
import { DEFAULT_SETTINGS } from './engine/types.ts'
import { fmtNs, Link } from './ui.tsx'

function HeroDemo() {
  const s = samples()[0]
  const files = useMemo(() => [{ name: s.reportName, text: s.report }], [s])
  const base = useMemo(() => runAnalysis(files, { sdc: s.sdc, settings: DEFAULT_SETTINGS }), [files, s])
  const [applied, setApplied] = useState<string[]>([])
  const [hl, setHl] = useState<Cause | null>('cdc')
  const sdc = applied.reduce((acc, id) => { const f = base.fixes.find(x => x.id === id); return f ? applyToSdc(acc, f, '2026-11-10') : acc }, s.sdc)
  const run = useMemo(() => applied.length ? runAnalysis(files, { sdc, settings: DEFAULT_SETTINGS }) : base, [sdc])
  const { r } = run
  const cdcFix = base.fixes.find(f => f.cause === 'cdc')!
  const lintFix = base.fixes.find(f => f.id.startsWith('sdc:derive_clock_uncertainty'))
  const sel = hl ? r.paths.filter(p => p.cause === hl && p.cutBy === null && p.slack < 0).sort((a, b) => a.slack - b.slack).slice(0, 3) : []
  const done = applied.includes(cdcFix.id)
  return (
    <div className="demo" aria-label="Live demo on a synthetic Quartus report">
      <div className="demo-bar"><i /><i /><i /><strong>vga_uart_top.sta.rpt</strong><span className="badge synthetic">Synthetic</span></div>
      <div className="demo-body">
        <div className="demo-kpis">
          <div><small>Setup WNS</small><b className={`mono ${r.wns < 0 ? 'bad-text' : 'good-text'}`}>{fmtNs(r.wns)}</b></div>
          <div><small>TNS</small><b className="mono">{fmtNs(r.tns, 1)}</b></div>
          <div><small>Failing</small><b className="mono">{r.failing}<span className="was">{done ? base.r.failing : ''}</span></b></div>
        </div>
        <SlackHistogram paths={r.paths} highlight={hl} onPick={setHl} height={190} cap={4} />
        <div className="cause-chips compact" role="group" aria-label="Root-cause groups">
          {r.causes.map(c => (
            <button key={c.cause} type="button" className={`cause-chip${hl === c.cause ? ' on' : ''}`} aria-pressed={hl === c.cause} onClick={() => setHl(hl === c.cause ? null : c.cause)}>
              <CauseDot cause={c.cause} /><span>{CAUSES[c.cause].short}</span><b className="mono">{c.paths.length}</b>
            </button>
          ))}
        </div>
        <div className="demo-detail">
          {hl && sel.length > 0 ? (
            <ul className="demo-paths">{sel.map(p => <li key={p.id}><b className="mono bad-text">{fmtNs(p.slack)}</b><span className="mono clip">{p.from.split('|').slice(-1)[0]} → {p.to.split('|').slice(-1)[0]}</span></li>)}</ul>
          ) : <p className="muted small">{hl ? `No ${CAUSES[hl].short.toLowerCase()} failures left.` : 'Click a bar segment or a group to highlight its paths.'}</p>}
          <div className="demo-fix">
            <pre className="mono"><span className="c"># suggested fix</span>{'\n'}{cdcFix.sdc}</pre>
            <div className="row gap-sm wrap">
              {!done
                ? <button type="button" className="btn primary sm" onClick={() => { setApplied(a => [...a, cdcFix.id]); setHl('cdc') }}>Apply SDC fix &amp; re-run</button>
                : <button type="button" className="btn ghost sm" onClick={() => setApplied([])}>Reset</button>}
              {lintFix && !applied.includes(lintFix.id) && done && <button type="button" className="btn outline sm" onClick={() => setApplied(a => [...a, lintFix.id])}>+ derive_clock_uncertainty</button>}
              {done && <span className="small good-text">{base.r.failing - r.failing} CDC paths now cut</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const QUOTES = [
  { q: 'Setup violations between a 25 MHz PLL clock and a 10 MHz clock, and paths it says are unconstrained.', s: 'r/FPGA, “How to find and fix timing issues inside Quartus?” (paraphrased)', a: 'The first reply: have you created your .sdc file?' },
  { q: 'Timing requirements not met, for paths that come straight from registers.', s: 'r/FPGA (paraphrased)', a: 'A report of hundreds of paths, and no hint which ones share a cause.' },
  { q: 'Why is Quartus so clunky?', s: 'r/FPGA (paraphrased)', a: 'The answers are all in Timing Analyzer, across a dozen panels.' },
]

const FEATURES: [string, string][] = [
  ['Reads what Quartus writes', 'report_timing panels, .sta.rpt, report_clocks, report_ucp and clock transfers, with Vivado report_timing_summary as a second parser. Every unparsed row is listed with its line number.'],
  ['Groups paths by root cause', 'Unconstrained clock-domain crossings, logic depth, high fanout, skew-dominated, I/O constraints and plain routing. Then by clock pair and by register bus.'],
  ['Lints your .sdc', 'Period-vs-MHz mix-ups, missing derive_pll_clocks or derive_clock_uncertainty, clocks without groups, false paths that cut everything, multicycles without -hold.'],
  ['Fixes you can paste', 'set_clock_groups for real crossings, I/O delay templates, MAX_FANOUT and FAST_INPUT_REGISTER assignments, pipelining guidance per bus. Apply an SDC fix and the analysis re-runs.'],
  ['CDC check', 'Every clock pair is traced back to its source, so PLL siblings stay related and separate oscillators get flagged, with synchronizer advice per destination bus.'],
  ['History per design', 'Each import is a dated run. See WNS and failing paths trend down, and which endpoints were fixed or newly broke between two compiles.'],
]

export function Landing() {
  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div>
            <div className="eyebrow">For FPGA engineers fighting timing closure</div>
            <h1>Turn a wall of negative slack into <span className="accent-text">six root causes</span> and the fixes.</h1>
            <p className="lede">Paste or drop Quartus Timing Analyzer reports and your .sdc. Timing Triage groups failing paths by why they fail, finds the clock crossings nobody constrained, lints the constraints, and writes the SDC lines.</p>
            <div className="hero-ctas">
              <Link href="/app?sample=vga-uart" className="btn primary lg">Open the sample design</Link>
              <Link href="/app" className="btn outline lg">Import your report</Link>
            </div>
            <p className="hero-note">Runs in your browser. No account needed. Sample data is synthetic.</p>
          </div>
          <HeroDemo />
        </div>
      </section>

      <section className="section">
        <div className="section-head"><div className="eyebrow">The pain</div><h2>Everyone hits the same wall</h2><p>Timing Analyzer has every answer, but it shows paths one at a time. The question people actually ask is &ldquo;which three things do I fix?&rdquo;</p></div>
        <div className="quotes">{QUOTES.map(q => <figure key={q.q} className="quote"><blockquote>&ldquo;{q.q}&rdquo;</blockquote><p>{q.a}</p><figcaption className="src">{q.s}</figcaption></figure>)}</div>
      </section>

      <section className="section">
        <div className="section-head"><div className="eyebrow">What it does</div><h2>From report to closure plan</h2></div>
        <div className="features">{FEATURES.map(([t, d], i) => <article key={t} className="feature"><div className="ico mono">{String(i + 1).padStart(2, '0')}</div><h3>{t}</h3><p>{d}</p></article>)}</div>
      </section>

      <section className="section">
        <div className="section-head"><div className="eyebrow">Three steps</div><h2>Export, triage, fix</h2></div>
        <ol className="steps-3">
          <li><b>Export</b><p>Run one Tcl script with <code>quartus_sta -t</code>, or use the .sta.rpt from your last compile. <Link href="/docs">Exact commands</Link>.</p></li>
          <li><b>Triage</b><p>The slack histogram, per-clock WNS/TNS and Fmax, cause groups, CDC pairs and SDC lint, with every finding pointing at a line.</p></li>
          <li><b>Fix and track</b><p>Paste the SDC and QSF lines, print the closure report for your lab partner or lead, and import the next compile to see what moved.</p></li>
        </ol>
      </section>

      <section className="cta-band">
        <div className="cta-inner">
          <div><h2>Open the sample in one click</h2><p>A synthetic VGA text console with a UART on a 10 MHz clock, timed on a Cyclone V.</p></div>
          <Link href="/app?sample=vga-uart" className="btn primary lg">Open the sample</Link>
        </div>
      </section>
    </>
  )
}
