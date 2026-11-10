import { useState } from 'react'
import type { Settings as Defaults } from './engine/types.ts'
import { deleteProject, getDefaults, getProjects, setDefaults } from './store.ts'
import { exportAll, RAW_SYNC_LIMIT, useSync } from './sync.ts'
import { ask, download, setTheme, toast, useDark } from './ui.tsx'

export default function Settings() {
  const [d, setD] = useState<Defaults>(getDefaults)
  const dark = useDark()
  const sync = useSync()
  const save = (p: Partial<Defaults>) => { const next = { ...d, ...p }; setD(next); setDefaults(next); toast('Saved', { tone: 'ok', ttl: 1500 }) }

  return (
    <section className="page narrow settings">
      <div className="eyebrow">Settings</div>
      <h1>Settings</h1>

      <div className="panel">
        <h2>Classifier thresholds for new designs</h2>
        <p className="muted small">Copied into each new design when it is created. Existing designs keep the thresholds they were created with.</p>
        <div className="inline-fields">
          <label className="field"><span>Logic levels budget</span><input type="number" min="2" max="40" value={d.maxLevels} onChange={e => save({ maxLevels: Math.max(2, Math.min(40, Number(e.target.value) || 6)) })} /></label>
          <label className="field"><span>High-fanout threshold</span><input type="number" min="8" max="10000" value={d.maxFanout} onChange={e => save({ maxFanout: Math.max(8, Number(e.target.value) || 64) })} /></label>
          <label className="field row gap-sm"><input type="checkbox" checked={d.includeHold} onChange={e => save({ includeHold: e.target.checked })} /><span>Include hold paths</span></label>
        </div>
        <p className="muted tiny">Paths over the levels budget are classed as logic-depth bound. A practical budget is roughly 0.6 × period / 0.5 ns per LUT level; 6 suits 100 to 150 MHz on Cyclone V.</p>
      </div>

      <div className="panel">
        <h2>Appearance</h2>
        <div className="seg-control" role="radiogroup" aria-label="Theme">
          <button type="button" role="radio" aria-checked={!dark} className={!dark ? 'on' : ''} onClick={() => setTheme('light')}>Light</button>
          <button type="button" role="radio" aria-checked={dark} className={dark ? 'on' : ''} onClick={() => setTheme('dark')}>Dark</button>
        </div>
      </div>

      <div className="panel">
        <h2>Your data</h2>
        <p>Designs live in this browser (IndexedDB). {sync.user ? <>Signed in as <b>{sync.user.email}</b>: constraints, thresholds, applied fixes, run history and report files under {(RAW_SYNC_LIMIT / 1e6).toFixed(1)} MB per project sync to your account.</> : 'Sign in from the account menu (top right) to sync across devices. It is optional.'}</p>
        <div className="row gap wrap">
          <button type="button" className="btn ghost" onClick={async () => download(`timing-triage-export-${new Date().toISOString().slice(0, 10)}.json`, await exportAll())}>Export all my data (JSON)</button>
          <button type="button" className="btn danger-ghost" onClick={async () => {
            const list = getProjects()
            if (!list.length) { toast('Nothing to delete'); return }
            if (!(await ask('Delete all local designs?', `Removes ${list.length} design${list.length > 1 ? 's' : ''} from this browser${sync.user ? ' and from your cloud account' : ''}. You can undo for a few seconds.`, 'Delete everything'))) return
            const undos = await Promise.all(list.map(p => deleteProject(p.id)))
            toast(`Deleted ${list.length} designs`, { undo: () => { for (const u of undos) void u() } })
          }}>Delete all designs</button>
        </div>
      </div>

      <div className="panel">
        <h2>Keyboard shortcuts</h2>
        <dl className="shortcuts">
          <div><dt><kbd>1</kbd>&ndash;<kbd>7</kbd></dt><dd>Switch design sections</dd></div>
          <div><dt><kbd>S</kbd></dt><dd>Save the current analysis as a run</dd></div>
          <div><dt><kbd>P</kbd></dt><dd>Printable closure report</dd></div>
          <div><dt><kbd>/</kbd></dt><dd>Search paths</dd></div>
          <div><dt><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd> <kbd>S</kbd></dt><dd>Save constraints in the SDC editor</dd></div>
          <div><dt><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>Undo the last delete or applied fix</dd></div>
          <div><dt><kbd>?</kbd></dt><dd>Show shortcuts on a design page</dd></div>
        </dl>
      </div>
    </section>
  )
}
