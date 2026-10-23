"use strict";

(() => {
  const config = window.CRICFREEX_CONFIG || {};
  const apiBase = String(config.CRICKET_API_URL || "").replace(/\/+$/, "");
  const root = document.getElementById("cricketCenter");
  const channelSection = document.getElementById("channels");
  const watchPlayer = document.getElementById("cricketWatchPlayer");
  const tabs = [
    ["live", "Live"],
    ["recent", "Results"],
    ["upcoming", "Upcoming"],
    ["news", "News"],
    ["series", "Series"],
    ["archives", "Archives"],
    ["teams", "Teams"],
    ["stats", "Stats & Rankings"],
    ["records", "Records"]
  ];
  const state = {
    page: "live",
    query: "",
    matches: [],
    returnPage: "live",
    teamPath: "",
    teamTitle: "",
    teamTab: "schedule",
    teamReturnItem: null,
    archiveYearOpen: false,
    archiveItem: null,
    pageItem: null,
    seriesPath: "",
    seriesTitle: "",
    seriesReturnPage: "series",
    seriesTab: "matches",
    articleReturn: null,
    request: 0,
    selectedMatch: null,
    scorecardInning: 0,
    activeWatch: null,
    ranking: {
      gender: "men",
      format: "odi",
      category: "batting"
    },
    records: {
      category: "Batting",
      record: "mostRuns",
      format: "1",
      year: "all",
      team: "all",
      opponent: "all"
    }
  };
  const watchLinkPrefix = "__cricket_watch__:";
  let watchLinks = (window.CRICFREEX_CONTENT || []).filter(item =>
    String(item.category || "").startsWith(watchLinkPrefix)
  );

  if (!root || !channelSection) return;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text ?? "");
    return node;
  };

  const apiURL = path => `${apiBase}${path}`;

  function embedSourceURL(value) {
    const url = new URL(value);
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
      const start = url.searchParams.get("start") || url.searchParams.get("t");
      const seconds = String(start || "").match(/^\d+/)?.[0];
      if (seconds) embed.searchParams.set("start", seconds);
      return embed.href;
    }

    if (host === "vimeo.com" || host === "player.vimeo.com") {
      videoId = url.pathname.split("/").filter(Boolean).pop() || "";
      if (/^\d+$/.test(videoId)) {
        return `https://player.vimeo.com/video/${videoId}`;
      }
    }

    return url.href;
  }

  async function request(path) {
    let response;
    try {
      response = await fetch(apiURL(path), {
        headers: { Accept: "application/json" }
      });
    } catch {
      throw new Error(
        "Cannot reach the cricket data service. Start CricFreeX with start-cricfreex.bat and open http://127.0.0.1:8765."
      );
    }
    let result;

    try {
      result = await response.json();
    } catch {
      throw new Error(
        response.ok
          ? "The cricket service returned an unreadable response."
          : `Cricket data is unavailable (HTTP ${response.status}).`
      );
    }

    if (!response.ok) {
      const detail = typeof result.detail === "string"
        ? result.detail
        : `HTTP ${response.status}`;
      throw new Error(detail);
    }

    if (result.success === false) {
      throw new Error(result.detail || "Cricket data could not be loaded.");
    }

    return result;
  }

  function showMessage(message, kind = "empty") {
    const box = element("div", `cricket-message ${kind}`, message);
    (root.querySelector(".cricket-content") || root).appendChild(box);
    return box;
  }

  function matchSearchText(match) {
    return [
      match.series,
      match.description,
      match.format,
      match.status,
      match.team1?.teamName,
      match.team1?.teamSName,
      match.team2?.teamName,
      match.team2?.teamSName,
      match.venue?.ground,
      match.venue?.city
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function isLiveMatch(match) {
    return [
      "in progress",
      "live",
      "toss",
      "stumps",
      "lunch",
      "tea",
      "innings break",
      "drinks",
      "rain delay",
      "delayed"
    ].includes(String(match.state || "").trim().toLowerCase());
  }

  function matchCard(match, onSelect, allowWatchLinks) {
    const card = element("article", "cricket-match-card");
    const summary = element("button", "cricket-match-main");
    summary.type = "button";
    summary.addEventListener("click", onSelect);

    const top = element("div", "cricket-match-top");
    top.append(
      element(
        "span",
        "cricket-match-series",
        [match.series, match.description].filter(Boolean).join(" · ")
      ),
      element(
        "span",
        `cricket-state ${isLiveMatch(match) ? "is-live" : ""}`,
        match.state || "Match"
      )
    );

    const teams = element("div", "cricket-match-teams");
    [match.team1, match.team2].forEach((team, index) => {
      const score = match.score?.[index === 0 ? "team1Score" : "team2Score"];
      const scoreText = score && Object.keys(score).length
        ? Object.values(score).map(innings =>
          `${innings.runs ?? 0}/${innings.wickets ?? 0} (${innings.overs ?? 0})`
        ).join(" & ")
        : "Yet to bat";
      const row = element("div", "cricket-team-row");
      row.append(
        element("span", "cricket-team-name", team?.teamName || team?.teamSName || "Team"),
        element("strong", "cricket-team-score", scoreText)
      );
      teams.appendChild(row);
    });

    const status = element(
      "p",
      "cricket-match-status",
      match.status || match.state || "Match details"
    );
    const venue = [
      match.format,
      match.venue?.ground,
      match.venue?.city
    ].filter(Boolean).join(" · ");

    summary.append(top, teams, status);
    if (venue) summary.appendChild(element("div", "cricket-match-meta", venue));
    card.appendChild(summary);

    const matchLinks = allowWatchLinks
      ? watchLinks.filter(item =>
        String(item.category).slice(watchLinkPrefix.length) === String(match.id)
      ).sort((left, right) =>
        Number(left.sort_order || 0) - Number(right.sort_order || 0)
      ).slice(0, 3)
      : [];
    const validLinks = matchLinks.flatMap(item => {
      try {
        const url = new URL(item.media_url);
        if (!["http:", "https:"].includes(url.protocol)) return [];
        return [{ item, url: embedSourceURL(url.href), sourceURL: url.href }];
      } catch {
        return [];
      }
    });
    if (validLinks.length) {
      const links = element("div", "cricket-watch-links");
      links.appendChild(element("strong", "cricket-watch-label", "Watch Live"));
      validLinks.forEach(({ url, sourceURL }, index) => {
        const serverLabel = `Server ${index + 1}`;
        const button = element("button", "cricket-watch-link", `▶ ${serverLabel}`);
        button.type = "button";
        button.setAttribute(
          "aria-label",
          `${serverLabel} for ${match.team1?.teamName || "Team 1"} vs ${match.team2?.teamName || "Team 2"}`
        );
        const selected = state.activeWatch?.match.id === match.id &&
          state.activeWatch.serverIndex === index;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
        button.addEventListener("click", event => {
          event.stopPropagation();
          state.activeWatch = {
            match,
            serverIndex: index,
            serverLabel,
            url,
            sourceURL
          };
          renderWatchPlayer();
          root.querySelectorAll(".cricket-watch-link").forEach(serverButton => {
            serverButton.classList.toggle(
              "is-selected",
              serverButton === button
            );
            serverButton.setAttribute(
              "aria-pressed",
              String(serverButton === button)
            );
          });
          watchPlayer?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        links.appendChild(button);
      });
      card.appendChild(links);
    }
    return card;
  }

  function renderWatchPlayer() {
    if (!watchPlayer) return;
    watchPlayer.replaceChildren();
    const active = state.activeWatch;
    watchPlayer.hidden = !active;
    if (!active) return;

    const head = element("div", "cricket-watch-player-head");
    const title = element("div", "cricket-watch-player-copy");
    title.append(
      element("span", "cricket-kicker", "CRICFREEX · LIVE PLAYER"),
      element(
        "h2",
        "cricket-watch-player-title",
        [
          active.match.team1?.teamName || "Team 1",
          "vs",
          active.match.team2?.teamName || "Team 2"
        ].join(" ")
      ),
      element(
        "p",
        "cricket-watch-player-meta",
        [
          active.match.series,
          active.match.description,
          active.match.venue?.ground,
          active.match.venue?.city
        ].filter(Boolean).join(" · ")
      )
    );
    const close = element("button", "cricket-action-button", "Close player");
    close.type = "button";
    close.addEventListener("click", () => {
      state.activeWatch = null;
      renderWatchPlayer();
      root.querySelectorAll(".cricket-watch-link").forEach(button => {
        button.classList.remove("is-selected");
        button.setAttribute("aria-pressed", "false");
      });
    });
    head.append(title, close);

    const server = element(
      "div",
      "cricket-watch-player-server",
      `${active.serverLabel} selected`
    );
    const frame = document.createElement("iframe");
    frame.className = "cricket-watch-frame";
    frame.src = active.url;
    frame.title = `${active.serverLabel} · ${active.match.team1?.teamName || "Team 1"} vs ${active.match.team2?.teamName || "Team 2"}`;
    frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    watchPlayer.append(
      head,
      server,
      frame,
      element(
        "p",
        "cricket-watch-note",
        "This server may not allow embedded playback."
      )
    );
  }

  function filtered(items, textFor = item => item.title || "") {
    const query = state.query.trim().toLowerCase();
    return query
      ? items.filter(item => textFor(item).toLowerCase().includes(query))
      : items;
  }

  function renderMatchList(matches, onSelect, noMatchesMessage) {
    const list = filtered(matches, matchSearchText);
    if (!list.length) {
      showMessage(
        matches.length
          ? "No matches match your search."
          : noMatchesMessage
      );
      return;
    }

    const grid = element("div", "cricket-match-grid");
    list.forEach(match => {
      grid.appendChild(matchCard(
        match,
        () => onSelect(match),
        ["live", "upcoming"].includes(state.page)
      ));
    });
    (root.querySelector(".cricket-content") || root).appendChild(grid);
  }

  function directoryCard(item, label, onClick) {
    const card = element("button", "cricket-directory-card");
    card.type = "button";
    card.append(
      element("span", "cricket-directory-label", label),
      element("span", "cricket-directory-title", item.title),
      element("span", "cricket-directory-action", "View details →")
    );
    card.addEventListener("click", onClick);
    return card;
  }

  function renderDirectory(items, label, onClick, emptyText) {
    const list = filtered(items, item => `${item.title} ${item.path || ""}`);
    if (!list.length) {
      showMessage(items.length ? "No results match your search." : emptyText);
      return;
    }
    const grid = element("div", "cricket-directory-grid");
    list.forEach(item => grid.appendChild(directoryCard(
      item,
      label,
      () => onClick(item)
    )));
    (root.querySelector(".cricket-content") || root).appendChild(grid);
    (root.querySelector(".cricket-content") || root).appendChild(
      element("p", "cricket-count", `${list.length} items`)
    );
  }

  function addTable(headers, rows) {
    const wrapper = element("div", "cricket-table-wrap");
    const table = element("table", "cricket-table");
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headers.forEach(value => headerRow.appendChild(element("th", "", value)));
    head.appendChild(headerRow);
    table.appendChild(head);
    const body = document.createElement("tbody");
    rows.forEach(row => {
      const tr = document.createElement("tr");
      row.forEach(value => tr.appendChild(element("td", "", value ?? "—")));
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrapper.appendChild(table);
    (root.querySelector(".cricket-content") || root).appendChild(wrapper);
  }

  function renderGenericPage(data, emptyText) {
    const content = root.querySelector(".cricket-content") || root;
    (data.headings || []).forEach(title =>
      content.appendChild(element("h3", "cricket-section-heading", title))
    );

    (data.tables || []).forEach(rows => {
      if (!Array.isArray(rows) || !rows.length) return;
      const [headers, ...body] = rows;
      addTable(headers.map(String), body);
    });

    (data.paragraphs || []).forEach(text =>
      content.appendChild(element("p", "cricket-copy", text))
    );

    if (
      !(data.headings || []).length &&
      !(data.tables || []).length &&
      !(data.paragraphs || []).length
    ) {
      showMessage(data.emptyMessage || emptyText);
    }
  }

  function makeToolbar() {
    const toolbar = element("div", "cricket-toolbar");
    const searchLabel = element("label", "cricket-search-label", "Search");
    const search = document.createElement("input");
    search.type = "search";
    search.maxLength = 100;
    search.placeholder = "Search teams, series, venue or country…";
    search.value = state.query;
    search.setAttribute("aria-label", "Search cricket information");
    search.addEventListener("input", () => {
      state.query = search.value;
      if (
        (state.page === "page" && state.returnPage === "teams") ||
        state.archiveYearOpen
      ) {
        filterCurrentDirectory();
      } else {
        renderPageContent();
      }
    });
    searchLabel.appendChild(search);
    const refresh = element("button", "cricket-action-button", "Refresh");
    refresh.type = "button";
    refresh.addEventListener("click", () => {
      if (state.archiveYearOpen && state.archiveItem) {
        openArchiveYear(state.archiveItem);
      } else if (
        state.page === "page" &&
        state.returnPage === "teams" &&
        state.pageItem
      ) {
        openPage(state.pageItem, "teams");
      } else {
        renderPageContent(true);
      }
    });
    toolbar.append(searchLabel, refresh);
    return toolbar;
  }

  function filterCurrentDirectory() {
    const content = root.querySelector(".cricket-content");
    if (!content) return;
    const query = state.query.trim().toLowerCase();
    const cards = [...content.querySelectorAll(".cricket-directory-card")];
    let visible = 0;

    cards.forEach(card => {
      const matches = !query || card.textContent.toLowerCase().includes(query);
      card.hidden = !matches;
      if (matches) visible += 1;
    });

    let empty = content.querySelector(".cricket-local-search-empty");
    if (cards.length && !visible) {
      if (!empty) {
        empty = element(
          "div",
          "cricket-message cricket-local-search-empty",
          "No results match your search."
        );
        content.appendChild(empty);
      }
    } else {
      empty?.remove();
    }

    const count = content.querySelector(".cricket-count");
    if (count) {
      count.textContent = `${visible} of ${cards.length} items`;
    }
  }

  function renderShell() {
    root.replaceChildren();
    const head = element("div", "cricket-header");
    const heading = element("div", "cricket-header-copy");
    heading.append(
      element("div", "cricket-kicker", "CRICFREEX · MATCH CENTRE"),
      element("h2", "cricket-title", "Cricket, live and in-depth"),
      element(
        "p",
        "cricket-subtitle",
        "Scores, fixtures, scorecards, squads, standings and match news."
      )
    );
    head.append(heading);
    const navigation = element("div", "cricket-tabs");
    tabs.forEach(([key, label]) => {
      const button = element("button", "cricket-tab", label);
      button.type = "button";
      button.classList.toggle("active", state.page === key);
      button.setAttribute("aria-pressed", String(state.page === key));
      button.addEventListener("click", () => {
        state.page = key;
        state.query = "";
        renderCenter();
        renderPageContent();
      });
      navigation.appendChild(button);
    });
    root.append(head, navigation);
    if (
      state.page !== "match" &&
      state.page !== "article" &&
      state.page !== "series-matches" &&
      state.page !== "team" &&
      (state.page !== "page" || state.returnPage === "teams")
    ) {
      root.appendChild(makeToolbar());
    }
    root.appendChild(element("div", "cricket-content"));
  }

  function setLoading(message = "Loading cricket data…") {
    renderShell();
    root.querySelector(".cricket-content").appendChild(
      element("div", "cricket-message is-loading", message)
    );
  }

  function renderCenter() {
    renderShell();
  }

  async function loadMatches(category, requestId) {
    const result = await request(`/api/matches/${category}`);
    if (requestId !== state.request) return;
    const matches = result.matches || [];
    state.matches = matches;
    renderMatchList(
      matches,
      match => openMatch(match, category),
      category === "upcoming"
        ? "There are no upcoming matches listed right now."
        : category === "recent"
          ? "No recent match records are available right now."
          : "No live matches are available right now."
    );
    root.querySelector(".cricket-content")?.prepend(
      element("p", "cricket-count", `${filtered(matches, matchSearchText).length} of ${matches.length} matches`)
    );
  }

  async function loadSection(name, label, emptyText, requestId) {
    const result = await request(`/api/section/${name}`);
    if (requestId !== state.request) return;
    renderDirectory(
      result.data?.links || [],
      label,
      item => openDirectoryItem(item, name),
      emptyText
    );
  }

  async function openSeries(item, returnPage = "series", tab = "matches") {
    state.archiveYearOpen = false;
    state.returnPage = returnPage;
    state.seriesReturnPage = returnPage;
    state.seriesPath = item.path.replace(/\/(?:matches|squads|stats|news|venues)\/?$/, "");
    state.seriesTitle = item.title || "Series";
    state.seriesTab = tab;
    state.page = "series-matches";
    state.query = "";
    renderCenter();
    setLoading(`Loading ${tab} for ${state.seriesTitle}…`);
    const requestId = ++state.request;
    try {
      const result = await request(
        `/api/series?path=${encodeURIComponent(state.seriesPath)}&tab=${tab}`
      );
      if (requestId !== state.request) return;
      renderShell();
      const content = root.querySelector(".cricket-content");
      content.appendChild(backButton("Back to series", () => {
        state.page = state.seriesReturnPage;
        renderCenter();
        renderPageContent();
      }));
      content.appendChild(element(
        "h3",
        "cricket-section-heading",
        result.data?.title || state.seriesTitle
      ));
      const navigation = element("div", "cricket-tabs cricket-match-tabs");
      [
        ["matches", "Matches"],
        ["stats", "Stats"],
        ["squads", "Squads"],
        ["news", "News"],
        ["venues", "Venues"]
      ].forEach(([key, label]) => {
        const button = element("button", "cricket-tab", label);
        button.type = "button";
        button.classList.toggle("active", tab === key);
        button.addEventListener("click", () =>
          openSeries(
            { title: state.seriesTitle, path: state.seriesPath },
            state.seriesReturnPage,
            key
          )
        );
        navigation.appendChild(button);
      });
      content.appendChild(navigation);
      if (tab === "matches") {
        renderMatchList(
          result.matches || [],
          match => openMatch(match, "series-matches"),
          "No fixtures are available for this series right now."
        );
      } else {
        const data = result.data || {};
        const hasStructuredData = Boolean(
          data.headings?.length ||
          data.tables?.length ||
          data.paragraphs?.length
        );
        if (hasStructuredData) {
          renderGenericPage(data, `Series ${tab} are not available right now.`);
        }
        if (
          data.links?.length &&
          (tab === "news" || !hasStructuredData)
        ) {
          renderDirectory(
            data.links,
            `Series ${tab}`,
            item => tab === "news"
              ? openArticle(item)
              : openPage(item, "series-matches"),
            `No ${tab} are listed for this series.`
          );
        } else if (!hasStructuredData) {
          showMessage(`Series ${tab} are not available right now.`);
        }
      }
    } catch (error) {
      if (requestId === state.request) showMessage(error.message, "is-error");
    }
  }

  function backButton(label, onClick) {
    const button = element("button", "cricket-action-button", `← ${label}`);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  }

  async function openDirectoryItem(item, source) {
    if (source === "series") {
      await openSeries(item);
      return;
    }

    if (source === "news") {
      await openArticle(item);
      return;
    }

    if (source === "archives" && item.path.startsWith("/cricket-series/")) {
      await openSeries(item, "archives");
      return;
    }

    if (source === "archives" && /^\/cricket-scorecard-archives\/\d{4}/.test(item.path)) {
      await openArchiveYear(item);
      return;
    }

    if (
      source === "teams" &&
      /^\/cricket-team\/[a-zA-Z0-9-]+\/\d+\/?$/.test(item.path)
    ) {
      await openTeam(item);
      return;
    }

    await openPage(item, source);
  }

  async function openArchiveYear(item) {
    state.returnPage = "archives";
    state.archiveYearOpen = true;
    state.archiveItem = item;
    state.query = "";
    renderCenter();
    setLoading(`Loading ${item.title} archives…`);
    const requestId = ++state.request;
    try {
      const result = await request(
        `/api/page?path=${encodeURIComponent(item.path)}`
      );
      if (requestId !== state.request) return;
      renderShell();
      const content = root.querySelector(".cricket-content");
      content.appendChild(backButton("Back to archives", () => {
        state.archiveYearOpen = false;
        state.archiveItem = null;
        state.page = "archives";
        renderCenter();
        renderPageContent();
      }));
      content.appendChild(element("h3", "cricket-section-heading", `${item.title} Match Archives`));
      renderDirectory(
        result.data?.links || [],
        "Archived series",
        link => openDirectoryItem(link, "archives"),
        "No archived series are listed for this year."
      );
    } catch (error) {
      if (requestId === state.request) showMessage(error.message, "is-error");
    }
  }

  async function openTeam(item, tab = "schedule") {
    state.archiveYearOpen = false;
    if (state.page !== "team") {
      state.teamReturnItem =
        state.page === "page" &&
        state.returnPage === "teams" &&
        state.pageItem
          ? state.pageItem
          : null;
    }
    state.teamPath = item.path.replace(/\/+$/, "");
    state.teamTitle = item.title || "Team";
    state.teamTab = tab;
    state.query = "";
    state.page = "team";
    renderCenter();
    setLoading(`Loading ${tab} for ${state.teamTitle}…`);
    const requestId = ++state.request;

    try {
      const result = await request(
        `/api/team?path=${encodeURIComponent(state.teamPath)}&tab=${tab}`
      );
      if (requestId !== state.request) return;

      renderShell();
      const content = root.querySelector(".cricket-content");
      content.appendChild(backButton("Back to teams", () => {
        if (state.teamReturnItem) {
          openPage(state.teamReturnItem, "teams");
        } else {
          state.page = "teams";
          renderCenter();
          renderPageContent();
        }
      }));
      content.appendChild(element(
        "h3",
        "cricket-section-heading",
        state.teamTitle || result.data?.title || "Team"
      ));

      const navigation = element("div", "cricket-tabs cricket-match-tabs");
      [
        ["schedule", "Schedule"],
        ["results", "Results"],
        ["players", "Squad"],
        ["stats", "Stats"],
        ["news", "News"]
      ].forEach(([key, label]) => {
        const button = element("button", "cricket-tab", label);
        button.type = "button";
        button.classList.toggle("active", tab === key);
        button.addEventListener("click", () => openTeam(item, key));
        navigation.appendChild(button);
      });
      content.appendChild(navigation);

      if (tab === "schedule" || tab === "results") {
        renderMatchList(
          result.matches || [],
          match => openMatch(match, "team"),
          tab === "schedule"
            ? `No upcoming fixtures are currently listed for ${state.teamTitle}.`
            : `No match results are currently listed for ${state.teamTitle}.`
        );
      } else if (tab === "players") {
        const players = result.data?.players || [];
        if (!players.length) {
          showMessage(`Squad details are not available for ${state.teamTitle} right now.`);
          return;
        }
        const roles = [...new Set(players.map(player => player.role))];
        roles.forEach(role => {
          content.appendChild(element(
            "h4",
            "cricket-section-heading",
            role === "Not available" ? "Players" : role
          ));
          addTable(
            ["#", "Player", "Role"],
            players
              .filter(player => player.role === role)
              .map((player, index) => [index + 1, player.name, player.role])
          );
        });
      } else if (tab === "news") {
        renderDirectory(
          result.data?.links || [],
          "Team News",
          openArticle,
          `No team news is currently listed for ${state.teamTitle}.`
        );
      } else {
        const data = result.data || {};
        if (data.headings?.length || data.tables?.length || data.paragraphs?.length) {
          renderGenericPage(data, `Team stats are not currently listed for ${state.teamTitle}.`);
        } else {
          showMessage(`Team stats are not currently listed for ${state.teamTitle}.`);
        }
      }
    } catch (error) {
      if (requestId === state.request) showMessage(error.message, "is-error");
    }
  }

  async function openPage(item, source) {
    state.returnPage = source;
    state.pageItem = item;
    state.query = "";
    state.page = "page";
    renderCenter();
    setLoading(`Loading ${item.title}…`);
    const requestId = ++state.request;
    try {
      const result = await request(
        `/api/page?path=${encodeURIComponent(item.path)}`
      );
      if (requestId !== state.request) return;
      renderShell();
      const content = root.querySelector(".cricket-content");
      content.appendChild(backButton("Back", () => {
        if (source === "series-matches") {
          openSeries(
            { title: state.seriesTitle, path: state.seriesPath },
            state.seriesReturnPage,
            state.seriesTab
          );
        } else {
          state.page = source;
          state.archiveYearOpen = false;
          renderCenter();
          renderPageContent();
        }
      }));
      content.appendChild(element("h3", "cricket-section-heading", result.data?.title || item.title));
      if (source !== "teams") {
        renderGenericPage(
          result.data || {},
          "Additional details are not available for this page right now."
        );
      }
      renderDirectory(
        result.data?.links || [],
        "Related",
        link => openDirectoryItem(link, source),
        "No related pages are available."
      );
    } catch (error) {
      if (requestId === state.request) showMessage(error.message, "is-error");
    }
  }

  async function openArticle(item) {
    state.articleReturn = {
      page: state.page,
      match: state.selectedMatch
    };
    state.returnPage = state.page;
    state.page = "article";
    renderShell();
    setLoading(`Loading ${item.title}…`);
    const requestId = ++state.request;
    try {
      const result = await request(
        `/api/v4/news?path=${encodeURIComponent(item.path)}`
      );
      if (requestId !== state.request) return;
      renderShell();
      const content = root.querySelector(".cricket-content");
      content.appendChild(backButton("Back", () => {
        const previous = state.articleReturn;
        state.articleReturn = null;
        if (previous?.page === "match" && previous.match) {
          state.page = "match";
          state.selectedMatch = previous.match;
          loadMatchTab("news");
        } else if (previous?.page === "series-matches") {
          openSeries(
            { title: state.seriesTitle, path: state.seriesPath },
            state.seriesReturnPage,
            state.seriesTab
          );
        } else if (previous?.page === "team") {
          openTeam(
            { title: state.teamTitle, path: state.teamPath },
            state.teamTab
          );
        } else {
          state.page = previous?.page || "news";
          state.selectedMatch = previous?.match || null;
          renderCenter();
          renderPageContent();
        }
      }));
      const article = result.data || {};
      content.appendChild(element("h3", "cricket-section-heading", article.title || item.title));
      if (article.description) {
        content.appendChild(element("p", "cricket-article-description", article.description));
      }
      const meta = [article.author, article.published].filter(Boolean).join(" · ");
      if (meta) content.appendChild(element("p", "cricket-article-meta", meta));
      (article.paragraphs || []).forEach(paragraph =>
        content.appendChild(element("p", "cricket-copy", paragraph))
      );
      if (!(article.paragraphs || []).length) {
        showMessage("The article text is not available from the source right now.");
      }
    } catch (error) {
      if (requestId === state.request) showMessage(error.message, "is-error");
    }
  }

  async function openMatch(match, returnPage) {
    state.selectedMatch = match;
    state.scorecardInning = 0;
    state.returnPage = returnPage;
    state.page = "match";
    renderShell();
    await loadMatchTab("scorecard");
  }

  async function loadMatchTab(tab) {
    const match = state.selectedMatch;
    if (!match) return;
    const requestId = ++state.request;
    renderShell();
    const content = root.querySelector(".cricket-content");
    content.appendChild(backButton("Back to matches", () => {
    state.selectedMatch = null;
    if (state.returnPage === "series-matches") {
      openSeries(
        { title: state.seriesTitle, path: state.seriesPath },
        state.seriesReturnPage,
        state.seriesTab
      );
    } else if (state.returnPage === "team") {
      openTeam(
        { title: state.teamTitle, path: state.teamPath },
        state.teamTab
      );
    } else {
      state.page = state.returnPage;
      renderCenter();
      renderPageContent();
    }
    }));
    content.appendChild(element("h3", "cricket-section-heading", [
      match.team1?.teamName || "Team 1",
      "vs",
      match.team2?.teamName || "Team 2"
    ].join(" ")));
    content.appendChild(element(
      "p",
      "cricket-match-meta",
      [match.series, match.description, match.status].filter(Boolean).join(" · ")
    ));

    const venue = [
      match.venue?.ground,
      match.venue?.city
    ].filter(Boolean).join(", ");
    content.appendChild(element(
      "p",
      "cricket-match-meta",
      `Venue: ${venue || "Not available"}`
    ));

    const navigation = element("div", "cricket-tabs cricket-match-tabs");
    const matchTabs = [
      ["scorecard", "Scorecard"],
      ["squad", "Squad"],
      ["points", "Points Table"],
      ["overs", "Overs"],
      ["graphs", "Graphs"],
      ["commentary", "Commentary"],
      ["news", "Match News"],
      ["info", "Match Info"]
    ];
    matchTabs.forEach(([key, label]) => {
      const button = element("button", "cricket-tab", label);
      button.type = "button";
      button.classList.toggle("active", tab === key);
      button.addEventListener("click", () => loadMatchTab(key));
      navigation.appendChild(button);
    });
    content.appendChild(navigation);
    content.appendChild(element("div", "cricket-match-data is-loading", "Loading match data…"));

    const apiVersion = ["squad", "points", "overs", "graphs", "news"].includes(tab)
      ? "v4"
      : "v3";
    try {
      const result = await request(`/api/${apiVersion}/match/${match.id}/${tab}`);
      if (requestId !== state.request || state.selectedMatch !== match) return;
      const data = result.data || {};
      const target = root.querySelector(".cricket-match-data");
      target.classList.remove("is-loading");
      target.textContent = "";
      renderMatchData(tab, data, target, match);
    } catch (error) {
      if (requestId !== state.request) return;
      const target = root.querySelector(".cricket-match-data");
      if (target) {
        target.classList.remove("is-loading");
        target.textContent = "";
        target.appendChild(element(
          "div",
          "cricket-message is-error",
          tab === "points" && /404/.test(error.message)
            ? "A points table is not available for this match."
            : error.message
        ));
      }
    }
  }

  function renderMatchData(tab, data, target, match) {
    const appendToTarget = node => target.appendChild(node);

    if (tab === "scorecard") {
      if (!(data.innings || []).length) {
        appendToTarget(element("div", "cricket-message", "A detailed scorecard is not available for this match right now."));
        return;
      }
      if (data.innings.length > 1) {
        const inningsTabs = element("div", "cricket-tabs cricket-match-tabs");
        data.innings.forEach((inning, index) => {
          const button = element(
            "button",
            "cricket-tab",
            inning.team || `Innings ${index + 1}`
          );
          button.type = "button";
          button.classList.toggle("active", index === state.scorecardInning);
          button.addEventListener("click", () => {
            state.scorecardInning = index;
            target.replaceChildren();
            renderMatchData(tab, data, target, match);
          });
          inningsTabs.appendChild(button);
        });
        appendToTarget(inningsTabs);
      }
      const index = Math.min(state.scorecardInning, data.innings.length - 1);
      const inning = data.innings[index];
      appendToTarget(element(
        "h4",
        "cricket-section-heading",
        inning.team || `Innings ${index + 1}`
      ));
      appendToTarget(element(
        "p",
        "cricket-score-summary",
        `${inning.runs ?? ""}/${inning.wickets ?? ""} (${inning.overs ?? "—"} overs)`
      ));
      if (inning.batting?.length) {
        appendMatchTable(target, ["Batter", "Dismissal", "R", "B", "4s", "6s", "SR"],
          inning.batting.map(player => [
            player.name, player.dismissal, player.runs, player.balls,
            player.fours, player.sixes, player.strikeRate
          ]));
      }
      if (inning.extras && typeof inning.extras === "object") {
        const extras = Object.entries(inning.extras)
          .filter(([, value]) => value !== null && typeof value !== "object")
          .map(([key, value]) => [
            key.replace(/([A-Z])/g, " $1").replace(/^./, letter => letter.toUpperCase()),
            value
          ]);
        if (extras.length) {
          appendMatchTable(target, ["Extras", "Runs"], extras);
        }
      }
      if (inning.didNotBat) {
        const players = Array.isArray(inning.didNotBat)
          ? inning.didNotBat
          : Object.values(inning.didNotBat);
        const names = players.map(player =>
          typeof player === "string"
            ? player
            : player?.name || player?.fullName || player?.batName
        ).filter(Boolean);
        if (names.length) {
          appendToTarget(element(
            "p",
            "cricket-match-meta",
            `Did not bat: ${names.join(", ")}`
          ));
        }
      }
      if (inning.bowling?.length) {
        appendMatchTable(target, ["Bowler", "O", "M", "R", "W", "NB", "Wd", "ECO"],
          inning.bowling.map(player => [
            player.name, player.overs, player.maidens, player.runs,
            player.wickets, player.noBalls, player.wides, player.economy
          ]));
      }
      const falls = inning.fallOfWickets &&
        typeof inning.fallOfWickets === "object"
        ? Object.values(inning.fallOfWickets)
        : inning.fallOfWickets || [];
      if (falls.length) {
        const summary = falls.map(wicket => {
          if (typeof wicket === "string") return wicket;
          if (!wicket || typeof wicket !== "object") return "";
          const score = wicket.wktRuns ?? wicket.runs;
          const count = wicket.wktNbr ?? wicket.wicketNumber;
          const over = wicket.wktOver ?? wicket.over;
          const batter = wicket.batName ?? wicket.name;
          return [
            count ? `${score}/${count}` : score,
            over !== undefined ? `(${over} overs)` : "",
            batter
          ].filter(Boolean).join(" ");
        }).filter(Boolean);
        if (summary.length) {
          appendToTarget(element(
            "p",
            "cricket-match-meta",
            `Fall of wickets: ${summary.join(", ")}`
          ));
        }
      }
      return;
    }

    if (tab === "squad") {
      const teams = (data.teams || []).filter(team =>
        (team.players || []).length
      );
      if (!teams.length) {
        appendToTarget(element("div", "cricket-message", "Squad details are not available for this match right now."));
        return;
      }
      teams.forEach(team => {
        appendToTarget(element(
          "h4",
          "cricket-section-heading",
          team.teamName || team.teamSName || "Team"
        ));
        appendMatchTable(target, ["#", "Player", "Role", "Batting style", "Bowling style"],
          team.players.map((player, index) => [
            index + 1,
            player.name || player.fullName,
            player.role || "Not available",
            player.battingStyle || "Not available",
            player.bowlingStyle || "Not available"
          ]));
      });
      return;
    }

    if (tab === "info") {
      const details = (data.details || [])
        .filter(item => item.label)
        .map(item => [item.label, item.value]);
      const known = new Set(details.map(row => row[0]));
      [
        ["Series", match.series],
        ["Match", match.description],
        ["Format", match.format],
        ["Status", match.status || match.state],
        ["Venue", match.venue?.ground],
        ["City", match.venue?.city]
      ].forEach(([label, value]) => {
        if (!known.has(label)) details.push([label, value || "Not available"]);
      });
      appendMatchTable(target, ["Information", "Details"], details);
      return;
    }

    if (tab === "commentary") {
      const deliveries = data.deliveries || [];
      if (!deliveries.length) {
        appendToTarget(element("div", "cricket-message", "Ball-by-ball commentary is not available right now."));
        return;
      }
      deliveries.forEach(ball => {
        const row = element("article", "cricket-commentary-row");
        row.append(
          element("strong", "cricket-commentary-over", ball.over || "Ball"),
          element("p", "cricket-commentary-text", ball.text)
        );
        appendToTarget(row);
      });
      return;
    }

    if (tab === "news") {
      const links = data.links || [];
      if (!links.length) {
        appendToTarget(element(
          "div",
          "cricket-message",
          data.emptyMessage || "Match-related news is not available for this match right now."
        ));
        return;
      }
      links.forEach(item => {
        const card = element("button", "cricket-directory-card");
        card.type = "button";
        card.append(
          element("span", "cricket-directory-label", "Match News"),
          element("span", "cricket-directory-title", item.title),
          element("span", "cricket-directory-action", "Read article →")
        );
        card.addEventListener("click", () => openArticle(item));
        appendToTarget(card);
      });
      return;
    }

    const tables = data.tables || [];
    if (tab === "graphs") {
      renderRunProgressGraph(target, data);
      appendOverCoverageNote(target, data, match);
      return;
    }

    if (!tables.length) {
      appendToTarget(element(
        "div",
        "cricket-message",
        data.emptyMessage || `${tab === "overs" ? "Over-by-over data" : "Points table"} is not available for this match right now.`
      ));
      return;
    }
    (data.headings || []).forEach(title =>
      appendToTarget(element("h4", "cricket-section-heading", title))
    );
    tables.forEach(rows => {
      const [headers, ...body] = rows;
      appendMatchTable(target, headers, body);
    });
    if (tab === "overs") {
      appendOverCoverageNote(target, data, match);
    }
  }

  function appendOverCoverageNote(target, data, match) {
    const scoredInnings = Object.values(match?.score || {}).reduce(
      (total, teamScore) => total + Object.keys(teamScore || {}).filter(
        key => /^inngs\d+$/i.test(key)
      ).length,
      0
    );
    const availableInnings = (data.tables || []).length;
    if (scoredInnings > availableInnings) {
      target.appendChild(element(
        "p",
        "cricket-match-meta",
        `Over-by-over data is available for ${availableInnings} of ${scoredInnings} scored innings; the source feed omits the remaining innings.`
      ));
    }
  }

  function renderRunProgressGraph(target, data) {
    const innings = (data.tables || []).flatMap((table, index) => {
      if (!Array.isArray(table) || table.length < 2) return [];
      const rowsByBall = new Map();
      table.slice(1).forEach(row => {
        if (!Array.isArray(row)) return [];
        const overMatch = String(row[0] ?? "").match(/^(\d+)(?:\.(\d+))?$/);
        const score = Number(row[3]);
        if (!overMatch || !Number.isFinite(score)) return;
        const ballsInOver = Number(overMatch[2] || "0");
        if (ballsInOver > 6) return;
        const balls = Number(overMatch[1]) * 6 +
          ballsInOver;
        rowsByBall.set(balls, { balls, score });
      });
      const rows = [...rowsByBall.values()].sort(
        (left, right) => left.balls - right.balls
      );
      if (!rows.length) return [];
      return [{
        label: data.headings?.[index] || `Innings ${index + 1}`,
        rows
      }];
    });

    if (!innings.length) {
      target.appendChild(element(
        "div",
        "cricket-message",
        "Run progression graphs are not available for this match."
      ));
      return;
    }

    const heading = element(
      "h4",
      "cricket-section-heading",
      "Runs by over"
    );
    const description = element(
      "p",
      "cricket-copy",
      "Verified innings totals from the over-by-over score feed."
    );
    const chart = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg"
    );
    chart.setAttribute("viewBox", "0 0 760 320");
    chart.setAttribute("role", "img");
    chart.setAttribute(
      "aria-label",
      `Run progression graph for ${innings.map(item => item.label).join(", ")}`
    );
    chart.classList.add("cricket-run-graph");

    const allRows = innings.flatMap(item => item.rows);
    const maxBalls = Math.max(6, ...allRows.map(row => row.balls));
    const maxScore = Math.max(10, ...allRows.map(row => row.score));
    const left = 54;
    const right = 730;
    const top = 18;
    const bottom = 260;
    const x = balls => left + (balls / maxBalls) * (right - left);
    const y = runs => bottom - (runs / maxScore) * (bottom - top);
    const svgElement = (name, attributes, text) => {
      const node = document.createElementNS(
        "http://www.w3.org/2000/svg",
        name
      );
      Object.entries(attributes).forEach(([key, value]) =>
        node.setAttribute(key, String(value))
      );
      if (text !== undefined) node.textContent = text;
      return node;
    };

    for (let tick = 0; tick <= 4; tick += 1) {
      const runs = Math.round((maxScore * tick) / 4);
      const position = y(runs);
      chart.append(
        svgElement("line", {
          x1: left, y1: position, x2: right, y2: position,
          class: "cricket-run-grid"
        }),
        svgElement("text", {
          x: left - 10, y: position + 4,
          "text-anchor": "end", class: "cricket-run-axis"
        }, String(runs))
      );
    }

    const colors = ["#ff5964", "#58b7ff", "#ffc857", "#8dd694"];
    innings.forEach((inning, index) => {
      const firstBall = inning.rows[0]?.balls || 0;
      const points = [
        `${x(firstBall)},${y(0)}`,
        ...inning.rows.map(row => `${x(row.balls)},${y(row.score)}`)
      ].join(" ");
      const color = colors[index % colors.length];
      chart.appendChild(svgElement("polyline", {
        points,
        fill: "none",
        stroke: color,
        "stroke-width": 3,
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
      }));
      chart.appendChild(svgElement("circle", {
        cx: x(inning.rows[inning.rows.length - 1].balls),
        cy: y(inning.rows[inning.rows.length - 1].score),
        r: 4,
        fill: color
      }));

      const legend = element(
        "span",
        "cricket-run-legend-item",
        inning.label
      );
      legend.style.setProperty("--run-legend-color", color);
      legend.appendChild(element(
        "strong",
        "",
        String(inning.rows[inning.rows.length - 1].score)
      ));
      target.appendChild(legend);
    });

    chart.append(
      svgElement("line", {
        x1: left, y1: bottom, x2: right, y2: bottom,
        class: "cricket-run-axis-line"
      }),
      svgElement("text", {
        x: left, y: 292, class: "cricket-run-axis"
      }, "Start"),
      svgElement("text", {
        x: right, y: 292, "text-anchor": "end",
        class: "cricket-run-axis"
      }, `${(maxBalls / 6).toFixed(1)} overs`)
    );
    target.prepend(description);
    target.prepend(heading);
    target.appendChild(chart);
  }

  function appendMatchTable(target, headers, rows) {
    const wrapper = element("div", "cricket-table-wrap");
    const table = document.createElement("table");
    table.className = "cricket-table";
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    headers.forEach(header => tr.appendChild(element("th", "", header)));
    thead.appendChild(tr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    rows.forEach(row => {
      const bodyRow = document.createElement("tr");
      row.forEach(value =>
        bodyRow.appendChild(element("td", "", value ?? "—"))
      );
      tbody.appendChild(bodyRow);
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);
    target.appendChild(wrapper);
  }

  async function renderPageContent(force = false) {
    if (state.page === "match" || state.page === "article" || state.page === "series-matches" || state.page === "page" || state.page === "team") {
      return;
    }

    const requestId = ++state.request;
    const content = root.querySelector(".cricket-content");
    if (!content) return;
    content.replaceChildren(element("div", "cricket-message is-loading", "Loading cricket data…"));

    try {
      if (["live", "recent", "upcoming"].includes(state.page)) {
        await loadMatches(state.page, requestId);
      } else if (state.page === "series-matches") {
        return;
      } else if (state.page === "news") {
        const result = await request("/api/section/news");
        if (requestId !== state.request) return;
        renderDirectory(
          (result.data?.links || []).filter(item =>
            /^\/cricket-news\/\d+\/[a-zA-Z0-9-]+\/?$/.test(item.path)
          ),
          "Cricket News",
          openArticle,
          "Cricket news is not available right now."
        );
      } else if (state.page === "series") {
        await loadSection(
          "series",
          "Series",
          "No series are listed right now.",
          requestId
        );
      } else if (state.page === "archives") {
        await loadSection(
          "archives",
          "Archives",
          "No archived series are listed.",
          requestId
        );
      } else if (state.page === "teams") {
        await loadSection(
          "teams",
          "Team",
          "No team pages are listed right now.",
          requestId
        );
      } else if (state.page === "stats") {
        await loadRankings(requestId);
      } else if (state.page === "records") {
        await loadRecords(requestId);
      }
      if (requestId !== state.request) return;
      const currentContent = root.querySelector(".cricket-content");
      currentContent?.querySelector(".is-loading")?.remove();
      const count = root.querySelector(".cricket-count");
      if (count && state.page === "news") {
        count.textContent =
          `${root.querySelectorAll(".cricket-directory-card").length} cricket news articles`;
      }
    } catch (error) {
      if (requestId !== state.request) return;
      const currentContent = root.querySelector(".cricket-content");
      if (currentContent) {
        currentContent.replaceChildren();
        currentContent.appendChild(element(
          "div",
          "cricket-message is-error",
          `${error.message}. Check that the Cricfreex cricket API is running and configured.`
        ));
      }
    }
  }

  async function loadRankings(requestId) {
    const content = root.querySelector(".cricket-content");
    const controls = element("div", "cricket-ranking-controls");
    const selectors = [
      ["gender", "Men", "Women"],
      ["format", "Test", "ODI", "T20"],
      ["category", "Batting", "Bowling", "All-rounder", "Teams"]
    ];
    selectors.forEach(([key, ...options]) => {
      const label = element("label", "cricket-ranking-select");
      label.appendChild(element(
        "span",
        "",
        key === "gender" ? "Gender" : key
      ));
      const select = document.createElement("select");
      options.forEach(option => {
        const normalized = option.toLowerCase();
        const value = key === "gender"
          ? normalized
          : key === "category" && normalized === "all-rounder"
            ? "all-rounder"
            : normalized;
        const choice = document.createElement("option");
        choice.value = value;
        choice.textContent = option;
        select.appendChild(choice);
      });
      select.value = state.ranking[key];
      select.addEventListener("change", () => {
        state.ranking[key] = select.value;
        renderPageContent(true);
      });
      label.appendChild(select);
      controls.appendChild(label);
    });
    content.appendChild(controls);

    const params = new URLSearchParams(state.ranking);
    const result = await request(`/api/v4/rankings?${params}`);
    if (requestId !== state.request) return;
    const data = result.data || {};
    const tableRows = data.rankings || data.rows || [];
    if (!tableRows.length) {
      showMessage("Verified rankings are not available right now.");
      return;
    }
    const columns = [
      ["rank", "Rank"],
      ["name", "Player / Team"],
      ["country", "Country"],
      ["rating", "Rating"]
    ];
    addTable(
      columns.map(([, label]) => label),
      tableRows.map(row => columns.map(([key]) => row[key] ?? "—"))
    );
  }

  async function loadRecords(requestId) {
    const content = root.querySelector(".cricket-content");
    const params = new URLSearchParams({
      record: state.records.record,
      format: state.records.format,
      year: state.records.year,
      team: state.records.team,
      opponent: state.records.opponent
    });
    const result = await request(`/api/v4/records?${params}`);
    if (requestId !== state.request) return;

    const catalog = result.catalog || {};
    const categories = catalog.categories || {};
    const categoryNames = Object.keys(categories);
    if (!categoryNames.includes(state.records.category)) {
      state.records.category = categoryNames[0] || "Batting";
    }

    const recordOptions = categories[state.records.category] || [];
    if (!recordOptions.some(item => item.value === state.records.record)) {
      state.records.record = recordOptions[0]?.value || "";
    }

    const controls = element("div", "cricket-record-controls");
    const addSelect = (title, options, value, onChange) => {
      const label = element("label", "cricket-ranking-select");
      label.appendChild(element("span", "", title));
      const select = document.createElement("select");
      options.forEach(option => {
        const choice = document.createElement("option");
        choice.value = option.value;
        choice.textContent = option.label;
        select.appendChild(choice);
      });
      select.value = value;
      select.addEventListener("change", () => onChange(select.value));
      label.appendChild(select);
      controls.appendChild(label);
    };

    addSelect(
      "Category",
      categoryNames.map(name => ({ value: name, label: name })),
      state.records.category,
      value => {
        state.records.category = value;
        state.records.record = categories[value]?.[0]?.value || "";
        renderPageContent(true);
      }
    );
    addSelect(
      "Record",
      recordOptions.map(item => ({ value: item.value, label: item.label })),
      state.records.record,
      value => {
        state.records.record = value;
        renderPageContent(true);
      }
    );
    addSelect(
      "Format",
      (catalog.formats || []).map(item => ({
        value: String(item.matchTypeId),
        label: String(item.matchTypeDesc || "").toUpperCase()
      })),
      state.records.format,
      value => {
        state.records.format = value;
        renderPageContent(true);
      }
    );
    addSelect(
      "Year",
      (catalog.years || []).map(year => ({
        value: String(year),
        label: String(year).toUpperCase()
      })),
      state.records.year,
      value => {
        state.records.year = value;
        renderPageContent(true);
      }
    );
    addSelect(
      "Team",
      (catalog.teams || []).map(item => ({
        value: String(item.id),
        label: String(item.teamShortName || item.id).toUpperCase()
      })),
      state.records.team,
      value => {
        state.records.team = value;
        renderPageContent(true);
      }
    );
    addSelect(
      "Opponent",
      (catalog.opponents || []).map(item => ({
        value: String(item.id),
        label: String(item.teamShortName || item.id).toUpperCase()
      })),
      state.records.opponent,
      value => {
        state.records.opponent = value;
        renderPageContent(true);
      }
    );

    content.appendChild(element(
      "h3",
      "cricket-section-heading",
      recordOptions.find(item => item.value === state.records.record)?.label ||
        "Cricket Records"
    ));
    content.appendChild(controls);

    const data = result.data || {};
    if (!(data.rows || []).length) {
      content.appendChild(element(
        "div",
        "cricket-message",
        "No records match these filters."
      ));
      return;
    }

    addTable(data.headers || [], data.rows);
  }

  async function renderPageContentSafe() {
    await renderPageContent();
  }

  function open() {
    if (location.hash !== "#cricketCenter") {
      history.replaceState(null, "", `${location.pathname}${location.search}#cricketCenter`);
    }
    state.page = "live";
    state.query = "";
    state.selectedMatch = null;
    root.hidden = false;
    channelSection.hidden = true;
    document.body.classList.add("cricket-active");
    renderCenter();
    renderPageContentSafe();
    document.querySelector(".cricket-main-tab")?.classList.add("active");
    document.querySelector(".cricket-main-tab")?.setAttribute("aria-pressed", "true");
  }

  function selectPage(page) {
    if (!tabs.some(([key]) => key === page)) return;
    state.request += 1;
    state.page = page;
    state.query = "";
    root.hidden = false;
    channelSection.hidden = true;
    document.body.classList.add("cricket-active");
    renderCenter();
    renderPageContentSafe();
    document.querySelector(".cricket-main-tab")?.classList.add("active");
    document.querySelector(".cricket-main-tab")?.setAttribute("aria-pressed", "true");
  }

  document.querySelectorAll('.nav-links a[href="#cricketCenter"]').forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      open();
      root.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  window.addEventListener("hashchange", () => {
    if (
      location.hash === "#cricket" ||
      location.hash === "#cricketCenter"
    ) {
      open();
    }
  });

  window.setInterval(() => {
    if (!root.hidden && state.page === "live" && !document.hidden) {
      renderPageContent(true);
    }
  }, 30000);

  window.addEventListener("cricfreex:content-updated", event => {
    watchLinks = (event.detail || []).filter(item =>
      String(item.category || "").startsWith(watchLinkPrefix)
    );
    if (
      !root.hidden &&
      ["live", "upcoming"].includes(state.page) &&
      !document.hidden
    ) {
      renderPageContent(true);
    }
  });

  window.addEventListener("pagehide", () => {
    watchPlayer?.querySelector("iframe")?.setAttribute("src", "about:blank");
  });

  window.CricfreexCricket = { open, selectPage };
  open();
})();
