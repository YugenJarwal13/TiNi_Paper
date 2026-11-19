/**
 * The page.
 *
 * A masthead, one status line, and six numbered panels in the order a reader
 * needs them: the files → one trace → the average → when they snap → the
 * model landscape → the record. Nothing navigates; it is one scroll.
 *
 * `version` bumps when a pipeline run finishes so every panel re-fetches.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Config, type Events, type FileRow, type Summary } from './api/client'
import { useProgress, useResource } from './api/hooks'
import { AveragePanel } from './components/AveragePanel'
import { DatasetPanel } from './components/DatasetPanel'
import { EventsPanel } from './components/EventsPanel'
import { LandscapePanel } from './components/LandscapePanel'
import { StatusStrip } from './components/StatusStrip'
import { SummaryPanel } from './components/SummaryPanel'
import { TracePanel } from './components/TracePanel'
import { InversePage } from './components/inverse/InversePage'
import { ForwardPage } from './components/forward/ForwardPage'
import { InflectWorkspace } from './components/inflect/InflectWorkspace'
import { DocsPage } from './components/docs/DocsPage'
import { fixed } from './lib/format'
import { Fdot } from './components/Math'
import { ErrorBoundary } from './components/ErrorBoundary'

type Route = 'inflect' | 'traces' | 'inverse' | 'forward' | 'docs'

const ROUTES: Route[] = ['inflect', 'traces', 'inverse', 'forward', 'docs']

/** Inflect is the landing page: no hash, or one that names nothing, means Inflect. */
function readRoute(): Route {
  const h = window.location.hash.replace('#', '').split(/[/?]/)[0]
  return (ROUTES as string[]).includes(h) ? (h as Route) : 'inflect'
}

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(readRoute)
  useEffect(() => {
    // Put the landing page in the address bar without adding a history entry.
    if (window.location.hash.replace('#', '').split(/[/?]/)[0] !== readRoute()) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#inflect`)
    }
    const onHash = () => {
      setRoute(readRoute())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

const ROUTE_NAMES: Record<Route, string> = {
  inflect: 'Inflect',
  traces: 'Force traces',
  inverse: 'Inverse model',
  forward: 'Forward model',
  docs: 'Docs',
}

export function App() {
  const route = useRoute()
  return (
    <main className="page">
      <nav className="nav" aria-label="workspaces">
        <a className={`nav__link ${route === 'inflect' ? 'is-on' : ''}`} href="#inflect" aria-current={route === 'inflect' ? 'page' : undefined}>
          Inflect
        </a>
        <a className={`nav__link ${route === 'traces' ? 'is-on' : ''}`} href="#traces" aria-current={route === 'traces' ? 'page' : undefined}>
          Force Traces
        </a>
        <a className={`nav__link ${route === 'inverse' ? 'is-on' : ''}`} href="#inverse" aria-current={route === 'inverse' ? 'page' : undefined}>
          Inverse Model
        </a>
        <a className={`nav__link ${route === 'forward' ? 'is-on' : ''}`} href="#forward" aria-current={route === 'forward' ? 'page' : undefined}>
          Forward Model
        </a>
        <a className={`nav__link ${route === 'docs' ? 'is-on' : ''}`} href="#docs" aria-current={route === 'docs' ? 'page' : undefined}>
          Docs
        </a>
      </nav>
      <ErrorBoundary name={ROUTE_NAMES[route]} key={route}>
        {route === 'inverse' ? (
          <InversePage />
        ) : route === 'forward' ? (
          <ForwardPage />
        ) : route === 'docs' ? (
          <DocsPage />
        ) : route === 'traces' ? (
          <TracesPage />
        ) : (
          <InflectWorkspace />
        )}
      </ErrorBoundary>
    </main>
  )
}

function TracesPage() {
  const { progress, offline, run, cancel } = useProgress()
  const [version, setVersion] = useState(0)
  const wasRunning = useRef(false)
  useEffect(() => {
    if (progress?.running) wasRunning.current = true
    else if (wasRunning.current) {
      wasRunning.current = false
      setVersion((v) => v + 1)
    }
  }, [progress?.running])

  const config = useResource<Config>(() => api.config(), [])
  const summary = useResource<Summary>(() => api.summary(), [], version)
  const files = useResource<{ files: FileRow[] }>(() => api.files(), [], version)
  const available = files.data?.files.filter((f) => f.ok).map((f) => f.trace_id) ?? []

  const [selected, setSelected] = useState<string | null>(null)
  const [events, setEvents] = useState<Events | null>(null)
  const [rate, setRate] = useState<number | null>(null)
  const [fc, setFc] = useState<number | null>(null)

  const select = useCallback((id: string) => {
    setSelected(id)
    document.getElementById('trace')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const cfg = config.data
  const paperRate = cfg && summary.data?.inspection?.paper_rate_match ? summary.data.inspection.paper_rate_match.force_rate_pN_per_ps : null
  const fr = summary.data?.force_rate

  return (
    <>
      <header className="masthead">
        <h1 className="wordmark">TiNi</h1>
        <p className="standfirst">
          One hundred force–time traces of a titanium–nickel crystal pulled at a constant rate, and the cubic free-energy landscape the paper uses to explain
          when each one snaps.
          {fr && (
            <>
              {' '}
              From the files: <b><Fdot /> = {fixed(fr.force_rate_pN_per_ps, 4)} pN/ps</b>
              {paperRate && <> against the paper's {fixed(paperRate, 4)}</>}.
            </>
          )}
        </p>
        <p className="byline">Version 1 · force traces and the cubic landscape · after Maitra &amp; Gururajan, Sci. Rep. 15:3008 (2025)</p>
        <StatusStrip progress={progress} offline={offline} onRun={run} onCancel={cancel} />
      </header>

      <DatasetPanel version={version} selected={selected} onSelect={select} />

      <div id="trace">
        <TracePanel version={version} selected={selected} onSelect={setSelected} available={available} events={events} />
      </div>

      <AveragePanel version={version} defaultWindow={cfg?.settings.force_rate_window_ps ?? 100} paperRate={paperRate} onRate={setRate} />

      <EventsPanel version={version} defaultSmoothing={cfg?.settings.peak_smoothing_points ?? 15} fc={fc} onEvents={setEvents} />

      {cfg && (
        <LandscapePanel
          paramSets={cfg.paper_parameter_sets}
          defaultSet={cfg.settings.default_parameter_set}
          forceRate={rate}
          meanCritForce={events?.f_crit_from_rate_pN.mean ?? null}
          onFc={setFc}
        />
      )}

      <SummaryPanel summary={summary.data} progress={progress} />

      <p className="footnote">
        Data: <code>data/raw/Force_traces/property.T300.*.dat</code> — time [ps], box length [Å], force per atom [pN]. The box length is not the landscape
        coordinate ξ; the two are never used interchangeably here. Backend: FastAPI + NumPy, <code>backend/tini</code>. Checkpoints and static charts:{' '}
        <code>artifacts/</code>.
      </p>
    </>
  )
}
