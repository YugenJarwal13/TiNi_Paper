/** One file's complete analysis, with the batch still one click away. */

import { Fragment, useState } from 'react'
import { batches, type BatchFileRecord, type FileAnalysis } from '../../api/inflect'
import { tick } from '../ui'
import { LineChart, type Marker } from './BatchPlots'
import { TYPE_LABEL, useFetched } from './batchUtils'

const FEATURE_GROUPS: { title: string; keys: [string, string][] }[] = [
  { title: 'Statistics', keys: [['point_count', 'rows read'], ['valid_row_count', 'rows used'], ['invalid_value_count', 'rows excluded'], ['x_min', 'x min'], ['x_max', 'x max'], ['y_min', 'y min'], ['y_max', 'y max'], ['mean', 'mean'], ['median', 'median'], ['std', 'std'], ['p05', '5th percentile'], ['p25', '25th percentile'], ['p75', '75th percentile'], ['p95', '95th percentile'], ['range', 'range']] },
  { title: 'Shape', keys: [['initial_slope', 'initial slope'], ['final_slope', 'final slope'], ['maximum_slope', 'maximum slope'], ['minimum_slope', 'minimum slope'], ['max_abs_curvature', 'largest curvature'], ['local_slope_changes', 'knees'], ['n_regimes', 'regimes'], ['shape', 'shape']] },
  { title: 'Noise', keys: [['noise', 'noise (from second differences)'], ['residual_std', 'residual std'], ['residual_mad_sigma', 'residual MAD (σ)'], ['residual_max_abs', 'largest residual']] },
  { title: 'Events', keys: [['transition_count', 'events'], ['step_count', 'steps'], ['knee_count', 'knees'], ['peak_count', 'peaks'], ['valley_count', 'valleys']] },
]

const show = (v: unknown): string => {
  if (v === null || v === undefined) return 'not applicable'
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : tick(v)
  return String(v)
}

export function BatchFileDetail({
  batchId, file, version, onClose, onStep,
}: {
  batchId: string
  file: BatchFileRecord
  version: number
  onClose: () => void
  onStep: (dir: -1 | 1) => void
}) {
  const [evt, setEvt] = useState<string | null>(null)
  const { data, error } = useFetched(`${batchId}|${file.file_id}|${file.status}|${version}`, () => batches.file(batchId, file.file_id))
  const a: FileAnalysis | null = data?.analysis ?? null

  const ok = a && a.status === 'completed'
  const markers: Marker[] = ok ? a.transitions.map((t) => ({
    seriesId: 'f', kind: t.type, x: t.onset_x, y: t.onset_y, x2: t.settled_x, y2: t.settled_y,
    label: `${t.event_id} ${t.type}`, color: evt === t.event_id ? '#15161d' : t.type === 'step' ? '#b5462a' : t.type === 'knee' ? '#2f3a63' : t.type === 'peak' ? '#4f7360' : '#b98a2a',
  })) : []
  const unit = (n: string, u: string | null) => (u ? `${n} [${u}]` : n)

  return (
    <section className="bd" aria-label={`analysis of ${file.relative_path}`}>
      <header className="bd__head">
        <div>
          <h3 className="bd__title">{file.relative_path}</h3>
          <p className="bd__meta num">{file.file_id} · {file.status} · sha256 {file.sha256?.slice(0, 12) ?? '—'}…</p>
        </div>
        <div className="bd__nav">
          <button className="btn btn--quiet" onClick={() => onStep(-1)}>← previous file</button>
          <button className="btn btn--quiet" onClick={() => onStep(1)}>next file →</button>
          <button className="btn btn--quiet" onClick={onClose}>close</button>
        </div>
      </header>
      {error && <p className="intake__error">{error}</p>}
      {!a && !error && <p className="conf__waiting">Loading…</p>}
      {a && !ok && (
        <p className="bd__fail"><b>{a.error_kind ?? 'failed'}:</b> {a.error ?? file.error}</p>
      )}
      {!a && file.status === 'skipped' && <p className="bd__fail">Skipped: {file.error}</p>}
      {ok && (
        <>
          <LineChart height={300} series={[{ id: 'f', name: a.filename, color: '#7c8199', x: a.curve.x, y: a.curve.y }]} markers={markers}
            xLabel={unit(a.columns.x, a.columns.x_unit)} yLabel={unit(a.columns.y, a.columns.y_unit)} />
          <p className="bp__hint">{a.curve.note}. Selected by {a.columns.chosen_by}: {a.columns.headline}.</p>

          {a.warnings.length > 0 && (
            <ul className="bd__warnings">{a.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}

          <h4 className="bd__h">Events <span className="num">({a.transitions.length})</span></h4>
          <p className="bd__lede">Detections by {a.detector_selection.mode === 'auto' ? 'the automatic selector' : 'your chosen detectors'} ({a.detector_selection.enabled.join(', ') || 'none'}). Each is an algorithmic detection; none is interpreted as a physical transition.</p>
          {a.transitions.length === 0 ? <p className="bp__empty">No event detected. This is a successful analysis.</p> : (
            <div className="table-wrap">
              <table className="bp__table">
                <thead><tr><th>#</th><th>type</th><th>direction</th><th>onset x</th><th>onset y</th><th>settled x</th><th>settled y</th><th>magnitude</th><th>confidence</th></tr></thead>
                <tbody>
                  {a.transitions.map((t) => (
                    <Fragment key={t.event_id}>
                      <tr className={`bf__row ${evt === t.event_id ? 'is-on' : ''}`} onClick={() => setEvt(evt === t.event_id ? null : t.event_id)}>
                        <td className="num">{t.event_number}</td><td>{TYPE_LABEL[t.type]}</td><td>{t.direction.replace('_', ' ')}</td>
                        <td className="num">{tick(t.onset_x)}</td><td className="num">{tick(t.onset_y)}</td>
                        <td className="num">{t.settled_x == null ? '—' : tick(t.settled_x)}</td><td className="num">{t.settled_y == null ? '—' : tick(t.settled_y)}</td>
                        <td className="num">{tick(t.magnitude)}</td>
                        <td className="num" title={t.confidence?.interpretation ?? t.reliability}>{t.confidence ? `${Math.round(t.confidence.detection_rate * 100)} % detected${t.confidence.position_ci ? `, ${tick(t.confidence.position_ci[0])}–${tick(t.confidence.position_ci[1])}${t.confidence.estimate_inside_ci ? '' : ' (offset from estimate)'}` : ''}` : t.reliability ?? 'not computed'}</td>
                      </tr>
                      {evt === t.event_id && (
                        <tr><td colSpan={9} className="bd__evidence">
                          <b>{t.method}</b> · settings {JSON.stringify(t.detector_settings)}<br />
                          evidence: {JSON.stringify(t.evidence)}
                        </td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h4 className="bd__h">Regimes <span className="num">({a.regimes.length})</span></h4>
          <div className="table-wrap">
            <table className="bp__table">
              <thead><tr><th>#</th><th>type</th><th>from x</th><th>to x</th><th>points</th><th>slope (start→end)</th><th>R²</th><th>coefficients</th></tr></thead>
              <tbody>
                {a.regimes.map((r) => (
                  <tr key={r.regime_number}>
                    <td className="num">{r.regime_number}</td><td>{r.regime_type}</td><td className="num">{tick(r.start_x)}</td><td className="num">{tick(r.end_x)}</td>
                    <td className="num">{r.points}</td><td className="num">{tick(r.slope_start)} → {tick(r.slope_end)}</td>
                    <td className="num">{r.r2 == null ? '—' : r.r2.toFixed(4)}</td><td className="num" title={r.coefficient_basis}>{r.coefficients.map((c) => tick(c)).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4 className="bd__h">Features</h4>
          <div className="bd__features">
            {FEATURE_GROUPS.map((g) => (
              <dl key={g.title}>
                <dt className="bd__fgroup">{g.title}</dt>
                {g.keys.map(([k, label]) => (
                  <div key={k} className="bd__frow"><dt>{label}</dt><dd className="num">{show(a.features[k])}</dd></div>
                ))}
              </dl>
            ))}
          </div>

          <details className="bd__more">
            <summary>Quality, columns and provenance</summary>
            <dl className="bd__kv">
              <dt>x column</dt><dd>{unit(a.columns.x, a.columns.x_unit)} — {a.columns.x_reasons.join(' · ') || 'chosen by the user'}</dd>
              <dt>y column</dt><dd>{unit(a.columns.y, a.columns.y_unit)} — {a.columns.y_reasons.join(' · ') || 'chosen by the user'}</dd>
              <dt>rows</dt><dd className="num">{a.quality.rows_read} read, {a.quality.rows_used} used, {a.quality.rows_excluded} excluded</dd>
              <dt>x order</dt><dd>{a.quality.x_order}</dd>
              <dt>algorithm</dt><dd className="num">{a.algorithm.version} · code {a.algorithm.code_hash}</dd>
              <dt>settings</dt><dd className="num">{JSON.stringify(a.settings)}</dd>
            </dl>
          </details>

          <details className="bd__more">
            <summary>Findings ledger <span className="num">({a.findings.length})</span></summary>
            <ul className="bd__ledger">
              {a.findings.map((f) => (
                <li key={f.id}><b>{f.label}</b> <span className={`tier tier--${f.tier}`}>{f.tier}</span>{' '}
                  <span className="num">{f.value !== null ? `${tick(f.value)}${f.unit ? ` ${f.unit}` : ''}` : f.text}</span>
                  {f.interval?.ci && <span className="num"> · 95 % [{tick(f.interval.ci[0])}, {tick(f.interval.ci[1])}]</span>}
                </li>
              ))}
            </ul>
          </details>

          <div className="bd__dl">
            <a className="btn btn--quiet" href={batches.filePlotUrl(batchId, file.file_id)} download>plot (PNG)</a>
            <a className="btn btn--quiet" href={batches.fileJsonUrl(batchId, file.file_id)} download>analysis (JSON)</a>
            <a className="btn btn--quiet" href={batches.fileTransitionsUrl(batchId, file.file_id)} download>events (CSV)</a>
          </div>
        </>
      )}
    </section>
  )
}
