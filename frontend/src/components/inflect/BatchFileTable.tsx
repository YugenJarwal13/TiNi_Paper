/** Every file in the batch: searchable, sortable, filterable and paged. */

import { useMemo, useState } from 'react'
import type { BatchFileRecord, BatchFileStatus } from '../../api/inflect'
import { tick } from '../ui'
import { formatBytes } from './batchUtils'

type SortKey = 'name' | 'status' | 'transitions' | 'points' | 'onset' | 'magnitude' | 'noise'
const PAGE = 25
const ORDER: Record<BatchFileStatus, number> = { failed: 0, analysing: 1, parsing: 2, queued: 3, completed: 4, skipped: 5 }

function sortValue(f: BatchFileRecord, k: SortKey): string | number {
  switch (k) {
    case 'name': return f.relative_path.toLowerCase()
    case 'status': return ORDER[f.status]
    case 'transitions': return f.n_transitions ?? -1
    case 'points': return f.digest?.point_count ?? -1
    case 'onset': return f.digest?.primary_onset_x ?? -Infinity
    case 'magnitude': return Math.abs(f.digest?.primary_magnitude ?? -Infinity)
    case 'noise': return f.digest?.noise ?? -1
  }
}

export function BatchFileTable({
  files, selected, onSelect, colorOf,
}: {
  files: BatchFileRecord[]
  selected: string | null
  onSelect: (fileId: string) => void
  colorOf: (fileId: string) => string
}) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | BatchFileStatus>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  const [page, setPage] = useState(0)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out = files.filter((f) => (status === 'all' || f.status === status) && (!needle || f.relative_path.toLowerCase().includes(needle)))
    out.sort((a, b) => {
      const x = sortValue(a, sort.key), y = sortValue(b, sort.key)
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
    })
    return out
  }, [files, q, status, sort])

  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const cur = Math.min(page, pages - 1)
  const slice = rows.slice(cur * PAGE, cur * PAGE + PAGE)
  const head = (k: SortKey, label: string, numeric = false) => (
    <th aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={numeric ? 'is-num' : ''}>
      <button className="bf__sort" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label}{sort.key === k ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  )
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: files.length }
    for (const f of files) c[f.status] = (c[f.status] ?? 0) + 1
    return c
  }, [files])

  return (
    <div className="bf">
      <div className="bf__bar">
        <input type="search" placeholder="search by file name" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} aria-label="search files" />
        <div className="seg" role="tablist">
          {(['all', 'completed', 'failed', 'skipped'] as const).map((s) => (
            <button key={s} role="tab" aria-selected={status === s} className={`seg__btn ${status === s ? 'is-on' : ''}`} onClick={() => { setStatus(s); setPage(0) }}>
              {s} <span className="num">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="table-wrap">
        <table className="bf__table">
          <thead>
            <tr>
              {head('name', 'file')}{head('status', 'status')}{head('points', 'points', true)}{head('transitions', 'events', true)}
              {head('onset', 'main onset', true)}{head('magnitude', 'magnitude', true)}{head('noise', 'noise', true)}
              <th>notes</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((f) => (
              <tr key={f.file_id} className={`${selected === f.file_id ? 'is-on' : ''} bf__row`} onClick={() => onSelect(f.file_id)} tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') onSelect(f.file_id) }}>
                <td><i className="bp__dot" style={{ background: colorOf(f.file_id) }} /><span className="bf__name" title={f.relative_path}>{f.relative_path}</span>
                  <small className="num"> {formatBytes(f.size_bytes)}</small></td>
                <td><span className={`bf__status bf__status--${f.status}`}>{f.message && f.status !== 'completed' ? `${f.status} — ${f.message}` : f.status}</span></td>
                <td className="is-num num">{f.digest ? f.digest.point_count.toLocaleString() : '—'}</td>
                <td className="is-num num">{f.n_transitions ?? '—'}</td>
                <td className="is-num num">{f.digest?.primary_onset_x != null ? tick(f.digest.primary_onset_x) : '—'}</td>
                <td className="is-num num">{f.digest?.primary_magnitude != null ? tick(f.digest.primary_magnitude) : '—'}</td>
                <td className="is-num num">{f.digest?.noise != null ? tick(f.digest.noise) : '—'}</td>
                <td className="bf__notes">
                  {f.error ?? ''}
                  {f.duplicate_of && !f.error ? `same content as ${f.duplicate_of}` : ''}
                  {f.n_warnings ? <span className="bf__warn"> {f.n_warnings} warning{f.n_warnings === 1 ? '' : 's'}</span> : null}
                </td>
              </tr>
            ))}
            {slice.length === 0 && <tr><td colSpan={8} className="bp__empty">No file matches.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="bp__pager">
        <button className="btn btn--quiet" disabled={cur === 0} onClick={() => setPage(cur - 1)}>← previous</button>
        <span className="num">{rows.length} file{rows.length === 1 ? '' : 's'} · page {cur + 1} / {pages}</span>
        <button className="btn btn--quiet" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>next →</button>
      </div>
    </div>
  )
}
