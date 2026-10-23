
import json
import re
from bs4 import BeautifulSoup


PUSH_PATTERN = re.compile(
    r'self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)',
    re.DOTALL
)


def payload_strings(html):

    soup = BeautifulSoup(html, "html.parser")

    result = []

    for script in soup.find_all("script"):

        text = script.get_text()

        if "self.__next_f.push" not in text:
            continue

        for match in PUSH_PATTERN.finditer(text):

            try:
                result.append(json.loads(match.group(1)))
            except (ValueError, TypeError):
                pass

    return result


def candidate_objects(html):

    decoder = json.JSONDecoder()
    objects = []

    markers = (
        '{"scoreCard":',
        '{"scorecard":',
        '{"scorecardData":',
        '{"scoreCardData":',
        '{"innings":',
        '{"batting":',
        '{"batsman":',
        '{"batTeamDetails":',
        '{"bowlTeamDetails":',
        '{"commentary":',
        '{"commentaryList":',
        '{"commText":',
        '{"matchInfo":',
        '{"matchHeader":',
        '{"matchDetails":',
        '{"rankings":',
        '{"rank":',
        '{"story":',
        '{"article":',
    )

    for text in payload_strings(html):

        positions = set()

        for marker in markers:

            start = 0

            while True:

                pos = text.find(marker, start)

                if pos < 0:
                    break

                positions.add(pos)
                start = pos + len(marker)

        for pos in sorted(positions):

            try:

                obj, _ = decoder.raw_decode(text[pos:])

                if isinstance(obj, dict):
                    objects.append(obj)

            except json.JSONDecodeError:
                pass

    return objects


def walk(obj):

    if isinstance(obj, dict):

        yield obj

        for value in obj.values():
            yield from walk(value)

    elif isinstance(obj, list):

        for value in obj:
            yield from walk(value)


def first(obj, *keys, default=""):

    if not isinstance(obj, dict):
        return default

    for key in keys:

        value = obj.get(key)

        if value is not None and value != "":
            return value

    return default


def unique(rows):

    seen = set()
    result = []

    for row in rows:

        key = json.dumps(
            row,
            sort_keys=True,
            default=str
        )

        if key not in seen:
            seen.add(key)
            result.append(row)

    return result


def normalize_batter(obj):

    name = first(
        obj,
        "batName",
        "batsmanName",
        "batterName"
    )

    if not name:
        return None

    return {
        "name": name,
        "dismissal": first(
            obj,
            "outDesc",
            "dismissal",
            "wicketDescription"
        ),
        "runs": first(obj, "runs", "r", default=0),
        "balls": first(obj, "balls", "b", default=0),
        "fours": first(obj, "fours", "4s", default=0),
        "sixes": first(obj, "sixes", "6s", default=0),
        "strikeRate": first(
            obj,
            "strkrate",
            "strikeRate",
            "sr"
        )
    }


def normalize_bowler(obj):

    name = first(
        obj,
        "bowlName",
        "bowlerName"
    )

    if not name:
        return None

    return {
        "name": name,
        "overs": first(obj, "overs", "o"),
        "maidens": first(
            obj,
            "maidens",
            "m",
            default=0
        ),
        "runs": first(
            obj,
            "runs",
            "r",
            default=0
        ),
        "wickets": first(
            obj,
            "wickets",
            "w",
            default=0
        ),
        "noBalls": first(
            obj,
            "noBalls",
            "noBall",
            "no_balls",
            "nb",
            default=0
        ),
        "wides": first(
            obj,
            "wides",
            "wide",
            "wideBalls",
            "wideRuns",
            default=0
        ),
        "economy": first(
            obj,
            "economy",
            "economyRate",
            "eco"
        )
    }


def extract_scorecard(html):

    roots = candidate_objects(html)

    innings = []

    for root in roots:

        for obj in walk(root):

            batting = []
            bowling = []

            bat_details = first(
                obj,
                "batTeamDetails",
                default={}
            )

            bowl_details = first(
                obj,
                "bowlTeamDetails",
                default={}
            )

            if isinstance(bat_details, dict):

                players = first(
                    bat_details,
                    "batsmenData",
                    default={}
                )

                if isinstance(players, dict):

                    for player in players.values():

                        row = normalize_batter(player)

                        if row:
                            batting.append(row)

            if isinstance(bowl_details, dict):

                players = first(
                    bowl_details,
                    "bowlersData",
                    default={}
                )

                if isinstance(players, dict):

                    for player in players.values():

                        row = normalize_bowler(player)

                        if row:
                            bowling.append(row)

            # Other supported batting/bowling structures
            for key in ("batting", "batsmen", "batters"):

                value = obj.get(key)

                if isinstance(value, list):

                    for player in value:

                        row = normalize_batter(player)

                        if row:
                            batting.append(row)

            for key in ("bowling", "bowlers"):

                value = obj.get(key)

                if isinstance(value, list):

                    for player in value:

                        row = normalize_bowler(player)

                        if row:
                            bowling.append(row)

            batting = unique(batting)
            bowling = unique(bowling)

            if not batting and not bowling:
                continue

            score_details = first(
                obj,
                "scoreDetails",
                default={}
            )

            if not isinstance(score_details, dict):
                score_details = {}

            innings.append({
                "team": first(
                    bat_details,
                    "batTeamName",
                    "teamName"
                ),
                "runs": first(
                    score_details,
                    "runs"
                ),
                "wickets": first(
                    score_details,
                    "wickets"
                ),
                "overs": first(
                    score_details,
                    "overs"
                ),
                "batting": batting,
                "bowling": bowling,
                "extras": first(
                    obj,
                    "extrasData",
                    "extras",
                    default={}
                ),
                "didNotBat": first(
                    obj,
                    "didNotBat",
                    "didNotBatPlayers",
                    default=[]
                ),
                "fallOfWickets": first(
                    obj,
                    "wicketsData",
                    "fallOfWickets",
                    default={}
                )
            })

    return {
        "innings": unique(innings)
    }


def extract_commentary(html):

    deliveries = []

    for root in candidate_objects(html):

        for obj in walk(root):

            text = first(
                obj,
                "commText",
                "commentaryText"
            )

            if not text:
                continue

            deliveries.append({
                "over": first(
                    obj,
                    "overNumber",
                    "overNum"
                ),
                "text": str(text),
                "event": first(
                    obj,
                    "event",
                    "eventType"
                ),
                "runs": first(
                    obj,
                    "runs",
                    default=""
                )
            })

    deliveries = unique(deliveries)

    return {
        "deliveries": deliveries[:500]
    }


def extract_match_info(html, match_id=None):

    info = {}
    teams = {}

    for root in candidate_objects(html):

        for obj in walk(root):

            for wrapper in ("matchInfo", "matchHeader"):
                match = obj.get(wrapper)

                if not isinstance(match, dict):
                    continue

                if (
                    match_id is not None
                    and str(match.get("matchId")) != str(match_id)
                ):
                    continue

                for key, value in match.items():
                    if value not in (None, ""):
                        info.setdefault(key, value)

                for key in (
                    "team1",
                    "team2",
                    "team1Details",
                    "team2Details"
                ):
                    team = match.get(key) or obj.get(key)

                    if not isinstance(team, dict):
                        continue

                    name = first(team, "teamName", "teamSName")

                    if name:
                        teams.setdefault(str(name), team)

    allowed = {
        "matchDesc": "Match",
        "matchFormat": "Format",
        "seriesName": "Series",
        "status": "Status",
        "state": "State",
        "tossResults": "Toss",
        "umpire1": "Umpire 1",
        "umpire2": "Umpire 2",
        "umpire3": "Third Umpire",
        "referee": "Match Referee",
        "venueInfo": "Venue"
    }

    details = []

    for key, label in allowed.items():

        if key in info:

            value = info[key]

            if isinstance(value, dict):

                value = ", ".join(
                    str(v)
                    for k, v in value.items()
                    if k not in (
                        "id",
                        "teamId",
                        "imageId",
                        "latitude",
                        "longitude"
                    )
                    and not isinstance(v, (dict, list))
                )

            details.append({
                "label": label,
                "value": str(value)
            })

    return {
        "matchId": match_id,
        "details": details,
        "teams": list(teams.values())
    }


def extract_news(html):

    soup = BeautifulSoup(html, "html.parser")

    title = ""
    description = ""
    author = ""
    published = ""
    paragraphs = []

    if soup.title:
        title = soup.title.get_text(" ", strip=True)

    meta = soup.find(
        "meta",
        attrs={"name": "description"}
    )

    if meta:
        description = meta.get("content", "")

    for script in soup.find_all(
        "script",
        type="application/ld+json"
    ):

        try:
            data = json.loads(script.get_text())
        except (ValueError, TypeError):
            continue

        candidates = list(walk(data))

        for item in candidates:

            article_type = str(
                item.get("@type", "")
            )

            if not any(
                value in article_type
                for value in (
                    "Article",
                    "NewsArticle",
                    "BlogPosting"
                )
            ):
                continue

            title = item.get("headline", title)

            description = item.get(
                "description",
                description
            )

            published = item.get(
                "datePublished",
                published
            )

            writer = item.get("author")

            if isinstance(writer, dict):
                author = writer.get("name", "")

            elif isinstance(writer, list):

                author = ", ".join(
                    x.get("name", "")
                    for x in writer
                    if isinstance(x, dict)
                )

            body = item.get("articleBody")

            if isinstance(body, str) and body.strip():
                paragraphs.append(body.strip())

    article = soup.find("article")

    if not article:

        article = soup.find(
            attrs={
                "class": re.compile(
                    "story-content|article-body|story-body",
                    re.I
                )
            }
        )

    if article:

        for unwanted in article.find_all(
            ["nav", "aside", "footer", "script", "style"]
        ):
            unwanted.decompose()

        for p in article.find_all("p"):

            text = p.get_text(" ", strip=True)

            if len(text) > 35:
                paragraphs.append(text)

    return {
        "title": title,
        "description": description,
        "author": author,
        "published": published,
        "paragraphs": list(dict.fromkeys(paragraphs))
    }
