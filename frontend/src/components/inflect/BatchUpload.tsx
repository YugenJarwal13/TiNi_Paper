/**
 * Getting many files in: drop them, pick them, or pick a whole folder.
 *
 * Nothing is sent until the reader says so. The queue is the place to look at
 * what is about to be analysed, take out what does not belong, and add more.
 * Folder structure is kept: each file travels with its relative path, so two
 * files called `run.csv` in different folders stay two files.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import type { BatchSettings, BatchSpec } from '../../api/inflect'
import { formatBytes } from './batchUtils'

export type QueueItem = { key: string; file: File; path: string; problem: string | null }

const FALLBACK_EXT = ['.csv', '.tsv', '.dat', '.txt', '.tab', '.asc', '.prn', '.out']

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i).toLowerCase()
}

type FsEntry = {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (ok: (f: File) => void, fail: (e: unknown) => void) => void
  createReader?: () => { readEntries: (ok: (e: FsEntry[]) => void, fail: (e: unknown) => void) => void }
}

/** Every file under a dropped folder, with its path. */
async function walk(entry: FsEntry, prefix: string, out: { file: File; path: string }[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((ok, fail) => entry.file!(ok, fail))
    out.push({ file, path: prefix + entry.name })
  } else if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader()
    // readEntries returns results in pages; keep asking until it is empty.
    for (;;) {
      const batch = await new Promise<FsEntry[]>((ok, fail) => reader.readEntries(ok, fail))
      if (!batch.length) break
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`, out)
    }
  }
}

async function fromDrop(dt: DataTransfer): Promise<{ file: File; path: string }[]> {
  const out: { file: File; path: string }[] = []
  const entries: FsEntry[] = []
  for (const it of Array.from(dt.items ?? [])) {
    const e = (it as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.()
    if (e) entries.push(e)
  }
  if (entries.length) {
    for (const e of entries) await walk(e, '', out)
    return out
  }
  return Array.from(dt.files).map((file) => ({ file, path: file.name }))
}

export function BatchUpload({
  spec,
  busy,
  progress,
  error,
  onStart,
  recent,
  onOpenRecent,
}: {
  spec: BatchSpec | null
  busy: boolean
  progress: number
  error: string | null
  onStart: (items: QueueItem[], settings: Partial<BatchSettings>, title: string) => void
  recent: { id: string; title: string; created_at_iso: string; status: string; total: number; percent: number }[]
  onOpenRecent: (id: string) => void
}) {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [over, setOver] = useState(false)
  const [reading, setReading] = useState(false)
  const [manual, setManual] = useState(false)
  const [detectors, setDetectors] = useState<string[]>(['step', 'knee', 'extrema'])
  const [skipDup, setSkipDup] = useState(false)
  const [uncertainty, setUncertainty] = useState(false)
  const [threshold, setThreshold] = useState(6)
  const [title, setTitle] = useState('')
  const filePicker = useRef<HTMLInputElement>(null)
  const folderPicker = useRef<HTMLInputElement>(null)

  const limits = spec?.limits
  const supported = useMemo(() => new Set(spec?.supported_extensions ?? FALLBACK_EXT), [spec])

  const judge = useCallback(
    (file: File): string | null => {
      if (!supported.has(extOf(file.name))) return `unsupported type ${extOf(file.name) || '(none)'}`
      if (file.size === 0) return 'empty file'
      if (limits && file.size > limits.max_file_bytes) return `larger than ${formatBytes(limits.max_file_bytes)}`
      return null
    },
    [supported, limits],
  )

  const add = useCallback(
    (items: { file: File; path: string }[]) => {
      setQueue((q) => {
        const have = new Set(q.map((i) => i.key))
        const next = [...q]
        for (const it of items) {
          const key = `${it.path}|${it.file.size}|${it.file.lastModified}`
          if (have.has(key)) continue
          have.add(key)
          next.push({ key, file: it.file, path: it.path, problem: judge(it.file) })
        }
        return next
      })
    },
    [judge],
  )

  const totalBytes = queue.reduce((s, i) => s + i.file.size, 0)
  const usable = queue.filter((i) => !i.problem).length
  const tooMany = limits ? queue.length > limits.max_files : false
  const tooBig = limits ? totalBytes > limits.max_total_bytes : false
  const blocked = busy || reading || queue.length === 0 || tooMany || tooBig

  const start = () => {
    const settings: Partial<BatchSettings> = {
      detectors: manual ? detectors : 'auto',
      skip_duplicates: skipDup,
      with_uncertainty: uncertainty,
      event_threshold: threshold,
    }
    onStart(queue, settings, title.trim() || (queue.length === 1 ? queue[0].path : `${queue.length} files`))
  }

  const folderAttrs = { webkitdirectory: '', directory: '' } as Record<string, string>

  return (
    <section className="bu">
      <div
        className={`bu__drop ${over ? 'is-over' : ''} ${busy ? 'is-busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => {
          e.preventDefault()
          setOver(false)
          setReading(true)
          try { add(await fromDrop(e.dataTransfer)) } finally { setReading(false) }
        }}
      >
        <p className="bu__title">{queue.length ? 'Add more files' : 'Drop files or a folder here'}</p>
        <p className="bu__hint">
          Every file is analysed on its own. Accepted: {Array.from(supported).join(' ')}
          {limits && <> · up to {limits.max_files.toLocaleString()} files, {formatBytes(limits.max_file_bytes)} each</>}
        </p>
        <div className="bu__pick">
          <button className="btn btn--quiet" disabled={busy} onClick={() => filePicker.current?.click()}>choose files</button>
          <button className="btn btn--quiet" disabled={busy} onClick={() => folderPicker.current?.click()}>choose a folder</button>
        </div>
        <input
          ref={filePicker} type="file" multiple hidden
          onChange={(e) => { add(Array.from(e.target.files ?? []).map((file) => ({ file, path: file.name }))); e.target.value = '' }}
        />
        <input
          ref={folderPicker} type="file" multiple hidden {...folderAttrs}
          onChange={(e) => {
            add(Array.from(e.target.files ?? []).map((file) => ({ file, path: file.webkitRelativePath || file.name })))
            e.target.value = ''
          }}
        />
      </div>

      {queue.length > 0 && (
        <div className="bu__queue">
          <div className="bu__head">
            <b className="num">{queue.length}</b> file{queue.length === 1 ? '' : 's'} · <b className="num">{formatBytes(totalBytes)}</b>
            {queue.length - usable > 0 && <span className="bu__flag"> · {queue.length - usable} will be skipped or fail</span>}
            <button className="btn btn--quiet btn--tiny" onClick={() => setQueue([])} disabled={busy}>clear</button>
          </div>
          {(tooMany || tooBig) && (
            <p className="intake__error">
              {tooMany && limits ? `Too many files: the limit is ${limits.max_files}. ` : ''}
              {tooBig && limits ? `Too large in total: the limit is ${formatBytes(limits.max_total_bytes)}.` : ''}
            </p>
          )}
          <ul className="bu__list" aria-label="upload queue">
            {queue.slice(0, 300).map((q) => (
              <li key={q.key} className={`bu__item ${q.problem ? 'is-bad' : ''}`}>
                <span className="bu__name" title={q.path}>{q.path}</span>
                <span className="bu__ext num">{extOf(q.file.name) || '—'}</span>
                <span className="bu__size num">{formatBytes(q.file.size)}</span>
                <span className={`bu__state ${q.problem ? 'is-bad' : 'is-ok'}`}>{q.problem ?? 'ready'}</span>
                <button className="bu__x" aria-label={`remove ${q.path}`} disabled={busy}
                  onClick={() => setQueue((all) => all.filter((i) => i.key !== q.key))}>×</button>
              </li>
            ))}
          </ul>
          {queue.length > 300 && <p className="bu__hint">Showing the first 300 of {queue.length}; the rest are queued too.</p>}
        </div>
      )}

      <details className="bu__opts">
        <summary>Detection settings</summary>
        <div className="bu__optgrid">
          <label className="bu__check">
            <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />
            choose detectors myself <span>(otherwise all three run and each reports zero or more events)</span>
          </label>
          {manual && (
            <div className="bu__dets">
              {[['step', 'steps (sudden jumps and drops)'], ['knee', 'knees (slope changes)'], ['extrema', 'peaks and valleys']].map(([k, label]) => (
                <label key={k} className="bu__check">
                  <input type="checkbox" checked={detectors.includes(k)}
                    onChange={(e) => setDetectors((d) => (e.target.checked ? [...d, k] : d.filter((v) => v !== k)))} />
                  {label}
                </label>
              ))}
            </div>
          )}
          <label className="bu__check">
            <input type="checkbox" checked={skipDup} onChange={(e) => setSkipDup(e.target.checked)} />
            skip files whose content is identical to an earlier file
          </label>
          <label className="bu__check">
            <input type="checkbox" checked={uncertainty} onChange={(e) => setUncertainty(e.target.checked)} />
            bootstrap each file for confidence intervals <span>(slower; otherwise no confidence is reported)</span>
          </label>
          <label className="bu__num">
            step detector threshold
            <input type="number" min={2} max={30} step={0.5} value={threshold} onChange={(e) => setThreshold(Number(e.target.value) || 6)} />
          </label>
          <label className="bu__num">
            batch name
            <input type="text" value={title} placeholder="optional" onChange={(e) => setTitle(e.target.value)} />
          </label>
        </div>
      </details>

      {error && <p className="intake__error">{error}</p>}
      <div className="bu__go">
        <button className="btn btn--primary" disabled={blocked} onClick={start}>
          {busy ? (progress > 0 && progress < 1 ? `Uploading… ${Math.round(progress * 100)} %` : 'Starting…') : `Analyse ${queue.length || ''} file${queue.length === 1 ? '' : 's'}`}
        </button>
        {busy && progress > 0 && <div className="drop__bar"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
      </div>

      {recent.length > 0 && queue.length === 0 && (
        <div className="bu__recent">
          <h3 className="intake__eyebrow">Earlier batches</h3>
          <ul>
            {recent.slice(0, 8).map((b) => (
              <li key={b.id}>
                <button className="btn btn--quiet" onClick={() => onOpenRecent(b.id)}>
                  {b.title} <span className="num">· {b.total} files · {b.status.replace(/_/g, ' ')}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
