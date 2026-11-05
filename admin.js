"use strict";

const CONFIG=window.CRICFREEX_CONFIG;

const db=window.supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY,
  {
    auth:{
      persistSession:true,
      autoRefreshToken:true
    }
  }
);

const $=id=>document.getElementById(id);

const CRICKET_WATCH_LINK_PREFIX="__cricket_watch__:";
const SITE_ACCESS_PREFIX="__site_access__";
const isPort8765 = location.port === "8765";
const isLocalHost = location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "0.0.0.0";
const CRICKET_API_BASE = isPort8765
  ? ""
  : (isLocalHost ? "http://127.0.0.1:8765" : String(CONFIG.CRICKET_API_URL || "").replace(/\/+$/, ""));

let sections=[];
let content=[];
let settings={};
let suggestions=[];
let loading=false;
let watchMatches={live:[],upcoming:[]};
let selectedMatchLinks=[];
let matchRequest=0;

function isCricketWatchLink(item){
  return String(item?.category||"")
    .startsWith(CRICKET_WATCH_LINK_PREFIX);
}

function isSiteAccessItem(item){
  return String(item?.public_id||"")===SITE_ACCESS_PREFIX||
         String(item?.category||"")===SITE_ACCESS_PREFIX;
}

function cricketWatchMatchId(item){
  return String(item?.category||"")
    .slice(CRICKET_WATCH_LINK_PREFIX.length);
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isMatchOutsideIndia(match) {
  if (!match) return false;
  const tz = match.venue?.timezone;
  if (tz) {
    const cleanTz = String(tz).trim();
    if (cleanTz === "+05:30" || cleanTz === "+5:30") return false;
    return true;
  }
  const city = String(match.venue?.city || "").toLowerCase();
  const ground = String(match.venue?.ground || "").toLowerCase();
  const series = String(match.series || "").toLowerCase();
  const desc = String(match.description || "").toLowerCase();
  const text = `${city} ${ground} ${series} ${desc}`;
  const indiaKeywords = [
    "india", "ahmedabad", "bengaluru", "bangalore", "chennai", "delhi", "kolkata",
    "mumbai", "hyderabad", "vadodara", "pune", "mohali", "dharamsala", "jaipur",
    "kanpur", "lucknow", "nagpur", "rajkot", "ranchi", "indore", "cuttack", "guwahati",
    "thiruvananthapuram", "visakhapatnam", "dehradun", "surat", "gwalior", "bhopal",
    "ranji", "ipl", "syed mushtaq", "vijay hazare", "dulip", "irani"
  ];
  return !indiaKeywords.some(k => text.includes(k));
}

function format12HourTime(hours, minutes) {
  const ampm = hours >= 12 ? "PM" : "AM";
  const h = hours % 12 || 12;
  const m = String(minutes).padStart(2, "0");
  return `${String(h).padStart(2, "0")}:${m} ${ampm}`;
}

function formatCricketDateTime(dateOrTimestamp, isOutside = false) {
  if (!dateOrTimestamp) return "";
  let d;
  if (typeof dateOrTimestamp === "number") {
    d = new Date(dateOrTimestamp > 1e11 ? dateOrTimestamp : dateOrTimestamp * 1000);
  } else if (typeof dateOrTimestamp === "string") {
    if (/^\d+$/.test(dateOrTimestamp)) {
      const num = Number(dateOrTimestamp);
      d = new Date(num > 1e11 ? num : num * 1000);
    } else {
      d = new Date(dateOrTimestamp);
    }
  } else if (dateOrTimestamp instanceof Date) {
    d = dateOrTimestamp;
  }
  if (!d || isNaN(d.getTime())) return "";

  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istDate = new Date(d.getTime() + istOffsetMs);

  const day = String(istDate.getUTCDate()).padStart(2, "0");
  const month = MONTH_NAMES[istDate.getUTCMonth()];
  const year = istDate.getUTCFullYear();
  const dateFormatted = `${day} ${month} ${year}`;

  const timeIST = format12HourTime(istDate.getUTCHours(), istDate.getUTCMinutes());

  if (isOutside) {
    const timeGMT = format12HourTime(d.getUTCHours(), d.getUTCMinutes());
    return `${dateFormatted}, ${timeIST} IST (${timeGMT} GMT)`;
  }
  return `${dateFormatted}, ${timeIST} IST`;
}

function normalizeMatchStatus(status, match) {
  if (!status || typeof status !== "string") return status || "";
  const isOutside = isMatchOutsideIndia(match);

  if (match?.startDate && /starts\s+at/i.test(status)) {
    const dt = formatCricketDateTime(match.startDate, isOutside);
    if (dt) return `Match starts at ${dt}`;
  }

  const regex = /(match\s+starts\s+at|starts\s+at)\s+([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{1,2}):(\d{2})\s*(?:GMT|UTC)?/i;
  const matchReg = status.match(regex);
  if (matchReg) {
    const prefix = matchReg[1];
    const monthStr = matchReg[2].slice(0, 3).toLowerCase();
    const day = Number(matchReg[3]);
    const hour = Number(matchReg[4]);
    const min = Number(matchReg[5]);
    const monthIdx = MONTH_NAMES.findIndex(m => m.toLowerCase() === monthStr);
    if (monthIdx >= 0) {
      const year = match?.startDate ? new Date(match.startDate).getUTCFullYear() : new Date().getUTCFullYear();
      const utcMs = Date.UTC(year, monthIdx, day, hour, min);
      const dt = formatCricketDateTime(utcMs, isOutside);
      return `${prefix} ${dt}`;
    }
  }
  return status;
}

/* =========================================================
   AUTH
========================================================= */

function showLogin(){
  $("loginPage").classList.remove("hidden");
  $("adminApp").classList.add("hidden");
}

function showAdmin(){
  $("loginPage").classList.add("hidden");
  $("adminApp").classList.remove("hidden");
}

async function verifyAdmin(user){
  if(!user)return false;

  const {data,error}=await db
    .from("admins")
    .select("user_id")
    .eq("user_id",user.id)
    .maybeSingle();

  return !error&&Boolean(data);
}

async function bootstrap(){
  const {data}=await db.auth.getSession();

  if(!data.session){
    showLogin();
    return;
  }

  if(
    !await verifyAdmin(
      data.session.user
    )
  ){
    await db.auth.signOut();
    showLogin();
    return;
  }

  showAdmin();
  await loadAll();
  syncAllrounderToDatabase(true);
  if (!window._fancodeSyncInterval) {
    window._fancodeSyncInterval = setInterval(() => syncAllrounderToDatabase(), 30000);
  }
}

$("loginForm").onsubmit=async e=>{
  e.preventDefault();

  $("loginError").textContent="";
  $("loginButton").disabled=true;
  $("loginButton").textContent="Signing in...";

  const {data,error}=
    await db.auth.signInWithPassword({
      email:$("email").value.trim(),
      password:$("password").value
    });

  if(error){
    $("loginError").textContent="Invalid login.";
    $("loginButton").disabled=false;
    $("loginButton").textContent="Continue";
    return;
  }

  if(!await verifyAdmin(data.user)){
    await db.auth.signOut();
    $("loginError").textContent="Access denied.";
    $("loginButton").disabled=false;
    $("loginButton").textContent="Continue";
    return;
  }

  showAdmin();
  await loadAll();
  syncAllrounderToDatabase(true);
  if (!window._fancodeSyncInterval) {
    window._fancodeSyncInterval = setInterval(() => syncAllrounderToDatabase(), 30000);
  }

  $("loginButton").disabled=false;
  $("loginButton").textContent="Continue";
};

$("logout").onclick=async()=>{
  await db.auth.signOut();
  location.reload();
};

$("openSite").onclick=()=>{
  location.href="./";
};

/* =========================================================
   DATA
========================================================= */

async function loadAll(){
  if(loading)return;

  loading=true;

  try{
    const [s,c,w]=await Promise.all([
      db.from("sections")
        .select("*")
        .order("sort_order"),

      db.from("content")
        .select("*")
        .order("sort_order"),

      db.from("site_settings")
        .select("*")
        .eq("id",1)
        .maybeSingle()
    ]);

    if(s.error)throw s.error;
    if(c.error)throw c.error;
    if(w.error)throw w.error;

    sections=s.data||[];
    if(!sections.length){
      const {data:defaultSection,error}=await db
        .from("sections")
        .insert({
          name:"Live Channels",
          slug:"sports",
          sort_order:0,
          published:true
        })
        .select("*")
        .single();

      if(error)throw error;
      sections=[defaultSection];
    }

    $("adminLoadStatus").classList.add("hidden");
    $("adminLoadStatus").textContent="";
    
    // Automatic Deduplication of channels in content
    const seenContentKeys = new Set();
    const uniqueContent = [];
    const duplicateContentIds = [];
    (c.data || []).forEach(item => {
      const mUrl = String(item.media_url || "").trim();
      const cat = String(item.category || "").trim().toLowerCase();
      const title = String(item.title || "").trim().toLowerCase();
      const key = `${cat}___${title}___${mUrl}`;
      if (mUrl && seenContentKeys.has(key)) {
        if (item.id) duplicateContentIds.push(item.id);
      } else {
        if (mUrl) seenContentKeys.add(key);
        uniqueContent.push(item);
      }
    });
    content = uniqueContent;
    if (duplicateContentIds.length > 0) {
      db.from("content").delete().in("id", duplicateContentIds).then(() => {
        console.log("Cleaned up", duplicateContentIds.length, "duplicate channel rows in Supabase.");
      }).catch(() => {});
    }
    settings=w.data||{};

    $("statSections").textContent=sections.length;
    $("statContent").textContent=
      content.filter(x=>!isCricketWatchLink(x)&&!isSiteAccessItem(x)).length;
    $("statShows").textContent=
      content.filter(
        x=>!isCricketWatchLink(x)&&!isSiteAccessItem(x)&&x.kind==="series"
      ).length;
    $("statEpisodes").textContent=
      content.filter(
        x=>!isCricketWatchLink(x)&&!isSiteAccessItem(x)&&x.kind==="episode"
      ).length;

    renderContent();
    renderSections();
    fillWebsite();
    fillSelectors();
    cleanupFinishedWatchLinks();
    loadSuggestions();
    loadPasswordGate();

  }catch(error){
    console.error(error);
    $("adminLoadStatus").textContent=
      `Admin data could not be loaded: ${error.message}`;
    $("adminLoadStatus").classList.remove("hidden");
  }finally{
    loading=false;
  }
}

/* =========================================================
   TABS
========================================================= */

document.querySelectorAll(".tab").forEach(button=>{
  button.onclick=()=>{
    document.querySelectorAll(".tab")
      .forEach(x=>x.classList.remove("active"));

    button.classList.add("active");

    const tab=button.dataset.tab;

    $("contentPanel").classList.toggle(
      "hidden",
      tab!=="content"
    );

    $("websitePanel").classList.toggle(
      "hidden",
      tab!=="website"
    );

    $("sectionsPanel").classList.toggle(
      "hidden",
      tab!=="sections"
    );

    $("watchLinksPanel").classList.toggle(
      "hidden",
      tab!=="watchLinks"
    );

    if($("suggestionsPanel")){
      $("suggestionsPanel").classList.toggle(
        "hidden",
        tab!=="suggestions"
      );
    }

    if($("passwordPanel")){
      $("passwordPanel").classList.toggle(
        "hidden",
        tab!=="password"
      );
    }

    $("editorPanel").classList.add("hidden");
    if(tab==="watchLinks"){
      loadCricketMatches(
        $("watchMatchCategory").value
      );
    }else if(tab==="suggestions"){
      loadSuggestions();
    }else if(tab==="password"){
      loadPasswordGate();
    }
  };
});

function setWatchLinkStatus(message,isError=false){
  const status=$("watchLinkStatus");
  status.textContent=message;
  status.style.color=isError?"#ff858c":"";
}

function matchOptionLabel(match){
  const teams=[
    match.team1?.teamSName||match.team1?.teamName,
    match.team2?.teamSName||match.team2?.teamName
  ].filter(Boolean).join(" vs ");
  const isOutside = isMatchOutsideIndia(match);
  const dt = formatCricketDateTime(match.startDate, isOutside);
  const normStatus = normalizeMatchStatus(match.status || match.state, match);
  return [
    teams||"Match",
    dt,
    match.description,
    normStatus
  ].filter(Boolean).join(" · ");
}

function renderWatchMatchOptions(category){
  const select=$("watchMatch");
  const previous=select.value;
  select.replaceChildren();
  const placeholder=document.createElement("option");
  placeholder.value="";
  placeholder.textContent="Select a match";
  select.append(placeholder);

  const seenIds = new Set();
  (watchMatches[category] || []).forEach(match=>{
    const mId = String(match.id);
    seenIds.add(mId);
    const option=document.createElement("option");
    option.value=mId;
    option.textContent=matchOptionLabel(match);
    select.append(option);
  });

  // Also include any watch links in database that aren't in watchMatches
  content.filter(isCricketWatchLink).forEach(item => {
    const mId = cricketWatchMatchId(item);
    if (mId && !seenIds.has(mId)) {
      seenIds.add(mId);
      const option = document.createElement("option");
      option.value = mId;
      const isAuto = item.public_id?.startsWith("auto_");
      option.textContent = `[${isAuto ? 'FanCode Stream' : 'Custom Server'}] ${item.title || mId} (${mId})`;
      select.append(option);
    }
  });

  if(seenIds.has(previous)){
    select.value=previous;
  }else{
    select.value="";
    selectedMatchLinks=[];
    $("watchLinkRows").replaceChildren();
  }
}

async function loadCricketMatches(category){
  const requestId=++matchRequest;
  setWatchLinkStatus(`Loading ${category} matches…`);
  try{
    const response=await fetch(
      `${CRICKET_API_BASE}/api/matches/${category}`,
      {headers:{Accept:"application/json"}}
    );
    let result;
    try{
      result=await response.json();
    }catch{
      throw new Error(
        `Cricket API returned an unreadable response (HTTP ${response.status}).`
      );
    }
    if(!response.ok){
      throw new Error(
        typeof result.detail==="string"
          ?result.detail
          :`Cricket API request failed (HTTP ${response.status}).`
      );
    }
    if(result.success===false){
      throw new Error(result.detail||"Could not load cricket matches.");
    }
    if(requestId!==matchRequest)return;

    watchMatches[category]=Array.isArray(result.matches)
      ?result.matches
      :[];
    renderWatchMatchOptions(category);
    cleanupFinishedWatchLinks();
    setWatchLinkStatus(
      watchMatches[category].length
        ?`${watchMatches[category].length} ${category} matches loaded.`
        :"No matches are currently available in this category."
    );
  }catch(error){
    if(requestId!==matchRequest)return;
    renderWatchMatchOptions(category);
    setWatchLinkStatus(
      `Could not load ${category} matches: ${error.message}`,
      true
    );
  }
}


/* =========================================================
   ALLROUNDER AUTO-SYNC DIRECTLY TO SUPABASE DATABASE
========================================================= */

const ALIAS_GROUPS = [
  ["india", "ind", "indians"],
  ["pakistan", "pak"],
  ["australia", "aus", "aussies"],
  ["south africa", "sa", "rsa", "proteas"],
  ["new zealand", "nz", "black caps", "blackcaps"],
  ["england", "eng"],
  ["west indies", "wi", "windies"],
  ["sri lanka", "sl"],
  ["bangladesh", "ban", "bd", "tigers"],
  ["afghanistan", "afg"],
  ["ireland", "ire"],
  ["zimbabwe", "zim"],
  ["netherlands", "ned", "dutch", "holland"],
  ["scotland", "sco"],
  ["united arab emirates", "uae", "u a e", "emirates"],
  ["papua new guinea", "png"],
  ["nepal", "nep"],
  ["oman", "oma", "omn"],
  ["namibia", "nam"],
  ["canada", "can"],
  ["united states", "usa", "us", "united states of america"],
  ["kenya", "ken"],
  ["hong kong", "hk", "hkg", "hong kong china"],
  ["jersey", "jer"],
  ["qatar", "qat"],
  ["uganda", "uga"],
  ["kuwait", "kuw"],
  ["bahrain", "bah"],
  ["saudi arabia", "ksa"],
  ["italy", "ita"],
  ["germany", "ger"],
  ["tasmania", "tas", "tasmanian tigers"],
  ["new south wales", "nsw", "nsw blues", "blues"],
  ["victoria", "vic"],
  ["queensland", "qld", "queensland bulls", "bulls"],
  ["western australia", "wa", "western australia xi"],
  ["south australia", "sa", "redbacks"],
  ["sydney sixers", "sixers"],
  ["sydney thunder", "thunder"],
  ["perth scorchers", "scorchers"],
  ["brisbane heat", "heat"],
  ["melbourne stars", "stars"],
  ["melbourne renegades", "renegades"],
  ["adelaide strikers", "strikers"],
  ["hobart hurricanes", "hurricanes"],
  ["eastern storm", "storm"],
  ["south western districts", "swd"],
  ["western province", "wp"],
  ["warriors"],
  ["titans"],
  ["dolphins"],
  ["knights"],
  ["lions"],
  ["biratnagar kings", "biratnagar"],
  ["sudur paschim royals", "sudurpaschim royals", "sudur paschim", "sudurpaschim", "spr"],
  ["janakpur bolts", "janakpur"],
  ["pokhara avengers", "pokhara"],
  ["kathmandu gurkhas", "kathmandu"],
  ["chitwan rhinos", "chitwan"],
  ["lumbini lions", "lumbini"],
  ["karnali yaks", "karnali"],
  ["emirates blues", "emirates blue", "emb"],
  ["sharjah", "sha"],
  ["dubai", "dub"],
  ["fujairah", "fuj"],
  ["ajman", "ajm"],
  ["abu dhabi", "abd"]
];

const STREAM_ALIASES = {};
ALIAS_GROUPS.forEach(group => {
  group.forEach(term => {
    const key = cleanStreamStr(term);
    if (!key) return;
    if (!STREAM_ALIASES[key]) STREAM_ALIASES[key] = [];
    group.forEach(other => {
      const oKey = cleanStreamStr(other);
      if (oKey && !STREAM_ALIASES[key].includes(oKey)) {
        STREAM_ALIASES[key].push(oKey);
      }
    });
  });
});

function cleanStreamStr(text) {
  if (!text) return "";
  return String(text).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeStreamTeamSide(text) {
  return cleanStreamStr(text)
    .replace(/\b(english|hindi|live|stream|match)\b/g, " ")
    .replace(/\bunder\s*19\b/g, "u19")
    .replace(/\b(men|t20i?|odi|test|day|session|innings|20\d{2})\b/g, " ")
    .replace(/\b(1st|2nd|3rd|[4-9]th)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isStreamWomenMatch(obj) {
  const s = typeof obj === "string" ? obj : [obj.team1?.teamName, obj.team2?.teamName, obj.series, obj.description].join(" ");
  return /\b(women|womens|wbbl)\b/i.test(s) || /-w\b/i.test(s) || /W$/.test(obj.team1?.teamSName || "") || /W$/.test(obj.team2?.teamSName || "");
}

function isStreamATeam(name) {
  return /\b[a-z0-9-]+\s+a\b/i.test(String(name || ""));
}

function teamMatchesStream(team, streamStr) {
  if (!team) return false;
  const name = cleanStreamStr(team.teamName);
  const sname = cleanStreamStr(team.teamSName);
  const terms = new Set([name]);
  if (sname.length >= 2) terms.add(sname);
  [name, sname].forEach(key => {
    if (STREAM_ALIASES[key]) {
      STREAM_ALIASES[key].forEach(alias => {
        const cleaned = cleanStreamStr(alias);
        const words = cleaned.split(" ");
        const generic = new Set([
          "blues", "bulls", "dolphins", "eagles", "falcons", "heat",
          "hurricanes", "knights", "lions", "patriots", "renegades",
          "royals", "scorchers", "sixers", "stars", "strikers", "thunder",
          "titans", "warriors", "whites"
        ]);
        if (cleaned && (words.length > 1 || cleaned.length > 3) &&
            !words.every(word => generic.has(word))) {
          terms.add(cleaned);
        }
      });
    }
  });

  const normalizedTerms = new Set(Array.from(terms, normalizeStreamTeamSide));
  return normalizedTerms.has(normalizeStreamTeamSide(streamStr));
}

function matchStreamToCb(streamTitle, cb) {
  if (!streamTitle || !cb) return false;
  const cleanTitle = cleanStreamStr(streamTitle);
  const sides = cleanTitle.split(/\b(?:vs?|versus)\b/);
  if (sides.length !== 2) return false;
  const left = sides[0].split(/\s(?:-|:|\|)\s/).pop().trim();
  let right = sides[1].split(/\s(?:-|:|\|)\s|,/)[0].trim();
  right = right.replace(/\s+in\s+.+$/, "").trim();
  if (!left || !right) return false;
  const streamIsWomen = isStreamWomenMatch(streamTitle);
  const cbIsWomen = isStreamWomenMatch(cb);
  if (streamIsWomen !== cbIsWomen) return false;

  const t1 = cb.team1;
  const t2 = cb.team2;

  const streamIsT1A = isStreamATeam(streamTitle) && teamMatchesStream(t1, cleanTitle);
  const streamIsT2A = isStreamATeam(streamTitle) && teamMatchesStream(t2, cleanTitle);
  const cbIsT1A = isStreamATeam(t1?.teamName);
  const cbIsT2A = isStreamATeam(t2?.teamName);
  if (cbIsT1A !== streamIsT1A && (cbIsT1A || streamIsT1A)) return false;
  if (cbIsT2A !== streamIsT2A && (cbIsT2A || streamIsT2A)) return false;

  return (
    teamMatchesStream(t1, left) && teamMatchesStream(t2, right)
  ) || (
    teamMatchesStream(t1, right) && teamMatchesStream(t2, left)
  );
}

function findUniqueStreamMatch(streamTitle, matches) {
  const matched = new Map();
  matches.forEach(match => {
    if (match?.id && matchStreamToCb(streamTitle, match)) {
      matched.set(String(match.id), match);
    }
  });
  return matched.size === 1 ? matched.values().next().value : null;
}

function isAdminLiveOrStartingSoon(match) {
  const state = String(match?.state || "").toLowerCase();
  const status = String(match?.status || "").toLowerCase();
  if (/\b(live|in progress|innings break|stumps|toss|delayed|rain delay)\b/.test(`${state} ${status}`)) {
    return true;
  }
  const start = Number(match?.startDate);
  if (!start || !Number.isFinite(start)) return false;
  const startMs = start < 1e11 ? start * 1000 : start;
  const delta = startMs - Date.now();
  return delta <= 60 * 60 * 1000 && delta >= -6 * 60 * 60 * 1000;
}

let isAutoSyncingToDatabase = false;

function isCricketStreamAdmin(title = "", category = "", eventName = "") {
  const combined = `${title} ${category} ${eventName}`.toLowerCase();
  const nonCricket = [
    "football", "soccer", "futsal", "basketball", "nba", "tennis", "atp", "wta",
    "hockey", "fih", "badminton", "bwf", "volleyball", "table tennis", "golf",
    "baseball", "mlb", "rugby", "motorsport", "formula 1", "formula one", "f1",
    "motogp", "wrestling", "wwe", "mma", "ufc", "boxing", "kabaddi", "handball",
    "athletics", "swimming", "snooker", "darts", "cycling", "skiing", "judo",
    "karate", "taekwondo", "polo", "chess", "euroleague", "la liga", "serie a",
    "bundesliga", "ligue 1", "champions league", "europa league", "carabao cup",
    "copa del rey", "isl", "fa cup", "durand cup"
  ];
  if (nonCricket.some(w => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(combined))) return false;
  if (category === "cricket" || category === "cricket-match") return true;
  const cricketIndicators = [
    "cricket", "t20", "t10", "odi", "test match", "test", "ipl", "bbl", "cpl", "psl",
    "bpl", "lpl", "wpl", "ilt20", "sa20", "mlc", "hundred", "super smash", "ranji",
    "syed mushtaq", "vijay hazare", "dulip", "irani", "deodhar", "sheffield", "county",
    "blast", "npl", "nepal premier", "icc", "asia cup", "world cup", "trophy", "shield",
    "stumps", "innings", "under-19", "u19", "women"
  ];
  const cricketContext = combined.replace(/\blive cricket stream\b/g, " ");
  return cricketIndicators.some(w => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(cricketContext));
}

async function syncAllrounderToDatabase(manual = false) {
  if (isAutoSyncingToDatabase) return;
  isAutoSyncingToDatabase = true;

  const btn = $("autoSyncAllrounderBtn");
  const statusEl = $("autoSyncStatus");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Syncing to Database...";
  }

  try {
    // 1. Ensure we have live & upcoming Cricbuzz matches
    let candidateMatches = [...(watchMatches.live || []), ...(watchMatches.upcoming || [])];
    if (!candidateMatches.length) {
      try {
        const [liveRes, upRes] = await Promise.allSettled([
          fetch(`${CRICKET_API_BASE}/api/matches/live`).then(r => r.json()),
          fetch(`${CRICKET_API_BASE}/api/matches/upcoming`).then(r => r.json())
        ]);
        if (liveRes.status === "fulfilled" && Array.isArray(liveRes.value?.matches)) {
          candidateMatches.push(...liveRes.value.matches);
        }
        if (upRes.status === "fulfilled" && Array.isArray(upRes.value?.matches)) {
          candidateMatches.push(...upRes.value.matches);
        }
      } catch (e) {}
    }

    // 2. Fetch FanCode direct live feed (iosfancode.vercel.app)
    let fcMatches = [];
    try {
      const fcRes = await fetch("https://raw.githubusercontent.com/drmlive/fancode-live-events/main/fancode.json").then(r => r.json());
      fcMatches = Array.isArray(fcRes) ? fcRes : (Array.isArray(fcRes?.matches) ? fcRes.matches : []);
    } catch (e) {
      console.warn("FanCode feed fetch error:", e);
    }

    const liveStreamsToInsert = [];

        // FanCode direct streams
    for (const fc of fcMatches) {
      const cat = String(fc.event_category || fc.category || "").toLowerCase();
      const eventName = String(fc.event_name || "");
      const rawTitle = String(fc.match_name || fc.title || "");
      const status = String(fc.status || "").toUpperCase();
      const isFcLive = status.includes("LIVE") || fc.isLive === true;
      if (!isFcLive) continue;

      const matchId = String(fc.match_id || fc.id || "").trim();
      if (!matchId || !rawTitle) continue;
      // Live streams from iosfancode ALWAYS end with _ENG
      if (!matchId.toUpperCase().endsWith("_ENG")) continue;
      if (!isCricketStreamAdmin(rawTitle, cat, eventName)) continue;
      const playerUrl = `https://iosfancode.vercel.app/?watch=${encodeURIComponent(matchId)}`;
      const cleanTitle = rawTitle.replace(/\[.*?\]|\(.*?\)/g, "").trim() || rawTitle;

      const cb = findUniqueStreamMatch(
        cleanTitle,
        candidateMatches.filter(isAdminLiveOrStartingSoon)
      );
      if (!cb) continue;
      const midStr = String(cb.id);
      const alreadyQueued = liveStreamsToInsert.some(x =>
        x.matchId === midStr && x.source === "fancode"
      );
      const alreadyInDb = content.some(c =>
        isCricketWatchLink(c) &&
        cricketWatchMatchId(c) === midStr &&
        (String(c.media_url || "").includes("iosfancode") ||
         String(c.public_id || "").startsWith("auto_"))
      );
      if (!alreadyQueued && !alreadyInDb) {
        liveStreamsToInsert.push({
          matchId: midStr,
          source: "fancode",
          playerUrl,
          title: rawTitle
        });
      }
    }



    const defaultSectionSlug = sections.find(x => x.slug === "sports")?.slug
      || sections[0]?.slug
      || "sports";

    let insertedCount = 0;

    for (const item of liveStreamsToInsert) {
      const matchCat = `${CRICKET_WATCH_LINK_PREFIX}${item.matchId}`;
      const existing = content.filter(c => isCricketWatchLink(c) && cricketWatchMatchId(c) === item.matchId);
      const urlExists = existing.some(c => c.media_url === item.playerUrl);
      if (urlExists) continue;

      const sNum = existing.length + 1;
      const payload = {
        title: `Server ${sNum}`,
        public_id: `auto_${item.source}_${item.matchId}_${sNum}`,
        section_slug: defaultSectionSlug,
        category: matchCat,
        kind: "channel",
        parent_id: null,
        media_type: "link",
        media_url: item.playerUrl,
        image_url: null,
        episode_number: null,
        sort_order: sNum,
        published: true,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await db.from("content").insert(payload).select();
      if (!error && data && data.length) {
        content.push(data[0]);
        insertedCount++;
      }
    }

    // 3. Clean up any completed watch links
    await cleanupFinishedWatchLinks(new Set(liveStreamsToInsert.map(x => x.playerUrl)));

    const msg = insertedCount > 0
      ? `✅ Successfully synced ${insertedCount} new stream server(s) directly to Supabase database!`
      : `✅ All live allrounder streams are already synced in Supabase database. (Active: ${liveStreamsToInsert.length} streams)`;

    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.classList.remove("hidden");
      statusEl.style.display = "block";
    }

    renderWatchMatchOptions($("watchMatchCategory")?.value || "live");
    if (manual) {
      setWatchLinkStatus(msg);
      loadSelectedMatchLinks();
    }
  } catch (err) {
    console.warn("syncAllrounderToDatabase error:", err);
    if (statusEl) {
      statusEl.textContent = `Auto-sync warning: ${err.message}`;
      statusEl.classList.remove("hidden");
      statusEl.style.display = "block";
    }
  } finally {
    isAutoSyncingToDatabase = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = "⚡ Sync Allrounder to Database";
    }
  }
}

async function cleanupFinishedWatchLinks(activeLiveUrls = null){
  const watchItems=content.filter(isCricketWatchLink);
  if(!watchItems.length)return;

  try{
    const response=await fetch(`${CRICKET_API_BASE}/api/matches/recent`,{
      headers:{Accept:"application/json"}
    });
    const finishedMatchIds=new Set();
    if(response.ok){
      const result=await response.json();
      const recentMatches=Array.isArray(result.matches)?result.matches:[];
      recentMatches.forEach(m=>{
        const s=String(m.state||"").trim().toLowerCase();
        const st=String(m.status||"").trim().toLowerCase();
        if([
          "complete","completed","abandon","abandoned",
          "cancelled","canceled","no result","drawn","forfeit"
        ].includes(s) || st.includes("won by")||st.includes("match tied")||st.includes("no result")||st.includes("match drawn")||st.includes("match abandoned")||st.includes("match cancelled")){
          finishedMatchIds.add(String(m.id));
        }
      });
    }

    (watchMatches.live||[]).forEach(m=>{
      const s=String(m.state||"").trim().toLowerCase();
      if([
        "complete","completed","abandon","abandoned",
        "cancelled","canceled","no result","drawn","forfeit"
      ].includes(s)){
        finishedMatchIds.add(String(m.id));
      }
      const st=String(m.status||"").trim().toLowerCase();
      if(st.includes("won by")||st.includes("match tied")||st.includes("no result")||st.includes("match drawn")||st.includes("match abandoned")||st.includes("match cancelled")){
        finishedMatchIds.add(String(m.id));
      }
    });

    let activeMatchIds = new Set();
    if (activeLiveUrls instanceof Set) {
      watchItems.forEach(item => {
        if (activeLiveUrls.has(String(item.media_url || ""))) {
          activeMatchIds.add(cricketWatchMatchId(item));
        }
      });
    } else {
      const autoResponse = await fetch(`${CRICKET_API_BASE}/api/auto-servers`, {
        headers: { Accept: "application/json" }
      });
      if (!autoResponse.ok) return;
      const autoResult = await autoResponse.json();
      const lastSync = Number(autoResult.last_sync || 0);
      if (!lastSync || Date.now() / 1000 - lastSync > 120) return;
      activeMatchIds = new Set(
        Object.entries(autoResult.servers || {})
          .filter(([, servers]) => Array.isArray(servers) && servers.length)
          .map(([matchId]) => String(matchId))
      );
      activeLiveUrls = new Set(
        Object.values(autoResult.servers || {})
          .flatMap(servers => Array.isArray(servers) ? servers : [])
          .map(server => String(server.media_url || ""))
      );
    }

    const itemsToDelete=watchItems.filter(item=>{
      const mid = cricketWatchMatchId(item);
      const mUrl = String(item.media_url || "");
      const pubId = String(item.public_id || "");
      const isAuto = pubId.startsWith("auto_");
      if (activeMatchIds.has(mid)) return false;

      // 1. Delete allrounder links (legacy)
      if (mUrl.includes("allrounderlive.in")) return true;

      // 2. NEVER delete manual watch links saved by admin for upcoming matches!
      if (!isAuto) {
        // Only delete manual link if match is explicitly completed with a final result
        if (finishedMatchIds.has(mid)) return true;
        return false;
      }

      // 3. For auto-synced links: delete if match finished or stream ended
      if (finishedMatchIds.has(mid)) return true;
      if (activeLiveUrls instanceof Set) {
        if (mUrl.includes("iosfancode.vercel.app") && !activeLiveUrls.has(mUrl)) return true;
        if (pubId.startsWith("auto_") && !activeLiveUrls.has(mUrl)) return true;
      }
      return false;
    });

    if(!itemsToDelete.length)return;

    const idsToDelete=itemsToDelete.map(item=>item.id);
    const affectedMatchIds=[...new Set(itemsToDelete.map(cricketWatchMatchId))];

    const {error}=await db.from("content")
      .delete()
      .in("id",idsToDelete);

    if(!error){
      content=content.filter(item=>!idsToDelete.includes(item.id));
      renderContent();
      const currentSelectedMatchId=$("watchMatch")?.value;
      if(currentSelectedMatchId && affectedMatchIds.includes(currentSelectedMatchId)){
        loadSelectedMatchLinks();
        setWatchLinkStatus("Watch links for this match were deleted because the match has finished or stream ended.");
      }
    }
  }catch(err){
    console.warn("cleanupFinishedWatchLinks admin error:", err);
  }
}



function addWatchLinkRow(item={}){
  if($("watchLinkRows").children.length>=6){
    setWatchLinkStatus("A match can have up to six watch servers.");
    return;
  }

  const row=document.createElement("div");
  row.className="watch-link-row";
  row.dataset.id=item.id||"";

  const titleLabel=document.createElement("label");
  titleLabel.textContent=`Server ${$("watchLinkRows").children.length+1} Title`;
  const title=document.createElement("input");
  title.type="text";
  title.maxLength=150;
  title.required=true;
  title.placeholder="Official stream / Alternate link";
  title.value=item.title||"";
  titleLabel.append(title);

  const urlLabel=document.createElement("label");
  urlLabel.textContent="Watch URL";
  const url=document.createElement("input");
  url.type="url";
  url.required=true;
  url.maxLength=2048;
  url.placeholder="https://…";
  url.value=item.media_url||"";
  urlLabel.append(url);

  const remove=document.createElement("button");
  remove.type="button";
  remove.className="danger";
  remove.textContent="Remove";
  remove.addEventListener("click",()=>{
    row.remove();
    [...$("watchLinkRows").children].forEach((server,index)=>{
      server.querySelector("label").firstChild.textContent=`Server ${index+1} Title`;
    });
    updateWatchLinkControls();
  });

  row.append(titleLabel,urlLabel,remove);
  $("watchLinkRows").append(row);
  updateWatchLinkControls();
}

function updateWatchLinkControls(){
  const count=$("watchLinkRows").children.length;
  $("addWatchLink").disabled=count>=6;
  $("addWatchLink").textContent=count>=6
    ?"Maximum 6 servers"
    :"+ Add another server";
}

function getPublicSiteBase() {
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    return location.origin;
  }
  return "https://cricfreex-freecricket.vercel.app";
}

function shareTeamFlag(team, series = "") {
  const name = typeof team === "object" && team
    ? String(team.teamName || team.teamSName || "")
    : String(team || "");
  const shortName = typeof team === "object" && team
    ? String(team.teamSName || "")
    : "";
  const normalize = value => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const aliases = {
    afghanistan: "af", afg: "af",
    australia: "au", aus: "au",
    bangladesh: "bd", ban: "bd",
    england: "gb-eng", eng: "gb-eng",
    india: "in", ind: "in",
    ireland: "ie", ire: "ie",
    nepal: "np", nep: "np",
    netherlands: "nl", ned: "nl",
    "new zealand": "nz", nzl: "nz", nz: "nz",
    pakistan: "pk", pak: "pk",
    "south africa": "za", rsa: "za", sa: "za",
    "sri lanka": "lk", sl: "lk",
    "west indies": "wi", windies: "wi", wi: "wi",
    zimbabwe: "zw", zim: "zw",
    "united arab emirates": "ae", uae: "ae",
    usa: "us", "united states": "us",
    canada: "ca", can: "ca",
    scotland: "gb-sct", sco: "gb-sct",
    "papua new guinea": "pg", png: "pg",
    oman: "om", namibia: "na", uganda: "ug"
  };
  const countryCodes = new Set([
    "af", "ae", "au", "bd", "ca", "gb", "ie", "in", "lk", "na", "nl",
    "np", "nz", "om", "pg", "pk", "us", "za", "zw"
  ]);
  let code = null;
  for (const candidate of [name, shortName]) {
    const normalized = normalize(candidate);
    code = aliases[normalized] || Object.entries(aliases).find(([alias]) =>
      alias.length > 3 && normalized.startsWith(`${alias} `)
    )?.[1];
    if (code) break;
    if (countryCodes.has(normalized)) {
      code = normalized;
      break;
    }
  }
  if (!code) {
    const context = normalize(series);
    if (/\b(ipl|wpl|ranji|vijay hazare|duleep|irani)\b/.test(context)) code = "in";
    else if (/\b(bbl|big bash|wbbl|sheffield shield)\b/.test(context)) code = "au";
    else if (/\b(psl|pakistan super league)\b/.test(context)) code = "pk";
    else if (/\b(bpl|bangladesh premier league)\b/.test(context)) code = "bd";
    else if (/\b(sa20|csa)\b/.test(context)) code = "za";
    else if (/\b(the hundred|vitality blast|county championship)\b/.test(context)) code = "gb-eng";
    else if (/\b(super smash|plunket shield)\b/.test(context)) code = "nz";
    else if (/\b(lpl|lanka premier league)\b/.test(context)) code = "lk";
  }
  if (!code) return "";
  if (code === "wi") return "🌴";
  if (code === "gb-eng" || code === "gb-sct") {
    const tag = code === "gb-eng" ? "eng" : "sct";
    return `\u{1F3F4}${[...tag].map(char => String.fromCodePoint(0xE0061 + char.charCodeAt(0) - 97)).join("")}\u{E007F}`;
  }
  if (!/^[a-z]{2}$/.test(code)) return "";
  return [...code].map(char => String.fromCodePoint(0x1F1E6 + char.charCodeAt(0) - 97)).join("");
}

function formatMatchShareMessage(match, streamUrl) {
  const teamLabel = team => {
    const name = typeof team === "object" && team
      ? team.teamName || team.teamSName
      : team;
    const flag = shareTeamFlag(team, match?.series);
    return `${name || "Team"}${flag ? ` ${flag}` : ""}`;
  };
  return [
    `🏆 ${match?.series || match?.description || "Live Cricket"}`,
    `🏏 ${teamLabel(match?.team1)} vs ${teamLabel(match?.team2)}`,
    "",
    `🔴 WATCH LIVE : ${streamUrl}`,
    "",
    "⚠️ Open in Chrome Browser"
  ].join("\n");
}

async function copyShareMessage(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (clipboardError) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } finally {
      textarea.remove();
    }
    if (!copied) {
      throw new Error(`Clipboard access failed: ${clipboardError.message}`);
    }
  }
}

function updateWatchShareableLinks(matchId, records) {
  const box = $("watchShareableLinksBox");
  const list = $("watchShareableLinksList");
  if (!box || !list) return;
  if (!matchId) {
    box.classList.add("hidden");
    list.replaceChildren();
    return;
  }

  const base = getPublicSiteBase();
  const allMatches = (watchMatches.live || []).concat(watchMatches.upcoming || []);
  const matchObj = allMatches.find(m => String(m.id) === String(matchId));
  const matchTitle = matchObj
    ? `${matchObj.team1?.teamName || "Team 1"} vs ${matchObj.team2?.teamName || "Team 2"}`
    : `Match ${matchId}`;

  const rows = [...$("watchLinkRows").children];
  const count = (records && records.length)
    ? records.length
    : (rows.length || (selectedMatchLinks && selectedMatchLinks.length ? selectedMatchLinks.length : 1));

  const items = [];
  items.push({
    label: "Match Link",
    url: `${base}/?match=${matchId}`,
    serverIndex: 0,
    desc: "Opens match page & auto-plays Server 1"
  });

  for (let i = 0; i < count; i++) {
    const sNum = i + 1;
    items.push({
      label: `Server ${sNum} Link`,
      url: `${base}/?match=${matchId}&server=${sNum}`,
      serverIndex: i,
      desc: `Directly launches Server ${sNum} for ${matchTitle}`
    });
  }

  const availableServers = records?.length ? records : selectedMatchLinks;
  list.replaceChildren();
  items.forEach(it => {
    const streamUrl = availableServers[it.serverIndex]?.media_url;
    const copyUrl = streamUrl || it.url;
    const shareMessage = formatMatchShareMessage(matchObj, copyUrl);
    const row = document.createElement("div");
    row.className = "watch-share-item";

    const labelSpan = document.createElement("span");
    labelSpan.className = "watch-share-label";
    labelSpan.textContent = it.label;

    const urlCode = document.createElement("code");
    urlCode.className = "watch-share-url";
    urlCode.textContent = copyUrl;
    urlCode.title = `${copyUrl} (${it.desc})`;

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "ghost watch-share-copy-btn";
    copyBtn.textContent = "📋 Copy Message";
    copyBtn.addEventListener("click", async () => {
      try {
        await copyShareMessage(shareMessage);
        copyBtn.textContent = "✓ Copied!";
        copyBtn.style.color = "var(--green)";
        setTimeout(() => {
          copyBtn.textContent = "📋 Copy Message";
          copyBtn.style.color = "";
        }, 2000);
      } catch (error) {
        setWatchLinkStatus(`Could not copy share message: ${error.message}`, true);
      }
    });

    row.append(labelSpan, urlCode, copyBtn);
    list.appendChild(row);
  });

  box.classList.remove("hidden");
}

async function loadSelectedMatchLinks(){
  const matchId=$("watchMatch").value;
  selectedMatchLinks=matchId
    ?content.filter(item=>
      isCricketWatchLink(item)&&
      cricketWatchMatchId(item)===matchId
    )
    :[];

  // If content in memory does not have servers yet, check if the match object has auto_servers or servers,
  // or fetch directly from /api/auto-servers or Supabase!
  if(matchId && !selectedMatchLinks.length){
    const selectedMatch = (watchMatches.live || []).concat(watchMatches.upcoming || []).find(m => String(m.id) === matchId);
    const autoList = selectedMatch?.servers || selectedMatch?.auto_servers || [];
    if(autoList.length){
      selectedMatchLinks = autoList;
    } else {
      try {
        const autoRes = await fetch(`${CRICKET_API_BASE}/api/auto-servers`).then(r => r.json());
        if(autoRes?.servers?.[matchId]){
          selectedMatchLinks = autoRes.servers[matchId];
        }
      } catch(e){}
    }
  }

  $("watchLinkRows").replaceChildren();
  selectedMatchLinks.forEach(addWatchLinkRow);
  if(matchId&&!selectedMatchLinks.length){
    addWatchLinkRow();
  }
  updateWatchShareableLinks(matchId, selectedMatchLinks);
}

$("watchMatchCategory").addEventListener("change",()=>{
  $("watchMatch").value="";
  $("watchLinkRows").replaceChildren();
  selectedMatchLinks=[];
  updateWatchShareableLinks("", []);
  loadCricketMatches($("watchMatchCategory").value);
});

$("watchMatch").addEventListener(
  "change",
  loadSelectedMatchLinks
);

$("addWatchLink").addEventListener("click",()=>{
  if(!$("watchMatch").value){
    setWatchLinkStatus("Select a match before adding watch links.",true);
    return;
  }
  addWatchLinkRow();
  updateWatchShareableLinks($("watchMatch").value);
});

$("refreshWatchMatches").addEventListener("click",()=>{
  loadCricketMatches($("watchMatchCategory").value);
});

const autoSyncBtn = $("autoSyncAllrounderBtn");
if (autoSyncBtn) {
  autoSyncBtn.addEventListener("click", () => syncAllrounderToDatabase(true));
}

$("watchLinksForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const matchId=$("watchMatch").value;
  const rows=[...$("watchLinkRows").children];
  if(!matchId){
    setWatchLinkStatus("Select a match before saving links.",true);
    return;
  }

  const records=[];
  try{
    rows.forEach((row,index)=>{
      const title=row.querySelector('input[type="text"]').value.trim();
      const rawUrl=row.querySelector('input[type="url"]').value.trim();
      let url;
      try{
        url=new URL(rawUrl);
      }catch{
        throw new Error(`Link ${index+1} needs a valid URL.`);
      }
      if(!title){
        throw new Error(`Link ${index+1} needs a title.`);
      }
      if(!["http:","https:"].includes(url.protocol)){
        throw new Error(`Link ${index+1} must use HTTP or HTTPS.`);
      }
      if(url.username||url.password){
        throw new Error(`Link ${index+1} cannot include embedded credentials.`);
      }
      records.push({
        id:row.dataset.id||null,
        title,
        media_url:url.href,
        sort_order:index
      });
    });
  }catch(error){
    setWatchLinkStatus(error.message,true);
    return;
  }
  if(records.length>6){
    setWatchLinkStatus("A match can have up to six watch servers.",true);
    return;
  }

  const button=$("saveWatchLinks");
  button.disabled=true;
  button.textContent="Saving…";
  try{
    const existingIds=new Set(
      selectedMatchLinks.map(item=>item.id)
    );
    const keptIds=new Set(
      records.map(item=>item.id).filter(Boolean)
    );
    const sectionSlug=sections[0]?.slug;
    if(!sectionSlug){
      throw new Error(
        "The default Live Channels section is unavailable. Refresh Admin and try again."
      );
    }

    for(const record of records){
      const payload={
        title:record.title,
        public_id:null,
        section_slug:sectionSlug,
        category:`${CRICKET_WATCH_LINK_PREFIX}${matchId}`,
        kind:"channel",
        parent_id:null,
        media_type:"link",
        media_url:record.media_url,
        image_url:null,
        episode_number:null,
        sort_order:record.sort_order,
        published:true,
        updated_at:new Date().toISOString()
      };
      const result=record.id
        ?await db.from("content").update(payload).eq("id",record.id)
        :await db.from("content").insert(payload);
      if(result.error)throw result.error;
    }

    const removedIds=[...existingIds].filter(id=>!keptIds.has(id));
    if(removedIds.length){
      const {error}=await db.from("content")
        .delete()
        .in("id",removedIds);
      if(error)throw error;
    }

    const matchCategory=`${CRICKET_WATCH_LINK_PREFIX}${matchId}`;
    const {data:savedLinks,error:readError}=await db
      .from("content")
      .select("*")
      .eq("category",matchCategory)
      .order("sort_order");
    if(readError)throw readError;

    content=content.filter(item=>
      !isCricketWatchLink(item)||
      cricketWatchMatchId(item)!==matchId
    ).concat(savedLinks||[]);
    loadSelectedMatchLinks();
    updateWatchShareableLinks(matchId, records);
    const isUpcoming = $("watchMatchCategory")?.value === "upcoming";
    const pubBase = getPublicSiteBase();
    setWatchLinkStatus(
      isUpcoming
        ? `✅ ${records.length} watch link${records.length===1?"":"s"} saved! Tomorrow/when live, viewers will directly stream this. Link: ${pubBase}/?match=${matchId}&server=1`
        : `✅ ${records.length} watch link${records.length===1?"":"s"} saved and live on match card! Link: ${pubBase}/?match=${matchId}&server=1`
    );
  }catch(error){
    console.error(error);
    setWatchLinkStatus(`Could not save match links: ${error.message}`,true);
  }finally{
    button.disabled=false;
    button.textContent="Save Match Links";
  }
});

/* =========================================================
   CONTENT LIST
========================================================= */

function parentName(item){
  if(!item.parent_id)return "";

  return content.find(
    x=>x.id===item.parent_id
  )?.title||"Unknown Show";
}

function renderContent(){
  const query=
    $("contentSearch").value
      .trim()
      .toLowerCase();

  $("contentList").replaceChildren();

  const list=content.filter(item=>{
    if(isCricketWatchLink(item)||isSiteAccessItem(item))return false;
    if(!query)return true;

    return [
      item.title,
      item.public_id,
      item.category,
      item.section_slug,
      item.kind,
      parentName(item)
    ].some(
      x=>x?.toLowerCase().includes(query)
    );
  });

  if(!list.length){
    $("contentList").innerHTML=
      '<div class="empty">No content found.</div>';
    return;
  }

  list.forEach(item=>{
    const row=document.createElement("div");
    row.className="row";

    let thumb;

    if(item.image_url){
      thumb=document.createElement("img");
      thumb.className="thumb";
      thumb.src=item.image_url;
      thumb.loading="lazy";
      thumb.alt="";
    }else{
      thumb=document.createElement("div");
      thumb.className="thumb-placeholder";
      thumb.textContent=
        item.kind==="episode"
          ?"E"
          :item.kind==="series"
            ?"S"
            :"CX";
    }

    const info=document.createElement("div");

    const title=document.createElement("b");
    title.textContent=item.title;

    const details=document.createElement("small");

    const parts=[
      item.kind,
      item.kind==="episode"
        ?`Parent: ${parentName(item)}`
        :null,
      item.section_slug,
      item.category,
      item.public_id,
      item.media_type,
      item.published
        ?"Published"
        :"Draft"
    ].filter(Boolean);

    details.textContent=parts.join(" • ");

    info.append(title,details);

    const actions=document.createElement("div");
    actions.className="actions";

    const edit=document.createElement("button");
    edit.className="ghost";
    edit.textContent="Edit";
    edit.onclick=()=>editContent(item);

    const remove=document.createElement("button");
    remove.className="danger";
    remove.textContent="Delete";
    remove.onclick=()=>removeContent(item);

    actions.append(edit,remove);

    row.append(thumb,info,actions);
    $("contentList").append(row);
  });
}

$("contentSearch").oninput=renderContent;

/* =========================================================
   SELECTORS / EPISODE RULES
========================================================= */

function fillSelectors(){
  const oldSection=$("contentSection").value;

  $("contentSection").replaceChildren();

  sections.forEach(section=>{
    const option=document.createElement("option");
    option.value=section.slug;
    option.textContent=section.name;
    $("contentSection").append(option);
  });

  if(
    sections.some(x=>x.slug===oldSection)
  ){
    $("contentSection").value=oldSection;
  }
}

/* =========================================================
   EDITOR
========================================================= */

function resetEditor(){
  $("contentForm").reset();
  $("contentId").value="";
  $("sortOrder").value="0";
  $("editorHeading").textContent="Add Content";
  $("deleteContent").classList.add("hidden");

  fillSelectors();

  if(sections.length){
    $("contentSection").value=
      sections[0].slug;
  }
}

$("addContent").onclick=()=>{
  resetEditor();

  $("editorPanel").classList.remove("hidden");

  $("editorPanel").scrollIntoView({
    behavior:"smooth",
    block:"start"
  });
};

$("closeEditor").onclick=()=>{
  $("editorPanel").classList.add("hidden");
};

function editContent(item){
  resetEditor();

  $("contentId").value=item.id;
  $("contentTitle").value=item.title||"";
  $("publicId").value=item.public_id||"";
  $("contentSection").value=item.section_slug||"";
  $("contentCategory").value=item.category||"";
  $("mediaUrl").value=item.media_url||"";
  $("sortOrder").value=item.sort_order||0;

  $("editorHeading").textContent="Edit Content";
  $("deleteContent").classList.remove("hidden");
  $("editorPanel").classList.remove("hidden");

  $("editorPanel").scrollIntoView({
    behavior:"smooth"
  });
}

/* =========================================================
   STORAGE
========================================================= */

function storagePath(urlValue){
  if(!urlValue)return null;

  try{
    const url=new URL(urlValue);
    const project=new URL(CONFIG.SUPABASE_URL);

    if(url.host!==project.host){
      return null;
    }

    const markers=[
      "/storage/v1/object/public/media/",
      "/storage/v1/object/sign/media/"
    ];

    for(const marker of markers){
      const index=url.pathname.indexOf(marker);

      if(index!==-1){
        const path=
          url.pathname.slice(
            index+marker.length
          );

        return path
          ?decodeURIComponent(path)
          :null;
      }
    }

    return null;

  }catch{
    return null;
  }
}

async function removePaths(paths){
  const unique=[
    ...new Set(
      paths.filter(Boolean)
    )
  ];

  if(!unique.length)return;

  const {error}=await db.storage
    .from("media")
    .remove(unique);

  if(error)throw error;
}

async function uploadFile(file,type){
  if(!file)return null;

  const allowed=["video/mp4","video/webm"];

  if(!allowed.includes(file.type)){
    throw new Error("Only MP4/WebM videos are allowed.");
  }

  const max=250*1024*1024;

  if(file.size>max){
    throw new Error("Video exceeds 250 MB.");
  }

  const ext=
    file.name
      .split(".")
      .pop()
      ?.replace(/[^a-z0-9]/gi,"")
      .toLowerCase()
    ||
    "mp4";

  const path=
    `${type}/${crypto.randomUUID()}.${ext}`;

  const {error}=await db.storage
    .from("media")
    .upload(
      path,
      file,
      {
        upsert:false,
        contentType:file.type,
        cacheControl:"3600"
      }
    );

  if(error)throw error;

  const {data}=db.storage
    .from("media")
    .getPublicUrl(path);

  if(!data?.publicUrl){
    throw new Error(
      "Could not obtain uploaded media URL."
    );
  }

  return data.publicUrl;
}

/* =========================================================
   SAVE CONTENT
========================================================= */

$("contentForm").onsubmit=async event=>{
  event.preventDefault();

  const button=$("saveContent");

  button.disabled=true;
  button.textContent="Saving...";

  let uploadedVideo=null;

  try{
    const id=$("contentId").value;

    const existing=id
      ?content.find(x=>x.id===id)
      :null;

    const title=$("contentTitle")
      .value
      .trim();

    if(!title){
      throw new Error("Title is required.");
    }

    let mediaUrl=
      $("mediaUrl").value.trim()
      ||
      existing?.media_url
      ||
      null;

    const payload={
      title,
      public_id:
        $("publicId").value.trim()||
        null,

      section_slug:
        $("contentSection").value,

      category:
        $("contentCategory").value.trim()||null,

      kind: existing?.kind || "channel",
      parent_id: existing?.parent_id ?? null,
      media_type: existing?.media_type || "iframe",
      media_url: mediaUrl,
      image_url: existing?.image_url||null,
      episode_number: existing?.episode_number ?? null,
      sort_order: Number($("sortOrder").value)||0,
      published: true,
      updated_at: new Date().toISOString()
    };

    let result;

    if(id){
      result=await db
        .from("content")
        .update(payload)
        .eq("id",id);
    }else{
      result=await db
        .from("content")
        .insert(payload);
    }

    if(result.error){
      throw result.error;
    }

    /*
      New DB state is safe.
      Now remove replaced old media.
    */

    const oldPaths=[];

    if(
      existing?.media_url &&
      uploadedVideo &&
      existing.media_url!==uploadedVideo
    ){
      const path=
        storagePath(
          existing.media_url
        );

      if(path)oldPaths.push(path);
    }

    try{
      await removePaths(oldPaths);
    }catch(cleanError){
      console.warn(
        "Old media cleanup failed:",
        cleanError
      );
    }

    $("editorPanel")
      .classList
      .add("hidden");

    await loadAll();

  }catch(error){
    console.error(error);

    /*
      Upload happened but DB save failed:
      remove freshly uploaded orphan files.
    */

    const paths=[
      storagePath(uploadedVideo)
    ];

    try{
      await removePaths(paths);
    }catch(cleanError){
      console.warn(
        "Failed save cleanup:",
        cleanError
      );
    }

    alert(
      "Save failed: "+
      error.message
    );

  }finally{
    button.disabled=false;
    button.textContent="Save Content";
  }
};

/* =========================================================
   COMPLETE DELETE
========================================================= */

async function collectDeletionRecords(item){
  if(item.kind!=="series"){
    return [item];
  }

  const {data,error}=await db
    .from("content")
    .select(
      "id,image_url,media_url,media_type,parent_id"
    )
    .or(
      `id.eq.${item.id},parent_id.eq.${item.id}`
    );

  if(error)throw error;

  return data||[];
}

async function removeContent(item){
  const series=item.kind==="series";

  const confirmText=series
    ?`Delete "${item.title}"?\n\nThis will permanently delete the show, all episodes, all uploaded posters and all uploaded videos associated with them.`
    :`Delete "${item.title}"?\n\nIts database record and uploaded media will be permanently deleted.`;

  if(!confirm(confirmText))return;

  try{
    /*
      Collect storage URLs BEFORE DB deletion.
    */

    const records=
      await collectDeletionRecords(item);

    const storagePaths=[];

    records.forEach(record=>{
      const image=
        storagePath(
          record.image_url
        );

      const media=
        storagePath(
          record.media_url
        );

      if(image)storagePaths.push(image);
      if(media)storagePaths.push(media);
    });

    /*
      Delete DB.

      Series children disappear through
      ON DELETE CASCADE.
    */

    const {error}=await db
      .from("content")
      .delete()
      .eq("id",item.id);

    if(error)throw error;

    /*
      Delete every Supabase media object
      associated with those records.
    */

    try{
      await removePaths(
        storagePaths
      );
    }catch(storageError){
      console.error(
        "Storage cleanup failed:",
        storageError
      );

      alert(
        "Database content was deleted, but some Storage files could not be removed automatically."
      );
    }

    if(
      $("contentId").value===item.id
    ){
      $("contentId").value="";
      $("editorPanel")
        .classList
        .add("hidden");
    }

    await loadAll();

  }catch(error){
    console.error(error);

    alert(
      "Delete failed: "+
      error.message
    );
  }
}

$("deleteContent").onclick=()=>{
  const item=content.find(
    x=>
      x.id===
      $("contentId").value
  );

  if(item){
    removeContent(item);
  }
};

/* =========================================================
   ORPHAN STORAGE CLEANUP
========================================================= */

/*
  Removes files in media/images and media/videos
  that are not referenced by ANY content record.

  Can be called manually from DevTools:
    cleanupOrphanMedia()

  Or we can later add a Dashboard button.
*/

async function cleanupOrphanMedia(){
  if(!confirm(
    "Scan and permanently delete unreferenced uploaded images/videos?"
  )){
    return;
  }

  try{
    const referenced=
      new Set();

    content.forEach(item=>{
      const image=
        storagePath(
          item.image_url
        );

      const media=
        storagePath(
          item.media_url
        );

      if(image)referenced.add(image);
      if(media)referenced.add(media);
    });

    const orphanPaths=[];

    for(
      const folder of [
        "images",
        "videos"
      ]
    ){
      let offset=0;

      while(true){
        const {data,error}=
          await db.storage
            .from("media")
            .list(
              folder,
              {
                limit:100,
                offset,
                sortBy:{
                  column:"name",
                  order:"asc"
                }
              }
            );

        if(error)throw error;

        const files=data||[];

        files.forEach(file=>{
          /*
            Ignore placeholder folder entries.
          */

          if(!file.name)return;

          const path=
            `${folder}/${file.name}`;

          if(!referenced.has(path)){
            orphanPaths.push(path);
          }
        });

        if(files.length<100){
          break;
        }

        offset+=100;
      }
    }

    if(!orphanPaths.length){
      alert(
        "No orphan media found."
      );

      return;
    }

    if(!confirm(
      `Found ${orphanPaths.length} unreferenced file(s). Delete all?`
    )){
      return;
    }

    /*
      Supabase remove can handle arrays.
      Chunk to avoid oversized requests.
    */

    for(
      let i=0;
      i<orphanPaths.length;
      i+=100
    ){
      await removePaths(
        orphanPaths.slice(
          i,
          i+100
        )
      );
    }

    alert(
      `${orphanPaths.length} orphan media file(s) deleted.`
    );

  }catch(error){
    console.error(error);

    alert(
      "Orphan cleanup failed: "+
      error.message
    );
  }
}

window.cleanupOrphanMedia=
  cleanupOrphanMedia;

/* =========================================================
   WEBSITE SETTINGS
========================================================= */

function fillWebsite(){
  $("siteName").value=
    settings.site_name||
    "CricFreeX";

  $("siteHeroKicker").value=
    settings.hero_kicker||
    "CRICFREEX LIVE";

  $("siteHeroTitle").value=
    settings.hero_title||
    "YOUR GAME.|YOUR SCREEN.";

  $("siteHeroText").value=
    settings.hero_text||"";
}

$("websiteForm").onsubmit=async event=>{
  event.preventDefault();

  const name=
    $("siteName").value.trim();

  if(!name){
    alert("Website name is required.");
    return;
  }

  const {error}=await db
    .from("site_settings")
    .upsert({
      id:1,
      site_name:name,
      hero_kicker:
        $("siteHeroKicker").value.trim(),
      hero_title:
        $("siteHeroTitle").value.trim(),
      hero_text:
        $("siteHeroText").value.trim(),
      updated_at:
        new Date().toISOString()
    });

  if(error){
    alert(error.message);
    return;
  }

  await loadAll();

  alert("Website updated.");
};

/* =========================================================
   SECTIONS
========================================================= */

function renderSections(){
  $("sectionList").replaceChildren();

  if(!sections.length){
    const empty=document.createElement("div");
    empty.className="empty";
    empty.textContent=
      "No sections are configured. New content can still be added to Live Channels.";
    $("sectionList").append(empty);
    return;
  }

  sections.forEach(section=>{
    const row=document.createElement("div");
    row.className="section-row";

    const name=document.createElement("input");
    name.value=section.name;

    const order=document.createElement("input");
    order.type="number";
    order.value=section.sort_order||0;

    const actions=document.createElement("div");
    actions.className="actions";

    const save=document.createElement("button");
    save.className="ghost";
    save.textContent="Save";

    save.onclick=async()=>{
      const newName=name.value.trim();

      if(!newName){
        alert("Section name required.");
        return;
      }

      const {error}=await db
        .from("sections")
        .update({
          name:newName,
          sort_order:
            Number(order.value)||0
        })
        .eq("id",section.id);

      if(error){
        alert(error.message);
        return;
      }

      await loadAll();
    };

    const remove=document.createElement("button");
    remove.className="danger";
    remove.textContent="Delete";

    remove.onclick=async()=>{
      if(
        content.some(
          x=>
            x.section_slug===
            section.slug
        )
      ){
        alert(
          "Delete or move this section's content first."
        );
        return;
      }

      if(
        !confirm(
          `Delete section "${section.name}"?`
        )
      )return;

      const {error}=await db
        .from("sections")
        .delete()
        .eq("id",section.id);

      if(error){
        alert(error.message);
        return;
      }

      await loadAll();
    };

    actions.append(save,remove);
    row.append(name,order,actions);

    $("sectionList").append(row);
  });
}

/* =========================================================
   REALTIME
========================================================= */

let realtimeTimer=null;

function refreshSoon(){
  clearTimeout(realtimeTimer);

  realtimeTimer=
    setTimeout(
      loadAll,
      250
    );
}

db.channel("cricfreex-admin-live")
  .on(
    "postgres_changes",
    {
      event:"*",
      schema:"public",
      table:"content"
    },
    refreshSoon
  )
  .on(
    "postgres_changes",
    {
      event:"*",
      schema:"public",
      table:"sections"
    },
    refreshSoon
  )
  .on(
    "postgres_changes",
    {
      event:"*",
      schema:"public",
      table:"site_settings"
    },
    refreshSoon
  )
  .subscribe();

window.setInterval(()=>{
  cleanupFinishedWatchLinks();
  if(
    document.visibilityState==="visible"&&
    document.querySelector('.tab[data-tab="watchLinks"]')?.classList.contains("active")
  ){
    loadCricketMatches($("watchMatchCategory").value);
  }
},30000);

/* =========================================================
   SUGGESTIONS & REQUESTS
========================================================= */

async function loadSuggestions(){
  const listEl=$("suggestionsList");
  if(listEl&&!suggestions.length){
    listEl.innerHTML='<div class="empty">Loading requests...</div>';
  }

  const fetched=[];
  const seenIds=new Set();

  // 1. Fetch from Supabase suggestions table
  try{
    const {data,error}=await db
      .from("suggestions")
      .select("*")
      .order("created_at",{ascending:false});
    if(!error&&Array.isArray(data)){
      data.forEach(item=>{
        if(item&&item.id){
          seenIds.add(String(item.id));
          fetched.push(item);
        }
      });
    }
  }catch(e){}

  // 2. Fetch from Backend API (/api/suggestions)
  try{
    const urls=[`${CRICKET_API_BASE}/api/suggestions`];
    if(CRICKET_API_BASE && !urls.includes("/api/suggestions")) urls.push("/api/suggestions");
    for(const u of urls){
      try{
        const res=await fetch(u);
        if(res.ok){
          const json=await res.json();
          const apiItems=json.suggestions||[];
          apiItems.forEach(item=>{
            if(item&&item.id&&!seenIds.has(String(item.id))){
              seenIds.add(String(item.id));
              fetched.push(item);
            }
          });
          break;
        }
      }catch(err){}
    }
  }catch(e){}

  // Sort newest first
  fetched.sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
  suggestions=fetched;

  if($("statRequests")){
    $("statRequests").textContent=suggestions.length;
  }

  renderSuggestions();
}

function renderSuggestions(){
  const container=$("suggestionsList");
  if(!container)return;
  container.replaceChildren();

  if(!suggestions.length){
    const empty=document.createElement("div");
    empty.className="empty";
    empty.textContent="No requests or suggestions yet.";
    container.append(empty);
    return;
  }

  suggestions.forEach(item=>{
    const card=document.createElement("div");
    card.className="suggestion-item";
    card.id=`suggestion-${item.id}`;

    const head=document.createElement("div");
    head.className="suggestion-header";

    const left=document.createElement("div");
    left.style.display="flex";
    left.style.alignItems="center";
    left.style.gap="8px";

    const badge=document.createElement("span");
    badge.className="suggestion-badge";
    badge.innerHTML="● REQUEST";

    const words=document.createElement("small");
    words.className="muted";
    const wordCount=item.word_count||(item.message||"").trim().split(/\s+/).filter(Boolean).length;
    words.textContent=`${wordCount} words`;

    left.append(badge,words);

    const time=document.createElement("span");
    time.className="suggestion-time";
    try{
      time.textContent=item.created_at
        ? formatCricketDateTime(item.created_at, false)
        : "";
    }catch(e){
      time.textContent="";
    }

    head.append(left,time);

    const text=document.createElement("p");
    text.className="suggestion-text";
    text.textContent=item.message||"";

    const actions=document.createElement("div");
    actions.className="suggestion-actions";

    const copyBtn=document.createElement("button");
    copyBtn.type="button";
    copyBtn.className="ghost";
    copyBtn.textContent="Copy Message";
    copyBtn.onclick=async()=>{
      try{
        await navigator.clipboard.writeText(item.message||"");
        copyBtn.textContent="Copied! ✓";
        setTimeout(()=>{copyBtn.textContent="Copy Message";},2000);
      }catch(e){
        alert("Copied: "+item.message);
      }
    };

    const delBtn=document.createElement("button");
    delBtn.type="button";
    delBtn.className="danger";
    delBtn.textContent="Delete";
    let deleteConfirming=false;
    delBtn.onclick=async()=>{
      if(!deleteConfirming){
        deleteConfirming=true;
        delBtn.textContent="Confirm Delete?";
        delBtn.style.background="#e50914";
        delBtn.style.color="#fff";
        setTimeout(()=>{
          if(deleteConfirming){
            deleteConfirming=false;
            delBtn.textContent="Delete";
            delBtn.style.background="";
            delBtn.style.color="";
          }
        },4000);
        return;
      }
      delBtn.disabled=true;
      delBtn.textContent="Deleting...";

      // Delete from Supabase
      try{
        await db.from("suggestions").delete().eq("id",item.id);
      }catch(e){}

      // Delete from Backend API
      try{
        let delRes=await fetch(`${CRICKET_API_BASE}/api/suggestions/${item.id}`,{
          method:"DELETE"
        });
        if(!delRes.ok && CRICKET_API_BASE){
          await fetch(`/api/suggestions/${item.id}`,{
            method:"DELETE"
          });
        }
      }catch(e){}

      suggestions=suggestions.filter(s=>String(s.id)!==String(item.id));
      if($("statRequests")){
        $("statRequests").textContent=suggestions.length;
      }
      card.remove();
      if(!suggestions.length){
        renderSuggestions();
      }
    };

    actions.append(copyBtn,delBtn);
    card.append(head,text,actions);
    container.append(card);
  });
}

if($("refreshSuggestions")){
  $("refreshSuggestions").onclick=()=>loadSuggestions();
}

/* =========================================================
   THEME TOGGLE
========================================================= */

/* =========================================================
   PASSWORD & TELEGRAM GATE
========================================================= */

function getSiteAccessItem(){
  return content.find(isSiteAccessItem)||null;
}

async function loadPasswordGate(){
  const statusEl=$("passwordGateStatus");
  if(statusEl){
    statusEl.classList.add("hidden");
    statusEl.textContent="";
  }

  let item=null;

  // 1. Try dedicated site_access table
  try{
    const {data:saData}=await db
      .from("site_access")
      .select("*")
      .eq("id",1)
      .maybeSingle();
    if(saData&&saData.password){
      item={
        title:saData.password,
        media_url:saData.telegram_url||"https://t.me/cricxcreate",
        published:saData.enabled!==false,
        sort_order:saData.delay_seconds||3
      };
    }
  }catch(e){}

  if(!item) item=getSiteAccessItem();

  if(!item){
    try{
      const {data}=await db
        .from("content")
        .select("*")
        .eq("public_id",SITE_ACCESS_PREFIX)
        .maybeSingle();
      if(data){
        item=data;
        const idx=content.findIndex(x=>x.id===data.id);
        if(idx>=0)content[idx]=data;
        else content.push(data);
      }
    }catch(e){
      console.warn("Supabase access fetch error:",e);
    }
  }

  if(!item){
    try{
      const res=await fetch(`${CRICKET_API_BASE}/api/access-control`);
      if(res.ok){
        const json=await res.json();
        if(json){
          item={
            title:json.password||"CRIC",
            media_url:json.telegram_url||"https://t.me/cricxcreate",
            published:json.enabled!==false,
            sort_order:json.delay_seconds||3
          };
        }
      }
    }catch(e){}
  }

  const enabled=item?(item.published!==false):true;
  const password=item?(item.title||""):"CRIC";
  const telegramUrl=item?(item.media_url||""):"https://t.me/cricxcreate";
  const delay=item?(item.sort_order||3):3;

  if($("accessGateEnabled"))$("accessGateEnabled").value=enabled?"true":"false";
  if($("accessGatePassword"))$("accessGatePassword").value=password;
  if($("accessGateTelegramUrl"))$("accessGateTelegramUrl").value=telegramUrl;
  if($("accessGateDelay"))$("accessGateDelay").value=delay;
}

async function savePasswordGate(event){
  if(event)event.preventDefault();

  const enabled=$("accessGateEnabled").value==="true";
  const password=$("accessGatePassword").value.trim();
  const telegramUrl=$("accessGateTelegramUrl").value.trim();
  const delay=Math.max(1,Math.min(60,parseInt($("accessGateDelay").value||"3",10)));
  const statusEl=$("passwordGateStatus");
  const saveBtn=$("savePasswordGateBtn");

  if(!password){
    alert("Password cannot be empty.");
    return;
  }
  if(!telegramUrl){
    alert("Telegram channel link is required.");
    return;
  }

  saveBtn.disabled=true;
  saveBtn.textContent="Saving...";

  let savedOk=false;
  let errorMsg="";

  // 1. Supabase site_access table (Primary dedicated table)
  try{
    const {data:saData,error:saError}=await db
      .from("site_access")
      .upsert({
        id:1,
        password:password,
        telegram_url:telegramUrl,
        delay_seconds:delay,
        enabled:enabled,
        updated_at:new Date().toISOString()
      })
      .select()
      .maybeSingle();

    if(!saError&&saData){
      savedOk=true;
    }
  }catch(err){
    console.warn("Supabase site_access save error:",err);
  }

  // 2. Supabase content table (Dual-save)
  try{
    let existing=getSiteAccessItem();
    if(!existing?.id){
      try{
        const {data:remoteRow}=await db
          .from("content")
          .select("*")
          .eq("public_id",SITE_ACCESS_PREFIX)
          .maybeSingle();
        if(remoteRow?.id){
          existing=remoteRow;
        }
      }catch(e){}
    }

    const payload={
      public_id:SITE_ACCESS_PREFIX,
      title:password,
      media_url:telegramUrl,
      category:SITE_ACCESS_PREFIX,
      section_slug:"sports",
      kind:"system",
      published:enabled,
      sort_order:delay,
      updated_at:new Date().toISOString()
    };

    let res;
    if(existing?.id){
      res=await db
        .from("content")
        .update(payload)
        .eq("id",existing.id)
        .select()
        .maybeSingle();
    }else{
      res=await db
        .from("content")
        .insert(payload)
        .select()
        .maybeSingle();
    }

    if(res.error)throw res.error;
    if(res.data){
      const idx=content.findIndex(isSiteAccessItem);
      if(idx>=0)content[idx]=res.data;
      else content.push(res.data);
    }
    savedOk=true;
  }catch(err){
    console.warn("Supabase access save error:",err);
    errorMsg=err.message||"Failed to save to database";
  }

  // 2. Dual-save to backend API
  try{
    const apiPayload={
      enabled,
      password,
      telegram_url:telegramUrl,
      delay_seconds:delay
    };
    const endpoints=[];
    if(CRICKET_API_BASE)endpoints.push(`${CRICKET_API_BASE}/api/access-control`);
    endpoints.push("/api/access-control");

    for(const ep of endpoints){
      try{
        await fetch(ep,{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify(apiPayload)
        });
        savedOk=true;
      }catch(e){}
    }
  }catch(err){
    console.warn("API access save error:",err);
  }

  saveBtn.disabled=false;
  saveBtn.textContent="Save Password & Link";

  if(statusEl){
    statusEl.classList.remove("hidden");
    if(savedOk){
      statusEl.style.color="var(--green)";
      statusEl.textContent=`✅ Access password saved! Active password is now "${password}".`;
      setTimeout(()=>{
        statusEl.classList.add("hidden");
      },5000);
    }else{
      statusEl.style.color="#ff858c";
      statusEl.textContent=`Error saving password: ${errorMsg}`;
    }
  }
}

if($("passwordGateForm")){
  $("passwordGateForm").onsubmit=savePasswordGate;
}
if($("refreshPasswordGate")){
  $("refreshPasswordGate").onclick=()=>loadPasswordGate();
}

function setupAdminTheme(){
  function updateTheme(theme){
    if(theme==="light"){
      document.documentElement.setAttribute("data-theme","light");
      try{localStorage.setItem("cricfreex_theme","light");}catch(e){}
    }else{
      document.documentElement.removeAttribute("data-theme");
      try{localStorage.setItem("cricfreex_theme","dark");}catch(e){}
    }
  }

  document.querySelectorAll(".theme-toggle").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const current=document.documentElement.getAttribute("data-theme")==="light"?"light":"dark";
      updateTheme(current==="light"?"dark":"light");
    });
  });

  window.addEventListener("storage",event=>{
    if(event.key==="cricfreex_theme"){
      updateTheme(event.newValue||"dark");
    }
  });
}

/* =========================================================
   START
========================================================= */

setupAdminTheme();
bootstrap();