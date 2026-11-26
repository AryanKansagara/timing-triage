import { useEffect } from 'react'
import { SlackHistogram } from './charts.tsx'
import { CAUSES, verdict } from './engine/analyze.ts'
import { causeLabel } from './engine/fixes.ts'
import { samples } from './engine/sample.ts'
import { useProject, useRun } from './projectData.ts'
import { fmtN, fmtNs, Link } from './ui.tsx'

export default function Report({ id }: { id: string }) {
  const { loading, project, ds } = useProject(id)
  const run = useRun(ds, project)
  useEffect(() => { if (project) document.title = `Timing closure report: ${project.name}` }, [project?.name])
  if (loading) return <div className="boot"><span className="spinner" /> Building report</div>
  if (!project || !run) return <section className="report"><p>Nothing to report yet. <Link href={project ? `/app/p/${id}/data` : '/app'}>Import a report</Link>.</p></section>
  const { r, fixes } = run
  const real = samples().find(s => s.id === project.sampleId)?.real
  const snaps = [...project.snapshots].sort((a, b) => a.at - b.at)
  return (
    <article className="report">
      <div className="report-actions">
        <Link href={`/app/p/${id}`} className="btn ghost">Back</Link>
        <button type="button" className="btn primary" onClick={() => print()}>Print or save as PDF</button>
      </div>
      <header>
        <div className="eyebrow">Timing closure report{real ? ` · public report from ${real.credit} (${real.licence})` : project.sampleId ? ' · synthetic sample' : ''}</div>
        <h1>{project.name}</h1>
        <p className="muted">{new Date().toLocaleDateString('en-US', { dateStyle: 'long' })} · {r.meta.tool ?? (run.report.format === 'vivado' ? 'Vivado' : 'Quartus Timing Analyzer')} report{r.meta.design ? ` · ${r.meta.design}` : ''}{r.meta.device ? ` · ${r.meta.device}` : ''} · constraints: {project.sdc.trim() ? project.sdcName : 'none'}</p>
        {r.defaultClocks.length > 0 && <p><b>{r.defaultClocks.join(', ')} has no clock constraint.</b> The tool timed it at a default 1 ns (1000 MHz); slack in this report is against that placeholder.</p>}
        {r.retimed.length > 0 && <p>{r.retimed.map(x => `${x.clock} re-timed from ${fmtNs(x.from)} ns to ${fmtNs(x.to)} ns from the SDC`).join('; ')}. Same-clock setup slack is estimated until the design is recompiled.</p>}
      </header>
      <div className="kpis">
        <div className="kpi"><small>Setup WNS</small><b className="mono">{r.wns === null ? '—' : `${fmtNs(r.wns)} ns`}</b></div>
        <div className="kpi"><small>Setup TNS</small><b className="mono">{r.wns === null ? '—' : `${fmtNs(r.tns)} ns`}</b></div>
        {r.endpoints ? <div className="kpi"><small>Failing endpoints</small><b>{fmtN(r.endpoints.failing + r.endpoints.holdFailing)}</b><p>of {fmtN(r.endpoints.total)} · {r.failing} listed</p></div> : <div className="kpi"><small>Failing paths</small><b>{r.paths.length ? r.failing : '—'}</b><p>{!r.paths.length ? r.summaryOnly ? 'summaries only' : 'no paths listed' : `of ${fmtN(r.total)} listed`}</p></div>}
        <div className="kpi"><small>Hold WNS</small><b className="mono">{r.holdWns === null ? '—' : `${fmtNs(r.holdWns)} ns`}</b></div>
      </div>
      <h2>Slack distribution</h2>
      <SlackHistogram paths={r.paths} height={200} width={900} />
      <h2>Clocks</h2>
      <table>
        <thead><tr><th>Clock</th><th className="num">Target MHz</th><th className="num">WNS</th><th className="num">TNS</th><th className="num">Failing</th><th className="num">Fmax</th></tr></thead>
        <tbody>{r.clocks.map(c => <tr key={c.clock}><td className="mono small">{c.clock}</td><td className="num">{c.period ? fmtN(1000 / c.period, 2) : '—'}</td><td className="num mono">{Number.isFinite(c.wns) ? fmtNs(c.wns) : '—'}</td><td className="num mono">{fmtNs(c.tns)}</td><td className="num">{c.failing}</td><td className="num">{c.fmax ? fmtN(c.fmax, 1) : '—'}</td></tr>)}</tbody>
      </table>
      <h2>Root causes</h2>
      {!r.causes.length ? <p>{verdict(r).text}</p> : <table>
        <thead><tr><th>Cause</th><th className="num">Paths</th><th className="num">Worst slack</th><th className="num">TNS</th></tr></thead>
        <tbody>{r.causes.map(c => <tr key={c.cause}><td>{CAUSES[c.cause].label}</td><td className="num">{c.paths.length}</td><td className="num mono">{fmtNs(c.wns)}</td><td className="num mono">{fmtNs(c.tns)}</td></tr>)}</tbody>
      </table>}
      <h2>Clock-domain crossings</h2>
      {!r.crossings.length ? <p>No crossings in this report.</p> : <ul>{r.crossings.map(x => <li key={x.launch + x.latch}><span className="mono small">{x.launch} → {x.latch}</span>: {x.status}, {x.paths} paths, {x.failing} failing</li>)}</ul>}
      <h2>Fix list</h2>
      <ol className="report-fixes">
        {fixes.map(f => (
          <li key={f.id}>
            <b>{f.title}</b> <span className="muted small">({causeLabel(f.cause)}{f.tns < 0 ? `, ${fmtNs(f.tns, 2)} ns TNS` : ''})</span>
            <p>{f.why}</p>
            {f.steps.length > 0 && <ul>{f.steps.map(s => <li key={s}>{s}</li>)}</ul>}
            {f.sdc && <pre className="mono small">{f.sdc}</pre>}
            {f.qsf && <pre className="mono small">{f.qsf}</pre>}
          </li>
        ))}
      </ol>
      {r.lint.length > 0 && <>
        <h2>Constraint lint</h2>
        <ul>{r.lint.map((l, i) => <li key={i}><span className="mono small">line {l.line}</span> [{l.level}] {l.message}</li>)}</ul>
      </>}
      {snaps.length > 1 && <>
        <h2>Run history</h2>
        <table><thead><tr><th>Run</th><th>Date</th><th className="num">WNS</th><th className="num">TNS</th><th className="num">Failing</th></tr></thead>
          <tbody>{snaps.map(s => <tr key={s.id}><td>{s.label}</td><td>{new Date(s.at).toLocaleDateString()}</td><td className="num mono">{fmtNs(s.wns)}</td><td className="num mono">{fmtNs(s.wns === null ? null : s.tns)}</td><td className="num">{s.total ? s.failing : '—'}</td></tr>)}</tbody></table>
      </>}
      <p className="muted small report-foot">Generated by Timing Triage from the report text. Root causes are heuristics; confirm each in Timing Analyzer before changing RTL.</p>
    </article>
  )
}
