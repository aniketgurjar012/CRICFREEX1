import json
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from main import (
    extract_team_players,
    extract_page,
    get_page,
    get_matches,
    get_section,
    get_series,
    get_team,
    v4_match,
    v4_records
)
from scrapers.normalized import extract_match_info
from scrapers.normalized import extract_scorecard
from scrapers.upgrade_v4 import (
    extract_players,
    match_news,
    match_info,
    over_by_over,
    points_table,
    rankings,
    records_catalog,
    stats_records,
    videos
)


class PageExtractionTests(unittest.TestCase):

    def test_page_heading_is_preferred_to_browser_title(self):
        html = (
            "<html><title>Long browser title</title>"
            "<main><h1>Useful page heading</h1></main></html>"
        )

        self.assertEqual(
            extract_page(html, "/")["title"],
            "Useful page heading"
        )

    def test_video_sections_and_links_are_removed_from_pages(self):
        html = (
            "<html><main><h1>Series</h1>"
            "<div><div><h2>Latest Videos</h2>"
            "<a href='/cricket-videos/1'>Match Highlights</a>"
            "<p>Video description to remove.</p></div></div>"
            "<a href='/cricket-series/1/matches'>Matches</a>"
            "</main></html>"
        )

        result = extract_page(html, "/cricket-series/1")

        self.assertNotIn("Video", str(result))
        self.assertEqual(
            result["links"],
            [{"title": "Matches", "path": "/cricket-series/1/matches"}]
        )

    def test_section_page_keeps_more_than_two_hundred_news_links(self):
        links = "".join(
            f"<a href='/cricket-news/{index}/story-{index}'>"
            f"Cricket story {index}</a>"
            for index in range(225)
        )

        result = extract_page(
            f"<html><main>{links}</main></html>",
            "/cricket-news/latest-news"
        )

        self.assertEqual(len(result["links"]), 225)

    def test_four_year_archive_page_exposes_historical_series(self):
        html = (
            "<html><main>"
            "<a href='/cricket-series/4889/new-zealand-tour-2022/matches'>"
            "New Zealand tour of Pakistan 2022-23</a>"
            "<a href='/cricket-scorecard-archives/2022'>2022</a>"
            "</main></html>"
        )

        result = extract_page(
            html,
            "/cricket-scorecard-archives/2022"
        )

        self.assertEqual(
            result["links"],
            [{
                "title": "New Zealand tour of Pakistan 2022-23",
                "path": "/cricket-series/4889/new-zealand-tour-2022/matches"
            }]
        )

    def test_archive_index_contains_years_only(self):
        html = (
            "<html><main>"
            "<a href='/cricket-series/700/series-2025'>Series 2025</a>"
            "<a href='/cricket-scorecard-archives/2025'>2025</a>"
            "<a href='/cricket-scorecard-archives/2024'>2024</a>"
            "</main></html>"
        )

        with patch("main.fetch", return_value=html):
            result = get_section("archives")

        self.assertEqual(
            result["data"]["links"],
            [
                {
                    "title": "2025",
                    "path": "/cricket-scorecard-archives/2025"
                },
                {
                    "title": "2024",
                    "path": "/cricket-scorecard-archives/2024"
                }
            ]
        )

    def test_archive_year_page_excludes_global_navigation_and_matches(self):
        html = (
            "<html><main>"
            "<a href='/cricket-match/live-scores'>Current Matches</a>"
            "<a href='/cricket-series/700/series-2022/matches'>"
            "Series 2022</a>"
            "</main></html>"
        )

        with patch("main.fetch", return_value=html), patch(
            "main.extract_matches",
            return_value=[{"id": 1}]
        ):
            result = get_page("/cricket-scorecard-archives/2022")

        self.assertEqual(
            result["data"]["links"],
            [{
                "title": "Series 2022",
                "path": "/cricket-series/700/series-2022/matches"
            }]
        )
        self.assertEqual(result["matches"], [])

    def test_team_page_suppresses_unrelated_global_match_links(self):
        html = "<html><main><a href='/cricket-team/india/2'>India</a></main></html>"
        matches = [
            {
                "id": 1,
                "team1": {"teamId": 58},
                "team2": {"teamId": 1}
            },
            {
                "id": 2,
                "team1": {"teamId": 2},
                "team2": {"teamId": 3}
            }
        ]

        with patch("main.fetch", return_value=html), patch(
            "main.extract_matches",
            return_value=matches
        ):
            result = get_page("/cricket-team/chennai-super-kings/58/results")

        self.assertEqual(result["matches"], [matches[0]])

    def test_domestic_team_directory_includes_league_franchises(self):
        domestic_html = (
            "<html><main>"
            "<a href='/cricket-team/local-club/1'>Local Club</a>"
            "</main></html>"
        )
        league_html = (
            "<html><main>"
            "<a href='/cricket-team/chennai-super-kings/58'>"
            "Chennai Super Kings</a>"
            "<a href='/cricket-team/women'>Women</a>"
            "</main></html>"
        )

        with patch(
            "main.fetch",
            side_effect=[domestic_html, league_html]
        ), patch("main.extract_matches", return_value=[]):
            result = get_page("/cricket-team/domestic")

        self.assertIn(
            {
                "title": "Chennai Super Kings",
                "path": "/cricket-team/chennai-super-kings/58"
            },
            result["data"]["links"]
        )
        self.assertEqual(result["matches"], [])

    def test_team_roster_extracts_roles_and_keeps_source_order(self):
        html = (
            "<main>"
            "<div><div>BATSMEN"
            "<div><a href='/profiles/1/player-a' title='Player A'>Player A</a></div>"
            "<div><a href='/profiles/2/player-b' title='Player B'>Player B</a></div>"
            "</div>"
            "<div><div>ALL ROUNDER"
            "<div><a href='/profiles/3/player-c' title='Player C'>Player C</a></div>"
            "</div>"
            "<div><div>BOWLERS"
            "<div><a href='/profiles/4/player-d' title='Player D'>Player D</a></div>"
            "</div>"
            "</main>"
        )

        self.assertEqual(
            extract_team_players(html),
            [
                {
                    "name": "Player A",
                    "role": "Batter",
                    "path": "/profiles/1/player-a"
                },
                {
                    "name": "Player B",
                    "role": "Batter",
                    "path": "/profiles/2/player-b"
                },
                {
                    "name": "Player C",
                    "role": "All-rounder",
                    "path": "/profiles/3/player-c"
                },
                {
                    "name": "Player D",
                    "role": "Bowler",
                    "path": "/profiles/4/player-d"
                }
            ]
        )

    def test_team_endpoint_filters_fixtures_and_extracts_roster(self):
        html = (
            "<main><div><div>BATSMEN"
            "<div><a href='/profiles/1/player-a' title='Player A'>Player A</a></div>"
            "</div></main>"
        )
        matches = [
            {
                "id": 58,
                "team1": {"teamId": 58},
                "team2": {"teamId": 1}
            },
            {
                "id": 99,
                "team1": {"teamId": 2},
                "team2": {"teamId": 3}
            }
        ]
        page = {
            "title": "Chennai Super Kings",
            "headings": [],
            "tables": [],
            "paragraphs": [],
            "links": []
        }

        with patch("main.fetch", return_value=html), patch(
            "main.extract_page",
            return_value=page
        ), patch(
            "main.extract_matches",
            return_value=matches
        ):
            result = get_team(
                "/cricket-team/chennai-super-kings/58",
                "results"
            )

        self.assertEqual(result["matches"], [matches[0]])
        with patch("main.fetch", return_value=html), patch(
            "main.extract_page",
            return_value=page
        ), patch("main.extract_matches", return_value=[]):
            squad = get_team(
                "/cricket-team/chennai-super-kings/58",
                "players"
            )

        self.assertEqual(
            squad["data"]["players"],
            [{
                "name": "Player A",
                "role": "Batter",
                "path": "/profiles/1/player-a"
            }]
        )


class MatchInfoTests(unittest.TestCase):

    def test_extractors_only_return_requested_match(self):
        roots = [
            {
                "matchInfo": {
                    "matchId": 7,
                    "seriesName": "Unrelated Series",
                    "team1": {"teamName": "Unrelated A"},
                    "team2": {"teamName": "Unrelated B"}
                }
            },
            {
                "matchInfo": {
                    "matchId": 42,
                    "seriesName": "Requested Series",
                    "matchDesc": "Final",
                    "matchFormat": "T20",
                    "team1": {"teamName": "Requested A"},
                    "team2": {"teamName": "Requested B"},
                    "venueInfo": {"ground": "Main Ground", "city": "City"}
                }
            }
        ]

        with patch("scrapers.normalized.candidate_objects", return_value=roots):
            normalized = extract_match_info("<html>", 42)

        with patch("scrapers.upgrade_v4.candidate_objects", return_value=roots):
            detailed = match_info("<html>", 42)

        self.assertEqual(normalized["matchId"], 42)
        self.assertEqual(
            {team["teamName"] for team in normalized["teams"]},
            {"Requested A", "Requested B"}
        )
        self.assertEqual(detailed["matchId"], 42)
        self.assertEqual(
            {item["value"] for item in detailed["details"]},
            {"Requested Series", "Final", "T20", "Main Ground", "City"}
        )
        self.assertEqual(
            {team["teamName"] for team in detailed["teams"]},
            {"Requested A", "Requested B"}
        )
        self.assertNotIn("Unrelated Series", str(detailed))

    def test_scorecard_preserves_extras_did_not_bat_and_bowling_extras(self):
        root = {
            "scoreCard": [{
                "batTeamDetails": {
                    "batTeamName": "Team A",
                    "batsmenData": {
                        "1": {
                            "batName": "Batter A",
                            "runs": 40,
                            "balls": 30
                        }
                    }
                },
                "bowlTeamDetails": {
                    "bowlersData": {
                        "1": {
                            "bowlName": "Bowler A",
                            "overs": 4,
                            "noBalls": 1,
                            "wides": 2
                        }
                    }
                },
                "scoreDetails": {
                    "runs": 100,
                    "wickets": 2,
                    "overs": 10
                },
                "extrasData": {
                    "byes": 1,
                    "noBalls": 1,
                    "total": 4,
                    "wides": 2
                },
                "didNotBat": ["Player B"],
                "wicketsData": {
                    "wkt_1": {
                        "batName": "Batter A",
                        "wktOver": 8.2,
                        "wktRuns": 80,
                        "wktNbr": 1
                    }
                }
            }]
        }

        with patch(
            "scrapers.normalized.candidate_objects",
            return_value=[root]
        ):
            innings = extract_scorecard("<html>")["innings"]

        self.assertEqual(len(innings), 1)
        self.assertEqual(innings[0]["extras"]["total"], 4)
        self.assertEqual(innings[0]["didNotBat"], ["Player B"])
        self.assertEqual(innings[0]["bowling"][0]["noBalls"], 1)
        self.assertEqual(innings[0]["bowling"][0]["wides"], 2)

    def test_missing_match_does_not_fall_back_to_other_match(self):
        roots = [
            {
                "matchInfo": {
                    "matchId": 7,
                    "seriesName": "Unrelated Series"
                }
            }
        ]

        with patch("scrapers.upgrade_v4.candidate_objects", return_value=roots):
            result = match_info("<html>", 42)

        self.assertEqual(result["matchId"], 42)
        self.assertEqual(result["details"], [])
        self.assertEqual(result["teams"], [])

    def test_squad_page_payloads_are_parsed_into_team_player_tables(self):
        payload = (
            '{"id":1,"name":"Player A","role":"Bowling Allrounder",'
            '"teamId":11,"teamName":"NZ","battingStyle":"LEFT",'
            '"bowlingStyle":"$undefined"}'
            '{"id":2,"name":"Player B","role":"Batter",'
            '"teamId":11,"teamName":"NZ","bowlingStyle":"Right Arm fast",'
            '"battingStyle":"$undefined"}'
        )

        with patch(
            "scrapers.upgrade_v4.candidate_objects",
            return_value=[]
        ), patch(
            "scrapers.upgrade_v4.payload_strings",
            return_value=[payload]
        ):
            result = match_info("<html>", 42)

        self.assertEqual(
            result["teams"],
            [{
                "teamName": "NZ",
                "teamId": 11,
                "players": [
                    {
                        "name": "Player A",
                        "role": "Bowling Allrounder",
                        "battingStyle": "LEFT",
                        "bowlingStyle": ""
                    },
                    {
                        "name": "Player B",
                        "role": "Batter",
                        "battingStyle": "",
                        "bowlingStyle": "Right Arm fast"
                    }
                ]
            }]
        )


class MatchCategoryTests(unittest.TestCase):

    def test_match_categories_exclude_other_states(self):
        matches = [
            {"id": 1, "state": "Preview"},
            {"id": 2, "state": "Complete"},
            {"id": 3, "state": "In Progress"},
            {"id": 4, "state": "Stumps"},
            {"id": 5, "state": "Abandoned"},
            {"id": 6, "state": "Toss"},
        ]

        with patch("main.fetch", return_value="<html>matches</html>"), patch(
            "main.extract_matches",
            return_value=matches
        ):
            self.assertEqual(
                [item["id"] for item in get_matches("upcoming")["matches"]],
                [1]
            )
            self.assertEqual(
                [item["id"] for item in get_matches("recent")["matches"]],
                [2, 5]
            )
            self.assertEqual(
                [item["id"] for item in get_matches("live")["matches"]],
                [3, 4, 6]
            )


class SeriesRouteTests(unittest.TestCase):

    def test_series_endpoint_reads_match_tab_and_filters_by_series_id(self):
        matches_html = "<html>series matches</html>"
        series_html = "<html>series home</html>"
        fetched = []

        def fake_fetch(path, ttl):
            fetched.append(path)
            return matches_html if path.endswith("/matches") else series_html

        with patch("main.fetch", side_effect=fake_fetch), patch(
            "main.extract_matches",
            return_value=[
                {"id": 1, "seriesId": 42},
                {"id": 2, "seriesId": 99}
            ]
        ), patch(
            "main.extract_page",
            return_value={"title": "Series", "links": []}
        ):
            result = get_series("/cricket-series/42/test-series")

        self.assertIn(
            "/cricket-series/42/test-series/matches",
            fetched
        )
        self.assertEqual(
            [match["id"] for match in result["matches"]],
            [1]
        )


class RankingsTests(unittest.TestCase):

    def test_match_news_excludes_latest_news_sidebar(self):
        html = (
            "<main><section>"
            "<a href='/cricket-news/12/match-story'>"
            "Match result and key moments</a>"
            "</section><h2>LATEST NEWS</h2>"
            "<a href='/cricket-news/13/unrelated-story'>"
            "Unrelated headline</a></main>"
        )

        result = match_news(html)

        self.assertEqual(
            result["links"],
            [{
                "title": "Match result and key moments",
                "path": "/cricket-news/12/match-story"
            }]
        )
        self.assertEqual(result["emptyMessage"], "")

    def test_match_news_has_clear_empty_state_without_related_articles(self):
        result = match_news(
            "<main><h2>Nothing to show</h2><h2>LATEST NEWS</h2>"
            "<a href='/cricket-news/13/unrelated-story'>"
            "Unrelated headline</a></main>"
        )

        self.assertEqual(result["links"], [])
        self.assertIn("not available", result["emptyMessage"])

    def test_video_records_include_original_watch_path_and_poster(self):
        payload = json.dumps({
            "id": 987,
            "title": "Match preview",
            "imageId": 12345,
            "description": "A verified source video.",
            "durationStr": "2:30",
            "videoType": "Analysis",
            "videoUrl": "https://video.example/stream.m3u8"
        })
        html = (
            '<a href="/cricket-videos/987/match-preview">'
            '<img src="https://static.example/c12345/poster.jpg">'
            "2:30 Match preview</a>"
        )

        with patch(
            "scrapers.upgrade_v4.payload_strings",
            return_value=[payload]
        ):
            result = videos(html)

        self.assertEqual(result, [{
            "title": "Match preview",
            "description": "A verified source video.",
            "duration": "2:30",
            "category": "Analysis",
            "path": "/cricket-videos/987/match-preview",
            "image": "https://static.example/c12345/poster.jpg"
        }])

    def test_points_table_extracts_group_rows_and_form(self):
        payload = json.dumps({
            "seriesId": 42,
            "pointsTable": [{
                "groupName": "Group A",
                "pointsTableInfo": [{
                    "teamFullName": "Country A",
                    "matchesPlayed": 3,
                    "matchesWon": 2,
                    "matchesLost": 1,
                    "matchesTied": 0,
                    "noRes": 0,
                    "matchesDrawn": 0,
                    "points": 8,
                    "nrr": "+0.250",
                    "form": [{"result": "W"}, {"result": "L"}],
                    "teamQualifyStatus": "Qualified"
                }]
            }]
        })

        with patch(
            "scrapers.upgrade_v4.payload_strings",
            return_value=[payload]
        ):
            tables = points_table("<html>")

        self.assertEqual(len(tables), 1)
        self.assertEqual(tables[0][1], [
            "Country A", 3, 2, 1, 0, 0, 0, 8, "+0.250", "W L",
            "Qualified"
        ])

    def test_over_by_over_extracts_and_orders_innings_records(self):
        payload = json.dumps({
            "innings": [
                {
                    "overSummaryList": [
                        {
                            "inningsId": 1,
                            "overs": 2,
                            "runs": 4,
                            "score": 9,
                            "wickets": 0,
                            "ovrSummary": "1 3 ",
                            "batTeamName": "AAA",
                            "batStrikerNames": ["Player A"],
                            "bowlNames": ["Player B"]
                        },
                        {
                            "inningsId": 1,
                            "overs": 1,
                            "runs": 5,
                            "score": 5,
                            "wickets": 0,
                            "ovrSummary": "4 1 ",
                            "batTeamName": "AAA",
                            "batStrikerNames": ["Player A"],
                            "bowlNames": ["Player B"]
                        }
                    ]
                },
                {
                    "overSummaryList": [
                        {
                            "inningsId": 2,
                            "overs": 1,
                            "runs": 3,
                            "score": 3,
                            "wickets": 0,
                            "ovrSummary": "1 2 ",
                            "batTeamName": "BBB",
                            "batStrikerNames": ["Player C"],
                            "bowlNames": ["Player D"]
                        }
                    ]
                }
            ],
            "matchId": 42
        })

        with patch(
            "scrapers.upgrade_v4.payload_strings",
            return_value=[payload]
        ):
            data = over_by_over("<html>")

        self.assertEqual(len(data["tables"]), 2)
        self.assertEqual(
            [row[0] for row in data["tables"][0][1:]],
            [1, 2]
        )
        self.assertEqual(data["tables"][0][1][5], "4 1 ")
        self.assertEqual(
            [row[0] for row in data["tables"][1][1:]],
            [1]
        )

    def test_rankings_select_only_requested_format(self):
        payload = (
            '{"data":{"categoryType":"batsmen","formatTypesData":{'
            '"odi":{"rank":[{"rank":"1","name":"ODI Batter",'
            '"rating":"900","country":"Country A"}]},'
            '"test":{"rank":[{"rank":"1","name":"Test Batter",'
            '"rating":"850","country":"Country B"}]},'
            '"t20":{"rank":[{"rank":"1","name":"T20 Batter",'
            '"rating":"800","country":"Country C"}]}}}}'
        )

        with patch("scrapers.upgrade_v4.payload_strings", return_value=[payload]):
            odi = rankings("<html>", "odi")
            test = rankings("<html>", "test")
            t20 = rankings("<html>", "t20")

        self.assertEqual(odi["rankings"][0]["name"], "ODI Batter")
        self.assertEqual(test["rankings"][0]["name"], "Test Batter")
        self.assertEqual(t20["rankings"][0]["name"], "T20 Batter")

    def test_squad_player_roles_and_styles_are_preserved(self):
        players = extract_players([
            {
                "name": "Player A",
                "role": "All-rounder",
                "battingStyle": "Right-hand bat",
                "bowlingStyle": "Right-arm fast"
            },
            {
                "name": "Player B",
                "playerRole": "Batter"
            }
        ])

        self.assertEqual(
            players,
            [
                {
                    "name": "Player A",
                    "role": "All-rounder",
                    "battingStyle": "Right-hand bat",
                    "bowlingStyle": "Right-arm fast"
                },
                {
                    "name": "Player B",
                    "role": "Batter",
                    "battingStyle": "",
                    "bowlingStyle": ""
                }
            ]
        )


class RecordsTests(unittest.TestCase):

    def test_records_catalog_reads_available_categories_and_filters(self):
        payload = json.dumps({
            "initialStats": {
                "matchTypes": [{"matchTypeId": "1", "matchTypeDesc": "test"}],
                "teams": [{"id": "all", "teamShortName": "all"}],
                "opponentTeams": [{"id": "2", "teamShortName": "IND"}],
                "years": ["all", "2025"]
            },
            "statsTypes": {
                "Batting": [{
                    "value": "mostRuns",
                    "header": "Most Runs"
                }],
                "Bowling": [{
                    "value": "mostWickets",
                    "header": "Most Wickets"
                }]
            }
        })

        with patch(
            "scrapers.upgrade_v4.payload_strings",
            return_value=[payload]
        ):
            result = records_catalog("<html>")

        self.assertEqual(result["categories"]["Batting"], [{
            "value": "mostRuns",
            "label": "Most Runs"
        }])
        self.assertEqual(result["formats"][0]["matchTypeId"], "1")
        self.assertEqual(result["years"], ["all", "2025"])
        self.assertEqual(result["opponents"][0]["teamShortName"], "IND")

    def test_records_table_removes_hidden_player_ids_and_bad_rows(self):
        result = stats_records({
            "webHeaders": ["PLAYER", "RUNS"],
            "webValues": [
                ["25", "Sachin Tendulkar", "15921"],
                ["broken"]
            ]
        })

        self.assertEqual(result, {
            "headers": ["PLAYER", "RUNS"],
            "rows": [["Sachin Tendulkar", "15921"]]
        })

    def test_records_route_applies_verified_filter_values(self):
        catalog = {
            "categories": {
                "Batting": [{"value": "mostRuns", "label": "Most Runs"}]
            },
            "formats": [{"matchTypeId": "2", "matchTypeDesc": "odi"}],
            "years": ["all", "2025"],
            "teams": [{"id": "all"}, {"id": "2"}],
            "opponents": [{"id": "all"}, {"id": "3"}]
        }
        table = json.dumps({
            "webHeaders": ["PLAYER", "RUNS"],
            "webValues": [["25", "Sachin Tendulkar", "100"]]
        })

        with patch(
            "main.v4_records_catalog",
            return_value=catalog
        ), patch("main.fetch", return_value=table) as fetch:
            result = v4_records(
                record="mostRuns",
                format="2",
                year="2025",
                team="2",
                opponent="3"
            )

        self.assertEqual(
            fetch.call_args.args[0],
            "/api/cricket-stats/stats-table/mostRuns/2/2025/2/3"
        )
        self.assertEqual(result["data"]["rows"], [["Sachin Tendulkar", "100"]])

    def test_records_route_rejects_unsupported_format(self):
        with self.assertRaises(HTTPException) as error:
            v4_records(format="4")

        self.assertEqual(error.exception.status_code, 400)


class MatchGraphRouteTests(unittest.TestCase):

    def test_graphs_route_uses_over_by_over_feed(self):
        over_data = {
            "headings": ["Innings 1 - Team A"],
            "tables": [[
                ["Over", "Team", "Runs", "Total", "Wickets"],
                [1, "Team A", 6, 6, 0],
                [2, "Team A", 4, 10, 1]
            ]],
            "paragraphs": [],
            "links": []
        }

        with patch("main.fetch", return_value="<html>overs</html>") as fetch, \
             patch("main.extract_page", return_value={"links": []}), \
             patch("main.v4_over_by_over", return_value=over_data):
            result = v4_match(42, "graphs")

        self.assertEqual(
            fetch.call_args.args[0],
            "/live-cricket-over-by-over/42"
        )
        self.assertEqual(result["data"], over_data)


if __name__ == "__main__":
    unittest.main()
