"""Everything leaves from the stored results, never from what is on screen.

Every export reads the persisted ``analysis.json`` of every file in the batch,
including the ones that failed or were skipped, so a result can never lose a
file silently: a file with no analysis still gets a row, carrying its status
and its error.
"""

from __future__ import annotations

import io
import json
import time
import zipfile
from typing import Any

import numpy as np
import pandas as pd

from .batch import ALGORITHM_VERSION, Batch

try:                                   # characters Excel refuses to store
    from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
except Exception:                      # pragma: no cover
    ILLEGAL_CHARACTERS_RE = None

SHEETS = ("Summary", "Transitions", "Features", "Regimes", "Quality & Metadata")
CSV_KINDS = {"summary": "Summary", "transitions": "Transitions", "features": "Features",
             "regimes": "Regimes", "quality": "Quality & Metadata"}

NOT_APPLICABLE = "not_applicable"


def _cell(v: Any) -> Any:
    """One spreadsheet cell: scalars as they are, structures as JSON text."""
    if v is None:
        return None
    if isinstance(v, (list, dict, tuple)):
        v = json.dumps(v, default=str, separators=(",", ":"))
    if isinstance(v, (np.floating, float)):
        return float(v) if np.isfinite(v) else None
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, str) and ILLEGAL_CHARACTERS_RE is not None:
        return ILLEGAL_CHARACTERS_RE.sub("", v)
    return v


def _frame(rows: list[dict[str, Any]], columns: list[str]) -> pd.DataFrame:
    df = pd.DataFrame([{k: _cell(r.get(k)) for k in columns} for r in rows], columns=columns)
    return df


def collect(batch: Batch) -> list[tuple[dict[str, Any], dict[str, Any] | None]]:
    """(manifest record, analysis or None) for every file, in upload order."""
    out = []
    for rec in batch.manifest()["files"]:
        a = batch.analysis(rec["file_id"]) if rec["status"] in ("completed", "failed") else None
        out.append((rec, a))
    return out


def tables(batch: Batch) -> dict[str, pd.DataFrame]:
    m = batch.manifest()
    summary_rows, trans_rows, feat_rows, regime_rows, quality_rows = [], [], [], [], []
    for rec, a in collect(batch):
        ok = bool(a and a.get("status") == "completed")
        base = {"file_id": rec["file_id"], "filename": rec["filename"], "relative_path": rec["relative_path"]}
        cols = (a or {}).get("columns") or {}
        feats = (a or {}).get("features") or {}
        trans = (a or {}).get("transitions") or []
        primary = max((t for t in trans if t["type"] == "step"), key=lambda t: abs(t["magnitude"] or 0), default=None) \
            or (trans[0] if trans else None)
        warns = (a or {}).get("warnings") or []
        summary_rows.append({
            **base, "status": rec["status"], "sha256": rec.get("sha256"), "duplicate_of": rec.get("duplicate_of"),
            "point_count": feats.get("point_count"), "x_column": cols.get("x"), "y_column": cols.get("y"),
            "x_unit": cols.get("x_unit"), "y_unit": cols.get("y_unit"),
            "y_min": feats.get("y_min"), "y_max": feats.get("y_max"), "mean": feats.get("mean"),
            "std": feats.get("std"), "noise": feats.get("noise"), "initial_slope": feats.get("initial_slope"),
            "final_slope": feats.get("final_slope"), "n_regimes": feats.get("n_regimes"), "shape": feats.get("shape"),
            "transition_count": len(trans) if ok else None,
            "primary_type": primary and primary["type"], "primary_onset_x": primary and primary["onset_x"],
            "primary_onset_y": primary and primary["onset_y"], "primary_magnitude": primary and primary["magnitude"],
            "primary_direction": primary and primary["direction"],
            "quality_flags": "; ".join(warns) if warns else None,
            "error": rec.get("error"),
        })
        for t in trans:
            trans_rows.append({
                **base, "event_id": t["event_id"], "event_number": t["event_number"], "type": t["type"],
                "detection_method": t["method"], "onset_x": t["onset_x"], "onset_y": t["onset_y"],
                "settled_x": t["settled_x"] if t["settled_x"] is not None else NOT_APPLICABLE,
                "settled_y": t["settled_y"] if t["settled_y"] is not None else NOT_APPLICABLE,
                "magnitude": t["magnitude"], "magnitude_means": (t["evidence"] or {}).get("magnitude_means", "step height"),
                "direction": t["direction"], "width": t.get("width"),
                "confidence": t.get("confidence"), "detector_settings": t.get("detector_settings"),
                "evidence": t.get("evidence"), "classification": t.get("classification"),
            })
        if ok:
            f = dict(feats)
            f["polynomial_fit"] = json.dumps(f.get("polynomial_fit"), default=str)
            feat_rows.append({**base, **f})
            for r in a["regimes"]:
                regime_rows.append({**base, **r})
        q = (a or {}).get("quality") or {}
        quality_rows.append({
            **base, "batch_id": batch.id, "status": rec["status"], "error": rec.get("error"),
            "error_kind": rec.get("error_kind"), "warnings": "; ".join(warns) if warns else None,
            "rows_read": q.get("rows_read"), "rows_used": q.get("rows_used"), "rows_excluded": q.get("rows_excluded"),
            "missing_values": feats.get("missing_value_count"), "infinite_values": feats.get("infinite_value_count"),
            "x_order": q.get("x_order"), "x_sorted_for_analysis": q.get("x_sorted_for_analysis"),
            "dialect": q.get("dialect"), "parse_warnings": q.get("parse_warnings"),
            "x_column": cols.get("x"), "y_column": cols.get("y"), "x_unit": cols.get("x_unit"), "y_unit": cols.get("y_unit"),
            "column_choice": cols.get("chosen_by"), "column_reasoning_x": cols.get("x_reasons"),
            "column_reasoning_y": cols.get("y_reasons"),
            "sha256": rec.get("sha256"), "duplicate_of": rec.get("duplicate_of"), "size_bytes": rec.get("size_bytes"),
            "detector_selection": (a or {}).get("detector_selection"), "analysis_settings": (a or {}).get("settings"),
            "algorithm_version": ((a or {}).get("algorithm") or {}).get("version", ALGORITHM_VERSION),
            "code_hash": ((a or {}).get("algorithm") or {}).get("code_hash"),
        })
    feature_cols = ["file_id", "filename", "relative_path"] + [
        k for k in ("point_count", "valid_row_count", "invalid_value_count", "missing_value_count",
                    "infinite_value_count", "x_min", "x_max", "y_min", "y_max", "mean", "median", "std",
                    "p05", "p25", "p75", "p95", "range", "initial_slope", "final_slope", "maximum_slope",
                    "minimum_slope", "max_abs_curvature", "local_slope_changes", "n_regimes", "shape",
                    "noise", "residual_std", "residual_mad_sigma", "residual_max_abs", "polynomial_fit",
                    "transition_count", "step_count", "knee_count", "peak_count", "valley_count")]
    return {
        "Summary": _frame(summary_rows, ["file_id", "filename", "relative_path", "status", "point_count", "x_column",
                                         "y_column", "x_unit", "y_unit", "y_min", "y_max", "mean", "std", "noise",
                                         "initial_slope", "final_slope", "n_regimes", "shape", "transition_count",
                                         "primary_type", "primary_onset_x", "primary_onset_y", "primary_magnitude",
                                         "primary_direction", "quality_flags", "error", "sha256", "duplicate_of"]),
        "Transitions": _frame(trans_rows, ["file_id", "filename", "relative_path", "event_id", "event_number", "type",
                                           "detection_method", "onset_x", "onset_y", "settled_x", "settled_y",
                                           "magnitude", "magnitude_means", "direction", "width", "confidence",
                                           "classification", "detector_settings", "evidence"]),
        "Features": _frame(feat_rows, feature_cols),
        "Regimes": _frame(regime_rows, ["file_id", "filename", "relative_path", "regime_number", "regime_type", "degree",
                                        "start_index", "end_index", "start_x", "end_x", "points", "coefficients",
                                        "coefficient_basis", "r2", "residual_sigma", "rss", "y_start", "y_end",
                                        "slope_start", "slope_end", "curvature"]),
        "Quality & Metadata": _frame(quality_rows, [
            "file_id", "filename", "relative_path", "batch_id", "status", "error", "error_kind", "warnings", "rows_read",
            "rows_used", "rows_excluded", "missing_values", "infinite_values", "x_order", "x_sorted_for_analysis",
            "dialect", "parse_warnings", "x_column", "y_column", "x_unit", "y_unit", "column_choice",
            "column_reasoning_x", "column_reasoning_y", "sha256", "duplicate_of", "size_bytes",
            "detector_selection", "analysis_settings", "algorithm_version", "code_hash"]),
    }


def workbook_bytes(batch: Batch) -> bytes:
    frames = tables(batch)
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        for name in SHEETS:
            df = frames[name]
            # An empty sheet still carries its header, so the workbook always has the same shape.
            df.to_excel(xw, sheet_name=name[:31], index=False)
            ws = xw.sheets[name[:31]]
            ws.freeze_panes = "A2"
            for i, col in enumerate(df.columns, 1):
                width = max([len(str(col))] + [len(str(v)) for v in df[col].head(200) if v is not None])
                ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = min(48, max(10, width + 2))
    return buf.getvalue()


def csv_bytes(batch: Batch, kind: str) -> bytes:
    if kind not in CSV_KINDS:
        raise KeyError(kind)
    return tables(batch)[CSV_KINDS[kind]].to_csv(index=False).encode("utf-8-sig")


def file_transitions_csv(batch: Batch, file_id: str) -> bytes:
    df = tables(batch)["Transitions"]
    return df[df["file_id"] == file_id].to_csv(index=False).encode("utf-8-sig")


# ------------------------------------------------------------------- plots
def plot_png(a: dict[str, Any]) -> bytes:
    """One file's curve with its detected events, from the stored display copy."""
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure

    fig = Figure(figsize=(7, 4), dpi=130)
    FigureCanvasAgg(fig)
    ax = fig.add_subplot(111)
    cx, cy = np.asarray(a["curve"]["x"], float), np.asarray(a["curve"]["y"], float)
    ax.plot(cx, cy, color="#7c8199", lw=1.0, label="data")
    palette = {"step": "#b5462a", "knee": "#2f3a63", "peak": "#4f7360", "valley": "#b98a2a"}
    seen = set()
    for t in a["transitions"]:
        col = palette.get(t["type"], "#15161d")
        if t["settled_x"] is not None:
            ax.axvspan(t["onset_x"], t["settled_x"], color=col, alpha=0.15, lw=0)
        ax.plot([t["onset_x"]], [t["onset_y"]], "o", color=col, ms=5,
                label=t["type"] if t["type"] not in seen else None)
        seen.add(t["type"])
        if t["settled_x"] is not None and t["settled_y"] is not None:
            ax.plot([t["settled_x"]], [t["settled_y"]], "s", color=col, ms=4, mfc="white")
    c = a["columns"]
    ax.set_xlabel(f"{c['x']} [{c['x_unit']}]" if c.get("x_unit") else c["x"])
    ax.set_ylabel(f"{c['y']} [{c['y_unit']}]" if c.get("y_unit") else c["y"])
    ax.set_title(a["filename"], fontsize=9)
    ax.grid(alpha=0.25)
    if seen:
        ax.legend(fontsize=7, frameon=False)
    fig.tight_layout()
    out = io.BytesIO()
    fig.savefig(out, format="png")
    return out.getvalue()


def plots_zip(batch: Batch) -> bytes:
    buf = io.BytesIO()
    n = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for rec, a in collect(batch):
            if a and a.get("status") == "completed":
                stem = f"{rec['file_id']}_{rec['filename'].rsplit('.', 1)[0]}"
                z.writestr(f"{stem}.png".replace("/", "_"), plot_png(a))
                n += 1
        if n == 0:
            z.writestr("README.txt", "No file in this batch has a completed analysis, so there are no plots.\n")
    return buf.getvalue()


# ------------------------------------------------------------------ report
def report_markdown(batch: Batch) -> bytes:
    pm = batch.public_manifest()
    frames = tables(batch)
    c = pm["counts"]
    lines = [
        f"# Inflect batch report — {pm['title']}", "",
        f"- Batch: `{pm['id']}`", f"- Created: {pm['created_at_iso']}",
        f"- Generated: {time.strftime('%Y-%m-%dT%H:%M:%S')}", f"- Algorithm version: {ALGORITHM_VERSION}",
        f"- Status: **{pm['status']}**", "",
        "## Counts", "",
        f"- Files: {pm['total']} ({c['completed']} completed, {c['failed']} failed, {c['skipped']} skipped)",
        f"- Detected changes: {pm['total_transitions']} (algorithmic detections: steps, knees, peaks, valleys — "
        "not claims about physical transitions)", f"- Duplicate-content files: {pm['n_duplicates']}", "",
        "## Files", "", "| File | Status | Points | Changes | Notes |", "|---|---|---|---|---|",
    ]
    for _, r in frames["Summary"].iterrows():
        note = (r["error"] or r["quality_flags"] or "")
        note = str(note).replace("|", "/").replace("\n", " ")[:140] if note == note and note else ""
        pts = "" if pd.isna(r["point_count"]) else int(r["point_count"])
        tc = "" if pd.isna(r["transition_count"]) else int(r["transition_count"])
        lines.append(f"| {r['relative_path']} | {r['status']} | {pts} | {tc} | {note} |")
    failed = [(r["relative_path"], r["error"]) for _, r in frames["Summary"].iterrows() if r["status"] == "failed"]
    if failed:
        lines += ["", "## Failures", ""] + [f"- `{p}`: {e}" for p, e in failed]
    lines += ["", "## Method", "",
              "Each file was analysed independently with the Inflect engine (locally detrended step statistic over a "
              "ladder of window widths, geometric knee-vs-step test, dynamic-programming regime segmentation). "
              "Confidence values appear only where a bootstrap or stability sweep was actually run.", ""]
    return "\n".join(lines).encode("utf-8")
