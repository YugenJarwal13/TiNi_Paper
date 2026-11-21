"""Version 4.2 — batches: many files, each analysed on its own."""

from __future__ import annotations

import io
import json
import time
import zipfile

import numpy as np
import pandas as pd
import pytest

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from tini import api  # noqa: E402
from tini.inflect import batch as ib  # noqa: E402

X = np.linspace(0, 10, 500)


def table(y, x=X, header="t,sig", delim=",") -> bytes:
    rows = [header.replace(",", delim)] + [f"{a}{delim}{b}" for a, b in zip(x, y)]
    return ("\n".join(rows) + "\n").encode()


def step_y(seed=0, at=6.0):
    return np.where(X < at, -2 * X, -2 * at + 9.0) + np.random.default_rng(seed).normal(0, 0.05, X.size)


def two_steps(seed=0):
    return np.where(X < 3, -X, np.where(X < 7, -X + 8, -X - 8)) + np.random.default_rng(seed).normal(0, 0.05, X.size)


def peak_y(seed=0):
    return 5 * np.exp(-((X - 5) / 1.0) ** 2) + np.random.default_rng(seed).normal(0, 0.05, X.size)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(api.settings, "artifacts_dir", str(tmp_path))
    return TestClient(api.app)


def create(client, files, start=True, settings=None, **extra):
    multipart = [("files", (name, io.BytesIO(data), "text/plain")) for name, data in files]
    data = {"title": "t", "start": str(start).lower(), "force_new": "true", **extra}
    if settings:
        data["settings_json"] = json.dumps(settings)
    paths = [("relative_paths", name) for name, _ in files]
    r = client.post("/api/inflect/batches", files=multipart, data={**data, "relative_paths": [n for n, _ in files]})
    assert r.status_code == 200, r.text
    return r.json()


def wait(client, bid, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        m = client.get(f"/api/inflect/batches/{bid}").json()
        if not m["running"] and m["finished"] == m["total"]:
            return m
        time.sleep(0.05)
    raise AssertionError(f"batch did not finish: {m}")


def analysis(client, bid, fid):
    return client.get(f"/api/inflect/batches/{bid}/files/{fid}").json()["analysis"]


# ------------------------------------------------------------ creation
def test_batch_gets_unique_ids_and_a_manifest(client):
    r = create(client, [("a.csv", table(step_y(0))), ("b.csv", table(step_y(1)))], start=False)
    assert r["batch"]["status"] == "created"
    ids = [f["file_id"] for f in r["files"]]
    assert len(set(ids)) == 2 and all(f["sha256"] and len(f["sha256"]) == 64 for f in r["files"])
    assert client.get(f"/api/inflect/batches/{r['id']}/files").json()["batch"]["total"] == 2


def test_two_batches_never_share_an_id(client):
    a = create(client, [("a.csv", table(step_y()))], start=False)
    b = create(client, [("a.csv", table(step_y()))], start=False)
    assert a["id"] != b["id"]


def test_duplicate_filenames_do_not_overwrite(client):
    r = create(client, [("sub1/run.csv", table(step_y(0, 4))), ("sub2/run.csv", table(step_y(1, 7)))])
    wait(client, r["id"])
    a0 = analysis(client, r["id"], "file_0001")
    a1 = analysis(client, r["id"], "file_0002")
    assert a0["transitions"][0]["onset_x"] == pytest.approx(4.0, abs=0.3)
    assert a1["transitions"][0]["onset_x"] == pytest.approx(7.0, abs=0.3)
    assert a0["relative_path"] != a1["relative_path"]


def test_duplicate_content_is_detected_and_can_be_skipped(client):
    data = table(step_y())
    r = create(client, [("a.csv", data), ("b.csv", data)], start=False)
    assert r["files"][1]["duplicate_of"] == r["files"][0]["file_id"]
    r2 = create(client, [("a.csv", data), ("b.csv", data)], settings={"skip_duplicates": True})
    wait(client, r2["id"])
    files = client.get(f"/api/inflect/batches/{r2['id']}/files").json()["files"]
    assert [f["status"] for f in files] == ["completed", "skipped"]


def test_same_upload_again_returns_the_existing_batch(client):
    files = [("a.csv", table(step_y())), ("b.csv", table(step_y(1)))]
    multipart = lambda: [("files", (n, io.BytesIO(d), "text/plain")) for n, d in files]  # noqa: E731
    first = client.post("/api/inflect/batches", files=multipart(), data={"relative_paths": ["a.csv", "b.csv"]}).json()
    again = client.post("/api/inflect/batches", files=multipart(), data={"relative_paths": ["a.csv", "b.csv"]}).json()
    assert again["reused"] and again["id"] == first["id"]


def test_folder_paths_are_kept_and_cannot_escape(client):
    multipart = [("files", ("a.csv", io.BytesIO(table(step_y())), "text/plain"))]
    r = client.post("/api/inflect/batches", files=multipart,
                    data={"relative_paths": ["../../evil/run1/a.csv"], "force_new": "true"}).json()
    assert r["files"][0]["relative_path"] == "evil/run1/a.csv"


def test_unsupported_empty_and_corrupt_files_are_per_file_problems(client):
    r = create(client, [
        ("good.csv", table(step_y())), ("notes.pdf", b"%PDF"), ("empty.csv", b""),
        ("junk.dat", b"\x00\x01\x02\x03" * 40),
    ])
    wait(client, r["id"])
    by = {f["filename"]: f for f in client.get(f"/api/inflect/batches/{r['id']}/files").json()["files"]}
    assert by["good.csv"]["status"] == "completed"
    assert by["notes.pdf"]["status"] == "skipped" and by["notes.pdf"]["error_kind"] == "unsupported"
    assert by["empty.csv"]["status"] == "failed" and by["empty.csv"]["error_kind"] == "empty"
    assert by["junk.dat"]["status"] == "failed" and by["junk.dat"]["error_kind"] == "parse"


def test_resource_limits_are_enforced(client, monkeypatch):
    monkeypatch.setattr(api, "_BATCH_LIMITS", ib.BatchLimits(max_files=2, max_file_bytes=1000))
    big = [("a.csv", table(step_y())), ("b.csv", b"1,2\n")]
    r = create(client, big, start=False)
    by = {f["filename"]: f for f in r["files"]}
    assert by["a.csv"]["error_kind"] == "oversize" and by["a.csv"]["status"] == "failed"
    many = [("f%d.csv" % i, b"1,2\n") for i in range(3)]
    resp = client.post("/api/inflect/batches", files=[("files", (n, io.BytesIO(d), "text/plain")) for n, d in many])
    assert resp.status_code == 400


# ------------------------------------------------------------ analysis
def test_every_file_is_analysed_independently_with_the_full_schema(client):
    r = create(client, [("a.csv", table(step_y(0, 4))), ("b.csv", table(two_steps())), ("c.tsv", table(step_y(2, 7), delim="\t"))])
    m = wait(client, r["id"])
    assert m["status"] == "completed" and m["counts"]["completed"] == 3
    for fid in ("file_0001", "file_0002", "file_0003"):
        a = analysis(client, r["id"], fid)
        assert a["status"] == "completed"
        for key in ("columns", "features", "transitions", "regimes", "findings", "warnings", "quality", "algorithm", "curve"):
            assert key in a
        assert a["features"]["point_count"] == 500
        assert a["columns"]["x"] == "t" and a["columns"]["y"] == "sig"
    assert len(analysis(client, r["id"], "file_0002")["transitions"]) == 2     # multiple events in one file
    assert analysis(client, r["id"], "file_0003")["transitions"][0]["onset_x"] == pytest.approx(7.0, abs=0.3)


def test_transition_events_record_method_settings_and_evidence(client):
    r = create(client, [("a.csv", table(step_y()))])
    wait(client, r["id"])
    t = analysis(client, r["id"], "file_0001")["transitions"][0]
    assert t["type"] == "step" and t["direction"] == "upward" and t["method"] == "local_detrended_step"
    assert t["evidence"]["step_in_noise_units"] > 4
    assert t["detector_settings"]["event_threshold"] == 6.0
    assert t["confidence"] is None                       # never invented
    assert t["classification"] == "algorithmic_detection" and t["interpretation"] is None


def test_downward_step_peak_and_knee_each_get_their_own_detector(client):
    down = np.where(X < 5, X, X - 8) + np.random.default_rng(1).normal(0, 0.05, X.size)
    knee = np.where(X < 5, X, 5 + 4 * (X - 5)) + np.random.default_rng(2).normal(0, 0.05, X.size)
    r = create(client, [("down.csv", table(down)), ("peak.csv", table(peak_y())), ("knee.csv", table(knee))])
    wait(client, r["id"])
    d = analysis(client, r["id"], "file_0001")["transitions"]
    assert d[0]["type"] == "step" and d[0]["direction"] == "downward"
    p = [t["type"] for t in analysis(client, r["id"], "file_0002")["transitions"]]
    assert "peak" in p
    k = analysis(client, r["id"], "file_0003")["transitions"]
    assert [t["type"] for t in k] == ["knee"] and k[0]["onset_x"] == pytest.approx(5.0, abs=0.3)


def test_manual_detector_selection_is_honoured_and_recorded(client):
    r = create(client, [("p.csv", table(peak_y()))], settings={"detectors": ["step"]})
    wait(client, r["id"])
    a = analysis(client, r["id"], "file_0001")
    assert a["detector_selection"]["mode"] == "manual" and a["detector_selection"]["enabled"] == ["step"]
    assert all(t["type"] == "step" for t in a["transitions"])


def test_constant_noise_and_tiny_files_behave(client):
    flat = np.full(500, 3.0)
    noise = np.random.default_rng(5).normal(0, 1, 500)
    r = create(client, [("flat.csv", table(flat)), ("noise.csv", table(noise)), ("tiny.csv", table([1, 2, 3, 4, 5], x=[1, 2, 3, 4, 5]))])
    wait(client, r["id"])
    flat_a = analysis(client, r["id"], "file_0001")
    assert flat_a["status"] == "completed" and flat_a["transitions"] == []        # success, zero events
    assert analysis(client, r["id"], "file_0002")["transitions"] == []            # no invented transition
    tiny = analysis(client, r["id"], "file_0003")
    assert tiny["status"] == "failed" and tiny["error_kind"] == "insufficient_data"


def test_nan_inf_and_non_monotonic_x_are_reported_not_hidden(client):
    y = step_y()
    rows = ["t,sig"] + [f"{a},{b}" for a, b in zip(X, y)]
    rows[10] = f"{X[9]},nan"
    rows[20] = f"{X[19]},inf"
    r = create(client, [("dirty.csv", ("\n".join(rows) + "\n").encode()),
                        ("shuffled.csv", table(y[::-1], x=X[::-1].copy()[::1])),
                        ("scrambled.csv", table(y[np.r_[1, 0, 2:500]], x=X[np.r_[1, 0, 2:500]]))])
    wait(client, r["id"])
    a = analysis(client, r["id"], "file_0001")
    assert a["features"]["invalid_value_count"] == 2 and a["quality"]["rows_excluded"] == 2
    assert any("excluded" in w for w in a["warnings"])
    assert analysis(client, r["id"], "file_0002")["quality"]["x_order"] == "decreasing"
    s = analysis(client, r["id"], "file_0003")
    assert s["quality"]["x_sorted_for_analysis"] and any("ordered by x" in w for w in s["warnings"])


def test_different_delimiters_and_column_names_are_resolved_per_file(client):
    r = create(client, [("semi.csv", table(step_y(), header="time,stress", delim=";")),
                        ("pipe.dat", table(step_y(), header="strain,force", delim="|"))])
    wait(client, r["id"])
    a, b = analysis(client, r["id"], "file_0001"), analysis(client, r["id"], "file_0002")
    assert (a["columns"]["x"], a["columns"]["y"]) == ("time", "stress")
    assert (b["columns"]["x"], b["columns"]["y"]) == ("strain", "force")
    assert a["quality"]["dialect"]["delimiter"] == "semicolon"


def test_one_failing_file_does_not_stop_the_others(client, monkeypatch):
    real = ib.analyse_file

    def flaky(path, filename, s, limits, meta=None):
        if filename == "boom.csv":
            raise RuntimeError("synthetic crash")
        return real(path, filename, s, limits, meta)

    monkeypatch.setattr(ib, "analyse_file", flaky)
    r = create(client, [("a.csv", table(step_y())), ("boom.csv", table(step_y(1))), ("c.csv", table(step_y(2)))])
    m = wait(client, r["id"])
    assert m["status"] == "completed_with_errors"
    assert m["counts"]["completed"] == 2 and m["counts"]["failed"] == 1
    assert "synthetic crash" in analysis(client, r["id"], "file_0002")["error"]


def test_a_batch_of_failures_only_is_failed():
    files = [{"status": "failed"}, {"status": "failed"}]
    assert ib.derive_status(files, running=False, started=True) == "failed"
    assert ib.derive_status(files + [{"status": "completed"}], False, True) == "completed_with_errors"
    assert ib.derive_status([{"status": "queued"}], False, False) == "created"
    assert ib.derive_status([{"status": "queued"}], True, True) == "processing"


def test_large_batch_runs_in_bounded_chunks(client):
    files = [(f"f{i:03d}.csv", table(step_y(i, 3 + (i % 5)))) for i in range(40)]
    r = create(client, files)
    m = wait(client, r["id"], timeout=180)
    assert m["counts"]["completed"] == 40 and m["percent"] == 100.0


# ----------------------------------------------------- persistence & resume
def test_reanalysis_skips_unchanged_files_and_recomputes_changed_settings(client):
    r = create(client, [("a.csv", table(step_y()))])
    wait(client, r["id"])
    first = analysis(client, r["id"], "file_0001")["elapsed_s"]
    stamp = client.get(f"/api/inflect/batches/{r['id']}/files").json()["files"][0]["updated_at"]
    out = client.post(f"/api/inflect/batches/{r['id']}/analyse").json()
    wait(client, r["id"])
    assert client.get(f"/api/inflect/batches/{r['id']}/files").json()["files"][0]["updated_at"] == stamp
    assert analysis(client, r["id"], "file_0001")["elapsed_s"] == first
    client.post(f"/api/inflect/batches/{r['id']}/analyse", json={"settings": {"penalty_scale": 2.0}})
    wait(client, r["id"])
    assert analysis(client, r["id"], "file_0001")["settings"]["penalty_scale"] == 2.0


def test_interrupted_files_are_requeued_and_resume(client, tmp_path):
    r = create(client, [("a.csv", table(step_y())), ("b.csv", table(step_y(1)))], start=False)
    b = ib.open_batch(api.settings, r["id"])
    b.update(started=True)
    b.update_file("file_0001", status="analysing")      # as if the process died mid-file
    assert ib.open_batch(api.settings, r["id"]).public_manifest()["counts"]["queued"] == 2
    client.post(f"/api/inflect/batches/{r['id']}/analyse")
    m = wait(client, r["id"])
    assert m["counts"]["completed"] == 2


def test_batch_survives_a_fresh_process_view(client):
    r = create(client, [("a.csv", table(step_y()))])
    wait(client, r["id"])
    listed = client.get("/api/inflect/batches").json()["batches"]
    assert any(b["id"] == r["id"] for b in listed)
    reopened = ib.Batch(api.settings, r["id"])
    assert reopened.analysis("file_0001")["status"] == "completed"


def test_unknown_batch_and_file_are_404s(client):
    assert client.get("/api/inflect/batches/nope").status_code == 404
    r = create(client, [("a.csv", table(step_y()))], start=False)
    assert client.get(f"/api/inflect/batches/{r['id']}/files/file_9999").status_code == 404
    assert client.get("/api/inflect/batches/..%2f..%2fx/files").status_code == 404


def test_bad_settings_are_a_400(client):
    r = create(client, [("a.csv", table(step_y()))], start=False)
    assert client.post(f"/api/inflect/batches/{r['id']}/analyse", json={"settings": {"penalty_scale": -1}}).status_code == 400
    assert client.post(f"/api/inflect/batches/{r['id']}/analyse", json={"settings": {"detectors": ["nope"]}}).status_code == 400


def test_uncertainty_fills_confidence_only_when_asked(client):
    r = create(client, [("a.csv", table(step_y()))], settings={"with_uncertainty": True, "n_resamples": 20})
    wait(client, r["id"])
    t = analysis(client, r["id"], "file_0001")["transitions"][0]
    assert t["confidence"] and t["confidence"]["position_ci"] is not None


# ------------------------------------------------------------- plots
def test_plots_group_compatible_curves_and_refuse_to_mix_units(client):
    r = create(client, [("a.csv", table(step_y(0))), ("b.csv", table(step_y(1))), ("c.csv", table(step_y(2))),
                        ("odd.csv", table(step_y(3), header="time [s],force [pN]"))])
    wait(client, r["id"])
    p = client.get(f"/api/inflect/batches/{r['id']}/plots").json()
    assert len(p["groups"]) == 2 and p["incompatible_explanation"]
    assert p["groups"][0]["count"] == 3 and len(p["curves"]) == 3            # the largest group by default
    assert p["cohort"] and p["cohort"]["chorus"]["measured"]
    odd = client.get(f"/api/inflect/batches/{r['id']}/plots", params={"group": p["groups"][1]["key"]}).json()
    assert len(odd["curves"]) == 1 and odd["cohort"] is None and odd["cohort_note"]
    assert len(p["transitions"]) == 4                                          # every file's events


def test_plot_payload_is_downsampled_but_keeps_the_events(client):
    x = np.linspace(0, 10, 20000)
    y = np.where(x < 6, -2 * x, -3.0) + np.random.default_rng(0).normal(0, 0.05, x.size)
    r = create(client, [("big.csv", table(y, x=x))])
    wait(client, r["id"])
    p = client.get(f"/api/inflect/batches/{r['id']}/plots", params={"max_points": 300}).json()
    assert len(p["curves"][0]["x"]) <= 320
    a = analysis(client, r["id"], "file_0001")
    assert a["features"]["point_count"] == 20000 and a["curve"]["n_full"] == 20000
    assert p["curves"][0]["transitions"]


# ------------------------------------------------------------ exports
def test_workbook_has_every_sheet_and_every_file_even_failures(client):
    r = create(client, [("a.csv", table(two_steps())), ("flat.csv", table(np.full(500, 1.0))),
                        ("empty.csv", b""), ("x.pdf", b"%PDF")])
    wait(client, r["id"])
    resp = client.get(f"/api/inflect/batches/{r['id']}/export")
    assert resp.status_code == 200 and resp.headers["content-disposition"].endswith('Inflect_Batch_Results.xlsx"')
    sheets = pd.read_excel(io.BytesIO(resp.content), sheet_name=None)
    assert list(sheets) == ["Summary", "Transitions", "Features", "Regimes", "Quality & Metadata"]
    summ = sheets["Summary"]
    assert len(summ) == 4 and set(summ["status"]) == {"completed", "failed", "skipped"}
    assert summ.loc[summ.filename == "empty.csv", "error"].iloc[0] == "the file is empty"
    tr = sheets["Transitions"]
    assert len(tr) == 2 and set(tr["file_id"]) == {"file_0001"}                # one row per event
    assert len(sheets["Features"]) == 2 and len(sheets["Regimes"]) >= 3
    q = sheets["Quality & Metadata"]
    assert len(q) == 4 and q["batch_id"].iloc[0] == r["id"]


def test_workbook_with_no_transitions_or_results_does_not_crash(client):
    r = create(client, [("flat.csv", table(np.full(500, 1.0))), ("empty.csv", b"")])
    wait(client, r["id"])
    sheets = pd.read_excel(io.BytesIO(client.get(f"/api/inflect/batches/{r['id']}/export").content), sheet_name=None)
    assert len(sheets["Transitions"]) == 0 and "event_id" in sheets["Transitions"].columns
    only_bad = create(client, [("empty.csv", b"")])
    wait(client, only_bad["id"])
    sheets = pd.read_excel(io.BytesIO(client.get(f"/api/inflect/batches/{only_bad['id']}/export").content), sheet_name=None)
    assert len(sheets["Summary"]) == 1 and len(sheets["Features"]) == 0


def test_csv_zip_report_and_per_file_exports(client):
    r = create(client, [("a.csv", table(step_y())), ("b.csv", table(two_steps())), ("bad.csv", b"")])
    wait(client, r["id"])
    base = f"/api/inflect/batches/{r['id']}"
    for kind, rows in (("summary", 3), ("transitions", 3), ("features", 2), ("quality", 3)):
        df = pd.read_csv(io.BytesIO(client.get(f"{base}/export/{kind}.csv").content))
        assert len(df) == rows, kind
    assert client.get(f"{base}/export/bogus.csv").status_code == 400
    z = zipfile.ZipFile(io.BytesIO(client.get(f"{base}/export/plots.zip").content))
    assert len(z.namelist()) == 2 and all(n.endswith(".png") for n in z.namelist())
    assert z.read(z.namelist()[0])[:4] == b"\x89PNG"
    rep = client.get(f"{base}/export/report.md").text
    assert "bad.csv" in rep and "failed" in rep
    assert client.get(f"{base}/files/file_0001/plot.png").content[:4] == b"\x89PNG"
    assert client.get(f"{base}/files/file_0003/plot.png").status_code == 404
    js = client.get(f"{base}/files/file_0002/analysis.json").json()
    assert len(js["transitions"]) == 2
    assert len(pd.read_csv(io.BytesIO(client.get(f"{base}/files/file_0002/transitions.csv").content))) == 2


def test_stored_source_and_hash_are_untouched(client):
    data = table(step_y())
    r = create(client, [("a.csv", data)])
    wait(client, r["id"])
    b = ib.Batch(api.settings, r["id"])
    rec = b.manifest()["files"][0]
    assert b.source_path(rec).read_bytes() == data
    assert rec["sha256"] == ib.sha256_bytes(data)


# ===================================================== scientific checks
def _events(client, data, **settings):
    r = create(client, [("f.csv", data)], settings=settings or None)
    wait(client, r["id"])
    return analysis(client, r["id"], "file_0001")


def test_structureless_noise_yields_no_events(client):
    for seed in range(8):
        a = _events(client, table(np.random.default_rng(seed).normal(0, 1, 500)))
        assert a["status"] == "completed" and a["transitions"] == [], seed


def test_correlated_noise_gives_no_peaks_and_doubtful_knees(client):
    rng = np.random.default_rng(3)
    e = rng.normal(0, 1, 500)
    y = np.zeros(500)
    for i in range(1, 500):
        y[i] = 0.9 * y[i - 1] + e[i]
    a = _events(client, table(y))
    assert not [t for t in a["transitions"] if t["type"] in ("peak", "valley")]
    assert any("residuals are correlated" in w for w in a["warnings"])
    assert all(t.get("reliability") for t in a["transitions"])        # every knee is flagged


def test_peak_position_is_accurate_and_records_its_resolution(client):
    errs = []
    for seed in range(6):
        y = 5 * np.exp(-((X - 5) / 1.0) ** 2) + np.random.default_rng(seed).normal(0, 0.3, 500)
        pk = [t for t in _events(client, table(y))["transitions"] if t["type"] == "peak"]
        assert len(pk) == 1
        errs.append(pk[0]["onset_x"] - 5)
    assert max(abs(e) for e in errs) < 0.25
    ev = pk[0]["evidence"]
    assert ev["position_resolution_x"] > 0 and ev["prominence_floor"] > 0 and ev["smoothing_window_points"] >= 5


def test_step_onsets_are_accurate_and_the_overlay_aligns_on_them(client):
    ats = [3.2, 4.1, 5.0, 5.9, 6.8]
    r = create(client, [(f"s{i}.csv", table(step_y(i, at))) for i, at in enumerate(ats)])
    wait(client, r["id"])
    onsets = [analysis(client, r["id"], f"file_{i + 1:04d}")["transitions"][0]["onset_x"] for i in range(5)]
    assert np.max(np.abs(np.array(onsets) - ats)) < 0.15
    # the overlay (and cohort alignment) shift each curve by the onset of its main step, so the
    # plotted markers must carry exactly these values
    p = client.get(f"/api/inflect/batches/{r['id']}/plots").json()
    plotted = [c["transitions"][0]["onset_x"] for c in p["curves"]]
    assert sorted(plotted) == pytest.approx(sorted(onsets), abs=1e-9)
    assert p["cohort"]["chorus"]["aligned"] is not None


def test_long_curves_locate_a_step_where_it_is(client):
    x = np.linspace(0, 10, 100_000)
    y = np.where(x < 6, -2 * x, -3.0) + np.random.default_rng(0).normal(0, 0.05, x.size)
    a = _events(client, table(y, x=x))
    assert a["transitions"][0]["onset_x"] == pytest.approx(6.0, abs=0.1)
    assert a["features"]["point_count"] == 100_000


def test_bootstrap_confidence_is_honest_about_its_own_bias(client):
    a = _events(client, table(step_y(1, 5.0)), with_uncertainty=True, n_resamples=40)
    t = a["transitions"][0]
    assert t["onset_x"] == pytest.approx(5.0, abs=0.15)                  # the estimate is accurate
    c = t["confidence"]
    assert 0 <= c["detection_rate"] <= 1 and c["n_resamples_used"] > 0
    assert c["position_ci"][0] <= c["position_ci"][1]
    assert isinstance(c["estimate_inside_ci"], bool) and isinstance(c["interval_biased"], bool)
    assert "not a guarantee" in c["interpretation"]
    noise = _events(client, table(np.random.default_rng(1).normal(0, 1, 500)), with_uncertainty=True, n_resamples=20)
    assert noise["transitions"] == []                                      # no event, so no confidence invented


# ============================================================ scale & isolation
def test_a_hundred_and_fifty_files_complete_with_bounded_workers(client):
    x = np.linspace(0, 10, 200)
    files = []
    for i in range(150):
        y = np.where(x < 3 + (i % 5), -2 * x, -2 * (3 + i % 5) + 5) + np.random.default_rng(i).normal(0, 0.05, 200)
        files.append((f"d{i // 50}/f{i:03d}.csv", table(y, x=x)))
    files += [("bad1.csv", b""), ("bad2.csv", b"\x00" * 64), ("x.pdf", b"%PDF")]
    r = create(client, files)
    m = wait(client, r["id"], timeout=300)
    assert m["counts"]["completed"] == 150 and m["counts"]["failed"] == 2 and m["counts"]["skipped"] == 1
    assert m["status"] == "completed_with_errors"
    sheets = pd.read_excel(io.BytesIO(client.get(f"/api/inflect/batches/{r['id']}/export").content), sheet_name=None)
    assert len(sheets["Summary"]) == 153 and len(sheets["Transitions"]) >= 150


def test_large_single_file_respects_the_row_limit_and_otherwise_completes(client, monkeypatch):
    x = np.linspace(0, 10, 60_000)
    y = np.where(x < 6, -2 * x, -3.0) + np.random.default_rng(0).normal(0, 0.05, x.size)
    data = table(y, x=x)
    monkeypatch.setattr(api, "_BATCH_LIMITS", ib.BatchLimits(max_rows=10_000))
    r = create(client, [("big.csv", data)])
    wait(client, r["id"])
    a = analysis(client, r["id"], "file_0001")
    assert a["status"] == "failed" and "limit" in a["error"]
    monkeypatch.setattr(api, "_BATCH_LIMITS", ib.BatchLimits())
    r = create(client, [("big.csv", data)])
    wait(client, r["id"], timeout=120)
    assert analysis(client, r["id"], "file_0001")["status"] == "completed"


def test_simultaneous_batches_stay_isolated(client):
    import threading
    ids = {}

    def make(k):
        at = 3.0 + 2 * k
        ids[k] = create(client, [(f"b{k}_{j}.csv", table(step_y(j, at))) for j in range(4)])["id"]

    threads = [threading.Thread(target=make, args=(k,)) for k in range(3)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    for k in range(3):
        wait(client, ids[k], timeout=120)
        files = client.get(f"/api/inflect/batches/{ids[k]}/files").json()["files"]
        assert len(files) == 4 and all(f["filename"].startswith(f"b{k}_") for f in files)
        for f in files:
            a = analysis(client, ids[k], f["file_id"])
            assert a["transitions"][0]["onset_x"] == pytest.approx(3.0 + 2 * k, abs=0.3)


def test_cancel_then_resume_finishes_every_file(client, monkeypatch):
    real = ib.analyse_file

    def slow(path, filename, s, limits, meta=None):
        time.sleep(0.15)
        return real(path, filename, s, limits, meta)

    monkeypatch.setattr(ib, "analyse_file", slow)
    r = create(client, [(f"f{i}.csv", table(step_y(i))) for i in range(24)])
    time.sleep(0.4)
    client.post(f"/api/inflect/batches/{r['id']}/cancel")
    for _ in range(100):
        if not client.get(f"/api/inflect/batches/{r['id']}").json()["running"]:
            break
        time.sleep(0.1)
    mid = client.get(f"/api/inflect/batches/{r['id']}").json()
    assert 0 < mid["counts"]["completed"] < 24 and mid["status"] == "processing"      # resumable, not failed
    stamps = {f["file_id"]: f["updated_at"] for f in client.get(f"/api/inflect/batches/{r['id']}/files").json()["files"]
              if f["status"] == "completed"}
    client.post(f"/api/inflect/batches/{r['id']}/analyse")
    m = wait(client, r["id"], timeout=120)
    assert m["counts"]["completed"] == 24
    after = {f["file_id"]: f["updated_at"] for f in client.get(f"/api/inflect/batches/{r['id']}/files").json()["files"]}
    assert all(after[k] == v for k, v in stamps.items())                               # finished files were not redone


# ============================================================== histograms
def test_each_file_gets_four_histograms_from_its_full_data(client):
    r = create(client, [("a.csv", table(step_y(0, 6.0))), ("b.csv", table(step_y(1, 4.0)))])
    wait(client, r["id"])
    out = client.get(f"/api/inflect/batches/{r['id']}/histograms/files", params={"ids": "file_0001,file_0002"}).json()["files"]
    assert [f["file_id"] for f in out] == ["file_0001", "file_0002"]
    for f in out:
        h = f["histograms"]
        assert set(h) >= {"values", "increments", "residuals", "spacing"}
        assert sum(h["values"]["counts"]) == h["values"]["n"] == 500           # every value counted
        assert len(h["values"]["edges"]) == len(h["values"]["counts"]) + 1
        assert h["spacing"]["constant"] is True and h["spacing"]["counts"] == [499]
        # the step is one huge increment: it is reported as outside the drawn range, not hidden
        assert h["increments"]["n_outside"] >= 1
        assert h["increments"]["n"] + h["increments"]["n_outside"] == h["increments"]["n_total"] == 499
        assert h["residuals"]["n"] + h["residuals"]["n_outside"] == 500
        assert f["columns"]["x"] == "t"


def test_cross_file_histograms_hold_one_number_per_file(client):
    ats = [3.0, 3.5, 4.0, 4.5, 5.0, 5.5]
    r = create(client, [(f"s{i}.csv", table(step_y(i, at))) for i, at in enumerate(ats)])
    wait(client, r["id"])
    c = client.get(f"/api/inflect/batches/{r['id']}/histograms/cross").json()
    assert [m["key"] for m in c["measures"]] == ["peak_value", "peak_position", "step_size", "transition_position"]
    assert c["n_in_group"] == 6 and c["n_stale"] == 0
    pos = next(m for m in c["measures"] if m["key"] == "transition_position")
    assert pos["n_values"] == 6 and sum(pos["histogram"]["counts"]) == 6
    assert pos["histogram"]["min"] == pytest.approx(min(ats), abs=0.2) and pos["histogram"]["max"] == pytest.approx(max(ats), abs=0.2)
    step = next(m for m in c["measures"] if m["key"] == "step_size")
    assert step["histogram"]["median"] > 0                                   # these steps all go up
    peak = next(m for m in c["measures"] if m["key"] == "peak_value")
    a = analysis(client, r["id"], "file_0001")
    assert peak["histogram"]["n"] == 6 and a["histograms"]["scalars"]["peak_value"] == pytest.approx(a["features"]["y_max"])


def test_one_file_has_no_cross_file_histogram_and_files_without_a_step_are_counted(client):
    r = create(client, [("only.csv", table(step_y()))])
    wait(client, r["id"])
    c = client.get(f"/api/inflect/batches/{r['id']}/histograms/cross").json()
    assert all(m["histogram"] is None for m in c["measures"])                # needs at least two values
    r = create(client, [("a.csv", table(step_y(0))), ("b.csv", table(step_y(1, 4.0))),
                        ("flat.csv", table(np.full(500, 2.0)))])
    wait(client, r["id"])
    c = client.get(f"/api/inflect/batches/{r['id']}/histograms/cross").json()
    pos = next(m for m in c["measures"] if m["key"] == "transition_position")
    assert pos["n_values"] == 2 and pos["n_without"] == 1                    # the flat file has no step to measure


def test_cross_file_histograms_never_mix_incompatible_files(client):
    r = create(client, [("a.csv", table(step_y(0))), ("b.csv", table(step_y(1))), ("c.csv", table(step_y(2))),
                        ("o.csv", table(step_y(3), header="time [s],force [pN]"))])
    wait(client, r["id"])
    c = client.get(f"/api/inflect/batches/{r['id']}/histograms/cross").json()
    assert len(c["groups"]) == 2 and c["n_in_group"] == 3 and c["incompatible_explanation"]
    other = client.get(f"/api/inflect/batches/{r['id']}/histograms/cross", params={"group": c["groups"][1]["key"]}).json()
    assert other["n_in_group"] == 1


def test_histogram_endpoints_handle_failed_old_and_bad_requests(client):
    r = create(client, [("a.csv", table(step_y())), ("empty.csv", b"")])
    wait(client, r["id"])
    out = client.get(f"/api/inflect/batches/{r['id']}/histograms/files", params={"ids": "file_0001,file_0002,file_9999"}).json()["files"]
    assert [f["file_id"] for f in out] == ["file_0001", "file_0002"]         # unknown ids are ignored
    assert out[1]["histograms"] is None and out[1]["status"] == "failed"
    # a result saved by an older version has no histograms: reported as stale, not as an error
    b = ib.Batch(api.settings, r["id"])
    a = b.analysis("file_0001")
    del a["histograms"]
    from tini.io_atomic import atomic_write_json
    atomic_write_json(b.file_dir("file_0001") / "analysis.json", a)
    out = client.get(f"/api/inflect/batches/{r['id']}/histograms/files", params={"ids": "file_0001"}).json()["files"]
    assert out[0]["stale"] is True and out[0]["histograms"] is None
    assert client.get(f"/api/inflect/batches/{r['id']}/histograms/files", params={"ids": ",".join(f"f{i}" for i in range(30))}).status_code == 400
    assert client.get("/api/inflect/batches/nope/histograms/cross").status_code == 404


def test_histogram_helper_edge_cases():
    assert ib.histogram_of([]) is None and ib.histogram_of([np.nan, np.inf]) is None
    h = ib.histogram_of([3.0, 3.0, 3.0])
    assert h["constant"] and h["counts"] == [3] and h["edges"][0] < 3.0 < h["edges"][1]
    h = ib.histogram_of(np.r_[np.zeros(200), 1e6], clip=True)               # no percentile range to draw: nothing clipped
    assert h["n_outside"] == 0 and sum(h["counts"]) == 201
    h = ib.histogram_of(np.r_[np.random.default_rng(1).normal(size=300), 500.0], clip=True)   # a real outlier
    assert h["n_outside"] >= 1 and h["n"] + h["n_outside"] == h["n_total"] == 301
    h = ib.histogram_of(np.random.default_rng(0).normal(size=1000))
    assert sum(h["counts"]) == 1000 and 8 <= len(h["counts"]) <= 40
    assert 4 <= len(ib.histogram_of([1, 2, 3, 4, 5, 9], cross=True)["counts"]) <= 20
