/** Small shared helpers for the batch views (kept out of component files so fast refresh works). */

const BASE = ['#b5462a', '#2f3a63', '#4f7360', '#b98a2a', '#7a4f8f', '#2a7f8f', '#8f2a5a', '#5a6f2a', '#c2703f', '#3f5fc2']

/** One colour per file, the same in every view. Past ten files, hue steps around the wheel. */
export function fileColor(index: number): string {
  if (index < BASE.length) return BASE[index]
  return `hsl(${(index * 137.508) % 360} 52% 42%)`
}

export const TYPE_COLOR: Record<string, string> = { step: '#b5462a', knee: '#2f3a63', peak: '#4f7360', valley: '#b98a2a' }
export const TYPE_LABEL: Record<string, string> = { step: 'step', knee: 'knee', peak: 'peak', valley: 'valley' }

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

import { useEffect, useRef, useState } from 'react'

/**
 * Fetch whatever `key` names. The result is stored with its key, so a changed key reads as "loading"
 * by comparison during render — no effect has to clear state first. With `keepPrevious` the last
 * good result stays visible while the next one loads.
 */
export function useFetched<T>(key: string, fetcher: () => Promise<T>, opts: { enabled?: boolean; keepPrevious?: boolean } = {}) {
  const { enabled = true, keepPrevious = false } = opts
  const [res, setRes] = useState<{ key: string; data: T | null; error: string | null } | null>(null)
  const last = useRef<T | null>(null)
  const fetchRef = useRef(fetcher)
  useEffect(() => { fetchRef.current = fetcher })
  useEffect(() => {
    if (!enabled) return
    let live = true
    fetchRef.current()
      .then((data) => { if (live) { last.current = data; setRes({ key, data, error: null }) } })
      .catch((e) => { if (live) setRes({ key, data: null, error: (e as Error).message }) })
    return () => { live = false }
  }, [key, enabled])
  const current = res && res.key === key && enabled ? res : null
  return {
    data: current ? current.data : keepPrevious && enabled ? res?.data ?? null : null,
    error: current?.error ?? null,
    loading: enabled && !current,
  }
}
