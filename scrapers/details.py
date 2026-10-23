import json
import re
from bs4 import BeautifulSoup


def decode_json_data(html):
    """
    Extract JSON objects embedded in Next.js scripts.
    """

    soup = BeautifulSoup(html, "html.parser")

    objects = []

    decoder = json.JSONDecoder()

    pattern = (
        r'self\.__next_f\.push\('
        r'\[1,("(?:\\.|[^"\\])*")\]'
        r'\)'
    )

    for script in soup.find_all("script"):

        text = script.get_text()

        if "self.__next_f.push" not in text:
            continue

        fragments = re.findall(
            pattern,
            text,
            re.DOTALL
        )

        for fragment in fragments:

            try:
                decoded = json.loads(fragment)
            except json.JSONDecodeError:
                continue

            # Look for embedded JSON objects.
            # React payloads can contain non-JSON prefixes.

            for marker in (
                '{"scoreCard":',
                '{"scorecard":',
                '{"commentary":',
                '{"commText":',
                '{"matchInfo":',
                '{"matchHeader":',
                '{"story":',
                '{"article":',
                '{"innings":',
            ):

                pos = 0

                while True:

                    start = decoded.find(marker, pos)

                    if start < 0:
                        break

                    try:
                        obj, length = decoder.raw_decode(
                            decoded[start:]
                        )

                        objects.append(obj)

                        pos = start + length

                    except json.JSONDecodeError:
                        pos = start + len(marker)

    return objects


def collect_objects(obj, predicate, results):

    if isinstance(obj, dict):

        if predicate(obj):
            results.append(obj)

        for value in obj.values():
            collect_objects(value, predicate, results)

    elif isinstance(obj, list):

        for item in obj:
            collect_objects(item, predicate, results)


def unique_objects(items):

    seen = set()
    result = []

    for item in items:

        key = json.dumps(
            item,
            sort_keys=True,
            default=str
        )

        if key not in seen:

            seen.add(key)
            result.append(item)

    return result


def extract_scorecard(html):

    objects = decode_json_data(html)

    batting = []
    bowling = []
    innings = []
    extras = []
    fall_of_wickets = []

    for root in objects:

        collect_objects(
            root,
            lambda x: (
                "batName" in x
                or "batsmanName" in x
                or (
                    "runs" in x
                    and "balls" in x
                    and (
                        "fours" in x
                        or "sixes" in x
                    )
                )
            ),
            batting
        )

        collect_objects(
            root,
            lambda x: (
                "bowlName" in x
                or "bowlerName" in x
                or (
                    "economy" in x
                    and "overs" in x
                )
            ),
            bowling
        )

        collect_objects(
            root,
            lambda x: (
                "inningsId" in x
                and (
                    "runs" in x
                    or "score" in x
                )
            ),
            innings
        )

        collect_objects(
            root,
            lambda x: (
                "extras" in x
                or "extraDetails" in x
            ),
            extras
        )

        collect_objects(
            root,
            lambda x: (
                "fow" in x
                or "wicketNumber" in x
            ),
            fall_of_wickets
        )

    return {
        "batting": unique_objects(batting)[:100],
        "bowling": unique_objects(bowling)[:100],
        "innings": unique_objects(innings)[:30],
        "extras": unique_objects(extras)[:30],
        "fallOfWickets": unique_objects(fall_of_wickets)[:50]
    }


def extract_commentary(html):

    objects = decode_json_data(html)

    commentary = []

    for root in objects:

        collect_objects(
            root,
            lambda x: (
                "commText" in x
                or "commentaryText" in x
                or (
                    "overNumber" in x
                    and (
                        "runs" in x
                        or "event" in x
                    )
                )
            ),
            commentary
        )

    return {
        "deliveries": unique_objects(commentary)[:500]
    }


def extract_match_info(html):

    objects = decode_json_data(html)

    info = []
    players = []
    officials = []

    for root in objects:

        collect_objects(
            root,
            lambda x: (
                "matchHeader" in x
                or (
                    "matchId" in x
                    and "team1" in x
                    and "team2" in x
                )
            ),
            info
        )

        collect_objects(
            root,
            lambda x: (
                "playingXI" in x
                or "playingXi" in x
                or "squad" in x
            ),
            players
        )

        collect_objects(
            root,
            lambda x: (
                "umpire1" in x
                or "umpire2" in x
                or "referee" in x
                or "tossResults" in x
            ),
            officials
        )

    return {
        "matchInfo": unique_objects(info)[:10],
        "squads": unique_objects(players)[:20],
        "officials": unique_objects(officials)[:20]
    }


def extract_news(html):

    soup = BeautifulSoup(html, "html.parser")

    title = ""
    description = ""
    author = ""
    published = ""

    if soup.title:
        title = soup.title.get_text(
            " ",
            strip=True
        )

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

        candidates = []

        if isinstance(data, list):
            candidates = data

        elif isinstance(data, dict):
            candidates = [data]

            graph = data.get("@graph", [])

            if isinstance(graph, list):
                candidates.extend(graph)

        for item in candidates:

            if not isinstance(item, dict):
                continue

            article_type = item.get("@type", "")

            if isinstance(article_type, list):
                article_type = " ".join(article_type)

            if not any(
                name in str(article_type)
                for name in (
                    "NewsArticle",
                    "Article",
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

            writer = item.get("author", {})

            if isinstance(writer, dict):
                author = writer.get("name", "")

            elif isinstance(writer, list):
                author = ", ".join(
                    x.get("name", "")
                    for x in writer
                    if isinstance(x, dict)
                )

    article = soup.find("article")

    if not article:

        article = soup.find(
            "div",
            class_=re.compile(
                r"article|story-content|story-body",
                re.I
            )
        )

    paragraphs = []

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
