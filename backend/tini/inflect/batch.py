"""Many files, one batch.

The rule of this module: **one batch -> N independent file analyses -> one
consolidated collection of results.** Nothing here is a second scientific
engine. Every file is read with ``ingest.read_table``, its columns chosen with
``columns.analyse_columns``, and its curve segmented, measured, narrated and
written into a findings ledger by the same functions the single-file reader
uses. This module only (a) keeps the files and their statuses on disk, (b)
runs the existing analysis on each file on its own, so one bad file cannot
touch another, and (c) gathers the results for comparison and export.

Layout on disk, beside the single-file sessions::

    artifacts/inflect/batches/<batch_id>/
        batch.json                  manifest: files, hashes, statuses, settings
        files/<file_id>/source.<ext>   the uploaded bytes, never modified
        files/<file_id>/analysis.json  that file's complete result
        exports/ logs/

Every write is atomic (``io_atomic``), so a crash, a refresh or a closed laptop
leaves the batch resumable: files already analysed under the same source bytes
and settings are not computed again.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from ..config import Settings
from ..io_atomic import atomic_write_json, json_safe, read_json
from .chorus import ChorusBuilder
from .columns import analyse_columns, smooth_trend
from .ensemble import CurveSummary, analyse_ensemble, summarise_curve
from .findings import build_ledger, ledger_summary
from .ingest import read_table
from .measure import measure
from .record import code_hash
from .segment import MIN_SEGMENT_POINTS, model_curve, prepare, segment_curve
from .sessions import decimate
from .transitions import read_curve

ALGORITHM_VERSION = "4.2-batch"
SUPPORTED_EXTENSIONS = {".csv", ".tsv", ".dat", ".txt", ".tab", ".asc", ".prn", ".out"}
STORED_CURVE_POINTS = 1200
SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")

FILE_TERMINAL = {"completed", "failed", "skipped"}
DETECTORS = ("step", "knee", "extrema")


# ----------------------------------------------------------------- limits
@dataclass
class BatchLimits:
    """Resource limits. Environment variables override the defaults."""

    max_files: int = 2000
    max_file_bytes: int = 64 * 1024 * 1024
    max_total_bytes: int = 512 * 1024 * 1024
    max_rows: int = 500_000
    max_workers: int = 4

    @classmethod
    def from_env(cls) -> "BatchLimits":
        def num(name: str, default: int) -> int:
            try:
                return max(1, int(os.environ.get(name, default)))
            except ValueError:
                return default
        d = cls()
        return cls(
            max_files=num("TINI_BATCH_MAX_FILES", d.max_files),
            max_file_bytes=num("TINI_BATCH_MAX_FILE_BYTES", d.max_file_bytes),
            max_total_bytes=num("TINI_BATCH_MAX_TOTAL_BYTES", d.max_total_bytes),
            max_rows=num("TINI_BATCH_MAX_ROWS", d.max_rows),
            max_workers=num("TINI_BATCH_WORKERS", d.max_workers),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# --------------------------------------------------------------- settings
@dataclass
class BatchSettings:
    """What every file in the batch is analysed with (overridable per file)."""

    x_column: int | None = None          # None: chosen per file by the column ranking
    y_column: int | None = None
    x_scale: float = 1.0
    x_unit: str | None = None
    y_unit: str | None = None
    n_segments: int | None = None
    penalty_scale: float = 1.0
    event_threshold: float = 6.0
    detectors: Any = "auto"              # "auto" or a list drawn from DETECTORS
    with_uncertainty: bool = False       # bootstrap + stability: slow, so opt-in
    n_resamples: int = 40
    skip_duplicates: bool = False
    seed: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any] | None) -> "BatchSettings":
        s = cls(**{k: v for k, v in (d or {}).items() if k in cls.__dataclass_fields__})
        s.validate()
        return s

    def validate(self) -> None:
        if not (0.05 < float(self.penalty_scale) <= 20):
            raise ValueError("penalty_scale must be between 0.05 and 20")
        if not (1.0 <= float(self.event_threshold) <= 50):
            raise ValueError("event_threshold must be between 1 and 50")
        if self.n_segments is not None and not (1 <= int(self.n_segments) <= 12):
            raise ValueError("n_segments must be between 1 and 12")
        if not (20 <= int(self.n_resamples) <= 400):
            raise ValueError("n_resamples must be between 20 and 400")
        if not float(self.x_scale):
            raise ValueError("x_scale cannot be zero")
        if self.detectors != "auto":
            if not isinstance(self.detectors, (list, tuple)) or not all(d in DETECTORS for d in self.detectors):
                raise ValueError(f"detectors must be 'auto' or a list drawn from {list(DETECTORS)}")

    def enabled_detectors(self) -> list[str]:
        return list(DETECTORS) if self.detectors == "auto" else list(self.detectors)

    def segment_kwargs(self, detect_steps: bool) -> dict[str, Any]:
        return {
            "n_segments": self.n_segments,
            "penalty_scale": self.penalty_scale,
            "detect_transitions": detect_steps,
            "event_threshold": self.event_threshold,
        }


class InsufficientData(ValueError):
    """Too few usable rows for any statement about the curve."""


class ColumnAmbiguity(ValueError):
    """No usable pair of columns could be chosen."""


# ----------------------------------------------------------------- helpers
def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _slug(name: str) -> str:
    return (SAFE_NAME.sub("_", name).strip("._") or "file")[:80]


def _clean_relative(path: str, fallback: str) -> str:
    """A relative path that cannot climb out of anywhere."""
    parts = [p for p in re.split(r"[\\/]+", path or "") if p not in ("", ".", "..")]
    return "/".join(parts) if parts else fallback


def _now() -> float:
    return time.time()


def settings_hash(source_sha: str, s: BatchSettings) -> str:
    blob = json.dumps({"src": source_sha, "s": s.to_dict(), "v": ALGORITHM_VERSION}, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:20]


def _f(v: Any) -> float | None:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


# --------------------------------------------------------------- detectors
def window_noise(y: np.ndarray, win: int) -> float:
    """Noise at the scale of the smoothing window, correlation included.

    The standard deviation of a window average is sigma / sqrt(win) only for
    independent noise. Correlated noise or a slow wander makes neighbouring
    window averages differ by more, and the second-difference noise estimate
    cannot see that. Comparing non-overlapping block means measures it
    directly: a real peak must stand out against *that*.
    """
    n = (y.size // win) * win
    if n < 4 * win:
        return float(np.std(y)) or 1e-12
    means = y[:n].reshape(-1, win).mean(axis=1)
    d = np.diff(means)
    return float(1.4826 * np.median(np.abs(d - np.median(d))) / np.sqrt(2.0)) or 1e-12


EXTREMA_NOISE_MULTIPLE = 10.0
EXTREMA_RANGE_FRACTION = 0.1


def detect_extrema(x: np.ndarray, y: np.ndarray, sigma: float,
                   exclude: list[tuple[float, float]]) -> list[dict[str, Any]]:
    """Peaks and valleys of the smoothed curve, away from detected steps.

    A candidate must stand out by ten times the noise at the window scale
    (see ``window_noise``) *and* by a tenth of the curve's range, so noise,
    correlated noise and a wandering baseline do not produce extrema.
    Extrema lying within or beside a detected step are not reported, because a
    step's own overshoot is part of the step. The reported position is that of
    the smoothed curve; it can sit up to about half a window from the raw
    maximum, and an asymmetric peak is pulled towards its broad side.
    """
    from scipy.signal import find_peaks

    n = x.size
    win = max(5, (n // 50) | 1)
    ys = smooth_trend(y, window=win)
    rng = float(np.nanmax(ys) - np.nanmin(ys))
    if not np.isfinite(rng) or rng <= 0:
        return []
    floor = max(EXTREMA_NOISE_MULTIPLE * window_noise(y, win), EXTREMA_RANGE_FRACTION * rng)
    dx = float(np.median(np.diff(x))) if n > 2 else 0.0
    margin = win * dx
    out: list[dict[str, Any]] = []
    for kind, signal in (("peak", ys), ("valley", -ys)):
        idx, props = find_peaks(signal, prominence=floor)
        for i, prom in zip(idx, props["prominences"]):
            xi = float(x[i])
            if any(lo - margin <= xi <= hi + margin for lo, hi in exclude):
                continue
            out.append({
                "kind": kind, "i": int(i), "x": xi, "y": float(ys[i]),
                "prominence": float(prom),
                "prominence_sigma": float(prom / sigma) if sigma > 0 else None,
                "prominence_floor": float(floor), "smoothing_window_points": int(win),
                "position_resolution_x": float(0.5 * win * dx),
            })
    return out


def _slope_stats(x: np.ndarray, y: np.ndarray) -> dict[str, float | None]:
    n = x.size
    head = max(8, int(0.2 * n))

    def fit(a: slice) -> float | None:
        xs, ys = x[a], y[a]
        if xs.size < 3 or np.ptp(xs) == 0:
            return None
        return float(np.polyfit(xs, ys, 1)[0])

    trend = smooth_trend(y, window=max(5, (n // 40) | 1))
    with np.errstate(all="ignore"):
        d = np.gradient(trend, x)
    d = d[np.isfinite(d)]
    return {
        "initial_slope": fit(slice(0, head)),
        "final_slope": fit(slice(n - head, n)),
        "maximum_slope": float(d.max()) if d.size else None,
        "minimum_slope": float(d.min()) if d.size else None,
    }


# ----------------------------------------------------- the one-file analysis
def analyse_file(path: Path, filename: str, s: BatchSettings, limits: BatchLimits,
                 meta: dict[str, Any] | None = None) -> dict[str, Any]:
    """Analyse one file completely, on its own. Raises on failure."""
    t0 = time.time()
    meta = meta or {}
    table = read_table(path, name=filename, max_rows=limits.max_rows + 1)
    if table.n_rows > limits.max_rows:
        raise ValueError(f"file has more than {limits.max_rows:,} rows (the configured limit)")

    rep = analyse_columns(table)
    warnings: list[str] = list(table.warnings)

    xi = s.x_column if s.x_column is not None else rep.recommended_x
    yi = s.y_column if s.y_column is not None else rep.recommended_y
    if xi is not None and yi is None and s.y_column is None:
        # A flat response is a legitimate measurement, not an ambiguity: the
        # ranking gives it no score, but it is still the column to report on.
        others = [c.index for c in table.columns if c.index != xi]
        if others:
            yi = others[0]
            warnings.append(
                f"no column looked like a response; using '{table.columns[yi].label}' (the next column after the axis)")
    for label, idx in (("x", xi), ("y", yi)):
        if idx is not None and not (0 <= idx < table.n_cols):
            raise ColumnAmbiguity(f"{label} column {idx} does not exist; the file has {table.n_cols} columns")
    if xi is None or yi is None:
        raise ColumnAmbiguity("could not decide which columns to use; choose them explicitly")
    if xi == yi:
        raise ColumnAmbiguity("the x and y columns are the same column")

    # Ambiguity is reported, not hidden: a near-tie in the ranking means the
    # recommendation is a suggestion the reader may want to overrule.
    chosen_by = "user" if (s.x_column is not None or s.y_column is not None) else "ranking"
    if chosen_by == "ranking" and len(rep.y_ranking) > 1:
        a, b = rep.stats[rep.y_ranking[0]], rep.stats[rep.y_ranking[1]]
        if a.y_score > 0 and b.y_score >= 0.85 * a.y_score:
            warnings.append(
                f"ambiguous response column: '{a.label}' (chosen) and '{b.label}' score within 15% of each other")

    xc, yc = table.columns[xi], table.columns[yi]
    x_unit = s.x_unit or xc.unit
    y_unit = s.y_unit or yc.unit
    xr = table.data[:, xi] * (s.x_scale or 1.0)
    yr = table.data[:, yi]

    n_rows = int(xr.size)
    bad_x = ~np.isfinite(xr)
    bad_y = ~np.isfinite(yr)
    good = ~(bad_x | bad_y)
    n_nan = int((np.isnan(xr) | np.isnan(yr)).sum())
    n_inf = int((np.isinf(xr) | np.isinf(yr)).sum())
    n_invalid = int((~good).sum())
    if n_invalid:
        warnings.append(
            f"{n_invalid} of {n_rows} rows excluded: {n_nan} with missing values, {n_inf} with infinite values "
            f"(policy: rows with a non-finite x or y are dropped, never replaced)")
    x, y = xr[good], yr[good]
    if x.size < 2 * MIN_SEGMENT_POINTS:
        raise InsufficientData(
            f"only {x.size} usable rows; at least {2 * MIN_SEGMENT_POINTS} are needed for an analysis")

    dx = np.diff(x)
    if (dx > 0).all():
        x_order = "increasing"
    elif (dx < 0).all():
        x_order = "decreasing"
    else:
        x_order = "not monotonic"
    x_sorted = x_order != "increasing"
    if x_sorted:
        warnings.append(
            f"x is {x_order}; analysis ran on the points ordered by x (the uploaded file is unchanged)")
    xs, ys = prepare(x, y)
    n = int(xs.size)

    enabled = s.enabled_detectors()
    reasons: list[str] = []
    if s.detectors == "auto":
        reasons.append("auto: step, knee and extrema detectors all run; each reports zero or more events")
    else:
        reasons.append(f"manual: {', '.join(enabled) or 'no detectors'} selected by the user")
    seg = segment_curve(xs, ys, **s.segment_kwargs("step" in enabled))
    sigma = float(seg.sigma)

    # --- events -----------------------------------------------------------
    transitions: list[dict[str, Any]] = []
    detector_settings = {
        "event_threshold": s.event_threshold, "penalty_scale": s.penalty_scale,
        "n_segments": s.n_segments, "detectors": enabled,
    }

    step_bounds = [b for b in seg.boundaries if b.kind == "transition"]
    for k, b in enumerate(step_bounds):
        ev = next((e for e in seg.events if abs(e.x0 - b.x_lo) < 1e-12 and abs(e.x1 - b.x_hi) < 1e-12), None)
        transitions.append({
            "type": "step", "method": "local_detrended_step",
            "onset_x": b.x_lo, "onset_y": b.y_before,
            "settled_x": b.x_hi, "settled_y": b.y_after,
            "magnitude": b.gap, "direction": "upward" if b.gap > 0 else "downward",
            "width": b.width, "confidence": None, "finding_key": f"transition.{k}",
            "evidence": {
                "step_in_noise_units": b.gap_sigma, "sharpness": b.sharpness,
                "peak_slope": ev.peak_slope if ev else None,
                "test": "locally detrended step over a ladder of window widths, then the geometric knee-vs-step cross test",
            },
        })
    if "knee" in enabled:
        for b in seg.boundaries:
            if b.kind != "knee":
                continue
            transitions.append({
                "type": "knee", "method": "knee_change_point",
                "onset_x": b.x, "onset_y": 0.5 * (b.y_before + b.y_after),
                "settled_x": None, "settled_y": None,
                "magnitude": b.slope_after - b.slope_before, "direction": "upward" if b.slope_after > b.slope_before else "downward",
                "width": None, "confidence": None, "finding_key": None,
                "evidence": {"slope_before": b.slope_before, "slope_after": b.slope_after,
                             "slope_ratio": b.slope_ratio, "left_model": b.left_model, "right_model": b.right_model,
                             "test": "slope change at a dynamic-programming breakpoint (value continuous)",
                             "magnitude_means": "change of slope"},
            })
    if "extrema" in enabled:
        spans = [(e.x0, e.x1) for e in seg.events]
        for e in detect_extrema(xs, ys, sigma, spans):
            transitions.append({
                "type": e["kind"], "method": "local_extrema",
                "onset_x": e["x"], "onset_y": e["y"], "settled_x": None, "settled_y": None,
                "magnitude": e["prominence"], "direction": "not_applicable",
                "width": None, "confidence": None, "finding_key": None,
                "evidence": {"prominence": e["prominence"], "prominence_in_noise_units": e["prominence_sigma"],
                             "prominence_floor": e["prominence_floor"],
                             "smoothing_window_points": e["smoothing_window_points"],
                             "position_resolution_x": e["position_resolution_x"],
                             "test": "prominence of a local extremum of the smoothed curve, against 10x the window-scale noise and 10% of the range",
                             "magnitude_means": "prominence"},
            })
    transitions.sort(key=lambda t: t["onset_x"])
    for i, t in enumerate(transitions, 1):
        t["event_id"] = f"event_{i:03d}"
        t["event_number"] = i
        t["detector_settings"] = detector_settings
        t["classification"] = "algorithmic_detection"
        t["interpretation"] = None   # a physical reading is the researcher's, never assumed here

    # --- optional uncertainty --------------------------------------------
    unc = stab = None
    if s.with_uncertainty:
        from .uncertainty import bootstrap_curve, stability_sweep
        try:
            unc = bootstrap_curve(xs, ys, seg, n_resamples=s.n_resamples, seed=s.seed,
                                  **s.segment_kwargs("step" in enabled))
            stab = stability_sweep(xs, ys, seg, x_unit=x_unit, **s.segment_kwargs("step" in enabled))
        except Exception as exc:   # an interval that cannot be computed is reported, not invented
            warnings.append(f"uncertainty not computed: {exc}")
    if unc is not None:
        for t in transitions:
            key = t.get("finding_key")
            if key and f"{key}.position" in unc.keyed:
                iv = unc.keyed[f"{key}.position"]
                ci = iv.get("ci")
                t["confidence"] = {
                    "detection_rate": unc.detection_rate, "position_ci": ci,
                    "position_median": iv.get("median"),
                    "estimate_inside_ci": bool(ci and ci[0] <= t["onset_x"] <= ci[1]),
                    "interval_biased": bool(iv.get("biased")),
                    "n_resamples_used": unc.n_used, "stability_holds": bool(stab.holds) if stab else None,
                    "method": "moving-block bootstrap of residuals; whole reading re-derived each time",
                    "interpretation": ("spread of the detector under resampled noise, not a guarantee of accuracy; "
                                       "the interval can sit to one side of the estimate (added noise moves the "
                                       "detected onset earlier), in which case use its width and the detection "
                                       "rate as stability indicators"),
                }

    # --- features ---------------------------------------------------------
    fit = model_curve(xs, seg)
    resid = ys - fit
    r1 = float(np.corrcoef(resid[:-1], resid[1:])[0, 1]) if resid.size > 8 and np.std(resid) > 0 else 0.0
    correlated = bool(np.isfinite(r1) and r1 > 0.3)
    if correlated:
        warnings.append(
            f"residuals are correlated (lag-1 autocorrelation {r1:.2f}): the noise estimate is probably too small, so "
            f"knees may be over-reported; treat knee events as doubtful unless a bootstrap supports them")
        for t in transitions:
            if t["type"] in ("knee", "peak", "valley"):
                t["reliability"] = "doubtful: correlated residuals"
    pct = np.percentile(ys, [5, 25, 50, 75, 95])
    poly: dict[str, Any] = {}
    for deg in (1, 2):
        try:
            c = np.polyfit(xs, ys, deg)
            pred = np.polyval(c, xs)
            ss_tot = float(((ys - ys.mean()) ** 2).sum())
            poly[f"degree_{deg}"] = {
                "coefficients_highest_first": [float(v) for v in c],
                "r2": float(1 - ((ys - pred) ** 2).sum() / ss_tot) if ss_tot > 0 else None,
            }
        except Exception:
            poly[f"degree_{deg}"] = None
    slopes = _slope_stats(xs, ys)
    curvs = [abs(g.curvature) for g in seg.segments]
    mad = float(np.median(np.abs(resid - np.median(resid))))
    n_by_type = {k: sum(1 for t in transitions if t["type"] == k) for k in ("step", "knee", "peak", "valley")}
    features = {
        "point_count": n_rows, "valid_row_count": int(good.sum()), "invalid_value_count": n_invalid,
        "missing_value_count": n_nan, "infinite_value_count": n_inf,
        "x_min": float(xs.min()), "x_max": float(xs.max()),
        "y_min": float(ys.min()), "y_max": float(ys.max()),
        "mean": float(ys.mean()), "median": float(np.median(ys)), "std": float(ys.std()),
        "p05": float(pct[0]), "p25": float(pct[1]), "p75": float(pct[3]), "p95": float(pct[4]),
        "range": float(np.ptp(ys)),
        **slopes,
        "max_abs_curvature": float(max(curvs)) if curvs else None,
        "local_slope_changes": n_by_type["knee"],
        "n_regimes": len(seg.segments), "shape": seg.shape,
        "polynomial_fit": poly,
        "noise": sigma, "residual_std": float(resid.std()), "residual_mad_sigma": 1.4826 * mad,
        "residual_max_abs": float(np.abs(resid).max()),
        "residual_lag1_autocorrelation": r1,
        "transition_count": len(transitions),
        "step_count": n_by_type["step"], "knee_count": n_by_type["knee"],
        "peak_count": n_by_type["peak"], "valley_count": n_by_type["valley"],
    }
    if features["range"] > 0 and sigma > 0 and features["range"] < 6 * sigma:
        warnings.append("curve range is under six noise levels: any transition here would be unreliable")
    if not transitions:
        warnings.append("no transition detected (a valid result: the curve shows none under these settings)")

    regimes = []
    for i, g in enumerate(seg.segments, 1):
        regimes.append({
            "regime_number": i, "regime_type": g.model, "degree": g.degree,
            "start_index": g.i0, "end_index": g.i1, "start_x": g.x0, "end_x": g.x1, "points": g.n,
            "coefficients": g.coeffs, "coefficient_basis": f"powers of (x - {g.x_mid:.6g}), lowest first",
            "r2": g.r2, "residual_sigma": g.sigma, "rss": g.rss,
            "y_start": g.y_start, "y_end": g.y_end, "slope_start": g.slope_start, "slope_end": g.slope_end,
            "curvature": g.curvature,
        })

    # --- narration, findings, ensemble summary ----------------------------
    reading = None
    try:
        reading = read_curve(xs, ys, seg, x_label=xc.name, y_label=yc.name, x_unit=x_unit, y_unit=y_unit).to_dict()
    except Exception as exc:
        warnings.append(f"narration unavailable: {exc}")
    ledger = build_ledger(
        xs, ys, seg, xc.name, yc.name, x_unit, y_unit,
        uncertainty=unc.keyed if unc else None, stability=stab.keyed if stab else None,
        settings=s.segment_kwargs("step" in enabled))
    findings = [f.to_dict() for f in ledger]
    summary = summarise_curve(filename, xs, ys, seg=seg).to_dict()

    cx, cy = decimate(xs, ys, STORED_CURVE_POINTS)
    return json_safe({
        "status": "completed",
        "columns": {
            "x": xc.name, "y": yc.name, "x_unit": x_unit, "y_unit": y_unit,
            "x_index": xi, "y_index": yi, "chosen_by": chosen_by,
            "recommended_x": rep.recommended_x, "recommended_y": rep.recommended_y,
            "x_reasons": rep.stats[xi].x_reasons, "y_reasons": rep.stats[yi].y_reasons,
            "headline": rep.headline, "x_scale": s.x_scale,
        },
        "features": features,
        "transitions": transitions,
        "regimes": regimes,
        "findings": findings,
        "findings_summary": ledger_summary(ledger),
        "reading": reading,
        "summary": summary,
        "detector_selection": {"mode": "auto" if s.detectors == "auto" else "manual",
                               "enabled": enabled, "reasons": reasons},
        "quality": {
            "rows_read": n_rows, "rows_used": int(good.sum()), "rows_excluded": n_invalid,
            "x_order": x_order, "x_sorted_for_analysis": x_sorted,
            "dialect": table.dialect.to_dict(), "n_columns": table.n_cols,
            "parse_warnings": table.warnings, "comment_lines": table.comment_lines[:6],
            "exclusion_policy": "rows with a non-finite x or y are excluded and counted; no value is imputed",
        },
        "warnings": warnings,
        "settings": s.to_dict(),
        "algorithm": {"version": ALGORITHM_VERSION, "code_hash": code_hash()},
        "curve": {"x": cx, "y": cy, "decimated": len(cx) < n, "n_full": n,
                  "note": "display copy only; every number above comes from the full-resolution data"},
        "elapsed_s": round(time.time() - t0, 3),
        **{k: v for k, v in meta.items() if k in ("file_id", "filename", "relative_path", "sha256")},
    })


# ------------------------------------------------------------------ store
_locks: dict[str, threading.RLock] = {}
_locks_guard = threading.Lock()


def _lock_for(batch_id: str) -> threading.RLock:
    with _locks_guard:
        return _locks.setdefault(batch_id, threading.RLock())


def batches_root(settings: Settings) -> Path:
    return Path(settings.artifacts_path) / "inflect" / "batches"


def derive_status(files: list[dict[str, Any]], running: bool, started: bool) -> str:
    if running:
        return "processing"
    if not started:
        return "created"
    pending = [f for f in files if f["status"] not in FILE_TERMINAL]
    if pending:
        return "processing"          # interrupted: resumable
    done = [f for f in files if f["status"] == "completed"]
    failed = [f for f in files if f["status"] == "failed"]
    if not failed:
        return "completed"
    return "completed_with_errors" if done else "failed"


class Batch:
    """Read/write access to one stored batch."""

    def __init__(self, settings: Settings, batch_id: str):
        self.settings = settings
        self.id = batch_id
        self.root = batches_root(settings) / batch_id
        self.lock = _lock_for(batch_id)

    @property
    def manifest_path(self) -> Path:
        return self.root / "batch.json"

    def exists(self) -> bool:
        # The atomic writer briefly moves the manifest aside; the kept copy counts.
        with self.lock:
            return self.manifest_path.exists() or self.manifest_path.with_name("batch.json.prev").exists()

    def file_dir(self, file_id: str) -> Path:
        return self.root / "files" / Path(file_id).name

    # ------------------------------------------------------------ creation
    @classmethod
    def create(cls, settings: Settings, uploads: list[dict[str, Any]], title: str,
               batch_settings: BatchSettings, limits: BatchLimits) -> "Batch":
        """``uploads``: dicts with filename, relative_path, data (bytes) or error."""
        bid = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]
        b = cls(settings, bid)
        (b.root / "files").mkdir(parents=True, exist_ok=True)
        (b.root / "exports").mkdir(exist_ok=True)
        (b.root / "logs").mkdir(exist_ok=True)

        records: list[dict[str, Any]] = []
        seen: dict[str, str] = {}
        for i, up in enumerate(uploads, 1):
            fid = f"file_{i:04d}"
            name = up["filename"]
            ext = Path(name).suffix.lower()
            rec: dict[str, Any] = {
                "file_id": fid, "filename": name, "relative_path": up["relative_path"], "ext": ext,
                "size_bytes": up.get("size", 0), "sha256": None, "status": "queued",
                "validation": {"ok": True, "message": ""}, "duplicate_of": None,
                "error": None, "error_kind": None, "message": "", "analysis_hash": None,
                "n_transitions": None, "n_warnings": None, "updated_at": _now(),
            }
            if up.get("error"):
                rec.update(status=up.get("status", "failed"), error=up["error"], error_kind=up.get("error_kind", "rejected"),
                           validation={"ok": False, "message": up["error"]})
            else:
                data: bytes = up["data"]
                rec["sha256"] = sha256_bytes(data)
                rec["size_bytes"] = len(data)
                d = b.file_dir(fid)
                d.mkdir(parents=True, exist_ok=True)
                (d / f"source{ext}").write_bytes(data)
                if rec["sha256"] in seen:
                    rec["duplicate_of"] = seen[rec["sha256"]]
                else:
                    seen[rec["sha256"]] = fid
                if not data.strip():
                    rec.update(status="failed", error="the file is empty", error_kind="empty",
                               validation={"ok": False, "message": "empty file"})
                else:
                    try:
                        read_table(data, name=name, max_rows=400)
                    except Exception as exc:     # corrupt or not a table: a per-file error
                        rec.update(status="failed", error=f"could not be read as a numeric table: {exc}",
                                   error_kind="parse", validation={"ok": False, "message": str(exc)})
                    else:
                        rec["validation"] = {"ok": True, "message": "readable numeric table"}
                    if rec["status"] == "queued" and rec["duplicate_of"] and batch_settings.skip_duplicates:
                        rec.update(status="skipped", error=f"identical content to {rec['duplicate_of']}",
                                   error_kind="duplicate")
            records.append(rec)

        fp = hashlib.sha256("|".join(sorted(f"{r['relative_path']}:{r['sha256']}" for r in records)).encode()).hexdigest()[:24]
        b.write_manifest({
            "id": bid, "title": title or "Untitled batch", "created_at": _now(),
            "created_at_iso": time.strftime("%Y-%m-%dT%H:%M:%S"), "fingerprint": fp,
            "algorithm_version": ALGORITHM_VERSION, "settings": batch_settings.to_dict(),
            "file_overrides": {}, "limits": limits.to_dict(), "started": False, "files": records,
        })
        return b

    # ------------------------------------------------------------ manifest
    def write_manifest(self, m: dict[str, Any]) -> None:
        with self.lock:
            atomic_write_json(self.manifest_path, m)

    def manifest(self) -> dict[str, Any]:
        with self.lock:      # writers hold the lock across the replace, so a reader never sees the gap
            m = read_json(self.manifest_path, default=None)
            if m is None:
                m = read_json(self.manifest_path.with_name("batch.json.prev"), default=None)
        if m is None:
            raise FileNotFoundError(f"no batch {self.id}")
        return m

    def update_file(self, file_id: str, **fields: Any) -> None:
        with self.lock:
            m = self.manifest()
            for f in m["files"]:
                if f["file_id"] == file_id:
                    f.update(fields)
                    f["updated_at"] = _now()
                    break
            self.write_manifest(m)

    def update(self, **fields: Any) -> dict[str, Any]:
        with self.lock:
            m = self.manifest()
            m.update(fields)
            self.write_manifest(m)
            return m

    def recover(self) -> int:
        """Files left mid-analysis by a stopped process go back in the queue."""
        if runner.is_running(self.id):
            return 0
        with self.lock:
            m = self.manifest()
            n = 0
            for f in m["files"]:
                if f["status"] in ("parsing", "analysing"):
                    f.update(status="queued", message="interrupted; will resume")
                    n += 1
            if n:
                self.write_manifest(m)
            return n

    def settings_for(self, file_id: str) -> BatchSettings:
        m = self.manifest()
        base = dict(m.get("settings", {}))
        base.update(m.get("file_overrides", {}).get(file_id, {}))
        return BatchSettings.from_dict(base)

    # ------------------------------------------------------------- results
    def analysis(self, file_id: str) -> dict[str, Any] | None:
        p = self.file_dir(file_id) / "analysis.json"
        a = read_json(p, default=None)
        return a if a is not None else read_json(p.with_name("analysis.json.prev"), default=None)

    def source_path(self, rec: dict[str, Any]) -> Path:
        return self.file_dir(rec["file_id"]) / f"source{rec['ext']}"

    def public_manifest(self) -> dict[str, Any]:
        """Lightweight status for polling: counts, progress and file rows."""
        m = self.manifest()
        files = m["files"]
        running = runner.is_running(self.id)
        counts = {k: 0 for k in ("queued", "parsing", "analysing", "completed", "failed", "skipped")}
        for f in files:
            counts[f["status"]] = counts.get(f["status"], 0) + 1
        total = len(files)
        finished = counts["completed"] + counts["failed"] + counts["skipped"]
        return {
            "id": self.id, "title": m["title"], "created_at_iso": m["created_at_iso"],
            "status": derive_status(files, running, bool(m.get("started"))),
            "running": running, "algorithm_version": m.get("algorithm_version"),
            "settings": m["settings"], "limits": m.get("limits"),
            "counts": counts, "total": total, "finished": finished,
            "percent": round(100.0 * finished / total, 1) if total else 0.0,
            "total_transitions": sum(f.get("n_transitions") or 0 for f in files if f["status"] == "completed"),
            "total_size_bytes": sum(f.get("size_bytes") or 0 for f in files),
            "n_duplicates": sum(1 for f in files if f.get("duplicate_of")),
            "fingerprint": m.get("fingerprint"),
        }


def open_batch(settings: Settings, batch_id: str) -> Batch:
    b = Batch(settings, Path(batch_id).name)
    if not b.exists():
        raise FileNotFoundError(f"no batch {batch_id}")
    b.recover()
    return b


def list_batches(settings: Settings, limit: int = 50) -> list[dict[str, Any]]:
    root = batches_root(settings)
    if not root.exists():
        return []
    out = []
    for d in sorted(root.iterdir(), reverse=True):
        if not (d / "batch.json").exists():
            continue
        try:
            out.append(Batch(settings, d.name).public_manifest())
        except Exception:
            continue
        if len(out) >= limit:
            break
    return [{k: p[k] for k in ("id", "title", "created_at_iso", "status", "total", "counts", "percent")} for p in out]


def find_existing(settings: Settings, fingerprint: str) -> Batch | None:
    root = batches_root(settings)
    if not root.exists():
        return None
    for d in sorted(root.iterdir(), reverse=True):
        m = read_json(d / "batch.json", default=None)
        if m and m.get("fingerprint") == fingerprint:
            return Batch(settings, d.name)
    return None


# ------------------------------------------------------------------ runner
class BatchRunner:
    """Runs batches on a bounded worker pool, one background thread per batch."""

    def __init__(self) -> None:
        self._threads: dict[str, threading.Thread] = {}
        self._cancel: dict[str, threading.Event] = {}
        self._guard = threading.Lock()

    def is_running(self, batch_id: str) -> bool:
        t = self._threads.get(batch_id)
        return bool(t and t.is_alive())

    def cancel(self, batch_id: str) -> None:
        ev = self._cancel.get(batch_id)
        if ev:
            ev.set()

    def start(self, batch: Batch, limits: BatchLimits, file_ids: list[str] | None = None,
              force: bool = False) -> bool:
        with self._guard:
            if self.is_running(batch.id):
                return False
            ev = threading.Event()
            self._cancel[batch.id] = ev
            # Decide what to run before returning so the response is accurate.
            todo = self.plan(batch, file_ids, force)
            batch.update(started=True)
            t = threading.Thread(target=self._work, args=(batch, limits, todo, ev), daemon=True)
            self._threads[batch.id] = t
            t.start()
            return True

    @staticmethod
    def plan(batch: Batch, file_ids: list[str] | None, force: bool) -> list[str]:
        """Files that need computing: queued, interrupted, changed, or asked for."""
        m = batch.manifest()
        s = BatchSettings.from_dict(m["settings"])
        todo: list[str] = []
        for f in m["files"]:
            fid = f["file_id"]
            if file_ids is not None and fid not in file_ids:
                continue
            kind = f.get("error_kind")
            if f["status"] == "skipped":
                if kind == "duplicate" and not s.skip_duplicates:
                    batch.update_file(fid, status="queued", error=None, error_kind=None, message="")
                    todo.append(fid)
                continue
            if f["status"] == "failed":
                # Upload-time rejections stay rejected; analysis failures retry
                # only when asked for (a retry of the same bytes would fail again).
                if kind in ("empty", "parse", "rejected", "oversize", "unsupported"):
                    continue
                if force or (file_ids is not None):
                    todo.append(fid)
                continue
            if f["status"] == "completed":
                cur = settings_hash(f["sha256"], batch.settings_for(fid))
                if force or f.get("analysis_hash") != cur or batch.analysis(fid) is None:
                    todo.append(fid)
                continue
            if f["status"] == "queued" and f.get("duplicate_of") and s.skip_duplicates:
                batch.update_file(fid, status="skipped", error=f"identical content to {f['duplicate_of']}",
                                  error_kind="duplicate")
                continue
            todo.append(fid)
        for fid in todo:
            batch.update_file(fid, status="queued", message="waiting")
        return todo

    def _one(self, batch: Batch, limits: BatchLimits, fid: str, cancel: threading.Event) -> None:
        if cancel.is_set():
            return
        m = batch.manifest()
        rec = next(f for f in m["files"] if f["file_id"] == fid)
        d = batch.file_dir(fid)
        try:
            batch.update_file(fid, status="parsing", message="reading the file", error=None, error_kind=None)
            s = batch.settings_for(fid)
            h = settings_hash(rec["sha256"], s)
            batch.update_file(fid, status="analysing", message="detecting, segmenting, measuring")
            result = analyse_file(batch.source_path(rec), rec["filename"], s, limits, {
                "file_id": fid, "filename": rec["filename"],
                "relative_path": rec["relative_path"], "sha256": rec["sha256"]})
            result["analysis_hash"] = h
            atomic_write_json(d / "analysis.json", result)
            atomic_write_json(d / "features.json", result["features"])
            atomic_write_json(d / "transitions.json", result["transitions"])
            atomic_write_json(d / "regimes.json", result["regimes"])
            ft, cols = result["features"], result["columns"]
            main = max((t for t in result["transitions"] if t["type"] == "step"),
                       key=lambda t: abs(t["magnitude"] or 0), default=None) or (
                result["transitions"][0] if result["transitions"] else None)
            digest = json_safe({
                "x": cols["x"], "y": cols["y"], "x_unit": cols["x_unit"], "y_unit": cols["y_unit"],
                "point_count": ft["point_count"], "range": ft["range"], "noise": ft["noise"],
                "n_regimes": ft["n_regimes"], "shape": ft["shape"],
                "primary_type": main and main["type"], "primary_onset_x": main and main["onset_x"],
                "primary_magnitude": main and main["magnitude"],
            })
            batch.update_file(fid, status="completed", message="", analysis_hash=h, digest=digest,
                              n_transitions=len(result["transitions"]), n_warnings=len(result["warnings"]))
        except Exception as exc:
            kind = ("insufficient_data" if isinstance(exc, InsufficientData)
                    else "columns" if isinstance(exc, ColumnAmbiguity) else "analysis")
            failure = {"status": "failed", "file_id": fid, "filename": rec["filename"],
                       "relative_path": rec["relative_path"], "sha256": rec["sha256"],
                       "error": f"{type(exc).__name__}: {exc}", "error_kind": kind,
                       "warnings": [], "transitions": [], "regimes": [], "features": None}
            try:
                atomic_write_json(d / "analysis.json", failure)
            except Exception:
                pass
            batch.update_file(fid, status="failed", message="", error=f"{type(exc).__name__}: {exc}",
                              error_kind=kind, n_transitions=None, analysis_hash=None)

    def _work(self, batch: Batch, limits: BatchLimits, todo: list[str], cancel: threading.Event) -> None:
        try:
            workers = max(1, min(limits.max_workers, len(todo) or 1))
            with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="inflect-batch") as pool:
                # Submitted in chunks so a large batch never has more than a few
                # files in flight, however many are queued.
                chunk = workers * 4
                for i in range(0, len(todo), chunk):
                    if cancel.is_set():
                        break
                    futs = [pool.submit(self._one, batch, limits, fid, cancel) for fid in todo[i:i + chunk]]
                    for fu in futs:
                        fu.result()
        except Exception as exc:    # the runner itself must never die silently
            try:
                with open(batch.root / "logs" / "runner.log", "a", encoding="utf-8") as fh:
                    fh.write(f"{time.strftime('%H:%M:%S')} {type(exc).__name__}: {exc}\n")
            except OSError:
                pass


runner = BatchRunner()


# ------------------------------------------------------------------- plots
def _group_key(a: dict[str, Any]) -> str:
    c = a["columns"]
    return " | ".join([(c["x"] or "").strip().lower(), (c["y"] or "").strip().lower(),
                       (c.get("x_unit") or "").strip(), (c.get("y_unit") or "").strip()])


def completed_analyses(batch: Batch) -> list[dict[str, Any]]:
    out = []
    for f in batch.manifest()["files"]:
        if f["status"] == "completed":
            a = batch.analysis(f["file_id"])
            if a and a.get("status") == "completed":
                out.append(a)
    return out


def compatibility_groups(analyses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for a in analyses:
        k = _group_key(a)
        c = a["columns"]
        g = groups.setdefault(k, {
            "key": k, "x": c["x"], "y": c["y"], "x_unit": c.get("x_unit"), "y_unit": c.get("y_unit"),
            "file_ids": [], "units_declared": bool(c.get("x_unit") or c.get("y_unit"))})
        g["file_ids"].append(a["file_id"])
    out = sorted(groups.values(), key=lambda g: -len(g["file_ids"]))
    for g in out:
        g["count"] = len(g["file_ids"])
    return out


def build_plots(batch: Batch, group: str | None = None, max_points: int = 600,
                ids: list[str] | None = None, max_curves: int = 300) -> dict[str, Any]:
    """Plot data for one compatible group, or (``group='__all__'``) for any files by id.

    The all-files form is for the individual-plots grid, where every file is
    drawn on its own axes and mixing units is not an issue. Overlay and cohort
    statistics only ever use one compatible group.
    """
    analyses = completed_analyses(batch)
    groups = compatibility_groups(analyses)
    every = group == "__all__"
    explanation = None
    if len(groups) > 1:
        explanation = ("These files do not share the same x/y variables and units, so they are not drawn on common "
                       "axes. Pick a group to compare; every file is still available individually.")
    chosen = None if every else next((g for g in groups if g["key"] == group), groups[0] if groups else None)
    if every:
        members = [a for a in analyses if ids is None or a["file_id"] in ids]
    else:
        members = [a for a in analyses if chosen and a["file_id"] in chosen["file_ids"]
                   and (ids is None or a["file_id"] in ids)]
    n_members = len(members)

    curves = []
    for a in members[:max_curves]:
        cx, cy = np.asarray(a["curve"]["x"], float), np.asarray(a["curve"]["y"], float)
        dx, dy = decimate(cx, cy, max_points) if cx.size > max_points else (cx.tolist(), cy.tolist())
        curves.append({
            "file_id": a["file_id"], "filename": a["filename"], "relative_path": a.get("relative_path"),
            "x": dx, "y": dy,
            "transitions": [{k: t.get(k) for k in ("event_id", "type", "direction", "onset_x", "onset_y",
                                                    "settled_x", "settled_y", "magnitude")}
                            for t in a["transitions"]],
        })

    cohort: dict[str, Any] | None = None
    cohort_note = None
    if every:
        cohort_note = None
    elif len(members) >= 3:
        builder = ChorusBuilder()
        sums = []
        for a in members:
            tx = next((t["onset_x"] for t in sorted(a["transitions"], key=lambda t: -abs(t["magnitude"] or 0))
                       if t["type"] == "step"), None)
            builder.add(a["filename"], np.asarray(a["curve"]["x"], float), np.asarray(a["curve"]["y"], float), tx)
            sd = {k: (float("nan") if v is None else v) for k, v in a["summary"].items()}
            sums.append(CurveSummary(**sd))
        rep = analyse_ensemble(sums).to_dict()
        c = chosen
        cohort = {"chorus": builder.build(c["x"], c["y"], c["x_unit"], c["y_unit"]).to_dict(),
                  "ensemble": {k: rep[k] for k in ("n_ok", "stats", "outliers", "groups", "headline")}}
    elif chosen:
        cohort_note = "A cohort needs at least three comparable curves."

    transitions = []
    for a in analyses:
        for t in a["transitions"]:
            transitions.append({
                "file_id": a["file_id"], "filename": a["filename"], "group": _group_key(a),
                **{k: t.get(k) for k in ("event_id", "type", "direction", "onset_x", "onset_y", "settled_x",
                                         "settled_y", "magnitude", "confidence")}})
    return json_safe({
        "groups": groups, "group": "__all__" if every else (chosen["key"] if chosen else None),
        "incompatible_explanation": explanation, "n_in_selection": n_members,
        "truncated": n_members > max_curves, "max_curves": max_curves,
        "curves": curves, "cohort": cohort, "cohort_note": cohort_note, "transitions": transitions,
        "x_label": chosen["x"] if chosen else None, "y_label": chosen["y"] if chosen else None,
        "x_unit": chosen["x_unit"] if chosen else None, "y_unit": chosen["y_unit"] if chosen else None,
        "display_note": f"curves are drawn from a display copy thinned to at most {max_points} points that keeps "
                        f"local extremes; all measurements use the full-resolution data",
    })
