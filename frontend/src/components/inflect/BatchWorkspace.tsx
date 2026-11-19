/**
 * Inflect's front door: upload many files, watch them analyse, read every
 * result. The batch id is remembered in this browser, so a refresh returns to
 * the same batch and a stopped analysis can be resumed from where it was.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { batches, type BatchFileRecord, type BatchInfo, type BatchSettings, type BatchSpec } from '../../api/inflect'
import { BatchResults } from './BatchResults'
import { BatchUpload, type QueueItem } from './BatchUpload'

const KEY = 'inflect.batch'

function remembered(): string | null {
  try { return window.localStorage.getItem(KEY) } catch { return null }
}
function remember(id: string | null): void {
  try { if (id) window.localStorage.setItem(KEY, id); else window.localStorage.removeItem(KEY) } catch { /* private mode */ }
}

export function BatchWorkspace() {
  const [spec, setSpec] = useState<BatchSpec | null>(null)
  const [recent, setRecent] = useState<{ id: string; title: string; created_at_iso: string; status: string; total: number; percent: number }[]>([])
  const [id, setId] = useState<string | null>(remembered)
  const [info, setInfo] = useState<BatchInfo | null>(null)
  const [files, setFiles] = useState<BatchFileRecord[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<number | null>(null)
  const [poke, setPoke] = useState(0)   // bumped to restart polling after a resume

  useEffect(() => {
    batches.spec().then(setSpec).catch(() => setSpec(null))
    batches.list().then((r) => setRecent(r.batches)).catch(() => setRecent([]))
  }, [id])

  const refresh = useCallback(async (batchId: string) => {
    try {
      const r = await batches.files(batchId)
      setInfo(r.batch)
      setFiles(r.files)
      return r.batch
    } catch (e) {
      const msg = (e as Error).message
      if (/no batch/i.test(msg)) { remember(null); setId(null); setInfo(null) }
      else setError(msg)
      return null
    }
  }, [])

  // Poll while the batch is running; a refresh finds it again by id.
  useEffect(() => {
    if (!id) return
    let live = true
    const tick = async () => {
      const b = await refresh(id)
      if (!live) return
      if (b && b.running) timer.current = window.setTimeout(tick, 1000)
    }
    tick()
    return () => { live = false; if (timer.current) window.clearTimeout(timer.current) }
  }, [id, refresh, poke])

  const start = useCallback(async (items: QueueItem[], settings: Partial<BatchSettings>, title: string) => {
    setUploading(true)
    setError(null)
    setNotice(null)
    setProgress(0)
    try {
      const r = await batches.create(items.map((i) => ({ file: i.file, path: i.path })), { title, settings, start: true }, setProgress)
      if (r.reused) setNotice('These exact files were already uploaded as a batch, so that batch was opened instead of creating a duplicate.')
      remember(r.id)
      setId(r.id)
      setInfo(r.batch)
      setFiles(r.files)
      if (r.reused && !r.batch.running && r.batch.counts.completed < r.batch.total) await batches.analyse(r.id).catch(() => null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }, [])

  const resume = useCallback(async () => {
    if (!id) return
    setBusy(true)
    try {
      await batches.analyse(id)
      await refresh(id)
      setPoke((n) => n + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [id, refresh])

  const cancel = useCallback(async () => { if (id) { await batches.cancel(id); await refresh(id) } }, [id, refresh])
  const reset = () => { remember(null); setId(null); setInfo(null); setFiles([]); setNotice(null) }

  if (id && info) {
    return (
      <>
        {notice && <p className="bp__warn">{notice}</p>}
        {error && <p className="intake__error">{error}</p>}
        <BatchResults info={info} files={files} onResume={resume} onCancel={cancel} onNew={reset} busy={busy} />
      </>
    )
  }
  if (id && !info && !error) return <p className="conf__waiting">Opening your batch…</p>

  return (
    <BatchUpload
      spec={spec} busy={uploading} progress={progress} error={error} onStart={start}
      recent={recent} onOpenRecent={(b) => { remember(b); setError(null); setId(b) }}
    />
  )
}
