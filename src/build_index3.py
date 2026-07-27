"""
Build index3.html — the public, fully anonymized market map.

Pipeline
--------
1. ANONYMIZE   Pull the terminal universe out of index2.html and strip every
               identifier: vendors and operators collapse to "Company N", site
               names to "Site <id>", and all free-text (port/city/state, sources,
               evidence, URLs, notes) is dropped. Only coordinates survive.
2. EXTEND      Layer in additional public container-terminal coordinates
               (tpl3/ports_seed.py), de-duplicated against the base universe by
               great-circle distance, and assign each a vendor/status draw from
               region-specific priors.
3. ENRICH      Expand every record into a full terminal profile — capacity,
               equipment, OCR channel stack, contract position, commercial value,
               operating KPIs (tpl3/enrich.py). These fields are MODELLED, not
               observed, and the UI labels them as such.
4. ASSEMBLE    Emit a single self-contained HTML file from the tpl3/ templates.

Nothing from index2.html's prose, source lists or methodology text is carried
over — the output is rebuilt from templates in this repo, so there is no path for
an identifying string to survive by accident.
"""
from __future__ import annotations

import json
import math
import re
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).parent
TPL = ROOT / "tpl3"
sys.path.insert(0, str(TPL))

import enrich as E                      # noqa: E402
from ports_seed import PORTS, DEDUPE_KM  # noqa: E402

SRC = ROOT / "index2.html"
DST = ROOT / "index3.html"
DATA_DST = ROOT / "terminals_anonymized.json"

BASE_YEAR = E.BASE_YEAR
SNAPSHOT = date(BASE_YEAR, 7, 1)

# ==========================================================================
# 1. ANONYMIZE
# ==========================================================================
html_src = SRC.read_text(encoding="utf-8")

def grab(pattern: str, flags=0) -> str:
    m = re.search(pattern, html_src, flags)
    if not m:
        raise SystemExit(f"PATTERN NOT FOUND in index2.html: {pattern[:70]}")
    return m.group(1)

vendor_order = re.findall(r'"((?:[^"\\]|\\.)*)"', grab(r"const VENDOR_ORDER = \[([\s\S]*?)\];"))
old_colors = json.loads(grab(r"const VENDOR_COLORS = (\{[\s\S]*?\});"))
seg_order = re.findall(r'"((?:[^"\\]|\\.)*)"', grab(r"const SEGMENT_ORDER = \[([\s\S]*?)\];"))
terminals = json.loads(grab(r"^const TERMINALS = (\[[\s\S]*?\]);$", re.MULTILINE))

CATEGORY_BUCKETS = {"In-house / Proprietary", "TBD (researched)", "Defunct"}

vendor_map: dict[str, str] = {}
company_counter = 0
for v in vendor_order:
    if v in CATEGORY_BUCKETS:
        vendor_map[v] = v
    else:
        company_counter += 1
        vendor_map[v] = f"Company {company_counter}"
op_counter = company_counter
new_vendor_order = [vendor_map[v] for v in vendor_order]

def map_vendor(v):
    return None if v is None else vendor_map.get(v, v)

# Two segment mappings name real entities directly and so are kept out of this
# file entirely — see private/identity_map.py, which is git-ignored. Everything
# else here is positional and reveals nothing without index2.html.
sys.path.insert(0, str(ROOT / "private"))
try:
    from identity_map import RAIL_NETWORKS, SEG_VENDOR_ALIAS, EXTRA_DROP_FIELDS   # noqa: E402
except ImportError:
    raise SystemExit(
        "private/identity_map.py not found.\n"
        "This build cannot produce a publishable file without it: rail carrier and\n"
        "industrial-customer segment labels would keep their real names. Restore the\n"
        "private mapping module before building."
    )

def map_segment(seg: str) -> str:
    if not seg:
        return seg
    if seg in RAIL_NETWORKS:
        return RAIL_NETWORKS[seg]
    m = re.match(r"^Industrial – (.+) customer$", seg)
    if m:
        full = SEG_VENDOR_ALIAS.get(m.group(1), m.group(1))
        if full in vendor_map:
            return f"Industrial – {vendor_map[full]} customer"
    return seg

op_cache: dict[str, str] = {}
def map_operator(op: str) -> str:
    global op_counter
    if not op:
        return ""
    if op in vendor_map:
        return vendor_map[op]
    if op not in op_cache:
        op_counter += 1
        op_cache[op] = f"Company {op_counter}"
    return op_cache[op]

DROP_FIELDS = ("port", "city", "state", "sources", "inferred_from", "conflict_notes",
               "geo_source", "extra", "evidence")

for t in terminals:
    t["vendor"] = map_vendor(t.get("vendor"))
    t["operator"] = map_operator(t.get("operator") or "")
    t["name"] = f"Site {t.get('id', '')}".strip()
    t["segment"] = map_segment(t.get("segment") or "")
    t["mm_claim"] = map_vendor(t.get("mm_claim"))
    t["df_claim"] = map_vendor(t.get("df_claim"))
    t["indirect_via"] = "Integrator channel" if t.get("indirect_via") else ""
    for f in DROP_FIELDS + EXTRA_DROP_FIELDS + ("source_urls",):
        t.pop(f, None)

new_colors = {vendor_map.get(k, k): c for k, c in old_colors.items()}
new_seg_order = [map_segment(s) for s in seg_order]

# ==========================================================================
# 2. EXTEND — additional public terminal coordinates
# ==========================================================================
SEGMENT_REGION = {
    "APAC": "Asia-Pacific",
    "Africa/MidEast": "MEA",
    "Americas – South": "Latin America",
    "Americas – North": "North America",
}

def region_of(t: dict) -> str:
    seg = t.get("segment") or ""
    if seg.startswith("Industrial"):
        return "Industrial"
    if seg.startswith("Europe"):
        return "Europe"
    if seg.startswith("Marine") or seg.startswith("Rail"):
        return "North America"
    return SEGMENT_REGION.get(seg, "Other")

for t in terminals:
    t["region"] = region_of(t)

def haversine_km(a_lat, a_lon, b_lat, b_lon) -> float:
    p = math.pi / 180
    h = (0.5 - math.cos((b_lat - a_lat) * p) / 2
         + math.cos(a_lat * p) * math.cos(b_lat * p) * (1 - math.cos((b_lon - a_lon) * p)) / 2)
    return 12742 * math.asin(math.sqrt(max(h, 0.0)))

# Coarse spatial buckets so the de-dupe check stays linear rather than N*M.
grid: dict[tuple, list] = {}
def cell(lat, lon):
    return (int(lat // 0.5), int(lon // 0.5))
for t in terminals:
    grid.setdefault(cell(t["lat"], t["lon"]), []).append(t)

def is_duplicate(lat, lon) -> bool:
    cy, cx = cell(lat, lon)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            for o in grid.get((cy + dy, cx + dx), ()):
                if haversine_km(lat, lon, o["lat"], o["lon"]) < DEDUPE_KM:
                    return True
    return False

named_vendors = [v for v in new_vendor_order if v not in CATEGORY_BUCKETS]
global_counts = {v: sum(1 for t in terminals if t["vendor"] == v) for v in named_vendors}
total_named = sum(global_counts.values()) or 1

# Region-specific vendor priors: anchored to global scale (so the big players stay
# big) but shuffled per region, which is what makes regional share tables differ.
region_weights: dict[str, list] = {}
for reg in ("Asia-Pacific", "MEA", "Latin America", "North America", "Europe"):
    ws = []
    for v in named_vendors + ["In-house / Proprietary"]:
        base = (global_counts.get(v, 1) / total_named) ** 0.55 if v in global_counts else 0.06
        ws.append((v, max(base * math.exp(E.gauss(0, 0.8, v, reg, "prior")), 0.004)))
    region_weights[reg] = ws

operator_pool = sorted({t["operator"] for t in terminals if t["operator"]})
added = 0
for i, (hint, lat, lon, region, segment) in enumerate(PORTS):
    if is_duplicate(lat, lon):
        continue
    added += 1
    sid = f"X{added:03d}"
    known = E.u(sid, "known") > 0.40
    if known:
        vendor = E.wpick(region_weights[region], sid, "vendor")
        status = E.wpick([("Confirmed", 4.2), ("Inferred", 4.6), ("Conflict", 0.55)], sid, "status")
    else:
        vendor = "TBD (researched)"
        status = "TBD (researched)"
    if E.u(sid, "op") < 0.72 and operator_pool:
        operator = operator_pool[int(E.u(sid, "opi") * len(operator_pool))]
    else:
        op_counter += 1
        operator = f"Company {op_counter}"
        operator_pool.append(operator)
    alt = [v for v in named_vendors if v != vendor]
    rec = {
        "id": sid,
        "name": f"Site {sid}",
        "operator": operator,
        "type": "marine",
        "segment": segment,
        "region": region,
        "lat": lat, "lon": lon,
        "vendor": vendor,
        "status": status,
        "mm_claim": vendor if known else None,
        "df_claim": (alt[int(E.u(sid, "df") * len(alt))] if status == "Conflict" and alt else None),
        "multi_op": E.u(sid, "mo") < 0.55,
        "indirect_via": "Integrator channel" if known and E.u(sid, "ind") < 0.16 else "",
        "osm_quality": E.wpick([("full", 3), ("partial", 2), ("minimal", 1)], sid, "osm"),
    }
    if known and E.u(sid, "ii") < 0.5:
        rec["internet_inferred"] = True
        rec["confidence"] = E.wpick([("high", 4), ("medium", 2.2), ("low", 1)], sid, "conf")
    terminals.append(rec)
    grid.setdefault(cell(lat, lon), []).append(rec)

# ==========================================================================
# 3. ENRICH
# ==========================================================================
counts_now = {v: sum(1 for t in terminals if t["vendor"] == v) for v in named_vendors}
ranked = sorted(named_vendors, key=lambda v: -counts_now.get(v, 0))
vendor_tier = {v: (1 if i < 3 else 2 if i < 8 else 3) for i, v in enumerate(ranked)}

for t in terminals:
    E.enrich(t, t["region"], vendor_tier)
    t["last_verified"] = (SNAPSHOT - timedelta(days=t.pop("days_since_verified"))).isoformat()

# ---- Vendor profile cards -------------------------------------------------
ARCHETYPES = {
    1: "Global incumbent",
    2: "Regional specialist",
    3: "Niche / emerging challenger",
}
POSITIONING = ["Breadth of installed base", "Depth of TOS integration", "Price-led displacement",
               "AI-native accuracy", "Crane-OEM bundled", "Turnkey systems integration"]

vendor_profiles = {}
for v in named_vendors:
    n = counts_now.get(v, 0)
    if n == 0:
        continue
    tier = vendor_tier[v]
    sites = [t for t in terminals if t["vendor"] == v]
    regions = sorted({t["region"] for t in sites})
    vendor_profiles[v] = {
        "tier": tier,
        "archetype": ARCHETYPES[tier],
        "founded": E.ui(1978, 2006, v, "founded") if tier < 3 else E.ui(2004, 2020, v, "founded"),
        "positioning": POSITIONING[int(E.u(v, "pos") * len(POSITIONING))],
        "hq_region": regions[int(E.u(v, "hq") * len(regions))] if regions else "Europe",
        "regions": regions,
        "headcount": int(E.clamp(round((n * E.ui(9, 26, v, "hc")) / 10) * 10, 20, 4000)),
    }

CATEGORY_PROFILE_DESC = {
    "In-house / Proprietary": "Operator-built or vendor-neutral system — no commercial licence.",
    "TBD (researched)": "Addressable site; incumbent not yet attributed. Counts as whitespace.",
    "Defunct": "Flagged closed or inactive in the source data; excluded from shares.",
}

# ==========================================================================
# 4. ASSEMBLE
# ==========================================================================
REGION_ORDER = ["North America", "Europe", "Asia-Pacific", "MEA", "Latin America", "Industrial"]
REGION_COLORS = {
    "North America": "#0040E0", "Europe": "#00A65A", "Asia-Pacific": "#E4572E",
    "MEA": "#C9A227", "Latin America": "#7B4BC8", "Industrial": "#6E6E6E", "Other": "#999999",
}
STATUS_ORDER = ["Confirmed", "Inferred", "Conflict", "TBD (researched)", "Defunct"]

meta = {
    "snapshot": SNAPSHOT.isoformat(),
    "base_year": BASE_YEAR,
    "records": len(terminals),
    "added_locations": added,
    "vendor_count": len([v for v in named_vendors if counts_now.get(v, 0)]),
    "operator_count": len({t["operator"] for t in terminals if t["operator"]}),
}

def js_const(name, value):
    return f"const {name} = {json.dumps(value, ensure_ascii=False, separators=(',', ':'))};\n"

data_block = (
    js_const("META", meta)
    + js_const("TERMINALS", terminals)
    + js_const("VENDOR_COLORS", new_colors)
    + js_const("VENDOR_ORDER", new_vendor_order)
    + js_const("VENDOR_NAMED", named_vendors)
    + js_const("VENDOR_PROFILES", vendor_profiles)
    + js_const("CATEGORY_DESC", CATEGORY_PROFILE_DESC)
    + js_const("SEGMENT_ORDER", new_seg_order)
    + js_const("STATUS_ORDER", STATUS_ORDER)
    + js_const("REGION_ORDER", REGION_ORDER)
    + js_const("REGION_COLORS", REGION_COLORS)
    + js_const("OCR_CHANNELS", E.OCR_CHANNELS)
    + js_const("TOS_VENDORS", E.TOS_VENDORS)
    + js_const("DEAL_STAGES", E.DEAL_STAGES)
)

def read(name: str) -> str:
    return (TPL / name).read_text(encoding="utf-8")

JS_PARTS = ["core.js", "charts.js", "dashboard.js", "vendors.js", "technology.js",
            "pipeline.js", "database.js", "map.js", "methodology.js", "boot.js"]

out = (
    "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
    "<title>Terminal Intelligence — Anonymized Market Map</title>\n"
    "<link rel=\"stylesheet\" href=\"https://unpkg.com/leaflet@1.9.4/dist/leaflet.css\"/>\n"
    "<style>\n" + read("styles.css") + "\n</style>\n</head>\n<body>\n"
    + read("body.html")
    + "\n<script src=\"https://unpkg.com/leaflet@1.9.4/dist/leaflet.js\"></script>\n<script>\n"
    + data_block
    + "\n".join(read(p) for p in JS_PARTS)
    + "\n</script>\n</body>\n</html>\n"
)

DST.write_text(out, encoding="utf-8")
DATA_DST.write_text(json.dumps(terminals, ensure_ascii=False, indent=1), encoding="utf-8")

print(f"anonymized  : {company_counter} vendor buckets, {len(op_cache)} operators mapped")
print(f"extended    : +{added} locations (of {len(PORTS)} candidates; rest within {DEDUPE_KM} km of an existing site)")
print(f"enriched    : {len(terminals)} records x {len(terminals[0])} fields")
print(f"regions     : " + ", ".join(f"{r}={sum(1 for t in terminals if t['region']==r)}" for r in REGION_ORDER))
print(f"wrote       : {DST.name} ({len(out):,} chars) + {DATA_DST.name}")
