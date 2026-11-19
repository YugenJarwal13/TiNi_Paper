/**
 * Inflect, the landing page. Two ways in: a batch of any number of files
 * (the default), or the guided single-file reader that narrates one curve.
 * Both sit on the same analysis engine.
 */

import { useState } from 'react'
import { BatchWorkspace } from './BatchWorkspace'
import { InflectPage } from './InflectPage'

type Mode = 'batch' | 'guided'

export function InflectWorkspace() {
  const [mode, setMode] = useState<Mode>(() => {
    try { return window.sessionStorage.getItem('inflect.mode') === 'guided' ? 'guided' : 'batch' } catch { return 'batch' }
  })
  const choose = (m: Mode) => {
    setMode(m)
    try { window.sessionStorage.setItem('inflect.mode', m) } catch { /* ignore */ }
  }
  return (
    <>
      <div className="iw__modes">
        <div className="seg" role="tablist" aria-label="Inflect mode">
          <button role="tab" aria-selected={mode === 'batch'} className={`seg__btn ${mode === 'batch' ? 'is-on' : ''}`} onClick={() => choose('batch')}>Batch analysis</button>
          <button role="tab" aria-selected={mode === 'guided'} className={`seg__btn ${mode === 'guided' ? 'is-on' : ''}`} onClick={() => choose('guided')}>Guided reader</button>
        </div>
      </div>
      {mode === 'batch' ? (
        <>
          <header className="masthead masthead--inflect">
            <h1 className="wordmark">Inflect</h1>
            <p className="standfirst">
              Upload one file, many files or a whole folder. Every file is read and analysed on its own — its columns, its
              changes, its regimes — and then compared with the rest wherever the comparison is honest.
            </p>
            <p className="byline">Version 4 · batch curve analysis for any tables of numbers</p>
          </header>
          <BatchWorkspace />
        </>
      ) : (
        <InflectPage />
      )}
    </>
  )
}
