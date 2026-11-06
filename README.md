# CRICFREEX1

CricFreeX is a cricket-focused live centre for current and upcoming scores, results, scorecards, squads, team schedules and results, series statistics, historical archives, ICC rankings and cricket news. Live score data refreshes automatically; live-channel links are managed separately in Admin.

## Run locally

The cricket centre needs the included Python API, which also serves the static site. On Windows, run `start-cricfreex.bat` from this folder, then open <http://127.0.0.1:8765>.

```powershell
cd "Cricfreex live"
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8765
```

Port 8765 keeps CricFreeX separate from other local cricket apps that commonly use port 8000. Keep the server window open while using the site. The API fetches public cricket pages and caches responses briefly; data availability depends on the source. Unavailable source data is shown as unavailable rather than fabricated.

## Configuration and deployment

- `config.js` contains the existing Supabase client configuration and the `CRICKET_API_URL` base URL. It is set to the Render API deployment for Vercel hosting. The public, read-only cricket API allows cross-origin GET requests so a separately hosted frontend can call it.
- Deploy the Python app and static files together, or serve the frontend separately and configure the API origin. A static-only host cannot serve the cricket API.
- Admin content editing is for live channels; series and episode entries are not shown. If the sections table is empty, new content can still be assigned to the built-in **Live Channels** section slug without creating a database section.
- Channel players are shown when a channel is selected, including after restoring a shared channel URL. Sources on `localhost` or `127.0.0.1` only work for viewers whose own device runs that source service.
- Match scores refresh every 10 seconds while the site is open. Stale streaming placeholders are excluded from browser caches and removed from the match list on refresh. Published live channels continue to use Supabase Realtime.
- Manual page refreshes return to the top of the home page. The Telegram popup appears 5 seconds after opening the site and repeats every 2 minutes; it can be closed until the next interval.
- The site includes a per-channel copy-link action.
- Rankings, team player roles, available series/match statistics and historical scorecards come from the configured cricket data provider. Unsupported or unavailable information is not fabricated.
The **Records** section uses the provider's current records endpoint and offers batting/bowling categories with format, year, team and opponent filters. Match **Overs** and **Graphs** use every innings and over list present in the provider's over-by-over feed, ordered from the first available over onward. Graphs visualize cumulative innings runs; they do not estimate win probability. A source that omits earlier innings cannot provide those missing overs.

## Tests

```powershell
python -m unittest discover -s tests -v
```
