"""Shared constants: air classes, time-of-day blocks, activities, street kinds, cities.

Everything here is a plain table taken from docs/SPEC.md so the three algorithms
and the API all use the same numbers.
"""

USER_AGENT = "tynys/0.1 (student project; github.com/tairqaldy/tynys)"
TIMEZONE = "Asia/Almaty"

# ---------------------------------------------------------------- air classes (SPEC 4.1)

CLASSES = [
    {"id": "low", "label": "Low", "min": 0, "max": 5},
    {"id": "moderate", "label": "Moderate", "min": 5, "max": 15},
    {"id": "elevated", "label": "Elevated", "min": 15, "max": 25},
    {"id": "high", "label": "High", "min": 25, "max": None},
]
N_CLASSES = 4

# Representative PM2.5 used when a band has fewer than 5 history hours.
DEFAULT_REP_PM25 = [2.5, 10.0, 20.0, 35.0]


def band(pm):
    """Class index of an hourly PM2.5 value: 0 if pm <= 5, 1 if <= 15, 2 if <= 25, else 3."""
    if pm <= 5:
        return 0
    if pm <= 15:
        return 1
    if pm <= 25:
        return 2
    return 3


# ---------------------------------------------------------------- time-of-day blocks (SPEC 4.2)

BLOCKS = ["night", "morning", "day", "evening"]


def block_of_hour(hour):
    """Time-of-day block of a local clock hour: night 00-05, morning 06-11, day 12-17, evening 18-23."""
    return BLOCKS[hour // 6]


# ---------------------------------------------------------------- MDP settings (SPEC 4.4)

HARM = [0, 1, 4, 10]  # utility points lost per hour outside, by class

ACTIVITIES = [
    {"id": "walk", "label": "Walk", "duration_min": 45, "intensity": 1.0, "benefit": 5, "must": False},
    {"id": "run", "label": "Run", "duration_min": 40, "intensity": 2.5, "benefit": 8, "must": False},
    {"id": "kids", "label": "Outside with a child", "duration_min": 60, "intensity": 1.0, "benefit": 6,
     "must": False},
    {"id": "errand", "label": "Errand on foot", "duration_min": 30, "intensity": 1.0, "benefit": 6,
     "must": True},
]
ACTIVITY_BY_ID = {a["id"]: a for a in ACTIVITIES}

DEFAULTS = {"reliability": 0.8, "wait_cost": 0.3, "deadline_hours": 8, "harm": HARM}

LIMITS = {
    "reliability": (0.55, 0.95),
    "wait_cost": (0.1, 1.0),
    "deadline_hours": (1, 12),
    "duration_min": (10, 180),
}

# ---------------------------------------------------------------- street kinds (SPEC 4.5)

KINDS = [
    {"id": "major", "label": "Major road", "index": 2.0},
    {"id": "secondary", "label": "Secondary road", "index": 1.6},
    {"id": "tertiary", "label": "Tertiary road", "index": 1.3},
    {"id": "street", "label": "Residential street", "index": 1.0},
    {"id": "path", "label": "Footpath", "index": 0.8},
    {"id": "park", "label": "Path in a park", "index": 0.6},
    {"id": "roadside_major", "label": "Path beside a major road", "index": 1.8},
    {"id": "roadside_secondary", "label": "Path beside a secondary road", "index": 1.4},
]
KIND_IDS = [k["id"] for k in KINDS]
KIND_INDEX = [k["index"] for k in KINDS]  # exposure index by kind number
H_FACTOR = 0.6
assert H_FACTOR == min(KIND_INDEX), "H_FACTOR must equal the smallest exposure index"

WALK_M_PER_MIN = 80
RUN_M_PER_MIN = 160
VENTILATION_WALK = 1.2  # m3/h, moderate intensity (US EPA Exposure Factors Handbook 2011, ch. 6)
VENTILATION_RUN = 3.0   # m3/h, high intensity

MAX_SNAP_M = 400
MAX_TRIP_M = 12000

# ---------------------------------------------------------------- cities

CITIES = [
    {"id": "astana", "name": "Astana", "center": [51.1282, 71.4304]},
    {"id": "almaty", "name": "Almaty", "center": [43.2389, 76.8897]},
]
CITY_BY_ID = {c["id"]: c for c in CITIES}

ASSUMPTIONS = [
    "PM2.5 values are model readings from the CAMS global model (~40 km grid) served by Open-Meteo, "
    "not sensor measurements; past hours are earlier model runs.",
    "Class cut-points 5 / 15 / 25 ug/m3 come from WHO 2021 daily and annual guidance and are applied "
    "to hourly values; WHO defines no hourly PM2.5 guideline.",
    "Reading trust r (default 0.8) is a setting, not estimated from data: the probability that the grid "
    "value's band is the true class on your street.",
    "Forecast trust r_f(k) = max(0.5, 0.75 - 0.005 k) for an hour k hours ahead.",
    "Transitions are learned from model readings: the reading's band stands in for the hidden class.",
    "Harm per hour [0, 1, 4, 10], activity benefits and the waiting cost are utility points chosen by hand.",
    "The action now uses the QMDP rule: it assumes the uncertainty about the class disappears after one step.",
    "The traffic exposure index per street kind and the 25 m roadside rule are a proxy for traffic "
    "pollution next to busy roads, not measured values.",
    "Ventilation 1.2 m3/h walking and 3.0 m3/h running (US EPA Exposure Factors Handbook 2011, ch. 6); "
    "walking 80 m/min, running 160 m/min.",
    "Not medical advice.",
]
