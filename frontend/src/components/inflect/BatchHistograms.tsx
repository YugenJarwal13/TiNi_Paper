/**
 * Histograms — a section of its own, beside the plots (which are untouched).
 *
 * Nothing is drawn until the reader asks. Two questions, each behind a prompt:
 *
 *   1. Each file: four histograms of that file's own full-resolution data.
 *   2. All files together: one number per file (peak value, peak position,
 *      step size, transition position) histogrammed across the files.
 *
 * Each can be shown as counts or normalized (density, so the bars have unit
 * area) by answering the second prompt. Files that cannot be compared (other
 * variables or units) are never pooled into one cross-file histogram.
 */

import { useState } from 'react'
import { batchHistograms, type BatchFileRecord, type CrossMeasure, type FileHistograms, type HistogramData } from '../../api/inflect'
import { niceTicks, tick } from '../ui'
import { useFetched } from './batchUtils'

const PAGE = 3
const CROSS_COLOR = '#2f3a63'

// ------------------------------------------------------------------ prompts
function Prompt({ question, on, onLabel, offLabel, onToggle, compact = false }: {
  question: string
  on: boolean
  onLabel: string
  offLabel: string
  onToggle: () => void
  compact?: boolean
}) {
  return (
    <div className={`bh-prompt ${compact ? 'bh-prompt--compact' : ''} ${on ? 'is-on' : ''}`}>
      <p className="bh-prompt__q">{question}</p>
      <button className={`btn ${on ? 'btn--quiet' : 'btn--primary'}`} aria-pressed={on} onClick={onToggle}>
        {on ? onLabel : offLabel}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- histogram
function Histogram({ h, color, xLabel, title, hint, normalized }: {
  h: HistogramData | null
  color: string
  xLabel: string
  title: string
  hint?: string
  normalized: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 420, H = 190
  const P = { l: 46, r: 10, t: 8, b: 36 }

  if (!h) {
    return (
      <figure className="bh-chart">
        <figcaption className="bh-chart__title">{title}</figcaption>
        <p className="bh-chart__empty">Not enough values to draw this.</p>
      </figure>
    )
  }

  const total = h.counts.reduce((a, b) => a + b, 0) || 1
  const e = h.edges
  // normalized = density: bar area is the fraction of values, so the bars sum to one.
  // A single identical value has no width to take a density over, so it is shown as a fraction.
  const heights = h.counts.map((c, i) => (h.constant ? (normalized ? 1 : c) : normalized ? c / (total * (e[i + 1] - e[i])) : c))
  const ymax = Math.max(...heights, 1e-12) * 1.1
  // A single identical value is drawn as one narrow bar in the middle, not stretched across the axis.
  const half = (e[e.length - 1] - e[0]) / 2
  const x0 = h.constant ? e[0] - 3 * half : e[0]
  const x1 = h.constant ? e[e.length - 1] + 3 * half : e[e.length - 1]
  const sx = (v: number) => P.l + ((v - x0) / (x1 - x0 || 1)) * (W - P.l - P.r)
  const sy = (v: number) => H - P.b - (v / ymax) * (H - P.t - P.b)
  const yTicks = niceTicks(0, ymax, 4)
  // niceTicks can return -1e-17 for zero; snap anything negligible against the span to 0
  const xTicks = h.constant ? [h.value ?? e[0]] : niceTicks(x0, x1, 4).map((t) => (Math.abs(t) < (x1 - x0) * 1e-9 ? 0 : t))
  const yLabel = normalized ? (h.constant ? 'fraction' : 'density') : 'count'

  const tip = hover === null ? null : (() => {
    const lo = e[hover], hi = e[hover + 1]
    const v = heights[hover]
    return {
      left: ((sx(lo) + sx(hi)) / 2 / W) * 100,
      top: (sy(v) / H) * 100,
      text: h.constant ? `all values = ${tick(h.value ?? lo)}` : `${tick(lo)} to ${tick(hi)}`,
      value: `${h.counts[hover]} value${h.counts[hover] === 1 ? '' : 's'}${normalized && !h.constant ? ` · density ${tick(v)}` : ''}`,
    }
  })()

  return (
    <figure className="bh-chart">
      <figcaption className="bh-chart__title">
        {title}
        {hint && <span>{hint}</span>}
      </figcaption>
      <div className="bh-chart__box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: histogram of ${xLabel}`} onPointerLeave={() => setHover(null)}>
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={P.l} x2={W - P.r} y1={sy(t)} y2={sy(t)} className="bh-chart__grid" />
              <text x={P.l - 6} y={sy(t) + 3} textAnchor="end" className="bh-chart__tick">{tick(t)}</text>
            </g>
          ))}
          {h.counts.map((c, i) => {
            const bx = sx(e[i]), bw = Math.max(1, sx(e[i + 1]) - sx(e[i]) - 1)
            return (
              <g key={i}>
                <rect x={bx + 0.5} y={sy(heights[i])} width={bw} height={Math.max(0, H - P.b - sy(heights[i]))} fill={color}
                  fillOpacity={hover === i ? 1 : 0.78} rx={1.5} />
                <rect x={bx} y={P.t} width={bw + 1} height={H - P.t - P.b} fill="transparent" onPointerEnter={() => setHover(i)}>
                  <title>{`${tick(e[i])} to ${tick(e[i + 1])}: ${c}`}</title>
                </rect>
              </g>
            )
          })}
          <line x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} className="bh-chart__axis" />
          {xTicks.map((t) => (
            <text key={`x${t}`} x={sx(t)} y={H - P.b + 14} textAnchor="middle" className="bh-chart__tick">{tick(t)}</text>
          ))}
          <text x={(P.l + W - P.r) / 2} y={H - 4} textAnchor="middle" className="bh-chart__label">{xLabel}</text>
          <text x={11} y={(P.t + H - P.b) / 2} textAnchor="middle" className="bh-chart__label" transform={`rotate(-90 11 ${(P.t + H - P.b) / 2})`}>{yLabel}</text>
        </svg>
        {tip && (
          <div className="bh-chart__tip num" style={{ left: `${tip.left}%`, top: `${tip.top}%` }}>
            <b>{tip.text}</b>
            <div>{tip.value}</div>
          </div>
        )}
      </div>
      <div className="bh-chart__note num">
        n = {h.n_total.toLocaleString()}
        {!h.constant && <> · median {tick(h.median)}</>}
        {h.constant && <> · every value equal</>}
        {h.n_outside > 0 && <> · {h.n_outside} beyond the drawn range</>}
      </div>
    </figure>
  )
}

const unit = (name: string, u: string | null) => (u ? `${name} [${u}]` : name)

// --------------------------------------------------------------- each file
function FileCard({ f, color, normalized }: { f: FileHistograms; color: string; normalized: boolean }) {
  const c = f.columns
  const h = f.histograms
  return (
    <article className="bh-file">
      <header className="bh-file__head">
        <i style={{ background: color }} />
        <h4 title={f.relative_path}>{f.relative_path}</h4>
      </header>
      {!c || !h ? (
        <p className="bh-chart__empty">
          {f.stale ? 'This file was analysed by an older version. Resume the analysis to compute its histograms.' : 'No histograms: this file has no completed analysis.'}
        </p>
      ) : (
        <div className="bh-grid">
          <Histogram h={h.values} color={color} normalized={normalized} title="Values" hint={c.y} xLabel={unit(c.y, c.y_unit)} />
          <Histogram h={h.increments} color={color} normalized={normalized} title="Change between points" hint={`Δ ${c.y}`} xLabel={`Δ ${unit(c.y, c.y_unit)}`} />
          <Histogram h={h.residuals} color={color} normalized={normalized} title="Residuals around the fit" hint="noise" xLabel={`residual ${unit(c.y, c.y_unit)}`} />
          <Histogram h={h.spacing} color={color} normalized={normalized} title="Spacing of the axis" hint={`Δ ${c.x}`} xLabel={`Δ ${unit(c.x, c.x_unit)}`} />
        </div>
      )}
    </article>
  )
}

function EachFile({ batchId, files, colorOf, version }: { batchId: string; files: BatchFileRecord[]; colorOf: (id: string) => string; version: number }) {
  const [shown, setShown] = useState(false)
  const [normalized, setNormalized] = useState(false)
  const [page, setPage] = useState(0)

  const done = files.filter((f) => f.status === 'completed')
  const pages = Math.max(1, Math.ceil(done.length / PAGE))
  const cur = Math.min(page, pages - 1)
  const ids = done.slice(cur * PAGE, cur * PAGE + PAGE).map((f) => f.file_id)
  const { data, error, loading } = useFetched(`${batchId}|${ids.join(',')}|${version}`, () => batchHistograms.files(batchId, ids), { enabled: shown && ids.length > 0 })
  const skipped = files.length - done.length

  return (
    <section className="bh-block" aria-label="histograms for each file">
      <header className="bh-block__head">
        <h3>Each file</h3>
        <p>Four histograms per file, from its own data.</p>
      </header>
      {done.length === 0 ? (
        <p className="bh-chart__empty">No file has a completed analysis yet.</p>
      ) : (
        <>
          <Prompt question="Do you want to see the histogram for this?" on={shown} onLabel="Hide" offLabel="Show" onToggle={() => setShown(!shown)} />
          {shown && (
            <div className="bh-open">
              <Prompt compact question="Do you want to see normalized histogram for this?" on={normalized}
                onLabel="Back to counts" offLabel="Normalize" onToggle={() => setNormalized(!normalized)} />
              {error && <p className="intake__error">{error}</p>}
              {!data && loading && <p className="conf__waiting">Computing histograms…</p>}
              {data?.files.map((f) => <FileCard key={f.file_id} f={f} color={colorOf(f.file_id)} normalized={normalized} />)}
              {pages > 1 && (
                <div className="bp__pager">
                  <button className="btn btn--quiet" disabled={cur === 0} onClick={() => setPage(cur - 1)}>← previous</button>
                  <span className="num">files {cur * PAGE + 1}–{Math.min(done.length, cur * PAGE + PAGE)} of {done.length}</span>
                  <button className="btn btn--quiet" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>next →</button>
                </div>
              )}
              {skipped > 0 && <p className="bh-foot">{skipped} file{skipped === 1 ? '' : 's'} failed or {skipped === 1 ? 'was' : 'were'} skipped and {skipped === 1 ? 'has' : 'have'} no histograms.</p>}
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ------------------------------------------------------------- cross-file
function CrossCard({ m, normalized }: { m: CrossMeasure; normalized: boolean }) {
  return (
    <div>
      <Histogram h={m.histogram} color={CROSS_COLOR} normalized={normalized} title={m.label} hint={m.key === 'peak_value' ? 'critical force' : m.key === 'peak_position' ? 'snap time' : undefined} xLabel={m.axis} />
      <p className="bh-chart__sub">
        {m.subtitle}
        {m.n_without > 0 && <> · {m.n_without} file{m.n_without === 1 ? '' : 's'} without a step left out</>}
        {!m.histogram && m.n_values < 2 && <> · needs at least two files with a value</>}
      </p>
    </div>
  )
}

function CrossFile({ batchId, files, version }: { batchId: string; files: BatchFileRecord[]; version: number }) {
  const [shown, setShown] = useState(false)
  const [normalized, setNormalized] = useState(false)
  const [group, setGroup] = useState<string | undefined>(undefined)
  const nDone = files.filter((f) => f.status === 'completed').length
  const { data, error, loading } = useFetched(`${batchId}|${group ?? ''}|${version}`, () => batchHistograms.cross(batchId, group), { enabled: shown, keepPrevious: true })

  return (
    <section className="bh-block" aria-label="histograms across files">
      <header className="bh-block__head">
        <h3>All files together</h3>
        <p>One number per file — critical force, snap time, step size, transition position — across the files.</p>
      </header>
      {nDone < 2 ? (
        <p className="bh-chart__empty">A cross-file histogram needs at least two analysed files; {nDone === 1 ? 'one is' : 'none are'} ready.</p>
      ) : (
        <>
          <Prompt question="Do you want to see the histogram for this?" on={shown} onLabel="Hide" offLabel="Show" onToggle={() => setShown(!shown)} />
          {shown && (
            <div className="bh-open">
              <div className="bh-tools">
                <Prompt compact question="Do you want to see normalized histogram for this?" on={normalized}
                  onLabel="Back to counts" offLabel="Normalize" onToggle={() => setNormalized(!normalized)} />
                {data && data.groups.length > 1 && (
                  <label className="bp__group">
                    comparison group
                    <select value={data.group ?? ''} onChange={(e) => setGroup(e.target.value)}>
                      {data.groups.map((g) => (
                        <option key={g.key} value={g.key}>{unit(g.y, g.y_unit)} vs {unit(g.x, g.x_unit)} — {g.count} file{g.count === 1 ? '' : 's'}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {error && <p className="intake__error">{error}</p>}
              {!data && loading && <p className="conf__waiting">Computing histograms…</p>}
              {data?.incompatible_explanation && <p className="bp__warn">{data.incompatible_explanation}</p>}
              {data && data.n_stale > 0 && <p className="bp__warn">{data.n_stale} file{data.n_stale === 1 ? ' was' : 's were'} analysed by an older version and {data.n_stale === 1 ? 'is' : 'are'} left out. Resume the analysis to include {data.n_stale === 1 ? 'it' : 'them'}.</p>}
              {data && (
                <>
                  <p className="bh-foot">{data.n_in_group} file{data.n_in_group === 1 ? '' : 's'} in this group.</p>
                  <div className="bh-grid">{data.measures.map((m) => <CrossCard key={m.key} m={m} normalized={normalized} />)}</div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

// -------------------------------------------------------------------- tab
export function BatchHistograms({ batchId, files, colorOf, version }: { batchId: string; files: BatchFileRecord[]; colorOf: (id: string) => string; version: number }) {
  return (
    <div className="bh">
      <EachFile batchId={batchId} files={files} colorOf={colorOf} version={version} />
      <CrossFile batchId={batchId} files={files} version={version} />
    </div>
  )
}
