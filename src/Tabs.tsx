import { useEffect, useMemo, useRef, useState } from 'react'
import { CAUSE_ORDER, CauseDot, SlackHistogram, Trend } from './charts.tsx'
import { CAUSES, rootClock, whatIfFrequency, type Classified } from './engine/analyze.ts'
import { applyToSdc, causeLabel, fixesSdc, pathsCsv, type Fix } from './engine/fixes.ts'
import { compare } from './engine/snapshot.ts'
import type { Cause } from './engine/types.ts'
import { saveRun, type Tab, type TabProps } from './Project.tsx'
import { runAnalysis } from './projectData.ts'
import { ask, Code, download, Empty, fmtN, fmtNs, isTyping, Link, Modal, signed, toast } from './ui.tsx'

export default function Tabs(props: TabProps & { tab: Tab }) {
  switch (props.tab) {
    case 'paths': return <Paths {...props} />
    case 'cdc': return <Cdc {...props} />
    case 'constraints': return <Constraints {...props} />
    case 'fixes': return <Fixes {...props} />
    case 'history': return <History {...props} />
    default: return <Overview {...props} />
  }
}

const CAUSE_HELP: Record<Cause, string> = {
  noclock: 'The clock has no constraint, so Quartus timed it at a default 1 ns (1000 MHz). These failures say nothing about the real design until the clock has its real period.',
  cdc: 'Launch and latch clocks come from different sources and the SDC does not say so, so Timing Analyzer times the crossing against the closest pair of edges.',
  io: 'A path to or from a device pin. Either the port has no set_input_delay/set_output_delay, or the external budget leaves too little time inside the FPGA.',
  edge: 'Launch and latch registers use opposite edges of the same clock, so the data has half a period to arrive. Usually one register is clocked on negedge or through an inverted clock.',
  logic: 'More levels of logic than fit in one clock period. Pipelining or restructuring the logic is the fix; constraints will not help.',
  fanout: 'A register drives so many loads that the net itself is slow. Duplicate the register or pipeline the distribution.',
  skew: 'Most of the deficit comes from the clock arriving at different times at launch and latch: a gated or derived clock, or a clock not on a global network.',
  route: 'Few logic levels and modest fanout: the delay is wire. The endpoints are far apart or the area is congested.',
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'bad' | 'good' }) {
  return <div className={`kpi${tone ? ' ' + tone : ''}`}><small>{label}</small><b className="mono">{value}</b>{note && <p>{note}</p>}</div>
}

// ---------- Overview ----------

function Overview({ project, run }: TabProps) {
  const { r } = run
  const [hl, setHl] = useState<Cause | null>(null)
  const worstFmax = r.clocks.filter(c => c.fmax !== null && c.period).sort((a, b) => (a.fmax! * a.period!) - (b.fmax! * b.period!))[0]
  const lintErr = r.lint.filter(l => l.level === 'error').length
  // Clocks that time nothing (PLL feedback, unused outputs) only add noise to the table.
  const timed = r.clocks.filter(c => c.total > 0 || Number.isFinite(c.wns) || c.isDefault)
  const untimed = r.clocks.filter(c => !timed.includes(c))
  const sel = hl ? r.paths.filter(p => p.cause === hl && p.cutBy === null && p.slack < 0).sort((a, b) => a.slack - b.slack) : []
  return (
    <>
      {project.dataMissing && <div className="banner warn">The report files for this design live on another device. Constraints, fixes and history synced; re-import the report here to recompute paths.</div>}
      <div className="kpis">
        <Kpi label="Setup WNS" value={`${fmtNs(r.wns)} ns`} tone={r.wns < 0 ? 'bad' : 'good'} note={r.wns < 0 ? 'Worst negative slack' : 'Setup met'} />
        <Kpi label="Setup TNS" value={`${fmtNs(r.tns)} ns`} tone={r.tns < 0 ? 'bad' : 'good'} note="Sum of worst slack per endpoint" />
        {r.endpoints
          ? <Kpi label="Failing endpoints" value={fmtN(r.endpoints.failing + r.endpoints.holdFailing)} note={`of ${fmtN(r.endpoints.total)} in the design · ${r.failing} worst path${r.failing === 1 ? '' : 's'} listed in this export`} tone={r.endpoints.failing + r.endpoints.holdFailing ? 'bad' : 'good'} />
          : r.summaryOnly
            ? <Kpi label="Failing paths" value="—" note="This report has per-clock summaries but no path tables" />
            : <Kpi label="Failing paths" value={`${r.failing}`} note={`of ${fmtN(r.total)} listed · ${r.paths.length - r.total} cut by SDC`} tone={r.failing ? 'bad' : 'good'} />}
        <Kpi label="Hold WNS" value={r.holdWns === null ? '—' : `${fmtNs(r.holdWns)} ns`} tone={r.holdWns !== null && r.holdWns < 0 ? 'bad' : undefined} note={r.holdWns === null ? 'No hold paths in report' : r.holdWns < 0 ? 'Hold violations' : 'Hold met'} />
      </div>
      {r.defaultClocks.length > 0 && (
        <div className="banner warn">
          <span><b>{r.defaultClocks.join(', ')} {r.defaultClocks.length > 1 ? 'have' : 'has'} no clock constraint.</b> Quartus timed {r.defaultClocks.length > 1 ? 'them' : 'it'} at a default 1 ns (1000 MHz), so every slack below is against that placeholder. Give the clock its real period first.</span>
          <Link href={`/app/p/${project.id}/fixes#noclock`} className="btn sm primary">Fix the clock</Link>
        </div>
      )}
      {r.retimed.length > 0 && <div className="banner info">{r.retimed.map(x => `${x.clock} is re-timed from the report's ${fmtNs(x.from)} ns to ${fmtNs(x.to)} ns (${fmtN(1000 / x.to, 2)} MHz) from your SDC.`).join(' ')} Same-clock setup slack is shifted by the difference; recompile for exact numbers.</div>}
      {r.summaryOnly && <div className="banner info"><span>This report has per-clock summaries but no path tables, so paths cannot be listed or classified. Export the failing paths with report_timing and import that file too.</span><Link href="/docs" className="btn sm outline">Export commands</Link></div>}
      {(lintErr > 0 || r.unconstrainedPorts.length > 0) && (
        <div className="banner warn">
          <span>{lintErr > 0 && <>{lintErr} constraint error{lintErr > 1 ? 's' : ''} in {project.sdcName}. </>}{r.unconstrainedPorts.length > 0 && <>{r.unconstrainedPorts.length} I/O port{r.unconstrainedPorts.length > 1 ? 's are' : ' is'} not constrained, so they are not timed at all.</>}</span>
          <Link href={`/app/p/${project.id}/${lintErr ? 'constraints' : 'fixes'}`} className="btn sm outline">Review</Link>
        </div>
      )}
      <div className="panel">
        <div className="panel-head"><h2>Setup slack distribution</h2><span className="muted small">0.25 ns bins · failing paths coloured by root cause</span></div>
        <SlackHistogram paths={r.paths} highlight={hl} onPick={setHl} width={1100} height={260} />
        <div className="cause-chips" role="group" aria-label="Highlight a root cause">
          {r.causes.map(c => (
            <button key={c.cause} type="button" className={`cause-chip${hl === c.cause ? ' on' : ''}`} aria-pressed={hl === c.cause} onClick={() => setHl(hl === c.cause ? null : c.cause)}>
              <CauseDot cause={c.cause} /><span>{CAUSES[c.cause].short}</span><b className="mono">{c.paths.length}</b><small className="mono">{fmtNs(c.tns, 2)} ns</small>
            </button>
          ))}
          {!r.causes.length && <span className="good-text small">No failing setup or hold paths. Timing is met.</span>}
        </div>
        {hl && (
          <div className="cause-detail">
            <p><b>{CAUSES[hl].label}.</b> {CAUSE_HELP[hl]}</p>
            <PathTable paths={sel.slice(0, 8)} />
            <div className="row gap wrap">
              <Link href={`/app/p/${project.id}/paths?cause=${hl}`} className="btn sm outline">All {sel.length} paths</Link>
              <Link href={`/app/p/${project.id}/fixes#${hl}`} className="btn sm primary">See the fix</Link>
            </div>
          </div>
        )}
      </div>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>Clocks</h2>{worstFmax && <span className="muted small">Tightest: {worstFmax.clock.split('|').slice(-1)[0]} at {fmtN(worstFmax.fmax!, 1)} MHz</span>}</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Clock</th><th className="num">Target</th><th className="num">WNS</th><th className="num">TNS</th><th className="num" title="Failing endpoints reported by the tool, or failing paths listed when it reports none">Fail</th><th className="num">Fmax</th></tr></thead>
              <tbody>{timed.map(c => (
                <tr key={c.clock}>
                  <th className="mono clip" title={c.clock}>{c.clock}</th>
                  <td className="num mono nowrap">{c.isDefault ? <span className="warn-text" title="derive_clocks -period 1.0 placeholder">1000 MHz default</span> : c.period ? `${fmtN(1000 / c.period, 2)} MHz` : '—'}</td>
                  <td className={`num mono ${c.wns < 0 ? 'bad-text' : ''}`}>{Number.isFinite(c.wns) ? fmtNs(c.wns) : '—'}</td>
                  <td className="num mono">{fmtNs(c.tns)}</td>
                  <td className="num">{fmtN(c.endpoints ?? c.failing)}</td>
                  <td className={`num mono ${c.fmax && c.period && !c.isDefault && c.fmax < 1000 / c.period ? 'bad-text' : ''}`} title={c.fmaxFrom === 'report' ? 'From the Fmax summary in the report' : c.fmaxFrom === 'estimate' ? 'Estimated from the worst same-clock setup slack' : undefined}>{c.fmax ? `${fmtN(c.fmax, 1)}${c.fmaxFrom === 'estimate' ? ' est.' : ''}` : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {untimed.length > 0 && <p className="muted small">{untimed.length} clock{untimed.length > 1 ? 's' : ''} with no timed paths in this report: <span className="mono">{untimed.map(c => c.clock.split('|').slice(-2).join('|')).join(', ')}</span></p>}
          <p className="muted tiny">Fmax comes from the report&rsquo;s own Fmax summary when it has one. Values marked est. are 1000 / (period − worst same-clock setup slack); cross-clock paths are excluded.</p>
        </div>
        <WhatIf run={run} />
      </div>
      <Messages run={run} />
    </>
  )
}

/** What the tool itself said: missing SDC, ignored constraints, check_timing findings. */
function Messages({ run }: { run: TabProps['run'] }) {
  const list = run.report.issues.filter((x, i, a) => x.level !== 'error' && a.findIndex(y => y.message === x.message) === i)
  const m = run.r.meta
  if (!list.length && !m.tool) return null
  return (
    <div className="panel">
      <div className="panel-head"><h2>From the report</h2><span className="muted small">{[m.tool, m.design, m.device, m.state].filter(Boolean).join(' · ')}</span></div>
      {!list.length ? <p className="muted small">The tool raised no constraint warnings in this report.</p> : <>
        <div className="issues" role="list">{list.slice(0, 6).map((x, i) => <div key={i} role="listitem"><span className="ln">{x.line > 1 ? `line ${x.line}` : x.level}</span><span>{x.message}</span></div>)}</div>
        {list.length > 6 && <details><summary className="small">{list.length - 6} more</summary><div className="issues" role="list">{list.slice(6, 60).map((x, i) => <div key={i} role="listitem"><span className="ln">{x.line > 1 ? `line ${x.line}` : x.level}</span><span>{x.message}</span></div>)}</div></details>}
      </>}
    </div>
  )
}

function WhatIf({ run }: { run: TabProps['run'] }) {
  const opts = run.r.clocks.filter(c => c.period && c.total > 0)
  const [clock, setClock] = useState(opts[0]?.clock ?? '')
  const st = opts.find(c => c.clock === clock)
  const base = st?.period ? 1000 / st.period : 100
  // A clock on the 1000 MHz placeholder starts at its Fmax; the slider has to reach down to it.
  const top = st?.fmaxEst ? Math.floor(st.fmaxEst * 100) / 100 : null
  const start = st?.isDefault && top ? top : Math.round(base * 100) / 100
  const lo = Math.max(0.5, Math.min(base, st?.fmax ?? base) * 0.5), hi = st?.isDefault && st.fmax ? st.fmax * 2 : Math.max(base, st?.fmax ?? 0) * 1.5
  const [mhz, setMhz] = useState(start)
  useEffect(() => setMhz(start), [clock, start])
  if (!st) return null
  const w = whatIfFrequency(run.r, clock, mhz)
  return (
    <div className="panel">
      <div className="panel-head"><h2>Frequency what-if</h2></div>
      <label className="field"><span>Clock</span><select value={clock} onChange={e => setClock(e.target.value)}>{opts.map(c => <option key={c.clock} value={c.clock}>{c.clock}</option>)}</select></label>
      <label className="field"><span>Target frequency: <b className="mono">{fmtN(mhz, 2)} MHz</b> ({fmtNs(1000 / mhz)} ns)</span>
        <input type="range" min={lo} max={hi} step={(hi - lo) / 400} value={mhz} onChange={e => setMhz(Number(e.target.value))} />
      </label>
      <div className="row gap-sm wrap">
        {!st.isDefault && <button type="button" className="btn sm ghost" onClick={() => setMhz(base)}>Target</button>}
        {top && <button type="button" className="btn sm ghost" onClick={() => setMhz(top)}>Fmax ({fmtN(top, 1)})</button>}
      </div>
      {w && (
        <dl className="mini-stats whatif">
          <div><dt>Same-clock paths</dt><dd>{w.paths}</dd></div>
          <div><dt>Failing</dt><dd className={w.failing ? 'bad-text' : 'good-text'}>{w.failing}</dd></div>
          <div><dt>WNS</dt><dd className="mono">{fmtNs(w.wns)}</dd></div>
          <div><dt>TNS</dt><dd className="mono">{fmtNs(w.tns)}</dd></div>
        </dl>
      )}
      <p className="muted tiny">Shifts single-cycle same-clock setup slack by the period change. {w?.excluded ? `${w.excluded} cross-clock paths are not re-estimated because their requirement depends on both clocks.` : ''}</p>
    </div>
  )
}

// ---------- Paths ----------

export function PathTable({ paths, onOpen }: { paths: Classified[]; onOpen?(p: Classified): void }) {
  return (
    <div className="table-wrap">
      <table className="paths">
        <thead><tr><th className="num">Slack</th><th>From</th><th>To</th><th>Clocks</th><th className="num">Lvl</th><th className="num">Fo</th><th>Cause</th></tr></thead>
        <tbody>{paths.map(p => (
          <tr key={p.id} onClick={onOpen ? () => onOpen(p) : undefined} className={onOpen ? 'click' : ''} tabIndex={onOpen ? 0 : undefined} onKeyDown={onOpen ? e => { if (e.key === 'Enter') onOpen(p) } : undefined}>
            <td className={`num mono ${p.slack < 0 && p.cutBy === null ? 'bad-text' : ''}`}>{fmtNs(p.slack)}{p.analysis !== 'setup' && <small className="an"> {p.analysis}</small>}</td>
            <td className="mono clip" title={p.from}>{p.from}</td>
            <td className="mono clip" title={p.to}>{p.to}</td>
            <td className="mono clip small" title={`${p.launch} → ${p.latch}`}>{p.cross ? `${tail(p.launch)} → ${tail(p.latch)}` : tail(p.latch)}</td>
            <td className="num">{p.levels ?? '—'}</td>
            <td className="num">{p.fanout ?? '—'}</td>
            <td>{p.cutBy !== null ? <span className="kind">cut, line {p.cutBy}</span> : p.cause ? <span className="cause-tag"><CauseDot cause={p.cause} />{CAUSES[p.cause].short}</span> : <span className="muted small">met</span>}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}
const tail = (c: string) => c ? c.length > 22 ? '…' + c.split('|').slice(-2).join('|').slice(-20) : c : '(none)'

function Paths({ run }: TabProps) {
  const q0 = new URLSearchParams(location.search)
  const [q, setQ] = useState('')
  const [cause, setCause] = useState<string>(q0.get('cause') ?? 'failing')
  const [an, setAn] = useState('all')
  const [groupBy, setGroupBy] = useState<'none' | 'pair' | 'bus'>('none')
  const [limit, setLimit] = useState(150)
  const [open, setOpen] = useState<Classified | null>(null)
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === '/' && !isTyping(e)) { e.preventDefault(); search.current?.focus() } }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [])
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return run.r.paths.filter(p =>
      (cause === 'all' || (cause === 'failing' ? p.slack < 0 && p.cutBy === null : cause === 'cut' ? p.cutBy !== null : p.cause === cause && p.cutBy === null)) &&
      (an === 'all' || p.analysis === an) &&
      (!needle || `${p.from} ${p.to} ${p.launch} ${p.latch}`.toLowerCase().includes(needle))).sort((a, b) => a.slack - b.slack)
  }, [run, q, cause, an])
  const groups = groupBy === 'none' ? null : (groupBy === 'pair' ? run.r.pairs : run.r.buses).map(g => ({ ...g, list: list.filter(p => g.paths.includes(p.id)) })).filter(g => g.list.length)

  return (
    <>
      <div className="filters">
        <label className="field grow"><span>Search nodes and clocks <kbd>/</kbd></span><input ref={search} value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. u_rx or pix_out" /></label>
        <label className="field"><span>Show</span><select value={cause} onChange={e => setCause(e.target.value)}>
          <option value="failing">Failing</option><option value="all">All paths</option><option value="cut">Cut by SDC</option>
          {CAUSE_ORDER.map(c => <option key={c} value={c}>{CAUSES[c].short}</option>)}
        </select></label>
        <label className="field"><span>Analysis</span><select value={an} onChange={e => setAn(e.target.value)}><option value="all">Setup + hold</option><option value="setup">Setup</option><option value="hold">Hold</option></select></label>
        <div className="field"><span>Group by</span><div className="seg-control" role="radiogroup" aria-label="Group by">
          {(['none', 'pair', 'bus'] as const).map(g => <button key={g} type="button" role="radio" aria-checked={groupBy === g} className={groupBy === g ? 'on' : ''} onClick={() => setGroupBy(g)}>{g === 'none' ? 'None' : g === 'pair' ? 'Clock pair' : 'Register bus'}</button>)}
        </div></div>
      </div>
      <div className="row between wrap gap">
        <p className="muted small">{list.length} path{list.length === 1 ? '' : 's'}{groups ? ` in ${groups.length} groups` : ''}</p>
        <button type="button" className="btn sm ghost" onClick={() => download('timing-paths.csv', pathsCsv(run.r))}>Export CSV</button>
      </div>
      {!list.length ? <Empty title="No paths match">{cause === 'failing' ? <p className="good-text">Nothing is failing with these filters.</p> : <p className="muted">Try another filter.</p>}</Empty>
        : groups ? groups.map(g => (
          <details key={g.key} className="group" open={groups.length <= 4}>
            <summary><span className="mono clip">{g.label}</span><span className="muted small">{g.list.length} shown · {g.failing} failing · WNS <b className={`mono ${g.wns < 0 ? 'bad-text' : ''}`}>{fmtNs(g.wns)}</b> · TNS <span className="mono">{fmtNs(g.tns)}</span></span></summary>
            <PathTable paths={g.list.slice(0, 60)} onOpen={setOpen} />
          </details>
        )) : <>
          <div className="panel flush"><PathTable paths={list.slice(0, limit)} onOpen={setOpen} /></div>
          {list.length > limit && <button type="button" className="btn ghost" onClick={() => setLimit(l => l + 300)}>Show more ({list.length - limit} left)</button>}
        </>}
      <Modal open={!!open} onClose={() => setOpen(null)} title="Path detail" wide>{open && <PathDetail p={open} vivado={run.r.format === 'vivado'} />}</Modal>
    </>
  )
}

function PathDetail({ p, vivado }: { p: Classified; vivado: boolean }) {
  const share = p.logicDelay !== undefined && p.routeDelay !== undefined && p.dataDelay ? `${fmtNs(p.logicDelay)} ns cells (${Math.round(100 * p.logicDelay / p.dataDelay)}%) + ${fmtNs(p.routeDelay)} ns routing (${Math.round(100 * p.routeDelay / p.dataDelay)}%)` : undefined
  const tcl = vivado
    ? `report_timing -${p.analysis === 'hold' || p.analysis === 'removal' ? 'hold' : 'setup'} -from [get_pins {${p.from}}] -to [get_pins {${p.to}}] -max_paths 1 -name triage_path`
    : `report_timing -${p.analysis} -from [get_keepers {${p.from}}] -to [get_keepers {${p.to}}] -npaths 1 -detail full_path -panel_name {Triage path}`
  const rows: [string, string | number | undefined][] = [['Analysis', p.analysis], ['From node', p.from], ['To node', p.to], ['Launch clock', p.launch || '(none)'], ['Latch clock', p.latch || '(none)'], ['Relationship', p.relationship !== undefined ? `${fmtNs(p.relationship)} ns` : undefined], ['Clock skew', p.skew !== undefined ? `${fmtNs(p.skew)} ns` : undefined], ['Data delay', p.dataDelay !== undefined ? `${fmtNs(p.dataDelay)} ns` : undefined], ['Data arrival', p.arrival !== undefined ? `${fmtNs(p.arrival)} ns` : undefined], ['Data required', p.required !== undefined ? `${fmtNs(p.required)} ns` : undefined], ['Cells and routing', share], ['Logic levels', p.levels !== undefined && p.levelDetail ? `${p.levels} (${p.levelDetail})` : p.levels], ['Max data-path fanout', p.fanout], ['Clock uncertainty', p.uncertainty !== undefined ? `${fmtNs(p.uncertainty)} ns` : undefined], ['Worst corner', p.corner], ['Source line', p.line]]
  return (
    <div className="stack">
      <div className="row gap wrap"><b className={`slack-big mono ${p.slack < 0 ? 'bad-text' : 'good-text'}`}>{fmtNs(p.slack)} ns</b>{p.cause && <span className="cause-tag"><CauseDot cause={p.cause} />{CAUSES[p.cause].label}</span>}{p.cutBy !== null && <span className="kind">Cut by SDC line {p.cutBy}</span>}</div>
      {p.cause && <p className="muted">{CAUSE_HELP[p.cause]}</p>}
      <dl className="kv">{rows.filter(r => r[1] !== undefined && r[1] !== '').map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="mono break">{v}</dd></div>)}</dl>
      <Code label={vivado ? 'Tcl: re-report this path in Vivado' : 'Tcl: re-report this path in Timing Analyzer'} code={tcl} />
    </div>
  )
}

// ---------- Clocks & CDC ----------

function Cdc({ run, project }: TabProps) {
  const { r, clocks } = run
  const unc = r.crossings.filter(x => x.status === 'unconstrained')
  return (
    <>
      <div className="panel">
        <div className="panel-head"><h2>Clock-domain crossings</h2><span className="muted small">{unc.length} unconstrained · {r.crossings.length - unc.length} cut or related</span></div>
        {!r.crossings.length ? <p className="muted">No paths cross between clocks in this report.</p> : (
          <div className="crossings">
            {r.crossings.map(x => (
              <article key={x.launch + x.latch} className={`crossing ${x.status}`}>
                <div className="row between wrap gap-sm">
                  <div className="xpair mono"><span className="clip" title={x.launch}>{x.launch}</span><span aria-hidden="true">→</span><span className="clip" title={x.latch}>{x.latch}</span></div>
                  <span className={`badge ${x.status === 'unconstrained' ? 'severe' : x.status === 'cut' ? 'low' : 'moderate'}`}>{x.status === 'unconstrained' ? 'Unconstrained crossing' : x.status === 'cut' ? `Cut (SDC line ${x.cutBy ?? '—'})` : 'Related clocks'}</span>
                </div>
                <p className="small muted">{x.paths} path{x.paths === 1 ? '' : 's'} · {x.failing} failing{x.paths ? <> · worst <span className="mono">{fmtNs(x.wns)}</span> ns</> : null}</p>
                {x.toBuses.length > 0 && <ul className="sync-list">
                  {x.toBuses.map(b => <li key={b.bus}><span className="mono">{b.bus}</span> <span className="muted">({b.width} bit{b.width > 1 ? 's' : ''})</span>: {b.synchronized ? <span className="good-text">looks like a synchronizer stage</span> : b.width > 1 ? <span className="bad-text">multi-bit bus, needs a dual-clock FIFO or handshake</span> : <span className="warn-text">needs a two-flop synchronizer</span>}</li>)}
                </ul>}
                {x.status === 'related' && <p className="small">Both clocks come from the same reference, so the requirement is real. Treat it like a normal path, or use a multicycle if the transfer is enable-qualified.</p>}
              </article>
            ))}
          </div>
        )}
        {unc.length > 0 && <Link href={`/app/p/${project.id}/fixes#cdc`} className="btn primary">Get the set_clock_groups fix</Link>}
      </div>
      <div className="panel">
        <h2>Clocks</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Kind</th><th className="num">Period</th><th className="num">Frequency</th><th>Master</th><th>Family</th></tr></thead>
          <tbody>{clocks.map(c => <tr key={c.name}><th className="mono clip" title={c.name}>{c.name}</th><td>{c.kind ?? 'base'}</td><td className="num mono">{fmtNs(c.period)}</td><td className="num mono">{fmtN(1000 / c.period, 3)} MHz</td><td className="mono small">{c.master ?? ''}</td><td className="mono small clip">{familyOf(c.name, clocks)}</td></tr>)}</tbody>
        </table></div>
        <p className="muted tiny">Clocks in one family share a reference (a PLL and its input) and are timed as related. Different families need set_clock_groups.</p>
      </div>
    </>
  )
}
const familyOf = (n: string, clocks: TabProps['run']['clocks']) => rootClock(n, clocks)

// ---------- Constraints ----------

function Constraints({ project, run, update }: TabProps) {
  const [text, setText] = useState(project.sdc)
  useEffect(() => setText(project.sdc), [project.sdc])
  const ta = useRef<HTMLTextAreaElement>(null)
  const dirty = text !== project.sdc
  const save = () => {
    const prev = project.sdc
    void update({ sdc: text })
    toast('Constraints saved. Analysis re-ran.', { tone: 'ok', undo: () => void update({ sdc: prev }) })
  }
  const jump = (line: number) => {
    const el = ta.current
    if (!el) return
    const lines = text.split('\n')
    const start = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0)
    el.focus()
    el.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0))
    el.scrollTop = Math.max(0, (line - 4) * 20)
  }
  const lines = text.split('\n').length
  return (
    <div className="constraints">
      <div className="panel">
        <div className="panel-head">
          <h2 className="mono">{project.sdcName}</h2>
          <div className="row gap-sm">
            <button type="button" className="btn sm ghost" onClick={() => download(project.sdcName, project.sdc, 'text/plain')}>Download</button>
            <button type="button" className="btn sm primary" disabled={!dirty} onClick={save}>Save &amp; re-run</button>
          </div>
        </div>
        <div className="editor">
          <pre className="gutter" aria-hidden="true">{Array.from({ length: lines }, (_, i) => i + 1).join('\n')}</pre>
          <textarea ref={ta} value={text} onChange={e => setText(e.target.value)} spellCheck={false} aria-label="SDC constraints" placeholder="# Paste your .sdc here, or import it on the Data tab" onScroll={e => { const g = e.currentTarget.previousElementSibling as HTMLElement; g.scrollTop = e.currentTarget.scrollTop }} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (dirty) save() } }} />
        </div>
        {dirty && <p className="warn-text small">Unsaved changes. <kbd>⌘</kbd>/<kbd>Ctrl</kbd> <kbd>S</kbd> saves and re-runs the analysis.</p>}
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Constraint lint</h2><span className="muted small">{run.r.lint.length} finding{run.r.lint.length === 1 ? '' : 's'}</span></div>
        {!project.sdc.trim() ? <Empty title="No constraints yet"><p className="muted">Without an .sdc, Timing Analyzer defaults every clock to 1 GHz and leaves I/O untimed. Paste yours on the left.</p></Empty>
          : !run.r.lint.length ? <p className="good-text">No problems found.</p> : (
            <ul className="lint">
              {run.r.lint.map((l, i) => (
                <li key={i} className={l.level}>
                  <div className="row between gap-sm"><span className={`badge ${l.level === 'error' ? 'severe' : l.level === 'warn' ? 'high' : 'moderate'}`}>{l.level}</span><button type="button" className="linkish small mono" onClick={() => jump(l.line)}>line {l.line}</button></div>
                  <p>{l.message}</p>
                  {l.fix && <div className="row gap-sm wrap"><code className="fix-line">{l.fix}</code><button type="button" className="btn sm outline" onClick={() => { const prev = project.sdc; void update({ sdc: `${project.sdc.replace(/\s*$/, '')}\n${l.fix}\n` }); toast('Added to constraints', { tone: 'ok', undo: () => void update({ sdc: prev }) }) }}>Add</button></div>}
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  )
}

// ---------- Fixes ----------

function Fixes({ project, run, update, ds }: TabProps) {
  const { fixes, r } = run
  useEffect(() => {
    const id = location.hash.slice(1)
    if (id) document.querySelector(`[data-cause="${id}"]`)?.scrollIntoView({ block: 'start' })
  }, [])
  const apply = (f: Fix) => {
    const prev = project.sdc
    const sdc = applyToSdc(project.sdc, f)
    const after = runAnalysis(ds, { ...project, sdc }).r
    void update({ sdc, applied: [...new Set([...project.applied, f.id])] })
    toast(`Applied. Re-ran: ${r.failing} → ${after.failing} failing, WNS ${fmtNs(r.wns)} → ${fmtNs(after.wns)} ns`, { tone: 'ok', undo: () => void update({ sdc: prev, applied: project.applied }) })
  }
  const recoverable = fixes.reduce((a, f) => a + f.tns, 0)
  return (
    <>
      <div className="row between wrap gap fix-bar">
        <p className="muted">{fixes.length} fix{fixes.length === 1 ? '' : 'es'} · addresses <b className="mono">{fmtNs(recoverable, 2)} ns</b> of TNS. Constraint fixes can be applied here and re-run instantly; RTL fixes need a recompile.</p>
        <div className="row gap-sm wrap">
          <button type="button" className="btn sm ghost" onClick={() => download('timing-triage-fixes.sdc', fixesSdc(fixes, project.name), 'text/plain')}>Download fixes.sdc</button>
          <button type="button" className="btn sm ghost" onClick={() => download('timing-paths.csv', pathsCsv(r))}>Paths CSV</button>
          <Link href={`/app/p/${project.id}/report`} className="btn sm primary">Closure report</Link>
        </div>
      </div>
      {!fixes.length ? <Empty title="Nothing to fix"><p className="good-text">All timed paths meet setup and hold, and the constraints look sound.</p></Empty> : (
        <div className="fix-list">
          {fixes.map((f, i) => {
            const canApply = !!f.sdc && f.sdc.split('\n').some(l => l.trim() && !l.trim().startsWith('#'))
            const done = !!f.sdc && project.sdc.includes(f.sdc)
            return (
              <article key={f.id} className={`fix-card sev-${f.severity}`} data-cause={f.cause}>
                <div className="fix-rank">{i + 1}</div>
                <div className="fix-main">
                  <div className="row gap-sm wrap">{f.cause !== 'sdc' ? <span className="cause-tag"><CauseDot cause={f.cause} />{causeLabel(f.cause)}</span> : <span className="kind">Constraint lint</span>}{f.pathIds.length > 0 && <span className="muted small">{f.pathIds.length} path{f.pathIds.length > 1 ? 's' : ''}</span>}</div>
                  <h3 className="break">{f.title}</h3>
                  <p>{f.why}</p>
                  {f.steps.length > 0 && <ul className="steps">{f.steps.map(s => <li key={s}>{s}</li>)}</ul>}
                  {f.sdc && <Code label={canApply ? 'SDC' : 'SDC (commented: read the condition first)'} code={f.sdc} />}
                  {f.qsf && <Code label={r.format === 'vivado' ? 'Tcl / XDC property (Tcl console, or paste into the .xdc)' : 'QSF assignment (Assignments > Assignment Editor, or paste into the .qsf)'} code={f.qsf} />}
                </div>
                <div className="fix-impact">
                  {f.tns < 0 && <><b className="mono">{fmtNs(f.tns, 2)}</b><small>ns TNS addressed</small></>}
                  {canApply && (done ? <span className="badge low">In SDC</span> : <button type="button" className="btn sm primary" onClick={() => apply(f)}>Apply &amp; re-run</button>)}
                </div>
              </article>
            )
          })}
        </div>
      )}
      {project.applied.length > 0 && <p className="muted small">Applied from this page: {project.applied.length}. Every applied block is marked with a dated comment in <Link href={`/app/p/${project.id}/constraints`}>{project.sdcName}</Link>.</p>}
    </>
  )
}

// ---------- History ----------

function History({ project, run, update }: TabProps) {
  const snaps = [...project.snapshots].sort((a, b) => a.at - b.at)
  const [a, setA] = useState(snaps.at(-2)?.id ?? '')
  const [b, setB] = useState(snaps.at(-1)?.id ?? '')
  const A = snaps.find(s => s.id === a), B = snaps.find(s => s.id === b)
  const d = A && B ? compare(A, B) : null
  return (
    <>
      <div className="panel">
        <div className="panel-head"><h2>Slack trend</h2><div className="row gap-sm"><span className="legend"><span><i style={{ background: 'var(--accent)' }} />WNS (ns)</span><span><i style={{ background: 'var(--bar-soft)' }} />Failing paths</span></span><button type="button" className="btn sm primary" onClick={() => saveRun(project, run, update)}>Save current run</button></div></div>
        <Trend snaps={snaps} />
      </div>
      <div className="panel">
        <h2>Runs</h2>
        {!snaps.length ? <p className="muted">No runs saved yet. Every import saves one; you can also save after applying fixes.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Run</th><th>Date</th><th className="num">WNS</th><th className="num">TNS</th><th className="num">Failing</th><th>Causes</th><th /></tr></thead>
            <tbody>{[...snaps].reverse().map(s => (
              <tr key={s.id}>
                <th>{s.label}</th><td className="small">{new Date(s.at).toLocaleDateString()}</td>
                <td className={`num mono ${s.wns < 0 ? 'bad-text' : ''}`}>{fmtNs(s.wns)}</td><td className="num mono">{fmtNs(s.tns)}</td><td className="num">{s.failing}</td>
                <td>{Object.entries(s.causes).map(([c, n]) => <span key={c} className="cause-tag tiny"><CauseDot cause={c as Cause} />{n}</span>)}</td>
                <td className="num"><button type="button" className="btn sm danger-ghost" onClick={async () => {
                  if (!(await ask(`Delete “${s.label}”?`, 'Removes this run from the history. You can undo for a few seconds.', 'Delete run'))) return
                  const prev = project.snapshots
                  void update({ snapshots: prev.filter(x => x.id !== s.id) })
                  const { deleteSnapshotCloud } = await import('./sync.ts')
                  void deleteSnapshotCloud(s.id)
                  toast('Run deleted', { undo: () => void update({ snapshots: prev }) })
                }}>Delete</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {snaps.length >= 2 && (
        <div className="panel">
          <div className="panel-head"><h2>Compare runs</h2>
            <div className="row gap-sm wrap">
              <select aria-label="Before" value={a} onChange={e => setA(e.target.value)}>{snaps.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
              <span aria-hidden="true">→</span>
              <select aria-label="After" value={b} onChange={e => setB(e.target.value)}>{snaps.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
            </div>
          </div>
          {d && A && B && <>
            <div className="kpis three">
              <Kpi label="WNS change" value={`${signed(d.wns, v => v.toFixed(3))} ns`} tone={d.wns > 0 ? 'good' : d.wns < 0 ? 'bad' : undefined} note={`${fmtNs(A.wns)} → ${fmtNs(B.wns)}`} />
              <Kpi label="TNS change" value={`${signed(d.tns, v => v.toFixed(2))} ns`} tone={d.tns > 0 ? 'good' : d.tns < 0 ? 'bad' : undefined} note={`${fmtNs(A.tns, 2)} → ${fmtNs(B.tns, 2)}`} />
              <Kpi label="Failing paths" value={signed(d.failing, String)} tone={d.failing < 0 ? 'good' : d.failing > 0 ? 'bad' : undefined} note={`${A.failing} → ${B.failing}`} />
            </div>
            <div className="grid-2">
              <div><h3>Per clock WNS</h3><table><tbody>{d.clocks.map(c => <tr key={c.clock}><th className="mono clip small" title={c.clock}>{c.clock}</th><td className="num mono">{fmtNs(c.before)}</td><td className="num mono">{fmtNs(c.after)}</td><td className={`num mono ${c.before !== null && c.after !== null ? c.after > c.before ? 'good-text' : c.after < c.before ? 'bad-text' : '' : ''}`}>{c.before !== null && c.after !== null ? signed(Math.round((c.after - c.before) * 1000) / 1000, v => v.toFixed(3)) : 'new'}</td></tr>)}</tbody></table></div>
              <div>
                <h3>Endpoints</h3>
                <p className="small"><span className="good-text">{d.fixed.length} fixed</span> · <span className="bad-text">{d.added.length} new</span> · {d.still} still failing</p>
                {d.fixed.length > 0 && <details><summary className="small">Fixed endpoints</summary><ul className="mono tiny ep">{d.fixed.slice(0, 50).map(e => <li key={e}>{e}</li>)}</ul></details>}
                {d.added.length > 0 && <details open><summary className="small">New failing endpoints</summary><ul className="mono tiny ep">{d.added.slice(0, 50).map(e => <li key={e}>{e}</li>)}</ul></details>}
              </div>
            </div>
          </>}
        </div>
      )}
    </>
  )
}

