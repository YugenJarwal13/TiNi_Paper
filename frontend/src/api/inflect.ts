/** Typed client for Version 4 — Inflect. */

const BASE = '/api/inflect'

async function get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null) q.set(k, String(v))
  const url = `${BASE}${path}${q.toString() ? `?${q}` : ''}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(await errorText(r))
  return r.json() as Promise<T>
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) throw new Error(await errorText(r))
  return r.json() as Promise<T>
}

async function errorText(r: Response): Promise<string> {
  try {
    const d = await r.json()
    const detail = (d as { detail?: unknown }).detail
    if (typeof detail === 'string') return detail
    if (detail) return JSON.stringify(detail)
  } catch {
    /* fall through to the status line */
  }
  return `${r.status} ${r.statusText}`
}

// ------------------------------------------------------------------- shapes
export type Column = {
  index: number
  name: string
  unit: string | null
  label: string
  named_by_file: boolean
}

export type ColumnStat = {
  index: number
  name: string
  unit: string | null
  label: string
  kind: string
  kind_reason: string
  n_finite: number
  n_nan: number
  minimum: number
  maximum: number
  span: number
  monotonic: string
  uniform_spacing: boolean
  noise_sigma: number
  snr: number
  trend_strength: number
  constant: boolean
  x_score: number
  y_score: number
  x_reasons: string[]
  y_reasons: string[]
  duplicate_of: string | null
}

export type ColumnReport = {
  columns: ColumnStat[]
  x_ranking: number[]
  y_ranking: number[]
  recommended_x: number | null
  recommended_y: number | null
  headline: string
}

export type Dialect = {
  delimiter: string
  comment_prefix: string | null
  n_comment_lines: number
  header_line: string | null
  header_from_comment: boolean
  n_fields: number
  reasons: string[]
}

export type TableInfo = {
  name: string
  n_rows: number
  n_cols: number
  columns: Column[]
  dialect: Dialect
  comment_lines: string[]
  warnings: string[]
}

export type Annotation = {
  kind: 'region' | 'vline' | 'hline' | 'circle' | 'bracket' | 'slope' | 'point' | 'curve' | 'band'
  tone: 'accent' | 'model' | 'muted'
  x0?: number
  x1?: number
  y0?: number
  y1?: number
  text?: string
  detail?: string
}

export type Slot = {
  name: string
  value: number
  unit?: string
  decimals: number
  control?: string
  minimum?: number
  maximum?: number
  step?: number
}

export type Stat = { label: string; value: string | number; unit?: string | null }

export type Beat = {
  id: string
  kind: 'overview' | 'shape' | 'regime' | 'transition' | 'caution' | 'knee' | 'confidence'
  title: string
  sentence: string
  slots: Slot[]
  annotations: Annotation[]
  stats: Stat[]
  focus?: [number, number]
  tier?: 'measured' | 'read'
  findings?: string[]
}

export type Reading = {
  x_label: string
  y_label: string
  x_unit: string | null
  y_unit: string | null
  shape: string
  headline: string
  beats: Beat[]
  quantities: { name: string; value: number; unit: string | null; from: [number, number] }[]
  transition: {
    x: number
    x_lo: number
    x_hi: number
    width: number
    onset_value: number
    final_value: number
    step: number
    step_sigma: number
    peak_value: number
    peak_x: number
    onset_vs_peak: number
  } | null
}

export type Boundary = {
  index: number
  x: number
  kind: 'transition' | 'knee' | 'break' | 'step'
  y_before: number
  y_after: number
  gap: number
  gap_sigma: number
  slope_before: number
  slope_after: number
  left_model: string
  right_model: string
  x_lo: number
  x_hi: number
  width: number
  sharpness: number
}

export type Segment = {
  i0: number
  i1: number
  x0: number
  x1: number
  degree: number
  model: string
  coeffs: number[]
  x_mid: number
  sigma: number
  r2: number
  n: number
  y_start: number
  y_end: number
  slope_start: number
  slope_end: number
  curvature: number
  span: number
}

export type Segmentation = {
  segments: Segment[]
  boundaries: Boundary[]
  events: { x0: number; x1: number; width: number; drop: number; drop_sigma: number }[]
  sigma: number
  n_segments: number
  shape: string
  chosen_by: 'penalty' | 'requested'
}

export type CurveResult = {
  file: string
  x_column: number
  y_column: number
  x_label: string
  y_label: string
  x_unit: string | null
  y_unit: string | null
  n_points: number
  curve: { x: number[]; y: number[]; decimated: boolean }
  domain: [number, number]
  range: [number, number]
  fits: { x0: number; x1: number; model: string; degree: number; points: [number, number][] }[]
  segmentation: Segmentation
  reading: Reading
  columns: Column[]
}

export type SessionMeta = {
  id: string
  title: string
  created_at_iso: string
  sources: { name: string; stored: boolean; size_bytes: number }[]
  config: Record<string, unknown>
}

export type SessionDetail = {
  session: SessionMeta
  first_file: TableInfo
  columns: ColumnReport
  files: { name: string; stored: boolean; size_bytes: number }[]
  has_ensemble: boolean
}

export type CurveSummary = {
  name: string
  ok: boolean
  error: string | null
  shape: string
  n_regimes: number
  noise: number | null
  y_range: number | null
  first_slope: number | null
  n_transitions: number
  transition_x: number | null
  transition_onset: number | null
  transition_step: number | null
  transition_width: number | null
}

export type EnsembleResult = {
  n_files: number
  n_ok: number
  n_failed: number
  curves: CurveSummary[]
  stats: Record<string, { n: number; median: number | null; spread: number | null; mean: number | null; sd: number | null; min: number | null; max: number | null }>
  outliers: { name: string; feature: string; feature_label: string; value: number; median: number; z: number; sentence: string }[]
  groups: { signature: string; count: number; members: string[] }[]
  headline: string
  failures: { name: string; error: string }[]
  sparklines?: Record<string, number[]>
}

export type EnsembleProgress = {
  status: 'idle' | 'running' | 'done' | 'failed' | 'cancelled'
  done: number
  total: number
  percent: number
  message: string
  running: boolean
  session_id: string | null
}

export type CurveQuery = {
  file?: string
  x_column?: number
  y_column?: number
  n_segments?: number
  penalty_scale?: number
  detect_transitions?: boolean
  x_scale?: number
}

// ------------------------------------------------------------------ methods
export const inflect = {
  spec: () => get<{ defaults: Record<string, unknown>; max_files: number; sample_available: boolean }>('/spec'),
  sessions: () => get<{ sessions: { id: string; title: string; created_at_iso: string; n_files: number; has_ensemble: boolean }[] }>('/sessions'),
  session: (id: string) => get<SessionDetail>(`/sessions/${id}`),
  sample: (title?: string) => post<{ id: string; accepted: number }>('/sample', title ? { title } : {}),
  setConfig: (id: string, config: Record<string, unknown>) => post<{ config: Record<string, unknown> }>(`/sessions/${id}/config`, config),
  curve: (id: string, q: CurveQuery = {}) => get<CurveResult>(`/sessions/${id}/curve`, q as Record<string, string | number | boolean | undefined>),
  runEnsemble: (id: string) => post<EnsembleProgress>(`/sessions/${id}/ensemble`),
  ensembleProgress: () => get<EnsembleProgress>('/ensemble/progress'),
  ensemble: (id: string) => get<EnsembleResult>(`/sessions/${id}/ensemble`),

  async upload(files: File[], title: string, onProgress?: (fraction: number) => void): Promise<{ id: string; accepted: number; problems: { name: string; error: string }[] }> {
    const form = new FormData()
    form.append('title', title)
    for (const f of files) form.append('files', f)
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${BASE}/sessions`)
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total)
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText))
        } else {
          let message = `${xhr.status} ${xhr.statusText}`
          try {
            const d = JSON.parse(xhr.responseText)
            if (typeof d.detail === 'string') message = d.detail
          } catch {
            /* keep the status line */
          }
          reject(new Error(message))
        }
      }
      xhr.onerror = () => reject(new Error('the upload could not reach the server'))
      xhr.send(form)
    })
  },
}

// ---------------------------------------------- phase 2: how sure is it, and
// ---------------------------------------------- what the whole set looks like
/** `samples` is a thinned, sorted sample of the bootstrap replicates behind `value`/`ci` — up to 60 points, enough to draw the distribution's shape. */
export type Interval = { value: number; ci: [number, number] | null; sd: number | null; n: number; samples?: number[] }

export type Uncertainty = {
  file: string
  x_unit: string | null
  y_unit: string | null
  n_resamples: number
  n_used: number
  block_length: number
  detection_rate: number
  note: string
  transition: { position: Interval; onset: Interval; step: Interval } | null
  segments: { x0: number; x1: number; model: string; slope: Interval }[]
}

export type StabilityPoint = {
  setting: 'threshold' | 'penalty' | 'regimes'
  label: string
  value: number
  is_default: boolean
  found: boolean
  position: number | null
  onset: number | null
  n_segments: number
}

export type Stability = {
  file: string
  points: StabilityPoint[]
  reference: number | null
  spread: number | null
  holds: boolean
  sentence: string
}

export type Arrangement = {
  grid: number[]
  median: (number | null)[]
  low: (number | null)[]
  high: (number | null)[]
  lines: (number | null)[][]
  n_curves: number
  n_drawn: number
  origin: string
}

export type ChorusResult = {
  measured: Arrangement | null
  aligned: Arrangement | null
  names: string[]
  x_label: string
  y_label: string
  x_unit: string | null
  y_unit: string | null
}

export const inflectMore = {
  uncertainty: (id: string, q: CurveQuery & { n_resamples?: number } = {}) =>
    get<Uncertainty>(`/sessions/${id}/uncertainty`, q as Record<string, string | number | boolean | undefined>),
  stability: (id: string, q: CurveQuery = {}) =>
    get<Stability>(`/sessions/${id}/stability`, q as Record<string, string | number | boolean | undefined>),
  chorus: (id: string) => get<ChorusResult>(`/sessions/${id}/chorus`),
  methods: (id: string, file?: string) => get<{ methods: string }>(`/sessions/${id}/methods`, { file }),
  csvUrl: (id: string) => `${BASE}/sessions/${id}/results.csv`,
}

// ------------------------------------------ phase 3: the ledger and the record
export type FindingInterval = Interval & {
  median?: number
  shift?: number
  biased?: boolean
  samples?: number[]
}

export type FindingSensitivity = {
  value: number
  present_in: number
  of: number
  min: number | null
  max: number | null
  spread: number
  holds: boolean
  points: { label: string; value: number | null }[]
}

export type Finding = {
  id: string
  label: string
  tier: 'measured' | 'read'
  value: number | null
  unit: string | null
  method: string
  rule: string | null
  text: string | null
  evidence: Record<string, unknown>
  anchor: { x?: number; y?: number; x0?: number; x1?: number; y0?: number; y1?: number }
  group: string
  interval: FindingInterval | null
  sensitivity: FindingSensitivity | null
}

export type Note = { id: string; file: string; finding_id: string; text: string; created_at_iso: string }

export type Ledger = {
  file: string
  x_label: string
  y_label: string
  x_unit: string | null
  y_unit: string | null
  settings: Record<string, unknown>
  findings: Finding[]
  summary: { n: number; tiers: Record<string, number>; with_interval: number; swept: number; holds: number }
  notes: Note[]
  bootstrap: { n_used: number; block_length: number; detection_rate: number } | null
  stability_sentence: string | null
}

export type RecordDoc = {
  record_version: string
  created_at_iso: string
  software: { name: string; version: string; code_hash: string }
  session: string
  data: { file: string; sha256: string; n_rows: number; columns: Record<string, unknown> }
  settings: Record<string, unknown>
  seed: number
  findings: Finding[]
  interpretations: Note[]
  note: string
}

export type VerifyResult = {
  reproduced: boolean
  n_recorded: number
  n_same: number
  same: string[]
  moved: { id: string; recorded: unknown; now: unknown; difference?: number }[]
  missing: string[]
  new: string[]
  data_matches: boolean
  code_matches: boolean
  file: string
}

export const inflectLedger = {
  ledger: (id: string, q: CurveQuery & { with_uncertainty?: boolean; n_resamples?: number } = {}) =>
    get<Ledger>(`/sessions/${id}/ledger`, q as Record<string, string | number | boolean | undefined>),
  notes: (id: string, file?: string) => get<{ notes: Note[] }>(`/sessions/${id}/notes`, { file }),
  addNote: (id: string, file: string, finding_id: string, text: string) =>
    post<Note>(`/sessions/${id}/notes`, { file, finding_id, text }),
  removeNote: async (id: string, noteId: string) => {
    const r = await fetch(`${BASE}/sessions/${id}/notes/${noteId}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(await errorText(r))
  },
  record: (id: string, file?: string) => get<RecordDoc>(`/sessions/${id}/record`, { file }),
  recordUrl: (id: string, file?: string) =>
    `${BASE}/sessions/${id}/record?download=true${file ? `&file=${encodeURIComponent(file)}` : ''}`,
  verify: (id: string, record: RecordDoc) => post<VerifyResult>(`/sessions/${id}/verify`, record),
}

// --------------------------------------------- choosing what to plot, by hand
export type PreviewColumn = {
  index: number
  name: string
  unit: string | null
  label: string
  kind: string
  kind_reason: string
  values: (number | null)[]
  minimum: number
  maximum: number
  monotonic: string
  uniform_spacing: boolean
  noise_sigma: number
  trend_strength: number
  constant: boolean
  duplicate_of: string | null
  x_score: number
  y_score: number
  x_reasons: string[]
  y_reasons: string[]
}

export type Preview = {
  file: string
  n_rows: number
  n_preview: number
  columns: PreviewColumn[]
  x_ranking: number[]
  y_ranking: number[]
  recommended_x: number | null
  recommended_y: number | null
  headline: string
  chosen_x: number | null
  chosen_y: number | null
  x_scale: number
  x_unit: string | null
  y_unit: string | null
}

export const inflectColumns = {
  preview: (id: string, file?: string) => get<Preview>(`/sessions/${id}/preview`, { file }),
}


// ============================================================ batch analysis
// One batch -> N independent file analyses -> one consolidated collection.

export type BatchFileStatus = 'queued' | 'parsing' | 'analysing' | 'completed' | 'failed' | 'skipped'
export type BatchStatus = 'created' | 'processing' | 'completed' | 'completed_with_errors' | 'failed'

export type BatchFileDigest = {
  x: string
  y: string
  x_unit: string | null
  y_unit: string | null
  point_count: number
  range: number | null
  noise: number | null
  n_regimes: number
  shape: string
  primary_type: string | null
  primary_onset_x: number | null
  primary_magnitude: number | null
}

export type BatchFileRecord = {
  file_id: string
  filename: string
  relative_path: string
  ext: string
  size_bytes: number
  sha256: string | null
  status: BatchFileStatus
  validation: { ok: boolean; message: string }
  duplicate_of: string | null
  error: string | null
  error_kind: string | null
  message: string
  n_transitions: number | null
  n_warnings: number | null
  digest?: BatchFileDigest
  updated_at: number
}

export type BatchSettings = {
  x_column: number | null
  y_column: number | null
  x_scale: number
  x_unit: string | null
  y_unit: string | null
  n_segments: number | null
  penalty_scale: number
  event_threshold: number
  detectors: 'auto' | string[]
  with_uncertainty: boolean
  n_resamples: number
  skip_duplicates: boolean
  seed: number
}

export type BatchInfo = {
  id: string
  title: string
  created_at_iso: string
  status: BatchStatus
  running: boolean
  algorithm_version: string
  settings: BatchSettings
  limits: { max_files: number; max_file_bytes: number; max_total_bytes: number; max_rows: number; max_workers: number }
  counts: Record<BatchFileStatus, number>
  total: number
  finished: number
  percent: number
  total_transitions: number
  total_size_bytes: number
  n_duplicates: number
}

export type BatchSpec = {
  limits: BatchInfo['limits']
  supported_extensions: string[]
  defaults: BatchSettings
  detectors: string[]
  algorithm_version: string
}

export type BatchTransition = {
  event_id: string
  event_number: number
  type: 'step' | 'knee' | 'peak' | 'valley'
  method: string
  onset_x: number
  onset_y: number
  settled_x: number | null
  settled_y: number | null
  magnitude: number
  direction: 'upward' | 'downward' | 'not_applicable'
  width: number | null
  confidence: { detection_rate: number; position_ci: [number, number] | null; position_median: number | null; estimate_inside_ci: boolean; interval_biased: boolean; n_resamples_used: number; stability_holds: boolean | null; method: string; interpretation: string } | null
  reliability?: string
  evidence: Record<string, unknown>
  detector_settings: Record<string, unknown>
  classification: string
  interpretation: string | null
}

export type BatchRegime = {
  regime_number: number
  regime_type: string
  start_index: number
  end_index: number
  start_x: number
  end_x: number
  points: number
  coefficients: number[]
  coefficient_basis: string
  r2: number | null
  residual_sigma: number
  y_start: number
  y_end: number
  slope_start: number
  slope_end: number
  curvature: number
}

export type FileAnalysis = {
  status: 'completed' | 'failed'
  file_id: string
  filename: string
  relative_path: string
  sha256: string
  error?: string
  error_kind?: string
  columns: {
    x: string; y: string; x_unit: string | null; y_unit: string | null
    x_index: number; y_index: number; chosen_by: string
    x_reasons: string[]; y_reasons: string[]; headline: string
  }
  features: Record<string, number | string | null | Record<string, unknown>>
  transitions: BatchTransition[]
  regimes: BatchRegime[]
  findings: Finding[]
  warnings: string[]
  quality: Record<string, unknown> & { rows_read: number; rows_used: number; rows_excluded: number; x_order: string }
  detector_selection: { mode: string; enabled: string[]; reasons: string[] }
  settings: BatchSettings
  algorithm: { version: string; code_hash: string }
  curve: { x: number[]; y: number[]; decimated: boolean; n_full: number; note: string }
  reading: Reading | null
}

export type PlotGroup = { key: string; x: string; y: string; x_unit: string | null; y_unit: string | null; file_ids: string[]; count: number; units_declared: boolean }

export type PlotCurve = {
  file_id: string
  filename: string
  relative_path: string
  x: number[]
  y: number[]
  transitions: Pick<BatchTransition, 'event_id' | 'type' | 'direction' | 'onset_x' | 'onset_y' | 'settled_x' | 'settled_y' | 'magnitude'>[]
}

export type PlotTransition = PlotCurve['transitions'][number] & { file_id: string; filename: string; group: string; confidence: BatchTransition['confidence'] }

export type BatchPlots = {
  groups: PlotGroup[]
  group: string | null
  incompatible_explanation: string | null
  curves: PlotCurve[]
  cohort: { chorus: ChorusResult; ensemble: Pick<EnsembleResult, 'n_ok' | 'stats' | 'outliers' | 'groups' | 'headline'> } | null
  cohort_note: string | null
  transitions: PlotTransition[]
  x_label: string | null
  y_label: string | null
  x_unit: string | null
  y_unit: string | null
  display_note: string
  n_in_selection: number
  truncated: boolean
  max_curves: number
}

export type BatchCreated = { id: string; reused: boolean; batch: BatchInfo; files: BatchFileRecord[] }

export const batches = {
  spec: () => get<BatchSpec>('/batch-spec'),
  list: () => get<{ batches: { id: string; title: string; created_at_iso: string; status: BatchStatus; total: number; percent: number }[] }>('/batches'),
  get: (id: string) => get<BatchInfo>(`/batches/${id}`),
  files: (id: string) => get<{ batch: BatchInfo; files: BatchFileRecord[] }>(`/batches/${id}/files`),
  file: (id: string, fileId: string) => get<{ file: BatchFileRecord; analysis: FileAnalysis | null }>(`/batches/${id}/files/${fileId}`),
  plots: (id: string, group?: string, maxPoints = 600, ids?: string[]) =>
    get<BatchPlots>(`/batches/${id}/plots`, { group, max_points: maxPoints, ids: ids?.join(',') }),
  analyse: (id: string, body: { settings?: Partial<BatchSettings>; file_ids?: string[]; force?: boolean; file_overrides?: Record<string, Partial<BatchSettings>> } = {}) =>
    post<{ started: boolean; batch: BatchInfo }>(`/batches/${id}/analyse`, body),
  cancel: (id: string) => post<BatchInfo>(`/batches/${id}/cancel`),

  /** Upload many files (with their folder paths) as one batch. */
  create(
    items: { file: File; path: string }[],
    opts: { title: string; settings?: Partial<BatchSettings>; start: boolean; forceNew?: boolean },
    onProgress?: (fraction: number) => void,
  ): Promise<BatchCreated> {
    const form = new FormData()
    form.append('title', opts.title)
    form.append('start', String(opts.start))
    form.append('force_new', String(Boolean(opts.forceNew)))
    form.append('settings_json', JSON.stringify(opts.settings ?? {}))
    for (const it of items) {
      form.append('files', it.file, it.file.name)
      form.append('relative_paths', it.path)
    }
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${BASE}/batches`)
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total)
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve(JSON.parse(xhr.responseText))
        let message = `${xhr.status} ${xhr.statusText}`
        try {
          const d = JSON.parse(xhr.responseText)
          if (typeof d.detail === 'string') message = d.detail
        } catch {
          /* keep the status line */
        }
        reject(new Error(message))
      }
      xhr.onerror = () => reject(new Error('the upload could not reach the server'))
      xhr.send(form)
    })
  },

  // downloads
  url: (id: string, path: string) => `${BASE}/batches/${id}${path}`,
  workbookUrl: (id: string) => `${BASE}/batches/${id}/export`,
  csvUrl: (id: string, kind: 'summary' | 'transitions' | 'features' | 'regimes' | 'quality') => `${BASE}/batches/${id}/export/${kind}.csv`,
  plotsZipUrl: (id: string) => `${BASE}/batches/${id}/export/plots.zip`,
  reportUrl: (id: string) => `${BASE}/batches/${id}/export/report.md`,
  filePlotUrl: (id: string, fileId: string) => `${BASE}/batches/${id}/files/${fileId}/plot.png`,
  fileJsonUrl: (id: string, fileId: string) => `${BASE}/batches/${id}/files/${fileId}/analysis.json`,
  fileTransitionsUrl: (id: string, fileId: string) => `${BASE}/batches/${id}/files/${fileId}/transitions.csv`,
}


// ================================================================ histograms
export type HistogramData = {
  n: number
  n_total: number
  n_outside: number
  mean: number
  median: number
  std: number
  min: number
  max: number
  constant: boolean
  value?: number
  counts: number[]
  edges: number[]
}

export type FileHistograms = {
  file_id: string
  filename: string
  relative_path: string
  status: BatchFileStatus
  columns: { x: string; y: string; x_unit: string | null; y_unit: string | null } | null
  histograms: {
    values: HistogramData | null
    increments: HistogramData | null
    residuals: HistogramData | null
    spacing: HistogramData | null
  } | null
  stale: boolean
}

export type CrossMeasure = {
  key: 'peak_value' | 'peak_position' | 'step_size' | 'transition_position'
  label: string
  subtitle: string
  axis: string
  n_files: number
  n_values: number
  n_without: number
  histogram: HistogramData | null
}

export type CrossHistograms = {
  groups: PlotGroup[]
  group: string | null
  n_in_group: number
  n_stale: number
  measures: CrossMeasure[]
  incompatible_explanation: string | null
}

export const batchHistograms = {
  files: (id: string, ids: string[]) => get<{ files: FileHistograms[] }>(`/batches/${id}/histograms/files`, { ids: ids.join(',') }),
  cross: (id: string, group?: string) => get<CrossHistograms>(`/batches/${id}/histograms/cross`, { group }),
}
