/**
 * The results workspace for one batch. It is batch-aware from the top: the
 * summary and the table cover every file, the plots cover every file, and
 * opening one file never loses the rest.
 */

import { useCallback, useMemo, useState } from 'react'
import { batches, type BatchFileRecord, type BatchInfo } from '../../api/inflect'
import { BatchFileDetail } from './BatchFileDetail'
import { BatchFileTable } from './BatchFileTable'
import { BatchPlots } from './BatchPlots'
import { fileColor } from './batchUtils'
import { BatchSummary } from './BatchSummary'

type Tab = 'files' | 'plots' | 'export'

export function BatchResults({
  info, files, onResume, onCancel, onNew, busy,
}: {
  info: BatchInfo
  files: BatchFileRecord[]
  onResume: () => void
  onCancel: () => void
  onNew: () => void
  busy: boolean
}) {
  const [tab, setTab] = useState<Tab>('files')
  const [selected, setSelected] = useState<string | null>(null)

  // File colours are assigned by upload order once, so a file looks the same everywhere.
  const colorIndex = useMemo(() => new Map(files.map((f, i) => [f.file_id, i])), [files])
  const colorOf = useCallback((id: string) => fileColor(colorIndex.get(id) ?? 0), [colorIndex])
  // Plots and detail views refresh as the number of finished files changes.
  const version = info.counts.completed * 1000 + info.counts.failed + info.counts.skipped

  const open = useCallback((id: string) => { setSelected(id); setTab('files') }, [])
  const sel = files.find((f) => f.file_id === selected) ?? null
  const step = (dir: -1 | 1) => {
    if (!sel) return
    const i = files.findIndex((f) => f.file_id === sel.file_id)
    const next = files[(i + dir + files.length) % files.length]
    if (next) setSelected(next.file_id)
  }

  return (
    <div className="br">
      <BatchSummary info={info} onResume={onResume} onCancel={onCancel} busy={busy} />
      <div className="br__tabs">
        <div className="seg" role="tablist">
          {([['files', 'Files'], ['plots', 'Plots'], ['export', 'Export']] as [Tab, string][]).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`seg__btn ${tab === k ? 'is-on' : ''}`} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <button className="btn btn--quiet" onClick={onNew}>new batch</button>
      </div>

      {tab === 'files' && (
        <>
          {sel && <BatchFileDetail batchId={info.id} file={sel} version={version} onClose={() => setSelected(null)} onStep={step} />}
          <BatchFileTable files={files} selected={selected} onSelect={setSelected} colorOf={colorOf} />
        </>
      )}
      {tab === 'plots' && <BatchPlots batchId={info.id} files={files} colorOf={colorOf} onOpenFile={open} version={version} />}
      {tab === 'export' && <ExportPanel info={info} />}
    </div>
  )
}

function ExportPanel({ info }: { info: BatchInfo }) {
  const id = info.id
  const failed = info.counts.failed
  const items: [string, string, string][] = [
    ['Excel workbook', batches.workbookUrl(id), 'Summary, Transitions, Features, Regimes and Quality & Metadata sheets'],
    ['Plots (ZIP)', batches.plotsZipUrl(id), 'one PNG per completed file'],
    ['Batch report', batches.reportUrl(id), 'readable summary in Markdown'],
    ['Summary CSV', batches.csvUrl(id, 'summary'), 'one row per file'],
    ['Transitions CSV', batches.csvUrl(id, 'transitions'), 'one row per detected event'],
    ['Features CSV', batches.csvUrl(id, 'features'), 'all extracted measurements'],
    ['Regimes CSV', batches.csvUrl(id, 'regimes'), 'one row per regime'],
    ['Quality CSV', batches.csvUrl(id, 'quality'), 'warnings, errors, columns, hashes, settings'],
  ]
  return (
    <section className="bx">
      <p className="bp__hint">
        Exports are built from the saved analysis of every file in the batch, not from what is on screen.
        {failed > 0 && <> The {failed} failed file{failed === 1 ? '' : 's'} appear in them with their errors.</>}
        {info.running && <> Analysis is still running: exports include the files finished so far.</>}
      </p>
      <ul className="bx__list">
        {items.map(([label, href, note]) => (
          <li key={label}>
            <a className="btn btn--quiet" href={href} download>{label}</a>
            <span>{note}</span>
          </li>
        ))}
      </ul>
      <p className="bp__hint">Per-file plot, analysis and event downloads are on each file&rsquo;s detail view.</p>
    </section>
  )
}
