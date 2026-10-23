# CRICFREEX1

CricFreeX is a cricket-focused live centre for current and upcoming scores, results, scorecards, squads, team schedules and results, series statistics, historical archives, ICC rankings, cricket news and embedded match streams.

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
- In Admin, use **Cricket Watch Links** to choose a live or upcoming match and add up to three titled URLs; this does not require creating a live-channel record. The public match card shows only **Server 1**, **Server 2** and **Server 3** buttons; titles and URLs are not printed on the page. Selecting a server loads its player in an on-page iframe. YouTube and Vimeo watch URLs are converted to embed URLs; other providers may block iframe playback, in which case **Open source in a new tab** is available. Link records use the existing `content` table and require no schema migration.
- Admin content editing no longer offers poster/thumbnail uploads or previews. Existing image references are preserved on edits. If the sections table is empty, new content can still be assigned to the built-in **Live Channels** section slug without creating a database section.
- Channel players are shown when a channel is selected, including after restoring a shared channel URL. Sources on `localhost` or `127.0.0.1` only work for viewers whose own device runs that source service.
- Supabase Realtime refreshes published match links on the public site. Match scores refresh every 30 seconds.
- Rankings, team player roles, available series/match statistics and historical scorecards come from the configured cricket data provider. Unsupported or unavailable information is not fabricated.
The **Records** section uses the provider's current records endpoint and offers batting/bowling categories with format, year, team and opponent filters. Match **Overs** and **Graphs** use every innings and over list present in the provider's over-by-over feed, ordered from the first available over onward. Graphs visualize cumulative innings runs; they do not estimate win probability. A source that omits earlier innings cannot provide those missing overs.

## Tests

```powershell
python -m unittest discover -s tests -v
```
