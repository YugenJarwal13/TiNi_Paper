/**
 * Plots for a whole batch: all curves together, each curve on its own axes,
 * the detected events compared across files, and the cohort.
 *
 * Curves arrive thinned for drawing (extremes kept); every number shown comes
 * from the full-resolution analysis. Curves are only ever overlaid when they
 * share variables and units; otherwise the page says why and offers the
 * individual plots instead.
 */

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { batches, type BatchFileRecord, type BatchPlots as PlotData, type PlotCurve, type PlotTransition } from '../../api/inflect'
import { niceTicks, tick } from '../ui'
import { Chorus } from './Chorus'
import { TYPE_COLOR, useFetched } from './batchUtils'


// ------------------------------------------------------------- line chart
export type Series = { id: string; name: string; color: string; x: number[]; y: number[] }
export type Marker = { seriesId: string; kind: string; x: number; y: number; x2?: number | null; y2?: number | null; label: string; color: string }

type View = { x0: number; x1: number; y0: number; y1: number }
const W = 860
const PAD = { t: 10, r: 14, b: 34, l: 58 }

/** The index of the first x >= v in a sorted array. */
function lowerBound(a: number[], v: number): number {
  let lo = 0, hi = a.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (a[m] < v) lo = m + 1
    else hi = m
  }
  return lo
}

export function LineChart({
  series, markers = [], xLabel, yLabel, height = 360, interactive = true, onPick,
}: {
  series: Series[]
  markers?: Marker[]
  xLabel: string
  yLabel: string
  height?: number
  interactive?: boolean
  onPick?: (seriesId: string) => void
}) {
  const H = height
  const full = useMemo<View>(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const s of series) {
      for (let i = 0; i < s.x.length; i++) {
        const x = s.x[i], y = s.y[i]
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    if (!isFinite(x0)) return { x0: 0, x1: 1, y0: 0, y1: 1 }
    const px = (x1 - x0) * 0.02 || 1
    const py = (y1 - y0) * 0.06 || 1
    return { x0: x0 - px, x1: x1 + px, y0: y0 - py, y1: y1 + py }
  }, [series])

  // The zoom belongs to the data extent it was made for; new data drops it without an effect.
  const [zoom, setZoom] = useState<{ for: View; view: View | null }>({ for: full, view: null })
  const view = zoom.for === full ? zoom.view : null
  const setView = useCallback((next: View | null | ((cur: View | null) => View | null)) => {
    setZoom((z) => {
      const cur = z.for === full ? z.view : null
      return { for: full, view: typeof next === 'function' ? next(cur) : next }
    })
  }, [full])
  const v = view ?? full
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ px: number; py: number; v: View } | null>(null)
  const [hover, setHover] = useState<{ sx: number; sy: number; s: Series; i: number } | null>(null)

  const sx = useCallback((x: number) => PAD.l + ((x - v.x0) / (v.x1 - v.x0)) * (W - PAD.l - PAD.r), [v])
  const sy = useCallback((y: number) => PAD.t + (1 - (y - v.y0) / (v.y1 - v.y0)) * (H - PAD.t - PAD.b), [v, H])

  // Wheel zoom about the cursor. Attached natively: React's own wheel handler is
  // passive and cannot stop the page from scrolling underneath.
  useEffect(() => {
    const el = svg.current
    if (!el || !interactive) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const fx = ((e.clientX - r.left) / r.width * W - PAD.l) / (W - PAD.l - PAD.r)
      const fy = 1 - ((e.clientY - r.top) / r.height * H - PAD.t) / (H - PAD.t - PAD.b)
      const k = e.deltaY < 0 ? 0.8 : 1.25
      setView((cur) => {
        const c = cur ?? full
        const cx = c.x0 + fx * (c.x1 - c.x0)
        const cy = c.y0 + fy * (c.y1 - c.y0)
        return { x0: cx - (cx - c.x0) * k, x1: cx + (c.x1 - cx) * k, y0: cy - (cy - c.y0) * k, y1: cy + (c.y1 - cy) * k }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [full, H, interactive, setView])

  const toData = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect()
    return { px: ((e.clientX - r.left) / r.width) * W, py: ((e.clientY - r.top) / r.height) * H }
  }

  const onMove = (e: React.PointerEvent) => {
    const { px, py } = toData(e)
    if (drag.current) {
      const d = drag.current
      const dx = ((px - d.px) / (W - PAD.l - PAD.r)) * (d.v.x1 - d.v.x0)
      const dy = ((py - d.py) / (H - PAD.t - PAD.b)) * (d.v.y1 - d.v.y0)
      setView({ x0: d.v.x0 - dx, x1: d.v.x1 - dx, y0: d.v.y0 + dy, y1: d.v.y1 + dy })
      return
    }
    // nearest point by on-screen distance, across all series
    const xd = v.x0 + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (v.x1 - v.x0)
    let best: { sx: number; sy: number; s: Series; i: number; d: number } | null = null
    for (const s of series) {
      if (!s.x.length) continue
      const j = lowerBound(s.x, xd)
      for (const i of [j - 1, j]) {
        if (i < 0 || i >= s.x.length) continue
        const ax = sx(s.x[i]), ay = sy(s.y[i])
        const d = (ax - px) ** 2 + (ay - py) ** 2
        if (!best || d < best.d) best = { sx: ax, sy: ay, s, i, d }
      }
    }
    setHover(best && best.d < 40 ** 2 ? best : null)
  }

  const xt = niceTicks(v.x0, v.x1, 6)
  const yt = niceTicks(v.y0, v.y1, 5)

  const paths = useMemo(() => series.map((s) => {
    const a = Math.max(0, lowerBound(s.x, v.x0) - 1)
    const b = Math.min(s.x.length, lowerBound(s.x, v.x1) + 1)
    let d = ''
    for (let i = a; i < b; i++) d += `${i === a ? 'M' : 'L'}${sx(s.x[i]).toFixed(1)} ${sy(s.y[i]).toFixed(1)}`
    return d
  }), [series, v, sx, sy])

  const clip = `clip${useId().replace(/[^A-Za-z0-9]/g, '')}`

  return (
    <div className="bp-chart">
      <svg
        ref={svg} viewBox={`0 0 ${W} ${H}`} className="bp-chart__svg" role="img" aria-label={`${yLabel} against ${xLabel}`}
        onPointerDown={(e) => {
          if (!interactive) return
          const p = toData(e)
          drag.current = { ...p, v }
          ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerMove={onMove}
        onPointerLeave={() => { setHover(null) }}
        onDoubleClick={() => setView(null)}
        onClick={() => { if (hover && onPick && !view) onPick(hover.s.id) }}
        style={{ touchAction: 'none', cursor: interactive ? 'crosshair' : 'default' }}
      >
        <defs><clipPath id={clip}><rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} /></clipPath></defs>
        {yt.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} className="bp-chart__grid" />
            <text x={PAD.l - 6} y={sy(t) + 3} textAnchor="end" className="bp-chart__tick">{tick(t)}</text>
          </g>
        ))}
        {xt.map((t) => (
          <text key={`x${t}`} x={sx(t)} y={H - PAD.b + 14} textAnchor="middle" className="bp-chart__tick">{tick(t)}</text>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="bp-chart__axis" />
        <text x={W - PAD.r} y={H - 4} textAnchor="end" className="bp-chart__label">{xLabel}</text>
        <text x={12} y={PAD.t + 4} className="bp-chart__label" transform={`rotate(-90 12 ${PAD.t + 4})`} textAnchor="end">{yLabel}</text>
        <g clipPath={`url(#${clip})`}>
          {series.map((s, i) => (
            <path key={s.id} d={paths[i]} fill="none" stroke={s.color} strokeWidth={series.length > 40 ? 0.8 : 1.3} strokeOpacity={series.length > 40 ? 0.6 : 0.95} />
          ))}
          {markers.map((m, i) => (
            <g key={i}>
              {m.x2 != null && <rect x={Math.min(sx(m.x), sx(m.x2))} y={PAD.t} width={Math.abs(sx(m.x2) - sx(m.x))} height={H - PAD.t - PAD.b} fill={m.color} fillOpacity={0.09} />}
              <circle cx={sx(m.x)} cy={sy(m.y)} r={4} fill={m.color} stroke="#fff" strokeWidth={1}><title>{`${m.label}: onset`}</title></circle>
              {m.x2 != null && m.y2 != null && <rect x={sx(m.x2) - 3} y={sy(m.y2) - 3} width={6} height={6} fill="#fff" stroke={m.color} strokeWidth={1.4}><title>{`${m.label}: settled`}</title></rect>}
            </g>
          ))}
        </g>
        {hover && (
          <g pointerEvents="none">
            <circle cx={hover.sx} cy={hover.sy} r={4.5} fill="none" stroke={hover.s.color} strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover && (
        <div className="bp-chart__tip num" style={{ left: `${(hover.sx / W) * 100}%`, top: `${(hover.sy / H) * 100}%` }}>
          <b style={{ color: hover.s.color }}>{hover.s.name}</b>
          <div>{xLabel}: {tick(hover.s.x[hover.i])}</div>
          <div>{yLabel}: {tick(hover.s.y[hover.i])}</div>
        </div>
      )}
      {interactive && (
        <button className="btn btn--quiet btn--tiny bp-chart__reset" onClick={() => setView(null)} disabled={!view}>reset view</button>
      )}
    </div>
  )
}

// ----------------------------------------------------------------- helpers
const unitLabel = (name: string | null, unit: string | null) => (name ? (unit ? `${name} [${unit}]` : name) : '')

function mainTransition(c: PlotCurve) {
  return [...c.transitions].sort((a, b) => Math.abs(b.magnitude) - Math.abs(a.magnitude)).find((t) => t.type === 'step') ?? c.transitions[0]
}

// --------------------------------------------------------------- the views
type Mode = 'overlay' | 'grid' | 'compare' | 'cohort'

export function BatchPlots({
  batchId, files, colorOf, onOpenFile, version,
}: {
  batchId: string
  files: BatchFileRecord[]
  colorOf: (fileId: string) => string
  onOpenFile: (fileId: string) => void
  version: number
}) {
  const [mode, setMode] = useState<Mode>('overlay')
  const [group, setGroup] = useState<string | undefined>(undefined)
  const { data, error, loading } = useFetched(`${batchId}|${group ?? ''}|${version}`, () => batches.plots(batchId, group), { keepPrevious: true })

  const modes: [Mode, string][] = [['overlay', 'Overlay'], ['grid', 'Each file'], ['compare', 'Compare events'], ['cohort', 'Cohort']]
  return (
    <section className="bp">
      <div className="bp__bar">
        <div className="seg" role="tablist">
          {modes.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={mode === k} className={`seg__btn ${mode === k ? 'is-on' : ''}`} onClick={() => setMode(k)}>{label}</button>
          ))}
        </div>
        {data && data.groups.length > 1 && mode !== 'grid' && (
          <label className="bp__group">
            comparison group
            <select value={data.group ?? ''} onChange={(e) => setGroup(e.target.value)}>
              {data.groups.map((g) => (
                <option key={g.key} value={g.key}>{unitLabel(g.y, g.y_unit)} vs {unitLabel(g.x, g.x_unit)} — {g.count} file{g.count === 1 ? '' : 's'}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {error && <p className="intake__error">{error}</p>}
      {data && data.incompatible_explanation && mode !== 'grid' && (
        <p className="bp__warn">{data.incompatible_explanation}</p>
      )}
      {!data && loading && <p className="conf__waiting">Loading plots…</p>}
      {data && data.groups.length === 0 && <p className="bp__empty">No file has a completed analysis yet.</p>}
      {data && data.groups.length > 0 && (
        <>
          {mode === 'overlay' && <Overlay key={data.group ?? ''} data={data} colorOf={colorOf} onOpenFile={onOpenFile} />}
          {mode === 'grid' && <Grid batchId={batchId} files={files} colorOf={colorOf} onOpenFile={onOpenFile} version={version} />}
          {mode === 'compare' && <Compare data={data} files={files} colorOf={colorOf} onOpenFile={onOpenFile} />}
          {mode === 'cohort' && <Cohort data={data} />}
          <p className="bp__note">{data.display_note}</p>
        </>
      )}
    </section>
  )
}

// ------------------------------------------------------------------ overlay
function Overlay({ data, colorOf, onOpenFile }: { data: PlotData; colorOf: (id: string) => string; onOpenFile: (id: string) => void }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [align, setAlign] = useState(false)
  const [filter, setFilter] = useState('')

  const shiftOf = useCallback((c: PlotCurve) => (align ? mainTransition(c)?.onset_x ?? null : 0), [align])
  const visible = data.curves.filter((c) => !hidden.has(c.file_id) && shiftOf(c) !== null)
  const series: Series[] = visible.map((c) => {
    const k = shiftOf(c) ?? 0
    return { id: c.file_id, name: c.relative_path || c.filename, color: colorOf(c.file_id), x: c.x.map((x) => x - k), y: c.y }
  })
  const markers: Marker[] = visible.flatMap((c) => {
    const k = shiftOf(c) ?? 0
    return c.transitions.map((t) => ({
      seriesId: c.file_id, kind: t.type, x: t.onset_x - k, y: t.onset_y,
      x2: t.settled_x == null ? null : t.settled_x - k, y2: t.settled_y, label: `${c.filename} ${t.type}`, color: colorOf(c.file_id),
    }))
  })
  const noTransition = align ? data.curves.filter((c) => shiftOf(c) === null).length : 0
  const shown = filter ? data.curves.filter((c) => (c.relative_path || c.filename).toLowerCase().includes(filter.toLowerCase())) : data.curves

  return (
    <div className="bp__overlay">
      <div className="bp__tools">
        <label className="bu__check"><input type="checkbox" checked={align} onChange={(e) => setAlign(e.target.checked)} /> align curves at their transition onset</label>
        <span className="bp__hint">scroll to zoom · drag to pan · double-click to reset · click a curve to open its file</span>
      </div>
      {data.truncated && <p className="bp__warn">Showing the first {data.max_curves} of {data.n_in_selection} curves in this group.</p>}
      {noTransition > 0 && <p className="bp__hint">{noTransition} file{noTransition === 1 ? ' has' : 's have'} no transition to align on and {noTransition === 1 ? 'is' : 'are'} left out of this view.</p>}
      <div className="bp__split">
        <LineChart series={series} markers={markers} xLabel={align ? `${unitLabel(data.x_label, data.x_unit)} − onset` : unitLabel(data.x_label, data.x_unit)}
          yLabel={unitLabel(data.y_label, data.y_unit)} onPick={onOpenFile} />
        <aside className="bp__legend">
          <input type="search" placeholder="filter files" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="filter legend" />
          <div className="bp__legend-actions">
            <button className="btn btn--quiet btn--tiny" onClick={() => setHidden(new Set())}>show all</button>
            <button className="btn btn--quiet btn--tiny" onClick={() => setHidden(new Set(data.curves.map((c) => c.file_id)))}>hide all</button>
            {filter && <button className="btn btn--quiet btn--tiny" onClick={() => setHidden(new Set(data.curves.filter((c) => !shown.includes(c)).map((c) => c.file_id)))}>only these</button>}
          </div>
          <ul>
            {shown.slice(0, 200).map((c) => {
              const off = hidden.has(c.file_id)
              return (
                <li key={c.file_id}>
                  <button className={`bp__leg ${off ? 'is-off' : ''}`} aria-pressed={!off} title={c.relative_path}
                    onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(c.file_id)) n.delete(c.file_id); else n.add(c.file_id); return n })}>
                    <i style={{ background: colorOf(c.file_id) }} />{c.relative_path || c.filename}
                  </button>
                </li>
              )
            })}
          </ul>
          {shown.length > 200 && <p className="bp__hint">{shown.length - 200} more — filter to find them</p>}
        </aside>
      </div>
    </div>
  )
}

// -------------------------------------------------------------------- grid
const PAGE = 12

const Card = memo(function Card({ c, color, onOpen }: { c: PlotCurve; color: string; onOpen: () => void }) {
  const main = mainTransition(c)
  return (
    <button className="bp__card" onClick={onOpen} title={c.relative_path}>
      <div className="bp__cardhead"><i style={{ background: color }} /><b>{c.relative_path || c.filename}</b></div>
      <LineChart height={150} interactive={false}
        series={[{ id: c.file_id, name: c.filename, color, x: c.x, y: c.y }]}
        markers={c.transitions.map((t) => ({ seriesId: c.file_id, kind: t.type, x: t.onset_x, y: t.onset_y, x2: t.settled_x, y2: t.settled_y, label: t.type, color: TYPE_COLOR[t.type] ?? color }))}
        xLabel="" yLabel="" />
      <div className="bp__cardfoot num">
        {c.transitions.length} event{c.transitions.length === 1 ? '' : 's'}
        {main && <> · {main.type} at {tick(main.onset_x)}</>}
      </div>
    </button>
  )
})

function Grid({ batchId, files, colorOf, onOpenFile, version }: { batchId: string; files: BatchFileRecord[]; colorOf: (id: string) => string; onOpenFile: (id: string) => void; version: number }) {
  const done = useMemo(() => files.filter((f) => f.status === 'completed'), [files])
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(done.length / PAGE))
  const cur = Math.min(page, pages - 1)
  const slice = done.slice(cur * PAGE, cur * PAGE + PAGE)
  const ids = slice.map((f) => f.file_id)
  // Only the files on this page are fetched: a grid of hundreds never loads at once.
  const { data: pageData } = useFetched(`${batchId}|${ids.join(',')}|${version}`, () => batches.plots(batchId, '__all__', 200, ids), { enabled: ids.length > 0 })
  const meta = (id: string) => files.find((f) => f.file_id === id)?.digest

  return (
    <div>
      <p className="bp__hint">One plot per file, on its own axes — the right view when files differ in scale or units. Markers: ● onset, ▫ settled.</p>
      <div className="bp__grid">
        {pageData?.curves.map((c) => {
          const m = meta(c.file_id)
          return (
            <div key={c.file_id}>
              <Card c={c} color={colorOf(c.file_id)} onOpen={() => onOpenFile(c.file_id)} />
              {m && <div className="bp__axes num">{unitLabel(m.y, m.y_unit)} vs {unitLabel(m.x, m.x_unit)}</div>}
            </div>
          )
        })}
      </div>
      {pages > 1 && (
        <div className="bp__pager">
          <button className="btn btn--quiet" disabled={cur === 0} onClick={() => setPage(cur - 1)}>← previous</button>
          <span className="num">page {cur + 1} / {pages} · {done.length} files</span>
          <button className="btn btn--quiet" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>next →</button>
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------- compare
const MEASURES: { key: string; label: string; unitless?: boolean; pick: (t: PlotTransition) => number | null }[] = [
  { key: 'onset_x', label: 'onset position (x)', pick: (t) => t.onset_x },
  { key: 'magnitude', label: 'magnitude', pick: (t) => t.magnitude },
  { key: 'onset_y', label: 'value at onset (y)', pick: (t) => t.onset_y },
  { key: 'settled_x', label: 'settled position (x)', pick: (t) => t.settled_x },
  { key: 'detection', label: 'detection rate (bootstrap)', unitless: true, pick: (t) => t.confidence?.detection_rate ?? null },
]

function Compare({ data, files, colorOf, onOpenFile }: { data: PlotData; files: BatchFileRecord[]; colorOf: (id: string) => string; onOpenFile: (id: string) => void }) {
  const [measure, setMeasure] = useState('onset_x')
  const [types, setTypes] = useState<Set<string>>(new Set(['step', 'knee', 'peak', 'valley']))
  const rows = data.transitions.filter((t) => t.group === data.group && types.has(t.type))
  const def = MEASURES.find((m) => m.key === measure)!
  const order = files.filter((f) => f.status === 'completed' && rows.some((r) => r.file_id === f.file_id)).map((f) => f.file_id)
  const pts = rows.map((t) => ({ t, v: def.pick(t), i: order.indexOf(t.file_id) })).filter((p): p is { t: PlotTransition; v: number; i: number } => p.v !== null && p.i >= 0)

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of data.transitions.filter((t) => t.group === data.group)) m.set(t.file_id, (m.get(t.file_id) ?? 0) + 1)
    return m
  }, [data])
  const all = data.transitions.filter((t) => t.group === data.group)
  const byType = ['step', 'knee', 'peak', 'valley'].map((k) => ({ k, n: all.filter((t) => t.type === k).length }))
  const dirs = { upward: all.filter((t) => t.direction === 'upward').length, downward: all.filter((t) => t.direction === 'downward').length }

  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v))
  const Hh = 300, Wd = 860, pad = { l: 58, r: 14, t: 10, b: 30 }
  const n = Math.max(1, order.length)
  const xs = (i: number) => pad.l + ((i + 0.5) / n) * (Wd - pad.l - pad.r)
  const span = hi - lo || 1
  const ys = (v: number) => pad.t + (1 - (v - lo + span * 0.05) / (span * 1.1)) * (Hh - pad.t - pad.b)

  return (
    <div>
      <div className="bp__tools">
        <label className="bp__group">compare <select value={measure} onChange={(e) => setMeasure(e.target.value)}>
          {MEASURES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select></label>
        {['step', 'knee', 'peak', 'valley'].map((k) => (
          <label key={k} className="bu__check"><input type="checkbox" checked={types.has(k)} onChange={(e) => setTypes((s) => { const x = new Set(s); if (e.target.checked) x.add(k); else x.delete(k); return x })} />
            <i className="bp__dot" style={{ background: TYPE_COLOR[k] }} />{k}</label>
        ))}
      </div>
      {def.key === 'magnitude' && <p className="bp__hint">Magnitude means step height for steps, change of slope for knees and prominence for peaks and valleys — compare like with like by filtering types.</p>}
      {pts.length === 0 ? <p className="bp__empty">{def.key === 'detection' ? 'No file has a bootstrap detection rate: enable "bootstrap each file" to compute one.' : 'No events match this measure and selection.'}</p> : (
        <div className="bp-chart">
          <svg viewBox={`0 0 ${Wd} ${Hh}`} className="bp-chart__svg" role="img" aria-label={`${def.label} per file`}>
            {niceTicks(lo, hi, 5).map((t) => (
              <g key={t}><line x1={pad.l} x2={Wd - pad.r} y1={ys(t)} y2={ys(t)} className="bp-chart__grid" /><text x={pad.l - 6} y={ys(t) + 3} textAnchor="end" className="bp-chart__tick">{tick(t)}</text></g>
            ))}
            <line x1={pad.l} x2={Wd - pad.r} y1={Hh - pad.b} y2={Hh - pad.b} className="bp-chart__axis" />
            <text x={Wd - pad.r} y={Hh - 6} textAnchor="end" className="bp-chart__label">file (upload order)</text>
            {pts.map((p, k) => (
              <circle key={k} cx={xs(p.i)} cy={ys(p.v)} r={5} fill={TYPE_COLOR[p.t.type]} fillOpacity={0.85} stroke="#fff" strokeWidth={1}
                style={{ cursor: 'pointer' }} onClick={() => onOpenFile(p.t.file_id)}>
                <title>{`${p.t.filename}\n${p.t.event_id} · ${p.t.type} · ${def.label} = ${tick(p.v)}`}</title>
              </circle>
            ))}
          </svg>
        </div>
      )}
      <div className="bp__stats">
        <div><b className="num">{all.length}</b> events in {counts.size} of {order.length || counts.size} files</div>
        {byType.map((b) => <div key={b.k}><i className="bp__dot" style={{ background: TYPE_COLOR[b.k] }} /> {b.n} {b.k}{b.n === 1 ? '' : 's'}</div>)}
        <div>{dirs.upward} upward · {dirs.downward} downward</div>
      </div>
      <div className="table-wrap">
        <table className="bp__table">
          <thead><tr><th>file</th><th>events</th><th>types</th></tr></thead>
          <tbody>
            {Array.from(counts.entries()).slice(0, 60).map(([fid, c]) => {
              const f = files.find((x) => x.file_id === fid)
              return (
                <tr key={fid}>
                  <td><button className="bp__link" onClick={() => onOpenFile(fid)}><i className="bp__dot" style={{ background: colorOf(fid) }} />{f?.relative_path ?? fid}</button></td>
                  <td className="num">{c}</td>
                  <td>{all.filter((t) => t.file_id === fid).map((t) => t.type).join(', ')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ cohort
function Cohort({ data }: { data: PlotData }) {
  if (!data.cohort) return <p className="bp__empty">{data.cohort_note ?? 'No cohort for this group.'}</p>
  const { chorus, ensemble } = data.cohort
  const stats = ensemble.stats
  const unit = data.x_unit ? ` ${data.x_unit}` : ''
  return (
    <div>
      <p className="bp__hint">{ensemble.headline}. Median curve with an interquartile ribbon over the {ensemble.n_ok} comparable curves in this group; outliers are judged by median absolute deviation.</p>
      <Chorus data={chorus} />
      <div className="bp__stats">
        {Object.entries(stats).filter(([, s]) => s.n).map(([k, s]) => (
          <div key={k}>{k.replace(/_/g, ' ')}: <b className="num">{tick(s.median ?? NaN)}</b> ± {tick(s.spread ?? NaN)} <span className="num">(n={s.n})</span></div>
        ))}
        {stats.transition_x?.n ? <div>transition position in {data.x_label}{unit}</div> : null}
      </div>
      {ensemble.outliers.length > 0 ? (
        <ul className="bp__outliers">
          {ensemble.outliers.slice(0, 15).map((o) => <li key={o.name}><b>{o.name}</b> — {o.sentence}</li>)}
        </ul>
      ) : <p className="bp__hint">No file stands apart from the rest.</p>}
    </div>
  )
}
