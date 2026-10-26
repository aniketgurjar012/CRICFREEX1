import json
import re
import time
import threading
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

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

MATCH_CACHE_TTL = 25

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

                    item = {
                        "id": mid,
                        "series": info.get("seriesName", ""),
                        "seriesId": info.get("seriesId"),
                        "description": info.get("matchDesc", ""),
                        "format": info.get("matchFormat", ""),
                        "state": info.get("state", ""),
                        "status": clean_status,
                        "startDate": info.get("startDate"),
                        "team1": info.get("team1", {}),
                        "team2": info.get("team2", {}),
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

    if state in {"preview", "upcoming", "scheduled"}:
        return "upcoming"

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
    }:
        return "recent"

    if state in {
        "in progress",
        "live",
        "toss",
        "stumps",
        "lunch",
        "tea",
        "innings break",
        "drinks",
        "rain delay",
        "delayed",
    }:
        return "live"

    return None


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
                    "video" in link.get("href", "").lower()
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

    if path.startswith("/cricket-team/"):
        category = "teams"
    elif path.startswith("/cricket-scorecard-archives/"):
        category = "archives"
    elif path.startswith("/cricket-series/"):
        category = "series"

    allowed_prefixes = prefixes.get(category)

    for a in main.find_all("a", href=True):

        text = a.get_text(" ", strip=True)
        href = a.get("href", "")

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


@app.get("/api/matches/{category}")
def get_matches(category: str):

    if category not in ("live", "recent", "upcoming"):
        raise HTTPException(400, "Invalid category")

    try:

        html = fetch(PAGES[category], MATCH_CACHE_TTL)

        matches = [
            match
            for match in extract_matches(html)
            if classify_match(match) == category
        ]

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
def get_match(match_id: int):

    try:

        html = fetch(PAGES["live"], MATCH_CACHE_TTL)

        matches = extract_matches(html)

        for match in matches:

            if match["id"] == match_id:
                return {
                    "success": True,
                    "match": match
                }

        raise HTTPException(404, "Match not found")

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(502, str(error))


@app.get("/api/match/{match_id}/{tab}")
def match_tab(match_id: int, tab: str):

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

from scrapers.details import extract_news


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

from scrapers.normalized import (
    extract_scorecard as normalized_scorecard,
    extract_commentary as normalized_commentary,
    extract_match_info as normalized_info,
    extract_news as normalized_news
)


@app.get("/api/v3/match/{match_id}/{tab}")
def normalized_match(match_id: int, tab: str):

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
        path = link.get("href", "")
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
def v4_match(match_id: int, tab: str):

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


@app.get("/api/suggestions")
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
def create_suggestion(payload: SuggestionPayload):
    text = (payload.message or "").strip()
    words = [w for w in text.split() if w]
    word_count = len(words)
    if word_count < 5:
        raise HTTPException(status_code=400, detail="Message must contain at least 5 words.")
    if word_count > 1000:
        raise HTTPException(status_code=400, detail="Message cannot exceed 1000 words.")

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
def delete_suggestion(item_id: str):
    with suggestions_lock:
        items = load_suggestions()
        initial_len = len(items)
        items = [x for x in items if str(x.get("id")) != str(item_id)]
        save_suggestions(items)

    return {"success": True, "deleted": initial_len > len(items)}


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
