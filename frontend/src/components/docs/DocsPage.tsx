/**
 * The in-application technical handover guide.
 *
 * Everything here describes what the repository actually contains. Where a
 * capability is not implemented the text says so; commands were checked
 * against the repository (`python -m tini serve`, `npm run dev`, `pytest`).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

const PROJECT = {
  name: 'TiNi Research Platform & Inflect Engine',
  version: '4.3 (batch analysis and histograms)',
  updated: '2026-11-21',
  developers: ['Yugen Jarwal', 'Sai Sharath Koppu', 'Kritavya Patel'],
}

function Code({ children, lang = 'bash' }: { children: string; lang?: string }) {
  return <pre className="docs__code" data-lang={lang}><code>{children}</code></pre>
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="table-wrap">
      <table className="docs__table">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

const C = ({ children }: { children: ReactNode }) => <code>{children}</code>

type Section = { id: string; title: string; keywords: string; body: ReactNode }

// --------------------------------------------------------------------- API
const API: { method: string; route: string; purpose: string; request: string; response: string; errors: string }[] = [
  { method: 'POST', route: '/api/inflect/batches', purpose: 'Create a batch from many files; optionally start analysis.', request: 'multipart form: files[] (required), relative_paths[] (one per file), title, settings_json, start (bool), force_new (bool)', response: '{ id, reused, batch, files[] }', errors: '400 no files / too many / bad settings; 413 total size over the limit. Per-file problems (unsupported, empty, corrupt, oversize) are file records, not request errors.' },
  { method: 'GET', route: '/api/inflect/batches', purpose: 'List stored batches (newest first).', request: '—', response: '{ batches: [{ id, title, status, total, counts, percent }] }', errors: '—' },
  { method: 'GET', route: '/api/inflect/batches/{id}', purpose: 'Batch status, counts and progress.', request: '—', response: 'BatchInfo: status, running, counts, percent, total_transitions, settings, limits', errors: '404 unknown batch' },
  { method: 'GET', route: '/api/inflect/batches/{id}/files', purpose: 'Every file record (including failed and skipped) plus batch status.', request: '—', response: '{ batch, files[] }', errors: '404' },
  { method: 'GET', route: '/api/inflect/batches/{id}/files/{file_id}', purpose: 'One file’s complete saved analysis.', request: '—', response: '{ file, analysis }: columns, features, transitions, regimes, findings, warnings, quality, curve', errors: '404 unknown batch or file' },
  { method: 'POST', route: '/api/inflect/batches/{id}/analyse', purpose: 'Start or resume analysis. Unchanged finished files are not recomputed.', request: 'JSON (optional): { settings, file_overrides, file_ids, force }', response: '{ started, batch }', errors: '400 bad settings; 404; 409 already running' },
  { method: 'POST', route: '/api/inflect/batches/{id}/cancel', purpose: 'Stop after the files currently in progress.', request: '—', response: 'BatchInfo', errors: '404' },
  { method: 'GET', route: '/api/inflect/batches/{id}/plots', purpose: 'Combined plotting data for one compatible group.', request: 'query: group, max_points (50–3000), ids (comma list), max_curves', response: '{ groups[], curves[], cohort, transitions[], display_note, … }', errors: '404' },
  { method: 'GET', route: '/api/inflect/batches/{id}/histograms/files', purpose: 'The four within-file histograms (values, increments, residuals, spacing) of the files named in ids.', request: 'query: ids (comma list, 1–24 file ids)', response: '{ files: [{ file_id, columns, histograms: { values, increments, residuals, spacing }, stale }] }; each histogram has counts, edges, n, n_outside, median', errors: '400 bad ids; 404 unknown batch' },
  { method: 'GET', route: '/api/inflect/batches/{id}/histograms/cross', purpose: 'Cross-file histograms: peak value, peak position, step size, transition position (one number per file).', request: 'query: group (a compatible group, default the largest)', response: '{ groups, group, n_in_group, n_stale, measures: [{ key, label, axis, n_values, n_without, histogram }] }', errors: '404 unknown batch' },
  { method: 'GET', route: '/api/inflect/batches/{id}/export', purpose: 'The Excel workbook Inflect_Batch_Results.xlsx.', request: '—', response: 'xlsx download', errors: '404' },
  { method: 'GET', route: '/api/inflect/batches/{id}/export/{kind}.csv', purpose: 'CSV of one table: summary, transitions, features, regimes, quality.', request: '—', response: 'csv download', errors: '400 unknown kind; 404' },
  { method: 'GET', route: '/api/inflect/batches/{id}/export/plots.zip', purpose: 'One PNG per completed file.', request: '—', response: 'zip download', errors: '404' },
  { method: 'GET', route: '/api/inflect/batches/{id}/export/report.md', purpose: 'Readable batch report.', request: '—', response: 'markdown download', errors: '404' },
  { method: 'GET', route: '/api/inflect/batches/{id}/files/{file_id}/plot.png', purpose: 'One file’s plot with its events marked.', request: '—', response: 'png', errors: '404 no completed analysis' },
  { method: 'GET', route: '/api/inflect/batches/{id}/files/{file_id}/analysis.json', purpose: 'Download one file’s analysis.', request: '—', response: 'json download', errors: '404' },
  { method: 'GET', route: '/api/inflect/batches/{id}/files/{file_id}/transitions.csv', purpose: 'Download one file’s events.', request: '—', response: 'csv download', errors: '404' },
  { method: 'GET', route: '/api/inflect/batch-spec', purpose: 'Limits, supported extensions, default settings.', request: '—', response: '{ limits, supported_extensions, defaults, detectors }', errors: '—' },
  { method: 'POST', route: '/api/inflect/sessions', purpose: 'Single-file/session upload used by the guided reader (unchanged).', request: 'multipart: files[], title', response: '{ id, accepted, problems, session }', errors: '400, 413' },
  { method: 'GET', route: '/api/inflect/sessions/{id}/curve', purpose: 'Parse, segment and narrate one file (guided reader).', request: 'query: file, x_column, y_column, n_segments, penalty_scale, detect_transitions', response: 'curve, fits, segmentation, reading', errors: '400, 404' },
  { method: 'GET', route: '/api/inflect/sessions/{id}/ledger', purpose: 'Findings ledger with intervals and sensitivity.', request: 'query: file, with_uncertainty, n_resamples, seed', response: 'findings[], summary', errors: '400, 404' },
  { method: 'GET', route: '/api/health · /api/config · /api/progress', purpose: 'Version 1 status, configuration and pipeline progress.', request: '—', response: 'json', errors: '—' },
  { method: 'POST', route: '/api/pipeline/run', purpose: 'Run the Version 1 pipeline.', request: '{ force, stages }', response: '{ run_id }', errors: '400 unknown stage; 409 running' },
  { method: 'POST', route: '/api/inverse/run · /api/forward/run', purpose: 'Run Version 2 (inverse) or Version 3 (forward).', request: '{ config, run_id }', response: '{ run_id }', errors: '400 bad configuration; 409 running' },
]

const SECTIONS: Section[] = [
  {
    id: 'overview', title: '1. Project overview', keywords: 'purpose capabilities versions inflect tini',
    body: (
      <>
        <p>This platform analyses the force response of a titanium–nickel (TiNi) crystal and, through <b>Inflect</b>, any numeric table of measurements. It has four workspaces that share one backend:</p>
        <Table head={['Version', 'Workspace', 'What it does']} rows={[
          ['V1', 'Force Traces', 'Reads the molecular-dynamics force traces, validates them, computes ensemble statistics, finds each trace’s critical-force event and evaluates the cubic free-energy landscape.'],
          ['V2', 'Inverse Model', 'Estimates hidden parameters (activation free energy, transition-state position, intrinsic transition frequency) by maximum likelihood from the force sample.'],
          ['V3', 'Forward Model', 'Solves the time-dependent Smoluchowski equation and predicts the first-passage critical-force distribution.'],
          ['V4', 'Inflect', 'General curve analysis: ingestion, semantic column choice, change detection, regime segmentation, features, cohorts, uncertainty, findings ledger and exports — for one file or many.'],
        ]} />
        <p><b>Why it exists.</b> The TiNi study needed a defensible way to say <em>when</em> a force trace snaps and how much that varies. The same questions arise for any measured curve, so the method was generalised. Inflect contains nothing specific to titanium nickel.</p>
        <p><b>The batch rule.</b> One batch → N independent file analyses → one consolidated collection of results. Raw files are never merged into one curve; each keeps its own identity, hash, measurements, warnings and events.</p>
        <p><b>Terminology.</b> Inflect reports <em>algorithmic detections</em> (steps, knees, peaks, valleys). Calling one a physical phase transition is a scientific interpretation that belongs to the researcher; the software never makes it.</p>
      </>
    ),
  },
  {
    id: 'background', title: '2. Research background', keywords: 'austenite martensite martensitic critical force paper maitra gururajan',
    body: (
      <>
        <p>Versions 1–3 implement the analysis in Maitra &amp; Gururajan, <em>Extracting rates and activation free energies of martensitic transitions using nanomechanical force statistics</em>, Scientific Reports 15:3008 (2025), doi 10.1038/s41598-025-87324-w.</p>
        <ul>
          <li><b>Austenite</b> is the high-symmetry (cubic) phase of TiNi; <b>martensite</b> is the lower-symmetry phase it transforms into under load. The <b>martensitic transformation</b> is diffusionless: atoms shift cooperatively.</li>
          <li>Pulling the crystal at a constant rate raises the force until the transformation occurs. The force at that moment — the <b>critical force</b> — differs from run to run because the event is thermally activated, so its <em>distribution</em> carries the physics.</li>
          <li><b>V1</b> measures that distribution from the traces; <b>V2</b> inverts it for the landscape parameters; <b>V3</b> runs the model forward and checks it reproduces the data.</li>
        </ul>
        <p><b>Why Inflect generalises.</b> Finding “where the curve changes its behaviour, by how much, how sure, and whether this file belongs with the others” is not specific to TiNi. V4 replaces the TiNi-specific peak picker with a method that works on any curve and reports its own uncertainty.</p>
      </>
    ),
  },
  {
    id: 'architecture', title: '3. System architecture', keywords: 'frontend backend persistence artifacts data flow api react fastapi',
    body: (
      <>
        <Table head={['Layer', 'Technology', 'Notes']} rows={[
          ['Frontend', 'React, TypeScript, Vite; SVG charts, Recharts, KaTeX', 'Hash routing in App.tsx (#inflect, #traces, #inverse, #forward, #docs). The dev server proxies /api to :8000.'],
          ['Backend', 'Python, FastAPI', 'backend/tini/api.py registers every route. Long work runs in background threads.'],
          ['Scientific core', 'NumPy, SciPy, Pandas, Matplotlib', 'backend/tini/inflect holds the Inflect engine; V1–V3 are in sibling packages.'],
          ['Persistence', 'JSON/NPZ files under artifacts/', 'Atomic writes (io_atomic.py) keep the previous copy as .prev, so a crash never leaves a half-written result.'],
        ]} />
        <h4>Data flow for a batch</h4>
        <Code lang="text">{`browser ──multipart upload──▶ POST /api/inflect/batches
                                   │  validate, hash, store source files
                                   ▼
            artifacts/inflect/batches/<id>/batch.json   (manifest + statuses)
                                   │  runner: bounded worker pool, one file per task
                                   ▼
        analyse_file()  = ingest → columns → segment → measure → narrate → ledger
                                   │  atomic write per file
                                   ▼
            files/<file_id>/analysis.json  (+ features/transitions/regimes.json)
                                   ▼
   GET .../files, .../plots, .../export  ◀── browser polls while running`}</Code>
        <h4>Batch processing architecture</h4>
        <p><C>backend/tini/inflect/batch.py</C> is only an orchestration layer. A <C>BatchRunner</C> starts one thread per batch, which feeds a <C>ThreadPoolExecutor</C> (default 4 workers) in chunks. Each task reads its own file from disk, so memory stays bounded however many files are queued. A failure in one task is caught and stored as that file’s error; other tasks continue. Because the runner is behind <C>runner.start()</C>, it can later be swapped for a persistent job queue without touching the UI or the analysis code.</p>
        <h4>On-disk layout</h4>
        <Code lang="text">{`artifacts/inflect/batches/<batch_id>/
  batch.json                 manifest: files, hashes, statuses, settings, limits
  files/<file_id>/
    source.<ext>             uploaded bytes, never modified
    analysis.json            the file's complete result (or its failure record)
    features.json  transitions.json  regimes.json
  exports/  logs/`}</Code>
      </>
    ),
  },
  {
    id: 'install', title: '4. Installation', keywords: 'prerequisites python node pip npm environment variables configuration',
    body: (
      <>
        <h4>Prerequisites</h4>
        <ul>
          <li>Python 3.11 or newer (developed on 3.12).</li>
          <li>Node.js 22 (developed on v22.13). Vite 8 needs a current Node.</li>
          <li>Git, and about 1 GB of disk if you use the sample dataset.</li>
        </ul>
        <h4>Install</h4>
        <Code>{`cd backend
pip install -r requirements.txt     # numpy pandas scipy matplotlib fastapi uvicorn pydantic pytest python-multipart openpyxl

cd ../frontend
npm install`}</Code>
        <h4>Environment variables (all optional)</h4>
        <Table head={['Variable', 'Default', 'Meaning']} rows={[
          [<C key="a">TINI_DATA_DIR</C>, 'data/raw/Force_traces', 'V1 trace directory'],
          [<C key="b">TINI_ARTIFACTS_DIR</C>, 'artifacts/', 'Where every result, batch and checkpoint is written'],
          [<C key="c">TINI_BATCH_MAX_FILES</C>, '2000', 'Files per batch'],
          [<C key="d">TINI_BATCH_MAX_FILE_BYTES</C>, '67108864 (64 MB)', 'Size of one uploaded file'],
          [<C key="e">TINI_BATCH_MAX_TOTAL_BYTES</C>, '536870912 (512 MB)', 'Total size of one upload'],
          [<C key="f">TINI_BATCH_MAX_ROWS</C>, '500000', 'Rows read from one file'],
          [<C key="g">TINI_BATCH_WORKERS</C>, '4', 'Files analysed at once'],
        ]} />
        <p>An optional <C>config/settings.json</C> overrides <C>Settings</C> fields in <C>backend/tini/config.py</C>. V1 expects its traces in <C>data/raw/Force_traces/</C> (<C>property.T300.*.dat</C>). The Inflect sample set <C>data/raw/640TH_300K_comp_share/</C> is kept out of git; Inflect works without it.</p>
      </>
    ),
  },
  {
    id: 'startup', title: '5. Startup commands', keywords: 'run serve dev localhost 8000 5173 pytest',
    body: (
      <>
        <p>Run each in its own terminal.</p>
        <h4>Backend</h4>
        <Code>{`cd backend
pip install -r requirements.txt
python -m tini serve`}</Code>
        <h4>Frontend</h4>
        <Code>{`cd frontend
npm install
npm run dev`}</Code>
        <Table head={['What', 'Address']} rows={[
          ['Frontend', 'http://localhost:5173'],
          ['Backend', 'http://localhost:8000'],
          ['Interactive API documentation (FastAPI)', 'http://localhost:8000/docs'],
        ]} />
        <h4>Tests and checks</h4>
        <Code>{`cd backend && python -m pytest          # all backend tests
cd frontend && npx tsc -b               # type check
cd frontend && npm run build            # type check + production build`}</Code>
        <p>Other CLI commands: <C>python -m tini run</C> (V1 pipeline), <C>python -m tini inverse</C>, <C>python -m tini forward</C>, <C>python -m tini status</C>.</p>
      </>
    ),
  },
  {
    id: 'guide', title: '6. Inflect user guide', keywords: 'upload folder columns settings export interpret events regimes plots',
    body: (
      <>
        <ol>
          <li><b>Open Inflect.</b> It is the landing page (<C>#inflect</C>). “Batch analysis” is the default; “Guided reader” narrates one curve step by step.</li>
          <li><b>One file:</b> drop it or use “choose files”. It is a batch of one and goes through the same analysis.</li>
          <li><b>Many files:</b> drop several, or use “choose files” and select multiple. Add more at any time before starting; remove any with ×.</li>
          <li><b>A folder:</b> drop a folder or use “choose a folder”. Sub-folder paths are kept, so two files named <C>run.csv</C> in different folders stay distinct.</li>
          <li><b>Columns.</b> Each file’s x and y columns are chosen by the column ranking (names, units, monotonicity, noise, trend). The choice and its reasons are shown in the file’s detail view; near-ties are flagged as warnings. Set explicit columns through the API (<C>x_column</C>, <C>y_column</C>) when the recommendation is wrong.</li>
          <li><b>Detection settings.</b> Leave detectors on “auto” (steps, knees, peaks/valleys all run and each may report zero events) or choose them yourself. The step threshold controls how strong a jump must be. “Bootstrap each file” adds confidence intervals (slower).</li>
          <li><b>Run.</b> Press Analyse. Progress is shown per batch and per file. Close the tab and come back: the batch is remembered and can be resumed.</li>
          <li><b>Read the results.</b> The table lists every file. Search, sort and filter; click a row for the detail view: plot, events, regimes, features, provenance and findings.</li>
          <li><b>Events.</b> Each has a type (step, knee, peak, valley), onset (x, y), settled point (steps only), magnitude, direction, the detector’s settings and its evidence. “Confidence: not computed” means no bootstrap was run — it is never filled in otherwise.</li>
          <li><b>Plots.</b> <em>Overlay</em> draws compatible curves together (click legend entries to hide; scroll to zoom; drag to pan; align on onset). <em>Each file</em> gives one plot per file. <em>Compare events</em> plots onset, magnitude and more across files. <em>Cohort</em> shows the median curve, interquartile ribbon and outliers.</li>
          <li><b>Histograms.</b> The Histograms tab sits beside Plots and draws nothing until you ask. Under “Each file” answer “Do you want to see the histogram for this?” to get four histograms per file (its values, the change between points, the residuals around the fit, and the spacing of the axis). Under “All files together” the same question gives histograms of one number per file — peak value (critical force), peak position (snap time), step size and transition position — across the files; it needs at least two analysed files and only pools files that share variables and units. In each, “Do you want to see normalized histogram for this?” switches counts to density (the bars then have unit area).</li>
          <li><b>Export.</b> The Export tab downloads the Excel workbook, CSVs, a plots ZIP and a report.</li>
        </ol>
        <p><b>Incompatible files.</b> Files with different variables or units are never overlaid. The page names the groups and lets you pick one; every file is still plotted individually.</p>
      </>
    ),
  },
  {
    id: 'batch', title: '7. Batch analysis', keywords: 'status progress failure resume duplicates hash cohort',
    body: (
      <>
        <ul>
          <li><b>Identity.</b> Every batch gets a unique id (<C>YYYYMMDD-HHMMSS-xxxx</C>) and every file a file id (<C>file_0001</C>…), a relative path and a SHA-256 hash. Files are stored under their ids, so duplicate names never collide.</li>
          <li><b>Duplicates.</b> Files with identical bytes are flagged (<C>duplicate_of</C>). “Skip duplicates” marks the later copies skipped. Re-uploading the same set returns the existing batch instead of creating another.</li>
        </ul>
        <Table head={['File status', 'Meaning']} rows={[
          ['queued', 'waiting for a worker'], ['parsing', 'being read'], ['analysing', 'being analysed'],
          ['completed', 'analysis saved'], ['failed', 'could not be analysed; the error is stored (empty, corrupt, too few rows, ambiguous columns, over a limit, crash)'],
          ['skipped', 'not analysed on purpose (unsupported type, skipped duplicate)'],
        ]} />
        <Table head={['Batch status', 'Meaning']} rows={[
          ['created', 'uploaded, never started'], ['processing', 'running, or interrupted with files still waiting'],
          ['completed', 'every file completed or skipped'], ['completed_with_errors', 'some files failed, some completed'], ['failed', 'no file completed and at least one failed'],
        ]} />
        <p><b>Failure handling.</b> One file failing never stops another. A file with too few usable rows, a constant response or no detectable change is handled: no events is a <em>successful</em> result, too few rows is a failure with kind <C>insufficient_data</C>.</p>
        <p><b>Resumability.</b> Status and results are written after every file. On restart, files left “parsing/analysing” return to the queue; finished files are skipped unless their source hash or settings changed (checked by an analysis hash). Use “resume analysis” or <C>POST …/analyse</C>.</p>
        <h4>Lifecycle and recovery, step by step</h4>
        <Code lang="text">{`upload -> create -> [created] -> analyse -> [processing] -> completed
                                                       completed_with_errors
   per file: queued -> parsing -> analysing -> completed | failed | skipped`}</Code>
        <ol>
          <li><b>Create.</b> Each file is hashed, written to <C>files/&lt;file_id&gt;/source.&lt;ext&gt;</C> and recorded in <C>batch.json</C>. Unsupported types are recorded as skipped and empty, corrupt or oversize files as failed — at once, without stopping the rest.</li>
          <li><b>Start.</b> <C>runner.plan()</C> decides what to compute: queued files, interrupted files, files whose source hash or settings changed, and files you ask for. It marks them queued and a background thread feeds a bounded pool.</li>
          <li><b>Each file.</b> The worker sets <em>parsing</em> then <em>analysing</em>, runs <C>analyse_file()</C>, writes <C>analysis.json</C> atomically, then sets <em>completed</em> (with an analysis hash) or <em>failed</em> (with the error). Nothing is held in memory afterwards.</li>
          <li><b>Interruption</b> (server stopped, crash, laptop closed). On the next read of the batch, files still marked parsing or analysing return to <em>queued</em> with the note “interrupted; will resume”. The batch shows <em>processing</em>, not failed.</li>
          <li><b>Resume.</b> Press “resume analysis” (or <C>POST …/analyse</C>). Completed files whose analysis hash still matches are skipped; only unfinished or changed files run. Changing a setting re-runs only the files it affects.</li>
          <li><b>Stop.</b> “Stop after current files” (<C>POST …/cancel</C>) lets running files finish and leaves the rest queued; resume continues from there.</li>
          <li><b>Corruption.</b> Every JSON is written atomically with a <C>.prev</C> copy; readers fall back to it, so a half-written file never hides a batch.</li>
          <li><b>Refresh.</b> The browser remembers the batch id (local storage) and reopens it, polling while it runs. Earlier batches are listed on the upload screen.</li>
        </ol>
        <p><b>Cohorts.</b> Computed per compatible group using <C>chorus.py</C> and <C>ensemble.py</C>, and only with at least three comparable curves.</p>
        <p><b>Policies, stated.</b> Rows with a non-finite x or y are excluded and counted, never imputed. Non-monotonic x is flagged, analysed in x order, and the file is left unchanged. Units are preserved and never mixed.</p>
      </>
    ),
  },
  {
    id: 'algorithms', title: '8. Algorithms', keywords: 'ingestion dialect columns step knee peak segmentation bootstrap stability mad findings',
    body: (
      <>
        <p>All of the following exist in <C>backend/tini/inflect</C>.</p>
        <Table head={['Method', 'Module', 'What it does']} rows={[
          ['Ingestion & dialect detection', 'ingest.py', 'Finds comment lines, the header, delimiter (comma, tab, semicolon, pipe, whitespace) and units from the bytes alone, and reports how.'],
          ['Semantic column classification', 'columns.py', 'Classifies columns by name/unit and behaviour, scores them as axis or response, flags duplicates, recommends a pair.'],
          ['Locally detrended step statistic', 'segment.py', 'Lines fitted before and after each sample are extrapolated to it and subtracted; only a genuine discontinuity survives, even on a steep or curved background.'],
          ['Multi-scale detection', 'segment.py', 'The statistic is evaluated over a ladder of window widths and judged against its own MAD.'],
          ['Knee-versus-step test', 'segment.py', 'A step measures the same at every width, a knee grows with the width; plus a geometric test that the lines either side do not cross within the span.'],
          ['Regime segmentation', 'segment.py', 'Exact dynamic programming over candidate breakpoints, degree 0–2 per regime, with a penalised criterion or a requested count.'],
          ['Peaks and valleys', 'batch.py', 'Prominence-gated local extrema of the smoothed curve (SciPy find_peaks), excluding those beside a detected step.'],
          ['Multiple events', 'segment.py, batch.py', 'Steps, knees and extrema each return zero or more events; they are merged and ordered by position.'],
          ['Moving-block bootstrap', 'uncertainty.py', 'Resamples residuals in blocks sized by their autocorrelation and re-runs the whole reading, giving 95 % intervals.'],
          ['Stability sweep', 'uncertainty.py', 'Re-derives the event under many thresholds, penalties and regime counts and reports whether it holds.'],
          ['MAD cohort outliers', 'ensemble.py', 'Median/MAD statistics across files; a file is flagged when a feature is far from the rest (with a relative floor).'],
          ['Cohort curve', 'chorus.py', 'Median curve and interquartile ribbon on a common grid, as measured or aligned on each curve’s own transition.'],
          ['Findings ledger & record', 'findings.py, record.py', 'Every number with its tier (measured vs read), method, evidence, interval and sensitivity; records carry SHA-256 hashes and can be verified.'],
        ]} />
        <h4>Detector selection</h4>
        <p>“Auto” runs all three detectors; each reports only what it can show, so a flat curve yields zero events. Choosing detectors manually removes the others. The mode, enabled detectors and each event’s settings are saved with the result.</p>
        <h4>Not implemented</h4>
        <p>There is no separate detector for slow, gradual transitions: they appear, if at all, as knees or wide steps from the existing ladder. Confidence is only reported where the bootstrap ran. Multi-curve alignment beyond onset shifting is not implemented. Do not describe these as supported.</p>
      </>
    ),
  },
  {
    id: 'science', title: '9. Scientific notes and limits', keywords: 'noise peak smoothing bootstrap alignment limitations gradual correlated accuracy validation',
    body: (
      <>
        <p>These statements come from tests in <C>backend/tests/test_inflect_batch.py</C> and one-off measurements on synthetic curves with a known answer (500 points, seeded noise). They describe how the tools behave, not a guarantee for your data.</p>
        <Table head={['Question', 'What was measured', 'Consequence']} rows={[
          ['Are peaks mistaken for noise?', 'White noise: no events in 60 of 60 files. Autocorrelated noise (AR(1), 0.5 and 0.9): no peaks or valleys. Random walks: a few peaks in 4 of 60 files (their wandering is real structure).', 'A peak must exceed 10× the noise measured at the smoothing-window scale (which includes correlation) and 10 % of the curve’s range.'],
          ['Do correlated residuals fool the knee detector?', 'Yes: the engine’s noise estimate (second differences) cannot see correlated noise, so on AR(1) or random-walk data it reports about eight knees per file.', 'The batch layer measures the lag-1 autocorrelation of the residuals; above 0.3 it adds a warning and marks every knee, peak and valley “doubtful: correlated residuals”. Use the bootstrap to check them.'],
          ['Does smoothing move peaks?', 'Peak error: mean ≈ 0.00, sd 0.02–0.1 on a width-1 peak of height 5 over noise 0.05–0.8. An asymmetric peak is pulled about 0.1 towards its broad side.', 'Peak positions are those of the smoothed curve. Each event records the smoothing window and a position resolution (half a window) in its evidence.'],
          ['How accurate are step onsets?', 'Onset is the start of the transition zone: on average 0.04 before the true step (two samples), sd 0.07, independent of noise from 0.05 to 0.3.', 'Alignment on onset leaves a residual jitter of about this size; the settled position is also reported. Long curves (100 000 points) were once mislocated by up to two axis units because the detection window grew with the length; it is now capped at 400 samples, which changes nothing for curves under 6 000 points.'],
          ['Are bootstrap intervals correct?', 'The point estimate is accurate, but the 95 % interval on a step’s position sat to one side of it in 20 of 20 test curves: resampled noise moves the detected onset earlier (the engine documents this as “biased”).', 'Treat the interval’s width and the detection rate as stability indicators, not as 95 % coverage of the true position. Events carry estimate_inside_ci and interval_biased so this is visible.'],
          ['Is a detection a phase transition?', 'No test can decide that.', 'Events are labelled algorithmic_detection with interpretation null. Deciding that a step, knee or peak is a physical transition is for the researcher, with the physics in hand.'],
        ]} />
        <h4>Gradual transitions: what is and is not supported</h4>
        <p>There is no detector for a slow, smooth transition. One that changes slope over a stretch appears, if it is strong enough, as a knee (or several) found by the dynamic-programming segmentation; one that changes level gradually over a large fraction of the curve is not distinguished from the background and may be missed. The step detector looks for changes that are sharp relative to its window ladder (at most 400 samples). If gradual transitions matter for your data, add a dedicated detector (see “Adding a transition detector”) and validate it on curves with a known width.</p>
        <h4>Other limits</h4>
        <ul>
          <li>Analysis assumes one response column against one axis per file; multi-column files use the recommended or chosen pair.</li>
          <li>Rows with non-finite values are dropped; x is analysed in sorted order; no resampling to a common grid happens before analysis (only the cohort view resamples, for display).</li>
          <li>Cohort statistics need at least three curves with the same variables and units and are unreliable when curves cover different x ranges.</li>
          <li>Not tested here: a real browser folder dialog on every OS, batches above 150 files in the UI, or files above 60 000 rows through the browser.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'api', title: '10. API reference', keywords: 'endpoints http routes request response errors batches',
    body: (
      <>
        <p>All routes are under <C>/api</C> on port 8000 (live schemas at <C>/docs</C>). Errors are JSON <C>{'{ "detail": "…" }'}</C>.</p>
        <Table head={['Method', 'Route', 'Purpose', 'Request', 'Response', 'Errors']} rows={API.map((a) => [<b key="m">{a.method}</b>, <C key="r">{a.route}</C>, a.purpose, a.request, a.response, a.errors])} />
        <h4>Example</h4>
        <Code>{`curl -F "files=@run1.csv" -F "files=@run2.csv" \\
     -F "relative_paths=exp/run1.csv" -F "relative_paths=exp/run2.csv" \\
     -F "start=true" http://localhost:8000/api/inflect/batches

curl http://localhost:8000/api/inflect/batches/<id>
curl -o results.xlsx http://localhost:8000/api/inflect/batches/<id>/export`}</Code>
        <h4>Request and response examples</h4>
        <p><b>Create and start</b> — <C>POST /api/inflect/batches</C> (response, trimmed):</p>
        <Code lang="json">{`{
  "id": "20261110-012529-d428",
  "reused": false,
  "batch": { "status": "processing", "total": 2, "counts": { "queued": 2, "completed": 0, "failed": 0 }, "percent": 0.0 },
  "files": [
    { "file_id": "file_0001", "filename": "run1.csv", "relative_path": "exp/run1.csv",
      "sha256": "e6818e4c...", "status": "queued", "duplicate_of": null,
      "validation": { "ok": true, "message": "readable numeric table" } },
    { "file_id": "file_0002", "filename": "notes.pdf", "status": "skipped", "error_kind": "unsupported",
      "error": "unsupported file type '.pdf'" }
  ]
}`}</Code>
        <p><b>Re-run with other settings</b> — <C>POST /api/inflect/batches/{'{id}'}/analyse</C>:</p>
        <Code lang="json">{`// request
{ "settings": { "event_threshold": 8, "detectors": ["step", "knee"], "with_uncertainty": true },
  "file_overrides": { "file_0003": { "x_column": 0, "y_column": 2 } } }
// response
{ "started": true, "batch": { "status": "processing", "running": true, "percent": 50.0 } }`}</Code>
        <p><b>One file</b> — <C>GET /api/inflect/batches/{'{id}'}/files/file_0001</C> (trimmed):</p>
        <Code lang="json">{`{
  "file": { "file_id": "file_0001", "status": "completed", "n_transitions": 1 },
  "analysis": {
    "columns": { "x": "strain", "y": "stress", "x_unit": null, "y_unit": null, "chosen_by": "ranking" },
    "features": { "point_count": 500, "noise": 0.05, "initial_slope": -2.0, "transition_count": 1 },
    "transitions": [ {
      "event_id": "event_001", "type": "step", "method": "local_detrended_step", "direction": "upward",
      "onset_x": 5.99, "onset_y": -11.98, "settled_x": 6.01, "settled_y": -3.0, "magnitude": 8.99,
      "confidence": null, "classification": "algorithmic_detection", "interpretation": null,
      "evidence": { "step_in_noise_units": 180.2, "sharpness": 41.0 } } ],
    "regimes": [ { "regime_number": 1, "regime_type": "linear", "start_x": 0.0, "end_x": 5.98 } ],
    "warnings": []
  }
}`}</Code>
        <p><b>Errors</b> — always a JSON body with a <C>detail</C> message:</p>
        <Code lang="text">{`GET  /api/inflect/batches/nope                    -> 404 {"detail": "no batch nope"}
POST .../analyse {"settings":{"penalty_scale":-1}} -> 400 {"detail": "bad settings: penalty_scale must be between 0.05 and 20"}
POST .../analyse (while running)                  -> 409 {"detail": "this batch is already being analysed"}
GET  .../export/bogus.csv                         -> 400 {"detail": "kind must be one of [...]"}`}</Code>
        <p>Settings accepted by <C>settings_json</C> / <C>analyse</C>: <C>x_column</C>, <C>y_column</C>, <C>x_scale</C>, <C>x_unit</C>, <C>y_unit</C>, <C>n_segments</C>, <C>penalty_scale</C>, <C>event_threshold</C>, <C>detectors</C> (“auto” or a list of step/knee/extrema), <C>with_uncertainty</C>, <C>n_resamples</C>, <C>skip_duplicates</C>, <C>seed</C>.</p>
      </>
    ),
  },
  {
    id: 'structure', title: '11. Project structure', keywords: 'directories modules files layout',
    body: (
      <Table head={['Path', 'Purpose']} rows={[
        ['backend/tini/api.py', 'All FastAPI routes (V1–V4, batches).'],
        ['backend/tini/config.py, io_atomic.py, progress.py, checkpoints.py', 'Settings, atomic writes, progress tracking, fingerprinted checkpoints.'],
        ['backend/tini/pipeline.py, dataset.py, validation.py, statistics.py, potential.py, charts.py', 'Version 1.'],
        ['backend/tini/inverse/', 'Version 2: likelihood, fit, bootstrap, diagnostics, runs.'],
        ['backend/tini/forward/', 'Version 3: Smoluchowski solver and runs.'],
        ['backend/tini/inflect/ingest.py, columns.py', 'Reading tables; choosing columns.'],
        ['backend/tini/inflect/segment.py, measure.py, transitions.py', 'Detection, regimes, measurements, narration.'],
        ['backend/tini/inflect/uncertainty.py, findings.py, record.py', 'Bootstrap and stability, findings ledger, verifiable records.'],
        ['backend/tini/inflect/ensemble.py, chorus.py', 'Cohort statistics and combined curve.'],
        ['backend/tini/inflect/sessions.py', 'Single-file sessions for the guided reader.'],
        ['backend/tini/inflect/batch.py', 'Batch store, runner and the per-file orchestration.'],
        ['backend/tini/inflect/export.py', 'Excel, CSV, PNG/ZIP and report exports.'],
        ['backend/tests/', 'pytest suites (test_inflect_batch.py for batches).'],
        ['frontend/src/App.tsx', 'Hash router and navigation.'],
        ['frontend/src/api/inflect.ts', 'Typed client for Inflect, including batches.'],
        ['frontend/src/components/inflect/', 'Inflect UI: Batch*.tsx (upload, results, plots, histograms, detail), the guided reader.'],
        ['frontend/src/components/docs/DocsPage.tsx', 'This page.'],
        ['frontend/src/styles/', 'tokens.css (design tokens), global.css, inflect.css, batch.css.'],
        ['artifacts/', 'Generated results (batches under artifacts/inflect/batches/). Mostly git-ignored.'],
        ['data/raw/', 'Input data (V1 traces; optional Inflect sample).'],
        ['docs/CODEBASE_REPORT.md', 'Long-form architecture and mathematics report.'],
      ]} />
    ),
  },
  {
    id: 'troubleshooting', title: '12. Troubleshooting', keywords: 'error fix problem failed cannot connect parsing unsupported export',
    body: (
      <Table head={['Symptom', 'Cause and fix']} rows={[
        ['pip install fails / ModuleNotFoundError', 'Use Python 3.11+. Re-run pip install -r requirements.txt in the same interpreter you run (python -m pip …). openpyxl is needed for Excel export.'],
        ['npm install or build fails', 'Use Node 22. Delete frontend/node_modules and reinstall. Run npx tsc -b to see type errors.'],
        ['Backend will not start', 'Run from backend/ (python -m tini serve). Port 8000 busy: use --port. Import errors: reinstall requirements.'],
        ['Frontend loads but shows “could not reach the server”', 'The backend is not running, or not on :8000. Vite proxies /api to http://127.0.0.1:8000.'],
        ['Upload rejects files', 'Check the limits (batch-spec). Supported types: .csv .tsv .dat .txt .tab .asc .prn .out; others are recorded as skipped. Over 64 MB: raise TINI_BATCH_MAX_FILE_BYTES.'],
        ['“could not be read as a numeric table”', 'The file is binary, empty, or has no consistent numeric rows. Open it in a text editor; remove stray text lines.'],
        ['Wrong x/y columns chosen', 'See the warnings and the column reasoning in the file’s detail. Set x_column / y_column in the analyse settings and re-run.'],
        ['“insufficient_data”', 'Fewer than 16 usable rows after excluding non-finite values.'],
        ['No transition detected', 'Valid result. Lower the step threshold, enable more detectors, or check the curve really contains a jump above the noise.'],
        ['Too many transitions on noisy data', 'Raise the step threshold or penalty_scale; turn on bootstrap to see which events are stable.'],
        ['Excel export fails', 'Confirm openpyxl is installed. An empty batch still exports with headers.'],
        ['Batch stuck “processing” after a restart', 'Open it and press “resume analysis” (POST …/analyse). Interrupted files return to the queue.'],
        ['“residuals are correlated” warning; events marked doubtful', 'The noise is not independent (drift, slow wander), so knees and extrema may be false. Enable the bootstrap, or check whether the curve has a baseline that should be removed first.'],
        ['Confidence interval does not contain the estimate', 'Known bootstrap bias (see Scientific notes). Use the interval width and detection rate as stability indicators.'],
        ['“file has more than N rows (the configured limit)”', 'Raise TINI_BATCH_MAX_ROWS (default 500 000) or downsample the file; the limit protects memory.'],
        ['409 “already being analysed”', 'A run is in progress. Wait, or stop it with POST …/cancel, then resume.'],
        ['Files appear skipped', 'Unsupported extension, or “skip duplicates” was on and the content matched an earlier file. Rename to a supported extension or untick the option and press resume.'],
        ['Upload works but nothing happens', 'A batch in status “created” needs “start analysis”. Otherwise check the backend console; runner errors are also written to the batch’s logs/ folder.'],
        ['Histograms say a file was analysed by an older version', 'Results saved before histograms existed have none. Open the batch and press “resume analysis”; changed-version files are recomputed.'],
        ['Cross-file histogram is missing', 'It needs at least two analysed files in one comparison group; files with different variables or units are in other groups (use the group selector). Files without a step are left out of the step histograms and counted.'],
        ['Test failures', 'Run cd backend && python -m pytest -x. Batch tests write to a temporary artifacts directory, other suites use artifacts/.'],
      ]} />
    ),
  },
  {
    id: 'testing', title: '13. Testing', keywords: 'pytest add test detector validate scientific',
    body: (
      <>
        <Code>{`cd backend
python -m pytest                              # everything
python -m pytest tests/test_inflect_*.py      # Inflect only
python -m pytest tests/test_inflect_batch.py  # batches and exports`}</Code>
        <ul>
          <li><b>Add a test.</b> Create <C>backend/tests/test_*.py</C>. Build synthetic curves with a known answer (a step at x = 6, a peak at x = 5) plus seeded noise; assert the position within a tolerance.</li>
          <li><b>Test a new detector.</b> Feed it a curve with zero, one and several events; check the event schema, direction, that flat and noisy inputs give no events, and that it never raises on short data.</li>
          <li><b>Test batch processing.</b> Use the <C>client</C> fixture in test_inflect_batch.py (temporary artifacts directory), upload with <C>create()</C>, <C>wait()</C> for completion, then read <C>/files/&lt;id&gt;</C>. Failure isolation is tested by monkeypatching <C>analyse_file</C>.</li>
          <li><b>Test exports.</b> Read the workbook with pandas (<C>sheet_name=None</C>) and assert sheet names, row counts (one per file/event/regime) and that failed files appear.</li>
          <li><b>Validate scientific results.</b> Prefer known-answer synthetic data; check that changing noise changes uncertainty, that results do not depend on file order, and that a result verifies against its record.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'future', title: '14. Future development', keywords: 'extend add format feature detector visualisation export api',
    body: (
      <>
        <h4>Adding a transition detector — worked example</h4>
        <p>Suppose you add a detector for slow level changes called <C>drift</C>.</p>
        <ol>
          <li><b>Register it.</b> In <C>batch.py</C> add <C>"drift"</C> to <C>DETECTORS</C>. <C>BatchSettings.validate()</C>, the API and “auto” mode pick it up; add it to the manual list in <C>BatchUpload.tsx</C>.</li>
          <li><b>Write the function.</b> Keep it pure: arrays in, a list of dicts out. Return zero, one or many events and never raise on short or flat data.
            <Code lang="python">{`def detect_drift(x, y, sigma, exclude):
    ...                          # your method
    return [{"kind": "drift", "x": x0, "y": y0, "magnitude": delta, "evidence": {...}}]`}</Code></li>
          <li><b>Emit events.</b> In the “events” part of <C>analyse_file()</C>, guard with <C>if "drift" in enabled:</C> and append dicts with the shared schema: <C>type</C>, <C>method</C>, <C>onset_x/onset_y</C>, <C>settled_x/settled_y</C> (or None), <C>magnitude</C>, <C>direction</C> (“upward”, “downward” or “not_applicable”), <C>width</C>, <C>confidence: None</C>, <C>evidence</C> (the numbers and the test used). Everything after that — ids, ordering, detector settings, exports, plots — is generic.</li>
          <li><b>Show it.</b> Add the type to <C>TYPE_COLOR</C> and <C>TYPE_LABEL</C> in <C>batchUtils.ts</C>, the type filter list in <C>BatchPlots.tsx</C>, and (optionally) a count in the features block (<C>drift_count</C>) with its export column.</li>
          <li><b>Never invent confidence.</b> Leave <C>confidence</C> None unless you compute an interval for it.</li>
          <li><b>Test it.</b> Add to <C>test_inflect_batch.py</C>: a curve with a known drift (position within tolerance), a flat curve and white noise (zero events, repeated over several seeds), correlated noise (no false events), and a manual-selection test showing it can be switched off. Measure its false-event rate before trusting it.</li>
        </ol>
      <Table head={['To add…', 'Where and how']} rows={[
        ['A file format', 'ingest.py: extend sniff()/read_table() to produce a Table; add the extension to SUPPORTED_EXTENSIONS in batch.py and the frontend fallback list; add tests with a sample.'],
        ['A feature measurement', 'batch.py analyse_file(): compute it into the features dict; add its key to the lists in export.py and BatchFileDetail.tsx; add a test.'],
        ['A transition detector', 'Add it to DETECTORS and the “Events” section of analyse_file(), emitting the same event schema (type, onset/settled, magnitude, direction, method, evidence); add a type colour in BatchPlots.tsx; test zero/one/many events.'],
        ['Segmentation changes', 'segment.py (regimes, boundary classes). Keep the existing tests green; they pin the scientific behaviour.'],
        ['A visualisation', 'A new mode in BatchPlots.tsx using LineChart; fetch what it needs from /plots, adding fields in batch.build_plots.'],
        ['Export fields', 'export.tables(): add the column to the frame list; both the workbook and CSVs follow.'],
        ['An API route', 'api.py: add the route, validate input, raise HTTPException with a clear status; add a typed method in api/inflect.ts and a test.'],
        ['A different job runner', 'Replace BatchRunner behind runner.start()/is_running()/cancel(); the persistence layout and UI do not change.'],
      ]} />
      </>
    ),
  },
]

// ------------------------------------------------------------------ search
type Hit = { node: Text; start: number; end: number; section: string; before: string; match: string; after: string }

/** Every occurrence of `needle` in the rendered text of `root`, in reading order. */
function scan(root: HTMLElement, needle: string): Hit[] {
  const lower = needle.toLowerCase()
  const out: Hit[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n && out.length < 500; n = walker.nextNode()) {
    const text = n.textContent ?? ''
    const low = text.toLowerCase()
    const section = (n.parentElement?.closest('[data-doc-section]') as HTMLElement | null)?.dataset.docSection ?? ''
    for (let i = low.indexOf(lower); i !== -1 && out.length < 500; i = low.indexOf(lower, i + lower.length)) {
      out.push({
        node: n as Text, start: i, end: i + lower.length, section,
        before: text.slice(Math.max(0, i - 36), i), match: text.slice(i, i + lower.length), after: text.slice(i + lower.length, i + lower.length + 56),
      })
    }
  }
  return out
}

type HighlightRegistry = { set: (k: string, v: unknown) => void; delete: (k: string) => void }
const registry = (): HighlightRegistry | null =>
  typeof CSS !== 'undefined' ? ((CSS as unknown as { highlights?: HighlightRegistry }).highlights ?? null) : null
const HighlightCtor = (): (new (...r: Range[]) => unknown) | null =>
  (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight ?? null

function rangeOf(h: Hit): Range {
  const r = document.createRange()
  r.setStart(h.node, h.start)
  r.setEnd(h.node, h.end)
  return r
}

export function DocsPage() {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [cur, setCur] = useState(0)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(SECTIONS[0].id)
  const main = useRef<HTMLElement>(null)
  const needle = q.trim()

  const scrollTo = useCallback((el: Element | Range) => {
    const top = el.getBoundingClientRect().top + window.scrollY - 150
    window.scrollTo({ top: Math.max(0, top), behavior: 'instant' })
  }, [])

  const jump = useCallback((list: Hit[], i: number) => {
    if (!list.length) return
    const k = ((i % list.length) + list.length) % list.length
    setCur(k)
    setActive(list[k].section || SECTIONS[0].id)
    scrollTo(rangeOf(list[k]))
  }, [scrollTo])

  // Look for the text once the reader pauses typing, then lead them to the first match.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (needle.length < 2 || !main.current) {
        setHits([])
        setCur(0)
        return
      }
      const found = scan(main.current, needle)
      setHits(found)
      jump(found, 0)
    }, 250)
    return () => window.clearTimeout(t)
  }, [needle, jump])

  // Paint every match, and the current one more strongly. Nothing in the page is rewritten.
  useEffect(() => {
    const reg = registry()
    const H = HighlightCtor()
    if (!reg || !H) return
    if (!hits.length) {
      reg.delete('docs-hit')
      reg.delete('docs-active')
      return
    }
    reg.set('docs-hit', new H(...hits.map(rangeOf)))
    reg.set('docs-active', new H(rangeOf(hits[Math.min(cur, hits.length - 1)])))
    return () => {
      reg.delete('docs-hit')
      reg.delete('docs-active')
    }
  }, [hits, cur])

  const goSection = (id: string) => {
    setActive(id)
    const el = document.getElementById(`doc-${id}`)
    if (el) scrollTo(el)
  }

  const related = useMemo(() => {
    const n = needle.toLowerCase()
    return n.length >= 2 && !hits.length ? SECTIONS.filter((s) => `${s.title} ${s.keywords}`.toLowerCase().includes(n)) : []
  }, [needle, hits.length])

  const perSection = useMemo(() => {
    const m = new Map<string, number>()
    for (const h of hits) m.set(h.section, (m.get(h.section) ?? 0) + 1)
    return m
  }, [hits])
  const titleOf = (id: string) => SECTIONS.find((s) => s.id === id)?.title ?? ''
  const showPanel = open && needle.length >= 2

  return (
    <div className="docs">
      <header className="docs__hero" id="doc-top">
        <h1 className="wordmark">Docs</h1>
        <p className="standfirst">
          The official technical handover guide for future contributors: what the platform is, how to run it, how it works and how to extend it.
        </p>
        <dl className="docs__meta">
          <div><dt>Project</dt><dd>{PROJECT.name}</dd></div>
          <div><dt>Version</dt><dd>{PROJECT.version}</dd></div>
          <div><dt>Last updated</dt><dd>{PROJECT.updated}</dd></div>
          <div><dt>Developed by</dt><dd><ul className="docs__people">{PROJECT.developers.map((d) => <li key={d}>{d}</li>)}</ul></dd></div>
        </dl>
      </header>

      <div className="docs__search" role="search">
        <div className="docs__searchbox">
          <input
            type="search" value={q} placeholder="Search the docs — a word, a command, an endpoint…" aria-label="search the docs" autoComplete="off"
            onChange={(e) => { setQ(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); jump(hits, cur + (e.shiftKey ? -1 : 1)); setOpen(false) }
              else if (e.key === 'Escape') { setOpen(false); if (!needle) e.currentTarget.blur() }
            }}
          />
          {needle.length >= 2 && (
            <div className="docs__count num" aria-live="polite">
              {hits.length ? (
                <>
                  <span>{cur + 1} of {hits.length}</span>
                  <button aria-label="previous match" onClick={() => jump(hits, cur - 1)}>↑</button>
                  <button aria-label="next match" onClick={() => jump(hits, cur + 1)}>↓</button>
                </>
              ) : related.length ? <span>related sections only</span> : <span>no match</span>}
            </div>
          )}
          {needle && <button className="docs__clear" aria-label="clear search" onClick={() => { setQ(''); setOpen(false) }}>×</button>}
        </div>

        {showPanel && (
          <div className="docs__results" onMouseDown={(e) => e.preventDefault()}>
            {hits.length > 0 && (
              <>
                <p className="docs__resultshead num">{hits.length}{hits.length >= 500 ? '+' : ''} match{hits.length === 1 ? '' : 'es'} in {perSection.size} section{perSection.size === 1 ? '' : 's'}</p>
                <ul>
                  {hits.slice(0, 40).map((h, i) => (
                    <li key={i}>
                      <button className={i === cur ? 'is-on' : ''} onClick={() => { jump(hits, i); setOpen(false) }}>
                        <span className="docs__resultsec">{titleOf(h.section)}</span>
                        <span className="docs__snip">…{h.before}<mark>{h.match}</mark>{h.after}…</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {hits.length > 40 && <p className="docs__resultshead">Showing the first 40. Use ↑ ↓ or Enter to step through all {hits.length}.</p>}
              </>
            )}
            {!hits.length && related.length > 0 && (
              <>
                <p className="docs__resultshead">No exact text match. Related sections:</p>
                <ul>
                  {related.map((s) => (
                    <li key={s.id}><button onClick={() => { goSection(s.id); setOpen(false) }}><span className="docs__resultsec">{s.title}</span></button></li>
                  ))}
                </ul>
              </>
            )}
            {!hits.length && !related.length && <p className="docs__resultshead">Nothing in the docs matches “{needle}”.</p>}
          </div>
        )}
      </div>

      <div className="docs__layout">
        <nav className="docs__side" aria-label="documentation sections">
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button className={active === s.id ? 'is-on' : ''} onClick={() => goSection(s.id)}>
                  {s.title}
                  {perSection.get(s.id) ? <span className="docs__badge num">{perSection.get(s.id)}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <article className="docs__main" ref={main}>
          {SECTIONS.map((s) => (
            <section key={s.id} id={`doc-${s.id}`} data-doc-section={s.id} className="docs__section">
              <h2>{s.title}</h2>
              {s.body}
            </section>
          ))}
        </article>
      </div>
    </div>
  )
}
