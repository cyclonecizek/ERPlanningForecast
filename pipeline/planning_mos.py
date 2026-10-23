#!/usr/bin/env python3
"""Mirror MOS/LAMP/NBM text and SPC Day 1-3 outlooks for docs/planning.html.

The planning page reads docs/data/mos/<MODEL>.json and docs/data/mos/spc_dayN.json from
this site first, and only falls back to IEM / SPC directly if a file is missing. Running this
from GitHub Actions means the page never depends on those servers allowing browser requests.

Standard library only. A failed download keeps the previous file, so a bad hour never blanks
the page.
"""
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data", "mos")
STATIONS = ["KTTS", "KXMR", "KCOF"]           # SLF / LC-39B, KXMR / SLC-37, Patrick
MODELS = ["LAV", "GFS", "NAM", "GFSX", "NBS", "NBE"]
IEM = "https://mesonet.agron.iastate.edu/api/1/mos.json?{st}&model={model}"
SPC = "https://www.spc.noaa.gov/products/outlook/day{d}otlk_cat.nolyr.geojson"
LL2 = "https://ll.thespacedevs.com/2.2.0/launch/upcoming/?location__ids=12,27&limit=15"
KP = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json"
PROTONS = "https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json"
THREEDAY = "https://services.swpc.noaa.gov/text/3-day-forecast.txt"
UA = {"User-Agent": "planning-forecast-mirror (GitHub Actions)"}


def get(url, tries=3, timeout=60):
    last = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001 - log and retry
            last = e
            time.sleep(4 * (k + 1))
    raise last


def write(name, obj):
    path = os.path.join(OUT, name)
    with open(path + ".tmp", "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    os.replace(path + ".tmp", path)


def rows_of(js):
    d = js.get("data") if isinstance(js, dict) else js
    return d if isinstance(d, list) else []


def main():
    os.makedirs(OUT, exist_ok=True)
    ok = 0
    st = "&".join("station=" + s for s in STATIONS)
    for model in MODELS:
        try:
            js = get(IEM.format(st=st, model=model))
            n = len(rows_of(js))
            if n:
                write(f"{model}.json", js)
                ok += 1
                print(f"{model}: {n} rows")
            else:
                print(f"{model}: empty response, keeping previous file")
        except Exception as e:  # noqa: BLE001
            print(f"{model}: failed ({e}), keeping previous file")
    for d in (1, 2, 3):
        try:
            js = get(SPC.format(d=d))
            if isinstance(js, dict) and "features" in js:
                write(f"spc_day{d}.json", js)
                print(f"SPC day {d}: {len(js['features'])} features")
        except Exception as e:  # noqa: BLE001
            print(f"SPC day {d}: failed ({e}), keeping previous file")
    # upcoming Space Coast launches (Launch Library 2) and the planetary K-index forecast (SWPC)
    for name, url in (("launches.json", LL2), ("kp.json", KP), ("protons.json", PROTONS)):
        try:
            js = get(url)
            if js:
                with open(os.path.join(ROOT, "docs", "data", name + ".tmp"), "w") as f:
                    json.dump(js, f, separators=(",", ":"))
                os.replace(os.path.join(ROOT, "docs", "data", name + ".tmp"), os.path.join(ROOT, "docs", "data", name))
                print(f"{name}: saved")
        except Exception as e:  # noqa: BLE001
            print(f"{name}: failed ({e}), keeping previous file")
    # SWPC 3-day forecast text (solar radiation storm probabilities for proton flux)
    try:
        with urllib.request.urlopen(urllib.request.Request(THREEDAY, headers=UA), timeout=45) as r:
            txt = r.read().decode("utf-8", "replace")
        if "Solar Radiation" in txt:
            with open(os.path.join(ROOT, "docs", "data", "3day.txt"), "w") as f:
                f.write(txt)
            print("3day.txt: saved")
    except Exception as e:  # noqa: BLE001
        print(f"3day.txt: failed ({e}), keeping previous file")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
