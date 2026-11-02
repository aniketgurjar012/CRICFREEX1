import json
import re
import time
import threading
import uuid
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional, Any
import urllib.request
import urllib.parse
import logging

logger = logging.getLogger('cricfreex')
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from scrapers.details import extract_news
from scrapers.normalized import (
    extract_scorecard as normalized_scorecard,
    extract_commentary as normalized_commentary,
    extract_match_info as normalized_info,
    extract_news as normalized_news,
)
from scrapers.upgrade_v4 import (
    commentary as v4_commentary,
    match_news as v4_match_news,
    match_info as v4_match_info,
    over_by_over as v4_over_by_over,
    points_table as v4_points_table,
    rankings as v4_rankings,
    records_catalog as v4_records_catalog,
    stats_records as v4_stats_records,
    news_article as v4_news,
)

app = FastAPI(title="CricFreeX Cricket Centre")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
PROJECT_DIR = Path(__file__).resolve().parent

BASE = "https://www.cricbuzz.com"

session = requests.Session()

session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9"
})

PAGES = {
    "live": "/cricket-match/live-scores",
    "recent": "/cricket-match/live-scores/recent-matches",
    "upcoming": "/cricket-match/live-scores/upcoming-matches",
    "schedule": "/cricket-schedule/series/all",
    "archives": "/cricket-scorecard-archives",
    "news": "/cricket-news/latest-news",
    "series": "/cricket-series",
    "teams": "/cricket-team",
    "rankings": "/cricket-stats/icc-rankings/men/batting",
}

MATCH_CACHE_TTL = 3

cache = {}
lock = threading.Lock()


def fetch(path, ttl=120):

    parsed = urlparse(path)

    if (
        not path.startswith("/")
        or path.startswith("//")
        or parsed.scheme
        or parsed.netloc
        or "\\" in path
    ):
        raise ValueError("Invalid path")

    now = time.time()

    with lock:
        old = cache.get(path)

        if old and now - old["time"] < ttl:
            return old["html"]

    response = session.get(
        BASE + path,
        timeout=25
    )

    response.raise_for_status()

    with lock:
        cache[path] = {
            "html": response.text,
            "time": now
        }

    return response.text


def decode_next(html):

    soup = BeautifulSoup(html, "html.parser")

    results = []

    pattern = (
        r'self\.__next_f\.push\('
        r'\[1,("(?:\\.|[^"\\])*")\]'
        r'\)'
    )

    for script in soup.find_all("script"):

        text = script.get_text()

        for fragment in re.findall(
            pattern, text, re.DOTALL
        ):

            try:
                results.append(json.loads(fragment))
            except json.JSONDecodeError:
                pass

    return results


IST = timezone(timedelta(hours=5, minutes=30))
MONTH_ABBRS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def format_ist_gmt_datetime(dt_or_ms, is_outside=False):
    if not dt_or_ms:
        return ""
    if isinstance(dt_or_ms, (int, float)):
        ts = dt_or_ms / 1000.0 if dt_or_ms > 1e11 else dt_or_ms
        dt_utc = datetime.fromtimestamp(ts, tz=timezone.utc)
    elif isinstance(dt_or_ms, str):
        cleaned = dt_or_ms.strip()
        if cleaned.isdigit():
            val = int(cleaned)
            ts = val / 1000.0 if val > 1e11 else val
            dt_utc = datetime.fromtimestamp(ts, tz=timezone.utc)
        else:
            try:
                dt_utc = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
            except Exception:
                return ""
    elif isinstance(dt_or_ms, datetime):
        dt_utc = dt_or_ms if dt_or_ms.tzinfo else dt_or_ms.replace(tzinfo=timezone.utc)
    else:
        return ""

    dt_ist = dt_utc.astimezone(IST)
    date_str = f"{dt_ist.day:02d} {MONTH_ABBRS[dt_ist.month - 1]} {dt_ist.year}"
    time_ist = dt_ist.strftime("%I:%M %p")
    if is_outside:
        time_gmt = dt_utc.strftime("%I:%M %p")
        return f"{date_str}, {time_ist} IST ({time_gmt} GMT)"
    return f"{date_str}, {time_ist} IST"


def is_venue_outside_india(venue, match_text=""):
    if not venue:
        venue = {}
    tz = str(venue.get("timezone", "")).strip()
    if tz:
        return tz not in ("+05:30", "+5:30")
    city = str(venue.get("city", "")).lower()
    ground = str(venue.get("ground", "")).lower()
    text = f"{city} {ground} {match_text}".lower()
    india_keywords = [
        "india", "ahmedabad", "bengaluru", "bangalore", "chennai", "delhi", "kolkata",
        "mumbai", "hyderabad", "vadodara", "pune", "mohali", "dharamsala", "jaipur",
        "kanpur", "lucknow", "nagpur", "rajkot", "ranchi", "indore", "cuttack", "guwahati",
        "thiruvananthapuram", "visakhapatnam", "dehradun", "surat", "gwalior", "bhopal",
        "ranji", "ipl", "syed mushtaq", "vijay hazare", "dulip", "irani"
    ]
    return not any(k in text for k in india_keywords)


def normalize_status_string(status, start_date=None, venue=None, match_text=""):
    if not status or not isinstance(status, str):
        return status or ""
    is_outside = is_venue_outside_india(venue, match_text)

    if start_date and re.search(r"starts\s+at", status, re.I):
        dt_formatted = format_ist_gmt_datetime(start_date, is_outside)
        if dt_formatted:
            return f"Match starts at {dt_formatted}"

    m = re.search(
        r"(match\s+starts\s+at|starts\s+at)\s+([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{1,2}):(\d{2})\s*(?:GMT|UTC)?",
        status,
        re.I
    )
    if m:
        prefix, month_name, day, hour, minute = m.groups()
        months = {
            "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
            "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12
        }
        month_num = months.get(month_name[:3].lower(), 1)
        cur_year = datetime.now(timezone.utc).year
        dt_utc = datetime(
            cur_year, month_num, int(day), int(hour), int(minute),
            tzinfo=timezone.utc
        )
        dt_formatted = format_ist_gmt_datetime(dt_utc, is_outside)
        return f"{prefix} {dt_formatted}"

    return status


# =========================================================
# CRICINFO UNIVERSAL TEAM LOGOS & SHORT NAMES
# =========================================================
CRICINFO_LOGOS_LOCK = threading.Lock()
DYNAMIC_CRICINFO_LOGOS: dict[str, dict[str, Any]] = {}
CRICINFO_CORE_LOGOS: dict[str, dict[str, Any]] = {}


def clean_team_name(name: str) -> str:
    if not name:
        return ""
    cleaned = re.sub(r'\s*\([^)]*\)', '', str(name)).strip()
    return cleaned or str(name).strip()


def normalize_team_key(name: str) -> str:
    cleaned = clean_team_name(name).lower()
    cleaned = re.sub(r'\band\b', '', cleaned)
    return re.sub(r'[^a-z0-9]', '', cleaned)


_KNOWN_TEAM_ALIASES: dict[str, str] = {
    "centralstags": "centraldistricts",
    "aucklandaces": "auckland",
    "canterburykings": "canterbury",
    "northernbrave": "northerndistricts",
    "northernknights": "northerndistricts",
    "otagovolts": "otago",
    "wellingtonfirebirds": "wellington",
    "jammukashmir": "jammukashmir",
    "jammuandkashmir": "jammukashmir",
    "jk": "jammukashmir",
    "jandk": "jammukashmir",
    "hyderabadindia": "hyderabad",
    "hyderabad": "hyderabad",
}


_INTL_TEAM_IDS: dict[str, tuple[int, str]] = {
    "india": (6, "IND"),
    "ind": (6, "IND"),
    "australia": (2, "AUS"),
    "aus": (2, "AUS"),
    "england": (1, "ENG"),
    "eng": (1, "ENG"),
    "south africa": (3, "SA"),
    "rsa": (3, "SA"),
    "sa": (3, "SA"),
    "pakistan": (7, "PAK"),
    "pak": (7, "PAK"),
    "new zealand": (5, "NZ"),
    "nz": (5, "NZ"),
    "sri lanka": (8, "SL"),
    "sl": (8, "SL"),
    "west indies": (4, "WI"),
    "wi": (4, "WI"),
    "bangladesh": (25, "BAN"),
    "ban": (25, "BAN"),
    "afghanistan": (40, "AFG"),
    "afg": (40, "AFG"),
    "zimbabwe": (9, "ZIM"),
    "zim": (9, "ZIM"),
    "ireland": (29, "IRE"),
    "ire": (29, "IRE"),
    "netherlands": (15, "NED"),
    "ned": (15, "NED"),
    "scotland": (30, "SCO"),
    "sco": (30, "SCO"),
    "nepal": (33, "NEP"),
    "nep": (33, "NEP"),
    "united states": (11, "USA"),
    "usa": (11, "USA"),
    "united arab emirates": (27, "UAE"),
    "uae": (27, "UAE"),
    "oman": (37, "OMA"),
    "oma": (37, "OMA"),
    "namibia": (28, "NAM"),
    "nam": (28, "NAM"),
    "canada": (12, "CAN"),
    "can": (12, "CAN"),
    "papua new guinea": (20, "PNG"),
    "png": (20, "PNG"),
    "hong kong": (19, "HK"),
    "hk": (19, "HK"),
    "kenya": (26, "KEN"),
    "ken": (26, "KEN"),
    "uganda": (24, "UGA"),
    "uga": (24, "UGA"),
    "kuwait": (38, "KUW"),
    "kuw": (38, "KUW"),
    "qatar": (136, "QAT"),
    "qat": (136, "QAT"),
    "jersey": (218211, "JER"),
    "denmark": (13, "DEN"),
    "italy": (31, "ITA"),
    "malaysia": (36, "MAS"),
    "singapore": (22, "SIN"),
}


def _init_cricinfo_logos():
    with CRICINFO_LOGOS_LOCK:
        for name_key, (tid, sname) in _INTL_TEAM_IDS.items():
            CRICINFO_CORE_LOGOS[name_key] = {
                "logo": f"https://a.espncdn.com/i/teamlogos/cricket/500/{tid}.png",
                "sname": sname,
                "name": name_key.title()
            }
        cache_path = PROJECT_DIR / "cricinfo_teams_cache.json"
        if cache_path.exists():
            try:
                with open(cache_path, encoding="utf-8") as f:
                    data = json.load(f)
                    for raw_name, info in data.items():
                        c_name = clean_team_name(raw_name)
                        k = normalize_team_key(raw_name)
                        if k and info.get("logo"):
                            if k not in CRICINFO_CORE_LOGOS:
                                CRICINFO_CORE_LOGOS[k] = {
                                    "logo": info["logo"],
                                    "sname": info.get("sname") or "",
                                    "name": c_name
                                }
                            # Register base key without women/division/region
                            base = re.sub(r'\b(women|womens|division|region|whites|blues)\b', '', c_name, flags=re.I).strip()
                            k_base = normalize_team_key(base)
                            if k_base and k_base not in CRICINFO_CORE_LOGOS:
                                CRICINFO_CORE_LOGOS[k_base] = {
                                    "logo": info["logo"],
                                    "sname": info.get("sname") or "",
                                    "name": c_name
                                }
                            if c_name.lower() not in CRICINFO_CORE_LOGOS:
                                CRICINFO_CORE_LOGOS[c_name.lower()] = {
                                    "logo": info["logo"],
                                    "sname": info.get("sname") or "",
                                    "name": c_name
                                }
                            if info.get("sname") and info["sname"].lower() not in CRICINFO_CORE_LOGOS:
                                CRICINFO_CORE_LOGOS[info["sname"].lower()] = {
                                    "logo": info["logo"],
                                    "sname": info["sname"],
                                    "name": c_name
                                }
            except Exception as e:
                logger.warning("Error preloading cricinfo_teams_cache.json: %s", e)


_init_cricinfo_logos()


def get_team_cricinfo_info(team_name: str, team_sname: str = "") -> dict[str, Any] | None:
    if not team_name:
        return None
    k1 = normalize_team_key(team_name)
    k2 = normalize_team_key(team_sname) if team_sname else ""

    with CRICINFO_LOGOS_LOCK:
        # 1. Exact match in dynamic or core
        for k in (k1, k2):
            if not k:
                continue
            if k in DYNAMIC_CRICINFO_LOGOS:
                return DYNAMIC_CRICINFO_LOGOS[k]
            if k in CRICINFO_CORE_LOGOS:
                return CRICINFO_CORE_LOGOS[k]

        # 2. Known alias match
        for k in (k1, k2):
            if k in _KNOWN_TEAM_ALIASES:
                target_k = _KNOWN_TEAM_ALIASES[k]
                if target_k in DYNAMIC_CRICINFO_LOGOS:
                    return DYNAMIC_CRICINFO_LOGOS[target_k]
                if target_k in CRICINFO_CORE_LOGOS:
                    return CRICINFO_CORE_LOGOS[target_k]

        # 3. Base name match (strip women, division, region, etc.)
        base_name = re.sub(r'\b(women|womens|division|region|whites|blues)\b', '', team_name, flags=re.I).strip()
        k_base = normalize_team_key(base_name)
        if k_base and k_base != k1:
            if k_base in DYNAMIC_CRICINFO_LOGOS:
                return DYNAMIC_CRICINFO_LOGOS[k_base]
            if k_base in CRICINFO_CORE_LOGOS:
                return CRICINFO_CORE_LOGOS[k_base]

        # 4. Suffix append attempt (e.g. try adding 'women', 'division', 'region')
        for sfx in ("women", "division", "region"):
            k_sfx = k_base + sfx
            if k_sfx in DYNAMIC_CRICINFO_LOGOS:
                return DYNAMIC_CRICINFO_LOGOS[k_sfx]
            if k_sfx in CRICINFO_CORE_LOGOS:
                return CRICINFO_CORE_LOGOS[k_sfx]

        # 5. Partial token match
        if len(k1) >= 4:
            for ck, cinfo in DYNAMIC_CRICINFO_LOGOS.items():
                if len(ck) >= 4 and (k1 in ck or ck in k1):
                    return cinfo
            for ck, cinfo in CRICINFO_CORE_LOGOS.items():
                if len(ck) >= 4 and (k1 in ck or ck in k1):
                    return cinfo

    return None


def attach_cricinfo_logo(team_dict: dict[str, Any] | None) -> None:
    if not isinstance(team_dict, dict):
        return

    img_id = team_dict.get("imageId")
    if img_id and not str(img_id).startswith("http"):
        team_dict["cricbuzzLogo"] = f"https://static.cricbuzz.com/a/img/v1/i1/c{img_id}/i.jpg"

    raw_name = team_dict.get("teamName") or ""
    raw_sname = team_dict.get("teamSName") or ""
    cleaned_name = clean_team_name(raw_name)

    ci_info = get_team_cricinfo_info(raw_name, raw_sname)
    if ci_info and ci_info.get("logo"):
        team_dict["logo"] = ci_info["logo"]
        team_dict["cricinfoLogo"] = ci_info["logo"]
        if not raw_sname or raw_sname == raw_name:
            if ci_info.get("sname"):
                team_dict["teamSName"] = ci_info["sname"]
    elif team_dict.get("cricbuzzLogo"):
        team_dict["logo"] = team_dict["cricbuzzLogo"]

    team_dict["teamName"] = cleaned_name or raw_name


def extract_matches(html):

    payloads = decode_next(html)

    decoder = json.JSONDecoder()

    matches = {}

    for payload in payloads:

        marker = '{"matchInfo":'
        position = 0

        while True:

            start = payload.find(marker, position)

            if start < 0:
                break

            try:

                obj, length = decoder.raw_decode(
                    payload[start:]
                )

                info = obj.get("matchInfo", {})

                mid = info.get("matchId")

                if mid:

                    raw_status = info.get("status", "")
                    clean_status = normalize_status_string(
                        raw_status,
                        info.get("startDate"),
                        info.get("venueInfo"),
                        f"{info.get('seriesName', '')} {info.get('matchDesc', '')}"
                    )

                    t1_dict = dict(info.get("team1", {}))
                    t2_dict = dict(info.get("team2", {}))
                    attach_cricinfo_logo(t1_dict)
                    attach_cricinfo_logo(t2_dict)

                    item = {
                        "id": mid,
                        "series": info.get("seriesName", ""),
                        "seriesId": info.get("seriesId"),
                        "description": info.get("matchDesc", ""),
                        "format": info.get("matchFormat", ""),
                        "state": info.get("state", ""),
                        "status": clean_status,
                        "startDate": info.get("startDate"),
                        "team1": t1_dict,
                        "team2": t2_dict,
                        "venue": info.get("venueInfo", {}),
                        "score": obj.get("matchScore", {}),
                        "battingTeam": info.get("currBatTeamId")
                    }

                    previous = matches.get(mid)

                    if (
                        previous is None
                        or (
                            item["score"]
                            and not previous["score"]
                        )
                    ):
                        matches[mid] = item

                position = start + length

            except json.JSONDecodeError:
                position = start + len(marker)

    return list(matches.values())


def classify_match(match):
    state = " ".join(str(match.get("state") or "").lower().split())
    status = str(match.get("status") or "").lower()

    # 1. Finished / Result
    if state in {
        "complete",
        "completed",
        "abandon",
        "abandoned",
        "cancelled",
        "canceled",
        "no result",
        "drawn",
        "forfeit",
        "result"
    } or any(w in status for w in (
        "won by", "match tied", "tied", "match drawn", "drawn",
        "no result", "match abandoned", "abandon", "match cancelled"
    )):
        return "recent"

    # 2. Check startDate:
    # If match is within 1 hour before start time (diff_sec <= 3600) OR
    # scheduled start time has passed (diff_sec <= 0):
    # IT MUST BE IN LIVE until it is completed!
    start_date = match.get("startDate")
    if start_date:
        try:
            val = float(start_date)
            start_sec = val / 1000.0 if val > 1e11 else val
            now_sec = time.time()
            diff_sec = start_sec - now_sec
            if diff_sec <= 3600:
                return "live"
        except (ValueError, TypeError):
            pass

    # 3. Live state indicators
    live_indicators = {
        "in progress", "live", "toss", "stumps", "lunch", "tea", "innings break",
        "break", "drinks", "rain delay", "delayed", "bad light", "badlight",
        "wet outfield", "session", "day 1", "day 2", "day 3", "day 4", "day 5"
    }
    if state in live_indicators or any(w in status for w in (
        "opt to", "trail by", "lead by", "need ", "require ", "target", "chasing"
    )):
        return "live"

    # 4. Preview / Upcoming
    if state in {"preview", "upcoming", "scheduled"}:
        return "upcoming"

    # 5. If start_date exists and is > 3600 seconds in the future
    if start_date:
        try:
            val = float(start_date)
            start_sec = val / 1000.0 if val > 1e11 else val
            now_sec = time.time()
            if start_sec - now_sec > 3600:
                return "upcoming"
        except (ValueError, TypeError):
            pass

    return "upcoming"


def extract_page(html, path):

    soup = BeautifulSoup(html, "html.parser")
    main = soup.find("main") or soup.body or soup

    for heading in soup.find_all(["h1", "h2", "h3", "h4"]):
        if (
            not heading.parent
            or not re.search(
                r"\bvideos?\b",
                heading.get_text(" ", strip=True),
                re.I
            )
        ):
            continue

        container = None
        ancestor = heading.parent

        while ancestor and ancestor is not main:
            links_in_container = ancestor.find_all("a", href=True)

            if links_in_container:
                if all(
                    "video" in str(link.get("href") or "").lower()
                    or "video" in link.get_text(" ", strip=True).lower()
                    for link in links_in_container
                ):
                    container = ancestor
                else:
                    break

            ancestor = ancestor.parent

        (container or heading).decompose()

    for tag in soup([
        "script", "style", "noscript",
        "iframe", "svg"
    ]):
        tag.decompose()

    heading = main.find("h1")
    title = (
        heading.get_text(" ", strip=True)
        if heading
        else soup.title.get_text(" ", strip=True)
        if soup.title
        else "Cricket Information"
    )

    headings = []

    for tag in main.find_all(
        ["h1", "h2", "h3", "h4"]
    ):
        text = tag.get_text(" ", strip=True)

        if text and text not in headings:
            headings.append(text)

    tables = []

    for table in main.find_all("table")[:25]:

        rows = []

        for tr in table.find_all("tr")[:150]:

            cells = [
                cell.get_text(" ", strip=True)
                for cell in tr.find_all(["th", "td"])
            ]

            if cells:
                rows.append(cells)

        if rows:
            tables.append(rows)

    paragraphs = []

    for tag in main.find_all(["p", "li"]):

        text = tag.get_text(" ", strip=True)

        if 20 <= len(text) <= 2000:
            if text not in paragraphs:
                paragraphs.append(text)

    links = []
    seen = set()

    # Prefer links related to the current page section.
    prefixes = {
        "news": ["/cricket-news/"],
        "series": ["/cricket-series/"],
        "teams": ["/cricket-team/"],
        "rankings": ["/cricket-stats/"],
        "schedule": ["/cricket-schedule/", "/cricket-series/"],
        "archives": ["/cricket-scorecard-archives", "/cricket-series/"],
    }

    category = next(
        (
            name for name, prefix in PAGES.items()
            if prefix == path
        ),
        None
    )

    category: Optional[str] = None
    if path.startswith("/cricket-team/"):
        category = "teams"
    elif path.startswith("/cricket-scorecard-archives/"):
        category = "archives"
    elif path.startswith("/cricket-series/"):
        category = "series"

    allowed_prefixes = prefixes.get(category) if category else None

    for a in main.find_all("a", href=True):

        text = a.get_text(" ", strip=True)
        href = str(a.get("href") or "")

        if not text or len(text) < 3:
            continue

        if not href.startswith("/") or href.startswith("//"):
            continue

        if any(
            marker in href.lower() or marker in text.lower()
            for marker in ("video", "gallery", "photo")
        ):
            continue

        if allowed_prefixes and not any(
            href.startswith(prefix)
            for prefix in allowed_prefixes
        ):
            continue

        if href in seen or href == path:
            continue

        seen.add(href)

        links.append({
            "title": text[:200],
            "path": href
        })

    return {
        "title": title,
        "headings": headings[:70],
        "tables": tables,
        "paragraphs": paragraphs[:120],
        "links": links,
    }



# =========================================================
# ALLROUNDERLIVE 24/7 AUTO STREAM SYNC
# =========================================================
AUTO_MATCH_SERVERS: dict[str, list[dict[str, Any]]] = {}
EXTRA_LIVE_MATCHES: dict[str, dict[str, Any]] = {}
AUTO_SERVERS_LOCK = threading.Lock()
LAST_AUTO_SYNC_TIME: float = 0.0


TEAM_ALIASES: dict[str, list[str]] = {
    "south africa": ["south africa", "rsa", "sa", "proteas"],
    "rsa": ["south africa", "rsa", "sa", "proteas"],
    "sa": ["south africa", "rsa", "sa", "proteas"],

    "australia": ["australia", "aus", "aussies"],
    "aus": ["australia", "aus", "aussies"],

    "united arab emirates": ["united arab emirates", "uae", "u a e"],
    "uae": ["united arab emirates", "uae", "u a e"],

    "papua new guinea": ["papua new guinea", "png"],
    "png": ["papua new guinea", "png"],

    "west indies": ["west indies", "wi", "windies"],
    "wi": ["west indies", "wi", "windies"],

    "new zealand": ["new zealand", "nz", "blackcaps", "black caps"],
    "nz": ["new zealand", "nz", "blackcaps", "black caps"],

    "india": ["india", "ind"],
    "ind": ["india", "ind"],

    "pakistan": ["pakistan", "pak"],
    "pak": ["pakistan", "pak"],

    "sri lanka": ["sri lanka", "sl"],
    "sl": ["sri lanka", "sl"],

    "bangladesh": ["bangladesh", "ban", "bd", "tigers"],
    "ban": ["bangladesh", "ban", "bd", "tigers"],

    "afghanistan": ["afghanistan", "afg"],
    "afg": ["afghanistan", "afg"],

    "england": ["england", "eng"],
    "eng": ["england", "eng"],

    "netherlands": ["netherlands", "ned", "dutch", "holland"],
    "ned": ["netherlands", "ned", "dutch", "holland"],

    "ireland": ["ireland", "ire"],
    "ire": ["ireland", "ire"],

    "zimbabwe": ["zimbabwe", "zim"],
    "zim": ["zimbabwe", "zim"],

    "scotland": ["scotland", "sco"],
    "sco": ["scotland", "sco"],

    "namibia": ["namibia", "nam"],
    "nam": ["namibia", "nam"],

    "nepal": ["nepal", "nep"],
    "nep": ["nepal", "nep"],

    "united states": ["united states", "usa", "us"],
    "usa": ["united states", "usa", "us"],

    "hong kong": ["hong kong", "hk", "hkg"],
    "hk": ["hong kong", "hk", "hkg"],

    "oman": ["oman", "oma", "omn"],
    "canada": ["canada", "can"],
    "uganda": ["uganda", "uga"],
    "kenya": ["kenya", "ken"],
    "jersey": ["jersey", "jer"],
    "kuwait": ["kuwait", "kuw"],
    "qatar": ["qatar", "qat"],
    "denmark": ["denmark", "den"],
    "singapore": ["singapore", "sin"],
    "malaysia": ["malaysia", "mas"],
    "italy": ["italy", "ita"],
    "germany": ["germany", "ger"],

    # WBBL / BBL teams
    "melbourne renegades": ["melbourne renegades", "renegades", "mlrw", "mlr"],
    "perth scorchers": ["perth scorchers", "scorchers", "prsw", "prs"],
    "sydney thunder": ["sydney thunder", "thunder", "sytw", "syt"],
    "sydney sixers": ["sydney sixers", "sixers", "sysw", "sys"],
    "brisbane heat": ["brisbane heat", "heat", "bhw", "bwhw", "bwh"],
    "hobart hurricanes": ["hobart hurricanes", "hurricanes", "hbhw", "hbh"],
    "adelaide strikers": ["adelaide strikers", "strikers", "asw", "as"],
    "melbourne stars": ["melbourne stars", "stars", "msw", "mlsw"]
}


def _clean_stream_str(text: str) -> str:
    if not text:
        return ""
    t = re.sub(r"\(.*?\)", " ", str(text).lower())
    t = re.sub(r"[^a-zA-Z0-9\s]", " ", t)
    return " ".join(t.split())


def _is_a_team(name: str) -> bool:
    if not name:
        return False
    # Isolated single letter 'a' following a word, e.g. "india a", "nz a", "australia a"
    return bool(re.search(r'\b[a-z0-9-]+\s+a\b', str(name).lower()))


def _is_women_match(name_or_obj: Any) -> bool:
    if isinstance(name_or_obj, dict):
        text = " ".join([
            str(name_or_obj.get("team1", {}).get("teamName", "")),
            str(name_or_obj.get("team2", {}).get("teamName", "")),
            str(name_or_obj.get("series", "")),
            str(name_or_obj.get("description", ""))
        ]).lower()
        t1_s = str(name_or_obj.get("team1", {}).get("teamSName", "")).strip()
        t2_s = str(name_or_obj.get("team2", {}).get("teamSName", "")).strip()
        if t1_s.endswith("W") or t2_s.endswith("W"):
            return True
    else:
        text = str(name_or_obj).lower()

    if bool(re.search(r'\b(women|womens|wbbl)\b', text)):
        return True
    if "-w" in text:
        return True
    return False


def _team_matches_stream(team_dict: dict[str, Any], clean_stream: str) -> bool:
    raw_name = str(team_dict.get("teamName", "")).lower().strip()
    raw_short = str(team_dict.get("teamSName", "")).lower().strip()
    clean_name = _clean_stream_str(raw_name)
    clean_short = _clean_stream_str(raw_short)
    stream_nospace = re.sub(r"\s+", "", clean_stream)

    terms = set()
    if clean_name:
        terms.add(clean_name)
        terms.add(re.sub(r"\s+", "", clean_name))
        words = [w for w in clean_name.split() if w not in {"women", "team", "cricket", "club", "npl", "mens", "the", "xi", "division"}]
        for w in words:
            if len(w) >= 3:
                terms.add(w)

    if clean_short and len(clean_short) >= 2:
        terms.add(clean_short)
        if clean_short.endswith("w") and len(clean_short) > 2:
            terms.add(clean_short[:-1])

    for key in (clean_name, clean_short, raw_name, raw_short):
        if key in TEAM_ALIASES:
            for alias in TEAM_ALIASES[key]:
                c_alias = _clean_stream_str(alias)
                terms.add(c_alias)
                terms.add(re.sub(r"\s+", "", c_alias))

    for term in terms:
        if not term:
            continue
        if len(term) >= 3:
            term_nospace = re.sub(r"\s+", "", term)
            if term_nospace in stream_nospace:
                return True
        if " " in term:
            pattern = r'\b' + r'\s+'.join(re.escape(w) for w in term.split()) + r'\b'
            if re.search(pattern, clean_stream):
                return True
        else:
            if re.search(r'\b' + re.escape(term) + r'\b', clean_stream):
                return True
    return False


def _match_stream_to_cb(stream_title: str, cb_match: dict[str, Any]) -> bool:
    clean_stream = _clean_stream_str(stream_title)

    cb_women = _is_women_match(cb_match)
    st_women = _is_women_match(clean_stream)
    if cb_women != st_women:
        return False

    t1_name = str(cb_match.get("team1", {}).get("teamName", ""))
    t2_name = str(cb_match.get("team2", {}).get("teamName", ""))
    cb_a = _is_a_team(t1_name) or _is_a_team(t2_name)
    st_a = _is_a_team(clean_stream)
    if cb_a != st_a:
        return False

    t1 = cb_match.get("team1", {})
    t2 = cb_match.get("team2", {})

    return _team_matches_stream(t1, clean_stream) and _team_matches_stream(t2, clean_stream)


GENERIC_MASCOTS = {
    "team", "cricket", "club", "npl", "mens", "women", "womens", "the", "xi",
    "kings", "royals", "lions", "titans", "warriors", "super", "knights",
    "riders", "falcons", "patriots", "giants", "stars", "heat", "sixers",
    "thunder", "strikers", "hurricanes", "renegades", "scorchers", "eagles",
    "rhinos", "tuskers", "rocks", "division", "region", "patrons", "blues", "whites"
}


def _clean_team_tokens(name: str) -> set[str]:
    cleaned = re.sub(r'[^a-zA-Z0-9\s]', ' ', str(name or "")).lower()
    return {w for w in cleaned.split() if len(w) > 2 and w not in GENERIC_MASCOTS}


def _team_token_match(name1: str, name2: str) -> bool:
    k1 = normalize_team_key(name1)
    k2 = normalize_team_key(name2)
    if k1 and k2:
        if k1 == k2:
            return True
        if k1 in _KNOWN_TEAM_ALIASES and _KNOWN_TEAM_ALIASES[k1] == k2:
            return True
        if k2 in _KNOWN_TEAM_ALIASES and _KNOWN_TEAM_ALIASES[k2] == k1:
            return True
    t1 = _clean_team_tokens(name1)
    t2 = _clean_team_tokens(name2)
    if not t1 or not t2:
        return False
    return bool(t1.intersection(t2))


def _parse_cricinfo_score(score_str: str) -> dict[str, Any]:
    if not score_str:
        return {}
    s = str(score_str).strip()
    if not s or s in ("0", "0/0", "0/0 (0)"):
        return {}
    m = re.search(r'(\d+)(?:/(\d+))?(?:\s*\(([0-9.]+)\s*(?:ov)?\))?', s)
    if m:
        runs = int(m.group(1))
        wkts = int(m.group(2)) if m.group(2) is not None else (10 if "/" not in s and runs > 0 else None)
        overs = float(m.group(3)) if m.group(3) is not None else None
        res: dict[str, Any] = {"runs": runs}
        if wkts is not None:
            res["wickets"] = wkts
        if overs is not None:
            res["overs"] = overs
        return {"inngs1": res, "summary": s}
    return {"summary": s}


_CRICINFO_CACHE: dict[str, Any] = {"time": 0.0, "matches": []}
_CRICINFO_CACHE_TTL = 30.0  # 30 seconds refresh interval


def fetch_cricinfo_matches() -> list[dict[str, Any]]:
    global _CRICINFO_CACHE
    now = time.time()
    if now - float(_CRICINFO_CACHE["time"]) < _CRICINFO_CACHE_TTL and _CRICINFO_CACHE["matches"]:
        return _CRICINFO_CACHE["matches"]

    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    ci_matches = []
    seen_ci_ids = set()

    IST = timezone(timedelta(hours=5, minutes=30))
    now_ist = datetime.now(IST)
    today_start_ist = datetime(now_ist.year, now_ist.month, now_ist.day, 0, 0, 0, tzinfo=IST)
    end_tomorrow_ist = today_start_ist + timedelta(days=2) - timedelta(microseconds=1)
    end_tomorrow_ms = int(end_tomorrow_ist.timestamp() * 1000)

    urls = [
        "https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket",
        f"https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket&dates={(now_ist - timedelta(days=2)).strftime('%Y%m%d')}",
        f"https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket&dates={(now_ist - timedelta(days=1)).strftime('%Y%m%d')}",
        f"https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket&dates={now_ist.strftime('%Y%m%d')}",
        f"https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket&dates={(now_ist + timedelta(days=1)).strftime('%Y%m%d')}",
        f"https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket&dates={(now_ist + timedelta(days=2)).strftime('%Y%m%d')}",
    ]

    def _fetch_scoreboard(u: str):
        try:
            r = session.get(u, timeout=5, headers=headers)
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            logger.warning("Error fetching Cricinfo scoreboard (%s): %s", u, e)
        return None

    with ThreadPoolExecutor(max_workers=6) as pool:
        json_results = list(pool.map(_fetch_scoreboard, urls))

    for data in json_results:
        if not data:
            continue

        for sport in data.get("sports", []):
            for league in sport.get("leagues", []):
                league_name = league.get("name", "Cricket")
                league_id = str(league.get("id", ""))
                for ev in league.get("events", []):
                    try:
                        cid = str(ev.get("id"))
                        if cid in seen_ci_ids:
                            continue
                        seen_ci_ids.add(cid)

                        comps = ev.get("competitors", [])
                        if len(comps) < 2:
                            continue
                        c1, c2 = comps[0], comps[1]

                        status_obj = ev.get("fullStatus", {})
                        state_val = str(status_obj.get("type", {}).get("state", "")).lower()
                        summary_val = str(ev.get("summary", "")).lower()
                        detail_val = str(status_obj.get("type", {}).get("detail", "")).lower()

                        # Parse start date & timestamp
                        start_date_ms = None
                        ev_date = ev.get("date")
                        if ev_date:
                            try:
                                dt_parsed = datetime.fromisoformat(str(ev_date).replace("Z", "+00:00"))
                                start_date_ms = int(dt_parsed.timestamp() * 1000)
                            except Exception:
                                pass

                        now_sec = time.time()
                        start_sec = (start_date_ms / 1000.0) if start_date_ms else None
                        diff_sec = (start_sec - now_sec) if start_sec else 999999

                        if state_val == "post" or any(w in summary_val for w in ("result", "won", "drawn", "tied", "abandoned")):
                            state_str = "Complete"
                            cat = "recent"
                        elif state_val == "in" or "live" in detail_val or any(w in summary_val for w in ("stumps", "tea", "lunch", "in progress", "lead", "trail", "need")) or (diff_sec <= 3600 and diff_sec > -86400 * 5):
                            state_str = "Live"
                            cat = "live"
                        else:
                            # Strict 2-day Upcoming window in IST (Today + Tomorrow only)
                            # Rolls over automatically at midnight (12:00 AM IST)
                            if start_date_ms and start_date_ms <= end_tomorrow_ms:
                                state_str = "Upcoming"
                                cat = "upcoming"
                            else:
                                continue

                        location = ev.get("location") or ""
                        venue_dict = {"ground": location, "city": ""}
                        if "," in location:
                            parts = [p.strip() for p in location.split(",")]
                            venue_dict = {"ground": parts[0], "city": ", ".join(parts[1:])}

                        is_outside = is_venue_outside_india(venue_dict, f"{league_name} {ev.get('name', '')}")

                        if cat == "upcoming" and start_date_ms:
                            long_status = f"Match starts at {format_ist_gmt_datetime(start_date_ms, is_outside)}"
                        else:
                            long_status = status_obj.get("longSummary") or ev.get("summary") or state_str

                        c1_name = c1.get("displayName") or c1.get("name") or "Team 1"
                        c2_name = c2.get("displayName") or c2.get("name") or "Team 2"

                        # Dynamically record latest competitor logos from Cricinfo
                        with CRICINFO_LOGOS_LOCK:
                            for c_comp, c_raw in ((c1, c1_name), (c2, c2_name)):
                                if c_comp.get("logo"):
                                    c_logo_u = c_comp["logo"]
                                    c_abbr_u = c_comp.get("abbreviation") or ""
                                    c_clean_u = clean_team_name(c_raw)
                                    k_norm = normalize_team_key(c_raw)
                                    entry = {
                                        "logo": c_logo_u,
                                        "sname": c_abbr_u,
                                        "name": c_clean_u
                                    }
                                    DYNAMIC_CRICINFO_LOGOS[k_norm] = entry
                                    base_u = re.sub(r'\b(women|womens|division|region|whites|blues)\b', '', c_clean_u, flags=re.I).strip()
                                    k_base = normalize_team_key(base_u)
                                    if k_base and k_base not in DYNAMIC_CRICINFO_LOGOS:
                                        DYNAMIC_CRICINFO_LOGOS[k_base] = entry

                        c1_score_str = str(c1.get("score") or "").strip()
                        c2_score_str = str(c2.get("score") or "").strip()

                        t1_obj = {
                            "teamName": clean_team_name(c1_name),
                            "teamSName": c1.get("abbreviation") or c1_name[:4].upper(),
                            "logo": c1.get("logo") or "",
                            "cricinfoLogo": c1.get("logo") or "",
                            "imageId": c1.get("logo") or None
                        }
                        t2_obj = {
                            "teamName": clean_team_name(c2_name),
                            "teamSName": c2.get("abbreviation") or c2_name[:4].upper(),
                            "logo": c2.get("logo") or "",
                            "cricinfoLogo": c2.get("logo") or "",
                            "imageId": c2.get("logo") or None
                        }
                        attach_cricinfo_logo(t1_obj)
                        attach_cricinfo_logo(t2_obj)

                        match_obj = {
                            "id": f"ci_{cid}",
                            "series": league_name,
                            "seriesId": league_id,
                            "description": ev.get("description") or ev.get("name") or "Cricket Match",
                            "state": state_str,
                            "status": long_status,
                            "startDate": start_date_ms,
                            "venue": venue_dict,
                            "team1": t1_obj,
                            "team2": t2_obj,
                            "score": {
                                "team1Score": _parse_cricinfo_score(c1_score_str),
                                "team2Score": _parse_cricinfo_score(c2_score_str)
                            },
                            "_category": cat,
                            "source": "cricinfo"
                        }
                        ci_matches.append(match_obj)
                    except Exception as ev_err:
                        logger.warning("Error parsing Cricinfo event: %s", ev_err)

    if ci_matches:
        _CRICINFO_CACHE["time"] = now
        _CRICINFO_CACHE["matches"] = ci_matches

    return _CRICINFO_CACHE.get("matches", [])


_WILLOW_COOLDOWN_UNTIL = 0.0
_CRICINFO_SUMMARY_CACHE: dict[str, Any] = {}


def get_cricinfo_tab_data(match_id: str, tab: str) -> dict[str, Any]:
    cid = str(match_id).replace("ci_", "").strip()
    ci_match = next((m for m in fetch_cricinfo_matches() if str(m.get("id")) in (match_id, f"ci_{cid}")), None)
    series_id = ci_match.get("seriesId") if ci_match else ""
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    data: dict[str, Any] = {}
    try:
        espn_summary = _CRICINFO_SUMMARY_CACHE.get(cid)
        if not espn_summary:
            summary_url = (
                f"https://site.web.api.espn.com/apis/site/v2/sports/cricket/{series_id}/summary?event={cid}"
                if (series_id and series_id != "0")
                else f"https://site.web.api.espn.com/apis/site/v2/sports/cricket/summary?event={cid}"
            )
            req = urllib.request.Request(summary_url, headers=headers)
            with urllib.request.urlopen(req, timeout=3) as res:
                espn_summary = json.loads(res.read().decode("utf-8"))
                _CRICINFO_SUMMARY_CACHE[cid] = espn_summary

        if tab == "scorecard":
            matchcards = espn_summary.get("matchcards", [])
            innings = []
            for mc in matchcards:
                batting_rows = []
                for p in mc.get("playerDetails", []):
                    runs_val = str(p.get("runs", "0"))
                    balls_val = str(p.get("ballsFaced", "0"))
                    try:
                        r_f = float(runs_val)
                        b_f = float(balls_val)
                        sr = str(round(r_f / max(b_f, 1.0) * 100.0, 2))
                    except Exception:
                        sr = "0.0"
                    batting_rows.append({
                        "name": p.get("playerName", ""),
                        "dismissal": p.get("dismissal", ""),
                        "runs": runs_val,
                        "balls": balls_val,
                        "fours": str(p.get("fours", "0")),
                        "sixes": str(p.get("sixes", "0")),
                        "strikeRate": sr
                    })
                innings.append({
                    "title": f"{mc.get('teamName', 'Team')} ({mc.get('runs', '')} - {mc.get('total', '')})",
                    "batting": batting_rows,
                    "bowling": []
                })
            data = {"innings": innings}
        elif tab == "info":
            game_info = espn_summary.get("gameInfo", {})
            venue_info = game_info.get("venue", {})
            details = [
                {"label": "Series", "value": ci_match.get("series", "") if ci_match else ""},
                {"label": "Match", "value": ci_match.get("description", "") if ci_match else ""},
                {"label": "Venue", "value": venue_info.get("fullName", venue_info.get("shortName", ""))},
                {"label": "City", "value": venue_info.get("address", {}).get("city", "")},
                {"label": "Status", "value": ci_match.get("status", "") if ci_match else ""}
            ]
            officials = game_info.get("officials", [])
            for off in officials:
                details.append({
                    "label": off.get("position", {}).get("displayName", "Official").title(),
                    "value": off.get("displayName", "")
                })
            teams_list = []
            if ci_match:
                if ci_match.get("team1"):
                    teams_list.append(ci_match["team1"])
                if ci_match.get("team2"):
                    teams_list.append(ci_match["team2"])
            data = {"details": details, "teams": teams_list}
        elif tab == "squad":
            rosters = espn_summary.get("rosters", [])
            squads = []
            for ros in rosters:
                t_name = ros.get("team", {}).get("displayName", "Team")
                players = [{"name": p.get("displayName", "")} for p in ros.get("roster", [])]
                squads.append({"teamName": t_name, "players": players})
            data = {"squads": squads}
        else:
            data = {"message": f"{tab.title()} data is not available for this match."}
    except Exception as e:
        logger.warning("Error fetching Cricinfo summary: %s", e)
        data = {"innings": []}
    return data


SUPABASE_URL = "https://zcdujcunojbzsvcmzifr.supabase.co"
SUPABASE_KEY = "sb_publishable_qLoe2BZoZXPGoyavUS4rXg_BwonZQt-"


def _sync_to_supabase(matched_servers: dict[str, list[dict[str, Any]]]):
    try:
        url = f"{SUPABASE_URL}/rest/v1/content?select=id,public_id,category,media_url&category=like.__cricket_watch__*"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json"
        }
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=6) as r:
            existing_records = json.loads(r.read().decode("utf-8"))

        existing_urls = {r.get("media_url") for r in existing_records if r.get("media_url")}
        existing_ids_by_mid = {}
        for r in existing_records:
            cat = str(r.get("category") or "")
            if cat.startswith("__cricket_watch__:"):
                mid = cat[len("__cricket_watch__:"):].strip()
                existing_ids_by_mid.setdefault(mid, []).append(r.get("id"))

        # 1. Insert new streams
        for mid, servers in matched_servers.items():
            cat = f"__cricket_watch__:{mid}"
            for s in servers:
                m_url = s.get("media_url")
                if m_url and m_url not in existing_urls:
                    payload = json.dumps({
                        "title": s.get("title", "Server 1"),
                        "public_id": s.get("id", f"auto_{mid}_{int(time.time())}"),
                        "section_slug": "sports",
                        "category": cat,
                        "kind": "channel",
                        "media_type": "link",
                        "media_url": m_url,
                        "sort_order": s.get("sort_order", 0) + 1,
                        "published": True
                    }).encode("utf-8")
                    post_req = urllib.request.Request(
                        f"{SUPABASE_URL}/rest/v1/content",
                        data=payload,
                        headers=headers,
                        method="POST"
                    )
                    try:
                        with urllib.request.urlopen(post_req, timeout=5):
                            pass
                        existing_urls.add(m_url)
                    except Exception:
                        pass

        # 2. Delete ended match servers from Supabase
        recent_mids = set()
        try:
            rec_html = fetch(PAGES["recent"], 10)
            for rm in extract_matches(rec_html):
                recent_mids.add(str(rm.get("id")))
        except Exception:
            pass

        for r_mid in recent_mids:
            if r_mid in existing_ids_by_mid:
                for row_id in existing_ids_by_mid[r_mid]:
                    if row_id:
                        del_req = urllib.request.Request(
                            f"{SUPABASE_URL}/rest/v1/content?id=eq.{row_id}",
                            headers=headers,
                            method="DELETE"
                        )
                        try:
                            with urllib.request.urlopen(del_req, timeout=5):
                                pass
                        except Exception:
                            pass
    except Exception as sup_err:
        logger.warning("Supabase auto-sync error: %s", sup_err)


def sync_allrounder_streams() -> dict[str, list[dict[str, Any]]]:
    global LAST_AUTO_SYNC_TIME, _WILLOW_COOLDOWN_UNTIL
    try:
        cb_matches: list[dict[str, Any]] = []
        try:
            live_html = fetch(PAGES["live"], 10)
            cb_matches.extend(extract_matches(live_html))
        except Exception:
            pass
        try:
            up_html = fetch(PAGES["upcoming"], 10)
            cb_matches.extend(extract_matches(up_html))
        except Exception:
            pass
        for sched_p in (
            "/cricket-schedule/upcoming-series/international",
            "/cricket-schedule/upcoming-series/league"
        ):
            try:
                s_html = fetch(sched_p, 60)
                cb_matches.extend(extract_matches(s_html))
            except Exception:
                pass
        try:
            for ci_m in fetch_cricinfo_matches():
                if ci_m.get("_category") in ("live", "upcoming"):
                    cb_matches.append(ci_m)
        except Exception:
            pass

        unique_cb: dict[str, dict[str, Any]] = {
            str(m["id"]): m for m in cb_matches if m.get("id")
        }
        def _match_priority(m: dict[str, Any]) -> int:
            st = str(m.get("state", "")).strip().lower()
            if st in ("in progress", "live", "innings break", "toss", "drinks", "rain delay", "delayed", "stumps"):
                return 0
            if st in ("preview", "upcoming", "scheduled"):
                return 1
            return 2

        cb_list = sorted(list(unique_cb.values()), key=_match_priority)

        matched_servers: dict[str, list[dict[str, Any]]] = {}
        new_extra_matches: dict[str, dict[str, Any]] = {}
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

        # 1. FanCode streams from allrounderlive
        try:
            req = urllib.request.Request(
                "https://sportlink-fancode10.pages.dev/fan.json",
                headers=headers
            )
            with urllib.request.urlopen(req, timeout=8) as r:
                fc_data = json.loads(r.read().decode("utf-8"))
            for fc in fc_data.get("matches", []):
                fc_status = str(fc.get("status", "")).upper()
                if "LIVE" not in fc_status and fc_status != "":
                    continue

                stream_url = ""
                auto_streams = fc.get("auto_streams", {})
                for lang, lang_data in auto_streams.items():
                    streams = lang_data.get("streams", {})
                    stream_url = (
                        streams.get("1080p") or
                        streams.get("720p") or
                        streams.get("540p") or ""
                    )
                    if stream_url:
                        break
                if not stream_url:
                    stream_url = fc.get("streams", {}).get("primary", "")
                if not stream_url:
                    continue

                title = fc.get("title", "")
                match_id = str(fc.get("match_id", ""))
                params = urllib.parse.urlencode({
                    "url": stream_url,
                    "title": title,
                    "match_id": match_id
                })
                player_url = f"https://allrounderlive.in/fc-play?{params}"

                matched = False
                for cb in cb_list:
                    if _match_stream_to_cb(title, cb):
                        matched = True
                        mid = str(cb["id"])
                        matched_servers.setdefault(mid, [])
                        matched_servers[mid].append({
                            "id": f"auto_fc_{mid}_{len(matched_servers[mid])}",
                            "title": f"Server {len(matched_servers[mid]) + 1}",
                            "serverLabel": f"Server {len(matched_servers[mid]) + 1}",
                            "category": f"__cricket_watch__:{mid}",
                            "media_type": "link",
                            "media_url": player_url,
                            "source": "fancode",
                            "published": True,
                            "sort_order": len(matched_servers[mid])
                        })
                        break

                if not matched and str(fc.get("category", "")).lower() == "cricket":
                    ex_id = f"ex_fc_{match_id}"
                    matched_servers.setdefault(ex_id, [])
                    matched_servers[ex_id].append({
                        "id": f"auto_fc_{ex_id}_0",
                        "title": "Server 1",
                        "serverLabel": "Server 1",
                        "category": f"__cricket_watch__:{ex_id}",
                        "media_type": "link",
                        "media_url": player_url,
                        "source": "fancode",
                        "published": True,
                        "sort_order": 0
                    })
                    teams = [clean_team_name(part.strip()) for part in re.split(r'\s+vs\s+|\s+v\s+', title, flags=re.I)]
                    t1_n = teams[0] if len(teams) > 0 and teams[0] else "Team 1"
                    t2_n = teams[1] if len(teams) > 1 and teams[1] else "Team 2"
                    t1_obj = {"teamName": t1_n, "teamSName": t1_n[:4].upper()}
                    t2_obj = {"teamName": t2_n, "teamSName": t2_n[:4].upper()}
                    attach_cricinfo_logo(t1_obj)
                    attach_cricinfo_logo(t2_obj)
                    new_extra_matches[ex_id] = {
                        "id": ex_id,
                        "series": "Live Streaming",
                        "description": title,
                        "state": "Live",
                        "status": "Live Streaming",
                        "team1": t1_obj,
                        "team2": t2_obj,
                        "venue": {"ground": "Live Stream"},
                        "score": {},
                        "isSynthetic": True,
                        "_category": "live"
                    }
        except Exception as e:
            logger.warning("AutoStreamSync FanCode error: %s", e)

        # 2. Willow streams from allrounderlive
        if time.time() > _WILLOW_COOLDOWN_UNTIL:
            try:
                req = urllib.request.Request(
                    "https://willow-api.sayanwork-studioo.workers.dev/",
                    headers=headers
                )
                with urllib.request.urlopen(req, timeout=6) as r:
                    willow_data = json.loads(r.read().decode("utf-8"))
                for w in willow_data.get("Matches", []):
                    w_status = str(w.get("status", "")).upper()
                    is_live = "LIVE" in w_status or w.get("isLive")
                    has_stream = bool(
                        w.get("stream_url_alpha") or w.get("stream_url_bravo") or
                        w.get("streamUrl") or w.get("hls") or
                        w.get("playbackUrl") or w.get("drm_key") or
                        w.get("channel_id") or w.get("tvgId")
                    )
                    if not is_live and not has_stream:
                        continue

                    safe_id = (
                        w.get("title") or w.get("tvgId") or
                        w.get("tvgName") or w.get("match_id") or ""
                    )
                    if not safe_id:
                        continue
                    title = w.get("title") or safe_id
                    encoded_id = urllib.parse.quote(str(safe_id))
                    player_url = f"https://allrounderlive.in/willow-player?id={encoded_id}"

                    w_matched = False
                    for cb in cb_list:
                        if _match_stream_to_cb(title, cb):
                            w_matched = True
                            mid = str(cb["id"])
                            matched_servers.setdefault(mid, [])
                            if not any(s.get("source") == "willow" for s in matched_servers[mid]):
                                matched_servers[mid].append({
                                    "id": f"auto_w_{mid}_{len(matched_servers[mid])}",
                                    "title": f"Server {len(matched_servers[mid]) + 1}",
                                    "serverLabel": f"Server {len(matched_servers[mid]) + 1}",
                                    "category": f"__cricket_watch__:{mid}",
                                    "media_type": "link",
                                    "media_url": player_url,
                                    "source": "willow",
                                    "published": True,
                                    "sort_order": len(matched_servers[mid])
                                })
                            break

                    if not w_matched:
                        ex_w_id = f"ex_w_{re.sub(r'[^a-zA-Z0-9]', '_', str(safe_id))[:30]}"
                        matched_servers.setdefault(ex_w_id, [])
                        if not any(s.get("source") == "willow" for s in matched_servers[ex_w_id]):
                            matched_servers[ex_w_id].append({
                                "id": f"auto_w_{ex_w_id}_0",
                                "title": "Server 1",
                                "serverLabel": "Server 1",
                                "category": f"__cricket_watch__:{ex_w_id}",
                                "media_type": "link",
                                "media_url": player_url,
                                "source": "willow",
                                "published": True,
                                "sort_order": 0
                            })
                            w_teams = [clean_team_name(part.strip()) for part in re.split(r'\s+vs\s+|\s+v\s+', title, flags=re.I)]
                            wt1_n = w_teams[0] if len(w_teams) > 0 and w_teams[0] else "Team 1"
                            wt2_n = w_teams[1] if len(w_teams) > 1 and w_teams[1] else "Team 2"
                            wt1_obj = {"teamName": wt1_n, "teamSName": wt1_n[:4].upper()}
                            wt2_obj = {"teamName": wt2_n, "teamSName": wt2_n[:4].upper()}
                            attach_cricinfo_logo(wt1_obj)
                            attach_cricinfo_logo(wt2_obj)
                            new_extra_matches[ex_w_id] = {
                                "id": ex_w_id,
                                "series": "Live Streaming",
                                "description": title,
                                "state": "Live",
                                "status": "Live Streaming",
                                "team1": wt1_obj,
                                "team2": wt2_obj,
                                "venue": {"ground": "Live Stream"},
                                "score": {},
                                "isSynthetic": True,
                                "_category": "live"
                            }
            except urllib.error.HTTPError as he:
                if he.code == 429:
                    _WILLOW_COOLDOWN_UNTIL = time.time() + 90
                logger.warning("AutoStreamSync Willow HTTP error: %s", he)
            except Exception as e:
                logger.warning("AutoStreamSync Willow error: %s", e)

        # Delete/prune servers for any matches that have completed
        try:
            rec_html = fetch(PAGES["recent"], 10)
            for rm in extract_matches(rec_html):
                rm_id = str(rm.get("id"))
                if rm_id in matched_servers:
                    del matched_servers[rm_id]
        except Exception:
            pass

        with AUTO_SERVERS_LOCK:
            if matched_servers:
                AUTO_MATCH_SERVERS.clear()
                AUTO_MATCH_SERVERS.update(matched_servers)
            EXTRA_LIVE_MATCHES.clear()
            EXTRA_LIVE_MATCHES.update(new_extra_matches)
            LAST_AUTO_SYNC_TIME = time.time()

        # Save to disk for instant restore on server restart
        try:
            with open(PROJECT_DIR / "auto_servers.json", "w", encoding="utf-8") as f:
                json.dump(matched_servers, f)
        except Exception:
            pass

        # 3. Direct background sync to Supabase database (zero admin manual work)
        _sync_to_supabase(matched_servers)

        return matched_servers
    except Exception as e:
        logger.error("AutoStreamSync top-level error: %s", e)
        return {}


def _auto_sync_background_loop():
    while True:
        try:
            sync_allrounder_streams()
        except Exception as e:
            logger.error("Background stream sync error: %s", e)
        time.sleep(15)


_sync_thread = threading.Thread(
    target=_auto_sync_background_loop,
    daemon=True,
    name="AutoStreamSyncThread"
)
_sync_thread.start()


@app.get("/api/auto-servers")
def get_auto_servers():
    with AUTO_SERVERS_LOCK:
        return {
            "success": True,
            "count": len(AUTO_MATCH_SERVERS),
            "servers": AUTO_MATCH_SERVERS,
            "last_sync": LAST_AUTO_SYNC_TIME
        }


@app.get("/api/auto-servers/refresh")
def force_refresh_auto_servers():
    result = sync_allrounder_streams()
    return {
        "success": True,
        "count": len(result),
        "servers": result,
        "last_sync": LAST_AUTO_SYNC_TIME
    }


@app.get("/api/team-logos")
def get_team_logos():
    merged: dict[str, Any] = {}
    with CRICINFO_LOGOS_LOCK:
        for k, v in CRICINFO_CORE_LOGOS.items():
            merged[k] = v
        for k, v in DYNAMIC_CRICINFO_LOGOS.items():
            merged[k] = v
    return {"success": True, "count": len(merged), "logos": merged}


@app.get("/api/matches/{category}")
def get_matches(category: str):

    if category not in ("live", "recent", "upcoming"):
        raise HTTPException(400, "Invalid category")

    try:

        html = fetch(PAGES[category], MATCH_CACHE_TTL)
        raw_matches = extract_matches(html)

        if category == "upcoming":
            # Cricbuzz full schedule categories: international, league, domestic, women
            sched_paths = [
                "/cricket-schedule/upcoming-series/international",
                "/cricket-schedule/upcoming-series/league",
                "/cricket-schedule/upcoming-series/domestic",
                "/cricket-schedule/upcoming-series/women"
            ]
            seen_ids = {m.get("id") for m in raw_matches}
            for sp in sched_paths:
                try:
                    s_html = fetch(sp, 60)
                    for sm in extract_matches(s_html):
                        sm_id = sm.get("id")
                        if sm_id and sm_id not in seen_ids:
                            seen_ids.add(sm_id)
                            raw_matches.append(sm)
                except Exception:
                    pass
        elif category == "live":
            # Also extract upcoming matches and schedules so matches starting within 1 hour or start time passed appear in live section
            seen_ids = {m.get("id") for m in raw_matches}
            for sp in (
                PAGES["upcoming"],
                "/cricket-schedule/upcoming-series/international",
                "/cricket-schedule/upcoming-series/league"
            ):
                try:
                    up_html = fetch(sp, 60)
                    for sm in extract_matches(up_html):
                        sm_id = sm.get("id")
                        if sm_id and sm_id not in seen_ids:
                            seen_ids.add(sm_id)
                            raw_matches.append(sm)
                except Exception:
                    pass
        elif category == "recent":
            # Also extract from live page so recently finished matches appear in recent
            seen_ids = {m.get("id") for m in raw_matches}
            try:
                live_html = fetch(PAGES["live"], MATCH_CACHE_TTL)
                for lm in extract_matches(live_html):
                    lm_id = lm.get("id")
                    if lm_id and lm_id not in seen_ids:
                        seen_ids.add(lm_id)
                        raw_matches.append(lm)
            except Exception:
                pass

        matches = [
            match
            for match in raw_matches
            if classify_match(match) == category
        ]

        IST = timezone(timedelta(hours=5, minutes=30))
        now_ist = datetime.now(IST)
        today_start_ist = datetime(now_ist.year, now_ist.month, now_ist.day, 0, 0, 0, tzinfo=IST)
        end_tomorrow_ist = today_start_ist + timedelta(days=2) - timedelta(microseconds=1)
        end_tomorrow_ms = int(end_tomorrow_ist.timestamp() * 1000)

        # Enforce strict 2-day Upcoming window in IST (Today + Tomorrow only)
        # Rolls over automatically at midnight (12:00 AM IST)
        if category == "upcoming":
            valid_upcoming = []
            for m in matches:
                sd = m.get("startDate")
                if not sd:
                    continue
                try:
                    s_val = float(sd)
                    s_ms = s_val if s_val > 1e11 else s_val * 1000.0
                    if s_ms <= end_tomorrow_ms:
                        valid_upcoming.append(m)
                except (ValueError, TypeError):
                    pass
            matches = valid_upcoming

        # Cricinfo Fallback Integration:
        # First priority is Cricbuzz. Matches present in Cricinfo but missed by Cricbuzz are added below.
        try:
            ci_all = fetch_cricinfo_matches()
            for ci_m in ci_all:
                if ci_m.get("_category") == category:
                    if category == "upcoming":
                        ci_sd = ci_m.get("startDate")
                        if not ci_sd:
                            continue
                        try:
                            ci_s_val = float(ci_sd)
                            ci_s_ms = ci_s_val if ci_s_val > 1e11 else ci_s_val * 1000.0
                            if ci_s_ms > end_tomorrow_ms:
                                continue
                        except Exception:
                            continue

                    t1_name = ci_m.get("team1", {}).get("teamName", "")
                    t2_name = ci_m.get("team2", {}).get("teamName", "")
                    already_in_cb = False
                    for existing in matches:
                        ex_t1 = existing.get("team1", {}).get("teamName", "")
                        ex_t2 = existing.get("team2", {}).get("teamName", "")
                        if (_team_token_match(t1_name, ex_t1) and _team_token_match(t2_name, ex_t2)) or \
                           (_team_token_match(t1_name, ex_t2) and _team_token_match(t2_name, ex_t1)):
                            already_in_cb = True
                            break
                    if not already_in_cb:
                        matches.append(ci_m)
        except Exception as ci_err:
            logger.warning("Cricinfo fallback merge error: %s", ci_err)

        if category == "upcoming":
            # Chronological sort so closest upcoming match appears first
            matches.sort(key=lambda m: float(m.get("startDate") or 0))

        # Unmatched Allrounder live streams included in Live section
        if category == "live":
            with AUTO_SERVERS_LOCK:
                for ex_id, ex_m in EXTRA_LIVE_MATCHES.items():
                    if not any(str(m.get("id")) == str(ex_id) for m in matches):
                        matches.append(dict(ex_m))

        with AUTO_SERVERS_LOCK:
            for match in matches:
                mid_str = str(match.get("id"))
                if mid_str in AUTO_MATCH_SERVERS:
                    match["auto_servers"] = AUTO_MATCH_SERVERS[mid_str]

        return {
            "success": True,
            "total": len(matches),
            "matches": matches,
            "updated": int(time.time())
        }

    except Exception as error:
        raise HTTPException(502, str(error))


@app.get("/api/section/{section}")
def get_section(section: str):

    if section not in PAGES:
        raise HTTPException(400, "Invalid section")

    try:

        path = PAGES[section]

        html = fetch(path, 300)

        data = extract_page(html, path)

        if section == "news":
            seen = {
                item["path"]
                for item in data["links"]
                if re.fullmatch(
                    r"/cricket-news/\d+/[a-zA-Z0-9-]+/?",
                    item["path"]
                )
            }

            all_news_path = "/cricket-news"
            all_news_html = fetch(all_news_path, 300)

            for item in extract_page(
                all_news_html,
                all_news_path
            )["links"]:
                if (
                    re.fullmatch(
                        r"/cricket-news/\d+/[a-zA-Z0-9-]+/?",
                        item["path"]
                    )
                    and item["path"] not in seen
                ):
                    data["links"].append(item)
                    seen.add(item["path"])

        elif section == "series":
            schedule_path = PAGES["schedule"]
            schedule_html = fetch(schedule_path, 300)
            series_links = {}

            for item in (
                data["links"]
                + extract_page(
                    schedule_html,
                    schedule_path
                )["links"]
            ):
                match = re.fullmatch(
                    r"/cricket-series/(\d+)/([a-zA-Z0-9-]+)(?:/matches)?/?",
                    item["path"]
                )

                if not match:
                    continue

                series_id, slug = match.groups()
                series_links[series_id] = {
                    "title": item["title"],
                    "path": f"/cricket-series/{series_id}/{slug}/matches"
                }

            data["links"] = list(series_links.values())

        elif section == "schedule":
            data["links"] = [
                item
                for item in data["links"]
                if re.fullmatch(
                    r"/cricket-series/\d+/[a-zA-Z0-9-]+(?:/matches)?/?",
                    item["path"]
                )
            ]

        elif section == "archives":
            data["links"] = [
                item
                for item in data["links"]
                if re.fullmatch(
                    r"/cricket-scorecard-archives/\d{4}/?",
                    item["path"]
                )
            ]

        return {
            "success": True,
            "data": data,
            "matches": (
                extract_matches(html)
                if section in ("live", "recent", "upcoming")
                else []
            )
        }

    except Exception as error:
        raise HTTPException(502, str(error))


@app.get("/api/page")
def get_page(path: str = Query(...)):

    allowed = (
        "/cricket-",
        "/live-cricket-scores/"
    )

    if not path.startswith(allowed):
        raise HTTPException(400, "Unsupported page")

    try:

        html = fetch(path, 180)
        data = extract_page(html, path)
        matches = extract_matches(html)

        if re.fullmatch(
            r"/cricket-scorecard-archives/\d{4}/?",
            path
        ):
            data["links"] = [
                item
                for item in data["links"]
                if re.fullmatch(
                    r"/cricket-series/\d+/[a-zA-Z0-9-]+(?:/matches)?/?",
                    item["path"]
                )
            ]
            matches = []

        team_path = re.fullmatch(
            r"/cricket-team/[a-zA-Z0-9-]+/(\d+)(?:/(?:schedule|results|players|news|stats|photos))?/?",
            path
        )
        if path.rstrip("/") == "/cricket-team/domestic":
            domestic_team_paths = {
                item["path"]
                for item in data["links"]
                if re.fullmatch(
                    r"/cricket-team/[a-zA-Z0-9-]+/\d+/?",
                    item["path"]
                )
            }
            league_html = fetch("/cricket-team/league", 180)
            for item in extract_page(
                league_html,
                "/cricket-team/league"
            )["links"]:
                if (
                    re.fullmatch(
                        r"/cricket-team/[a-zA-Z0-9-]+/\d+/?",
                        item["path"]
                    )
                    and item["path"] not in domestic_team_paths
                ):
                    data["links"].append(item)
                    domestic_team_paths.add(item["path"])

        if team_path:
            team_id = team_path.group(1)
            matches = [
                item
                for item in matches
                if any(
                    str(item.get(key, {}).get("teamId", "")) == team_id
                    for key in ("team1", "team2")
                )
            ]
        elif path.startswith("/cricket-team/"):
            matches = []

        return {
            "success": True,
            "data": data,
            "matches": matches
        }

    except Exception as error:
        raise HTTPException(502, str(error))


@app.get("/api/series")
def get_series(
    path: str = Query(...),
    tab: str = "matches"
):

    match = re.fullmatch(
        r"(/cricket-series/(\d+)/([a-zA-Z0-9-]+))(?:/(matches|squads|stats|news|venues))?/?",
        path
    )

    if not match:
        raise HTTPException(400, "Invalid series path")

    series_path, series_id, slug, path_tab = match.groups()
    selected_tab = path_tab or tab

    if selected_tab not in (
        "matches",
        "squads",
        "stats",
        "news",
        "venues"
    ):
        raise HTTPException(400, "Invalid series tab")

    try:
        target_path = (
            series_path
            if selected_tab == "matches"
            else f"{series_path}/{selected_tab}"
        )
        if selected_tab == "matches":
            series_html = fetch(series_path, 300)
            html = fetch(series_path + "/matches", 300)
            matches = [
                item
                for item in extract_matches(html)
                if str(item.get("seriesId")) == series_id
            ]
            data_html = series_html
            data_path = series_path
        else:
            html = fetch(target_path, 300)
            matches = []
            data_html = html
            data_path = target_path

        data = extract_page(
            data_html,
            data_path
        )

        return {
            "success": True,
            "tab": selected_tab,
            "data": data,
            "matches": matches
        }

    except Exception as error:
        raise HTTPException(502, str(error))


@app.get("/api/match/{match_id}")
def get_match(match_id: str):

    try:
        mid_str = str(match_id).strip()

        with AUTO_SERVERS_LOCK:
            if mid_str in EXTRA_LIVE_MATCHES:
                match_obj = dict(EXTRA_LIVE_MATCHES[mid_str])
                if mid_str in AUTO_MATCH_SERVERS:
                    match_obj["auto_servers"] = AUTO_MATCH_SERVERS[mid_str]
                return {
                    "success": True,
                    "match": match_obj
                }

        # 1. Search in Cricbuzz categories (live, recent, upcoming)
        for cat in ("live", "recent", "upcoming"):
            try:
                html = fetch(PAGES[cat], MATCH_CACHE_TTL)
                for match in extract_matches(html):
                    if str(match.get("id")) == mid_str:
                        with AUTO_SERVERS_LOCK:
                            if mid_str in AUTO_MATCH_SERVERS:
                                match["auto_servers"] = AUTO_MATCH_SERVERS[mid_str]
                        return {
                            "success": True,
                            "match": match
                        }
            except Exception:
                pass

        # 1b. Search in Cricbuzz schedule categories
        for sched_p in (
            "/cricket-schedule/upcoming-series/international",
            "/cricket-schedule/upcoming-series/league",
            "/cricket-schedule/upcoming-series/domestic",
            "/cricket-schedule/upcoming-series/women"
        ):
            try:
                s_html = fetch(sched_p, 60)
                for match in extract_matches(s_html):
                    if str(match.get("id")) == mid_str:
                        with AUTO_SERVERS_LOCK:
                            if mid_str in AUTO_MATCH_SERVERS:
                                match["auto_servers"] = AUTO_MATCH_SERVERS[mid_str]
                        return {
                            "success": True,
                            "match": match
                        }
            except Exception:
                pass

        # 2. Search Cricinfo fallback matches
        for ci_m in fetch_cricinfo_matches():
            if str(ci_m.get("id")) == mid_str or str(ci_m.get("id")) == f"ci_{mid_str}":
                with AUTO_SERVERS_LOCK:
                    cid = str(ci_m.get("id"))
                    if cid in AUTO_MATCH_SERVERS:
                        ci_m["auto_servers"] = AUTO_MATCH_SERVERS[cid]
                return {
                    "success": True,
                    "match": ci_m
                }

        # 3. If numeric Cricbuzz match ID, fetch match facts page
        if mid_str.isdigit():
            try:
                facts_html = fetch(f"/cricket-match-facts/{mid_str}", MATCH_CACHE_TTL)
                for match in extract_matches(facts_html):
                    if str(match.get("id")) == mid_str:
                        with AUTO_SERVERS_LOCK:
                            if mid_str in AUTO_MATCH_SERVERS:
                                match["auto_servers"] = AUTO_MATCH_SERVERS[mid_str]
                        return {
                            "success": True,
                            "match": match
                        }
                info_data = normalized_info(facts_html, mid_str)
                if info_data and info_data.get("details"):
                    constructed = {
                        "id": int(mid_str),
                        "series": next((d["value"] for d in info_data["details"] if d.get("label") == "Series"), "Cricket Match"),
                        "description": next((d["value"] for d in info_data["details"] if d.get("label") == "Match"), "Match"),
                        "state": next((d["value"] for d in info_data["details"] if d.get("label") == "State"), "Live"),
                        "status": next((d["value"] for d in info_data["details"] if d.get("label") == "Status"), "Live"),
                        "venue": {"ground": next((d["value"] for d in info_data["details"] if d.get("label") == "Venue"), "")},
                        "team1": dict(info_data["teams"][0]) if len(info_data.get("teams", [])) > 0 else {"teamName": "Team 1"},
                        "team2": dict(info_data["teams"][1]) if len(info_data.get("teams", [])) > 1 else {"teamName": "Team 2"}
                    }
                    attach_cricinfo_logo(constructed["team1"])
                    attach_cricinfo_logo(constructed["team2"])
                    with AUTO_SERVERS_LOCK:
                        if mid_str in AUTO_MATCH_SERVERS:
                            constructed["auto_servers"] = AUTO_MATCH_SERVERS[mid_str]
                    return {
                        "success": True,
                        "match": constructed
                    }
            except Exception:
                pass

        raise HTTPException(404, "Match not found")

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(502, str(error))


@app.get("/api/match/{match_id}/{tab}")
def match_tab(match_id: str, tab: str):

    if str(match_id).startswith("ci_"):
        data = get_cricinfo_tab_data(match_id, tab)
        ci_match = next((m for m in fetch_cricinfo_matches() if str(m.get("id")) == str(match_id)), None)
        return {
            "success": True,
            "matchId": match_id,
            "data": data,
            "matches": [ci_match] if ci_match else []
        }

    paths = {
        "scorecard": f"/live-cricket-scorecard/{match_id}",
        "commentary": f"/live-cricket-full-commentary/{match_id}",
        "info": f"/cricket-match-facts/{match_id}"
    }

    if tab not in paths:
        raise HTTPException(400, "Invalid tab")

    try:

        path = paths[tab]

        html = fetch(path, MATCH_CACHE_TTL)

        return {
            "success": True,
            "matchId": match_id,
            "data": (
                normalized_scorecard(html)
                if tab == "scorecard"
                else normalized_commentary(html)
                if tab == "commentary"
                else normalized_info(html, match_id)
            ),
            "matches": extract_matches(html)
        }

    except Exception as error:
        raise HTTPException(502, str(error))



# CRICKETZONE_DETAIL_ROUTES


@app.get("/api/v2/match/{match_id}/{tab}")
def detailed_match(match_id: int, tab: str):

    if tab not in (
        "scorecard",
        "commentary",
        "info"
    ):
        raise HTTPException(400, "Invalid tab")

    paths = {
        "scorecard": f"/live-cricket-scorecard/{match_id}",
        "commentary": f"/live-cricket-full-commentary/{match_id}",
        "info": f"/cricket-match-facts/{match_id}"
    }

    try:

        html = fetch(paths[tab], MATCH_CACHE_TTL)

        if tab == "scorecard":
            data = normalized_scorecard(html)

        elif tab == "commentary":
            data = normalized_commentary(html)

        else:
            data = normalized_info(html, match_id)

        return {
            "success": True,
            "matchId": match_id,
            "tab": tab,
            "data": data
        }

    except Exception as error:

        raise HTTPException(
            status_code=502,
            detail=str(error)
        )


@app.get("/api/v2/news")
def detailed_news(path: str):

    if not path.startswith("/cricket-news/"):
        raise HTTPException(400, "Invalid news path")

    try:

        html = fetch(path, 300)

        return {
            "success": True,
            "data": extract_news(html)
        }

    except Exception as error:

        raise HTTPException(
            status_code=502,
            detail=str(error)
        )



# CRICKETZONE_NORMALIZED_ROUTES


@app.get("/api/v3/match/{match_id}/{tab}")
def normalized_match(match_id: str, tab: str):

    if tab not in (
        "scorecard",
        "commentary",
        "info"
    ):
        raise HTTPException(400, "Invalid tab")

    if str(match_id).startswith("ci_"):
        return {
            "success": True,
            "matchId": match_id,
            "data": get_cricinfo_tab_data(match_id, tab)
        }

    paths = {
        "scorecard": f"/live-cricket-scorecard/{match_id}",
        "commentary": f"/live-cricket-full-commentary/{match_id}",
        "info": f"/cricket-match-facts/{match_id}"
    }

    try:

        html = fetch(paths[tab], MATCH_CACHE_TTL)

        parsers = {
            "scorecard": normalized_scorecard,
            "commentary": normalized_commentary,
            "info": lambda page: normalized_info(page, match_id)
        }

        return {
            "success": True,
            "matchId": match_id,
            "data": parsers[tab](html)
        }

    except Exception as error:

        raise HTTPException(502, str(error))


@app.get("/api/v3/news")
def normalized_article(path: str):

    if not path.startswith("/cricket-news/"):
        raise HTTPException(400, "Invalid news path")

    try:

        html = fetch(path, 300)

        return {
            "success": True,
            "data": normalized_news(html)
        }

    except Exception as error:

        raise HTTPException(502, str(error))


# CRICKETZONE_V4_ROUTES


def extract_team_players(html):
    soup = BeautifulSoup(html, "html.parser")
    role_labels = (
        ("ALL ROUNDER", "All-rounder"),
        ("WICKET KEEPER", "Wicket-keeper"),
        ("BATSMEN", "Batter"),
        ("BOWLERS", "Bowler"),
        ("BOWLER", "Bowler"),
    )
    players = []
    seen = set()

    for link in soup.find_all("a", href=True):
        path = str(link.get("href") or "")
        if not re.fullmatch(r"/profiles/\d+/[a-zA-Z0-9-]+/?", path):
            continue

        name = link.get("title") or link.get_text(" ", strip=True)
        if not name or path in seen:
            continue

        group = link.parent.parent if link.parent else None
        group_text = (
            group.get_text(" ", strip=True).upper()
            if group
            else ""
        )
        role = next(
            (
                label
                for source, label in role_labels
                if source in group_text
            ),
            "Not available"
        )
        players.append({
            "name": name,
            "role": role,
            "path": path
        })
        seen.add(path)

    return players


@app.get("/api/team")
def get_team(
    path: str = Query(...),
    tab: str = "schedule"
):
    match = re.fullmatch(
        r"(/cricket-team/[a-zA-Z0-9-]+/(\d+))(?:/(schedule|results|players|news|stats))?/?",
        path
    )
    if not match:
        raise HTTPException(400, "Invalid team path")

    team_path, team_id, path_tab = match.groups()
    selected_tab = path_tab or tab
    if selected_tab not in (
        "schedule",
        "results",
        "players",
        "news",
        "stats"
    ):
        raise HTTPException(400, "Invalid team tab")

    target_path = f"{team_path}/{selected_tab}"
    try:
        html = fetch(target_path, 180)
        data = extract_page(html, target_path)
        matches = [
            item
            for item in extract_matches(html)
            if any(
                str(item.get(key, {}).get("teamId", "")) == team_id
                for key in ("team1", "team2")
            )
        ]

        if selected_tab in ("schedule", "results"):
            data["links"] = []
        elif selected_tab == "players":
            data["players"] = extract_team_players(html)
            data["links"] = []
        elif selected_tab == "news":
            data["links"] = [
                item
                for item in extract_page(html, PAGES["news"])["links"]
                if re.fullmatch(
                    r"/cricket-news/\d+/[a-zA-Z0-9-]+/?",
                    item["path"]
                )
            ]
        else:
            data["links"] = []

        return {
            "success": True,
            "tab": selected_tab,
            "data": data,
            "matches": matches
        }
    except Exception as error:
        if isinstance(error, HTTPException):
            raise
        raise HTTPException(502, str(error))


@app.get("/api/v4/match/{match_id}/{tab}")
def v4_match(match_id: str, tab: str):

    if tab not in (
        "commentary",
        "info",
        "squad",
        "points",
        "overs",
        "graphs",
        "news"
    ):
        raise HTTPException(400, "Invalid tab")

    if str(match_id).startswith("ci_"):
        return {
            "success": True,
            "matchId": match_id,
            "data": get_cricinfo_tab_data(match_id, tab)
        }

    try:
        if tab == "commentary":
            path = f"/live-cricket-full-commentary/{match_id}"
        elif tab == "squad":
            path = f"/cricket-match-squads/{match_id}"
        elif tab in ("overs", "graphs"):
            path = f"/live-cricket-over-by-over/{match_id}"
        elif tab == "news":
            path = f"/cricket-match-news/{match_id}"
        elif tab == "points":
            facts_path = f"/cricket-match-facts/{match_id}"
            facts_html = fetch(facts_path, MATCH_CACHE_TTL)
            points_link = next(
                (
                    item["path"]
                    for item in extract_page(
                        facts_html,
                        facts_path
                    )["links"]
                    if item["title"].strip().lower() == "points table"
                    and re.fullmatch(
                        r"/cricket-series/\d+/[a-zA-Z0-9-]+/points-table/?",
                        item["path"]
                    )
                ),
                None
            )

            if not points_link:
                raise HTTPException(
                    404,
                    "Points table is not available for this match"
                )

            path = points_link
        else:
            path = f"/cricket-match-facts/{match_id}"

        html = fetch(path, MATCH_CACHE_TTL)
        if tab == "commentary":
            data = v4_commentary(html)
        elif tab == "squad":
            data = v4_match_info(html, match_id)
            facts_path = f"/cricket-match-facts/{match_id}"
            facts_data = v4_match_info(
                fetch(facts_path, MATCH_CACHE_TTL),
                match_id
            )
            team_names = {
                str(team["teamId"]): team["teamName"]
                for team in facts_data["teams"]
                if team.get("teamId") is not None
            }
            if not team_names:
                match = next(
                    (
                        item
                        for item in extract_matches(
                            fetch(facts_path, MATCH_CACHE_TTL)
                        )
                        if str(item["id"]) == str(match_id)
                    ),
                    None
                )
                if match:
                    for key in ("team1", "team2"):
                        team = match.get(key, {})
                        if team.get("teamId") is not None:
                            team_names[str(team["teamId"])] = (
                                team.get("teamName")
                                or team.get("teamSName")
                            )

            for team in data["teams"]:
                team_id = team.get("teamId")
                if team_id is not None and str(team_id) in team_names:
                    team["teamName"] = team_names[str(team_id)]
        elif tab == "info":
            data = v4_match_info(html, match_id)
        elif tab == "news":
            data = v4_match_news(html)
        else:
            data = extract_page(html, path)
            if tab == "points":
                tables = v4_points_table(html)
                if tables:
                    data = {
                        "headings": ["Points Table"],
                        "paragraphs": [],
                        "tables": tables,
                        "links": []
                    }
                else:
                    data = {
                        "headings": [],
                        "paragraphs": [],
                        "tables": [],
                        "links": [],
                        "emptyMessage": (
                            "A points table is not available for this match."
                        )
                    }
            elif tab in ("overs", "graphs"):
                over_data = v4_over_by_over(html)
                if over_data["tables"]:
                    data = over_data
                else:
                    data = {
                        "headings": [],
                        "paragraphs": [],
                        "tables": [],
                        "links": [],
                        "emptyMessage": (
                            "Over-by-over data is not available for this match right now."
                        )
                    }

        return {
            "success": True,
            "matchId": match_id,
            "tab": tab,
            "data": data
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(502, str(error))


@app.get("/api/v4/rankings")
def v4_ranking(
    gender: str = "men",
    format: str = "odi",
    category: str = "batting"
):

    if gender not in ("men", "women"):
        raise HTTPException(400, "Invalid gender")

    if format not in ("test", "odi", "t20"):
        raise HTTPException(400, "Invalid format")

    if category not in (
        "batting",
        "bowling",
        "all-rounder",
        "teams"
    ):
        raise HTTPException(400, "Invalid category")

    path = (
        f"/cricket-stats/icc-rankings/"
        f"{gender}/{category}"
    )

    try:
        html = fetch(path, 300)

        data = v4_rankings(html, format)

        return {
            "success": True,
            "gender": gender,
            "format": format,
            "category": category,
            "data": data
        }

    except Exception as error:
        raise HTTPException(502, str(error))


@app.get("/api/v4/records")
def v4_records(
    record: str = "mostRuns",
    format: str = "1",
    year: str = "all",
    team: str = "all",
    opponent: str = "all",
):

    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9]*", record):
        raise HTTPException(400, "Invalid record type")

    if format not in ("1", "2", "3"):
        raise HTTPException(400, "Invalid match format")

    if year != "all" and not re.fullmatch(r"\d{4}", year):
        raise HTTPException(400, "Invalid year")

    if team != "all" and not re.fullmatch(r"\d+", team):
        raise HTTPException(400, "Invalid team")

    if opponent != "all" and not re.fullmatch(r"\d+", opponent):
        raise HTTPException(400, "Invalid opponent")

    try:
        catalog = v4_records_catalog(fetch("/cricket-stats", 300))
        record_types = {
            item["value"]
            for category in catalog["categories"].values()
            for item in category
        }
        available_years = {str(value) for value in catalog["years"]}
        available_teams = {
            str(item.get("id"))
            for item in catalog["teams"]
            if isinstance(item, dict) and item.get("id") is not None
        }
        available_opponents = {
            str(item.get("id"))
            for item in catalog["opponents"]
            if isinstance(item, dict) and item.get("id") is not None
        }

        if not catalog["categories"] or not catalog["formats"]:
            raise HTTPException(502, "Records filters are unavailable")
        if record not in record_types:
            raise HTTPException(400, "Invalid record type")
        if year not in available_years:
            raise HTTPException(400, "Invalid year")
        if team not in available_teams:
            raise HTTPException(400, "Invalid team")
        if opponent not in available_opponents:
            raise HTTPException(400, "Invalid opponent")

        path = (
            f"/api/cricket-stats/stats-table/"
            f"{record}/{format}/{year}/{team}/{opponent}"
        )
        payload = json.loads(fetch(path, 300))

        return {
            "success": True,
            "catalog": catalog,
            "data": v4_stats_records(payload),
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(502, str(error))


@app.get("/api/v4/news")
def v4_article(path: str):

    if not re.fullmatch(
        r"/cricket-news/[0-9]+/[a-zA-Z0-9-]+/?",
        path
    ):
        raise HTTPException(400, "Invalid news path")

    try:
        html = fetch(path, 300)

        return {
            "success": True,
            "data": v4_news(html)
        }

    except Exception as error:
        raise HTTPException(502, str(error))


SUGGESTIONS_FILE = PROJECT_DIR / "suggestions.json"
suggestions_lock = threading.Lock()


def load_suggestions():
    if not SUGGESTIONS_FILE.exists():
        return []
    try:
        with open(SUGGESTIONS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []


def save_suggestions(items):
    with open(SUGGESTIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(items, f, indent=2, ensure_ascii=False)


class SuggestionPayload(BaseModel):
    message: str
    word_count: Optional[int] = None

    class Config:
        extra = "allow"


@app.get("/api/suggestions")
@app.get("/api/suggestions/")
def get_suggestions():
    with suggestions_lock:
        items = load_suggestions()
    return {
        "success": True,
        "suggestions": sorted(
            items,
            key=lambda x: str(x.get("created_at", "")),
            reverse=True
        )
    }


@app.post("/api/suggestions")
@app.post("/api/suggestions/")
def create_suggestion(payload: SuggestionPayload):
    text = (payload.message or "").strip()
    words = [w for w in text.split() if w]
    word_count = len(words)
    if word_count < 5:
        raise HTTPException(status_code=400, detail="Message must contain at least 5 words.")
    if word_count > 100:
        raise HTTPException(status_code=400, detail="Message cannot exceed 100 words.")

    new_item = {
        "id": str(uuid.uuid4()),
        "message": text,
        "word_count": word_count,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "pending"
    }

    with suggestions_lock:
        items = load_suggestions()
        items.insert(0, new_item)
        save_suggestions(items)

    return {"success": True, "suggestion": new_item}


@app.delete("/api/suggestions/{item_id}")
@app.delete("/api/suggestions/{item_id}/")
def delete_suggestion(item_id: str):
    with suggestions_lock:
        items = load_suggestions()
        initial_len = len(items)
        items = [x for x in items if str(x.get("id")) != str(item_id)]
        save_suggestions(items)

    return {"success": True, "deleted": initial_len > len(items)}


ACCESS_CONTROL_FILE = PROJECT_DIR / "access_control.json"
access_lock = threading.Lock()


def load_access_control():
    if not ACCESS_CONTROL_FILE.exists():
        return {
            "enabled": True,
            "password": "CRIC",
            "telegram_url": "https://t.me/cricxcreate",
            "delay_seconds": 3,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
    try:
        with open(ACCESS_CONTROL_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if not isinstance(data, dict):
                raise ValueError("Invalid format")
            return data
    except Exception:
        return {
            "enabled": True,
            "password": "CRIC",
            "telegram_url": "https://t.me/cricxcreate",
            "delay_seconds": 3,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }


def save_access_control(data):
    with open(ACCESS_CONTROL_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


@app.get("/api/access-control")
@app.get("/api/access-control/")
def get_access_control():
    with access_lock:
        return load_access_control()


class AccessControlPayload(BaseModel):
    enabled: bool = True
    password: str
    telegram_url: str = "https://t.me/cricxcreate"
    delay_seconds: int = 3


@app.post("/api/access-control")
@app.post("/api/access-control/")
def update_access_control(payload: AccessControlPayload):
    with access_lock:
        data = {
            "enabled": payload.enabled,
            "password": payload.password.strip(),
            "telegram_url": payload.telegram_url.strip(),
            "delay_seconds": max(1, min(60, int(payload.delay_seconds or 3))),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        save_access_control(data)
        return {"success": True, "data": data}


@app.get("/googlee3d9dcf01c7729e6.html")
@app.get("/googlee3d9dcf01c7729e6")
def google_verification():
    return FileResponse(PROJECT_DIR / "googlee3d9dcf01c7729e6.html", media_type="text/html")


@app.get("/sitemap.xml")
def sitemap():
    return FileResponse(PROJECT_DIR / "sitemap.xml", media_type="application/xml")


@app.get("/robots.txt")
def robots():
    return FileResponse(PROJECT_DIR / "robots.txt", media_type="text/plain")


@app.get("/")
def home():
    return FileResponse(PROJECT_DIR / "index.html")


app.mount(
    "/",
    StaticFiles(directory=PROJECT_DIR, html=True),
    name="cricfreex-site"
)


if __name__ == "__main__":

    import uvicorn

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8765
    )
