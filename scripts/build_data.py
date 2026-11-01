#!/usr/bin/env python3
"""Build data/pumpkins-<year>.json from FAOSTAT QCL and UN Comtrade (HS 070993).

Standard library only. Usage:

    python3 scripts/build_data.py --year 2024            # use cached raw files when present
    python3 scripts/build_data.py --year 2025 --refresh  # re-download everything

Raw API responses and the FAOSTAT item extract are written to sources/raw/ so the
JSON can be rebuilt and audited without contacting the APIs again.
"""
import argparse
import csv
import io
import json
import sys
import time
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "sources" / "raw"
OUT = ROOT / "data"

FAO_DATASETS = "https://bulks-faostat.fao.org/production/datasets_E.json"
FAO_BULK = "https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data_(Normalized).zip"
FAO_ITEM = "394"  # Pumpkins, squash and gourds (CPC 01235)
FAO_CSV = "Production_Crops_Livestock_E_All_Data_(Normalized).csv"
FAO_CHINA_AGGREGATE = "351"  # mainland + Hong Kong + Macao + Taiwan; its parts are listed separately

COMTRADE = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"
COMTRADE_REPORTERS = "https://comtradeapi.un.org/files/v1/app/reference/Reporters.json"
HS_CODE = "070993"

# FAOSTAT uses standard M49 codes; Comtrade uses its own codes for these reporters.
# Comtrade publishes Taiwan's own declarations as reporter 490 "Other Asia, nes".
M49_TO_COMTRADE = {840: 842, 250: 251, 356: 699, 756: 757, 578: 579, 158: 490}

SHORT_NAMES = {
    "China, mainland": "China (mainland)",
    "United States of America": "United States",
    "Russian Federation": "Russia",
    "Netherlands (Kingdom of the)": "Netherlands",
    "United Kingdom of Great Britain and Northern Ireland": "United Kingdom",
    "Iran (Islamic Republic of)": "Iran",
    "Republic of Korea": "South Korea",
    "Democratic People's Republic of Korea": "North Korea",
    "Bolivia (Plurinational State of)": "Bolivia",
    "Venezuela (Bolivarian Republic of)": "Venezuela",
    "Republic of Moldova": "Moldova",
    "United Republic of Tanzania": "Tanzania",
    "Syrian Arab Republic": "Syria",
    "Lao People's Democratic Republic": "Laos",
    "China, Hong Kong SAR": "Hong Kong SAR",
    "China, Taiwan Province of": "Taiwan Province of China",
    "China, Macao SAR": "Macao SAR",
    "Micronesia (Federated States of)": "Micronesia",
    "Türkiye": "Türkiye",
    "United Rep. of Tanzania": "Tanzania",
    "Bosnia Herzegovina": "Bosnia and Herzegovina",
    "Rep. of Korea": "South Korea",
}


USED = []  # raw files behind this build; their retrieval dates go into the JSON
STAMPS = RAW / "retrieved.json"


def stamp(name):
    log = json.loads(STAMPS.read_text()) if STAMPS.exists() else {}
    log[name] = date.today().isoformat()
    STAMPS.write_text(json.dumps(log, indent=2, sort_keys=True) + "\n")


def fetch(url, path, refresh, binary=False):
    """Download url to path unless cached. Retries the Comtrade preview's 429 rate limit."""
    USED.append(path.name)
    if path.exists() and not refresh:
        return path.read_bytes() if binary else path.read_text("utf-8")
    for attempt in range(6):
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
                body = r.read()
            break
        except Exception as e:  # noqa: BLE001 - network errors and HTTP 429 are retried alike
            if attempt == 5:
                raise
            print(f"  retry {attempt + 1} after {e}: {url}", file=sys.stderr)
            time.sleep(6 * (attempt + 1))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    stamp(path.name)
    time.sleep(1.5)  # stay under the anonymous preview rate limit
    return body if binary else body.decode("utf-8")


def comtrade(params, path, refresh):
    query = "&".join(f"{k}={v}" for k, v in params.items())
    data = json.loads(fetch(f"{COMTRADE}?{query}", path, refresh))
    if data.get("error"):
        sys.exit(f"Comtrade error for {query}: {data['error']}")
    if data["count"] >= 500:
        sys.exit(f"Comtrade preview truncated at 500 rows for {query}; use smaller reporter chunks")
    return data["data"]


def load_fao(year, refresh):
    meta = json.loads(fetch(FAO_DATASETS, RAW / "faostat-datasets.json", refresh))
    qcl = next(d for d in meta["Datasets"]["Dataset"] if d["DatasetCode"] == "QCL")
    extract = RAW / f"faostat-qcl-{FAO_ITEM}-production.csv"
    if refresh or not extract.exists():
        zbytes = fetch(FAO_BULK, ROOT / "sources" / "faostat-qcl.zip", refresh, binary=True)
        USED.remove("faostat-qcl.zip")  # the committed extract stands in for the uncommitted zip
        stamp(extract.name)
        z = zipfile.ZipFile(io.BytesIO(zbytes))
        with z.open(FAO_CSV) as f, extract.open("w", newline="", encoding="utf-8") as out:
            reader = csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"))
            cols = ["Area Code", "Area Code (M49)", "Area", "Item Code", "Item Code (CPC)", "Item",
                    "Element", "Year", "Unit", "Value", "Flag", "Note"]
            w = csv.DictWriter(out, cols, extrasaction="ignore")
            w.writeheader()
            for row in reader:
                if row["Item Code"] == FAO_ITEM and row["Element"] == "Production":
                    w.writerow(row)
    USED.append(extract.name)
    with extract.open(encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r["Year"] == str(year)]
    if not rows:
        sys.exit(f"FAOSTAT has no {year} production rows for item {FAO_ITEM}")
    assert {r["Unit"] for r in rows} == {"t"}, "unexpected FAOSTAT unit"
    world = next(r for r in rows if r["Area Code"] == "5000")
    countries = [r for r in rows if int(r["Area Code"]) < 5000 and r["Area Code"] != FAO_CHINA_AGGREGATE]
    return qcl, float(world["Value"]), countries


def load_comtrade(year, refresh):
    reporters = json.loads(fetch(COMTRADE_REPORTERS, RAW / "comtrade-reporters.json", refresh))["results"]
    reporters = {r["reporterCode"]: r for r in reporters}
    exports = comtrade({"period": year, "cmdCode": HS_CODE, "flowCode": "X", "partnerCode": 0},
                       RAW / f"comtrade-{HS_CODE}-{year}-X-world.json", refresh)
    imports = comtrade({"period": year, "cmdCode": HS_CODE, "flowCode": "M", "partnerCode": 0},
                       RAW / f"comtrade-{HS_CODE}-{year}-M-world.json", refresh)
    # Partner-level imports, used only as a coverage check for countries that did not report exports.
    by_partner = []
    codes = sorted(r["reporterCode"] for r in imports)
    for i in range(0, len(codes), 8):
        chunk = ",".join(map(str, codes[i:i + 8]))
        by_partner += comtrade({"period": year, "cmdCode": HS_CODE, "flowCode": "M", "reporterCode": chunk},
                               RAW / f"comtrade-{HS_CODE}-{year}-M-partners-{i // 8:02d}.json", refresh)
    for rows in (exports, imports, by_partner):
        for r in rows:  # one total row per reporter/partner: no customs, transport or partner2 splits
            assert (r["customsCode"], r["motCode"], r["partner2Code"]) == ("C00", 0, 0), r
    assert len({r["reporterCode"] for r in exports}) == len(exports), "duplicate export reporters"
    assert len({(r["reporterCode"], r["partnerCode"]) for r in by_partner}) == len(by_partner), "duplicate partner rows"
    return reporters, exports, imports, by_partner


def rank(items, key):
    ordered = sorted(items, key=key, reverse=True)
    return {id(x): i + 1 for i, x in enumerate(ordered)}


def build(year, refresh):
    qcl, world_t, fao_rows = load_fao(year, refresh)
    reporters, exports, imports, by_partner = load_comtrade(year, refresh)

    groups = [r["reporterCode"] for r in exports
              if reporters.get(r["reporterCode"], {}).get("isGroup") and r["reporterCode"] != 490]
    assert not groups, f"group reporters in export data: {groups}"

    countries = {}
    for r in fao_rows:
        m49 = int(r["Area Code (M49)"].strip("'"))
        code = M49_TO_COMTRADE.get(m49, m49)
        value = float(r["Value"]) if r["Value"] else None
        countries[code] = {
            "id": code,
            "name": SHORT_NAMES.get(r["Area"], r["Area"]),
            "faoArea": r["Area"],
            "m49": f"{m49:03d}",
            "production": None if value is None else {"tonnes": value, "flag": r["Flag"]},
            "productionStatus": "reported" if value is not None else f"missing (FAO flag {r['Flag']})",
        }
    for r in exports:
        c = r["reporterCode"]
        rep = reporters[c]
        entry = countries.setdefault(c, {
            "id": c, "name": SHORT_NAMES.get(rep["text"], rep["text"]), "faoArea": None,
            "m49": f"{c:03d}", "production": None,
            "productionStatus": "no FAOSTAT row",
        })
        entry["exports"] = {
            "usd": r["primaryValue"],
            "netWeightT": r["netWgt"] / 1000 if r["netWgt"] else None,
            "classification": r["classificationCode"],
        }
        entry["comtradeReporter"] = rep["text"]

    mirror, buyers = {}, {}
    for r in by_partner:
        if r["partnerCode"] != 0:
            mirror[r["partnerCode"]] = mirror.get(r["partnerCode"], 0) + r["primaryValue"]
            buyers.setdefault(r["partnerCode"], []).append(r)

    def short(code):
        text = reporters[code]["text"]
        return countries[code]["name"] if code in countries else SHORT_NAMES.get(text, text)

    producers = [c for c in countries.values() if c["production"]]
    exporters = [c for c in countries.values() if c.get("exports")]
    country_sum_t = sum(c["production"]["tonnes"] for c in producers)
    export_total = sum(c["exports"]["usd"] for c in exporters)
    prank = rank(producers, lambda c: c["production"]["tonnes"])
    erank = rank(exporters, lambda c: c["exports"]["usd"])
    for c in producers:
        c["production"]["rank"] = prank[id(c)]
        c["production"]["share"] = c["production"]["tonnes"] / world_t
    for c in exporters:
        c["exports"]["rank"] = erank[id(c)]
        c["exports"]["share"] = c["exports"]["usd"] / export_total
    for c in countries.values():
        c.setdefault("exports", None)
        c["exportStatus"] = "reported" if c["exports"] else "not reported to UN Comtrade"
        c["mirrorImportsUsd"] = mirror.get(c["id"])
        top = sorted(buyers.get(c["id"], []), key=lambda r: -r["primaryValue"])[:3]
        c["topBuyers"] = [{"name": short(r["reporterCode"]), "usd": r["primaryValue"]} for r in top]
        w = c["exports"] and c["exports"]["netWeightT"]
        c["exportWeightToProduction"] = (w / c["production"]["tonnes"]) if (w and c["production"] and c["production"]["tonnes"] > 0) else None

    # Self-checks: ranks are contiguous, shares close, no aggregate or double-counted China rows.
    assert sorted(c["production"]["rank"] for c in producers) == list(range(1, len(producers) + 1))
    assert sorted(c["exports"]["rank"] for c in exporters) == list(range(1, len(exporters) + 1))
    assert abs(sum(c["exports"]["share"] for c in exporters) - 1) < 1e-9
    assert 0.99 < country_sum_t / world_t <= 1.0001, (country_sum_t, world_t)
    assert all(c["faoArea"] != "China" for c in countries.values())

    tenth_export = sorted(c["exports"]["usd"] for c in exporters)[-10]
    importers = sorted(imports, key=lambda r: -r["primaryValue"])
    top_importers = [{"name": short(r["reporterCode"]), "usd": r["primaryValue"]} for r in importers[:5]]
    unreported = sorted((c for c in countries.values() if not c["exports"] and c["mirrorImportsUsd"]),
                        key=lambda c: -c["mirrorImportsUsd"])

    out = {
        "title": "Who Rules the Pumpkin World?",
        "referenceYear": year,
        "built": date.today().isoformat(),
        "retrieved": {n: json.loads(STAMPS.read_text())[n] for n in sorted(set(USED))},
        "sources": {
            "production": {
                "publisher": "FAO",
                "dataset": "FAOSTAT Crops and livestock products (QCL)",
                "datasetUpdated": qcl["DateUpdate"][:10],
                "item": "Pumpkins, squash and gourds",
                "itemCode": int(FAO_ITEM),
                "cpc": "01235",
                "element": "Production (element 5510)",
                "unit": "tonnes",
                "url": "https://www.fao.org/faostat/en/#data/QCL",
                "bulk": FAO_BULK,
            },
            "exports": {
                "publisher": "United Nations Statistics Division",
                "dataset": "UN Comtrade, annual, HS (as reported)",
                "hsCode": HS_CODE,
                "hsDescription": "Pumpkins, squash and gourds (Cucurbita spp.), fresh or chilled",
                "flow": "Exports (X), reporter-declared, partner World",
                "valueField": "primaryValue (FOB, current US dollars)",
                "url": "https://comtradeplus.un.org/",
                "api": COMTRADE,
            },
        },
        "totals": {
            "worldProductionT": world_t,
            "countryProductionSumT": country_sum_t,
            "producingCountries": len(producers),
            "productionMissing": [c["name"] for c in countries.values() if c["productionStatus"].startswith("missing")],
            "productionFlags": {f: sum(1 for c in producers if c["production"]["flag"] == f) for f in "AEIX"},
            "reportedExportsUsd": export_total,
            "exportReporters": len(exporters),
            "importReporters": len(imports),
            "importsDeclaredUsd": sum(r["primaryValue"] for r in imports),
            "topImporters": top_importers,
            "exportClassifications": {k: sum(1 for c in exporters if c["exports"]["classification"] == k)
                                      for k in sorted({c["exports"]["classification"] for c in exporters})},
            "tenthExportUsd": tenth_export,
            "largestUnreportedByMirror": [
                {"name": c["name"], "mirrorImportsUsd": c["mirrorImportsUsd"]} for c in unreported[:5]
            ],
        },
        "countries": sorted(countries.values(), key=lambda c: c["name"]),
    }
    OUT.mkdir(exist_ok=True)
    path = OUT / f"pumpkins-{year}.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    print(f"Wrote {path.relative_to(ROOT)}")
    print(f"FAOSTAT {year}: {len(producers)} countries, world {world_t:,.0f} t, country sum {country_sum_t:,.0f} t")
    print(f"Comtrade {year}: {len(exporters)} export reporters, {len(imports)} import reporters, total ${export_total:,.0f}")
    print("Top 10 producers:", ", ".join(c["name"] for c in sorted(producers, key=lambda c: c["production"]["rank"])[:10]))
    print("Top 10 exporters:", ", ".join(c["name"] for c in sorted(exporters, key=lambda c: c["exports"]["rank"])[:10]))
    print("Joined with different names (check these are the same place):",
          "; ".join(f"{c['faoArea']} = {c['comtradeReporter']}" for c in countries.values()
                    if c.get("exports") and c["faoArea"] and c["faoArea"] != c["comtradeReporter"]))
    print("Largest non-reporters by partner imports:",
          ", ".join(f"{c['name']} ${c['mirrorImportsUsd']:,.0f}" for c in unreported[:5]),
          f"(10th exporter ${tenth_export:,.0f})")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--year", type=int, required=True, help="reference year, e.g. 2024")
    p.add_argument("--refresh", action="store_true", help="re-download raw sources")
    a = p.parse_args()
    build(a.year, a.refresh)
