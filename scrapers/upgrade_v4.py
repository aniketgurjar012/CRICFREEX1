import json
import re
from bs4 import BeautifulSoup

from scrapers.normalized import (
    payload_strings,
    candidate_objects,
    walk,
    first
)


def clean_text(text):
    if not isinstance(text, str):
        return str(text or "")

    soup = BeautifulSoup(text, "html.parser")

    return soup.get_text(" ", strip=True)


def player_value(value):
    if value is None:
        return ""

    text = str(value).strip()
    if text.lower() in {"$undefined", "undefined", "null", "none"}:
        return ""

    return text


def unique_records(records, keys):

    seen = set()
    result = []

    for record in records:

        identity = tuple(
            str(record.get(k, ""))
            for k in keys
        )

        if identity in seen:
            continue

        seen.add(identity)
        result.append(record)

    return result


def commentary(html):

    deliveries = []

    for root in candidate_objects(html):

        for obj in walk(root):

            text = first(
                obj,
                "commText",
                "commentaryText",
                "commentary"
            )

            if not isinstance(text, str):
                continue

            text = clean_text(text)

            if not text or len(text) < 4:
                continue

            over = first(
                obj,
                "overNumber",
                "overNum",
                "over"
            )

            event = first(
                obj,
                "event",
                "eventType"
            )

            runs = first(
                obj,
                "runs",
                default=""
            )

            deliveries.append({
                "over": str(over),
                "text": text,
                "event": str(event),
                "runs": runs
            })

    deliveries = unique_records(
        deliveries,
        ["over", "text"]
    )

    return {
        "total": len(deliveries),
        "deliveries": deliveries[:500]
    }


def player_name(player):

    if not isinstance(player, dict):
        return ""

    return first(
        player,
        "fullName",
        "name",
        "playerName",
        "batName",
        "bowlName"
    )


def extract_players(value):

    players = []

    if isinstance(value, dict):

        for item in value.values():

            if isinstance(item, dict):

                name = player_name(item)

                if name:
                    players.append({
                        "name": name,
                        "role": player_value(first(
                            item,
                            "role",
                            "playerRole",
                            "playingRole"
                        )),
                        "battingStyle": player_value(first(item, "battingStyle")),
                        "bowlingStyle": player_value(first(item, "bowlingStyle"))
                    })

            elif isinstance(item, list):
                players.extend(
                    extract_players(item)
                )

    elif isinstance(value, list):

        for item in value:

            if isinstance(item, dict):

                name = player_name(item)

                if name:
                    players.append({
                        "name": name,
                        "role": player_value(first(
                            item,
                            "role",
                            "playerRole",
                            "playingRole"
                        )),
                        "battingStyle": player_value(first(item, "battingStyle")),
                        "bowlingStyle": player_value(first(item, "bowlingStyle"))
                    })

    return unique_records(
        players,
        ["name"]
    )


def match_info(html, match_id=None):

    details = {}
    teams = {}
    team_ids = {}
    team_names_by_id = {}

    fields = {
        "seriesName": "Series",
        "matchDesc": "Match",
        "matchFormat": "Format",
        "status": "Status",
        "state": "Match State"
    }

    for root in candidate_objects(html):

        for obj in walk(root):
            match_context = next(
                (
                    obj.get(wrapper)
                    for wrapper in ("matchInfo", "matchHeader")
                    if isinstance(obj.get(wrapper), dict)
                    and (
                        match_id is None
                        or str(obj[wrapper].get("matchId")) == str(match_id)
                    )
                ),
                None
            )
            if match_id is not None and match_context is None:
                continue

            for wrapper in (
                "matchInfo",
                "matchHeader"
            ):

                info = obj.get(wrapper)

                if not isinstance(info, dict):
                    continue

                if (
                    match_id is not None
                    and str(info.get("matchId")) != str(match_id)
                ):
                    continue

                for key, label in fields.items():

                    value = info.get(key)

                    if value:
                        details.setdefault(label, str(value))

                venue = info.get("venueInfo", {})

                if isinstance(venue, dict):

                    ground = venue.get("ground", "")
                    city = venue.get("city", "")

                    if ground:
                        ground = re.sub(
                            r",\s*[+-]\d{2}:\d{2}$",
                            "",
                            ground
                        )
                        if city and ground.casefold().endswith(
                            f", {city}".casefold()
                        ):
                            ground = ground[:-(len(city) + 2)]
                        details.setdefault("Venue", ground)

                    if city:
                        details.setdefault("City", city)

                toss = info.get("tossResults")

                if isinstance(toss, dict):

                    winner = toss.get(
                        "tossWinnerName",
                        ""
                    )

                    decision = toss.get(
                        "decision",
                        ""
                    )

                    if winner:
                        details.setdefault("Toss",
                            f"{winner} - {decision}"
                        )

                for key, label in (
                    ("umpire1", "Umpire 1"),
                    ("umpire2", "Umpire 2"),
                    ("umpire3", "Third Umpire"),
                    ("referee", "Match Referee")
                ):

                    official = info.get(key)

                    if isinstance(official, dict):

                        name = official.get("name")

                        if name:
                            details.setdefault(label, name)

            for key in (
                "team1",
                "team2",
                "team1Details",
                "team2Details"
            ):

                team = obj.get(key)
                if not isinstance(team, dict):
                    for wrapper in ("matchInfo", "matchHeader"):
                        info = obj.get(wrapper)
                        if isinstance(info, dict):
                            team = info.get(key)
                            if isinstance(team, dict):
                                break

                if not isinstance(team, dict):
                    continue

                name = first(
                    team,
                    "teamName",
                    "teamSName"
                )

                if not name:
                    continue

                team_id = team.get("teamId")

                if team_id is not None:
                    team_names_by_id[str(team_id)] = name
                    team_ids[name] = team_id

                players = []

                for field in (
                    "players",
                    "playingXI",
                    "playingXi",
                    "squad",
                    "playerDetails"
                ):

                    value = team.get(field)

                    if value:
                        players.extend(
                            extract_players(value)
                        )

                if name not in teams:
                    teams[name] = []

                if players:
                    teams[name] = unique_records(
                        teams[name] + players,
                        ["name"]
                    )

    decoder = json.JSONDecoder()

    for payload in payload_strings(html):
        marker = '{"team":'
        search_from = 0

        while True:
            start = payload.find(marker, search_from)

            if start < 0:
                break

            try:
                roster, length = decoder.raw_decode(
                    payload[start:]
                )
            except json.JSONDecodeError:
                search_from = start + len(marker)
                continue

            search_from = start + length
            team = roster.get("team")

            if not isinstance(team, dict):
                continue

            team_id = team.get("teamId")
            team_name = first(
                team,
                "teamName",
                "teamSName"
            )

            if not team_name:
                continue

            if team_id is not None:
                team_names_by_id[str(team_id)] = team_name
                team_ids[team_name] = team_id

            teams.setdefault(team_name, []).extend(
                extract_players(roster.get("players", {}))
            )

        position = 0

        while True:
            start = payload.find('{"id":', position)

            if start < 0:
                break

            try:
                player, length = decoder.raw_decode(
                    payload[start:]
                )
            except json.JSONDecodeError:
                position = start + 1
                continue

            position = start + length

            if (
                not isinstance(player, dict)
                or not player.get("name")
                or not player.get("role")
                or player.get("teamId") is None
            ):
                continue

            team_name = team_names_by_id.get(
                str(player["teamId"]),
                first(player, "teamName", default="")
            )
            if not team_name or team_name == "$undefined":
                continue

            team_ids.setdefault(team_name, player["teamId"])
            teams.setdefault(team_name, []).append({
                "name": player.get("fullName") or player["name"],
                "role": player_value(player.get("role")),
                "battingStyle": player_value(player.get("battingStyle")),
                "bowlingStyle": player_value(player.get("bowlingStyle"))
            })

    for name, players in teams.items():
        teams[name] = unique_records(players, ["name"])

    return {
        "matchId": match_id,
        "details": [
            {
                "label": key,
                "value": value
            }
            for key, value in details.items()
        ],
        "teams": [
            {
                "teamName": name,
                "teamId": team_ids.get(name),
                "players": players
            }
            for name, players in teams.items()
        ]
    }


def points_table(html):

    decoder = json.JSONDecoder()
    headers = [
        "Team",
        "Played",
        "Won",
        "Lost",
        "Tied",
        "No result",
        "Drawn",
        "Points",
        "NRR",
        "Form",
        "Qualification"
    ]

    for payload in payload_strings(html):
        marker = '"pointsTable":'
        position = payload.find(marker)

        while position >= 0:
            for start in range(position - 1, -1, -1):
                if payload[start] != "{":
                    continue

                try:
                    root, _ = decoder.raw_decode(payload[start:])
                except json.JSONDecodeError:
                    continue

                groups = root.get("pointsTable") if isinstance(root, dict) else None

                if not isinstance(groups, list):
                    continue

                tables = []

                for group in groups:
                    if not isinstance(group, dict):
                        continue

                    records = group.get("pointsTableInfo", [])
                    rows = [headers]

                    for team in records:
                        if not isinstance(team, dict):
                            continue

                        form = team.get("form", [])
                        if isinstance(form, list):
                            form = " ".join(
                                str(item.get("result", item))
                                if isinstance(item, dict)
                                else str(item)
                                for item in form
                            )

                        rows.append([
                            team.get("teamFullName")
                            or team.get("teamName", ""),
                            team.get("matchesPlayed", ""),
                            team.get("matchesWon", ""),
                            team.get("matchesLost", ""),
                            team.get("matchesTied", ""),
                            team.get("noRes", ""),
                            team.get("matchesDrawn", ""),
                            team.get("points", ""),
                            team.get("nrr", ""),
                            form,
                            team.get("teamQualifyStatus", "")
                        ])

                    if len(rows) > 1:
                        tables.append(rows)

                if tables:
                    return tables

            position = payload.find(marker, position + len(marker))

    return []


def match_news(html):

    soup = BeautifulSoup(html, "html.parser")
    main = soup.find("main") or soup.body or soup
    article_pattern = re.compile(
        r"/cricket-news/\d+/[a-zA-Z0-9-]+/?"
    )
    latest_news_seen = False
    seen = set()
    articles = []

    for element in main.find_all(["a", "h1", "h2", "h3", "h4"]):
        if element.name != "a":
            if element.get_text(" ", strip=True).strip(":").casefold() == "latest news":
                latest_news_seen = True
                break
            continue

        path = element.get("href", "")
        title = element.get_text(" ", strip=True)

        if (
            latest_news_seen
            or not article_pattern.fullmatch(path)
            or not title
            or path in seen
        ):
            continue

        seen.add(path)
        articles.append({
            "title": title,
            "path": path
        })

    message = (
        ""
        if articles
        else "Match-related news is not available for this match right now."
    )

    return {
        "title": "Match News",
        "headings": [],
        "paragraphs": [],
        "tables": [],
        "links": articles,
        "emptyMessage": message
    }


def videos(html):

    soup = BeautifulSoup(html, "html.parser")
    path_by_title = {}
    poster_by_image_id = {}
    cards_by_path = {}

    for anchor in soup.find_all("a", href=True):
        if not re.fullmatch(
            r"/cricket-videos/\d+/[a-zA-Z0-9-]+/?",
            anchor.get("href", "")
        ):
            continue

        title = anchor.get_text(" ", strip=True)
        duration_match = re.match(r"^(\d{1,2}:\d{2})\s+", title)
        duration = duration_match.group(1) if duration_match else ""
        title = re.sub(r"^\d{1,2}:\d{2}\s+", "", title)
        image = anchor.find("img")
        image_source = ""
        if image:
            image_source = image.get("src") or image.get("data-src") or ""
        if not title and image:
            title = image.get("alt", "").strip()
        if title:
            path_by_title.setdefault(title.casefold(), anchor["href"])
            cards_by_path.setdefault(anchor["href"], {
                "title": title,
                "description": "",
                "duration": duration,
                "category": "Video",
                "path": anchor["href"],
                "image": image_source
            })

        match = re.search(r"/c(\d+)/", image_source)
        if match:
            poster_by_image_id[match.group(1)] = image_source

    decoder = json.JSONDecoder()
    found = {}

    for payload in payload_strings(html):
        marker = '"videoUrl":'
        position = 0

        while True:
            position = payload.find(marker, position)
            if position < 0:
                break

            start = payload.rfind("{", 0, position)
            position += len(marker)

            if start < 0:
                continue

            try:
                item, _ = decoder.raw_decode(payload[start:])
            except json.JSONDecodeError:
                continue

            if not isinstance(item, dict):
                continue

            title = item.get("title", "").strip()
            image_id = str(item.get("imageId", ""))
            path = path_by_title.get(title.casefold())

            if not title or not path:
                continue

            identity = (title.casefold(), path)
            found.setdefault(identity, {
                "title": title,
                "description": item.get("description", ""),
                "duration": item.get("durationStr", ""),
                "category": item.get("videoType", ""),
                "path": path,
                "image": poster_by_image_id.get(image_id, "")
            })

    for path, card in cards_by_path.items():
        found.setdefault((card["title"].casefold(), path), card)

    return list(found.values())


def over_by_over(html):

    decoder = json.JSONDecoder()
    groups = {}

    for payload in payload_strings(html):
        marker = '"overSummaryList":'
        position = payload.find(marker)

        while position >= 0:
            root = None

            for start in range(position - 1, -1, -1):
                if payload[start] != "{":
                    continue

                try:
                    candidate, _ = decoder.raw_decode(payload[start:])
                except json.JSONDecodeError:
                    continue

                records = (
                    candidate.get("overSummaryList")
                    if isinstance(candidate, dict)
                    else None
                )

                if isinstance(records, list):
                    root = candidate
                    break

            if root:
                for record in root["overSummaryList"]:
                    if not isinstance(record, dict):
                        continue

                    innings_id = str(record.get("inningsId", ""))
                    over = str(record.get("overs", ""))
                    groups.setdefault(innings_id, {})[over] = record

            position = payload.find(marker, position + len(marker))

    headings = []
    tables = []
    headers = [
        "Over",
        "Team",
        "Runs",
        "Total",
        "Wickets",
        "Ball Summary",
        "Batters",
        "Bowler"
    ]

    def over_number(record):
        try:
            return float(record.get("overs", 0))
        except (TypeError, ValueError):
            return -1

    def names(record, key):
        values = record.get(key) or []
        if not isinstance(values, list):
            values = [values]
        return " / ".join(str(value) for value in values if value)

    def innings_number(innings_id):
        try:
            return (0, int(innings_id))
        except ValueError:
            return (1, innings_id)

    for innings_id in sorted(groups, key=innings_number):
        records = list(groups[innings_id].values())
        records.sort(key=over_number)
        headings.append(
            f"Innings {innings_id} - {records[0].get('batTeamName', '')}"
        )
        tables.append([
            headers,
            *[
                [
                    row.get("overs", ""),
                    row.get("batTeamName", ""),
                    row.get("runs", ""),
                    row.get("score", ""),
                    row.get("wickets", ""),
                    row.get("ovrSummary", ""),
                    names(row, "batStrikerNames"),
                    names(row, "bowlNames")
                ]
                for row in records
            ]
        ])

    return {
        "headings": headings,
        "tables": tables,
        "paragraphs": [],
        "links": []
    }


def rankings(html, format="odi"):

    decoder = json.JSONDecoder()
    selected_records = []

    for payload in payload_strings(html):
        search_from = 0

        while True:
            marker = '"formatTypesData":'
            position = payload.find(marker, search_from)

            if position < 0:
                break

            object_start = payload.rfind('{"data":', 0, position)

            if object_start < 0:
                search_from = position + len(marker)
                continue

            try:
                page_data, _ = decoder.raw_decode(payload[object_start:])
            except json.JSONDecodeError:
                search_from = position + len(marker)
                continue

            data = page_data.get("data", {})
            formats = data.get("formatTypesData", {})
            selected = formats.get(format, {})

            if isinstance(selected, dict):
                selected_records.extend(selected.get("rank", []))

            search_from = position + len(marker)

    records = []

    for item in selected_records:
        if not isinstance(item, dict):
            continue

        rank = first(item, "rank", "position", "currentRank")
        rating = first(item, "rating", "points")
        name = first(item, "name", "playerName", "teamName")

        if not name or rank in (None, "") or rating in (None, ""):
            continue

        try:
            rank_number = int(rank)
        except (ValueError, TypeError):
            continue

        records.append({
            "rank": rank_number,
            "name": str(name),
            "country": str(first(
                item,
                "country",
                "countryName",
                "teamName"
            )),
            "rating": rating
        })

    records = unique_records(records, ["rank", "name"])
    records.sort(key=lambda item: item["rank"])

    return {"rankings": records[:200]}


def records_catalog(html):

    for text in payload_strings(html):

        start = text.find('{"initialStats":')

        if start < 0:
            continue

        try:
            payload, _ = json.JSONDecoder().raw_decode(text[start:])
        except json.JSONDecodeError:
            continue

        initial = payload.get("initialStats")
        record_types = payload.get("statsTypes")

        if not isinstance(initial, dict) or not isinstance(record_types, dict):
            continue

        categories = {}

        for category, items in record_types.items():
            if not isinstance(items, list):
                continue

            categories[category] = [
                {
                    "value": str(item.get("value", "")),
                    "label": str(item.get("header", "")),
                }
                for item in items
                if isinstance(item, dict)
                and item.get("value")
                and item.get("header")
            ]

        return {
            "categories": categories,
            "formats": initial.get("matchTypes", []),
            "years": initial.get("years", []),
            "teams": initial.get("teams", []),
            "opponents": initial.get("opponentTeams", []),
        }

    return {
        "categories": {},
        "formats": [],
        "years": [],
        "teams": [],
        "opponents": [],
    }


def stats_records(payload):

    if not isinstance(payload, dict):
        return {"headers": [], "rows": []}

    headers = payload.get("webHeaders")
    values = payload.get("webValues")

    if not isinstance(headers, list) or not isinstance(values, list):
        return {"headers": [], "rows": []}

    normalized_headers = [
        str(header).strip()
        for header in headers
        if header is not None
    ]
    rows = []

    for row in values:
        if not isinstance(row, list):
            continue

        cells = [str(value) if value is not None else "" for value in row]
        if len(cells) == len(normalized_headers) + 1:
            cells.pop(0)

        if len(cells) == len(normalized_headers):
            rows.append(cells)

    return {
        "headers": normalized_headers,
        "rows": rows,
    }


def news_article(html):

    soup = BeautifulSoup(html, "html.parser")

    result = {
        "title": "",
        "description": "",
        "author": "",
        "published": "",
        "paragraphs": []
    }

    meta = soup.find(
        "meta",
        property="og:title"
    )

    if meta:
        result["title"] = meta.get(
            "content",
            ""
        )

    description = soup.find(
        "meta",
        property="og:description"
    )

    if description:
        result["description"] = description.get(
            "content",
            ""
        )

    for script in soup.find_all(
        "script",
        type="application/ld+json"
    ):

        try:
            data = json.loads(
                script.get_text()
            )
        except (ValueError, TypeError):
            continue

        for obj in walk(data):

            kind = str(
                obj.get("@type", "")
            )

            if "Article" not in kind:
                continue

            result["title"] = obj.get(
                "headline",
                result["title"]
            )

            result["published"] = obj.get(
                "datePublished",
                ""
            )

            author = obj.get("author")

            if isinstance(author, dict):
                result["author"] = author.get(
                    "name",
                    ""
                )

            body = obj.get("articleBody")

            if isinstance(body, str) and body.strip():
                result["paragraphs"].append(
                    clean_text(body)
                )

    for root in candidate_objects(html):

        for obj in walk(root):

            for key in (
                "content",
                "storyContent",
                "articleBody"
            ):

                value = obj.get(key)

                if not isinstance(value, str):
                    continue

                text = clean_text(value)

                if len(text) > 100:
                    result["paragraphs"].append(text)

    result["paragraphs"] = list(
        dict.fromkeys(result["paragraphs"])
    )

    return result
