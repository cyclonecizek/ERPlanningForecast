#!/usr/bin/env python3
"""Save today's Keetch-Byram Drought Index for Brevard County to docs/data/kbdi.json.

The Burn planning forecast (docs/burnplan.html) starts its KBDI from this file and steps it forward with the
forecast. The value is the Florida Forest Service county mean from the FDACS daily KBDI report. If the report
can't be read (site down or its layout changed), the existing file is left as it is and the page falls back to
reading the report itself or a value the forecaster types in.

Run by .github/workflows/update-kbdi.yml every morning. Standard library only.
"""
import html
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

URL = "https://weather.fdacs.gov/KBDI/report/kbdi_current.html"
COUNTY = "Brevard"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "data", "kbdi.json")
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]


def cells(row_html):
    out = []
    for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row_html, flags=re.S | re.I):
        out.append(re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", c))).strip())
    return out


def parse(page, county=COUNTY):
    """The report date and the county row: mean KBDI, change since yesterday, and the county's min / max."""
    text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", page)))
    dm = re.search(r"KBDI Summary for ([A-Za-z]+)\.? (\d{1,2}), (\d{4})", text)
    if not dm:
        raise ValueError("report date not found")
    mon = MONTHS.index(dm.group(1)[:3].lower()) + 1
    date = f"{dm.group(3)}-{mon:02d}-{int(dm.group(2)):02d}"
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, flags=re.S | re.I):
        c = cells(row)
        if len(c) >= 4 and c[0].strip().lower() == county.lower():
            kbdi, change = int(re.sub(r"[^\d-]", "", c[1])), int(re.sub(r"[^\d-]", "", c[2]) or 0)
            mm = re.match(r"\s*(\d+)\s*/\s*(\d+)", c[3])
            if not 0 <= kbdi <= 800:
                raise ValueError(f"KBDI {kbdi} out of range")
            d = {"kbdi": kbdi, "change": change, "date": date, "county": county, "source": URL,
                 "saved": datetime.now(timezone.utc).isoformat(timespec="seconds")}
            if mm:
                d["min"], d["max"] = int(mm.group(1)), int(mm.group(2))
            return d
    raise ValueError(f"{county} not found in the report")


def main():
    try:
        req = urllib.request.Request(URL, headers={"User-Agent": "ERPlanningForecast KBDI mirror (GitHub Actions)"})
        page = urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "replace")
        d = parse(page)
    except Exception as e:  # noqa: BLE001
        print(f"KBDI not updated: {e}")
        return 0
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=1)
    print(f"KBDI {d['county']} {d['date']}: {d['kbdi']} (change {d['change']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
