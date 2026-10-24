#!/usr/bin/env python3
"""Forecast verification and dynamic model weighting for the ER forecast pages.

Every run (GitHub Actions, hourly):
  obs       Hourly observations at each forecast point into docs/data/verif/obs/YYYYMMDD.json:
            WINDS towers (54/200 ft sustained and peak, direction, temperature, dew point),
            MERLIN cloud-to-ground and cloud-to-cloud counts within 5 and 10 nmi,
            MRMS gauge-corrected hourly rainfall (MultiSensor QPE 01H Pass2, AWS archive),
            KTTS / KXMR / KCOF METARs (temperature, dew point, visibility, thunder).
  guidance  At 05Z and 17Z, the forecast every source makes at each point for the next 7 days
            (Open-Meteo models and ensembles, the MOS mirror, RRFS/REFS and calibrated thunder from
            hires.json) into docs/data/verif/pending/<issue>.json.gz until it can be scored.
  score     Pairs archived forecasts with observations once each hour is final, accumulates
            daily error sums into docs/data/verif/stats/YYYYMMDD.json, and writes
            docs/data/verif/summary.json (7/30/90-day scorecards) and docs/data/verif/weights.json
            (per point, parameter group and lead band) for the forecast pages.

Nothing here touches official (forecaster-edited) forecasts: those stay on the forecasters'
computers and are scored in the browser on the Verification tab.

Usage: python pipeline/verify.py [obs] [guidance] [score]   (no arguments = all three)
Needs: numpy and eccodes for MRMS (pip install numpy eccodes); the rest is standard library.
"""
import gzip
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

UTC = timezone.utc
H = timedelta(hours=1)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data", "verif")
UA = {"User-Agent": "ER-Planning-Verification/1.0"}
T0 = time.time()
BUDGET = float(os.environ.get("VERIFY_BUDGET_S", "1500"))
LOG = lambda *a: print(*a, flush=True)  # noqa: E731

# ---------------------------------------------------------------- forecast points and their sensors
# Sensors: (tower, height ft). Several towers or sides are combined (prevailing side when flagged).
# 200 ft can come from a pair of heights interpolated in log height.
POINTS = {
    "ksc-inland":  {"name": "KSC Inland (SLF)", "lat": 28.6150, "lon": -80.6945, "metar": "KTTS",
                    "temp": [("0512", 6), ("0412", 6)], "w54": [("0412", 54)], "w200": [("0313NE", 204), ("0313SW", 204)]},
    "ksc-pads":    {"name": "KSC Launch Pads (LC-39B)", "lat": 28.6272, "lon": -80.6208, "metar": "KTTS",
                    "temp": [("0211", 6)], "w54": [("0211", 54)],
                    "w200i": {"towers": ["LC39BNE", "LC39BNW", "LC39BSW"], "lo": 132, "hi": 257}},
    "cape-inland": {"name": "Cape Inland (KXMR)", "lat": 28.4686, "lon": -80.5667, "metar": "KXMR",
                    "temp": [("0303", 6)], "w54": [("0303", 54)], "w200": [("0002NW", 204), ("0002SE", 204)]},
    "cape-pad37":  {"name": "Cape Launch Pad (SLC-37)", "lat": 28.5314, "lon": -80.5650, "metar": "KXMR",
                    "temp": [("0108", 6)], "w54": [("0108", 54)], "w200": [("LC37E", 196), ("LC37W", 196)]},
    "patrick":     {"name": "Patrick SFB (KCOF)", "lat": 28.2349, "lon": -80.6101, "metar": "KCOF", "temp_from_metar": True},
}
METARS = ["KTTS", "KXMR", "KCOF"]
WINDS_RANGE = "https://codiapi-winds1.rad.spaceforce.mil/winds/range"
LTG_RANGE = "https://codiapi-lightning{k}.rad.spaceforce.mil/lightning_{k}/range"
MRMS_AWS = "https://noaa-mrms-pds.s3.amazonaws.com/CONUS/MultiSensor_QPE_01H_Pass2_00.00/{d}/MRMS_MultiSensor_QPE_01H_Pass2_00.00_{d}-{h}0000.grib2.gz"
IEM_ASOS = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"

# ---------------------------------------------------------------- forecast sources
OM_DET = [("hrrr", "ncep_hrrr_conus"), ("nam3", "ncep_nam_conus"), ("nbm", "ncep_nbm_conus"), ("gfs", "gfs_seamless"),
          ("ifs", "ecmwf_ifs025"), ("aifs", "ecmwf_aifs025_single"), ("icon", "icon_global"), ("gem", "gem_global"),
          ("ukmo", "ukmo_global_deterministic_10km")]
OM_ENS = [("gefs", "gfs025"), ("eps", "ecmwf_ifs025"), ("aifsens", "ecmwf_aifs025"), ("iconeps", "icon_global"), ("geps", "gem_global")]
MOS = [("lav", "LAV"), ("mav", "GFS"), ("nbs", "NBS"), ("mex", "GFSX")]
MOS_STN = {"ksc-inland": "KTTS", "ksc-pads": "KTTS", "cape-inland": "KXMR", "cape-pad37": "KXMR", "patrick": "KCOF"}
ISSUE_HOURS = (5, 17)
LEAD_H = 168
BANDS = [(0, 6, "0-6h"), (6, 24, "6-24h"), (24, 48, "day2"), (48, 120, "day3-5"), (120, 169, "day6-7")]
CONT = ["t", "td", "s54", "g54", "s200", "g200", "d"]
PROB = ["pp", "lt", "x18", "x25", "x35", "x50"]
GROUPS = {"t": ["t", "td"], "s": ["s54", "s200"], "g": ["g54", "g200"], "d": ["d"], "pp": ["pp"], "lt": ["lt"], "x": ["x18", "x25", "x35", "x50"]}

# wind profile, same as the forecast pages (guidance.js)
Z54, Z200, Z0, ALPHA = 16.46, 60.96, 0.03, 0.14


def wind_at(z, s10, s80):
    if s10 is None:
        return None
    if s80 is not None:
        return max(0.0, s10 + (s80 - s10) * math.log(z / 10) / math.log(8))
    return s10 * (z / 10) ** ALPHA


def gust_factor(s10, g10):
    if s10 is None:
        return None
    if g10 is None or s10 < 0.5 or g10 < s10:
        return 1.3
    return min(2.5, g10 / s10)


def peak_at(z, sz, gf):
    if sz is None or gf is None:
        return None
    return sz * (1 + (gf - 1) * math.log(10 / Z0) / math.log(z / Z0))


# ---------------------------------------------------------------- helpers
def get(url, params=None, tries=3, timeout=60, raw=False):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params, doseq=True)
    last = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                body = r.read()
                return body if raw else json.loads(body.decode("utf-8", "replace") or "null")
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 404 or (400 <= e.code < 500 and e.code != 429):
                raise
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(2 ** k)
    raise last


def dt(s):
    x = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    return x.replace(tzinfo=UTC) if x.tzinfo is None else x.astimezone(UTC)


def nmi(lat1, lon1, lat2, lon2):
    p = math.pi / 180
    a = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 3440.065 * 2 * math.asin(math.sqrt(a))


def load(path, default):
    try:
        if path.endswith(".gz"):
            with gzip.open(path, "rt") as f:
                return json.load(f)
        with open(path) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return default


def save(path, obj, gz=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    if gz:
        with gzip.open(tmp, "wt") as f:
            json.dump(obj, f, separators=(",", ":"))
    else:
        with open(tmp, "w") as f:
            json.dump(obj, f, separators=(",", ":"))
    os.replace(tmp, path)


def r1(v):
    return None if v is None or (isinstance(v, float) and not math.isfinite(v)) else round(v, 1)


def time_left():
    return BUDGET - (time.time() - T0)


# ---------------------------------------------------------------- observations
OBS_FIELDS = ["t", "td", "s54", "s54x", "g54", "d54", "s200", "s200x", "g200", "pr", "prx", "cg5", "cg10", "cc10", "vis", "ts", "mt", "mtd"]


def day_path(day):
    return os.path.join(OUT, "obs", day.strftime("%Y%m%d") + ".json")


def empty_day(day):
    return {"date": day.strftime("%Y-%m-%d"), "points": {p: {f: [None] * 24 for f in OBS_FIELDS} for p in POINTS},
            "done": {"winds": [False] * 24, "ltg": [False] * 24, "mrms": [False] * 24, "metar": [False] * 24}}


class ObsStore:
    def __init__(self):
        self.days = {}

    def day(self, t):
        d = t.replace(hour=0, minute=0, second=0, microsecond=0)
        k = d.strftime("%Y%m%d")
        if k not in self.days:
            doc = load(day_path(d), None) or empty_day(d)
            for p in POINTS:
                doc["points"].setdefault(p, {f: [None] * 24 for f in OBS_FIELDS})
                for f in OBS_FIELDS:
                    doc["points"][p].setdefault(f, [None] * 24)
            for s in ("winds", "ltg", "mrms", "metar"):
                doc["done"].setdefault(s, [False] * 24)
            self.days[k] = (d, doc)
        return self.days[k][1]

    def put(self, t, point, field, value):
        self.day(t)["points"][point][field][t.hour] = value

    def done(self, t, src):
        return self.day(t)["done"][src][t.hour]

    def mark(self, t, src):
        self.day(t)["done"][src][t.hour] = True

    def write(self):
        for k, (d, doc) in self.days.items():
            doc["updated"] = datetime.now(UTC).isoformat()
            save(day_path(d), doc)


def wnum(v):
    if v is None:
        return None
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return None if v >= 999 or v <= -99 else v


def winds_hour(store, t):
    rows = get(WINDS_RANGE, {"date>": t.strftime("%Y-%m-%dT%H:%M:%S"), "date<": (t + H).strftime("%Y-%m-%dT%H:%M:%S"), "sort": "asc"}, timeout=90)
    if not isinstance(rows, list):
        raise ValueError("WINDS range did not return a list")
    by = {}
    for r in rows:
        try:
            tm = dt(r["reading_datetime"])
        except Exception:  # noqa: BLE001
            continue
        if not (t <= tm < t + H):
            continue
        by.setdefault((r.get("tower"), float(r.get("hgt") or -1)), []).append(r)

    def minutes(sensors):
        """per-minute (mean, peak, dir) combining towers/sides, prevailing side first"""
        per = {}
        for tw, hg in sensors:
            for r in by.get((tw, float(hg)), []):
                per.setdefault(r["reading_datetime"], []).append(r)
        out = []
        for _, rs in sorted(per.items()):
            rs.sort(key=lambda r: 0 if r.get("prevailing") else 1)
            r = next((x for x in rs if wnum(x.get("avg_spd_1min")) is not None), None)
            if r:
                out.append((wnum(r.get("avg_spd_1min")), wnum(r.get("peak_spd_1min")), wnum(r.get("avg_dir_1min"))))
        return out

    def interp(spec):
        lo, hi = float(spec["lo"]), float(spec["hi"])
        f = math.log(200 / lo) / math.log(hi / lo)
        per = {}
        for tw in spec["towers"]:
            for hg in (lo, hi):
                for r in by.get((tw, hg), []):
                    per.setdefault(r["reading_datetime"], {}).setdefault(hg, []).append(r)
        out = []
        for _, d in sorted(per.items()):
            if lo not in d or hi not in d:
                continue
            a = sorted(d[lo], key=lambda r: 0 if r.get("prevailing") else 1)[0]
            b = sorted(d[hi], key=lambda r: 0 if r.get("prevailing") else 1)[0]
            sa, sb = wnum(a.get("avg_spd_1min")), wnum(b.get("avg_spd_1min"))
            pa, pb = wnum(a.get("peak_spd_1min")), wnum(b.get("peak_spd_1min"))
            if sa is None or sb is None:
                continue
            out.append((sa + (sb - sa) * f, None if pa is None or pb is None else pa + (pb - pa) * f, wnum(b.get("avg_dir_1min"))))
        return out

    for pid, p in POINTS.items():
        if "w54" in p:
            m = minutes(p["w54"])
            if len(m) >= 20:
                s = [x[0] for x in m]
                store.put(t, pid, "s54", r1(sum(s) / len(s)))
                store.put(t, pid, "s54x", r1(max(s)))
                g = [x[1] for x in m if x[1] is not None]
                store.put(t, pid, "g54", r1(max(g)) if g else None)
                u = sum(-x[0] * math.sin(math.radians(x[2])) for x in m if x[2] is not None)
                v = sum(-x[0] * math.cos(math.radians(x[2])) for x in m if x[2] is not None)
                store.put(t, pid, "d54", round((math.degrees(math.atan2(-u, -v)) + 360) % 360) if (u or v) else None)
        m = minutes(p["w200"]) if "w200" in p else interp(p["w200i"]) if "w200i" in p else []
        if len(m) >= 20:
            s = [x[0] for x in m]
            store.put(t, pid, "s200", r1(sum(s) / len(s)))
            store.put(t, pid, "s200x", r1(max(s)))
            g = [x[1] for x in m if x[1] is not None]
            store.put(t, pid, "g200", r1(max(g)) if g else None)
        if "temp" in p:
            for tw, hg in p["temp"]:
                rs = by.get((tw, float(hg)), [])
                tt = [wnum(r.get("tmp")) for r in rs if wnum(r.get("tmp")) is not None]
                dd = [wnum(r.get("dp")) for r in rs if wnum(r.get("dp")) is not None]
                if len(tt) >= 20:
                    store.put(t, pid, "t", r1(sum(tt) / len(tt)))
                    store.put(t, pid, "td", r1(sum(dd) / len(dd)) if len(dd) >= 20 else None)
                    break
    return len(rows)


def ltg_rows(kind, a, b):
    url = LTG_RANGE.format(k=kind)
    try:
        rows = get(url, {"date>": a.strftime("%Y-%m-%dT%H:%M:%S"), "date<": b.strftime("%Y-%m-%dT%H:%M:%S"), "sort": "asc"}, timeout=90)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace").lower().replace(",", "") if hasattr(e, "read") else ""
        if ("100000" in body or "too many" in body) and (b - a) > timedelta(seconds=2):
            mid = a + (b - a) / 2
            return ltg_rows(kind, a, mid) + ltg_rows(kind, mid, b)
        raise
    return rows if isinstance(rows, list) else []


def lightning_hour(store, t):
    cg = ltg_rows("c2g", t, t + H)
    cc = ltg_rows("c2c", t, t + H)
    for pid, p in POINTS.items():
        def count(rows, r):
            n = 0
            for x in rows:
                la, lo = x.get("lat_decimal"), x.get("lon_decimal")
                if la is None or lo is None:
                    continue
                try:
                    if not (t <= dt(x["event_datetime"]) < t + H):
                        continue
                except Exception:  # noqa: BLE001
                    continue
                if nmi(p["lat"], p["lon"], float(la), float(lo)) <= r:
                    n += 1
            return n
        store.put(t, pid, "cg5", count(cg, 5))
        store.put(t, pid, "cg10", count(cg, 10))
        store.put(t, pid, "cc10", count(cc, 10))
    return len(cg) + len(cc)


def mrms_hour(store, t):
    """MRMS hourly QPE ending at t+1h (the file named for the hour's end); value at each point and max within ~3 km"""
    end = t + H
    url = MRMS_AWS.format(d=end.strftime("%Y%m%d"), h=end.strftime("%H"))
    payload = gzip.decompress(get(url, raw=True, timeout=90))
    import eccodes as ec  # noqa: E402
    import numpy as np  # noqa: E402
    gid = ec.codes_new_from_message(payload)
    try:
        ni, nj = ec.codes_get(gid, "Ni"), ec.codes_get(gid, "Nj")
        lat0, lon0 = ec.codes_get(gid, "latitudeOfFirstGridPointInDegrees"), ec.codes_get(gid, "longitudeOfFirstGridPointInDegrees")
        di, dj = ec.codes_get(gid, "iDirectionIncrementInDegrees"), ec.codes_get(gid, "jDirectionIncrementInDegrees")
        jpos = ec.codes_get(gid, "jScansPositively")
        for pid, p in POINTS.items():
            ii = int(round(((p["lon"] % 360) - lon0) / di))
            jj = int(round(((p["lat"] - lat0) if jpos else (lat0 - p["lat"])) / dj))
            idx = [(jj + b) * ni + (ii + a) for b in range(-2, 3) for a in range(-2, 3) if 0 <= ii + a < ni and 0 <= jj + b < nj]
            vals = np.array(ec.codes_get_elements(gid, "values", idx), dtype=float)
            vals[vals < 0] = np.nan
            centre = vals[len(vals) // 2]
            mm_in = 1 / 25.4
            store.put(t, pid, "pr", None if not np.isfinite(centre) else round(float(centre) * mm_in, 3))
            store.put(t, pid, "prx", None if not np.isfinite(vals).any() else round(float(np.nanmax(vals)) * mm_in, 3))
    finally:
        ec.codes_release(gid)


def metar_days(store, start, end):
    q = {"station": METARS, "data": ["tmpf", "dwpf", "vsby", "wxcodes"], "tz": "Etc/UTC", "format": "onlycomma",
         "latlon": "no", "missing": "empty", "trace": "empty", "direct": "no", "report_type": [3, 4],
         "year1": start.year, "month1": start.month, "day1": start.day, "hour1": start.hour,
         "year2": end.year, "month2": end.month, "day2": end.day, "hour2": end.hour}
    text = get(IEM_ASOS, q, raw=True, timeout=90).decode("utf-8", "replace")
    lines = text.splitlines()
    head = lines[0].split(",") if lines else []
    hours = {}
    for ln in lines[1:]:
        c = dict(zip(head, ln.split(",")))
        try:
            tm = datetime.strptime(c["valid"], "%Y-%m-%d %H:%M").replace(tzinfo=UTC)
        except Exception:  # noqa: BLE001
            continue
        hours.setdefault((c["station"], tm.replace(minute=0)), []).append(c)
    for pid, p in POINTS.items():
        stn = p["metar"][1:] if p["metar"].startswith("K") else p["metar"]
        t = start
        while t < end:
            obs = hours.get((stn, t)) or hours.get((p["metar"], t)) or []
            if obs:
                f = lambda k: [float(o[k]) for o in obs if o.get(k) not in (None, "", "M")]  # noqa: E731
                tt, dd, vv = f("tmpf"), f("dwpf"), f("vsby")
                store.put(t, pid, "mt", r1(tt[-1]) if tt else None)
                store.put(t, pid, "mtd", r1(dd[-1]) if dd else None)
                store.put(t, pid, "vis", min(vv) if vv else None)
                store.put(t, pid, "ts", 1 if any("TS" in (o.get("wxcodes") or "") for o in obs) else 0)
                if p.get("temp_from_metar"):
                    store.put(t, pid, "t", r1(tt[-1]) if tt else None)
                    store.put(t, pid, "td", r1(dd[-1]) if dd else None)
                store.mark(t, "metar")
            t += H


def collect_obs():
    store = ObsStore()
    now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    back = int(os.environ.get("VERIFY_BACKFILL_H", "48"))
    hours = [now - k * H for k in range(1, back + 1)]
    status = {}
    for src, fn, per_run, min_age in (("winds", winds_hour, 8, 1), ("ltg", lightning_hour, 8, 1), ("mrms", mrms_hour, 12, 2)):
        todo = [t for t in hours if (now - t) >= min_age * H and not store.done(t, src)][:per_run]
        ok = fail = 0
        for t in todo:
            if time_left() < 300:
                break
            try:
                fn(store, t)
                store.mark(t, src)
                ok += 1
            except urllib.error.HTTPError as e:
                fail += 1
                if src == "mrms" and e.code == 404 and now - t < 4 * H:
                    continue  # not published yet
                LOG(f"{src} {t:%Y-%m-%d %HZ}: {e}")
            except Exception as e:  # noqa: BLE001
                fail += 1
                LOG(f"{src} {t:%Y-%m-%d %HZ}: {e}")
        status[src] = {"filled": ok, "failed": fail, "pending": len([t for t in hours if not store.done(t, src)])}
        LOG(f"obs {src}: filled {ok}, failed {fail}")
    try:
        metar_days(store, now - 50 * H, now)
        status["metar"] = {"ok": True}
    except Exception as e:  # noqa: BLE001
        status["metar"] = {"ok": False, "error": str(e)}
        LOG(f"metar: {e}")
    store.write()
    return status


# ---------------------------------------------------------------- guidance archive
OM_VARS = "temperature_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_80m,precipitation"


def om_url(model, ens, det_extra=""):
    base = "https://ensemble-api.open-meteo.com/v1/ensemble" if ens else "https://api.open-meteo.com/v1/forecast"
    lats = ",".join(str(p["lat"]) for p in POINTS.values())
    lons = ",".join(str(p["lon"]) for p in POINTS.values())
    return (f"{base}?latitude={lats}&longitude={lons}&hourly={OM_VARS}{det_extra}&models={model}"
            "&temperature_unit=fahrenheit&wind_speed_unit=kn&precipitation_unit=inch&timezone=GMT&timeformat=unixtime&forecast_days=8")


def member_series(hr, issue, suffix=""):
    """hourly arrays 0..LEAD_H from issue time for one member"""
    times = hr.get("time", [])
    idx = {int(tm): i for i, tm in enumerate(times)}
    def col(name):
        arr = hr.get(name + suffix) or [None] * len(times)
        return [arr[idx[int((issue + k * H).timestamp())]] if int((issue + k * H).timestamp()) in idx else None for k in range(LEAD_H + 1)]
    return {"t": col("temperature_2m"), "td": col("dew_point_2m"), "s10": col("wind_speed_10m"), "d10": col("wind_direction_10m"),
            "g10": col("wind_gusts_10m"), "s80": col("wind_speed_80m"), "pr": col("precipitation"), "pp": col("precipitation_probability") if not suffix else [None] * (LEAD_H + 1)}


def derive(m):
    out = {k: [] for k in ("t", "td", "s54", "g54", "s200", "g200", "d", "pr", "pp")}
    for k in range(LEAD_H + 1):
        s10, s80, g10 = m["s10"][k], m["s80"][k], m["g10"][k]
        gf = gust_factor(s10, g10)
        s54, s200 = wind_at(Z54, s10, s80), wind_at(Z200, s10, s80)
        out["t"].append(m["t"][k]); out["td"].append(m["td"][k])
        out["s54"].append(s54); out["s200"].append(s200)
        out["g54"].append(peak_at(Z54, s54, gf)); out["g200"].append(peak_at(Z200, s200, gf))
        out["d"].append(m["d10"][k]); out["pr"].append(m["pr"][k]); out["pp"].append(m["pp"][k])
    return out


def summarize(members):
    """mean of continuous fields and event probabilities across members (0..1)"""
    n = LEAD_H + 1
    res = {k: [None] * n for k in CONT + PROB}
    for k in range(n):
        for f in ("t", "td", "s54", "g54", "s200", "g200"):
            v = [m[f][k] for m in members if m[f][k] is not None]
            res[f][k] = r1(sum(v) / len(v)) if v else None
        u = [(-math.sin(math.radians(m["d"][k])) * (m["s54"][k] or 1), -math.cos(math.radians(m["d"][k])) * (m["s54"][k] or 1)) for m in members if m["d"][k] is not None]
        res["d"][k] = round((math.degrees(math.atan2(-sum(a for a, _ in u), -sum(b for _, b in u))) + 360) % 360) if u else None
        pp = [m["pp"][k] for m in members if m["pp"][k] is not None]
        prs = [m["pr"][k] for m in members if m["pr"][k] is not None]
        if pp:
            res["pp"][k] = round(sum(pp) / len(pp) / 100, 3)
        elif prs:
            res["pp"][k] = round(sum(1 for x in prs if x >= 0.01) / len(prs), 3)
        ss = [max(m["s54"][k] or 0, m["s200"][k] or 0) for m in members if m["s54"][k] is not None]
        gg = [max(m["g54"][k] or 0, m["g200"][k] or 0) for m in members if m["g54"][k] is not None]
        if ss:
            res["x18"][k] = round(sum(1 for x in ss if x > 18) / len(ss), 3)
        if gg:
            for thr, key in ((25, "x25"), (35, "x35"), (50, "x50")):
                res[key][k] = round(sum(1 for x in gg if x > thr) / len(gg), 3)
    return res


def om_sources(issue):
    out = {}
    for ens, lst in ((False, OM_DET), (True, OM_ENS)):
        for sid, model in lst:
            if time_left() < 400:
                break
            try:
                js = get(om_url(model, ens, "" if ens else ",precipitation_probability"), timeout=90)
            except urllib.error.HTTPError as e:
                try:
                    js = get(om_url(model, ens), timeout=90) if e.code == 400 else None
                except Exception:  # noqa: BLE001
                    js = None
            except Exception as e:  # noqa: BLE001
                LOG(f"guidance {sid}: {e}")
                js = None
            if not js:
                continue
            arr = js if isinstance(js, list) else [js]
            per = {}
            for (pid, _), loc in zip(POINTS.items(), arr):
                hr = loc.get("hourly", {})
                if ens:
                    sfx = sorted({k[len("temperature_2m"):] for k in hr if k.startswith("temperature_2m_member")})
                    members = [derive(member_series(hr, issue, s)) for s in [""] + sfx if (hr.get("temperature_2m" + s))]
                else:
                    members = [derive(member_series(hr, issue))]
                members = [m for m in members if any(v is not None for v in m["t"])]
                if members:
                    per[pid] = summarize(members)
            if per:
                out[sid] = per
    return out


def mos_sources(issue):
    out = {}
    for sid, model in MOS:
        js = load(os.path.join(ROOT, "docs", "data", "mos", model + ".json"), None)
        if not js:
            continue
        rows = js if isinstance(js, list) else js.get("data", [])
        if isinstance(rows, dict):
            keys = list(rows); n = len(rows[keys[0]]) if keys else 0
            rows = [{k: rows[k][i] for k in keys} for i in range(n)]
        by = {}
        for r in rows:
            by.setdefault(str(r.get("station", "")).upper(), []).append(r)
        per = {}
        for pid, stn in MOS_STN.items():
            rs = by.get(stn) or by.get(stn[1:]) or []
            if not rs:
                continue
            m = {k: [None] * (LEAD_H + 1) for k in ("t", "td", "s10", "d10", "g10", "s80", "pr", "pp")}
            for r in rs:
                try:
                    ft = dt(str(r.get("ftime")).replace(" ", "T"))
                except Exception:  # noqa: BLE001
                    continue
                k = int(round((ft - issue).total_seconds() / 3600))
                if not 0 <= k <= LEAD_H:
                    continue
                num = lambda key: (float(r[key]) if r.get(key) not in (None, "", "None") and str(r.get(key)).lstrip("-").replace(".", "", 1).isdigit() else None)  # noqa: E731
                m["t"][k], m["td"][k] = num("tmp"), num("dpt")
                m["s10"][k], m["d10"][k], m["g10"][k] = num("wsp"), num("wdr"), num("gst")
            # MOS is 1-3 hourly: carry values across short gaps so every hour has a value
            for f in ("t", "td", "s10", "d10", "g10"):
                last = None
                for k in range(LEAD_H + 1):
                    if m[f][k] is not None:
                        last = (k, m[f][k])
                    elif last and k - last[0] <= 2:
                        m[f][k] = last[1]
            per[pid] = summarize([derive(m)])
            for f in PROB:
                per[pid][f] = [None] * (LEAD_H + 1)  # MOS probabilities aren't hourly events; not scored here
        if per:
            out[sid] = per
    return out


def hires_sources(issue):
    js = load(os.path.join(ROOT, "docs", "data", "hires.json"), None)
    out = {}
    if not js:
        return out
    for s in js.get("sources", []):
        per = {}
        for pid in POINTS:
            site = (s.get("sites") or {}).get(pid) or {}
            if s.get("fam") == "ct":
                tst = (site.get("iv") or {}).get("tst") or []
                arr = [None] * (LEAD_H + 1)
                for k in range(LEAD_H + 1):
                    a = (issue + k * H).timestamp() * 1000
                    hit = [x["p"] for x in tst if x["a"] <= a < x["b"]]
                    arr[k] = round(max(hit), 3) if hit else None
                if any(v is not None for v in arr):
                    per[pid] = {**{f: [None] * (LEAD_H + 1) for f in CONT + PROB}, "lt": arr}
                continue
            mems = []
            t0, gap = s.get("t0"), 1
            for mm in site.get("members", []):
                if t0 is None:
                    continue
                m = {k: [None] * (LEAD_H + 1) for k in ("t", "td", "s10", "d10", "g10", "s80", "pr", "pp")}
                for k in range(LEAD_H + 1):
                    i = int(round(((issue + k * H).timestamp() * 1000 - t0) / 3600e3))
                    if 0 <= i < len(mm.get("t", [])):
                        for f in ("t", "td", "s10", "d10", "g10", "s80", "pr"):
                            arr = mm.get(f)
                            m[f][k] = arr[i] if arr and i < len(arr) else None
                mems.append(derive(m))
            mems = [m for m in mems if any(v is not None for v in m["t"])]
            if mems:
                per[pid] = summarize(mems)
        if per:
            out[s["id"]] = per
    return out


def blend(sources, weights=None, issue=None):
    """equal-weight (or auto-weighted) mean of the sources, like the forecast page's default blend"""
    out = {}
    for pid in POINTS:
        res = {f: [None] * (LEAD_H + 1) for f in CONT + PROB}
        for f in CONT + PROB:
            grp = next(g for g, fs in GROUPS.items() if f in fs)
            for k in range(LEAD_H + 1):
                band = band_of(k)
                pairs = []
                for sid, per in sources.items():
                    v = (per.get(pid) or {}).get(f)
                    v = v[k] if v else None
                    if v is None:
                        continue
                    w = 2.0 if sid in ("hrefct", "refsct") else 1.0
                    if weights:
                        w *= weight_of(weights, pid, grp, band, sid)
                    pairs.append((v, w))
                if pairs:
                    if f == "d":
                        u = sum(-math.sin(math.radians(v)) * w for v, w in pairs); vv = sum(-math.cos(math.radians(v)) * w for v, w in pairs)
                        res[f][k] = round((math.degrees(math.atan2(-u, -vv)) + 360) % 360)
                    else:
                        res[f][k] = round(sum(v * w for v, w in pairs) / sum(w for _, w in pairs), 3)
        out[pid] = res
    return out


def archive_guidance(force=False):
    now = datetime.now(UTC)
    issue = now.replace(minute=0, second=0, microsecond=0)
    # the most recent issue slot (05Z or 17Z); scheduled runs can start late, so any run in the
    # 6 hours after a slot archives it once
    slot = max(issue.replace(hour=h) - (timedelta(days=1) if issue.replace(hour=h) > issue else timedelta(0)) for h in ISSUE_HOURS)
    if not force and issue - slot >= 6 * H:
        return {"skipped": "between issue times"}
    path = os.path.join(OUT, "pending", slot.strftime("%Y%m%dT%HZ") + ".json.gz")
    if os.path.exists(path) and not force:
        return {"skipped": "already archived"}
    srcs = {}
    srcs.update(om_sources(issue))
    srcs.update(mos_sources(issue))
    srcs.update(hires_sources(issue))
    weights = load(os.path.join(OUT, "weights.json"), None)
    srcs["blend_equal"] = blend({k: v for k, v in srcs.items()})
    srcs["blend_auto"] = blend({k: v for k, v in srcs.items() if not k.startswith("blend")}, weights if weights and weights.get("weights") else None)
    save(path, {"issue": issue.isoformat(), "lead_h": LEAD_H, "sources": srcs, "scored": []}, gz=True)
    LOG(f"guidance: archived {len(srcs)} sources for {issue:%Y-%m-%d %HZ}")
    return {"issue": issue.isoformat(), "sources": len(srcs)}


# ---------------------------------------------------------------- scoring
def band_of(k):
    for a, b, name in BANDS:
        if a <= k < b:
            return name
    return BANDS[-1][2]


def obs_events(o, hour):
    """observed value for every scored field in one hour (None = not observed)"""
    g = lambda f: o.get(f, [None] * 24)[hour]  # noqa: E731
    s54x, s200x, g54, g200 = g("s54x"), g("s200x"), g("g54"), g("g200")
    sx = max([x for x in (s54x, s200x) if x is not None], default=None)
    gx = max([x for x in (g54, g200) if x is not None], default=None)
    pr = g("pr")
    return {"t": g("t"), "td": g("td"), "s54": g("s54"), "g54": g54, "s200": g("s200"), "g200": g200,
            "d": g("d54") if (g("s54") or 0) >= 5 else None,
            "pp": None if pr is None else (1 if pr >= 0.01 else 0),
            "lt": None if g("cg10") is None else (1 if g("cg10") > 0 else 0),
            "x18": None if sx is None else (1 if sx > 18 else 0),
            "x25": None if gx is None else (1 if gx > 25 else 0),
            "x35": None if gx is None else (1 if gx > 35 else 0),
            "x50": None if gx is None else (1 if gx > 50 else 0)}


def score():
    now = datetime.now(UTC)
    pend = os.path.join(OUT, "pending")
    days = {}
    obs_cache = {}

    def obs_for(t):
        k = t.strftime("%Y%m%d")
        if k not in obs_cache:
            obs_cache[k] = load(os.path.join(OUT, "obs", k + ".json"), None)
        return obs_cache[k]

    def stats_for(t):
        k = t.strftime("%Y%m%d")
        if k not in days:
            days[k] = load(os.path.join(OUT, "stats", k + ".json"), {"date": t.strftime("%Y-%m-%d"), "s": {}})
        return days[k]["s"]

    n_pairs = 0
    for fn in sorted(os.listdir(pend)) if os.path.isdir(pend) else []:
        if not fn.endswith(".json.gz"):
            continue
        path = os.path.join(pend, fn)
        doc = load(path, None)
        if not doc:
            continue
        issue = dt(doc["issue"])
        scored = set(doc.get("scored", []))
        changed = False
        for k in range(doc.get("lead_h", LEAD_H) + 1):
            if k in scored:
                continue
            t = issue + k * H
            if now - t < 6 * H:      # wait for late observations (MRMS Pass2, MERLIN)
                break
            od = obs_for(t)
            if not od:
                if now - t > 72 * H:
                    scored.add(k); changed = True
                continue
            if not (od["done"]["winds"][t.hour] or od["done"]["metar"][t.hour]) and now - t < 48 * H:
                continue
            st = stats_for(t)
            for pid in POINTS:
                ev = obs_events(od["points"].get(pid, {}), t.hour)
                for sid, per in doc["sources"].items():
                    fc = per.get(pid)
                    if not fc:
                        continue
                    band = band_of(k)
                    for f in CONT:
                        fv, ov = (fc.get(f) or [None] * (k + 1))[k] if fc.get(f) else None, ev[f]
                        if fv is None or ov is None:
                            continue
                        e = ((fv - ov + 540) % 360) - 180 if f == "d" else fv - ov
                        a = st.setdefault(f"{pid}|{f}|{band}|{sid}", [0, 0.0, 0.0, 0.0])
                        a[0] += 1; a[1] += e; a[2] += abs(e); a[3] += e * e
                        n_pairs += 1
                    for f in PROB:
                        fv, ov = (fc.get(f) or [None] * (k + 1))[k] if fc.get(f) else None, ev[f]
                        if fv is None or ov is None:
                            continue
                        b = min(9, int(fv * 10))
                        a = st.setdefault(f"{pid}|{f}|{band}|{sid}", [0, 0.0, 0.0, 0.0] + [0, 0.0, 0.0] * 10)
                        a[0] += 1; a[1] += (fv - ov) ** 2; a[2] += fv; a[3] += ov
                        a[4 + 3 * b] += 1; a[5 + 3 * b] += fv; a[6 + 3 * b] += ov
                        n_pairs += 1
            scored.add(k); changed = True
        if len(scored) >= doc.get("lead_h", LEAD_H) + 1 or now - issue > timedelta(days=10):
            os.remove(path)
            LOG(f"score: {fn} complete, removed")
        elif changed:
            doc["scored"] = sorted(scored)
            save(path, doc, gz=True)
    for k, d in days.items():
        save(os.path.join(OUT, "stats", k + ".json"), d)
    LOG(f"score: {n_pairs} forecast/observation pairs")
    return n_pairs


# ---------------------------------------------------------------- summaries and weights
def read_stats(days_back):
    now = datetime.now(UTC)
    out = []
    for k in range(days_back + 1):
        d = now - timedelta(days=k)
        doc = load(os.path.join(OUT, "stats", d.strftime("%Y%m%d") + ".json"), None)
        if doc:
            out.append((k, doc["s"]))
    return out


def accumulate(stats, decay_days=None):
    acc = {}
    for age, s in stats:
        w = 0.5 ** (age / decay_days) if decay_days else 1.0
        for key, a in s.items():
            b = acc.setdefault(key, [0.0] * len(a))
            if len(b) < len(a):
                b.extend([0.0] * (len(a) - len(b)))
            for i, v in enumerate(a):
                b[i] += v * w
    return acc


def summary_and_weights():
    st90 = read_stats(90)
    summ = {"updated": datetime.now(UTC).isoformat(), "points": {p: v["name"] for p, v in POINTS.items()}, "bands": [b[2] for b in BANDS], "windows": {}}
    for win in (7, 30, 90):
        acc = accumulate([(a, s) for a, s in st90 if a <= win])
        rows = {}
        for key, a in acc.items():
            pid, f, band, sid = key.split("|")
            n = a[0]
            if n < 1:
                continue
            if f in CONT:
                rows[key] = [int(n), round(a[1] / n, 2), round(a[2] / n, 2), round(math.sqrt(a[3] / n), 2)]
            else:
                rel = [[int(a[4 + 3 * b]), round(a[5 + 3 * b], 2), round(a[6 + 3 * b], 2)] for b in range(10)] if win >= 30 else None
                rows[key] = [int(n), round(a[1] / n, 4), round(a[2] / n, 4), round(a[3] / n, 4), rel]
        summ["windows"][str(win)] = rows
    summ["days"] = sorted(f[:-5] for f in os.listdir(os.path.join(OUT, "obs")) if f.endswith(".json"))[-120:] if os.path.isdir(os.path.join(OUT, "obs")) else []
    save(os.path.join(OUT, "summary.json"), summ)

    # weights: 45 days, recent days count more (15-day half-life), shrunk toward 1 until there's enough data
    acc = accumulate([(a, s) for a, s in st90 if a <= 45], decay_days=15)
    N0 = 150.0
    by = {}
    for key, a in acc.items():
        pid, f, band, sid = key.split("|")
        if sid.startswith("blend"):
            continue
        grp = next(g for g, fs in GROUPS.items() if f in fs)
        b = by.setdefault((pid, grp, band), {}).setdefault(sid, [0.0, 0.0])
        b[0] += a[0]
        b[1] += a[3] if f in CONT else a[1]       # squared error or Brier sum
    weights = {}
    for (pid, grp, band), srcs in by.items():
        scores = {sid: (v[1] / v[0], v[0]) for sid, v in srcs.items() if v[0] >= 10}
        if len(scores) < 2:
            continue
        med = sorted(s for s, _ in scores.values())[len(scores) // 2]
        for sid, (mse, n) in scores.items():
            raw = (med + 1e-6) / (mse + 1e-6)
            w = 1 + (raw - 1) * n / (n + N0)
            weights.setdefault(pid, {}).setdefault(grp, {}).setdefault(band, {})[sid] = round(min(3.0, max(0.25, w)), 3)
    # does the weighted blend beat the plain blend? (last 30 days)
    acc30 = accumulate([(a, s) for a, s in st90 if a <= 30])
    check = {}
    for grp, fs in GROUPS.items():
        tot = {"blend_equal": [0, 0.0], "blend_auto": [0, 0.0]}
        for key, a in acc30.items():
            pid, f, band, sid = key.split("|")
            if f in fs and sid in tot:
                tot[sid][0] += a[0]; tot[sid][1] += a[3] if f in CONT else a[1]
        if tot["blend_equal"][0] >= 50 and tot["blend_auto"][0] >= 50:
            e, a_ = tot["blend_equal"][1] / tot["blend_equal"][0], tot["blend_auto"][1] / tot["blend_auto"][0]
            check[grp] = {"equal": round(e, 4), "auto": round(a_, 4), "use": a_ <= e * 1.02}
    for pid in weights:
        for grp in list(weights[pid]):
            if grp in check and not check[grp]["use"]:
                weights[pid][grp] = {}
    save(os.path.join(OUT, "weights.json"), {"updated": datetime.now(UTC).isoformat(), "window_days": 45, "half_life_days": 15,
                                             "points": {p: [v["lat"], v["lon"]] for p, v in POINTS.items()},
                                             "groups": GROUPS, "bands": [[a, b, n] for a, b, n in BANDS], "check": check, "weights": weights})
    LOG(f"weights: {sum(len(b) for g in weights.values() for b in g.values())} point/group/band sets")


def weight_of(weights, pid, grp, band, sid):
    try:
        return weights["weights"][pid][grp][band].get(sid, 1.0)
    except (KeyError, TypeError):
        return 1.0


def main(argv):
    todo = {a for a in argv if not a.startswith("--")} or {"obs", "guidance", "score"}
    status = load(os.path.join(OUT, "status.json"), {})
    if "obs" in todo:
        status["obs"] = collect_obs()
    if "guidance" in todo:
        status["guidance"] = archive_guidance(force="--force" in argv)
    if "score" in todo:
        status["pairs"] = score()
        summary_and_weights()
    status["updated"] = datetime.now(UTC).isoformat()
    save(os.path.join(OUT, "status.json"), status)
    return 0


if __name__ == "__main__":
    sys.exit(main([a for a in sys.argv[1:]]))
