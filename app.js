"use strict";

(() => {
  if (location.pathname.toLowerCase().endsWith("/index.html") || location.pathname.toLowerCase() === "/index.html") {
    const cleanPath = location.pathname.replace(/\/index\.html$/i, "") || "/";
    history.replaceState(null, "", cleanPath + (location.search || "") + (location.hash || ""));
  }
})();

function cleanAppPath(u) {
  const p = (u?.pathname || location.pathname || "/").replace(/\/index\.html$/i, "") || "/";
  return p;
}

const C = window.CRICFREEX_CONFIG;

const db = window.supabase.createClient(
  C.SUPABASE_URL,
  C.SUPABASE_ANON_KEY
);
window.cricfreexDb = db;

const $ = id => document.getElementById(id);

function setSiteMode(mode) {
  const exploreBtn = $("exploreButton");
  const watchBtn = $("watchButton");
  const navCricket = $("navCricket");
  const navChannels = $("navChannels");
  const channelsSec = $("channels");
  const cricketSec = $("cricketCenter");
  const mainTabs = $("mainTabs");

  if (mainTabs) mainTabs.hidden = true;

  if (mode === "channels") {
    document.body.classList.remove("cricket-active");
    document.body.classList.add("channels-active");

    if (exploreBtn) {
      exploreBtn.className = "btn btn-dark mode-tab";
      exploreBtn.setAttribute("aria-selected", "false");
    }
    if (watchBtn) {
      watchBtn.className = "btn btn-red mode-tab active";
      watchBtn.setAttribute("aria-selected", "true");
    }
    if (navCricket) navCricket.classList.remove("active");
    if (navChannels) navChannels.classList.add("active");

    if (cricketSec) cricketSec.hidden = true;
    if (channelsSec) channelsSec.hidden = false;
  } else {
    document.body.classList.add("cricket-active");
    document.body.classList.remove("channels-active");

    if (exploreBtn) {
      exploreBtn.className = "btn btn-red mode-tab active";
      exploreBtn.setAttribute("aria-selected", "true");
    }
    if (watchBtn) {
      watchBtn.className = "btn btn-dark mode-tab";
      watchBtn.setAttribute("aria-selected", "false");
    }
    if (navCricket) navCricket.classList.add("active");
    if (navChannels) navChannels.classList.remove("active");

    if (channelsSec) channelsSec.hidden = true;
    if (cricketSec) cricketSec.hidden = false;
  }
}
window.setSiteMode = setSiteMode;

let settings = null;
let sections = [];
let content = [];

const CRICKET_WATCH_LINK_PREFIX = "__cricket_watch__:";

let section = "sports";
let filter = "all";
let activeSeries = null;
let selected = "";
let restored = false;

const esc = v =>
  String(v ?? "").replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c])
  );

const SITE_ACCESS_PREFIX = "__site_access__";

function isCricketWatchLink(item) {
  return String(item?.category || "")
    .startsWith(CRICKET_WATCH_LINK_PREFIX);
}

function isSiteAccessItem(item) {
  return String(item?.public_id || "") === SITE_ACCESS_PREFIX ||
         String(item?.category || "") === SITE_ACCESS_PREFIX;
}

function cricketWatchMatchId(item) {
  return String(item?.category || "")
    .slice(CRICKET_WATCH_LINK_PREFIX.length);
}

async function cleanupFinishedWatchLinks() {
  const watchItems = content.filter(isCricketWatchLink);
  if (!watchItems.length) return;

  try {
    const response = await fetch(`${C.CRICKET_API_URL}/api/matches/recent`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return;
    const result = await response.json();
    const recentMatches = Array.isArray(result.matches) ? result.matches : [];
    const finishedMatchIds = new Set(recentMatches.map(m => String(m.id)));

    const itemsToDelete = watchItems.filter(item =>
      finishedMatchIds.has(cricketWatchMatchId(item))
    );

    if (!itemsToDelete.length) return;

    const idsToDelete = itemsToDelete.map(item => item.id);

    content = content.filter(item => !idsToDelete.includes(item.id));
    window.CRICFREEX_CONTENT = content;
    window.dispatchEvent(
      new CustomEvent(
        "cricfreex:content-updated",
        { detail: content }
      )
    );

    const { error } = await db.from("content")
      .delete()
      .in("id", idsToDelete);

    if (error) {
      console.warn("Could not delete completed watch links:", error.message);
    }
  } catch (err) {
    console.warn("cleanupFinishedWatchLinks error:", err);
  }
}

function brand(name) {
  if (/^cricfreex$/i.test(name || "")) {
    return `CRIC<span class="brand-red">FREEX</span>`;
  }

  return esc(name || "CricFreeX");
}

function liveChannelSections() {
  return sections.filter(s =>
    s.slug === "sports" ||
    /^live channels?$/i.test(s.name || "")
  );
}

function sectionName(item) {
  return item?.slug === "sports"
    ? "Live Channels"
    : item?.name || "Live Channels";
}

function safeURL(value) {
  if (!value) return null;

  try {
    const u = new URL(
      value,
      location.href
    );

    return [
      "https:",
      "http:"
    ].includes(u.protocol)
      ? u.href
      : null;

  } catch {
    return null;
  }
}

function embedURL(value) {
  const safe = safeURL(value);
  if (!safe) return null;

  const url = new URL(safe);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let videoId = "";

  if (host === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] || "";
  } else if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtube-nocookie.com"
  ) {
    videoId = url.searchParams.get("v") || "";
    if (!videoId) {
      const parts = url.pathname.split("/").filter(Boolean);
      if (["embed", "live", "shorts"].includes(parts[0])) {
        videoId = parts[1] || "";
      }
    }
  }

  if (videoId && /^[\w-]{6,}$/.test(videoId)) {
    const embed = new URL(
      `https://www.youtube-nocookie.com/embed/${videoId}`
    );
    const start = url.searchParams.get("start") ||
      url.searchParams.get("t");
    if (start) {
      const seconds = String(start).match(/^\d+/)?.[0];
      if (seconds) embed.searchParams.set("start", seconds);
    }
    return embed.href;
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const videoId = url.pathname.split("/").filter(Boolean).pop() || "";
    if (/^\d+$/.test(videoId)) {
      return `https://player.vimeo.com/video/${videoId}`;
    }
  }

  return url.href;
}

async function load() {
  try {
    const [a, b, c] = await Promise.all([
      db.from("site_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle(),

      db.from("sections")
        .select("*")
        .eq("published", true)
        .order("sort_order"),

      db.from("content")
        .select("*")
        .eq("published", true)
        .order("sort_order")
    ]);

    if (a.error) throw a.error;
    if (b.error) throw b.error;
    if (c.error) throw c.error;

    settings = a.data || null;
    sections = b.data || [];
    content = c.data || [];
    window.CRICFREEX_CONTENT = content;
    window.dispatchEvent(
      new CustomEvent(
        "cricfreex:content-updated",
        { detail: content }
      )
    );

    if (
      !sections.some(
        x => x.slug === section
      ) &&
      sections.length
    ) {
      section = sections[0].slug;
    }

    renderAll();
    cleanupFinishedWatchLinks();

  } catch (error) {
    console.error(error);
  }
}

function renderAll() {
  const name =
    settings?.site_name ||
    "CricFreeX";

  $("brandWord").innerHTML =
    brand(name);

  $("footerLogo").innerHTML =
    brand(name);

  const parts = (
    settings?.hero_title ||
    "YOUR GAME.|YOUR SCREEN."
  ).split("|");

  $("heroKicker").textContent =
    settings?.hero_kicker ||
    "CRICFREEX LIVE";

  $("heroTitle").innerHTML =
    `${esc(parts[0])}${parts[1]
      ? `<span>${esc(parts[1])}</span>`
      : ""
    }`;

  $("heroText").textContent =
    "Live scores, match details, series, rankings and cricket coverage—together in one place.";

  renderTabs();
  renderFilters();
  render();
}

function renderTabs() {
  if ($("mainTabs")) {
    $("mainTabs").replaceChildren();
    $("mainTabs").hidden = true;
  }
}

function renderFilters() {
  $("filters").replaceChildren();

  if (activeSeries) {
    $("filters").style.display = "none";
    return;
  }

  $("filters").style.display = "flex";

  const rawCats = [
    ...new Set(
      content
        .filter(
          x =>
            !isCricketWatchLink(x) &&
            !isSiteAccessItem(x) &&
            x.section_slug === section &&
            !x.parent_id
        )
        .map(x => x.category)
        .filter(Boolean)
    )
  ];

  // Separate non-"other" categories and "other" so "other" is always last
  const nonOther = [];
  let otherCat = null;
  for (const cat of rawCats) {
    if (String(cat).trim().toLowerCase() === "other") {
      otherCat = cat;
    } else {
      nonOther.push(cat);
    }
  }

  const categories = [
    "all",
    ...nonOther,
    ...(otherCat ? [otherCat] : [])
  ];

  categories.forEach(cat => {
    const b = document.createElement("button");

    b.className =
      "filter" +
      (
        filter === cat
          ? " active"
          : ""
      );

    b.textContent =
      cat === "all"
        ? "All"
        : cat;

    b.onclick = () => {
      filter = cat;
      renderFilters();
      render();
    };

    $("filters").append(b);
  });
}

function makeCard(item, label, meta) {
  const b = document.createElement("button");

  b.className =
    "channel-card" +
    (
      selected === item.id
        ? " selected"
        : ""
    );

  if (item.image_url) {
    const img = document.createElement("img");
    img.className = "channel-thumb";
    img.src = item.image_url;
    img.alt = "";
    img.loading = "lazy";
    b.append(img);
  }

  const top = document.createElement("div");
  top.className = "channel-top";

  const live = document.createElement("div");
  live.className = "channel-live";

  const dot = document.createElement("i");

  live.append(
    dot,
    document.createTextNode(label)
  );

  const category = document.createElement("div");
  category.className = "channel-category";
  category.textContent =
    item.category ||
    item.kind ||
    "";

  top.append(live, category);

  const name = document.createElement("div");
  name.className = "channel-name";
  name.textContent = item.title;
  name.title = item.title;
  b.title = item.title;

  const id = document.createElement("div");
  id.className = "channel-id";
  id.textContent =
    meta ||
    item.public_id ||
    "";

  b.append(top, name, id);

  return b;
}

function empty(text) {
  const e = document.createElement("div");
  e.className = "empty";
  e.textContent = text;
  $("channelGrid").append(e);
}

function render() {
  const q =
    $("search").value
      .trim()
      .toLowerCase();

  $("channelGrid").replaceChildren();

  if (activeSeries) {
    $("seriesBack").classList.add("show");

    $("kicker").textContent = "EPISODES";
    $("sectionTitle").textContent =
      activeSeries.title;

    const episodes = content.filter(x =>
      x.kind === "episode" &&
      x.parent_id === activeSeries.id &&
      (
        !q ||
        x.title
          ?.toLowerCase()
          .includes(q)
        ||
        x.public_id
          ?.toLowerCase()
          .includes(q)
      )
    );

    $("channelCount").textContent =
      `${episodes.length} episode${episodes.length === 1
        ? ""
        : "s"
      }`;

    if (!episodes.length) {
      empty("No episodes found.");
      return;
    }

    episodes.forEach(ep => {
      const b = makeCard(
        ep,
        "WATCH",
        `EPISODE ${ep.episode_number || ""
        }`
      );

      b.onclick = () => play(ep);

      $("channelGrid").append(b);
    });

    return;
  }

  $("seriesBack").classList.remove("show");

  const s = sections.find(
    x => x.slug === section
  );

  $("kicker").textContent =
    sectionName(s).toUpperCase();

  $("sectionTitle").textContent =
    sectionName(s);

  const list = content.filter(x =>
    !isCricketWatchLink(x) &&
    !isSiteAccessItem(x) &&
    x.section_slug === section &&
    !x.parent_id &&
    x.kind !== "episode" &&
    (
      filter === "all" ||
      x.category === filter
    ) &&
    (
      !q ||
      x.title
        ?.toLowerCase()
        .includes(q)
      ||
      x.public_id
        ?.toLowerCase()
        .includes(q)
    )
  );

  $("channelCount").textContent =
    `${list.length} item${list.length === 1 ? "" : "s"
    }`;

  if (!list.length) {
    empty("No content found.");
    return;
  }

  list.forEach(item => {
    const series =
      item.kind === "series";

    const count = series
      ? content.filter(
        x =>
          x.kind === "episode" &&
          x.parent_id === item.id
      ).length
      : 0;

    const b = makeCard(
      item,
      series ? "SERIES" : "LIVE",
      series
        ? `${count} EPISODES`
        : item.public_id
    );

    b.onclick = () =>
      series
        ? openSeries(item)
        : play(item);

    $("channelGrid").append(b);
  });
}

function clearURL() {
  const u = new URL(location.href);
  u.hash = "";

  [
    "channel",
    "show",
    "episode",
    "view",
    "cricket",
    "match",
    "tab",
    "server",
    "news",
    "series",
    "seriesTab",
    "team",
    "teamTab",
    "archive"
  ].forEach(
    key => u.searchParams.delete(key)
  );

  const path = cleanAppPath(u);
  const clean = u.searchParams.toString() ? `${path}?${u.searchParams.toString()}` : path;
  history.replaceState({}, "", clean);
}

function getIdentifier(item) {
  if (!item) return "";
  if (item.public_id && String(item.public_id).trim()) {
    return String(item.public_id).trim();
  }
  if (item.slug && String(item.slug).trim()) {
    return String(item.slug).trim();
  }
  if (item.title && String(item.title).trim()) {
    const slug = String(item.title)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (slug) return slug;
  }
  return String(item.id || "");
}

function updateURL(item) {
  const u = new URL(location.href);
  u.hash = "";

  [
    "channel",
    "show",
    "episode",
    "view",
    "cricket",
    "match",
    "tab",
    "server",
    "news",
    "series",
    "seriesTab",
    "team",
    "teamTab",
    "archive"
  ].forEach(
    key => u.searchParams.delete(key)
  );

  if (item.kind === "episode") {
    const parent = content.find(
      x => x.id === item.parent_id
    );

    const parentId = getIdentifier(parent);
    if (parentId) {
      u.searchParams.set("show", parentId);
    }

    const episodeId = getIdentifier(item);
    if (episodeId) {
      u.searchParams.set("episode", episodeId);
    }

  } else if (item.kind === "series") {
    const showId = getIdentifier(item);
    if (showId) {
      u.searchParams.set("show", showId);
    }

  } else {
    const channelId = getIdentifier(item);
    if (channelId) {
      u.searchParams.set("channel", channelId);
    }
  }

  const path = cleanAppPath(u);
  history.pushState(
    {},
    "",
    u.searchParams.toString() ? `${path}?${u.searchParams.toString()}` : path
  );
}

function openSeries(item, update = true) {
  activeSeries = item;
  section = item.section_slug;
  filter = "all";
  selected = "";
  $("search").value = "";

  if (update) {
    updateURL(item);
  }

  renderTabs();
  renderFilters();
  render();

  $("channels").scrollIntoView({
    behavior: "smooth"
  });
}

function play(item, update = true) {

  /* =========================================================
     BASIC PLAYER STATE
  ========================================================= */

  selected = item.id;

  /*
    Episode hai to uska parent show restore karo.
  */

  if (item.kind === "episode") {

    const parent = content.find(
      x =>
        x.id === item.parent_id &&
        x.kind === "series"
    );

    if (parent) {

      activeSeries = parent;

      section =
        parent.section_slug ||
        item.section_slug ||
        section;

    } else {

      section =
        item.section_slug ||
        section;

    }

  } else {

    section =
      item.section_slug ||
      section;

    activeSeries = null;
  }

  // Single Active Stream: Stop cricket match stream if running
  if (window.CricfreexCricket?.closeWatchPlayer) {
    window.CricfreexCricket.closeWatchPlayer(false);
  }

  /*
    Shareable URL update.
  */

  if (update) {
    updateURL(item);
  }

  setSiteMode("channels");

  /*
    Player information.
  */

  $("playingTitle").textContent =
    item.title;

  $("playingCategory").textContent =
    (
      item.category ||
      item.kind ||
      "CRICFREEX"
    ).toUpperCase();

  $("playingStatus").textContent =
    "LOADING";

  /*
    Keep currently selected card highlighted.
  */

  renderTabs();
  renderFilters();
  render();

  /*
    Validate media URL.
  */

  const url =
    safeURL(
      item.media_url
    );

  /*
    Completely clear previous player.
  */

  $("playerWrap")
    .replaceChildren();
  $("watch").hidden = false;

  if (!url) {

    $("playingStatus").textContent =
      "UNAVAILABLE";

    $("playerWrap").innerHTML =
      `
      <div class="player-empty">
        <div>
          <strong>
            Source not configured
          </strong>
          No media source is configured.
        </div>
      </div>
      `;

    $("watch").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    return;
  }

  /* =========================================================
     EXTERNAL STREAM / DOWNLOAD LINK
  ========================================================= */

  if (item.media_type === "link") {

    $("playingStatus").textContent =
      "LINK READY";

    const wrapper =
      document.createElement(
        "div"
      );

    wrapper.className =
      "link-player";

    const inner =
      document.createElement(
        "div"
      );

    inner.className =
      "link-player-inner";

    const icon =
      document.createElement(
        "div"
      );

    icon.className =
      "link-player-icon";

    icon.textContent = "↗";

    const heading =
      document.createElement(
        "h2"
      );

    heading.textContent =
      "Stream / Download Available";

    const message =
      document.createElement(
        "p"
      );

    message.textContent =
      "This content is available through an external link. Continue using the button below.";

    const openButton =
      document.createElement(
        "a"
      );

    openButton.className =
      "link-open-button";

    openButton.href = url;

    openButton.target =
      "_blank";

    openButton.rel =
      "noopener noreferrer";

    openButton.textContent = url;

    const note =
      document.createElement(
        "small"
      );

    note.className =
      "link-note";

    note.textContent =
      "The link will open in a new tab.";

    inner.append(
      icon,
      heading,
      message,
      openButton,
      note
    );

    wrapper.append(
      inner
    );

    $("playerWrap").append(
      wrapper
    );

    $("watch").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    return;
  }

  /* =========================================================
     HLS / M3U8
  ========================================================= */

  if (
    item.media_type === "hls" ||
    /\.m3u8($|\?)/i.test(url)
  ) {

    const video =
      document.createElement(
        "video"
      );

    video.className =
      "stream-video";

    video.controls = true;

    video.playsInline = true;

    video.autoplay = true;

    video.preload = "metadata";

    video.setAttribute(
      "controlsList",
      "nodownload"
    );

    /*
      Add video to player first.
    */

    $("playerWrap").append(
      video
    );

    /*
      Safari / iPhone / iPad
      have native HLS playback.
    */

    if (
      video.canPlayType(
        "application/vnd.apple.mpegurl"
      )
    ) {

      video.src = url;

      video.addEventListener(
        "loadedmetadata",
        () => {

          $("playingStatus").textContent =
            "NOW PLAYING";

          video.play()
            .catch(() => { });
        }
      );

      video.addEventListener(
        "error",
        () => {

          $("playingStatus").textContent =
            "ERROR";
        }
      );

    }

    /*
      Chrome / Edge / Android etc.
    */

    else if (
      window.Hls &&
      Hls.isSupported()
    ) {

      const hls =
        new Hls({

          enableWorker: true,

          lowLatencyMode: false,

          backBufferLength: 30

        });

      /*
        Keep reference on video.
      */

      video._hls =
        hls;

      hls.loadSource(
        url
      );

      hls.attachMedia(
        video
      );

      hls.on(
        Hls.Events.MANIFEST_PARSED,
        () => {

          $("playingStatus").textContent =
            "NOW PLAYING";

          video.play()
            .catch(() => { });
        }
      );

      hls.on(
        Hls.Events.ERROR,
        (
          event,
          data
        ) => {

          console.error(
            "HLS playback error:",
            data
          );

          /*
            Ignore recoverable errors.
          */

          if (!data.fatal) {
            return;
          }

          /*
            Network failure:
            attempt reconnect.
          */

          if (
            data.type ===
            Hls.ErrorTypes.NETWORK_ERROR
          ) {

            $("playingStatus").textContent =
              "RECONNECTING";

            hls.startLoad();

            return;
          }

          /*
            Media decode problem:
            attempt recovery.
          */

          if (
            data.type ===
            Hls.ErrorTypes.MEDIA_ERROR
          ) {

            $("playingStatus").textContent =
              "RECOVERING";

            hls.recoverMediaError();

            return;
          }

          /*
            Non-recoverable.
          */

          $("playingStatus").textContent =
            "ERROR";

          hls.destroy();
        }
      );

    } else {

      $("playingStatus").textContent =
        "UNSUPPORTED";

      $("playerWrap").innerHTML =
        `
        <div class="player-empty">
          <div>
            <strong>
              HLS unavailable
            </strong>
            This browser cannot play this stream.
          </div>
        </div>
        `;

    }

    $("watch").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    return;
  }

  /* =========================================================
     DIRECT MP4 / WEBM VIDEO
  ========================================================= */

  if (item.media_type === "video") {

    const video =
      document.createElement(
        "video"
      );

    video.className =
      "stream-video";

    video.controls = true;

    video.playsInline = true;

    video.autoplay = true;

    video.preload = "metadata";

    video.setAttribute(
      "controlsList",
      "nodownload"
    );

    video.addEventListener(
      "loadeddata",
      () => {

        $("playingStatus").textContent =
          "NOW PLAYING";
      }
    );

    video.addEventListener(
      "playing",
      () => {

        $("playingStatus").textContent =
          "NOW PLAYING";
      }
    );

    video.addEventListener(
      "waiting",
      () => {

        $("playingStatus").textContent =
          "BUFFERING";
      }
    );

    video.addEventListener(
      "error",
      () => {

        $("playingStatus").textContent =
          "ERROR";
      }
    );

    video.src = url;

    $("playerWrap").append(
      video
    );

    /*
      Autoplay may be blocked.
      That's normal; controls remain available.
    */

    video.play()
      .catch(() => { });

    $("watch").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    return;
  }

  /* =========================================================
     IFRAME / EMBED
  ========================================================= */

  const iframe =
    document.createElement(
      "iframe"
    );

  iframe.className =
    "stream-frame";

  iframe.title =
    item.title ||
    "CricFreeX Player";

  iframe.allow =
    "autoplay; encrypted-media; fullscreen; picture-in-picture";

  iframe.referrerPolicy =
    "strict-origin-when-cross-origin";

  // Anti-Redirect Sandbox: blocks ads/iframes from redirecting your website
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-presentation");

  $("playingStatus").textContent = "EMBED PLAYER";

  iframe.addEventListener(
    "error",
    () => {

      $("playingStatus").textContent =
        "ERROR";
    }
  );

  iframe.src = embedURL(url) || url;

  $("playerWrap").append(iframe);

  const embedNote = document.createElement("p");
  embedNote.className = "link-note";
  const sourceURL = new URL(url);
  const localSource = [
    "localhost",
    "127.0.0.1",
    "::1"
  ].includes(sourceURL.hostname);
  embedNote.textContent = localSource
    ? `This link points to ${sourceURL.host}. It only works when that service is running on the viewer's device. Use a reachable stream URL for other viewers.`
    : "⚡ If this channel is not loading or playing smoothly, please switch to another channel from the list.";
  if (localSource) {
    $("playingStatus").textContent = "LOCAL SOURCE";
  }
  $("playerWrap").append(embedNote);

  $("watch").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}




function openChannelsView(update = true) {
  const channelSections = liveChannelSections();
  section = channelSections[0]?.slug || sections[0]?.slug || "sports";
  filter = "all";
  activeSeries = null;
  $("search").value = "";
  setSiteMode("channels");
  renderTabs();
  renderFilters();
  render();
  if (update) {
    const u = new URL(location.href);
    [
      "channel", "show", "episode", "cricket", "match", "tab",
      "server", "news", "series", "seriesTab", "team", "teamTab", "archive"
    ].forEach(k => u.searchParams.delete(k));
    u.searchParams.set("view", "channels");
    u.hash = "";
    const path = cleanAppPath(u);
    history.pushState({}, "", `${path}?${u.searchParams.toString()}`);
  }
  $("channels").scrollIntoView({ behavior: "smooth", block: "start" });
}

function restoreURL() {
  const p = new URLSearchParams(location.search);
  const view = p.get("view");
  const tab = p.get("tab");

  if (location.hash === "#suggestion" || view === "suggestion" || tab === "request") {
    setTimeout(() => {
      $("suggestionSection")?.scrollIntoView({ behavior: "smooth", block: "center" });
      $("suggestionInput")?.focus();
    }, 400);
  }

  if (view === "channels") {
    openChannelsView(false);
    return;
  }

  const episodeId = p.get("episode");
  const channelId = p.get("channel");
  const showId = p.get("show");

  function matchItem(x, ref) {
    if (!x || !ref) return false;
    const clean = String(ref).toLowerCase().trim();
    if (x.public_id && String(x.public_id).toLowerCase().trim() === clean) return true;
    if (String(x.id).toLowerCase().trim() === clean) return true;
    if (x.slug && String(x.slug).toLowerCase().trim() === clean) return true;
    const titleSlug = String(x.title || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (titleSlug === clean) return true;
    return false;
  }

  if (episodeId) {
    const episode = content.find(
      x =>
        x.kind === "episode" &&
        matchItem(x, episodeId)
    );

    if (episode) {
      play(episode, false);
      return;
    }
  }

  if (channelId) {
    const channel = content.find(
      x =>
        x.kind !== "episode" &&
        x.kind !== "series" &&
        matchItem(x, channelId)
    );

    if (channel) {
      play(channel, false);
      return;
    }
  }

  if (showId) {
    const show = content.find(
      x =>
        x.kind === "series" &&
        matchItem(x, showId)
    );

    if (show) {
      openSeries(show, false);
    }
  }

  if (!view && !channelId && !episodeId && !showId) {
    setSiteMode("matches");
  }
}

window.addEventListener("popstate", () => {
  restoreURL();
});

$("seriesBack").onclick = () => {
  activeSeries = null;
  selected = "";
  filter = "all";
  $("search").value = "";
  clearURL();
  renderFilters();
  render();
};

$("search").oninput = render;

$("brand").onclick = () => {
  window.CricfreexCricket?.selectPage("live", true);
  window.scrollTo({ top: 0, behavior: "smooth" });
};

$("exploreButton").onclick = () => {
  setSiteMode("matches");
  window.CricfreexCricket?.selectPage("live", true);
  $("cricketCenter")?.scrollIntoView({ behavior: "smooth", block: "start" });
};

$("navCricket")?.addEventListener("click", event => {
  event.preventDefault();
  setSiteMode("matches");
  window.CricfreexCricket?.selectPage("live", true);
  $("cricketCenter")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

$("navChannels")?.addEventListener("click", event => {
  event.preventDefault();
  openChannelsView(true);
});

$("watchButton").onclick = () => {
  openChannelsView(true);
};

if ($("footerLogo")) {
  $("footerLogo").onclick = () => {
    window.CricfreexCricket?.selectPage("live", true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
}

$("adminEntry").onclick = () =>
  location.href = "./admin.html";

let timer = null;

function refresh() {
  clearTimeout(timer);

  timer = setTimeout(
    load,
    250
  );
}

db.channel("cricfreex-public")
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "site_settings"
    },
    refresh
  )
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "sections"
    },
    refresh
  )
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "content"
    },
    refresh
  )
  .subscribe();

/* =========================================================
   THEME TOGGLE
========================================================= */

function setupThemeToggle() {
  const toggleBtn = $("themeToggle");
  if (!toggleBtn) return;

  function updateTheme(theme) {
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
      try { localStorage.setItem("cricfreex_theme", "light"); } catch (e) { }
    } else {
      document.documentElement.removeAttribute("data-theme");
      try { localStorage.setItem("cricfreex_theme", "dark"); } catch (e) { }
    }
  }

  toggleBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    updateTheme(current === "light" ? "dark" : "light");
  });

  window.addEventListener("storage", event => {
    if (event.key === "cricfreex_theme") {
      updateTheme(event.newValue || "dark");
    }
  });
}

/* =========================================================
   ACTIVE USERS TRACKING (SUPABASE REALTIME PRESENCE)
========================================================= */

function initActiveUsersTracking() {
  const userCountEl = $("activeUserCount");
  if (!userCountEl) return;

  let clientId;
  try {
    clientId = sessionStorage.getItem("cricfreex_client_id");
  } catch (e) { }

  if (!clientId) {
    clientId = "cx_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now();
    try { sessionStorage.setItem("cricfreex_client_id", clientId); } catch (e) { }
  }

  function renderCount(num) {
    const safeCount = Math.max(1, Number(num) || 1);
    if (userCountEl) {
      userCountEl.textContent = safeCount;
    }
  }

  renderCount(1);

  try {
    const presenceChannel = db.channel("cricfreex-presence", {
      config: { presence: { key: clientId } }
    });

    const updateFromState = () => {
      try {
        const state = presenceChannel.presenceState();
        const keys = Object.keys(state || {});
        let total = 0;
        keys.forEach(k => {
          total += Array.isArray(state[k]) ? state[k].length : 1;
        });
        renderCount(total);
      } catch (err) {
        renderCount(1);
      }
    };

    presenceChannel
      .on("presence", { event: "sync" }, updateFromState)
      .on("presence", { event: "join" }, updateFromState)
      .on("presence", { event: "leave" }, updateFromState)
      .subscribe(async status => {
        if (status === "SUBSCRIBED") {
          try {
            await presenceChannel.track({
              online_at: Date.now(),
              client: clientId
            });
          } catch (e) { }
        }
      });

    // Heartbeat every 40s (keeps connection & active count refreshed)
    window.setInterval(async () => {
      try {
        if (presenceChannel && presenceChannel.state === "joined") {
          await presenceChannel.track({
            online_at: Date.now(),
            client: clientId
          });
        }
      } catch (e) { }
    }, 40000);

    // Keep active when entering/exiting fullscreen (e.g. iframe match viewing)
    document.addEventListener("fullscreenchange", () => {
      try {
        if (presenceChannel && presenceChannel.state === "joined") {
          presenceChannel.track({
            online_at: Date.now(),
            client: clientId,
            fullscreen: Boolean(document.fullscreenElement)
          });
        }
      } catch (e) { }
    });

    window.addEventListener("beforeunload", () => {
      try { presenceChannel.untrack(); } catch (e) { }
    });
  } catch (err) {
    console.warn("Presence tracking fallback:", err);
    renderCount(1);
  }
}

/* =========================================================
   SUGGESTION / REQUEST BOX
========================================================= */

function countWords(str) {
  return (str || "").trim().split(/\s+/).filter(Boolean).length;
}

function initSuggestionBox() {
  const form = $("suggestionForm");
  const input = $("suggestionInput");
  const countEl = $("suggestionWordCount");
  const alertEl = $("suggestionAlert");
  const btn = $("suggestionSubmitBtn");
  const section = $("suggestionSection");

  if (!form || !input || !countEl || !alertEl || !btn) return;

  function updateSuggestionURL() {
    const p = new URLSearchParams(location.search);
    if (p.get("view") !== "suggestion") {
      const u = new URL(location.href);
      [
        "channel", "show", "episode", "match", "tab",
        "server", "news", "series", "seriesTab", "team", "teamTab", "archive"
      ].forEach(k => u.searchParams.delete(k));
      u.searchParams.set("view", "suggestion");
      u.hash = "";
      const path = cleanAppPath(u);
      history.pushState({}, "", `${path}?${u.searchParams.toString()}`);
    }
  }

  section?.addEventListener("click", () => {
    updateSuggestionURL();
  });

  input.addEventListener("focus", () => {
    updateSuggestionURL();
  });

  function updateCount() {
    const words = countWords(input.value);
    const isValid = words >= 5 && words <= 100;
    countEl.textContent = `${words} word${words === 1 ? "" : "s"} `;

    const hint = document.createElement("span");
    hint.className = "suggestion-hint";
    hint.textContent = "(min 5, max 100)";
    countEl.appendChild(hint);

    countEl.classList.toggle("is-valid", isValid);
    countEl.classList.toggle("is-invalid", words > 0 && !isValid);
  }

  input.addEventListener("input", () => {
    updateCount();
    if (alertEl.classList.contains("show")) {
      alertEl.className = "suggestion-alert";
      alertEl.textContent = "";
    }
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const text = input.value.trim();
    const words = countWords(text);

    if (words < 5) {
      alertEl.className = "suggestion-alert show is-error";
      alertEl.textContent = "Please enter at least 5 words to describe your request or suggestion.";
      input.focus();
      return;
    }

    if (words > 100) {
      alertEl.className = "suggestion-alert show is-error";
      alertEl.textContent = "Word limit exceeded. Maximum 100 words allowed.";
      input.focus();
      return;
    }

    btn.disabled = true;
    const btnSpan = btn.querySelector("span");
    if (btnSpan) btnSpan.textContent = "Sending...";
    alertEl.className = "suggestion-alert";
    alertEl.textContent = "";

    let saved = false;

    // 1. Try Supabase insert if table exists
    try {
      if (db) {
        const { error } = await db.from("suggestions").insert({
          message: text,
          word_count: words
        });
        if (!error) saved = true;
      }
    } catch (e) {
      console.warn("Supabase suggestion insert error:", e);
    }

    // 2. Dual-save to backend API (/api/suggestions)
    const endpoints = [];
    if (location.origin && location.origin.startsWith("http")) {
      endpoints.push(`${location.origin}/api/suggestions`);
    }
    endpoints.push("/api/suggestions");
    const configuredApi = String(C?.CRICKET_API_URL || window.CRICFREEX_CONFIG?.CRICKET_API_URL || "").replace(/\/+$/, "");
    if (configuredApi && !endpoints.includes(`${configuredApi}/api/suggestions`)) {
      endpoints.push(`${configuredApi}/api/suggestions`);
    }

    for (const url of endpoints) {
      if (saved) break;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, word_count: words })
        });
        if (res.ok) {
          saved = true;
          break;
        }
      } catch (e) { }
    }

    btn.disabled = false;
    if (btnSpan) btnSpan.textContent = "Send Request";

    if (saved) {
      input.value = "";
      updateCount();
      alertEl.className = "suggestion-alert show is-success";
      alertEl.textContent = "✓ Thank you! Your request has been sent to the admin team.";
      setTimeout(() => {
        alertEl.classList.remove("show");
      }, 7000);
    } else {
      alertEl.className = "suggestion-alert show is-error";
      alertEl.textContent = "Could not send your request right now. Please check your connection and try again.";
    }
  });

  updateCount();
}

function closeChannelPlayer(update = true) {
  const wrap = $("playerWrap");
  if (wrap) {
    const media = wrap.querySelectorAll("iframe, video");
    media.forEach(el => {
      try {
        if (el.tagName === "VIDEO") {
          el.pause();
          el.removeAttribute("src");
          el.load();
        } else {
          el.src = "about:blank";
        }
      } catch (e) {}
    });
    wrap.replaceChildren();
    wrap.innerHTML = `
      <div class="player-empty">
        <div><strong>Choose your content</strong>Select an available channel or episode above.</div>
      </div>
    `;
  }
  $("watch").hidden = true;
  $("playingTitle").textContent = "Select something to watch";
  $("playingStatus").textContent = "READY";
  selected = "";
  render();

  if (update) {
    const u = new URL(location.href);
    ["channel", "show", "episode"].forEach(k => u.searchParams.delete(k));
    u.searchParams.set("view", "channels");
    const path = cleanAppPath(u);
    history.pushState({}, "", `${path}?${u.searchParams.toString()}`);
  }
}

function initChannelClose() {
  const btn = $("channelCloseBtn");
  if (btn) {
    btn.onclick = () => {
      closeChannelPlayer(true);
    };
  }

  window.addEventListener("cricfreex:stop-channel-stream", () => {
    closeChannelPlayer(true);
  });

  window.CricfreexApp = { closeChannelPlayer, openChannelsView };
}

/* =========================================================
   SITE ACCESS / PASSWORD GATEKEEPER
========================================================= */

let siteAccessConfig = {
  enabled: true,
  password: "CRIC",
  telegram_url: "https://t.me/+FIO2pSdFBRBkNDZl",
  delay_seconds: 3
};

let siteAccessUnlocked = false;
let gateTimer = null;

function isSiteUnlocked() {
  if (!siteAccessConfig.enabled || !siteAccessConfig.password) return true;
  return siteAccessUnlocked;
}
window.isSiteUnlocked = isSiteUnlocked;

async function fetchSiteAccessConfig() {
  let item = (content || []).find(isSiteAccessItem);

  if (!item && db) {
    try {
      const { data } = await db.from("content")
        .select("*")
        .eq("public_id", SITE_ACCESS_PREFIX)
        .maybeSingle();
      if (data) item = data;
    } catch (e) {}
  }

  if (item) {
    siteAccessConfig = {
      enabled: item.published !== false,
      password: String(item.title || "").trim(),
      telegram_url: String(item.media_url || "https://t.me/+FIO2pSdFBRBkNDZl").trim(),
      delay_seconds: Math.max(1, Math.min(60, parseInt(item.sort_order || 3, 10)))
    };
    return siteAccessConfig;
  }

  try {
    const endpoints = [];
    if (C.CRICKET_API_URL) endpoints.push(`${C.CRICKET_API_URL}/api/access-control`);
    endpoints.push("/api/access-control");

    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, { headers: { Accept: "application/json" } });
        if (res.ok) {
          const json = await res.json();
          if (json && json.password) {
            siteAccessConfig = {
              enabled: json.enabled !== false,
              password: String(json.password || "").trim(),
              telegram_url: String(json.telegram_url || "https://t.me/+FIO2pSdFBRBkNDZl").trim(),
              delay_seconds: Math.max(1, Math.min(60, parseInt(json.delay_seconds || 3, 10)))
            };
            return siteAccessConfig;
          }
        }
      } catch (e) {}
    }
  } catch (e) {}

  return siteAccessConfig;
}

function initSiteAccessGate() {
  const modal = document.getElementById("siteAccessModal");
  if (!modal) return;

  const form = document.getElementById("siteAccessForm");
  const input = document.getElementById("gatePasswordInput");
  const submitBtn = document.getElementById("gateSubmitBtn");
  const tgBtn = document.getElementById("gateTelegramBtn");
  const errorMsg = document.getElementById("gateErrorMsg");
  const card = document.getElementById("siteAccessCard");

  function showGate() {
    if (isSiteUnlocked()) return;
    modal.hidden = false;
    modal.removeAttribute("hidden");
    document.body.classList.add("site-access-locked");

    try {
      const channelIframe = document.querySelector("#channelPlayer iframe");
      if (channelIframe && !channelIframe.dataset.paused) {
        channelIframe.dataset.paused = "true";
      }
      const cricketIframe = document.querySelector("#cricketWatchPlayer iframe");
      if (cricketIframe && !cricketIframe.dataset.paused) {
        cricketIframe.dataset.paused = "true";
      }
    } catch (e) {}

    setTimeout(() => {
      input?.focus();
    }, 150);
  }

  function hideGate() {
    modal.hidden = true;
    modal.setAttribute("hidden", "");
    document.body.classList.remove("site-access-locked");
  }

  function checkStoredAuth() {
    if (!siteAccessConfig.enabled || !siteAccessConfig.password) {
      siteAccessUnlocked = true;
      hideGate();
      return true;
    }

    // Strictly session-based: When the website/tab is closed, session is wiped
    try { localStorage.removeItem("cricfreex_auth_pass"); } catch (e) {}
    const stored = (sessionStorage.getItem("cricfreex_auth_pass") || "").trim();
    if (stored && stored.toLowerCase() === siteAccessConfig.password.toLowerCase()) {
      siteAccessUnlocked = true;
      hideGate();
      return true;
    }

    siteAccessUnlocked = false;
    return false;
  }

  async function syncAndSchedule() {
    await fetchSiteAccessConfig();

    if (tgBtn && siteAccessConfig.telegram_url) {
      tgBtn.href = siteAccessConfig.telegram_url;
    }
    document.querySelectorAll(".telegram-banner-btn").forEach(btn => {
      if (siteAccessConfig.telegram_url) btn.href = siteAccessConfig.telegram_url;
    });

    const alreadyAuth = checkStoredAuth();
    if (alreadyAuth) return;

    if (gateTimer) clearTimeout(gateTimer);
    const delayMs = (siteAccessConfig.delay_seconds || 3) * 1000;
    gateTimer = setTimeout(showGate, delayMs);
  }

  function clearError() {
    if (!errorMsg) return;
    errorMsg.textContent = "";
    errorMsg.className = "site-access-error hidden";
    errorMsg.style.display = "none";
  }

  function showError(msg) {
    if (!errorMsg) return;
    errorMsg.textContent = msg;
    errorMsg.className = "site-access-error visible";
    errorMsg.style.display = "block";
  }

  function verifyPassword() {
    const val = (input?.value || "").trim();
    if (!val) {
      showError("Please enter the access password.");
      input?.focus();
      return;
    }

    const expected = (siteAccessConfig.password || "").trim();
    if (val.toLowerCase() === expected.toLowerCase()) {
      siteAccessUnlocked = true;
      try {
        sessionStorage.setItem("cricfreex_auth_pass", expected);
        localStorage.removeItem("cricfreex_auth_pass");
      } catch (e) {}

      if (errorMsg) {
        errorMsg.textContent = "✅ Password verified! Unlocking website...";
        errorMsg.className = "site-access-error visible success";
        errorMsg.style.display = "block";
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Access Granted!</span>';

      setTimeout(() => {
        hideGate();
        clearError();
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg><span>Unlock Live Stream</span>';
      }, 650);
    } else {
      showError("Invalid password. Please get today's password from our Telegram channel and try again.");
      if (card) {
        card.classList.remove("gate-shake");
        void card.offsetWidth;
        card.classList.add("gate-shake");
      }
      input?.focus();
      input?.select();
    }
  }

  input?.addEventListener("input", () => {
    clearError();
  });

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    verifyPassword();
  });

  submitBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    verifyPassword();
  });

  window.addEventListener("keydown", (e) => {
    if (!isSiteUnlocked() && !modal.hidden) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }, true);

  if (window.MutationObserver) {
    const observer = new MutationObserver(() => {
      if (!isSiteUnlocked()) {
        if (modal.hidden || modal.hasAttribute("hidden") || modal.style.display === "none") {
          modal.hidden = false;
          modal.removeAttribute("hidden");
          modal.style.removeProperty("display");
          document.body.classList.add("site-access-locked");
        }
      }
    });
    observer.observe(modal, { attributes: true, attributeFilter: ["hidden", "style", "class"] });
  }

  // Pre-schedule 3 seconds default
  gateTimer = setTimeout(showGate, 3000);

  // Sync configuration from db/api and listen for updates
  syncAndSchedule();
  window.addEventListener("cricfreex:content-updated", () => {
    syncAndSchedule();
  });
  setInterval(() => {
    syncAndSchedule();
  }, 20000);
}

async function start() {
  setupThemeToggle();
  initActiveUsersTracking();
  initSuggestionBox();
  initChannelClose();
  initSiteAccessGate();
  await load();

  // Re-sync with loaded content
  if (typeof fetchSiteAccessConfig === "function") {
    fetchSiteAccessConfig();
  }

  if (!restored) {
    restored = true;
    restoreURL();
  }

  setInterval(cleanupFinishedWatchLinks, 30000);
}

start();