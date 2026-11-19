/** The batch at a glance: how many files, how they ended, how far along. */

import type { BatchInfo } from '../../api/inflect'
import { formatBytes } from './batchUtils'

const STATUS_TEXT: Record<BatchInfo['status'], string> = {
  created: 'created — not started',
  processing: 'processing',
  completed: 'completed',
  completed_with_errors: 'completed with errors',
  failed: 'failed',
}

export function BatchSummary({
  info, onResume, onCancel, busy,
}: {
  info: BatchInfo
  onResume: () => void
  onCancel: () => void
  busy: boolean
}) {
  const c = info.counts
  const pending = c.queued + c.parsing + c.analysing
  const cards: [string, number, string][] = [
    ['uploaded', info.total, ''],
    ['completed', c.completed, 'ok'],
    ['failed', c.failed, c.failed ? 'bad' : ''],
    ['skipped', c.skipped, ''],
    ['changes detected', info.total_transitions, ''],
  ]
  return (
    <section className="bs" aria-label="batch summary">
      <header className="bs__head">
        <div>
          <h2 className="bs__title">{info.title}</h2>
          <p className="bs__meta num">
            batch {info.id} · {formatBytes(info.total_size_bytes)} · status <b className={`bs__status bs__status--${info.status}`}>{STATUS_TEXT[info.status]}</b>
          </p>
        </div>
        <div className="bs__actions">
          {info.running ? (
            <button className="btn btn--quiet" onClick={onCancel}>stop after current files</button>
          ) : pending > 0 || info.status === 'created' ? (
            <button className="btn btn--primary" disabled={busy} onClick={onResume}>{info.status === 'created' ? 'start analysis' : 'resume analysis'}</button>
          ) : null}
        </div>
      </header>
      <div className="bs__cards">
        {cards.map(([label, n, tone]) => (
          <div key={label} className={`bs__card ${tone ? `bs__card--${tone}` : ''}`}>
            <div className="bs__n num">{n.toLocaleString()}</div>
            <div className="bs__l">{label}</div>
          </div>
        ))}
      </div>
      <div className="bs__bar" role="progressbar" aria-valuenow={Math.round(info.percent)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${info.percent}%` }} />
      </div>
      <p className="bs__foot num">
        {info.finished} of {info.total} files finished ({Math.round(info.percent)} %)
        {pending > 0 && <> · {c.parsing + c.analysing} in progress, {c.queued} waiting</>}
        {info.n_duplicates > 0 && <> · {info.n_duplicates} with content identical to an earlier file</>}
      </p>
      <p className="bs__note">
        Changes are algorithmic detections — steps, knees, peaks and valleys — not claims about physical transitions; reading one as a phase change is the researcher&rsquo;s call.
      </p>
    </section>
  )
}
