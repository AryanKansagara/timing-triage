import { lazy, Suspense, useEffect, useState } from 'react'
import { snapshot } from './engine/snapshot.ts'
import { useProject, useRun, type Run } from './projectData.ts'
import { uuid, type Dataset, type Project } from './store.ts'
import { Empty, fmtNs, go, isTyping, Link, Modal, SyntheticBadge, toast } from './ui.tsx'

const Tabs = lazy(() => import('./Tabs.tsx'))
const DataTab = lazy(() => import('./Import.tsx'))

export const TABS = [['overview', 'Overview'], ['paths', 'Paths'], ['cdc', 'Clocks & CDC'], ['constraints', 'Constraints'], ['fixes', 'Fixes'], ['history', 'History'], ['data', 'Data']] as const
export type Tab = (typeof TABS)[number][0]

export interface TabProps { project: Project; ds: Dataset; run: Run; update(p: Partial<Project>): void }

export function saveRun(project: Project, run: Run, update: (p: Partial<Project>) => void, label?: string) {
  const snap = snapshot(run.r, uuid(), label ?? `Run ${project.snapshots.length + 1}`)
  void update({ snapshots: [...project.snapshots, snap] })
  toast(`Saved “${snap.label}” to history`, { tone: 'ok', undo: () => void update({ snapshots: project.snapshots }) })
}

export default function ProjectView({ id, tab: rawTab }: { id: string; tab: string }) {
  const { loading, project, ds, update } = useProject(id)
  const tab = (TABS.some(t => t[0] === rawTab) ? rawTab : 'overview') as Tab
  const run = useRun(ds, project)
  const [help, setHelp] = useState(false)

  useEffect(() => { if (project) document.title = `${project.name} · Timing Triage` }, [project?.name])
  const setTab = (t: Tab) => go(`/app/p/${id}${t === 'overview' ? '' : '/' + t}`, { keepScroll: true })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= TABS.length) { e.preventDefault(); setTab(TABS[n - 1][0]) }
      else if (e.key === '?') setHelp(true)
      else if (e.key === 's' && project && run) saveRun(project, run, update)
      else if (e.key === 'p') go(`/app/p/${id}/report`)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  if (loading) return <div className="boot" role="status"><span className="spinner" /> Parsing reports</div>
  if (!project) return (
    <section className="page narrow center">
      <Empty title="Design not found"><p className="muted">It may have been deleted, or it lives on another device.</p><Link href="/app" className="btn primary">All designs</Link></Empty>
    </section>
  )
  const empty = !run || !run.report.paths.length && !run.report.clocks.length

  return (
    <section className="page">
      <div className="proj-head">
        <div>
          <div className="eyebrow"><Link href="/app">Designs</Link></div>
          <h1 className="row gap wrap">{project.name} {project.sampleId && <SyntheticBadge />}</h1>
          {run && !empty && <p className="muted small mono" style={{ margin: 0 }}>{run.report.format === 'vivado' ? 'Vivado' : 'Quartus'} · {run.r.total} paths · WNS {fmtNs(run.r.wns)} ns · TNS {fmtNs(run.r.tns)} ns</p>}
        </div>
        {!empty && (
          <div className="toolbar">
            <button type="button" className="btn outline" onClick={() => saveRun(project, run!, update)} title="Save this analysis to history (S)">Save run</button>
            <Link href={`/app/p/${id}/report`} className="btn primary" title="Closure report (P)">Closure report</Link>
          </div>
        )}
      </div>
      <nav className="tabs" aria-label="Design sections">
        {TABS.map(([t, l], i) => <Link key={t} href={`/app/p/${id}${t === 'overview' ? '' : '/' + t}`} aria-current={t === tab ? 'page' : undefined} title={`${l} (${i + 1})`}>{l}</Link>)}
      </nav>
      <Suspense fallback={<div className="boot"><span className="spinner" /></div>}>
        {tab === 'data' || empty
          ? <DataTab project={project} ds={ds ?? []} run={run} update={update} />
          : <Tabs tab={tab} project={project} ds={ds!} run={run!} update={update} />}
      </Suspense>
      <Modal open={help} onClose={() => setHelp(false)} title="Keyboard shortcuts">
        <dl className="shortcuts">
          <div><dt><kbd>1</kbd>&ndash;<kbd>7</kbd></dt><dd>Switch sections</dd></div>
          <div><dt><kbd>S</kbd></dt><dd>Save this analysis as a run in History</dd></div>
          <div><dt><kbd>P</kbd></dt><dd>Open the printable closure report</dd></div>
          <div><dt><kbd>/</kbd></dt><dd>Search paths (Paths tab)</dd></div>
          <div><dt><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>Undo the last change</dd></div>
        </dl>
      </Modal>
    </section>
  )
}
