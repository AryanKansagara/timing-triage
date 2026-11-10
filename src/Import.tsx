import { useState } from 'react'
import { detectFormat, parseReport } from './engine/parse.ts'
import { lintSdc, parseSdc } from './engine/sdc.ts'
import { snapshot } from './engine/snapshot.ts'
import type { Format, Issue, ParsedReport } from './engine/types.ts'
import { createBlankProject, runAnalysis, type Run } from './projectData.ts'
import { putData, uuid, type Dataset, type Project } from './store.ts'
import { fmtN, go, Link, toast } from './ui.tsx'

interface Staged { id: string; name: string; text: string; format: Format; report?: ParsedReport; sdcInfo?: { stmts: number; clocks: number; lint: number } }

const MAX = 40_000_000
const FIELDS: [keyof ParsedReport['paths'][number], string][] = [['slack', 'Slack'], ['from', 'From node'], ['to', 'To node'], ['launch', 'Launch clock'], ['latch', 'Latch clock'], ['relationship', 'Relationship'], ['skew', 'Clock skew'], ['dataDelay', 'Data delay'], ['levels', 'Logic levels'], ['fanout', 'Fanout'], ['arrival', 'Arrival / required']]

function stage(name: string, text: string): Staged {
  const format = detectFormat(text)
  const s: Staged = { id: uuid(), name, text, format }
  if (format === 'sdc' || /\.(sdc|xdc)$/i.test(name)) {
    const m = parseSdc(text)
    s.format = 'sdc'
    s.sdcInfo = { stmts: m.stmts.length, clocks: m.clocks.length, lint: lintSdc(m).length }
  } else s.report = parseReport(text)
  return s
}

export default function DataTab({ project, ds, run, update }: { project: Project; ds: Dataset; run: Run | null; update(p: Partial<Project>): void }) {
  const [files, setFiles] = useState<Staged[]>([])
  const [paste, setPaste] = useState('')
  const [over, setOver] = useState(false)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)

  const addFiles = async (list: FileList | File[]) => {
    const next: Staged[] = []
    for (const f of Array.from(list)) {
      if (f.size > MAX) { toast(`${f.name} is over 40 MB. Export fewer paths (-npaths 1000).`, { tone: 'error' }); continue }
      next.push(stage(f.name, await f.text()))
    }
    setFiles(x => [...x, ...next])
  }

  const reports = files.filter(f => f.report && (f.report.format === 'quartus' || f.report.format === 'vivado'))
  const sdc = files.find(f => f.format === 'sdc')
  const blocking = reports.length === 0 && !sdc

  const commit = async () => {
    setBusy(true)
    try {
      const data: Dataset = reports.length ? reports.map(f => ({ name: f.name, text: f.text })) : ds
      const nextSdc = sdc ? sdc.text : project.sdc
      if (reports.length) await putData(project.id, data)
      const res = runAnalysis(data, { sdc: nextSdc, settings: project.settings })
      const now = Date.now()
      const imports = reports.map(f => ({ id: uuid(), fileName: f.name, format: f.report!.format, paths: f.report!.paths.length, issues: f.report!.issues.length, at: now }))
      const snaps = reports.length ? [...project.snapshots, snapshot(res.r, uuid(), label.trim() || `Run ${project.snapshots.length + 1}`, now)] : project.snapshots
      await update({ imports: [...project.imports, ...imports], sdc: nextSdc, sdcName: sdc?.name ?? project.sdcName, snapshots: snaps, dataMissing: false })
      toast(reports.length ? `Imported ${res.r.total} paths. ${res.r.failing} failing.` : 'Constraints replaced. Analysis re-ran.', { tone: 'ok' })
      setFiles([]); setLabel('')
      go(`/app/p/${project.id}`)
    } catch (e) {
      toast(`Import failed: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' })
    } finally { setBusy(false) }
  }

  if (project.sampleId) return (
    <div className="panel">
      <h2>Synthetic sample</h2>
      <p>This design&rsquo;s reports are generated (labelled synthetic) and rebuilt on every load. To analyze your own Quartus or Vivado reports, start a new design.</p>
      <div className="row gap wrap">
        <button type="button" className="btn primary" onClick={async () => { const p = await createBlankProject('My design'); go(`/app/p/${p.id}/data`) }}>New design</button>
        <Link href="/docs" className="btn ghost">How to export reports</Link>
      </div>
      {run && <p className="muted small">Current sample report: {run.report.paths.length} paths, {run.report.clocks.length} clocks, constraints in {project.sdcName}.</p>}
    </div>
  )

  return (
    <>
      <div className="grid-2 import">
        <label className={`drop${over ? ' over' : ''}`} onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); void addFiles(e.dataTransfer.files) }}>
          <input type="file" multiple className="sr-only" accept=".rpt,.txt,.sdc,.xdc,.summary,text/plain" onChange={e => { if (e.target.files) void addFiles(e.target.files); e.target.value = '' }} />
          <div className="drop-ico" aria-hidden="true">⤒</div>
          <h3>Drop report and constraint files</h3>
          <p className="muted small">Quartus <code>.sta.rpt</code> or <code>report_timing -file</code> output, <code>report_clocks</code>, <code>report_ucp</code>, your <code>.sdc</code>; or Vivado <code>report_timing_summary</code> text and <code>.xdc</code>. Several at once is fine.</p>
          <span className="btn outline sm">Choose files</span>
        </label>
        <div className="panel paste">
          <label className="field"><span>Or paste report or SDC text</span><textarea rows={7} value={paste} onChange={e => setPaste(e.target.value)} placeholder={'+--------+-----------+---------+\n; Slack  ; From Node ; To Node ;\n...'} className="mono" /></label>
          <button type="button" className="btn sm primary" disabled={!paste.trim()} onClick={() => { setFiles(x => [...x, stage(detectFormat(paste) === 'sdc' ? 'pasted.sdc' : 'pasted report', paste)]); setPaste('') }}>Check pasted text</button>
          <p className="muted tiny">Exact Tcl to export each report: <Link href="/docs">Docs</Link>. Files are parsed in your browser.</p>
        </div>
      </div>

      {files.length > 0 && (
        <div className="panel">
          <div className="panel-head"><h2>Validation</h2><button type="button" className="btn sm ghost" onClick={() => setFiles([])}>Clear</button></div>
          {files.map(f => <Validation key={f.id} f={f} onRemove={() => setFiles(x => x.filter(y => y.id !== f.id))} />)}
          <div className="row gap wrap end commit">
            {reports.length > 0 && <label className="field grow"><span>Run name</span><input value={label} onChange={e => setLabel(e.target.value)} placeholder={`Run ${project.snapshots.length + 1}`} /></label>}
            <button type="button" className="btn primary" disabled={blocking || busy} onClick={() => void commit()}>{busy ? 'Analyzing' : reports.length ? `Analyze ${reports.length} report${reports.length > 1 ? 's' : ''}${sdc ? ' + SDC' : ''}` : 'Replace constraints'}</button>
          </div>
          {blocking && <p className="error small">Nothing usable yet: add a timing report or an SDC file.</p>}
        </div>
      )}

      <div className="panel">
        <h2>Current data</h2>
        {!ds.length && !project.sdc ? <p className="muted">Nothing imported yet. Start with a report_timing export of your failing paths; add the .sdc to get constraint lint and one-click fixes.</p> : (
          <ul className="file-list">
            {ds.map(f => <li key={f.name}><span className="mono">{f.name}</span><span className="muted small">{fmtN(f.text.length / 1024, 0)} KB</span></li>)}
            {project.sdc && <li><span className="mono">{project.sdcName}</span><span className="muted small">{project.sdc.split('\n').length} lines · <Link href={`/app/p/${project.id}/constraints`}>edit</Link></span></li>}
          </ul>
        )}
        {project.imports.length > 0 && <p className="muted small">{project.imports.length} import{project.imports.length > 1 ? 's' : ''}, last {new Date(project.imports.at(-1)!.at).toLocaleString()}.</p>}
      </div>
    </>
  )
}

function Validation({ f, onRemove }: { f: Staged; onRemove(): void }) {
  const r = f.report
  const issues: Issue[] = r?.issues ?? []
  const ok = f.format === 'sdc' || (r && (r.paths.length || r.clocks.length))
  return (
    <div className={`validation ${ok ? 'ok' : 'bad'}`}>
      <div className="row between gap-sm wrap">
        <div className="row gap-sm"><span className={`badge ${ok ? 'low' : 'severe'}`}>{f.format === 'sdc' ? 'SDC / XDC' : f.format === 'quartus' ? 'Quartus Timing Analyzer' : f.format === 'vivado' ? 'Vivado' : 'Unrecognised'}</span><b className="mono break">{f.name}</b></div>
        <button type="button" className="linkish small" onClick={onRemove}>Remove</button>
      </div>
      {f.sdcInfo && <p className="small">{f.sdcInfo.stmts} commands, {f.sdcInfo.clocks} clocks, {f.sdcInfo.lint} lint finding{f.sdcInfo.lint === 1 ? '' : 's'}. Will replace the current constraints.</p>}
      {r && (r.paths.length > 0 || r.clocks.length > 0) && <>
        <p className="small">{r.paths.length} paths ({r.paths.filter(p => p.slack < 0).length} negative slack) · {r.clocks.length} clocks · {r.unconstrained.length} unconstrained items. Found: {r.found.join(', ') || 'nothing'}.</p>
        {r.paths.length > 0 && <div className="map-grid" aria-label="Field mapping">
          {FIELDS.map(([k, l]) => {
            const n = r.paths.filter(p => p[k] !== undefined && p[k] !== '').length
            const pct = n / r.paths.length
            return <div key={k} className="map-cell"><span>{l}</span><span className={`mono small ${pct === 1 ? 'good-text' : pct === 0 ? 'muted' : 'warn-text'}`}>{pct === 0 ? 'not in file' : `${Math.round(pct * 100)}%`}</span></div>
          })}
        </div>}
      </>}
      {issues.length > 0 && <div className="issues" role="list">
        {issues.slice(0, 200).map((x, i) => <div key={i} role="listitem" className={x.level === 'error' ? 'error-row' : ''}><span className="ln">line {x.line}</span><span>{x.message}</span></div>)}
      </div>}
    </div>
  )
}
