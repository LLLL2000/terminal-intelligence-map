"""
Per-terminal attribute model for the anonymized market map.

Everything in here is *modelled*, not observed. The base file carries geography,
a vendor bucket and a data-status flag; this module expands each record into the
~45-field terminal profile the dashboard reads (capacity, equipment, OCR channel
stack, contract position, commercial value, operating KPIs).

Values are drawn from a deterministic hash of the site id, so a given site gets
the same profile on every build — the dataset is reproducible, diffable, and
internally consistent (crane count follows throughput, truck turn follows gate
automation, ACV follows size and channel count) rather than independently random.

The provenance flag `modelled: true` rides on every generated field group so the
UI can label the distinction instead of hiding it.
"""
from __future__ import annotations
import hashlib, math

BASE_YEAR = 2026

# --------------------------------------------------------------------------
# Deterministic pseudo-random primitives (hash-seeded, reproducible)
# --------------------------------------------------------------------------
def u(*parts) -> float:
    """Uniform [0,1) keyed on the joined parts."""
    h = hashlib.md5("|".join(str(p) for p in parts).encode()).digest()
    return int.from_bytes(h[:8], "big") / 2 ** 64

def ui(lo, hi, *parts) -> int:
    return lo + int(u(*parts) * (hi - lo + 1))

def wpick(pairs, *parts):
    """Weighted choice from [(value, weight), ...]."""
    total = sum(w for _, w in pairs)
    r = u(*parts) * total
    acc = 0.0
    for v, w in pairs:
        acc += w
        if r < acc:
            return v
    return pairs[-1][0]

def gauss(mu, sd, *parts) -> float:
    a = max(u("g1", *parts), 1e-12)
    b = u("g2", *parts)
    return mu + sd * math.sqrt(-2 * math.log(a)) * math.cos(2 * math.pi * b)

def clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


# --------------------------------------------------------------------------
# Taxonomies
# --------------------------------------------------------------------------
TOS_VENDORS = ["TOS Alpha", "TOS Beta", "TOS Gamma", "TOS Delta", "TOS Epsilon", "In-house TOS"]
AUTOMATION = ["Manual", "Semi-automated", "Automated"]
INTEGRATION = ["TOS-integrated", "Partial API", "Standalone"]
HOSTING = ["Edge appliance", "On-prem server", "Hybrid", "Vendor cloud"]
SUPPORT = ["Platinum 24/7", "Gold business-hours", "Standard", "Time & materials"]
CHANNELS = ["Direct", "Integrator", "Crane OEM"]
DEAL_STAGES = ["Unqualified", "Prospect", "Qualified", "RFP live", "Shortlisted"]
OCR_CHANNELS = ["Gate", "Crane", "Rail", "Yard/UTR"]

# Regional throughput priors (thousand TEU per year, geometric mean)
REGION_TEU_MU = {
    "Asia-Pacific": 2100.0,
    "Europe": 850.0,
    "North America": 880.0,
    "MEA": 760.0,
    "Latin America": 470.0,
    "Industrial": 0.0,
}
REGION_AUTOMATION_BIAS = {
    "Asia-Pacific": 1.35, "Europe": 1.25, "North America": 0.85,
    "MEA": 1.05, "Latin America": 0.7, "Industrial": 0.5,
}


def size_class(kind: str, vol: float) -> str:
    if kind == "marine":
        for lim, lab in ((5000, "Mega"), (2000, "Large"), (600, "Mid"), (180, "Small")):
            if vol >= lim:
                return lab
        return "Feeder"
    if kind == "rail":
        for lim, lab in ((250, "Class I hub"), (90, "Regional hub")):
            if vol >= lim:
                return lab
        return "Local ramp"
    return "Industrial site"


# --------------------------------------------------------------------------
# Main entry point
# --------------------------------------------------------------------------
def enrich(t: dict, region: str, vendor_tier: dict) -> None:
    """Attach the modelled profile to a single terminal record, in place."""
    sid = t["id"]
    kind = t.get("type") or "marine"
    known = t["vendor"] not in ("TBD (researched)", "Defunct")

    # ---- Volume ----------------------------------------------------------
    if kind == "marine":
        mu = REGION_TEU_MU.get(region, 700.0)
        vol = mu * math.exp(gauss(0.0, 0.95, sid, "vol"))
        vol = clamp(vol, 35.0, 24000.0)
        unit = "k TEU/yr"
    elif kind == "rail":
        vol = 175.0 * math.exp(gauss(0.0, 0.85, sid, "vol"))
        vol = clamp(vol, 8.0, 900.0)
        unit = "k lifts/yr"
    else:
        vol = 42.0 * math.exp(gauss(0.0, 0.7, sid, "vol"))
        vol = clamp(vol, 4.0, 320.0)
        unit = "k moves/yr"
    vol = round(vol, 1)
    t["volume"] = vol
    t["volume_unit"] = unit
    t["size_class"] = size_class(kind, vol)

    # 5-year history back-cast from a per-site growth rate
    cagr = round(gauss(3.1, 4.4, sid, "cagr"), 1)
    cagr = clamp(cagr, -12.0, 17.0)
    t["cagr_3y"] = cagr
    hist, v = [], vol
    for _ in range(5):
        hist.append(round(v, 1))
        v = v / (1 + cagr / 100.0)
    t["vol_history"] = list(reversed(hist))          # oldest -> newest
    t["history_years"] = list(range(BASE_YEAR - 5, BASE_YEAR))

    # ---- Physical plant --------------------------------------------------
    if kind == "marine":
        sts = int(clamp(round(vol / 215.0 + u(sid, "sts") * 2), 1, 42))
        berths = int(clamp(round(sts / 2.8), 1, 14))
        t["sts_cranes"] = sts
        t["berths"] = berths
        t["quay_m"] = int(berths * ui(300, 370, sid, "quay"))
        t["depth_m"] = round(clamp(8.6 + math.log10(max(vol, 40)) * 2.0 + gauss(0, 0.5, sid, "dep"), 7.5, 18.5), 1)
        t["yard_ha"] = int(clamp(vol / 15.5 + ui(4, 22, sid, "yard"), 4, 480))
        t["yard_cranes"] = int(clamp(sts * 2.3 + ui(0, 6, sid, "yc"), 0, 120))
        t["reach_stackers"] = int(clamp(vol / 260.0 + ui(1, 7, sid, "rs"), 1, 60))
        t["reefer_plugs"] = int(clamp(vol * 0.45 + ui(0, 200, sid, "rp"), 0, 12000))
        t["on_dock_rail"] = u(sid, "odr") < (0.62 if region == "North America" else 0.44)
        t["rail_tracks"] = ui(2, 10, sid, "rt") if t["on_dock_rail"] else 0
        t["gate_lanes"] = int(clamp(vol / 155.0 + ui(2, 8, sid, "gl"), 2, 44))
    elif kind == "rail":
        t["sts_cranes"] = 0
        t["berths"] = 0
        t["quay_m"] = 0
        t["depth_m"] = None
        t["yard_ha"] = int(clamp(vol / 1.9 + ui(8, 40, sid, "yard"), 8, 420))
        t["yard_cranes"] = int(clamp(vol / 95.0 + ui(0, 3, sid, "yc"), 0, 14))
        t["reach_stackers"] = int(clamp(vol / 40.0 + ui(1, 5, sid, "rs"), 1, 34))
        t["reefer_plugs"] = int(clamp(vol * 0.6, 0, 900))
        t["on_dock_rail"] = True
        t["rail_tracks"] = ui(4, 22, sid, "rt")
        t["gate_lanes"] = int(clamp(vol / 22.0 + ui(2, 6, sid, "gl"), 2, 30))
    else:
        t["sts_cranes"] = 0
        t["berths"] = 0
        t["quay_m"] = 0
        t["depth_m"] = None
        t["yard_ha"] = int(clamp(vol / 3.2 + ui(2, 14, sid, "yard"), 2, 120))
        t["yard_cranes"] = 0
        t["reach_stackers"] = ui(0, 4, sid, "rs")
        t["reefer_plugs"] = ui(0, 60, sid, "rp")
        t["on_dock_rail"] = u(sid, "odr") < 0.35
        t["rail_tracks"] = ui(1, 4, sid, "rt") if t["on_dock_rail"] else 0
        t["gate_lanes"] = ui(2, 10, sid, "gl")

    t["annual_trucks_k"] = int(clamp(vol * (0.62 if kind == "marine" else 1.4) + ui(3, 30, sid, "trk"), 4, 3200))

    # ---- Automation posture ---------------------------------------------
    bias = REGION_AUTOMATION_BIAS.get(region, 1.0)
    big = 1.0 + min(vol / (2500.0 if kind == "marine" else 260.0), 2.2)
    t["automation"] = wpick(
        [("Automated", 0.9 * bias * big), ("Semi-automated", 2.6 * bias), ("Manual", 3.0 / bias)],
        sid, "auto")
    t["gate_automation_pct"] = int(clamp(
        {"Automated": 88, "Semi-automated": 61, "Manual": 24}[t["automation"]] + gauss(0, 9, sid, "gap"), 0, 100))

    # ---- OCR channel stack ----------------------------------------------
    # The primary vendor owns the gate; crane/rail channels are separate buys and
    # frequently land with a different supplier, which is what makes a site
    # multi-vendor. Whitespace sites carry no channel attribution at all.
    prim = t["vendor"]
    others = [v for v in vendor_tier if v != prim]
    def alt(tag):
        return others[int(u(sid, tag) * len(others))] if others else prim

    stack = {}
    if known:
        stack["Gate"] = {"vendor": prim, "year": 0}
        p_crane = 0.62 if kind == "marine" else 0.18
        p_crane *= 1.35 if t["automation"] == "Automated" else 1.0
        if u(sid, "cr") < p_crane:
            stack["Crane"] = {"vendor": prim if u(sid, "crv") < 0.66 else alt("crv2"), "year": 0}
        if t["on_dock_rail"] and u(sid, "rl") < 0.55:
            stack["Rail"] = {"vendor": prim if u(sid, "rlv") < 0.7 else alt("rlv2"), "year": 0}
        if u(sid, "yd") < (0.3 if t["automation"] != "Manual" else 0.1):
            stack["Yard/UTR"] = {"vendor": prim if u(sid, "ydv") < 0.75 else alt("ydv2"), "year": 0}

    # ---- Lifecycle -------------------------------------------------------
    install = int(clamp(round(gauss(2016.5, 5.2, sid, "inst")), 2001, BASE_YEAR - 1))
    upgrade = int(clamp(install + ui(0, 9, sid, "upg"), install, BASE_YEAR))
    term = wpick([(3, 2), (5, 4), (7, 2), (10, 1)], sid, "term")
    end = upgrade + term
    while end < BASE_YEAR:
        end += term
    t["install_year"] = install if known else None
    t["last_upgrade_year"] = upgrade if known else None
    t["contract_years"] = term if known else None
    t["contract_end"] = end if known else None
    t["refresh_due_yrs"] = (end - BASE_YEAR) if known else None
    t["incumbency_yrs"] = (BASE_YEAR - install) if known else None

    for i, ch in enumerate(OCR_CHANNELS):
        if ch in stack:
            stack[ch]["year"] = int(clamp(install + ui(0, 6, sid, "chy", i), install, BASE_YEAR))
    t["ocr_stack"] = stack
    t["ocr_channels"] = [c for c in OCR_CHANNELS if c in stack]
    t["channel_count"] = len(stack)
    t["multi_vendor"] = len({v["vendor"] for v in stack.values()}) > 1

    # ---- Technical & operating KPIs -------------------------------------
    tier = vendor_tier.get(prim, 2)                     # 1 = leader, 3 = long tail
    if known:
        acc = 95.4 + (3 - tier) * 0.85 + (upgrade - 2016) * 0.16 + gauss(0, 0.9, sid, "acc")
        t["ocr_accuracy"] = round(clamp(acc, 86.0, 99.7), 1)
        t["uptime_pct"] = round(clamp(99.1 + (3 - tier) * 0.15 + gauss(0, 0.45, sid, "up"), 95.5, 99.99), 2)
        t["integration"] = wpick(
            [("TOS-integrated", 3.0 + (3 - tier)), ("Partial API", 2.0), ("Standalone", 1.2)], sid, "intg")
        t["hosting"] = wpick(
            [("Edge appliance", 2.4), ("On-prem server", 2.8 if upgrade < 2019 else 1.4),
             ("Hybrid", 1.8), ("Vendor cloud", 0.7 + max(0, upgrade - 2019) * 0.22)], sid, "host")
        t["damage_ai"] = u(sid, "dai") < clamp(0.06 + (upgrade - 2015) * 0.055, 0.02, 0.72)
        t["anpr"] = u(sid, "anpr") < 0.82
        t["weighbridge_link"] = u(sid, "wb") < 0.47
        t["support_tier"] = wpick([("Platinum 24/7", 2.2), ("Gold business-hours", 3.0),
                                   ("Standard", 2.0), ("Time & materials", 1.0)], sid, "sup")
        t["sales_channel"] = "Integrator" if t.get("indirect_via") else wpick(
            [("Direct", 3.4), ("Integrator", 1.5), ("Crane OEM", 0.9)], sid, "sch")
    else:
        t["ocr_accuracy"] = None
        t["uptime_pct"] = None
        t["integration"] = None
        t["hosting"] = None
        t["damage_ai"] = False
        t["anpr"] = u(sid, "anpr") < 0.35
        t["weighbridge_link"] = False
        t["support_tier"] = None
        t["sales_channel"] = None

    t["tos"] = wpick([(v, w) for v, w in zip(TOS_VENDORS, [3.0, 2.4, 1.8, 1.3, 0.9, 1.6])], sid, "tos")

    base_turn = 52.0 - t["gate_automation_pct"] * 0.24 - min(t["gate_lanes"], 24) * 0.42
    t["truck_turn_min"] = int(clamp(base_turn + gauss(0, 6, sid, "ttm"), 12, 110))
    t["gate_moves_hr"] = int(clamp(t["gate_lanes"] * (10 + t["gate_automation_pct"] / 12.0) + gauss(0, 8, sid, "gmh"), 8, 700))

    # ---- Commercial ------------------------------------------------------
    # One sizing model, two readings: contracted value where a vendor is attributed,
    # opportunity value where the site is whitespace. An unattributed site has no
    # licence value at all, so acv stays null rather than defaulting to a number
    # that would silently inflate installed-base totals.
    scale = 42.0 + 0.030 * (vol if kind == "marine" else vol * 3.1)
    mult = {"Direct": 1.0, "Integrator": 0.72, "Crane OEM": 0.66, None: 1.0}[t["sales_channel"]]
    breadth = 1.0 + 0.34 * max(0, t["channel_count"] - 1)
    acv = scale * mult * breadth * (1 + gauss(0, 0.16, sid, "acv"))
    # In-house systems are a deployment but not a sale — no licence value attaches.
    commercial = known and t["vendor"] != "In-house / Proprietary"
    t["acv_kusd"] = int(clamp(acv, 20, 1800)) if commercial else None
    t["tam_kusd"] = int(clamp(scale * 1.22 * (1 + gauss(0, 0.2, sid, "tam")), 24, 2000))

    # ---- Competitive posture --------------------------------------------
    if known:
        risk = 0.0
        risk += clamp(34 - (t["refresh_due_yrs"] or 0) * 8, 0, 34)          # contract proximity
        risk += clamp((97.5 - (t["ocr_accuracy"] or 97.5)) * 6, 0, 26)      # performance gap
        risk += {"TOS-integrated": 0, "Partial API": 11, "Standalone": 20}[t["integration"]]
        risk += {"Platinum 24/7": 0, "Gold business-hours": 5,
                 "Standard": 11, "Time & materials": 16}[t["support_tier"]]
        risk += clamp((BASE_YEAR - upgrade - 4) * 2.4, 0, 14)
        t["displacement_risk"] = int(clamp(risk + gauss(0, 5, sid, "risk"), 2, 99))
        t["deal_stage"] = None
    else:
        t["displacement_risk"] = None
        t["deal_stage"] = wpick([(s, w) for s, w in zip(DEAL_STAGES, [4.0, 3.0, 1.8, 0.7, 0.35])], sid, "stage")

    # ---- Record hygiene / freshness -------------------------------------
    t["data_completeness"] = int(clamp(
        (78 if known else 52) + (12 if t.get("internet_inferred") else 0) + gauss(0, 11, sid, "dc"), 20, 100))
    conf_base = {"Confirmed": 88, "Inferred": 63, "Conflict": 45,
                 "TBD (researched)": 34, "Defunct": 30}.get(t["status"], 50)
    t["confidence_score"] = int(clamp(conf_base + gauss(0, 8, sid, "cs"), 5, 99))
    days = ui(0, 540, sid, "seen")
    t["days_since_verified"] = days
    t["freshness"] = "Fresh" if days <= 90 else "Ageing" if days <= 270 else "Stale"
    t["modelled"] = True
