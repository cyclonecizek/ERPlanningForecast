#!/usr/bin/env python3
"""High-resolution guidance for docs/index.html, written to docs/data/hires.json.

Sources
  rrfs    RRFS deterministic, 3 km CONUS 2dfld, hourly to 24 h then 3-hourly to 84 h
  refsm   RRFS ensemble members m001-m005 (the REFS membership), 3 km CONUS 2dfldnomads,
          hourly to 24 h then 3-hourly to 60 h
  hrefct  SPC HREF calibrated thunder, 1 h and 4 h periods (retires with HREF on Nov 3, 2026)
  refsct  SPC REFS calibrated thunder, 1 h and 4 h periods (para until Nov 3, then prod)

Point values are taken from the nearest grid point to each forecast point. Inventories (.idx)
come from AWS (noaa-rrfs-ops-pds) when present, otherwise NOMADS; GRIB messages are fetched by
byte range from AWS when the inventory matches, otherwise from NOMADS (rate limited). A source
whose newest run is already in hires.json is not downloaded again, and a source that fails keeps
its previous run for up to 24 h, so a bad hour never blanks the page.

Needs numpy and pygrib (pip install pygrib numpy).
"""
import json
import math
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import numpy as np

try:
    import pygrib
except ImportError:  # the tests inject a stand-in
    pygrib = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data", "hires.json")

# Must match SITES in docs/index.html
SITES = [
    ("ksc-inland", 28.6150, -80.6945),   # SLF
    ("ksc-pads", 28.6272, -80.6208),     # LC-39B
    ("cape-inland", 28.4686, -80.5667),  # KXMR
    ("cape-pad37", 28.5314, -80.5650),   # SLC-37
    ("patrick", 28.2349, -80.6101),      # KCOF
    # extra pads for the exposure page (custom points use the nearest point within 15 km)
    ("lc39a", 28.6083, -80.6041),
    ("slc40", 28.5620, -80.5772),
    ("slc41", 28.5833, -80.5830),
    ("lc36", 28.4710, -80.5378),
]

NOMADS = "https://nomads.ncep.noaa.gov/pub/data/nccf/com"
AWS = "https://noaa-rrfs-ops-pds.s3.amazonaws.com"
RRFS_BASES = [f"{NOMADS}/rrfs/prod", f"{NOMADS}/rrfs/v1.0", f"{NOMADS}/rrfs/para"]
SPC_BASES = [f"{NOMADS}/spc_post/prod", f"{NOMADS}/spc_post/para"]
UA = {"User-Agent": "planning-forecast-hires (GitHub Actions)"}
BUDGET_S = float(os.environ.get("HIRES_BUDGET_MIN", "35")) * 60
T0 = time.time()
KEEP_OLD_H = 24
LOG = lambda *a: print(*a, flush=True)  # noqa: E731


def time_left():
    return BUDGET_S - (time.time() - T0)


# --------------------------------------------------------------------------- HTTP
_nomads_lock = threading.Lock()
_nomads_last = [0.0]


def http(url, rng=None, timeout=60, tries=3):
    """GET url (optionally a byte range). None on 403/404 or after retries."""
    for k in range(tries):
        if "nomads.ncep" in url:  # stay well under NOMADS' per-minute limit
            with _nomads_lock:
                wait = 0.6 - (time.time() - _nomads_last[0])
                if wait > 0:
                    time.sleep(wait)
                _nomads_last[0] = time.time()
        hdr = dict(UA)
        if rng:
            hdr["Range"] = f"bytes={rng[0]}-" + ("" if rng[1] is None else str(rng[1]))
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=hdr), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                return None
            time.sleep(6 * (k + 1))
        except Exception:  # noqa: BLE001 - timeouts, resets
            time.sleep(3 * (k + 1))
    return None


# --------------------------------------------------------------------------- inventories
def parse_idx(raw):
    lines = [ln for ln in raw.decode("utf-8", "replace").splitlines() if ln.count(":") >= 6]
    recs = []
    for i, ln in enumerate(lines):
        p = ln.split(":")
        try:
            start = int(p[1])
            end = int(lines[i + 1].split(":")[1]) - 1 if i + 1 < len(lines) else None
        except ValueError:
            continue
        recs.append({"var": p[3], "lev": p[4], "fc": p[5], "rest": ":".join(p[6:]), "start": start, "end": end})
    return recs


def acc_hours(fc):
    """'11-12 hour acc fcst' -> (11, 12); '0-1 day acc fcst' -> (0, 24); else None."""
    g = re.match(r"(\d+)-(\d+) (hour|day) acc", fc)
    if not g:
        return None
    k = 24 if g.group(3) == "day" else 1
    return int(g.group(1)) * k, int(g.group(2)) * k


def pick(recs, var, lev, fh=None):
    """Best record for var/level: plain (not probability/ensemble), instantaneous preferred."""
    c = [r for r in recs if r["var"] == var and r["lev"].startswith(lev)
         and "prob" not in r["rest"].lower() and "ens" not in r["rest"].lower()]
    if not c:
        return None
    if var == "APCP":
        m = [(r, acc_hours(r["fc"])) for r in c]
        m = [(r, ab) for r, ab in m if ab]
        tot = [r for r, ab in m if fh and ab == (0, fh)]
        if tot:
            return dict(tot[0], acc=("total", fh))
        if not m:
            return None
        r, ab = min(m, key=lambda x: x[1][1] - x[1][0])
        return dict(r, acc=("bucket", ab[1] - ab[0]))
    inst = [r for r in c if re.match(r"(\d+ (hour|day) fcst|anl)$", r["fc"])]
    return (inst or c)[0]


_grid_cache = {}


def first_message(raw):
    m = pygrib.fromstring(raw)
    return m[0] if isinstance(m, list) else m


def site_values(raw_or_msg):
    """Value of one GRIB2 message at each forecast point (nearest grid point)."""
    msg = raw_or_msg if hasattr(raw_or_msg, "values") else first_message(raw_or_msg)
    vals = msg.values
    lat1 = round(float(msg["latitudeOfFirstGridPointInDegrees"]), 4)
    lon1 = round(float(msg["longitudeOfFirstGridPointInDegrees"]), 4)
    key = (vals.shape, lat1, lon1)
    if key not in _grid_cache:
        lats, lons = msg.latlons()
        lons = np.where(lons > 180, lons - 360, lons)
        ij = []
        for _, la, lo in SITES:
            d = (lats - la) ** 2 + ((lons - lo) * math.cos(math.radians(la))) ** 2
            ij.append(np.unravel_index(int(np.argmin(d)), d.shape))
        _grid_cache[key] = ij
    out = []
    for ij in _grid_cache[key]:
        x = vals[ij]
        out.append(None if np.ma.is_masked(x) or not np.isfinite(float(x)) else float(x))
    return out


def is_grib(b):
    return bool(b) and b[:4] == b"GRIB" and b[-4:] == b"7777"


class Fetcher:
    """Inventory + byte-range downloads, AWS first."""

    def __init__(self):
        self.aws_ok = True
        self.base = {}

    def inventory(self, suffix, bases):
        if self.aws_ok:
            raw = http(f"{AWS}/{suffix}.idx", timeout=30)
            if raw:
                return parse_idx(raw), f"{AWS}/{suffix}", "AWS"
        order = sorted(bases, key=lambda b: b != self.base.get(tuple(bases)))   # last good base first
        for b in order:
            raw = http(f"{b}/{suffix}.idx", timeout=30)
            if raw:
                self.base[tuple(bases)] = b
                return parse_idx(raw), f"{b}/{suffix}", b
        return None, None, None

    def message(self, url, rec, suffix):
        rng = (rec["start"], rec["end"])
        if "nomads" in url and self.aws_ok:  # NOMADS inventory: try the same bytes on AWS first
            b = http(f"{AWS}/{suffix}", rng=rng, timeout=60)
            if is_grib(b):
                return b
            if b is not None:
                LOG("  AWS bytes don't match the NOMADS inventory; using NOMADS for messages")
                self.aws_ok = False
        b = http(url, rng=rng, timeout=90)
        return b if is_grib(b) else None


# --------------------------------------------------------------------------- RRFS fields
FIELDS = [  # key, GRIB var, level prefix
    ("t", "TMP", "2 m above ground"), ("td", "DPT", "2 m above ground"),
    ("u10", "UGRD", "10 m above ground"), ("v10", "VGRD", "10 m above ground"),
    ("gust", "GUST", "surface"),
    ("u80", "UGRD", "80 m above ground"), ("v80", "VGRD", "80 m above ground"),
    ("tcc", "TCDC", "entire atmosphere"), ("vis", "VIS", "surface"),
    ("sw", "DSWRF", "surface"), ("apcp", "APCP", "surface"),
    # for the KCOF TAF generator
    ("cig", "HGT", "cloud ceiling"), ("cbase", "HGT", "cloud base"),
    ("lcc", "LCDC", "low cloud layer"), ("mcc", "MCDC", "middle cloud layer"), ("hcc", "HCDC", "high cloud layer"),
    ("slp", "PRMSL", "mean sea level"), ("slp2", "MSLMA", "mean sea level"),
]
FT = 3.28084
KT = 1.943844
k2f = lambda k: (k - 273.15) * 9 / 5 + 32  # noqa: E731


def cycles(now, step=6, back=5):
    c0 = now.replace(minute=0, second=0, microsecond=0)
    c0 -= timedelta(hours=c0.hour % step)
    return [c0 - timedelta(hours=step * i) for i in range(back)]


def rrfs_suffix(cyc, fh, member=None):
    d, cc = cyc.strftime("%Y%m%d"), cyc.strftime("%H")
    if member is None:
        return f"rrfs.{d}/{cc}/rrfs.t{cc}z.2dfld.3km.f{fh:03d}.conus.grib2"
    m = f"m{member:03d}"
    return f"rrfsens.{d}/{cc}/{m}/rrfs.t{cc}z.{m}.2dfldnomads.3km.f{fh:03d}.conus.grib2"


def hours_for(maxh):
    return list(range(1, 25)) + list(range(27, maxh + 1, 3))


def find_cycle(fx, now, maxh, member=None):
    """Newest 6-hourly cycle whose last needed forecast hour is out."""
    for cyc in cycles(now):
        recs, url, where = fx.inventory(rrfs_suffix(cyc, maxh, member), RRFS_BASES)
        if recs:
            return cyc, where
    return None, None


def run_member(fx, cyc, maxh, member=None):
    """One RRFS run (deterministic or member) at every forecast point."""
    hours = hours_for(maxh)
    raw = {h: {} for h in hours}
    jobs = []
    for h in hours:
        if time_left() < 60:
            LOG("  time budget reached, keeping what we have")
            break
        suffix = rrfs_suffix(cyc, h, member)
        recs, url, _ = fx.inventory(suffix, RRFS_BASES)
        if not recs:
            continue
        for key, var, lev in FIELDS:
            r = pick(recs, var, lev, fh=h)
            if r:
                jobs.append((h, key, r, url, suffix))

    def work(j):
        h, key, r, url, suffix = j
        b = fx.message(url, r, suffix)
        return j, (site_values(b) if b else None)

    with ThreadPoolExecutor(max_workers=8 if fx.aws_ok else 2) as ex:
        for (h, key, r, url, suffix), vals in ex.map(work, jobs):
            if vals is not None:
                raw[h][key] = (vals, r.get("acc"))
    return assemble(cyc, hours, raw)


def assemble(cyc, hours, raw):
    """Convert per-hour site values into the page's member arrays (hourly from cycle+1 h)."""
    n = max(hours)
    t0 = int((cyc + timedelta(hours=1)).timestamp() * 1000)
    per_site = []
    for si in range(len(SITES)):
        m = {k: [None] * n for k in ("t", "td", "sky", "s10", "d10", "g10", "s80", "d80", "vis", "sw", "pr", "pacc",
                                     "cig", "lcb", "cl", "cm", "ch", "slp")}
        prev_h, prev_tot = 0, 0.0
        for h in hours:
            f = raw.get(h, {})
            g = lambda k: f[k][0][si] if k in f and f[k][0][si] is not None else None  # noqa: E731
            i = h - 1
            if g("t") is not None:
                m["t"][i] = round(k2f(g("t")), 1)
            if g("td") is not None:
                m["td"][i] = round(k2f(g("td")), 1)
            if g("tcc") is not None:
                m["sky"][i] = round(g("tcc"))
            for uk, vk, sk, dk in (("u10", "v10", "s10", "d10"), ("u80", "v80", "s80", "d80")):
                u, v = g(uk), g(vk)
                if u is not None and v is not None:
                    m[sk][i] = round(math.hypot(u, v) * KT, 1)
                    m[dk][i] = round((math.degrees(math.atan2(-u, -v)) + 360) % 360)
            if g("gust") is not None:
                m["g10"][i] = round(g("gust") * KT, 1)
            if g("vis") is not None:
                m["vis"][i] = round(g("vis"))
            if g("sw") is not None:
                m["sw"][i] = round(g("sw"))
            # ceiling / cloud base: a decoded field with no value at the point means no ceiling
            for src_k, dst in (("cig", "cig"), ("cbase", "lcb")):
                if src_k in f:
                    v = g(src_k)
                    m[dst][i] = 30000 if v is None or v * FT > 30000 else round(v * FT, -1)
            for src_k, dst in (("lcc", "cl"), ("mcc", "cm"), ("hcc", "ch")):
                if g(src_k) is not None:
                    m[dst][i] = round(g(src_k))
            slp = g("slp") if g("slp") is not None else g("slp2")
            if slp is not None:
                m["slp"][i] = round(slp / 100.0, 1)   # Pa -> hPa
            if g("apcp") is not None:
                kind, val = f["apcp"][1] or ("bucket", 1)
                mm = g("apcp")
                if kind == "total":
                    m["pr"][i] = round(max(0.0, mm - prev_tot) / 25.4, 3)
                    m["pacc"][i] = h - prev_h
                    prev_tot, prev_h = mm, h
                else:
                    m["pr"][i] = round(max(0.0, mm) / 25.4, 3)
                    m["pacc"][i] = val
        per_site.append(m)
    return t0, per_site


# --------------------------------------------------------------------------- calibrated thunder
def thunder(kind, now, skip_run=None):
    """kind 'hrefct' (thunder/ dir, to 48 h) or 'refsct' (refsct/ dir, to 60 h)."""
    sub, maxh = ("thunder", 48) if kind == "hrefct" else ("refsct", 60)
    for cyc in cycles(now):
        d, cc = cyc.strftime("%Y%m%d"), cyc.strftime("%H")
        for base in SPC_BASES:
            last = f"{base}/spc_post.{d}/{sub}/spc_post.t{cc}z.{kind}_1hr.f{min(maxh, 36):03d}.grib2"
            probe = http(last, rng=(0, 3), timeout=30)
            if not probe or probe[:4] != b"GRIB":
                continue
            if skip_run == cyc.isoformat():
                return "same", None
            LOG(f"{kind}: {cc}Z {d} from {base.rsplit('/', 1)[-1]}")
            iv = {"tst": [[] for _ in SITES], "tst4": [[] for _ in SITES]}
            for per, tag, hrs in (("tst", "1hr", range(1, maxh + 1)), ("tst4", "4hr", range(4, maxh + 1))):
                for h in hrs:
                    if time_left() < 60:
                        break
                    b = http(f"{base}/spc_post.{d}/{sub}/spc_post.t{cc}z.{kind}_{tag}.f{h:03d}.grib2", timeout=60)
                    if not b or b[:4] != b"GRIB":
                        continue
                    vals, scale = thunder_values(b)
                    end = int((cyc + timedelta(hours=h)).timestamp() * 1000)
                    a = end - (1 if per == "tst" else 4) * 3600 * 1000
                    for si, v in enumerate(vals):
                        if v is not None:
                            iv[per][si].append({"a": a, "b": end, "p": round(min(1.0, max(0.0, v * scale)), 3)})
            if any(iv["tst"]):
                return cyc, iv
    return None, None


def thunder_values(b):
    """First message of a thunder file at each point, and the factor that turns it into 0-1."""
    msg = first_message(b)
    vals = site_values(msg)
    units = ""
    for k in ("parameterUnits", "units"):
        try:
            units = str(msg[k]).strip().lower()
            break
        except Exception:  # noqa: BLE001
            continue
    if units in ("%", "percent"):
        return vals, 0.01
    if units in ("1", "fraction", "proportion", "(0 - 1)", "0-1"):
        return vals, 1.0
    try:  # unknown units: SPC thunder grids are percent unless the whole field fits in 0-1 with decimals
        v = np.ma.filled(msg.values, np.nan)
        frac = np.nanmax(v) <= 1.0 and np.any((v > 0) & (v < 1))
    except Exception:  # noqa: BLE001
        frac = False
    return vals, (1.0 if frac else 0.01)


# --------------------------------------------------------------------------- main
def load_old():
    try:
        with open(OUT) as f:
            return {s["id"]: s for s in json.load(f).get("sources", [])}
    except Exception:  # noqa: BLE001
        return {}


def keep_or_drop(old, sid, now):
    s = old.get(sid)
    if s and now - datetime.fromisoformat(s["run"]) < timedelta(hours=KEEP_OLD_H):
        LOG(f"{sid}: keeping previous run {s['run']}")
        return s
    return None


def main():
    if pygrib is None:
        LOG("pygrib is not installed (pip install pygrib numpy)")
        return 1
    now = datetime.now(timezone.utc)
    old = load_old()
    fx = Fetcher()
    out = []

    def same_run(sid, cyc):
        return sid in old and cyc and old[sid].get("run") == cyc.isoformat()

    # RRFS deterministic
    cyc, where = find_cycle(fx, now, 84)
    if cyc and same_run("rrfs", cyc):
        LOG(f"rrfs: {cyc:%HZ %Y%m%d} already in hires.json")
        out.append(old["rrfs"])
    elif cyc:
        LOG(f"rrfs: {cyc:%HZ %Y%m%d} from {where}")
        t0, per_site = run_member(fx, cyc, 84)
        out.append({"id": "rrfs", "name": "RRFS", "fam": "hires", "run": cyc.isoformat(), "t0": t0,
                    "gap": 3, "sites": {SITES[i][0]: {"members": [per_site[i]]} for i in range(len(SITES))}})
    else:
        s = keep_or_drop(old, "rrfs", now)
        out += [s] if s else []

    # RRFS ensemble members (REFS membership)
    cyc, where = find_cycle(fx, now, 60, member=5)
    if cyc and same_run("refsm", cyc):
        LOG(f"refsm: {cyc:%HZ %Y%m%d} already in hires.json")
        out.append(old["refsm"])
    elif cyc:
        LOG(f"refsm: {cyc:%HZ %Y%m%d} from {where}")
        sites = {s[0]: {"members": []} for s in SITES}
        t0 = None
        for mem in range(1, 6):
            if time_left() < 120:
                LOG("  time budget reached before all members")
                break
            t0, per_site = run_member(fx, cyc, 60, member=mem)
            for i, s in enumerate(SITES):
                if any(v is not None for v in per_site[i]["t"]):
                    sites[s[0]]["members"].append(per_site[i])
        if t0 is not None:
            out.append({"id": "refsm", "name": "REFS members", "fam": "hires", "run": cyc.isoformat(),
                        "t0": t0, "gap": 3, "sites": sites})
    else:
        s = keep_or_drop(old, "refsm", now)
        out += [s] if s else []

    # SPC calibrated thunder
    for sid, name in (("hrefct", "HREF calibrated thunder"), ("refsct", "REFS calibrated thunder")):
        if time_left() < 90:
            s = keep_or_drop(old, sid, now)
            out += [s] if s else []
            continue
        cyc, iv = thunder(sid, now, skip_run=(old.get(sid) or {}).get("run"))
        if cyc == "same":
            LOG(f"{sid}: newest run already in hires.json")
            out.append(old[sid])
            continue
        if cyc:
            out.append({"id": sid, "name": name, "fam": "ct", "run": cyc.isoformat(),
                        "sites": {SITES[i][0]: {"iv": {"tst": iv["tst"][i], "tst4": iv["tst4"][i]}} for i in range(len(SITES))}})
        else:
            s = keep_or_drop(old, sid, now)
            out += [s] if s else []

    doc = {"generated": now.isoformat(), "sources": out}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT + ".tmp", "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    os.replace(OUT + ".tmp", OUT)
    LOG(f"wrote hires.json: {', '.join(s['id'] + ' ' + s['run'][:13] for s in out) or 'no sources'}"
        f" ({os.path.getsize(OUT) / 1024:.0f} kB, {time.time() - T0:.0f} s)")
    return 0 if out else 1


if __name__ == "__main__":
    sys.exit(main())
