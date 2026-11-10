import { useEffect, useMemo, useState } from 'react'
import { analyze, mergeClocks } from './engine/analyze.ts'
import { buildFixes } from './engine/fixes.ts'
import { detectFormat, parseReport } from './engine/parse.ts'
import { samples } from './engine/sample.ts'
import { parseSdc } from './engine/sdc.ts'
import { snapshot } from './engine/snapshot.ts'
import type { ParsedReport } from './engine/types.ts'
import { getData, getDefaults, getProjects, saveProject, useProjects, uuid, type Dataset, type Project } from './store.ts'

/** Several report files (e.g. .sta.rpt plus a report_timing export) become one report. */
export function combine(list: ParsedReport[]): ParsedReport {
  const reports = list.filter(r => r.format === 'quartus' || r.format === 'vivado')
  const out: ParsedReport = { format: reports[0]?.format ?? 'unknown', paths: [], clocks: [], summary: [], unconstrained: [], transfers: [], issues: [], found: [] }
  const seen = new Set<string>()
  reports.forEach((r, i) => {
    for (const p of r.paths) {
      const k = [p.analysis, p.from, p.to, p.launch, p.latch].join('\u0000')
      if (seen.has(k)) continue
      seen.add(k)
      out.paths.push({ ...p, id: `f${i}${p.id}` })
    }
    for (const c of r.clocks) if (!out.clocks.some(x => x.name === c.name)) out.clocks.push(c)
    for (const s of r.summary) if (!out.summary.some(x => x.clock === s.clock && x.analysis === s.analysis)) out.summary.push(s)
    for (const u of r.unconstrained) if (!out.unconstrained.some(x => x.name === u.name && x.kind === u.kind)) out.unconstrained.push(u)
    out.transfers.push(...r.transfers)
    out.found.push(...r.found)
  })
  return out
}

const sampleData = (id: string): Dataset | null => {
  const s = samples().find(x => x.id === id)
  return s ? [{ name: s.reportName, text: s.report }] : null
}

export function runAnalysis(files: Dataset, p: Pick<Project, 'sdc' | 'settings'>) {
  const report = combine(files.filter(f => detectFormat(f.text) !== 'sdc').map(f => parseReport(f.text)))
  const r = analyze({ report, sdcText: p.sdc, settings: p.settings })
  const clocks = mergeClocks(report.clocks, p.sdc.trim() ? parseSdc(p.sdc) : null)
  return { report, r, clocks, fixes: buildFixes(r, clocks, p.settings) }
}
export type Run = ReturnType<typeof runAnalysis>

const DAY = 86400000
export async function createSampleProject(sampleId: string): Promise<Project> {
  const existing = getProjects().find(p => p.sampleId === sampleId)
  if (existing) return existing
  const def = samples().find(s => s.id === sampleId)!
  const files = sampleData(sampleId)!
  const now = Date.now()
  const base = { sdc: def.sdc, settings: getDefaults() }
  const run = runAnalysis(files, base)
  // Two earlier synthetic runs so the history has a trend: same design, worse slack before some RTL fixes.
  const worse = (shift: number, extra: number) => {
    const r = { ...run.report, paths: run.report.paths.map(p => ({ ...p, slack: p.slack < 0.6 ? Math.round((p.slack - shift - (p.levels ?? 0) * extra) * 1000) / 1000 : p.slack })) }
    return analyze({ report: r, sdcText: def.sdc, settings: base.settings })
  }
  const snapshots = [
    snapshot(worse(0.9, 0.06), uuid(), 'First full compile', now - 20 * DAY),
    snapshot(worse(0.35, 0.02), uuid(), 'After moving the UART FIFO', now - 9 * DAY),
    snapshot(run.r, uuid(), 'Current report', now - 2 * DAY),
  ]
  return saveProject({
    id: uuid(), name: def.name, createdAt: now, updatedAt: now, sampleId, sdc: def.sdc, sdcName: def.sdcName, settings: base.settings, snapshots, applied: [],
    imports: [{ id: uuid(), fileName: `${def.reportName} (synthetic)`, format: def.format, paths: run.report.paths.length, issues: 0, at: now - 2 * DAY }],
  })
}

export async function createBlankProject(name: string): Promise<Project> {
  const now = Date.now()
  return saveProject({ id: uuid(), name, createdAt: now, updatedAt: now, sdc: '', sdcName: 'constraints.sdc', settings: getDefaults(), snapshots: [], imports: [], applied: [] })
}

export function useProject(id: string) {
  const list = useProjects()
  const project = list?.find(p => p.id === id) ?? null
  const [ds, setDs] = useState<Dataset | null>(null)
  const importsKey = project ? project.imports.map(i => i.id).join(',') : ''
  useEffect(() => {
    if (!project) return
    let live = true
    if (project.sampleId) { setDs(sampleData(project.sampleId) ?? []); return }
    void getData(project.id).then(d => { if (live) setDs(d ?? []) })
    return () => { live = false }
  }, [project?.id, project?.sampleId, importsKey])
  const update = (patch: Partial<Project>) => project && saveProject({ ...project, ...patch })
  return { loading: list === null || (project !== null && ds === null), project, ds, update }
}

export function useRun(ds: Dataset | null, project: Project | null) {
  return useMemo(() => ds && project && ds.length ? runAnalysis(ds, project) : null, [ds, project?.sdc, project?.settings])
}
