#!/usr/bin/env python3
"""
Import FIT files from buddies' folders into guest_dives.

Folder convention:
    fit/buddies/{diver-slug}/   ← place their zip files here
    fit/buddies/alice/2026-04-30_Session.zip
    fit/buddies/bob/session1.zip

Each diver slug must match a row in guest_divers.id.
Dives are stored with depth + HR profiles but NO discipline label yet —
label them in the app.

Run from the project root:
    python -m src.sync.import_buddy_fits [--diver SLUG]

Options:
    --diver SLUG   Only import for this diver (default: all)
    --dry-run      Print what would be imported without writing
"""

import argparse
import io
import json
import sqlite3
import zipfile
from pathlib import Path

try:
    import fitparse
except ImportError:
    raise SystemExit("fitparse not installed. Run: pip install fitparse")

_ROOT      = Path(__file__).parent.parent.parent
_BUDDY_DIR = _ROOT / "fit" / "buddies"
_APP_DB    = _ROOT / "data" / "freediving.db"

_SURFACE_DEPTH   = 1.0
_MIN_DIVE_DEPTH  = 0.5
_MIN_DIVE_POINTS = 3
_MAX_SI          = 1200
_MAX_PROFILE_PTS = 300


def _thin(pts: list, n: int) -> list:
    if len(pts) <= n:
        return pts
    step = len(pts) // n
    return pts[::step]


def parse_fit(fit_bytes: bytes) -> list[dict]:
    """Parse a FIT file into a list of per-dive dicts with depth/HR profiles."""
    ff = fitparse.FitFile(io.BytesIO(fit_bytes))
    ff.parse()

    all_pts = []
    for rec in ff.get_messages("record"):
        fields = {f.name: f.value for f in rec.fields}
        ts    = fields.get("timestamp")
        depth = fields.get("depth")
        hr    = fields.get("heart_rate")
        temp  = fields.get("temperature")
        if ts is not None and depth is not None:
            all_pts.append({"ts": ts, "depth": round(depth, 3), "hr": hr, "temp": temp})

    if not all_pts:
        return []
    all_pts.sort(key=lambda p: p["ts"])

    # Segment into dives by depth threshold
    dives: list[list[dict]] = []
    current: list[dict] = []
    for pt in all_pts:
        if pt["depth"] >= _SURFACE_DEPTH:
            current.append(pt)
        else:
            if len(current) >= _MIN_DIVE_POINTS and max(p["depth"] for p in current) >= _MIN_DIVE_DEPTH:
                dives.append(current)
            current = []
    if len(current) >= _MIN_DIVE_POINTS and max(p["depth"] for p in current) >= _MIN_DIVE_DEPTH:
        dives.append(current)

    result = []
    prev_end = None

    for i, dive_pts in enumerate(dives, 1):
        t0        = dive_pts[0]["ts"]
        max_depth = max(p["depth"] for p in dive_pts)
        peak_idx  = max(range(len(dive_pts)), key=lambda j: dive_pts[j]["depth"])

        si = None
        if prev_end:
            gap = (dive_pts[0]["ts"] - prev_end).total_seconds()
            if 0 < gap <= _MAX_SI:
                si = round(gap, 1)
        prev_end = dive_pts[-1]["ts"]

        thin = _thin(dive_pts, _MAX_PROFILE_PTS)
        depth_profile = [[round((p["ts"] - t0).total_seconds(), 1), p["depth"]] for p in thin]
        hr_profile    = [[round((p["ts"] - t0).total_seconds(), 1), p["hr"]]
                         for p in thin if p["hr"] is not None] or None

        # Descent / ascent times from profile
        descent_time_s = round(depth_profile[peak_idx][0], 1) if peak_idx > 0 else None
        ascent_time_s  = round(depth_profile[-1][0] - depth_profile[peak_idx][0], 1) \
                         if peak_idx < len(depth_profile) - 1 else None

        bottom_time = sum(1 for p in dive_pts if p["depth"] >= max_depth - 2.0)
        temps = [p["temp"] for p in dive_pts if p["temp"] is not None]

        result.append({
            "dive_number":      i,
            "max_depth_m":      round(max_depth, 3),
            "bottom_time_s":    round(bottom_time, 1),
            "descent_time_s":   descent_time_s,
            "ascent_time_s":    ascent_time_s,
            "surface_interval_s": si,
            "water_temp_c":     round(sum(temps) / len(temps), 1) if temps else None,
            "depth_profile":    depth_profile,
            "hr_profile":       hr_profile,
        })

    return result


def import_zip(zip_path: Path, diver_id: str, conn: sqlite3.Connection, dry_run: bool) -> tuple[int, int]:
    """Returns (inserted, skipped)."""
    try:
        with zipfile.ZipFile(zip_path) as zf:
            fit_names = [n for n in zf.namelist() if n.lower().endswith(".fit")]
            if not fit_names:
                return 0, 0
            fit_bytes = zf.read(fit_names[0])
    except Exception as e:
        print(f"    WARN: could not open zip: {e}")
        return 0, 0

    dives = parse_fit(fit_bytes)
    if not dives:
        return 0, 0

    inserted = skipped = 0
    session_file = zip_path.name

    for d in dives:
        if dry_run:
            print(f"    dive {d['dive_number']}: {d['max_depth_m']}m  {d['bottom_time_s']}s")
            inserted += 1
            continue

        try:
            conn.execute(
                """
                INSERT INTO guest_dives
                  (diver_id, session_file, dive_number,
                   max_depth_m, bottom_time_s, descent_time_s, ascent_time_s,
                   surface_interval_s, water_temp_c, depth_profile, hr_profile)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    diver_id, session_file, d["dive_number"],
                    d["max_depth_m"], d["bottom_time_s"],
                    d["descent_time_s"], d["ascent_time_s"],
                    d["surface_interval_s"], d["water_temp_c"],
                    json.dumps(d["depth_profile"]),
                    json.dumps(d["hr_profile"]) if d["hr_profile"] else None,
                ),
            )
            inserted += 1
        except sqlite3.IntegrityError:
            skipped += 1

    if not dry_run:
        conn.commit()

    return inserted, skipped


def import_diver(diver_dir: Path, diver_id: str, conn: sqlite3.Connection, dry_run: bool) -> None:
    zips = sorted(diver_dir.glob("*.zip"))
    if not zips:
        print(f"  {diver_id}: no zip files found in {diver_dir}")
        return

    total_in = total_sk = 0
    for zip_path in zips:
        ins, sk = import_zip(zip_path, diver_id, conn, dry_run)
        if ins or sk:
            status = "DRY" if dry_run else f"+{ins} skip={sk}"
            print(f"  {zip_path.name}: {status}")
        total_in += ins
        total_sk += sk

    print(f"  → {diver_id}: {total_in} dives imported, {total_sk} already present")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--diver", help="Only import for this diver slug")
    parser.add_argument("--dry-run", action="store_true", help="Don't write to DB")
    args = parser.parse_args()

    if not _BUDDY_DIR.exists():
        raise SystemExit(f"Buddy folder not found: {_BUDDY_DIR}\nCreate it and add subfolders per diver.")

    conn = sqlite3.connect(_APP_DB)

    # Verify diver exists in DB
    known = {r[0] for r in conn.execute("SELECT id FROM guest_divers").fetchall()}

    dirs = [_BUDDY_DIR / args.diver] if args.diver else sorted(_BUDDY_DIR.iterdir())
    dirs = [d for d in dirs if d.is_dir()]

    if not dirs:
        print("No diver subdirectories found in fit/buddies/")
        conn.close()
        return

    for diver_dir in dirs:
        slug = diver_dir.name
        if slug not in known:
            print(f"  SKIP {slug}: not in guest_divers table. Add the diver in the app first.")
            continue
        print(f"Importing {slug}…")
        import_diver(diver_dir, slug, conn, args.dry_run)

    conn.close()
    print("\nDone. Label dives in the app → External Divers.")


if __name__ == "__main__":
    main()
