"use strict";

(() => {
  if (location.pathname.toLowerCase().endsWith("/index.html") || location.pathname.toLowerCase() === "/index.html") {
    const cleanPath = location.pathname.replace(/\/index\.html$/i, "") || "/";
    history.replaceState(null, "", cleanPath + (location.search || "") + (location.hash || ""));
  }

  function cleanCricketPath(u) {
    const p = (u?.pathname || location.pathname || "/").replace(/\/index\.html$/i, "") || "/";
    return p;
  }

  const config = window.CRICFREEX_CONFIG || {};
  const isPort8765 = location.port === "8765";
  const isLocalHost = location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "0.0.0.0";
  const apiBase = isPort8765
    ? ""
    : (isLocalHost ? "http://127.0.0.1:8765" : String(config.CRICKET_API_URL || "").replace(/\/+$/, ""));
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
    if (/\bIST\b/.test(status)) return status; // Already formatted with IST by backend

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

  const state = {
    page: "live",
    matchTab: "scorecard",
    query: "",
    matches: [],
    extraLiveStreams: [],
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
    },
    autoServers: (function() {
      try {
        const s = localStorage.getItem("cricfreex_auto_servers");
        return s ? JSON.parse(s) : {};
      } catch (e) {
        return {};
      }
    })()
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

  const COUNTRY_FLAGS = {
    "india": "in", "ind": "in", "bharat": "in",
    "australia": "au", "aus": "au",
    "england": "gb-eng", "eng": "gb-eng", "great britain": "gb",
    "pakistan": "pk", "pak": "pk",
    "south africa": "za", "sa": "za", "rsa": "za",
    "new zealand": "nz", "nz": "nz",
    "west indies": "wi", "wi": "wi", "windies": "wi",
    "sri lanka": "lk", "sl": "lk",
    "bangladesh": "bd", "ban": "bd", "bangla": "bd", "bcb": "bd", "bangladesh cricket board": "bd",
    "afghanistan": "af", "afg": "af",
    "nepal": "np", "nep": "np",
    "united states": "us", "usa": "us", "united states of america": "us",
    "zimbabwe": "zw", "zim": "zw",
    "ireland": "ie", "ire": "ie",
    "netherlands": "nl", "ned": "nl", "dutch": "nl",
    "scotland": "gb-sct", "sco": "gb-sct",
    "united arab emirates": "ae", "uae": "ae",
    "oman": "om", "omn": "om",
    "namibia": "na", "nam": "na",
    "canada": "ca", "can": "ca",
    "uganda": "ug", "uga": "ug",
    "papua new guinea": "pg", "png": "pg",
    "kuwait": "kw", "kuw": "kw",
    "gambia": "gm", "gam": "gm",
    "lesotho": "ls", "les": "ls",
    "zambia": "zm", "zam": "zm",
    "mozambique": "mz", "moz": "mz",
    "eswatini": "sz", "swaziland": "sz",
    "cameroon": "cm", "cmr": "cm",
    "mali": "ml",
    "seychelles": "sc", "sey": "sc",
    "qatar": "qa", "qat": "qa",
    "jersey": "je", "jer": "je",
    "guernsey": "gg", "gue": "gg",
    "hong kong": "hk", "hkg": "hk",
    "singapore": "sg", "sgp": "sg", "sin": "sg",
    "malaysia": "my", "mas": "my", "mly": "my",
    "italy": "it", "ita": "it",
    "germany": "de", "ger": "de",
    "spain": "es", "esp": "es",
    "kenya": "ke", "ken": "ke",
    "bermuda": "bm", "ber": "bm",
    "bahrain": "bh", "bhr": "bh",
    "saudi arabia": "sa", "ksa": "sa", "sau": "sa",
    "thailand": "th", "tha": "th",
    "japan": "jp", "jpn": "jp",
    "vanuatu": "vu", "van": "vu",
    "nigeria": "ng", "nga": "ng", "nig": "ng",
    "tanzania": "tz", "tan": "tz",
    "rwanda": "rw", "rwa": "rw",
    "malawi": "mw", "maw": "mw",
    "botswana": "bw", "bot": "bw",
    "ghana": "gh", "gha": "gh",
    "sierra leone": "sl", "sle": "sl",
    "indonesia": "id", "ina": "id",
    "bhutan": "bt", "bhu": "bt",
    "maldives": "mv", "mdv": "mv",
    "cayman islands": "ky", "cay": "ky",
    "argentina": "ar", "arg": "ar",
    "brazil": "br", "bra": "br",
    "denmark": "dk", "den": "dk",
    "norway": "no", "nor": "no",
    "sweden": "se", "swe": "se",
    "finland": "fi", "fin": "fi",
    "france": "fr", "fra": "fr",
    "belgium": "be", "bel": "be",
    "austria": "at", "aut": "at",
    "switzerland": "ch", "sui": "ch",
    "portugal": "pt", "por": "pt",
    "isle of man": "im", "iom": "im",
    "gibraltar": "gi", "gib": "gi",
    "czech republic": "cz", "czechia": "cz", "cze": "cz",
    "romania": "ro", "rou": "ro",
    "hungary": "hu", "hun": "hu",
    "bulgaria": "bg", "bul": "bg",
    "croatia": "hr", "cro": "hr",
    "serbia": "rs", "srb": "rs",
    "cyprus": "cy", "cyp": "cy",
    "malta": "mt", "mlt": "mt",
    "luxembourg": "lu", "lux": "lu",
    "greece": "gr", "gre": "gr",
    "turkey": "tr", "turkiye": "tr", "tur": "tr"
  };

  const INDIAN_TEAMS = new Set([
    "csk", "chennai super kings", "mi", "mumbai indians", "rcb", "royal challengers bangalore", "royal challengers bengaluru",
    "kkr", "kolkata knight riders", "dc", "delhi capitals", "srh", "sunrisers hyderabad", "rr", "rajasthan royals",
    "pbks", "punjab kings", "kings xi punjab", "kxip", "gt", "gujarat titans", "lsg", "lucknow super giants",
    "up warriorz", "gujarat giants", "mumbai indians women", "delhi capitals women", "royal challengers bangalore women",
    "mumbai", "baroda", "delhi", "karnataka", "bengal", "saurashtra", "tamil nadu", "maharashtra", "uttar pradesh",
    "madhya pradesh", "gujarat", "punjab", "rajasthan", "haryana", "vidarbha", "andhra", "hyderabad", "kerala",
    "railways", "services", "jammu & kashmir", "jammu and kashmir", "j&k", "j & k", "himachal pradesh", "jharkhand",
    "assam", "goa", "tripura", "odisha", "orissa", "chhattisgarh", "chandigarh", "uttarakhand", "pondicherry",
    "puducherry", "bihar", "manipur", "meghalaya", "mizoram", "nagaland", "sikkim", "arunachal pradesh",
    "rest of india", "india a", "india b", "india c", "india d", "india blue", "india red", "india green"
  ]);

  const SA_TEAMS = new Set([
    "mi cape town", "paarl royals", "pretoria capitals", "sunrisers eastern cape", "joburg super kings", "durban's super giants", "durbans super giants",
    "titans", "dolphins", "lions", "western province", "warriors", "knights", "boland", "north west", "south africa a"
  ]);

  const NEPAL_TEAMS = new Set([
    "biratnagar kings", "janakpur bolts", "kathmandu gurkhas", "pokhara avengers", "chitwan rhinos", "sudurpaschim royals",
    "karnali yaks", "lumbini lions", "armed police force", "apf club", "nepal police club", "tribhuwan army club",
    "tribhuvan army club", "bagmati province", "gandaki province", "koshi province", "lumbini province",
    "karnali province", "sudurpaschim province", "madhesh province"
  ]);

  const USA_TEAMS = new Set([
    "texas super kings", "mi new york", "los angeles knight riders", "san francisco unicorns", "seattle orcas", "washington freedom",
    "atlanta fire", "silicon valley strikers", "dallas mustangs", "east bay blazers", "houston hurricanes", "morrisville raptors"
  ]);

  const AUS_TEAMS = new Set([
    "adelaide strikers", "brisbane heat", "hobart hurricanes", "melbourne renegades", "melbourne stars", "perth scorchers", "sydney sixers", "sydney thunder",
    "new south wales", "victoria", "queensland", "western australia", "south australia", "tasmania", "australia a"
  ]);

  const ENG_TEAMS = new Set([
    "birmingham phoenix", "london spirit", "manchester originals", "northern superchargers", "oval invincibles", "southern brave", "trent rockets", "welsh fire",
    "yorkshire", "surrey", "lancashire", "warwickshire", "somerset", "hampshire", "essex", "nottinghamshire", "middlesex", "kent", "sussex",
    "gloucestershire", "glamorgan", "durham", "northamptonshire", "leicestershire", "derbyshire", "worcestershire", "england lions"
  ]);

  const PAK_TEAMS = new Set([
    "islamabad united", "karachi kings", "lahore qalandars", "multan sultans", "peshawar zalmi", "quetta gladiators",
    "sindh", "balochistan", "khyber pakhtunkhwa", "central punjab", "southern punjab", "northern", "rawalpindi", "peshawar", "lahore", "karachi", "sialkot", "abbottabad", "faisalabad", "wapda", "sngpl", "pakistan shaheens", "pakistan a"
  ]);

  const WI_TEAMS = new Set([
    "barbados royals", "guyana amazon warriors", "jamaica tallawahs", "st kitts & nevis patriots", "st kitts and nevis patriots", "saint lucia kings", "trinbago knight riders", "antigua & barbuda falcons", "antigua and barbuda falcons",
    "barbados", "guyana", "jamaica", "trinidad & tobago", "trinidad and tobago", "leeward islands", "windward islands", "combined campuses and colleges", "west indies academy", "west indies a"
  ]);

  const NZ_TEAMS = new Set([
    "auckland", "canterbury", "central districts", "northern districts", "otago", "wellington",
    "auckland aces", "canterbury kings", "central stags", "northern brave", "otago volts", "wellington firebirds", "new zealand a", "new zealand xi"
  ]);

  const BD_TEAMS = new Set([
    "comilla victorians", "fortune barishal", "rangpur riders", "sylhet strikers", "chattogram challengers", "dhaka dominators", "khulna tigers", "durdanto dhaka",
    "bcb xi", "bangladesh a", "dhaka division", "rajshahi", "rangpur", "sylhet", "khulna", "barisal", "chittagong", "abahani limited", "mohammedan sporting"
  ]);

  const LK_TEAMS = new Set([
    "colombo strikers", "dambulla sixers", "galle marvels", "jaffna kings", "kandy falcons", "b-love kandy", "jaffna stallions",
    "slc reds", "slc blues", "ssc", "ncc", "colts", "sri lanka a"
  ]);

  function getTeamFlagCode(rawName, seriesContext = "") {
    if (!rawName || typeof rawName !== "string") return null;
    const name = rawName.trim().toLowerCase()
      .replace(/-w$/i, "")
      .replace(/-m$/i, "")
      .replace(/-u19$/i, "")
      .replace(/\s+(women|men|u19|under-19|u-19|xi|a|b|c|d|academy|lions|shaheens)$/i, "")
      .trim();
    const rawLower = rawName.trim().toLowerCase();
    const series = String(seriesContext || "").toLowerCase();

    if (COUNTRY_FLAGS[name]) return COUNTRY_FLAGS[name];
    if (COUNTRY_FLAGS[rawLower]) return COUNTRY_FLAGS[rawLower];

    if (INDIAN_TEAMS.has(name) || INDIAN_TEAMS.has(rawLower)) return "in";
    if (SA_TEAMS.has(name) || SA_TEAMS.has(rawLower)) return "za";
    if (NEPAL_TEAMS.has(name) || NEPAL_TEAMS.has(rawLower)) return "np";
    if (USA_TEAMS.has(name) || USA_TEAMS.has(rawLower)) return "us";
    if (AUS_TEAMS.has(name) || AUS_TEAMS.has(rawLower)) return "au";
    if (ENG_TEAMS.has(name) || ENG_TEAMS.has(rawLower)) return "gb-eng";
    if (PAK_TEAMS.has(name) || PAK_TEAMS.has(rawLower)) return "pk";
    if (WI_TEAMS.has(name) || WI_TEAMS.has(rawLower)) return "wi";
    if (NZ_TEAMS.has(name) || NZ_TEAMS.has(rawLower)) return "nz";
    if (BD_TEAMS.has(name) || BD_TEAMS.has(rawLower)) return "bd";
    if (LK_TEAMS.has(name) || LK_TEAMS.has(rawLower)) return "lk";

    for (const [key, code] of Object.entries(COUNTRY_FLAGS)) {
      if (key.length >= 4 && (name.includes(key) || rawLower.includes(key))) {
        return code;
      }
    }

    if (/ranji|smat|mushtaq|ipl|wpl|vijay hazare|duleep|irani|deodhar|ck nayudu|cooch behar|tnpl|up t20|maharaja|mpl/i.test(series)) return "in";
    if (/sa20|csa/i.test(series)) return "za";
    if (/nepal|npl|pm cup/i.test(series)) return "np";
    if (/mlc|major league cricket|minor league/i.test(series)) return "us";
    if (/bbl|big bash|wbbl|sheffield shield|marsh cup/i.test(series)) return "au";
    if (/the hundred|vitality blast|t20 blast|county champ/i.test(series)) return "gb-eng";
    if (/psl|pakistan super league|national t20|quaid-e-azam/i.test(series)) return "pk";
    if (/cpl|caribbean premier league|regional 4-day|super50/i.test(series)) return "wi";
    if (/super smash|ford trophy|plunket shield/i.test(series)) return "nz";
    if (/bpl|bangladesh premier league|dhaka premier/i.test(series)) return "bd";
    if (/lpl|lanka premier league/i.test(series)) return "lk";

    for (const [key, code] of Object.entries(COUNTRY_FLAGS)) {
      if (key.length >= 4 && series.includes(key)) {
        return code;
      }
    }

    return null;
  }

  function getTeamFlagElement(rawName, seriesContext = "") {
    if (!rawName) return null;
    const code = getTeamFlagCode(rawName, seriesContext);
    if (code === "wi") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 28 21");
      svg.setAttribute("class", "cricket-flag-icon");
      svg.setAttribute("aria-hidden", "true");
      svg.innerHTML = '<rect width="28" height="21" rx="2" fill="#7B002C"/><circle cx="14" cy="9.5" r="5" fill="#FDB913"/><path d="M14 6v8 M12 14h4" stroke="#006847" stroke-width="1.5" stroke-linecap="round"/><path d="M14 8c-2-2-4-1-5 1c2-1 4-1 5-1z M14 8c2-2 4-1 5 1c-2-1-4-1-5-1z" fill="#006847"/>';
      return svg;
    }
    if (code) {
      const img = document.createElement("img");
      img.className = "cricket-flag-img";
      img.src = `https://flagcdn.com/28x21/${code}.png`;
      img.srcset = `https://flagcdn.com/56x42/${code}.png 2x`;
      img.alt = "";
      img.loading = "lazy";
      img.width = 18;
      img.height = 13;
      img.onerror = () => { img.style.display = "none"; };
      return img;
    }
    const badge = document.createElement("span");
    badge.className = "cricket-flag-badge";
    const initials = String(rawName).trim().slice(0, 2).toUpperCase();
    badge.textContent = initials;
    return badge;
  }

  const IPL_LOGOS = {
    "csk": "https://raw.githubusercontent.com/sarvesharora/ipl/master/assets/team-logo/csk.png",
    "chennai super kings": "https://raw.githubusercontent.com/sarvesharora/ipl/master/assets/team-logo/csk.png",
    "mi": "https://raw.githubusercontent.com/sarvesharora/ipl/master/assets/team-logo/mi.png",
    "mumbai indians": "https://raw.githubusercontent.com/sarvesharora/ipl/master/assets/team-logo/mi.png",
    "rcb": "https://raw.githubusercontent.com/sarvesharora/ipl/master/assets/team-logo/rcb.png",
    "royal challengers bangalore": "https://raw.githubusercontent.com/sarvesharora/ipl/master/assets/team-logo/rcb.png",
    "royal challengers bengaluru": "https://raw.githubusercontent.com/sarvesharora/ipl/master/assets/team-logo/rcb.png",
    "kkr": "https://raw.githubusercontent.com/sarvesharora/ipl/master/assets/team-logo/kkr.png",
    "kolkata knight riders": "https://raw.githubusercontent.com/sarvesharora/ipl/master/assets/team-logo/kkr.png",
    "dc": "https://raw.githubusercontent.com/sarvesharora/ipl/master/assets/team-logo/dc.png",
    "delhi capitals": "https://raw.githubusercontent.com/sarvesharora/ipl/master/assets/team-logo/dc.png",
    "rr": "https://raw.githubusercontent.com/sarvesharora/ipl/master/assets/team-logo/rr.png",
    "rajasthan royals": "https://raw.githubusercontent.com/sarvesharora/ipl/master/assets/team-logo/rr.png",
    "srh": "https://raw.githubusercontent.com/sarvesharora/ipl/master/assets/team-logo/srh.png",
    "sunrisers hyderabad": "https://raw.githubusercontent.com/sarvesharora/ipl/master/assets/team-logo/srh.png",
    "pbks": "https://raw.githubusercontent.com/sarvesharora/ipl/master/assets/team-logo/kp.png",
    "punjab kings": "https://raw.githubusercontent.com/sarvesharora/ipl/master/assets/team-logo/kp.png",
    "gt": "https://images.seeklogo.com/logo-png/43/2/gujarat-titans-ipl-logo-png_seeklogo-431226.png",
    "gujarat titans": "https://images.seeklogo.com/logo-png/43/2/gujarat-titans-ipl-logo-png_seeklogo-431226.png",
    "lsg": "https://images.seeklogo.com/logo-png/46/1/lucknow-super-giants-logo-png_seeklogo-465449.png",
    "lucknow super giants": "https://images.seeklogo.com/logo-png/46/1/lucknow-super-giants-logo-png_seeklogo-465449.png"
  };

  const CRICINFO_BUNDLED_LOGOS = {
    "adelaide strikers women": "https://a.espncdn.com/i/teamlogos/cricket/500/896431.png",
    "adelaidestrikerswomen": "https://a.espncdn.com/i/teamlogos/cricket/500/896431.png",
    "afg": "https://a.espncdn.com/i/teamlogos/cricket/500/40.png",
    "afg19": "https://a.espncdn.com/i/teamlogos/cricket/500/228132.png",
    "afghanistan": "https://a.espncdn.com/i/teamlogos/cricket/500/40.png",
    "afghanistan under-19s": "https://a.espncdn.com/i/teamlogos/cricket/500/228132.png",
    "afghanistanunder19s": "https://a.espncdn.com/i/teamlogos/cricket/500/228132.png",
    "andhra": "https://a.espncdn.com/i/teamlogos/cricket/500/1541.png",
    "ap": "https://a.espncdn.com/i/teamlogos/cricket/500/1541.png",
    "arp": "https://a.espncdn.com/i/teamlogos/cricket/500/1156779.png",
    "arunachal pradesh": "https://a.espncdn.com/i/teamlogos/cricket/500/1156779.png",
    "arunachalpradesh": "https://a.espncdn.com/i/teamlogos/cricket/500/1156779.png",
    "as-w": "https://a.espncdn.com/i/teamlogos/cricket/500/896431.png",
    "assam": "https://a.espncdn.com/i/teamlogos/cricket/500/1550.png",
    "auck": "https://a.espncdn.com/i/teamlogos/cricket/500/2459.png",
    "auckland": "https://a.espncdn.com/i/teamlogos/cricket/500/2459.png",
    "aus": "https://a.espncdn.com/i/teamlogos/cricket/500/2.png",
    "australia": "https://a.espncdn.com/i/teamlogos/cricket/500/2.png",
    "ban": "https://a.espncdn.com/i/teamlogos/cricket/500/25.png",
    "ban19": "https://a.espncdn.com/i/teamlogos/cricket/500/672.png",
    "bangladesh": "https://a.espncdn.com/i/teamlogos/cricket/500/25.png",
    "bangladesh under-19s": "https://a.espncdn.com/i/teamlogos/cricket/500/672.png",
    "bangladeshunder19s": "https://a.espncdn.com/i/teamlogos/cricket/500/672.png",
    "bar": "https://a.espncdn.com/i/teamlogos/cricket/500/662.png",
    "barishal division": "https://a.espncdn.com/i/teamlogos/cricket/500/662.png",
    "barishaldivision": "https://a.espncdn.com/i/teamlogos/cricket/500/662.png",
    "baroda": "https://a.espncdn.com/i/teamlogos/cricket/500/1559.png",
    "beng": "https://a.espncdn.com/i/teamlogos/cricket/500/1572.png",
    "bengal": "https://a.espncdn.com/i/teamlogos/cricket/500/1572.png",
    "bh-w": "https://a.espncdn.com/i/teamlogos/cricket/500/896397.png",
    "bihar": "https://a.espncdn.com/i/teamlogos/cricket/500/1585.png",
    "bik": "https://a.espncdn.com/i/teamlogos/cricket/500/1462631.png",
    "biratnagar kings": "https://a.espncdn.com/i/teamlogos/cricket/500/1462631.png",
    "biratnagarkings": "https://a.espncdn.com/i/teamlogos/cricket/500/1462631.png",
    "bol": "https://a.espncdn.com/i/teamlogos/cricket/500/3161.png",
    "boland": "https://a.espncdn.com/i/teamlogos/cricket/500/3161.png",
    "boland women": "https://a.espncdn.com/i/teamlogos/cricket/500/3162.png",
    "bolandwomen": "https://a.espncdn.com/i/teamlogos/cricket/500/3162.png",
    "bolwm": "https://a.espncdn.com/i/teamlogos/cricket/500/3162.png",
    "brisbane heat women": "https://a.espncdn.com/i/teamlogos/cricket/500/896397.png",
    "brisbaneheatwomen": "https://a.espncdn.com/i/teamlogos/cricket/500/896397.png",
    "broda": "https://a.espncdn.com/i/teamlogos/cricket/500/1559.png",
    "can": "https://a.espncdn.com/i/teamlogos/cricket/500/12.png",
    "canada": "https://a.espncdn.com/i/teamlogos/cricket/500/12.png",
    "cant": "https://a.espncdn.com/i/teamlogos/cricket/500/2469.png",
    "canterbury": "https://a.espncdn.com/i/teamlogos/cricket/500/2469.png",
    "cd": "https://a.espncdn.com/i/teamlogos/cricket/500/2482.png",
    "central districts": "https://a.espncdn.com/i/teamlogos/cricket/500/2482.png",
    "centraldistricts": "https://a.espncdn.com/i/teamlogos/cricket/500/2482.png",
    "cgr": "https://a.espncdn.com/i/teamlogos/cricket/500/427424.png",
    "chandigarh": "https://a.espncdn.com/i/teamlogos/cricket/500/1641.png",
    "chatt": "https://a.espncdn.com/i/teamlogos/cricket/500/679.png",
    "chattogram division": "https://a.espncdn.com/i/teamlogos/cricket/500/679.png",
    "chattogramdivision": "https://a.espncdn.com/i/teamlogos/cricket/500/679.png",
    "chd": "https://a.espncdn.com/i/teamlogos/cricket/500/1641.png",
    "chhattisgarh": "https://a.espncdn.com/i/teamlogos/cricket/500/427424.png",
    "chitwan rhinos": "https://a.espncdn.com/i/teamlogos/cricket/500/1462633.png",
    "chitwanrhinos": "https://a.espncdn.com/i/teamlogos/cricket/500/1462633.png",
    "chr": "https://a.espncdn.com/i/teamlogos/cricket/500/1462633.png",
    "delhi": "https://a.espncdn.com/i/teamlogos/cricket/500/1668.png",
    "den": "https://a.espncdn.com/i/teamlogos/cricket/500/13.png",
    "denmark": "https://a.espncdn.com/i/teamlogos/cricket/500/13.png",
    "dha": "https://a.espncdn.com/i/teamlogos/cricket/500/682.png",
    "dhaka division": "https://a.espncdn.com/i/teamlogos/cricket/500/682.png",
    "dhakadivision": "https://a.espncdn.com/i/teamlogos/cricket/500/682.png",
    "diasqua little sai wan cricket club": "https://a.espncdn.com/i/teamlogos/cricket/500/918645.png",
    "diasqualittlesaiwancricketclub": "https://a.espncdn.com/i/teamlogos/cricket/500/918645.png",
    "dlswc": "https://a.espncdn.com/i/teamlogos/cricket/500/918645.png",
    "dol-w": "https://a.espncdn.com/i/teamlogos/cricket/500/1334886.png",
    "dolph": "https://a.espncdn.com/i/teamlogos/cricket/500/3199.png",
    "dolphins": "https://a.espncdn.com/i/teamlogos/cricket/500/3199.png",
    "dolphins women": "https://a.espncdn.com/i/teamlogos/cricket/500/1334886.png",
    "dolphinswomen": "https://a.espncdn.com/i/teamlogos/cricket/500/1334886.png",
    "eagle": "https://a.espncdn.com/i/teamlogos/cricket/500/424005.png",
    "easterns": "https://a.espncdn.com/i/teamlogos/cricket/500/3203.png",
    "eastn": "https://a.espncdn.com/i/teamlogos/cricket/500/3203.png",
    "eng": "https://a.espncdn.com/i/teamlogos/cricket/500/1.png",
    "england": "https://a.espncdn.com/i/teamlogos/cricket/500/1.png",
    "england lions": "https://a.espncdn.com/i/teamlogos/cricket/500/952.png",
    "englandlions": "https://a.espncdn.com/i/teamlogos/cricket/500/952.png",
    "faisalabad region": "https://a.espncdn.com/i/teamlogos/cricket/500/2706.png",
    "faisalabadregion": "https://a.espncdn.com/i/teamlogos/cricket/500/2706.png",
    "fata": "https://a.espncdn.com/i/teamlogos/cricket/500/3001.png",
    "federally administered tribal areas": "https://a.espncdn.com/i/teamlogos/cricket/500/3001.png",
    "federallyadministeredtribalareas": "https://a.espncdn.com/i/teamlogos/cricket/500/3001.png",
    "fslb": "https://a.espncdn.com/i/teamlogos/cricket/500/2706.png",
    "goa": "https://a.espncdn.com/i/teamlogos/cricket/500/1717.png",
    "guj": "https://a.espncdn.com/i/teamlogos/cricket/500/1729.png",
    "gujarat": "https://a.espncdn.com/i/teamlogos/cricket/500/1729.png",
    "haryana": "https://a.espncdn.com/i/teamlogos/cricket/500/1757.png",
    "hh-w": "https://a.espncdn.com/i/teamlogos/cricket/500/896433.png",
    "himachal pradesh": "https://a.espncdn.com/i/teamlogos/cricket/500/1752.png",
    "himachalpradesh": "https://a.espncdn.com/i/teamlogos/cricket/500/1752.png",
    "hk": "https://a.espncdn.com/i/teamlogos/cricket/500/19.png",
    "hkg": "https://a.espncdn.com/i/teamlogos/cricket/500/19.png",
    "hkgcc": "https://a.espncdn.com/i/teamlogos/cricket/500/1512.png",
    "hobart hurricanes women": "https://a.espncdn.com/i/teamlogos/cricket/500/896433.png",
    "hobarthurricaneswomen": "https://a.espncdn.com/i/teamlogos/cricket/500/896433.png",
    "hong kong": "https://a.espncdn.com/i/teamlogos/cricket/500/19.png",
    "hong kong cricket club": "https://a.espncdn.com/i/teamlogos/cricket/500/1512.png",
    "hongkong": "https://a.espncdn.com/i/teamlogos/cricket/500/19.png",
    "hongkongcricketclub": "https://a.espncdn.com/i/teamlogos/cricket/500/1512.png",
    "hp": "https://a.espncdn.com/i/teamlogos/cricket/500/1752.png",
    "hryna": "https://a.espncdn.com/i/teamlogos/cricket/500/1757.png",
    "hyd": "https://a.espncdn.com/i/teamlogos/cricket/500/1764.png",
    "hyderabad": "https://a.espncdn.com/i/teamlogos/cricket/500/1764.png",
    "ind": "https://a.espncdn.com/i/teamlogos/cricket/500/6.png",
    "ind-a": "https://a.espncdn.com/i/teamlogos/cricket/500/1781.png",
    "ind-w": "https://a.espncdn.com/i/teamlogos/cricket/500/1812.png",
    "ind19": "https://a.espncdn.com/i/teamlogos/cricket/500/1803.png",
    "india": "https://a.espncdn.com/i/teamlogos/cricket/500/6.png",
    "india a": "https://a.espncdn.com/i/teamlogos/cricket/500/1781.png",
    "india under-19s": "https://a.espncdn.com/i/teamlogos/cricket/500/1803.png",
    "india women": "https://a.espncdn.com/i/teamlogos/cricket/500/1812.png",
    "indiaa": "https://a.espncdn.com/i/teamlogos/cricket/500/1781.png",
    "indiaunder19s": "https://a.espncdn.com/i/teamlogos/cricket/500/1803.png",
    "indiawomen": "https://a.espncdn.com/i/teamlogos/cricket/500/1812.png",
    "ire": "https://a.espncdn.com/i/teamlogos/cricket/500/29.png",
    "ire-a": "https://a.espncdn.com/i/teamlogos/cricket/500/2223.png",
    "ireland": "https://a.espncdn.com/i/teamlogos/cricket/500/29.png",
    "ireland a": "https://a.espncdn.com/i/teamlogos/cricket/500/2223.png",
    "irelanda": "https://a.espncdn.com/i/teamlogos/cricket/500/2223.png",
    "isb": "https://a.espncdn.com/i/teamlogos/cricket/500/382591.png",
    "islamabad region": "https://a.espncdn.com/i/teamlogos/cricket/500/382591.png",
    "islamabadregion": "https://a.espncdn.com/i/teamlogos/cricket/500/382591.png",
    "italy": "https://a.espncdn.com/i/teamlogos/cricket/500/31.png",
    "j & k": "https://a.espncdn.com/i/teamlogos/cricket/500/1828.png",
    "jab": "https://a.espncdn.com/i/teamlogos/cricket/500/1462595.png",
    "jammu & kashmir": "https://a.espncdn.com/i/teamlogos/cricket/500/1828.png",
    "jammukashmir": "https://a.espncdn.com/i/teamlogos/cricket/500/1828.png",
    "janakpur bolts": "https://a.espncdn.com/i/teamlogos/cricket/500/1462595.png",
    "janakpurbolts": "https://a.espncdn.com/i/teamlogos/cricket/500/1462595.png",
    "jer": "https://a.espncdn.com/i/teamlogos/cricket/500/218211.png",
    "jersey": "https://a.espncdn.com/i/teamlogos/cricket/500/218211.png",
    "jharkhand": "https://a.espncdn.com/i/teamlogos/cricket/500/1156778.png",
    "jhk": "https://a.espncdn.com/i/teamlogos/cricket/500/1156778.png",
    "kag": "https://a.espncdn.com/i/teamlogos/cricket/500/1462632.png",
    "karachi region blues": "https://a.espncdn.com/i/teamlogos/cricket/500/2788.png",
    "karachiregionblues": "https://a.espncdn.com/i/teamlogos/cricket/500/2788.png",
    "karnali yaks": "https://a.espncdn.com/i/teamlogos/cricket/500/1462635.png",
    "karnaliyaks": "https://a.espncdn.com/i/teamlogos/cricket/500/1462635.png",
    "karnataka": "https://a.espncdn.com/i/teamlogos/cricket/500/1872.png",
    "kathmandu gorkhas": "https://a.espncdn.com/i/teamlogos/cricket/500/1462632.png",
    "kathmandugorkhas": "https://a.espncdn.com/i/teamlogos/cricket/500/1462632.png",
    "kay": "https://a.espncdn.com/i/teamlogos/cricket/500/1462635.png",
    "ken": "https://a.espncdn.com/i/teamlogos/cricket/500/26.png",
    "kenya": "https://a.espncdn.com/i/teamlogos/cricket/500/26.png",
    "ker": "https://a.espncdn.com/i/teamlogos/cricket/500/1861.png",
    "kerala": "https://a.espncdn.com/i/teamlogos/cricket/500/1861.png",
    "khu": "https://a.espncdn.com/i/teamlogos/cricket/500/700.png",
    "khulna division": "https://a.espncdn.com/i/teamlogos/cricket/500/700.png",
    "khulnadivision": "https://a.espncdn.com/i/teamlogos/cricket/500/700.png",
    "kntka": "https://a.espncdn.com/i/teamlogos/cricket/500/1872.png",
    "kow": "https://a.espncdn.com/i/teamlogos/cricket/500/1521.png",
    "kowloon cricket club": "https://a.espncdn.com/i/teamlogos/cricket/500/1521.png",
    "kowlooncricketclub": "https://a.espncdn.com/i/teamlogos/cricket/500/1521.png",
    "krbls": "https://a.espncdn.com/i/teamlogos/cricket/500/2788.png",
    "kuw": "https://a.espncdn.com/i/teamlogos/cricket/500/38.png",
    "kuwait": "https://a.espncdn.com/i/teamlogos/cricket/500/38.png",
    "lahore region whites": "https://a.espncdn.com/i/teamlogos/cricket/500/2858.png",
    "lahoreregionwhites": "https://a.espncdn.com/i/teamlogos/cricket/500/2858.png",
    "lahw": "https://a.espncdn.com/i/teamlogos/cricket/500/2858.png",
    "lio-w": "https://a.espncdn.com/i/teamlogos/cricket/500/1334890.png",
    "lions": "https://a.espncdn.com/i/teamlogos/cricket/500/952.png",
    "lions women": "https://a.espncdn.com/i/teamlogos/cricket/500/1334890.png",
    "lionswomen": "https://a.espncdn.com/i/teamlogos/cricket/500/1334890.png",
    "lul": "https://a.espncdn.com/i/teamlogos/cricket/500/1462638.png",
    "lumbini lions": "https://a.espncdn.com/i/teamlogos/cricket/500/1462638.png",
    "lumbinilions": "https://a.espncdn.com/i/teamlogos/cricket/500/1462638.png",
    "madhya pradesh": "https://a.espncdn.com/i/teamlogos/cricket/500/1941.png",
    "madhyapradesh": "https://a.espncdn.com/i/teamlogos/cricket/500/1941.png",
    "maha": "https://a.espncdn.com/i/teamlogos/cricket/500/1905.png",
    "maharashtra": "https://a.espncdn.com/i/teamlogos/cricket/500/1905.png",
    "mal19": "https://a.espncdn.com/i/teamlogos/cricket/500/2309.png",
    "malaysia": "https://a.espncdn.com/i/teamlogos/cricket/500/36.png",
    "malaysia under-19s": "https://a.espncdn.com/i/teamlogos/cricket/500/2309.png",
    "malaysiaunder19s": "https://a.espncdn.com/i/teamlogos/cricket/500/2309.png",
    "manipur": "https://a.espncdn.com/i/teamlogos/cricket/500/1943.png",
    "mashonaland eagles": "https://a.espncdn.com/i/teamlogos/cricket/500/424005.png",
    "mashonalandeagles": "https://a.espncdn.com/i/teamlogos/cricket/500/424005.png",
    "matabeleland tuskers": "https://a.espncdn.com/i/teamlogos/cricket/500/424001.png",
    "matabelelandtuskers": "https://a.espncdn.com/i/teamlogos/cricket/500/424001.png",
    "megha": "https://a.espncdn.com/i/teamlogos/cricket/500/1156783.png",
    "meghalaya": "https://a.espncdn.com/i/teamlogos/cricket/500/1156783.png",
    "melbourne renegades women": "https://a.espncdn.com/i/teamlogos/cricket/500/896407.png",
    "melbourne stars women": "https://a.espncdn.com/i/teamlogos/cricket/500/896399.png",
    "melbournerenegadeswomen": "https://a.espncdn.com/i/teamlogos/cricket/500/896407.png",
    "melbournestarswomen": "https://a.espncdn.com/i/teamlogos/cricket/500/896399.png",
    "mid west rhinos": "https://a.espncdn.com/i/teamlogos/cricket/500/424006.png",
    "midwestrhinos": "https://a.espncdn.com/i/teamlogos/cricket/500/424006.png",
    "mis": "https://a.espncdn.com/i/teamlogos/cricket/500/1559949.png",
    "mississauga skyhawks": "https://a.espncdn.com/i/teamlogos/cricket/500/1559949.png",
    "mississaugaskyhawks": "https://a.espncdn.com/i/teamlogos/cricket/500/1559949.png",
    "mizo": "https://a.espncdn.com/i/teamlogos/cricket/500/1156780.png",
    "mizoram": "https://a.espncdn.com/i/teamlogos/cricket/500/1156780.png",
    "mnpr": "https://a.espncdn.com/i/teamlogos/cricket/500/1943.png",
    "montreal warriors": "https://a.espncdn.com/i/teamlogos/cricket/500/1559950.png",
    "montrealwarriors": "https://a.espncdn.com/i/teamlogos/cricket/500/1559950.png",
    "mount": "https://a.espncdn.com/i/teamlogos/cricket/500/424008.png",
    "mountaineers": "https://a.espncdn.com/i/teamlogos/cricket/500/424008.png",
    "mow": "https://a.espncdn.com/i/teamlogos/cricket/500/1559950.png",
    "mp": "https://a.espncdn.com/i/teamlogos/cricket/500/1941.png",
    "mr-w": "https://a.espncdn.com/i/teamlogos/cricket/500/896407.png",
    "ms-w": "https://a.espncdn.com/i/teamlogos/cricket/500/896399.png",
    "mul": "https://a.espncdn.com/i/teamlogos/cricket/500/2905.png",
    "multan region": "https://a.espncdn.com/i/teamlogos/cricket/500/2905.png",
    "multanregion": "https://a.espncdn.com/i/teamlogos/cricket/500/2905.png",
    "mum": "https://a.espncdn.com/i/teamlogos/cricket/500/1603.png",
    "mumbai": "https://a.espncdn.com/i/teamlogos/cricket/500/1603.png",
    "mymensingh division": "https://a.espncdn.com/i/teamlogos/cricket/500/683.png",
    "mymensinghdivision": "https://a.espncdn.com/i/teamlogos/cricket/500/683.png",
    "myms": "https://a.espncdn.com/i/teamlogos/cricket/500/683.png",
    "naga": "https://a.espncdn.com/i/teamlogos/cricket/500/1156781.png",
    "nagaland": "https://a.espncdn.com/i/teamlogos/cricket/500/1156781.png",
    "nam": "https://a.espncdn.com/i/teamlogos/cricket/500/28.png",
    "nam-w": "https://a.espncdn.com/i/teamlogos/cricket/500/545928.png",
    "namibia": "https://a.espncdn.com/i/teamlogos/cricket/500/28.png",
    "namibia women": "https://a.espncdn.com/i/teamlogos/cricket/500/545928.png",
    "namibiawomen": "https://a.espncdn.com/i/teamlogos/cricket/500/545928.png",
    "nd": "https://a.espncdn.com/i/teamlogos/cricket/500/2516.png",
    "ned": "https://a.espncdn.com/i/teamlogos/cricket/500/15.png",
    "nep": "https://a.espncdn.com/i/teamlogos/cricket/500/33.png",
    "nep19": "https://a.espncdn.com/i/teamlogos/cricket/500/2320.png",
    "nepal": "https://a.espncdn.com/i/teamlogos/cricket/500/33.png",
    "nepal under-19s": "https://a.espncdn.com/i/teamlogos/cricket/500/2320.png",
    "nepalunder19s": "https://a.espncdn.com/i/teamlogos/cricket/500/2320.png",
    "netherlands": "https://a.espncdn.com/i/teamlogos/cricket/500/15.png",
    "new south wales": "https://a.espncdn.com/i/teamlogos/cricket/500/387.png",
    "new zealand": "https://a.espncdn.com/i/teamlogos/cricket/500/5.png",
    "new zealand a": "https://a.espncdn.com/i/teamlogos/cricket/500/2540.png",
    "newsouthwales": "https://a.espncdn.com/i/teamlogos/cricket/500/387.png",
    "newzealand": "https://a.espncdn.com/i/teamlogos/cricket/500/5.png",
    "newzealanda": "https://a.espncdn.com/i/teamlogos/cricket/500/2540.png",
    "northern districts": "https://a.espncdn.com/i/teamlogos/cricket/500/2516.png",
    "northerndistricts": "https://a.espncdn.com/i/teamlogos/cricket/500/2516.png",
    "nsw": "https://a.espncdn.com/i/teamlogos/cricket/500/387.png",
    "nz": "https://a.espncdn.com/i/teamlogos/cricket/500/5.png",
    "nz-a": "https://a.espncdn.com/i/teamlogos/cricket/500/2540.png",
    "odisha": "https://a.espncdn.com/i/teamlogos/cricket/500/1988.png",
    "odsa": "https://a.espncdn.com/i/teamlogos/cricket/500/1988.png",
    "oma": "https://a.espncdn.com/i/teamlogos/cricket/500/37.png",
    "oman": "https://a.espncdn.com/i/teamlogos/cricket/500/37.png",
    "oman under-19s": "https://a.espncdn.com/i/teamlogos/cricket/500/2611.png",
    "omanunder19s": "https://a.espncdn.com/i/teamlogos/cricket/500/2611.png",
    "omn19": "https://a.espncdn.com/i/teamlogos/cricket/500/2611.png",
    "otago": "https://a.espncdn.com/i/teamlogos/cricket/500/2570.png",
    "pahkg": "https://a.espncdn.com/i/teamlogos/cricket/500/918647.png",
    "pak": "https://a.espncdn.com/i/teamlogos/cricket/500/7.png",
    "pak19": "https://a.espncdn.com/i/teamlogos/cricket/500/2964.png",
    "pakistan": "https://a.espncdn.com/i/teamlogos/cricket/500/7.png",
    "pakistan association of hong kong": "https://a.espncdn.com/i/teamlogos/cricket/500/918647.png",
    "pakistan under-19s": "https://a.espncdn.com/i/teamlogos/cricket/500/2964.png",
    "pakistanassociationofhongkong": "https://a.espncdn.com/i/teamlogos/cricket/500/918647.png",
    "pakistanunder19s": "https://a.espncdn.com/i/teamlogos/cricket/500/2964.png",
    "papua new guinea": "https://a.espncdn.com/i/teamlogos/cricket/500/20.png",
    "papuanewguinea": "https://a.espncdn.com/i/teamlogos/cricket/500/20.png",
    "perth scorchers women": "https://a.espncdn.com/i/teamlogos/cricket/500/896405.png",
    "perthscorcherswomen": "https://a.espncdn.com/i/teamlogos/cricket/500/896405.png",
    "peshawar region blues": "https://a.espncdn.com/i/teamlogos/cricket/500/1561013.png",
    "peshawarregionblues": "https://a.espncdn.com/i/teamlogos/cricket/500/1561013.png",
    "png": "https://a.espncdn.com/i/teamlogos/cricket/500/20.png",
    "pnjb": "https://a.espncdn.com/i/teamlogos/cricket/500/2012.png",
    "poa": "https://a.espncdn.com/i/teamlogos/cricket/500/1462637.png",
    "pokhara avengers": "https://a.espncdn.com/i/teamlogos/cricket/500/1462637.png",
    "pokharaavengers": "https://a.espncdn.com/i/teamlogos/cricket/500/1462637.png",
    "pondi": "https://a.espncdn.com/i/teamlogos/cricket/500/1156782.png",
    "prb": "https://a.espncdn.com/i/teamlogos/cricket/500/1561013.png",
    "ps-w": "https://a.espncdn.com/i/teamlogos/cricket/500/896405.png",
    "puducherry": "https://a.espncdn.com/i/teamlogos/cricket/500/1156782.png",
    "punjab": "https://a.espncdn.com/i/teamlogos/cricket/500/2012.png",
    "qat": "https://a.espncdn.com/i/teamlogos/cricket/500/136.png",
    "qatar": "https://a.espncdn.com/i/teamlogos/cricket/500/136.png",
    "qld": "https://a.espncdn.com/i/teamlogos/cricket/500/459.png",
    "queensland": "https://a.espncdn.com/i/teamlogos/cricket/500/459.png",
    "railways": "https://a.espncdn.com/i/teamlogos/cricket/500/1823.png",
    "raj": "https://a.espncdn.com/i/teamlogos/cricket/500/2037.png",
    "rajasthan": "https://a.espncdn.com/i/teamlogos/cricket/500/2037.png",
    "rajshahi division": "https://a.espncdn.com/i/teamlogos/cricket/500/711.png",
    "rajshahidivision": "https://a.espncdn.com/i/teamlogos/cricket/500/711.png",
    "ran": "https://a.espncdn.com/i/teamlogos/cricket/500/536705.png",
    "rangpur division": "https://a.espncdn.com/i/teamlogos/cricket/500/536705.png",
    "rangpurdivision": "https://a.espncdn.com/i/teamlogos/cricket/500/536705.png",
    "rhino": "https://a.espncdn.com/i/teamlogos/cricket/500/424006.png",
    "rlys": "https://a.espncdn.com/i/teamlogos/cricket/500/1823.png",
    "rocks": "https://a.espncdn.com/i/teamlogos/cricket/500/424007.png",
    "rsa": "https://a.espncdn.com/i/teamlogos/cricket/500/3.png",
    "rwa-w": "https://a.espncdn.com/i/teamlogos/cricket/500/383829.png",
    "rwanda women": "https://a.espncdn.com/i/teamlogos/cricket/500/383829.png",
    "rwandawomen": "https://a.espncdn.com/i/teamlogos/cricket/500/383829.png",
    "sa": "https://a.espncdn.com/i/teamlogos/cricket/500/3.png",
    "sau": "https://a.espncdn.com/i/teamlogos/cricket/500/2070.png",
    "saurashtra": "https://a.espncdn.com/i/teamlogos/cricket/500/2070.png",
    "sbp": "https://a.espncdn.com/i/teamlogos/cricket/500/3110.png",
    "sco": "https://a.espncdn.com/i/teamlogos/cricket/500/30.png",
    "scot": "https://a.espncdn.com/i/teamlogos/cricket/500/30.png",
    "scotland": "https://a.espncdn.com/i/teamlogos/cricket/500/30.png",
    "services": "https://a.espncdn.com/i/teamlogos/cricket/500/2119.png",
    "sialkot region blues": "https://a.espncdn.com/i/teamlogos/cricket/500/1561012.png",
    "sialkotregionblues": "https://a.espncdn.com/i/teamlogos/cricket/500/1561012.png",
    "sikkim": "https://a.espncdn.com/i/teamlogos/cricket/500/2085.png",
    "sikm": "https://a.espncdn.com/i/teamlogos/cricket/500/2085.png",
    "singapore": "https://a.espncdn.com/i/teamlogos/cricket/500/22.png",
    "sl": "https://a.espncdn.com/i/teamlogos/cricket/500/8.png",
    "sl19": "https://a.espncdn.com/i/teamlogos/cricket/500/3617.png",
    "soa": "https://a.espncdn.com/i/teamlogos/cricket/500/520.png",
    "south africa": "https://a.espncdn.com/i/teamlogos/cricket/500/3.png",
    "south australia": "https://a.espncdn.com/i/teamlogos/cricket/500/520.png",
    "south western districts": "https://a.espncdn.com/i/teamlogos/cricket/500/3337.png",
    "southafrica": "https://a.espncdn.com/i/teamlogos/cricket/500/3.png",
    "southaustralia": "https://a.espncdn.com/i/teamlogos/cricket/500/520.png",
    "southern rocks": "https://a.espncdn.com/i/teamlogos/cricket/500/424007.png",
    "southernrocks": "https://a.espncdn.com/i/teamlogos/cricket/500/424007.png",
    "southwesterndistricts": "https://a.espncdn.com/i/teamlogos/cricket/500/3337.png",
    "spr": "https://a.espncdn.com/i/teamlogos/cricket/500/1462636.png",
    "srb": "https://a.espncdn.com/i/teamlogos/cricket/500/1561012.png",
    "sri lanka": "https://a.espncdn.com/i/teamlogos/cricket/500/8.png",
    "sri lanka under-19s": "https://a.espncdn.com/i/teamlogos/cricket/500/3617.png",
    "srilanka": "https://a.espncdn.com/i/teamlogos/cricket/500/8.png",
    "srilankaunder19s": "https://a.espncdn.com/i/teamlogos/cricket/500/3617.png",
    "ss-w": "https://a.espncdn.com/i/teamlogos/cricket/500/896403.png",
    "st-w": "https://a.espncdn.com/i/teamlogos/cricket/500/896401.png",
    "state bank of pakistan": "https://a.espncdn.com/i/teamlogos/cricket/500/3110.png",
    "statebankofpakistan": "https://a.espncdn.com/i/teamlogos/cricket/500/3110.png",
    "sudur paschim royals": "https://a.espncdn.com/i/teamlogos/cricket/500/1462636.png",
    "sudurpaschimroyals": "https://a.espncdn.com/i/teamlogos/cricket/500/1462636.png",
    "svcs": "https://a.espncdn.com/i/teamlogos/cricket/500/2119.png",
    "swd": "https://a.espncdn.com/i/teamlogos/cricket/500/3337.png",
    "sydney sixers women": "https://a.espncdn.com/i/teamlogos/cricket/500/896403.png",
    "sydney thunder women": "https://a.espncdn.com/i/teamlogos/cricket/500/896401.png",
    "sydneysixerswomen": "https://a.espncdn.com/i/teamlogos/cricket/500/896403.png",
    "sydneythunderwomen": "https://a.espncdn.com/i/teamlogos/cricket/500/896401.png",
    "syl": "https://a.espncdn.com/i/teamlogos/cricket/500/718.png",
    "sylhet division": "https://a.espncdn.com/i/teamlogos/cricket/500/718.png",
    "sylhetdivision": "https://a.espncdn.com/i/teamlogos/cricket/500/718.png",
    "tamil nadu": "https://a.espncdn.com/i/teamlogos/cricket/500/2133.png",
    "tamilnadu": "https://a.espncdn.com/i/teamlogos/cricket/500/2133.png",
    "tas": "https://a.espncdn.com/i/teamlogos/cricket/500/560.png",
    "tasmania": "https://a.espncdn.com/i/teamlogos/cricket/500/560.png",
    "titans": "https://a.espncdn.com/i/teamlogos/cricket/500/3340.png",
    "titans women": "https://a.espncdn.com/i/teamlogos/cricket/500/1334887.png",
    "titanswomen": "https://a.espncdn.com/i/teamlogos/cricket/500/1334887.png",
    "titns": "https://a.espncdn.com/i/teamlogos/cricket/500/3340.png",
    "tn": "https://a.espncdn.com/i/teamlogos/cricket/500/2133.png",
    "tok": "https://a.espncdn.com/i/teamlogos/cricket/500/1559948.png",
    "toronto kings": "https://a.espncdn.com/i/teamlogos/cricket/500/1559948.png",
    "torontokings": "https://a.espncdn.com/i/teamlogos/cricket/500/1559948.png",
    "tpura": "https://a.espncdn.com/i/teamlogos/cricket/500/2149.png",
    "tripura": "https://a.espncdn.com/i/teamlogos/cricket/500/2149.png",
    "ttn-w": "https://a.espncdn.com/i/teamlogos/cricket/500/1334887.png",
    "tusk": "https://a.espncdn.com/i/teamlogos/cricket/500/424001.png",
    "uae": "https://a.espncdn.com/i/teamlogos/cricket/500/27.png",
    "uae19": "https://a.espncdn.com/i/teamlogos/cricket/500/3675.png",
    "uga": "https://a.espncdn.com/i/teamlogos/cricket/500/24.png",
    "uga-w": "https://a.espncdn.com/i/teamlogos/cricket/500/3667.png",
    "uganda": "https://a.espncdn.com/i/teamlogos/cricket/500/24.png",
    "uganda women": "https://a.espncdn.com/i/teamlogos/cricket/500/3667.png",
    "ugandawomen": "https://a.espncdn.com/i/teamlogos/cricket/500/3667.png",
    "united arab emirates": "https://a.espncdn.com/i/teamlogos/cricket/500/27.png",
    "united arab emirates under-19s": "https://a.espncdn.com/i/teamlogos/cricket/500/3675.png",
    "united states": "https://a.espncdn.com/i/teamlogos/cricket/500/11.png",
    "united states of america women": "https://a.espncdn.com/i/teamlogos/cricket/500/405379.png",
    "unitedarabemirates": "https://a.espncdn.com/i/teamlogos/cricket/500/27.png",
    "unitedarabemiratesunder19s": "https://a.espncdn.com/i/teamlogos/cricket/500/3675.png",
    "unitedstatesofamericawomen": "https://a.espncdn.com/i/teamlogos/cricket/500/405379.png",
    "up": "https://a.espncdn.com/i/teamlogos/cricket/500/2161.png",
    "usa": "https://a.espncdn.com/i/teamlogos/cricket/500/11.png",
    "usa-w": "https://a.espncdn.com/i/teamlogos/cricket/500/405379.png",
    "utk": "https://a.espncdn.com/i/teamlogos/cricket/500/1156784.png",
    "uttar pradesh": "https://a.espncdn.com/i/teamlogos/cricket/500/2161.png",
    "uttarakhand": "https://a.espncdn.com/i/teamlogos/cricket/500/1156784.png",
    "uttarpradesh": "https://a.espncdn.com/i/teamlogos/cricket/500/2161.png",
    "vag": "https://a.espncdn.com/i/teamlogos/cricket/500/1559951.png",
    "vancouver guardians": "https://a.espncdn.com/i/teamlogos/cricket/500/1559951.png",
    "vancouverguardians": "https://a.espncdn.com/i/teamlogos/cricket/500/1559951.png",
    "vic": "https://a.espncdn.com/i/teamlogos/cricket/500/584.png",
    "victoria": "https://a.espncdn.com/i/teamlogos/cricket/500/584.png",
    "vidar": "https://a.espncdn.com/i/teamlogos/cricket/500/2179.png",
    "vidarbha": "https://a.espncdn.com/i/teamlogos/cricket/500/2179.png",
    "wa": "https://a.espncdn.com/i/teamlogos/cricket/500/602.png",
    "war": "https://a.espncdn.com/i/teamlogos/cricket/500/3353.png",
    "warriors": "https://a.espncdn.com/i/teamlogos/cricket/500/3353.png",
    "well": "https://a.espncdn.com/i/teamlogos/cricket/500/2600.png",
    "wellington": "https://a.espncdn.com/i/teamlogos/cricket/500/2600.png",
    "west indies": "https://a.espncdn.com/i/teamlogos/cricket/500/4.png",
    "west indies a": "https://a.espncdn.com/i/teamlogos/cricket/500/3800.png",
    "western australia": "https://a.espncdn.com/i/teamlogos/cricket/500/602.png",
    "western province": "https://a.espncdn.com/i/teamlogos/cricket/500/3357.png",
    "westernaustralia": "https://a.espncdn.com/i/teamlogos/cricket/500/602.png",
    "westernprovince": "https://a.espncdn.com/i/teamlogos/cricket/500/3357.png",
    "westindies": "https://a.espncdn.com/i/teamlogos/cricket/500/4.png",
    "westindiesa": "https://a.espncdn.com/i/teamlogos/cricket/500/3800.png",
    "wi": "https://a.espncdn.com/i/teamlogos/cricket/500/4.png",
    "wi-a": "https://a.espncdn.com/i/teamlogos/cricket/500/3800.png",
    "wpr": "https://a.espncdn.com/i/teamlogos/cricket/500/3357.png",
    "zim": "https://a.espncdn.com/i/teamlogos/cricket/500/9.png",
    "zim-a": "https://a.espncdn.com/i/teamlogos/cricket/500/3858.png",
    "zim-w": "https://a.espncdn.com/i/teamlogos/cricket/500/271866.png",
    "zimbabwe": "https://a.espncdn.com/i/teamlogos/cricket/500/9.png",
    "zimbabwe a": "https://a.espncdn.com/i/teamlogos/cricket/500/3858.png",
    "zimbabwe women": "https://a.espncdn.com/i/teamlogos/cricket/500/271866.png",
    "zimbabwea": "https://a.espncdn.com/i/teamlogos/cricket/500/3858.png",
    "zimbabwewomen": "https://a.espncdn.com/i/teamlogos/cricket/500/271866.png",
  };

  let CRICINFO_TEAM_LOGOS = Object.assign({}, CRICINFO_BUNDLED_LOGOS);
  try {
    const cachedLogos = localStorage.getItem("cricfreex_cricinfo_logos");
    if (cachedLogos) {
      Object.assign(CRICINFO_TEAM_LOGOS, JSON.parse(cachedLogos));
    }
  } catch (e) {}

  // Fetch updated team logos in background and cache for instant 0ms access
  if (typeof window !== "undefined") {
    setTimeout(() => {
      fetch("/api/team-logos").then(r => r.json()).then(res => {
        if (res && res.logos) {
          Object.assign(CRICINFO_TEAM_LOGOS, res.logos);
          try {
            localStorage.setItem("cricfreex_cricinfo_logos", JSON.stringify(CRICINFO_TEAM_LOGOS));
          } catch (e) {}
        }
      }).catch(() => {});
    }, 100);
  }

  const KNOWN_TEAM_ALIASES = {
    "centralstags": "centraldistricts",
    "aucklandaces": "auckland",
    "canterburykings": "canterbury",
    "northernbrave": "northerndistricts",
    "northernknights": "northerndistricts",
    "otagovolts": "otago",
    "wellingtonfirebirds": "wellington",
    "jammukashmir": "jammukashmir",
    "jammuandkashmir": "jammukashmir",
    "jk": "jammukashmir",
    "jandk": "jammukashmir",
    "hyderabadindia": "hyderabad",
    "hyderabad": "hyderabad"
  };

  function normalizeTeamLogoKey(name) {
    if (!name) return "";
    let clean = String(name).replace(/\s*\([^)]*\)/g, "").toLowerCase().trim();
    clean = clean.replace(/\band\b/g, "").replace(/&/g, "");
    return clean.replace(/[^a-z0-9]/g, "").trim();
  }

  function getCricinfoLogoUrl(teamOrName) {
    if (!teamOrName) return null;
    if (typeof teamOrName === "object" && teamOrName) {
      if (teamOrName.cricinfoLogo && /^https?:\/\//i.test(teamOrName.cricinfoLogo)) {
        return teamOrName.cricinfoLogo;
      }
      if (teamOrName.logo && /^https?:\/\//i.test(teamOrName.logo) && teamOrName.logo.includes("espncdn")) {
        return teamOrName.logo;
      }
    }
    const name = typeof teamOrName === "object" && teamOrName
      ? (teamOrName.teamName || teamOrName.teamSName || "")
      : String(teamOrName || "");
    const k = normalizeTeamLogoKey(name);
    if (!k) return null;

    const resolve = (key) => {
      if (!key) return null;
      const v = CRICINFO_TEAM_LOGOS[key];
      if (v) return typeof v === "object" ? v.logo : v;
      return null;
    };

    let res = resolve(k);
    if (res) return res;

    const lower = name.toLowerCase().trim();
    res = resolve(lower);
    if (res) return res;

    if (IPL_LOGOS[lower]) return IPL_LOGOS[lower];
    if (IPL_LOGOS[k]) return IPL_LOGOS[k];

    if (KNOWN_TEAM_ALIASES[k]) {
      res = resolve(KNOWN_TEAM_ALIASES[k]);
      if (res) return res;
    }

    const baseName = name.replace(/\b(women|womens|division|region|whites|blues)\b/gi, "").trim();
    const kBase = normalizeTeamLogoKey(baseName);
    if (kBase && kBase !== k) {
      res = resolve(kBase);
      if (res) return res;
      if (KNOWN_TEAM_ALIASES[kBase]) {
        res = resolve(KNOWN_TEAM_ALIASES[kBase]);
        if (res) return res;
      }
    }

    for (const sfx of ["women", "division", "region"]) {
      res = resolve(kBase + sfx);
      if (res) return res;
    }

    if (k.length >= 4) {
      for (const [key, val] of Object.entries(CRICINFO_TEAM_LOGOS)) {
        if (key.length >= 4 && (k.includes(key) || key.includes(k))) {
          return typeof val === "object" ? val.logo : val;
        }
      }
    }

    return null;
  }

  function getTeamVisualElement(teamOrName, seriesContext = "") {
    if (!teamOrName) return null;
    let teamName = "";
    let imageId = null;
    let cricbuzzLogo = null;

    if (typeof teamOrName === "object" && teamOrName) {
      teamName = teamOrName.teamName || teamOrName.teamSName || "Team";
      imageId = teamOrName.imageId;
      cricbuzzLogo = teamOrName.cricbuzzLogo;
    } else {
      teamName = String(teamOrName || "Team");
    }

    if (!cricbuzzLogo && imageId && !String(imageId).startsWith("http")) {
      cricbuzzLogo = `https://static.cricbuzz.com/a/img/v1/i1/c${imageId}/i.jpg`;
    }

    const cleanName = String(teamName).replace(/\s*\([^)]*\)/g, "").trim() || teamName;

    // 1. Primary Priority: ESPN Cricinfo Logo
    const cricinfoLogo = getCricinfoLogoUrl(teamOrName);
    if (cricinfoLogo) {
      const img = document.createElement("img");
      img.className = "cricket-flag-img cricket-team-logo-img";
      img.src = cricinfoLogo;
      img.alt = cleanName;
      img.loading = "lazy";
      img.width = 18;
      img.height = 18;
      img.onerror = () => {
        // Fallback 1: Cricbuzz Logo
        if (cricbuzzLogo) {
          img.src = cricbuzzLogo;
          img.onerror = () => {
            const flag = getTeamFlagElement(cleanName, seriesContext);
            if (flag) img.replaceWith(flag);
            else img.style.display = "none";
          };
        } else {
          const flag = getTeamFlagElement(cleanName, seriesContext);
          if (flag) img.replaceWith(flag);
          else img.style.display = "none";
        }
      };
      return img;
    }

    // 2. Secondary Priority: Cricbuzz Logo
    if (cricbuzzLogo) {
      const img = document.createElement("img");
      img.className = "cricket-flag-img cricket-team-logo-img";
      img.src = cricbuzzLogo;
      img.alt = cleanName;
      img.loading = "lazy";
      img.width = 18;
      img.height = 18;
      img.onerror = () => {
        const flag = getTeamFlagElement(cleanName, seriesContext);
        if (flag) img.replaceWith(flag);
        else img.style.display = "none";
      };
      return img;
    }

    // 3. Tertiary Priority: Country Flag / Initials badge
    return getTeamFlagElement(cleanName, seriesContext);
  }

  function renderTeamSpan(teamOrName, seriesContext = "", extraClass = "") {
    const rawName = typeof teamOrName === "object" && teamOrName
      ? (teamOrName.teamName || teamOrName.teamSName || "Team")
      : (teamOrName || "Team");
    const cleanName = String(rawName).replace(/\s*\([^)]*\)/g, "").trim() || rawName;
    const span = element("span", `cricket-team-name ${extraClass}`.trim());
    const visual = getTeamVisualElement(teamOrName, seriesContext);
    if (visual) span.appendChild(visual);
    span.appendChild(document.createTextNode(cleanName));
    return span;
  }

  function updateCricketURL(params, push = true) {
    const u = new URL(location.href);
    u.hash = "";

    [
      "view", "channel", "show", "episode",
      "match", "tab", "server", "news",
      "series", "seriesTab", "team", "teamTab", "archive"
    ].forEach(k => u.searchParams.delete(k));

    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v != null && v !== "") {
          u.searchParams.set(k, String(v));
        }
      });
    }

    if (u.searchParams.get("tab") === "live" && u.searchParams.toString() === "tab=live") {
      u.searchParams.delete("tab");
    }

    const path = cleanCricketPath(u);
    const clean = u.searchParams.toString()
      ? `${path}?${u.searchParams.toString()}`
      : path;

    const currentPath = cleanCricketPath(location);
    const current = `${currentPath}${location.search}`;
    if (current !== clean || location.pathname.toLowerCase().endsWith("/index.html")) {
      if (push) {
        history.pushState({}, "", clean);
      } else {
        history.replaceState({}, "", clean);
      }
    }
  }

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
    const primaryUrl = apiURL(path);
    const controller = new AbortController();
    const fetchTimer = setTimeout(() => controller.abort(), 4500);
    try {
      response = await fetch(primaryUrl, {
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });
      clearTimeout(fetchTimer);
    } catch {
      clearTimeout(fetchTimer);
      // Fallback to remote Render API if localhost fails
      const fallbackBase = String(config.CRICKET_API_URL || "https://cricfreex.onrender.com").replace(/\/+$/, "");
      if (fallbackBase && !primaryUrl.startsWith(fallbackBase)) {
        const fallbackCtrl = new AbortController();
        const fallbackTimer = setTimeout(() => fallbackCtrl.abort(), 6000);
        try {
          response = await fetch(`${fallbackBase}${path}`, {
            signal: fallbackCtrl.signal,
            headers: { Accept: "application/json" }
          });
          clearTimeout(fallbackTimer);
        } catch {
          clearTimeout(fallbackTimer);
          throw new Error("Cannot reach the cricket data service. Please check your connection.");
        }
      } else {
        throw new Error("Cannot reach the cricket data service. Please check your connection.");
      }
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

  function isMatchStartingSoon(match) {
    if (!match?.startDate) return false;
    let startMs = Number(match.startDate);
    if (!startMs || isNaN(startMs)) return false;
    if (startMs < 1e11) startMs *= 1000;
    const diffMs = startMs - Date.now();
    // 1 hour before scheduled start time (diffMs <= 3600000) OR started within last 6 hours (diffMs > -6 * 3600 * 1000)
    // Excludes matches from yesterday!
    return diffMs <= 3600000 && diffMs > -6 * 3600 * 1000 && !isCompletedMatch(match);
  }

  function isLiveMatch(match) {
    if (!match) return false;
    if (isCompletedMatch(match)) return false;
    const midStr = String(match.id || "");
    if ((match.auto_servers && match.auto_servers.length > 0) ||
        (state.autoServers && state.autoServers[midStr] && state.autoServers[midStr].length > 0)) {
      return true;
    }
    if (isMatchStartingSoon(match)) return true;
    const stateStr = String(match.state || "").trim().toLowerCase();
    const statusStr = String(match.status || "").trim().toLowerCase();
    const liveStates = [
      "in progress", "live", "toss", "stumps", "lunch", "tea", "innings break",
      "break", "drinks", "rain delay", "delayed", "bad light", "badlight",
      "session", "day 1", "day 2", "day 3", "day 4", "day 5"
    ];
    if (liveStates.some(s => stateStr.includes(s))) return true;
    const liveKeywords = [
      "opt to", "trail by", "lead by", "need ", "require ", "target", "chasing", "innings"
    ];
    return liveKeywords.some(k => statusStr.includes(k));
  }

  function isCompletedMatch(match) {
    if (!match) return false;
    const s = String(match?.state || "").trim().toLowerCase();
    if ([
      "complete",
      "completed",
      "abandon",
      "abandoned",
      "cancelled",
      "canceled",
      "no result",
      "drawn",
      "forfeit",
      "result"
    ].includes(s)) {
      return true;
    }
    const status = String(match?.status || "").trim().toLowerCase();
    return (
      status.includes("won by") ||
      status.includes("match tied") ||
      status.includes("tied") ||
      status.includes("no result") ||
      status.includes("match drawn") ||
      status.includes("drawn") ||
      status.includes("match abandoned") ||
      status.includes("abandon") ||
      status.includes("match cancelled") ||
      status.includes("cancel")
    );
  }

  function isMatchIn2DayUpcomingWindow(match) {
    if (!match?.startDate) return false;
    let startMs = Number(match.startDate);
    if (!startMs || isNaN(startMs)) return false;
    if (startMs < 1e11) startMs *= 1000;
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(Date.now() + istOffsetMs);
    const istTodayStartUtcMs = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - istOffsetMs;
    const istTomorrowEndUtcMs = istTodayStartUtcMs + (2 * 24 * 60 * 60 * 1000) - 1;
    // Strict 2-day window: MUST be today or tomorrow (>= today 00:00 IST and <= tomorrow 23:59 IST)
    // Completely excludes matches from yesterday (4 Nov)!
    return startMs >= istTodayStartUtcMs && startMs <= istTomorrowEndUtcMs;
  }

  function isUpcomingMatch(match) {
    if (!match) return false;
    if (isCompletedMatch(match)) return false;
    if (isLiveMatch(match)) return false;
    if (isMatchStartingSoon(match)) return false;
    return isMatchIn2DayUpcomingWindow(match);
  }

  function shouldAllowWatchLinks(match) {
    if (!match) return false;
    if (state.page === "upcoming" || state.page === "recent") return false;
    if (isCompletedMatch(match)) return false;
    if (isUpcomingMatch(match) && !isMatchStartingSoon(match)) return false;

    // Only allow for live matches or matches starting soon (within 1 hr):
    const midStr = String(match.id);
    const hasAuto = (match.auto_servers && match.auto_servers.length > 0) ||
                    (state.autoServers && state.autoServers[midStr] && state.autoServers[midStr].length > 0);
    const hasManual = watchLinks.some(item => String(item.category).slice(watchLinkPrefix.length) === midStr);

    if (state.page === "live" || state.page === "match" || isLiveMatch(match) || isMatchStartingSoon(match)) {
      return Boolean(hasAuto || hasManual);
    }
    return false;
  }

  function isMatchAtStumps(match) {
    if (!match) return false;
    const stateStr = String(match.state || "").trim().toLowerCase();
    const statusStr = String(match.status || "").trim().toLowerCase();
    return stateStr.includes("stumps") || statusStr.includes("stumps");
  }

  function showCricketToast(message) {
    let toast = document.getElementById("cricketToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "cricketToast";
      toast.className = "cricket-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("is-show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove("is-show");
    }, 3500);
  }

  async function pruneCompletedWatchLinks(knownRecentMatches) {
    if (!watchLinks.length) return;
    try {
      let recentMatches = knownRecentMatches;
      if (!recentMatches) {
        const res = await request("/api/matches/recent");
        recentMatches = Array.isArray(res?.matches) ? res.matches : [];
      }
      const finishedIds = new Set();
      (recentMatches || []).forEach(m => {
        if (isCompletedMatch(m)) finishedIds.add(String(m.id));
      });
      if (state.matches && state.matches.length) {
        state.matches.forEach(m => {
          if (isCompletedMatch(m)) finishedIds.add(String(m.id));
        });
      }

      const itemsToDelete = watchLinks.filter(item => {
        const pubId = String(item.public_id || "");
        // NEVER delete manual watch links saved by admin for upcoming matches!
        if (!pubId.startsWith("auto_")) return false;
        return finishedIds.has(String(item.category).slice(watchLinkPrefix.length));
      });
      if (!itemsToDelete.length) return;

      const deleteIds = itemsToDelete.map(item => item.id);
      watchLinks = watchLinks.filter(item => !deleteIds.includes(item.id));
      if (window.CRICFREEX_CONTENT) {
        window.CRICFREEX_CONTENT = window.CRICFREEX_CONTENT.filter(item => !deleteIds.includes(item.id));
      }

      if (state.activeWatch && finishedIds.has(String(state.activeWatch.match?.id))) {
        const isStillStreaming = (state.extraLiveStreams || []).some(s => String(s.id) === String(state.activeWatch.match?.id)) ||
          Boolean(state.autoServers?.[String(state.activeWatch.match?.id)]?.length);
        if (!isStillStreaming) {
          closeCricketPlayer(true);
        }
      }

      const supabaseClient = window.cricfreexDb || (window.supabase && config.SUPABASE_URL ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY) : null);
      if (supabaseClient) {
        await supabaseClient.from("content").delete().in("id", deleteIds);
      }
    } catch (err) {
      console.warn("pruneCompletedWatchLinks error:", err);
    }
  }

  function getMatchServers(match, allowWatchLinks = true) {
    if (!allowWatchLinks || !match || !match.id) return [];
    if (state.page === "upcoming" || state.page === "recent") return [];
    if (isCompletedMatch(match)) return [];
    if (isUpcomingMatch(match) && !isMatchStartingSoon(match)) return [];
    const matchIdStr = String(match.id);

    // 1. Manual servers configured in Admin panel
    const manualItems = watchLinks.filter(item =>
      String(item.category).slice(watchLinkPrefix.length) === matchIdStr
    ).sort((left, right) =>
      Number(left.sort_order || 0) - Number(right.sort_order || 0)
    );

    // 2. Auto-synced servers from FanCode / backend
    const rawAuto = [
      ...(Array.isArray(match.auto_servers) ? match.auto_servers : []),
      ...(Array.isArray(state.autoServers?.[matchIdStr]) ? state.autoServers[matchIdStr] : [])
    ];
    const autoItems = [];
    const seenAutoUrls = new Set();
    rawAuto.forEach(s => {
      if (s && s.media_url) {
        // Enforce _ENG for all FanCode / iosfancode streams
        if (s.media_url.includes("iosfancode") && !s.media_url.toUpperCase().includes("_ENG")) {
          return;
        }
        if (!seenAutoUrls.has(s.media_url)) {
          seenAutoUrls.add(s.media_url);
          autoItems.push(s);
        }
      }
    });

    const seenUrls = new Set();
    const validLinks = [];

    manualItems.forEach(item => {
      try {
        const parsed = new URL(item.media_url);
        if (["http:", "https:"].includes(parsed.protocol) && !seenUrls.has(parsed.href)) {
          seenUrls.add(parsed.href);
          const sNum = validLinks.length + 1;
          validLinks.push({
            item,
            url: embedSourceURL(parsed.href),
            sourceURL: parsed.href,
            label: `Server ${sNum}`
          });
        }
      } catch {}
    });

    let hasFanCodeServer = validLinks.some(v => v.sourceURL?.includes("iosfancode") || v.item?.source === "fancode");
    autoItems.forEach((autoS) => {
      try {
        const parsed = new URL(autoS.media_url);
        if (["http:", "https:"].includes(parsed.protocol) && !seenUrls.has(parsed.href)) {
          const isFc = autoS.source === "fancode" || parsed.href.includes("iosfancode");
          if (isFc) {
            if (hasFanCodeServer) return; // Exactly 1 FanCode server per match!
            hasFanCodeServer = true;
          }
          seenUrls.add(parsed.href);
          const sNum = validLinks.length + 1;
          validLinks.push({
            item: autoS,
            url: embedSourceURL(parsed.href),
            sourceURL: parsed.href,
            label: `Server ${sNum}`
          });
        }
      } catch {}
    });

    return validLinks.slice(0, 6);
  }

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
    ["abu dhabi", "abd"],
    ["chennai super kings", "csk"],
    ["mumbai indians", "mi"],
    ["royal challengers bengaluru", "royal challengers bangalore", "rcb"],
    ["kolkata knight riders", "kkr"],
    ["delhi capitals", "dc"],
    ["rajasthan royals", "rr"],
    ["punjab kings", "pbks", "kings xi punjab", "kxip"],
    ["sunrisers hyderabad", "srh"],
    ["gujarat titans", "gt"],
    ["lucknow super giants", "lsg"]
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
    const terms = new Set();
    if (name) {
      terms.add(name);
      const stripped = name.split(" ").filter(w => !["women", "team", "men"].includes(w)).join(" ");
      if (stripped) terms.add(stripped);
      name.split(" ").forEach(w => {
        if (w.length >= 4 && !["cricket", "club", "team", "kings", "royals", "super", "giants", "riders", "challengers", "knights", "stars", "titans", "strikers", "heat", "sixers", "thunder", "scorchers", "renegades", "hurricanes", "women", "mens", "eagles", "falcons", "patriots", "lions", "warriors"].includes(w)) {
          terms.add(w);
        }
      });
    }
    if (sname && sname.length >= 2) {
      terms.add(sname);
      if (sname.endsWith("w") && sname.length > 2) terms.add(sname.slice(0, -1));
    }
    [name, sname].forEach(key => {
      if (STREAM_ALIASES[key]) {
        STREAM_ALIASES[key].forEach(a => terms.add(cleanStreamStr(a)));
      }
    });

    const noSpaceStream = streamStr.replace(/\s+/g, "");

    for (const term of terms) {
      if (!term) continue;
      const re = new RegExp("\\b" + term.replace(/\s+/g, "\\s+") + "\\b");
      if (re.test(streamStr)) return true;

      const noSpaceTerm = term.replace(/\s+/g, "");
      if (noSpaceTerm.length >= 4 && noSpaceStream.includes(noSpaceTerm)) return true;
    }
    return false;
  }

  function matchStreamToCb(streamTitle, cb) {
    const cleanStream = cleanStreamStr(streamTitle);
    if (isStreamWomenMatch(streamTitle) !== isStreamWomenMatch(cb)) return false;
    const cbA = isStreamATeam(cb.team1?.teamName) || isStreamATeam(cb.team2?.teamName);
    const stA = isStreamATeam(cleanStream);
    if (cbA !== stA) return false;
    return teamMatchesStream(cb.team1, cleanStream) && teamMatchesStream(cb.team2, cleanStream);
  }

  function updateDomMatchServers() {
    (state.matches || []).forEach(match => {
      const card = root.querySelector(`.cricket-match-card[data-card-match-id="${match.id}"]`);
      if (!card) return;
      const validLinks = getMatchServers(match, shouldAllowWatchLinks(match));
      let linksWrap = card.querySelector(".cricket-watch-links");
      if (validLinks.length) {
        if (!linksWrap) {
          linksWrap = element("div", "cricket-watch-links");
          card.appendChild(linksWrap);
        }
        linksWrap.replaceChildren();
        linksWrap.appendChild(element("strong", "cricket-watch-label", "Watch Live"));
        validLinks.forEach(({ url, sourceURL }, index) => {
          const serverLabel = `Server ${index + 1}`;
          const button = element("button", "cricket-watch-link", `▶ ${serverLabel}`);
          button.type = "button";
          button.setAttribute("data-match-id", String(match.id));
          button.setAttribute("data-server-idx", String(index));
          button.setAttribute(
            "aria-label",
            `${serverLabel} for ${match.team1?.teamName || "Team 1"} vs ${match.team2?.teamName || "Team 2"}`
          );
          const selected = state.activeWatch?.match?.id === match.id &&
            state.activeWatch.serverIndex === index;
          button.classList.toggle("is-selected", selected);
          button.setAttribute("aria-pressed", String(selected));
          button.addEventListener("click", event => {
            event.stopPropagation();
            startMatchServer(match, index, true);
          });
          linksWrap.appendChild(button);
        });
      } else if (linksWrap) {
        linksWrap.remove();
      }
    });

    if (state.page === "match" && state.selectedMatch) {
      renderMatchViewServers(state.selectedMatch);
      if (!state.activeWatch || String(state.activeWatch.match?.id) !== String(state.selectedMatch.id)) {
        const p = new URLSearchParams(location.search);
        const sParam = p.get("server");
        const sIdx = sParam ? Math.max(0, parseInt(sParam, 10) - 1) : 0;
        startMatchServer(state.selectedMatch, sIdx, false);
      }
    }
  }

  function renderMatchViewServers(match, container) {
    const parent = container || root.querySelector(".cricket-content");
    if (!parent || state.page !== "match" || String(state.selectedMatch?.id) !== String(match?.id)) return;
    const validLinks = getMatchServers(match, shouldAllowWatchLinks(match));
    let bar = parent.querySelector(".cricket-match-view-servers");
    if (!validLinks.length) {
      if (isLiveMatch(match) || isMatchStartingSoon(match)) {
        if (!bar) {
          bar = element("div", "cricket-watch-links cricket-match-view-servers");
          bar.style.margin = "12px 0 16px";
          const nav = parent.querySelector(".cricket-tabs");
          if (nav) {
            parent.insertBefore(bar, nav);
          } else {
            parent.appendChild(bar);
          }
        }
        bar.replaceChildren();
        const notice = element("div", "cricket-stream-pending-notice");
        notice.style.padding = "10px 14px";
        notice.style.background = "rgba(255, 152, 0, 0.08)";
        notice.style.border = "1px solid rgba(255, 152, 0, 0.28)";
        notice.style.borderRadius = "8px";
        notice.style.fontSize = "13px";
        notice.style.color = "#ffb74d";
        notice.style.display = "flex";
        notice.style.alignItems = "center";
        notice.style.gap = "8px";
        notice.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ffb74d;box-shadow:0 0 6px #ffb74d;"></span><strong>Live Stream:</strong> Abhi live stream available nahi hai (match live stream aane par yahan Server 1 aa jayega)`;
        bar.appendChild(notice);
      } else if (bar) {
        bar.remove();
      }
      return;
    }
    if (!bar) {
      bar = element("div", "cricket-watch-links cricket-match-view-servers");
      bar.style.margin = "12px 0 16px";
      const nav = parent.querySelector(".cricket-tabs");
      if (nav) {
        parent.insertBefore(bar, nav);
      } else {
        parent.appendChild(bar);
      }
    }
    bar.replaceChildren();
    bar.appendChild(element("strong", "cricket-watch-label", "Watch Live:"));
    validLinks.forEach(({ url, sourceURL }, index) => {
      const serverLabel = `Server ${index + 1}`;
      const button = element("button", "cricket-watch-link", `▶ ${serverLabel}`);
      button.type = "button";
      button.setAttribute("data-match-id", String(match.id));
      button.setAttribute("data-server-idx", String(index));
      button.setAttribute(
        "aria-label",
        `${serverLabel} for ${match.team1?.teamName || "Team 1"} vs ${match.team2?.teamName || "Team 2"}`
      );
      const selected = state.activeWatch?.match?.id === match.id &&
        state.activeWatch.serverIndex === index;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
      button.addEventListener("click", event => {
        event.stopPropagation();
        startMatchServer(match, index, true);
      });
      bar.appendChild(button);
    });
  }

  function formatMatchScoreDisplay(score, isCb = false) {
    if (!score) return isCb ? "Yet to bat" : "LIVE";
    if (typeof score === "string") {
      const s = score.trim();
      if (!s || s === "0/0" || s === "0/0 (0)" || s === "0") return isCb ? "Yet to bat" : "LIVE";
      return s;
    }
    if (score.summary && typeof score.summary === "string" && score.summary.trim()) {
      const s = score.summary.trim();
      if (s && s !== "0/0" && s !== "0/0 (0)" && s !== "0") return s;
    }

    const inningsList = Object.entries(score)
      .filter(([k, v]) => v && typeof v === "object" && (k.startsWith("inngs") || v.runs != null || v.overs != null))
      .map(([k, v]) => v);

    if (!inningsList.length) return isCb ? "Yet to bat" : "LIVE";

    const parts = inningsList.map(innings => {
      if (!innings) return null;
      if (typeof innings === "string") {
        const s = innings.trim();
        return (s && s !== "0/0" && s !== "0/0 (0)" && s !== "0") ? s : null;
      }
      if (innings.summary && typeof innings.summary === "string") {
        const s = innings.summary.trim();
        return (s && s !== "0/0" && s !== "0/0 (0)" && s !== "0") ? s : null;
      }
      const runs = innings.runs;
      const wkts = innings.wickets;
      const ov = innings.overs;
      if (runs == null && wkts == null && ov == null) return null;

      const r = runs ?? 0;
      let wStr = "";
      if (wkts != null) {
        wStr = `/${wkts}`;
      } else if (ov != null) {
        wStr = "/0";
      }

      let ovStr = "";
      if (ov != null) {
        ovStr = ` (${ov})`;
      }

      let decl = innings.isDeclared ? " d" : "";
      return `${r}${wStr}${decl}${ovStr}`;
    }).filter(Boolean);

    return parts.join(" & ") || (isCb ? "Yet to bat" : "LIVE");
  }

  function fetchWithTimeout(url, timeoutMs = 3000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(r => { clearTimeout(timer); return r.json(); })
      .catch(() => null);
  }

  let lastClientSyncTime = 0;
  let clientSyncInProgress = false;

  function isCricketStream(title = "", category = "", eventName = "") {
    const t = String(title || "").toLowerCase();
    const c = String(category || "").toLowerCase();
    const e = String(eventName || "").toLowerCase();
    const combined = `${t} ${c} ${e}`;

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
    if (nonCricket.some(w => combined.includes(w))) return false;
    if (c === "cricket" || c === "cricket-match") return true;

    const cricketIndicators = [
      "cricket", "t20", "t10", "odi", "test match", "test", "ipl", "bbl", "cpl", "psl",
      "bpl", "lpl", "wpl", "ilt20", "sa20", "mlc", "hundred", "super smash", "ranji",
      "syed mushtaq", "vijay hazare", "dulip", "irani", "deodhar", "sheffield", "county",
      "blast", "npl", "nepal premier", "icc", "asia cup", "world cup", "trophy", "shield",
      "stumps", "innings", "under-19", "u19", "women"
    ];
    return cricketIndicators.some(w => combined.includes(w));
  }

  async function syncAllrounderClient(force = false) {
    const now = Date.now();
    if (clientSyncInProgress) return;
    if (!force && now - lastClientSyncTime < 5000) return;
    clientSyncInProgress = true;

    try {
      // Fetch FanCode and backend auto-servers IN PARALLEL with cache-busting timestamp
      const [fcRes, beRes] = await Promise.allSettled([
        fetchWithTimeout(`https://raw.githubusercontent.com/drmlive/fancode-live-events/main/fancode.json?t=${Date.now()}`, 3500),
        fetchWithTimeout(`${apiBase}/api/auto-servers?t=${Date.now()}`, 2500)
      ]);

      const mergedServers = {};
      if (beRes.status === "fulfilled" && beRes.value?.servers && Object.keys(beRes.value.servers).length > 0) {
        Object.assign(mergedServers, beRes.value.servers);
      }

      // Maintain state.allKnownMatches
      if (!state.allKnownMatches) state.allKnownMatches = {};
      (state.matches || []).forEach(m => {
        if (m && m.id) state.allKnownMatches[String(m.id)] = m;
      });

      const candidateMatches = Object.values(state.allKnownMatches);
      if (!candidateMatches.length) candidateMatches.push(...(state.matches || []));

      const newAutoServers = {};
      const unmatchedStreams = [];
      const extraCricbuzzLiveMatches = [];

      if (fcRes.status === "fulfilled") {
        const fcMatches = Array.isArray(fcRes.value) ? fcRes.value : (Array.isArray(fcRes.value?.matches) ? fcRes.value.matches : []);
        for (const fc of fcMatches) {
          const status = String(fc.status || "").toUpperCase();
          const isFcLive = status.includes("LIVE") || fc.isLive === true;

          const cat = String(fc.event_category || fc.category || "").toLowerCase();
          const rawTitle = fc.match_name || fc.title || "";
          const matchId = String(fc.match_id || fc.id || "").trim();
          if (!matchId || !rawTitle) continue;
          // Live streams from iosfancode ALWAYS end with _ENG
          if (!matchId.toUpperCase().endsWith("_ENG")) continue;
          if (!isCricketStream(rawTitle, cat, fc.event_name || "")) continue;

          const playerUrl = `https://iosfancode.vercel.app/?watch=${encodeURIComponent(matchId)}`;
          const title = rawTitle.replace(/\[.*?\]|\(.*?\)/g, "").trim() || rawTitle;

          let matched = false;
          for (const cb of candidateMatches) {
            if (matchStreamToCb(title, cb)) {
              matched = true;
              const mid = String(cb.id);
              // Only 1 FanCode server per match (Server 1)
              if (!newAutoServers[mid] || newAutoServers[mid].length === 0) {
                const sObj = {
                  id: `client_fc_${mid}_1`,
                  title: "Server 1",
                  serverLabel: "Server 1",
                  category: `${watchLinkPrefix}${mid}`,
                  media_type: "link",
                  media_url: playerUrl,
                  source: "fancode",
                  published: true,
                  sort_order: 1
                };
                newAutoServers[mid] = [sObj];
                cb.auto_servers = [sObj];
              }

              const inMainGrid = (state.matches || []).some(m => String(m.id) === mid);
              if (!inMainGrid && !isCompletedMatch(cb) && !extraCricbuzzLiveMatches.some(m => String(m.id) === mid)) {
                cb.isCricbuzzMatch = true;
                cb.state = "Live";
                extraCricbuzzLiveMatches.push(cb);
              }
              break;
            }
          }
          if (!matched && isFcLive) {
            unmatchedStreams.push({ source: "fancode", title, playerUrl });
          }
        }
      }

      const extraStreams = [...extraCricbuzzLiveMatches];
      for (const st of unmatchedStreams) {
        let ex = null;
        for (const existing of extraStreams) {
          if (matchStreamToCb(st.title, existing)) {
            ex = existing;
            break;
          }
        }
        if (ex) {
          if (!ex.auto_servers) ex.auto_servers = [];
          if (!ex.auto_servers.some(s => s.media_url === st.playerUrl)) {
            const sNum = ex.auto_servers.length + 1;
            ex.auto_servers.push({
              id: `extra_${ex.id}_${sNum}`,
              title: `Server ${sNum}`,
              serverLabel: `Server ${sNum}`,
              category: `${watchLinkPrefix}${ex.id}`,
              media_type: "link",
              media_url: st.playerUrl,
              source: st.source,
              published: true,
              sort_order: sNum
            });
          }
        } else if (isCricketStream(st.title, "", "")) {
          const vsParts = st.title.split(/\s+[-–—]\s+/);
          const matchPart = vsParts[vsParts.length - 1] || st.title;
          const vsMatch = matchPart.match(/^(.+?)\s+(?:vs\.?|v\/s|v)\s+(.+)$/i);
          const t1 = vsMatch ? vsMatch[1].trim() : matchPart;
          const t2 = vsMatch ? vsMatch[2].trim() : "Opponent";
          const exId = `ex_fc_${matchId || (cleanStreamStr(t1).replace(/[^a-z0-9]/g, "") + "_vs_" + cleanStreamStr(t2).replace(/[^a-z0-9]/g, ""))}`;
          const newEx = {
            id: exId,
            series: vsParts.length > 1 ? vsParts[0].trim() : "Live Cricket Stream",
            state: "In Progress",
            status: "Live Streaming",
            isLiveStream: true,
            isSynthetic: true,
            team1: { teamName: t1, teamSName: t1.slice(0, 4).toUpperCase() },
            team2: { teamName: t2, teamSName: t2.slice(0, 4).toUpperCase() },
            auto_servers: [
              {
                id: `extra_${exId}_1`,
                title: "Server 1",
                serverLabel: "Server 1",
                category: `${watchLinkPrefix}${exId}`,
                media_type: "link",
                media_url: st.playerUrl,
                source: st.source,
                published: true,
                sort_order: 1
              }
            ]
          };
          extraStreams.push(newEx);
        }
      }



      state.extraLiveStreams = extraStreams;
      extraStreams.forEach(ex => {
        if (!ex.auto_servers || !ex.auto_servers.length) {
          ex.auto_servers = newAutoServers[ex.id] || [];
        } else {
          newAutoServers[ex.id] = ex.auto_servers;
        }
      });

      // Auto-update streams: merge backend servers with client-discovered servers
      const finalServers = Object.assign({}, mergedServers);
      for (const [k, v] of Object.entries(newAutoServers)) {
        if (!finalServers[k]) {
          finalServers[k] = v;
        } else {
          const existingUrls = new Set(finalServers[k].map(s => s.media_url));
          v.forEach(s => {
            if (!existingUrls.has(s.media_url)) {
              finalServers[k].push(s);
            }
          });
        }
      }
      state.autoServers = finalServers;

      // Ensure every match in state.matches directly has auto_servers populated
      (state.matches || []).forEach(m => {
        const mid = String(m.id);
        if (state.autoServers[mid]) {
          m.auto_servers = state.autoServers[mid];
        }
      });

      try {
        localStorage.setItem("cricfreex_auto_servers", JSON.stringify(state.autoServers));
        localStorage.setItem("cricfreex_cached_extra_streams", JSON.stringify(extraStreams));
      } catch (e) {}

      lastClientSyncTime = now;
      updateDomMatchServers();

      const oldWrap = root.querySelector(".cricket-extra-streams-wrap");
      if (oldWrap) oldWrap.remove();

      if (state.page === "live") {
        if (!state.matches) state.matches = [];
        const activeExtraIds = new Set(extraStreams.map(ex => String(ex.id)));

        // Remove synthetic/extra streams that are no longer active
        state.matches = state.matches.filter(m => {
          if (m.isSynthetic || String(m.id).startsWith("ex_")) {
            return activeExtraIds.has(String(m.id));
          }
          return !isCompletedMatch(m);
        });

        // Add newly appeared live streams
        const seenIds = new Set(state.matches.map(m => String(m.id)));
        extraStreams.forEach(ex => {
          if (!isCompletedMatch(ex) && !seenIds.has(String(ex.id))) {
            state.matches.push(ex);
            seenIds.add(String(ex.id));
          }
        });

        updateDomMatchServers();
        // Only do full list re-render if synthetic/extra matches changed count
        const grid = root.querySelector(".cricket-match-grid");
        if (!grid || grid.children.length !== state.matches.length) {
          renderMatchList(
            state.matches,
            m => openMatch(m, "live", "scorecard", true),
            "No live matches are available right now."
          );
        }
      }
    } catch (err) {
      console.warn("Client stream sync error:", err);
    } finally {
      clientSyncInProgress = false;
    }
  }

  function matchCard(match, onSelect, allowWatchLinks) {
    const card = element("article", "cricket-match-card");
    card.setAttribute("data-card-match-id", String(match.id));
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
      const scoreText = formatMatchScoreDisplay(score, true);
      const row = element("div", "cricket-team-row");
      row.append(
        renderTeamSpan(team, match.series),
        element("strong", "cricket-team-score", scoreText)
      );
      teams.appendChild(row);
    });

    const isOutside = isMatchOutsideIndia(match);
    const normalizedStatus = normalizeMatchStatus(
      match.status || match.state || "Match details",
      match
    );
    const status = element(
      "p",
      "cricket-match-status",
      normalizedStatus
    );
    const matchTimeStr = formatCricketDateTime(match.startDate, isOutside);
    const venue = [
      match.format,
      matchTimeStr,
      match.venue?.ground,
      match.venue?.city
    ].filter(Boolean).join(" · ");

    summary.append(top, teams, status);
    if (venue) summary.appendChild(element("div", "cricket-match-meta", venue));
    card.appendChild(summary);

    const validLinks = getMatchServers(match, allowWatchLinks);
    if (validLinks.length) {
      const links = element("div", "cricket-watch-links");
      links.appendChild(element("strong", "cricket-watch-label", "Watch Live"));
      validLinks.forEach(({ url, sourceURL }, index) => {
        const serverLabel = `Server ${index + 1}`;
        const button = element("button", "cricket-watch-link", `▶ ${serverLabel}`);
        button.type = "button";
        button.setAttribute("data-match-id", String(match.id));
        button.setAttribute("data-server-idx", String(index));
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
          startMatchServer(match, index, true);
        });
        links.appendChild(button);
      });
      card.appendChild(links);
    }
    return card;
  }

  function startMatchServer(match, serverIndex, updateUrl = true) {
    if (window.CricfreexApp?.closeChannelPlayer) {
      window.CricfreexApp.closeChannelPlayer(false);
    }
    const validLinks = getMatchServers(match, true);
    if (!validLinks[serverIndex]) return false;

    const serverLabel = `Server ${serverIndex + 1}`;
    const { url, sourceURL, label } = validLinks[serverIndex];

    const isStumps = isMatchAtStumps(match);
    if (isStumps) {
      showCricketToast("This stream will be live when the match resumes.");
    }

    state.activeWatch = {
      match,
      serverIndex,
      serverLabel,
      label: label || serverLabel,
      url,
      sourceURL,
      isStumps
    };
    renderWatchPlayer();

    root.querySelectorAll(".cricket-watch-link").forEach(serverButton => {
      const matchMatches = serverButton.getAttribute("data-match-id") === String(match.id);
      const idxMatches = serverButton.getAttribute("data-server-idx") === String(serverIndex);
      const isSelected = matchMatches && idxMatches;
      serverButton.classList.toggle("is-selected", isSelected);
      serverButton.setAttribute("aria-pressed", String(isSelected));
    });

    if (updateUrl) {
      if (state.page === "match" && state.selectedMatch) {
        updateCricketURL({
          match: match.id,
          tab: state.matchTab || "scorecard",
          server: serverIndex + 1
        });
      } else {
        updateCricketURL({
          match: match.id,
          server: serverIndex + 1
        });
      }
    }

    watchPlayer?.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }

  function closeCricketPlayer(updateUrl = false) {
    if (watchPlayer) {
      const iframes = watchPlayer.querySelectorAll("iframe");
      iframes.forEach(el => {
        try { el.src = "about:blank"; } catch (e) {}
      });
    }
    state.activeWatch = null;
    renderWatchPlayer();
    root.querySelectorAll(".cricket-watch-link").forEach(button => {
      button.classList.remove("is-selected");
      button.setAttribute("aria-pressed", "false");
    });

    if (updateUrl) {
      if (state.page === "match" && state.selectedMatch) {
        updateCricketURL({
          match: state.selectedMatch.id,
          tab: state.matchTab || "scorecard"
        });
      } else {
        updateCricketURL({
          tab: state.page === "live" ? null : state.page
        });
      }
    }
  }

  function renderWatchPlayer() {
    if (!watchPlayer) return;
    if (typeof window.isSiteUnlocked === "function" && !window.isSiteUnlocked()) {
      watchPlayer.replaceChildren();
      watchPlayer.hidden = true;
      return;
    }
    watchPlayer.replaceChildren();
    const active = state.activeWatch;
    watchPlayer.hidden = !active;
    if (!active) return;

    const head = element("div", "cricket-watch-player-head");
    const title = element("div", "cricket-watch-player-copy");
    const isOutside = isMatchOutsideIndia(active.match);
    const matchTimeStr = formatCricketDateTime(active.match.startDate, isOutside);
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
          matchTimeStr,
          active.match.venue?.ground,
          active.match.venue?.city
        ].filter(Boolean).join(" · ")
      )
    );
    const actions = element("div", "cricket-watch-player-actions");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.alignItems = "center";

    const shareBtn = element("button", "cricket-action-button", "📋 Copy Link");
    shareBtn.type = "button";
    shareBtn.title = "Copy direct shareable link for this match and server";
    shareBtn.addEventListener("click", async () => {
      const shareUrl = `${location.origin}${cleanCricketPath(location)}?match=${active.match.id}&server=${active.serverIndex + 1}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
        shareBtn.textContent = "✓ Copied!";
        showCricketToast("Direct Server Link copied to clipboard!");
        setTimeout(() => { shareBtn.textContent = "📋 Copy Link"; }, 2000);
      } catch (e) {
        const ta = document.createElement("textarea");
        ta.value = shareUrl;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        shareBtn.textContent = "✓ Copied!";
        showCricketToast("Direct Server Link copied to clipboard!");
        setTimeout(() => { shareBtn.textContent = "📋 Copy Link"; }, 2000);
      }
    });

    const close = element("button", "cricket-action-button", "Close player");
    close.type = "button";
    close.addEventListener("click", () => closeCricketPlayer(true));
    actions.append(shareBtn, close);
    head.append(title, actions);

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
    // Anti-Redirect Sandbox: blocks ads/iframes from redirecting your website
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-presentation");
    const frameWrap = element("div", "cricket-watch-frame-wrap");
    const topGuard = element("div", "player-top-guard");
    topGuard.setAttribute("aria-hidden", "true");
    topGuard.innerHTML = '<svg width="100%" height="100%" style="display:block;width:100%;height:100%;pointer-events:auto;" preserveAspectRatio="none"><rect width="100%" height="100%" fill="#000" fill-opacity="0.02"/></svg>';
    ["click", "dblclick", "mousedown", "mouseup", "touchstart", "touchend", "touchmove", "pointerdown", "pointerup", "pointermove", "contextmenu", "selectstart", "dragstart"].forEach(evt => {
      topGuard.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        return false;
      }, { capture: true, passive: false });
    });
    const fsHotspot = element("div", "player-fs-hotspot");
    fsHotspot.setAttribute("aria-hidden", "true");
    fsHotspot.title = "";
    fsHotspot.addEventListener("click", () => {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (frameWrap.requestFullscreen) frameWrap.requestFullscreen().catch(() => {});
        else if (frameWrap.webkitRequestFullscreen) frameWrap.webkitRequestFullscreen().catch(() => {});
      } else {
        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen().catch(() => {});
      }
    });

    frameWrap.append(frame, topGuard, fsHotspot);

    if (active.isStumps) {
      const stumpsBox = element("div", "cricket-stumps-box");
      stumpsBox.style.padding = "24px 20px";
      stumpsBox.style.background = "linear-gradient(135deg, rgba(20,24,35,0.95), rgba(12,15,22,0.98))";
      stumpsBox.style.borderRadius = "12px";
      stumpsBox.style.border = "1px solid rgba(255,255,255,0.12)";
      stumpsBox.style.textAlign = "center";
      stumpsBox.style.margin = "8px 0 16px";

      const badge = element("span", "cricket-state is-live", "🏏 MATCH AT STUMPS");
      badge.style.display = "inline-block";
      badge.style.marginBottom = "10px";
      badge.style.background = "#d97706";

      // Lead / trail status heading (e.g. Australia lead by 182 runs)
      const statusTitle = active.match.status || active.match.state || "Match at Stumps";
      const stumpsTitle = element("h3", "cricket-stumps-title", statusTitle);
      stumpsTitle.style.fontSize = "19px";
      stumpsTitle.style.fontWeight = "700";
      stumpsTitle.style.color = "#fef08a";
      stumpsTitle.style.margin = "0 0 16px";

      // Teams and both innings scores
      const scoreRows = element("div", "cricket-stumps-scores-wrap");
      scoreRows.style.display = "flex";
      scoreRows.style.flexDirection = "column";
      scoreRows.style.gap = "8px";
      scoreRows.style.maxWidth = "460px";
      scoreRows.style.margin = "0 auto 16px";
      scoreRows.style.textAlign = "left";

      [active.match.team1, active.match.team2].forEach((team, index) => {
        const score = active.match.score?.[index === 0 ? "team1Score" : "team2Score"];
        const scoreText = formatMatchScoreDisplay(score, true);

        const r = element("div", "cricket-team-row");
        r.style.display = "flex";
        r.style.alignItems = "center";
        r.style.justifyContent = "space-between";
        r.style.padding = "8px 12px";
        r.style.background = "rgba(255,255,255,0.04)";
        r.style.borderRadius = "6px";
        r.append(
          renderTeamSpan(team, active.match.series),
          element("strong", "cricket-team-score", scoreText)
        );
        scoreRows.appendChild(r);
      });

      const stumpsMsg = element("p", "cricket-stumps-msg", "⚡ Live match broadcast is currently paused for Stumps and will resume tomorrow.");
      stumpsMsg.style.fontSize = "13px";
      stumpsMsg.style.opacity = "0.75";
      stumpsMsg.style.margin = "0";

      stumpsBox.append(badge, stumpsTitle, scoreRows, stumpsMsg);

      watchPlayer.append(
        head,
        server,
        stumpsBox
      );
      return;
    }

    watchPlayer.append(
      head,
      server,
      frameWrap,
      element(
        "p",
        "cricket-watch-note",
        "⚡ If this server is buffering or not playing, please switch to another server above."
      )
    );
  }

  function filtered(items, textFor = item => item.title || "") {
    const query = state.query.trim().toLowerCase();
    return query
      ? items.filter(item => textFor(item).toLowerCase().includes(query))
      : items;
  }

  function updateMatchCardInPlace(card, match, allowWatchLinks = true) {
    if (!card || !match) return;

    const statusEl = card.querySelector(".cricket-match-status");
    if (statusEl) {
      statusEl.textContent = normalizeMatchStatus(match.status || match.state || "Match details", match);
    }

    const stateBadge = card.querySelector(".cricket-state");
    if (stateBadge) {
      const isLive = isLiveMatch(match);
      stateBadge.className = `cricket-state ${isLive ? "is-live" : ""}`;
      stateBadge.textContent = match.state || (isLive ? "LIVE" : "Match");
    }

    const scoreEls = card.querySelectorAll(".cricket-team-score");
    const isSynthetic = String(match.id).startsWith("ex_");
    [match.score?.team1Score, match.score?.team2Score].forEach((score, idx) => {
      if (scoreEls[idx]) {
        scoreEls[idx].textContent = formatMatchScoreDisplay(score, !isSynthetic);
      }
    });

    const validLinks = getMatchServers(match, allowWatchLinks);
    let linksWrap = card.querySelector(".cricket-watch-links");
    if (validLinks.length) {
      if (!linksWrap) {
        linksWrap = element("div", "cricket-watch-links");
        card.appendChild(linksWrap);
      }
      linksWrap.replaceChildren();
      linksWrap.appendChild(element("strong", "cricket-watch-label", "Watch Live"));
      validLinks.forEach(({ url }, index) => {
        const sLabel = `Server ${index + 1}`;
        const btn = element("button", "cricket-watch-link", `▶ ${sLabel}`);
        btn.type = "button";
        btn.setAttribute("data-match-id", String(match.id));
        btn.setAttribute("data-server-idx", String(index));
        const isSelected = state.activeWatch?.match?.id === match.id && state.activeWatch.serverIndex === index;
        btn.classList.toggle("is-selected", isSelected);
        btn.setAttribute("aria-pressed", String(isSelected));
        btn.addEventListener("click", e => {
          e.stopPropagation();
          startMatchServer(match, index, true);
        });
        linksWrap.appendChild(btn);
      });
    } else if (linksWrap) {
      linksWrap.remove();
    }
  }

  function renderMatchList(matches, onSelect, noMatchesMessage) {
    const list = filtered(matches, matchSearchText);
    const content = root.querySelector(".cricket-content") || root;

    if (!list.length) {
      const existingGrid = content.querySelector(".cricket-match-grid");
      if (existingGrid) existingGrid.remove();
      showMessage(
        matches.length
          ? "No matches match your search."
          : noMatchesMessage
      );
      return;
    }

    const msg = content.querySelector(".cricket-message");
    if (msg) msg.remove();

    let grid = content.querySelector(".cricket-match-grid");
    if (!grid) {
      grid = element("div", "cricket-match-grid");
      content.appendChild(grid);
    }

    const currentCardIds = new Set(list.map(m => String(m.id)));
    grid.querySelectorAll(".cricket-match-card").forEach(card => {
      const mid = card.getAttribute("data-card-match-id");
      if (mid && !currentCardIds.has(mid)) {
        card.remove();
      }
    });

    list.forEach(match => {
      const midStr = String(match.id);
      let card = grid.querySelector(`.cricket-match-card[data-card-match-id="${midStr}"]`);
      if (!card) {
        card = matchCard(
          match,
          () => onSelect(match),
          shouldAllowWatchLinks(match)
        );
        grid.appendChild(card);
      } else {
        updateMatchCardInPlace(card, match, shouldAllowWatchLinks(match));
      }
    });
  }

  function directoryCard(item, label, onClick) {
    const card = element("button", "cricket-directory-card");
    card.type = "button";
    const titleSpan = element("span", "cricket-directory-title");
    if (label && /team/i.test(label)) {
      const visual = getTeamVisualElement(item.title);
      if (visual) titleSpan.appendChild(visual);
    }
    titleSpan.appendChild(document.createTextNode(item.title));
    card.append(
      element("span", "cricket-directory-label", label),
      titleSpan,
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
    const isTeamCategory = state.ranking && state.ranking.category === "teams";
    const isTeamCol = (header) => /^(team|teams|team name|country|opponent)$/i.test(String(header || "").trim()) || (isTeamCategory && /^player \/ team$/i.test(String(header || "").trim()));
    const teamColIndex = headers.findIndex(h => isTeamCol(h));
    const body = document.createElement("tbody");
    rows.forEach(row => {
      const tr = document.createElement("tr");
      row.forEach((value, cIdx) => {
        const td = element("td", "");
        if (cIdx === teamColIndex && typeof value === "string" && value.trim()) {
          const visual = getTeamVisualElement(value);
          if (visual) td.appendChild(visual);
          td.appendChild(document.createTextNode(value));
        } else {
          td.textContent = value ?? "—";
        }
        tr.appendChild(td);
      });
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
        selectPage(key, true);
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

  const _matchDataCache = {
    live: null,
    recent: null,
    upcoming: null
  };
  try {
    const _cachedL = localStorage.getItem("cricfreex_cached_live_matches");
    if (_cachedL) {
      const _parsed = JSON.parse(_cachedL);
      if (Array.isArray(_parsed) && _parsed.length) {
        _matchDataCache.live = _parsed;
      }
    }
    const _cachedUp = localStorage.getItem("cricfreex_cached_upcoming_matches");
    if (_cachedUp) {
      const _parsedUp = JSON.parse(_cachedUp);
      if (Array.isArray(_parsedUp) && _parsedUp.length) {
        _matchDataCache.upcoming = _parsedUp.filter(m => isMatchIn2DayUpcomingWindow(m));
      }
    }
    const _cachedRec = localStorage.getItem("cricfreex_cached_recent_matches");
    if (_cachedRec) {
      const _parsedRec = JSON.parse(_cachedRec);
      if (Array.isArray(_parsedRec) && _parsedRec.length) {
        _matchDataCache.recent = _parsedRec;
      }
    }
    const _cachedAll = localStorage.getItem("cricfreex_all_matches");
    if (_cachedAll) {
      state.allKnownMatches = JSON.parse(_cachedAll) || {};
    }
    if (!state.allKnownMatches) state.allKnownMatches = {};
    Object.values(_matchDataCache).forEach(arr => {
      if (Array.isArray(arr)) {
        arr.forEach(m => { if (m?.id) state.allKnownMatches[String(m.id)] = m; });
      }
    });
    const _cachedExt = localStorage.getItem("cricfreex_cached_extra_streams");
    if (_cachedExt) {
      const _parsedExt = JSON.parse(_cachedExt);
      if (Array.isArray(_parsedExt) && _parsedExt.length) {
        state.extraLiveStreams = _parsedExt;
        _parsedExt.forEach(ex => {
          if (ex?.id && ex.auto_servers?.length) {
            state.autoServers[ex.id] = ex.auto_servers;
          }
        });
      }
    }
  } catch (e) {}
  let _preloadingStarted = false;

  function preloadMatchData() {
    if (_preloadingStarted) return;
    _preloadingStarted = true;

    // Start stream sync immediately in parallel (0ms wait)
    syncAllrounderClient(true);

    request("/api/matches/live").then(res => {
      if (res && Array.isArray(res.matches)) {
        const liveOnly = res.matches.filter(m => !isCompletedMatch(m));
        _matchDataCache.live = liveOnly;
        try {
          localStorage.setItem("cricfreex_cached_live_matches", JSON.stringify(liveOnly));
          localStorage.setItem("cricfreex_all_matches", JSON.stringify(state.allKnownMatches || {}));
        } catch (e) {}
        if (!state.allKnownMatches) state.allKnownMatches = {};
        liveOnly.forEach(m => { if (m?.id) state.allKnownMatches[String(m.id)] = m; });
        if (state.page === "live") {
          state.matches = liveOnly;
          renderMatchList(
            state.matches,
            match => openMatch(match, "live", "scorecard", true),
            "No live matches are available right now."
          );
        }
      }
    }).catch(() => {});

    request("/api/matches/recent").then(res => {
      if (res && Array.isArray(res.matches)) {
        _matchDataCache.recent = res.matches;
        try {
          localStorage.setItem("cricfreex_cached_recent_matches", JSON.stringify(res.matches));
          localStorage.setItem("cricfreex_all_matches", JSON.stringify(state.allKnownMatches || {}));
        } catch (e) {}
        if (!state.allKnownMatches) state.allKnownMatches = {};
        res.matches.forEach(m => { if (m?.id) state.allKnownMatches[String(m.id)] = m; });
      }
    }).catch(() => {});

    request("/api/matches/upcoming").then(res => {
      if (res && Array.isArray(res.matches)) {
        const rawUpcoming = res.matches.filter(m => isMatchIn2DayUpcomingWindow(m));
        if (!state.allKnownMatches) state.allKnownMatches = {};
        rawUpcoming.forEach(m => { if (m?.id) state.allKnownMatches[String(m.id)] = m; });

        const upcomingOnly = rawUpcoming.filter(m => !isMatchStartingSoon(m) && !isLiveMatch(m));
        _matchDataCache.upcoming = upcomingOnly;
        try {
          localStorage.setItem("cricfreex_cached_upcoming_matches", JSON.stringify(upcomingOnly));
          localStorage.setItem("cricfreex_all_matches", JSON.stringify(state.allKnownMatches || {}));
        } catch (e) {}

        // Immediate promotion: Push any matches starting within 1 hour into Live section
        const startingSoon = rawUpcoming.filter(m => (isMatchStartingSoon(m) || isLiveMatch(m)) && !isCompletedMatch(m));
        if (startingSoon.length) {
          if (!_matchDataCache.live) _matchDataCache.live = [];
          let added = false;
          startingSoon.forEach(sm => {
            if (!_matchDataCache.live.some(m => String(m.id) === String(sm.id))) {
              _matchDataCache.live.push(sm);
              added = true;
            }
          });
          if (added && state.page === "live") {
            state.matches = _matchDataCache.live;
            renderMatchList(
              state.matches,
              match => openMatch(match, "live", "scorecard", true),
              "No live matches are available right now."
            );
          }
        }
      }
    }).catch(() => {});
  }

  async function loadMatches(category, requestId) {
    let matches = _matchDataCache[category];

    // If already preloaded, render immediately with 0ms wait!
    if (matches && matches.length) {
      state.matches = matches;
      renderMatchList(
        matches,
        match => openMatch(match, category, "scorecard", true),
        category === "upcoming"
          ? "There are no upcoming matches listed right now."
          : category === "recent"
            ? "No recent match records are available right now."
            : "No live matches are available right now."
      );
      const countEl = root.querySelector(".cricket-count");
      if (countEl) countEl.remove();
      root.querySelector(".cricket-content")?.prepend(
        element("p", "cricket-count", `${filtered(matches, matchSearchText).length} of ${matches.length} matches`)
      );
    }

    try {
      const result = await request(`/api/matches/${category}`);
      if (requestId !== state.request) return;
      matches = result.matches || [];
      if (category === "upcoming") {
        matches = matches.filter(m => isMatchIn2DayUpcomingWindow(m) && !isMatchStartingSoon(m) && !isLiveMatch(m));
        matches.sort((a, b) => (Number(a.startDate || 0) - Number(b.startDate || 0)));
      } else if (category === "live") {
        // Collect from all master pool matches (live or starting within 1 hour)
        const pool = Object.values(state.allKnownMatches || {});
        pool.forEach(um => {
          if ((isMatchStartingSoon(um) || isLiveMatch(um)) && !isCompletedMatch(um)) {
            if (!matches.some(m => String(m.id) === String(um.id))) {
              matches.push(um);
            }
          }
        });
      }
      _matchDataCache[category] = matches;
      state.matches = matches;
      try {
        localStorage.setItem(`cricfreex_cached_${category}_matches`, JSON.stringify(matches));
        localStorage.setItem("cricfreex_all_matches", JSON.stringify(state.allKnownMatches || {}));
      } catch (e) {}
      matches.forEach(m => {
        if (category === "live" && m.auto_servers?.length) {
          state.autoServers[String(m.id)] = m.auto_servers;
        } else if (category === "upcoming") {
          m.auto_servers = [];
          m.servers = [];
        }
        if (!state.allKnownMatches) state.allKnownMatches = {};
        if (m.id) state.allKnownMatches[String(m.id)] = m;
      });
      if (category === "recent") {
        pruneCompletedWatchLinks(matches);
      } else if (category === "live") {
        pruneCompletedWatchLinks();
      }
      renderMatchList(
        matches,
        match => openMatch(match, category, "scorecard", true),
        category === "upcoming"
          ? "There are no upcoming matches listed right now."
          : category === "recent"
            ? "No recent match records are available right now."
            : "No live matches are available right now."
      );
      const countEl = root.querySelector(".cricket-count");
      if (countEl) countEl.remove();
      root.querySelector(".cricket-content")?.prepend(
        element("p", "cricket-count", `${filtered(matches, matchSearchText).length} of ${matches.length} matches`)
      );
      if (category === "live") {
        syncAllrounderClient();
      }
    } catch (e) {
      if (!matches || !matches.length) {
        showMessage(`Cannot load ${category} matches right now.`, "is-error");
      }
    }
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

  async function openSeries(item, returnPage = "series", tab = "matches", updateUrl = true) {
    state.archiveYearOpen = false;
    state.returnPage = returnPage;
    state.seriesReturnPage = returnPage;
    state.seriesPath = item.path.replace(/\/(?:matches|squads|stats|news|venues)\/?$/, "");
    state.seriesTitle = item.title || "Series";
    state.seriesTab = tab;
    state.page = "series-matches";
    state.query = "";
    if (updateUrl) {
      updateCricketURL({
        series: state.seriesPath,
        seriesTab: tab
      });
    }
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
        selectPage(state.seriesReturnPage || "series", true);
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
            key,
            true
          )
        );
        navigation.appendChild(button);
      });
      content.appendChild(navigation);
      if (tab === "matches") {
        renderMatchList(
          result.matches || [],
          match => openMatch(match, "series-matches", "scorecard", true),
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

  async function openArchiveYear(item, updateUrl = true) {
    state.returnPage = "archives";
    state.archiveYearOpen = true;
    state.archiveItem = item;
    state.query = "";
    state.page = "archives";
    if (updateUrl) {
      updateCricketURL({
        archive: item.path
      });
    }
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
        selectPage("archives", true);
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

  async function openTeam(item, tab = "schedule", updateUrl = true) {
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
    if (updateUrl) {
      updateCricketURL({
        team: state.teamPath,
        teamTab: tab
      });
    }
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
          selectPage("teams", true);
        }
      }));
      const teamTitleText = state.teamTitle || result.data?.title || "Team";
      const teamHeading = element("h3", "cricket-section-heading");
      teamHeading.style.display = "flex";
      teamHeading.style.alignItems = "center";
      teamHeading.style.gap = "8px";
      const teamVisual = getTeamVisualElement(teamTitleText);
      if (teamVisual) teamHeading.appendChild(teamVisual);
      teamHeading.appendChild(document.createTextNode(teamTitleText));
      content.appendChild(teamHeading);

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
        button.addEventListener("click", () => openTeam(item, key, true));
        navigation.appendChild(button);
      });
      content.appendChild(navigation);

      if (tab === "schedule" || tab === "results") {
        renderMatchList(
          result.matches || [],
          match => openMatch(match, "team", "scorecard", true),
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

  async function openArticle(item, updateUrl = true) {
    state.articleReturn = {
      page: state.page,
      match: state.selectedMatch
    };
    state.returnPage = state.page;
    state.page = "article";
    if (updateUrl) {
      updateCricketURL({
        news: item.path
      });
    }
    renderShell();
    setLoading(`Loading ${item.title || "article"}…`);
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
          openMatch(previous.match, state.returnPage, "news", true);
        } else if (previous?.page === "series-matches") {
          openSeries(
            { title: state.seriesTitle, path: state.seriesPath },
            state.seriesReturnPage,
            state.seriesTab,
            true
          );
        } else if (previous?.page === "team") {
          openTeam(
            { title: state.teamTitle, path: state.teamPath },
            state.teamTab,
            true
          );
        } else {
          selectPage(previous?.page || "news", true);
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

  const _scorecardCache = new Map();

  function updateMatchHeaderDOM(match) {
    if (!match) return;
    if (state.selectedMatch && String(state.selectedMatch.id) === String(match.id)) {
      Object.assign(state.selectedMatch, match);
    }
    const content = root.querySelector(".cricket-content");
    if (!content) return;

    // 1. Update Heading (Team 1 vs Team 2 with logos)
    const heading = content.querySelector(".cricket-section-heading");
    if (heading && (match.team1?.teamName || match.team1?.teamSName || typeof match.team1 === "string")) {
      heading.innerHTML = "";
      heading.append(
        renderTeamSpan(match.team1, match.series),
        element("span", "cricket-vs-text", "vs"),
        renderTeamSpan(match.team2, match.series)
      );
    }

    // 2. Update Status Banner (Equation / Results)
    const normStatus = normalizeMatchStatus(match.status || match.state || "", match);
    let banner = content.querySelector(".cricket-match-status-banner");
    if (normStatus && !/^match details$/i.test(normStatus)) {
      if (!banner && heading) {
        banner = element("div", "cricket-match-status-banner");
        banner.style.cssText = "margin: 6px 0 14px; padding: 10px 16px; background: linear-gradient(135deg, rgba(32,223,123,0.14), rgba(16,185,129,0.06)); border: 1px solid rgba(32,223,123,0.35); border-radius: 8px; color: #a7f3d0; font-size: 15px; font-weight: 600; display: inline-flex; align-items: center; gap: 8px;";
        heading.insertAdjacentElement("afterend", banner);
      }
      if (banner) {
        banner.innerHTML = `<span style="font-size:18px;">📢</span> <span>${normStatus}</span>`;
      }
    }

    // 3. Update Series & Match Description Meta
    const seriesMeta = content.querySelector(".cricket-match-series-meta");
    const metaText = [match.series, match.description].filter(Boolean).join(" · ");
    if (seriesMeta && metaText) {
      seriesMeta.textContent = metaText;
    }

    // 4. Update Venue
    const venueMeta = content.querySelector(".cricket-match-venue-meta");
    const venue = [
      match.venue?.ground,
      match.venue?.city
    ].filter(Boolean).join(", ");
    if (venueMeta && venue) {
      venueMeta.textContent = `Venue: ${venue}`;
    }
  }
  const renderMatchHeading = updateMatchHeaderDOM;

  async function openMatch(match, returnPage, initialTab = "scorecard", updateUrl = true) {
    state.selectedMatch = match;
    state.scorecardInning = 0;
    state.returnPage = returnPage || state.returnPage || "live";
    state.page = "match";
    state.matchTab = initialTab;

    // Auto-select Server 1 if match has streams
    const validLinks = getMatchServers(match, true);
    if (validLinks.length > 0 && String(state.activeWatch?.match?.id) !== String(match.id)) {
      startMatchServer(match, 0, false);
    }

    if (updateUrl) {
      updateCricketURL({
        match: match.id,
        tab: initialTab,
        server: state.activeWatch?.match.id === match.id ? (state.activeWatch.serverIndex + 1) : null
      });
    }

    renderShell();

    // Stream-only match without Cricbuzz data:
    if (match.isSynthetic || String(match.id).startsWith("ex_")) {
      const content = root.querySelector(".cricket-content");
      content.appendChild(backButton("Back to matches", () => {
        state.selectedMatch = null;
        selectPage(state.returnPage || "live", true);
      }));
      const matchHeading = element("h3", "cricket-section-heading");
      matchHeading.style.display = "flex";
      matchHeading.style.alignItems = "center";
      matchHeading.style.flexWrap = "wrap";
      matchHeading.style.gap = "8px";
      matchHeading.append(
        renderTeamSpan(match.team1, match.series),
        element("span", "cricket-vs-text", "vs"),
        renderTeamSpan(match.team2, match.series)
      );
      content.appendChild(matchHeading);
      content.appendChild(element(
        "p",
        "cricket-match-meta",
        [match.series, match.status || "Live Streaming"].filter(Boolean).join(" · ")
      ));
      renderMatchViewServers(match, content);
      content.appendChild(element("div", "cricket-message", "⚡ Live video stream is playing. Detailed scorecard is only available for Cricbuzz-tracked matches."));
      return;
    }

    await loadMatchTab(initialTab, false);
    renderMatchViewServers(match);
  }

  async function loadMatchTab(tab, updateUrl = true) {
    const match = state.selectedMatch;
    if (!match) return;
    state.matchTab = tab;
    if (updateUrl) {
      updateCricketURL({
        match: match.id,
        tab,
        server: state.activeWatch?.match.id === match.id ? (state.activeWatch.serverIndex + 1) : null
      });
    }
    const requestId = ++state.request;
    renderShell();
    const content = root.querySelector(".cricket-content");
    content.appendChild(backButton("Back to matches", () => {
      state.selectedMatch = null;
      if (state.returnPage === "series-matches") {
        openSeries(
          { title: state.seriesTitle, path: state.seriesPath },
          state.seriesReturnPage,
          state.seriesTab,
          true
        );
      } else if (state.returnPage === "team") {
        openTeam(
          { title: state.teamTitle, path: state.teamPath },
          state.teamTab,
          true
        );
      } else {
        const ret = state.returnPage || "live";
        selectPage(ret, true);
      }
    }));
    const matchHeading = element("h3", "cricket-section-heading");
    matchHeading.style.display = "flex";
    matchHeading.style.alignItems = "center";
    matchHeading.style.flexWrap = "wrap";
    matchHeading.style.gap = "8px";
    matchHeading.append(
      renderTeamSpan(match.team1, match.series),
      element("span", "cricket-vs-text", "vs"),
      renderTeamSpan(match.team2, match.series)
    );
    content.appendChild(matchHeading);

    // Prominent Match Status Banner (Who won/lost, runs/wickets, or lead/trail)
    const normStatus = normalizeMatchStatus(match.status || match.state || "", match);
    if (normStatus && !/^match details$/i.test(normStatus)) {
      const statusBanner = element("div", "cricket-match-status-banner");
      statusBanner.style.cssText = "margin: 6px 0 14px; padding: 10px 16px; background: linear-gradient(135deg, rgba(32,223,123,0.14), rgba(16,185,129,0.06)); border: 1px solid rgba(32,223,123,0.35); border-radius: 8px; color: #a7f3d0; font-size: 15px; font-weight: 600; display: inline-flex; align-items: center; gap: 8px;";
      statusBanner.innerHTML = `<span style="font-size:18px;">📢</span> <span>${normStatus}</span>`;
      content.appendChild(statusBanner);
    }

    content.appendChild(element(
      "p",
      "cricket-match-meta cricket-match-series-meta",
      [match.series, match.description].filter(Boolean).join(" · ")
    ));

    const venue = [
      match.venue?.ground,
      match.venue?.city
    ].filter(Boolean).join(", ");
    content.appendChild(element(
      "p",
      "cricket-match-meta cricket-match-venue-meta",
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
      button.addEventListener("click", () => loadMatchTab(key, true));
      navigation.appendChild(button);
    });
    content.appendChild(navigation);
    renderMatchViewServers(match, content);
    content.appendChild(element("div", "cricket-match-data is-loading", "Loading match data…"));

    const apiVersion = ["squad", "points", "overs", "graphs", "news"].includes(tab)
      ? "v4"
      : "v3";
    const cacheKey = `${match.id}_${tab}`;
    if (_scorecardCache.has(cacheKey)) {
      const cached = _scorecardCache.get(cacheKey);
      const target = root.querySelector(".cricket-match-data");
      if (target) {
        target.classList.remove("is-loading");
        target.textContent = "";
        renderMatchData(tab, cached, target, match);
      }
    }

    try {
      const result = await request(`/api/${apiVersion}/match/${match.id}/${tab}`);
      if (requestId !== state.request || state.selectedMatch !== match) return;
      const data = result.data || {};
      _scorecardCache.set(cacheKey, data);

      if (result) {
        if (result.matches && Array.isArray(result.matches)) {
          const found = result.matches.find(m => String(m.id) === String(match.id)) || result.matches[0];
          if (found) {
            Object.assign(match, found);
            updateMatchHeaderDOM(match);
          }
        }
        if (result.match) {
          Object.assign(match, result.match);
          updateMatchHeaderDOM(match);
        }
        if (data.teams && Array.isArray(data.teams) && data.teams.length >= 2 && (!match.team1 || !match.team1.teamName)) {
          match.team1 = data.teams[0];
          match.team2 = data.teams[1];
          updateMatchHeaderDOM(match);
        }
      }

      const target = root.querySelector(".cricket-match-data");
      if (target) {
        target.classList.remove("is-loading");
        target.textContent = "";
        renderMatchData(tab, data, target, match);
      }
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
          const button = element("button", "cricket-tab");
          if (inning.team) {
            const matchTeam = [match?.team1, match?.team2].find(t =>
              t && (t.teamName === inning.team || t.teamSName === inning.team)
            );
            const visual = getTeamVisualElement(matchTeam || inning.team, match?.series);
            if (visual) button.appendChild(visual);
            button.appendChild(document.createTextNode(inning.team));
          } else {
            button.textContent = `Innings ${index + 1}`;
          }
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
      const inngHeading = element("h4", "cricket-section-heading");
      inngHeading.style.display = "flex";
      inngHeading.style.alignItems = "center";
      inngHeading.style.gap = "8px";
      if (inning.team) {
        const matchTeam = [match?.team1, match?.team2].find(t =>
          t && (t.teamName === inning.team || t.teamSName === inning.team)
        );
        const visual = getTeamVisualElement(matchTeam || inning.team, match?.series);
        if (visual) inngHeading.appendChild(visual);
        inngHeading.appendChild(document.createTextNode(inning.team));
      } else {
        inngHeading.textContent = `Innings ${index + 1}`;
      }
      appendToTarget(inngHeading);
      const inngWkts = (inning.wickets != null && !isNaN(inning.wickets)) ? `/${inning.wickets}` : (inning.overs != null ? "/0" : "");
      const inngOv = (inning.overs != null && inning.overs !== "" && inning.overs !== "—") ? ` (${inning.overs} ov)` : "";
      appendToTarget(element(
        "p",
        "cricket-score-summary",
        `${inning.runs ?? 0}${inngWkts}${inngOv}`
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
        const squadTeamName = team.teamName || team.teamSName || "Team";
        const squadHeading = element("h4", "cricket-section-heading");
        squadHeading.style.display = "flex";
        squadHeading.style.alignItems = "center";
        squadHeading.style.gap = "8px";
        const matchTeam = [match?.team1, match?.team2].find(t =>
          t && (t.teamName === squadTeamName || t.teamSName === squadTeamName)
        );
        const squadVisual = getTeamVisualElement(matchTeam || team, match?.series);
        if (squadVisual) squadHeading.appendChild(squadVisual);
        squadHeading.appendChild(document.createTextNode(squadTeamName));
        appendToTarget(squadHeading);
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
      const isOutside = isMatchOutsideIndia(match);
      const details = (data.details || [])
        .filter(item => item.label)
        .map(item => {
          if (item.label.toLowerCase() === "status") {
            return [item.label, normalizeMatchStatus(item.value, match)];
          }
          if (item.label.toLowerCase().includes("date") || item.label.toLowerCase().includes("time")) {
            const formatted = formatCricketDateTime(item.value, isOutside);
            return [item.label, formatted || item.value];
          }
          return [item.label, item.value];
        });
      const known = new Set(details.map(row => row[0]));
      const formattedStart = formatCricketDateTime(match.startDate, isOutside);
      [
        ["Series", match.series],
        ["Match", match.description],
        ["Format", match.format],
        ["Date & Time", formattedStart],
        ["Status", normalizeMatchStatus(match.status || match.state, match)],
        ["Venue", match.venue?.ground],
        ["City", match.venue?.city]
      ].forEach(([label, value]) => {
        if (!known.has(label) && value) details.push([label, value || "Not available"]);
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
    const isTeamCol = (header) => /^(team|teams|team name|country|opponent|player \/ team)$/i.test(String(header || "").trim());
    const teamColIndex = headers.findIndex(h => isTeamCol(h));
    const tbody = document.createElement("tbody");
    rows.forEach(row => {
      const bodyRow = document.createElement("tr");
      row.forEach((value, cIdx) => {
        const td = element("td", "");
        if (cIdx === teamColIndex && typeof value === "string" && value.trim()) {
          const visual = getTeamVisualElement(value);
          if (visual) td.appendChild(visual);
          td.appendChild(document.createTextNode(value));
        } else {
          td.textContent = value ?? "—";
        }
        bodyRow.appendChild(td);
      });
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

  function open(updateUrl = false) {
    state.page = "live";
    state.query = "";
    state.selectedMatch = null;
    root.hidden = false;
    channelSection.hidden = true;
    document.body.classList.add("cricket-active");
    window.setSiteMode?.("matches");
    if (updateUrl) {
      updateCricketURL({ tab: null });
    } else {
      if (location.hash === "#cricketCenter" || location.hash === "#cricket") {
        const cleanPath = cleanCricketPath(location);
        history.replaceState(null, "", cleanPath + (location.search || ""));
      }
    }
    renderCenter();
    renderPageContentSafe();
    document.querySelector(".cricket-main-tab")?.classList.add("active");
    document.querySelector(".cricket-main-tab")?.setAttribute("aria-pressed", "true");
  }

  function selectPage(page, updateUrl = true) {
    if (!tabs.some(([key]) => key === page)) return;
    state.request += 1;
    state.page = page;
    state.query = "";
    state.selectedMatch = null;
    root.hidden = false;
    channelSection.hidden = true;
    document.body.classList.add("cricket-active");
    window.setSiteMode?.("matches");
    if (updateUrl) {
      updateCricketURL({
        tab: page === "live" ? null : page,
        server: state.activeWatch ? (state.activeWatch.serverIndex + 1) : null,
        match: state.activeWatch ? state.activeWatch.match.id : null
      });
    }
    renderCenter();
    renderPageContentSafe();
    document.querySelector(".cricket-main-tab")?.classList.add("active");
    document.querySelector(".cricket-main-tab")?.setAttribute("aria-pressed", "true");
  }

  async function openMatchById(matchId, tab = "scorecard", serverNum = 1, updateUrl = false) {
    let match = state.allKnownMatches?.[String(matchId)]
      || state.matches?.find(m => String(m.id) === String(matchId))
      || _matchDataCache.live?.find(m => String(m.id) === String(matchId))
      || _matchDataCache.recent?.find(m => String(m.id) === String(matchId))
      || _matchDataCache.upcoming?.find(m => String(m.id) === String(matchId));

    if (!match || !match.team1 || !match.team1.teamName) {
      if (!match) {
        match = {
          id: matchId,
          series: "Live Cricket",
          description: "Match",
          state: "Live",
          status: "Loading match details...",
          isLiveStream: true,
          team1: { teamName: "Loading..." },
          team2: { teamName: "Loading..." }
        };
      }
      // Fetch specific match object immediately in parallel
      request(`/api/match/${matchId}`).then(res => {
        if (res && res.match) {
          Object.assign(match, res.match);
          if (!state.allKnownMatches) state.allKnownMatches = {};
          state.allKnownMatches[String(matchId)] = match;
          updateMatchHeaderDOM(match);
          renderMatchViewServers(match);
        }
      }).catch(() => {
        request("/api/matches/live").then(res => {
          if (res && Array.isArray(res.matches)) {
            const found = res.matches.find(m => String(m.id) === String(matchId));
            if (found) {
              Object.assign(match, found);
              updateMatchHeaderDOM(match);
              renderMatchViewServers(match);
            }
          }
        }).catch(() => {});
      });
    }

    // Parallel sync stream servers immediately
    syncAllrounderClient(true).then(() => {
      if (state.selectedMatch && String(state.selectedMatch.id) === String(matchId)) {
        renderMatchViewServers(state.selectedMatch);
      }
    }).catch(() => {});

    // Open match view INSTANTLY (0ms)
    await openMatch(match, "live", tab || "scorecard", updateUrl);

    // Start target server as soon as ready
    const targetIdx = (serverNum && !isNaN(serverNum) && serverNum > 0) ? (serverNum - 1) : 0;
    const started = startMatchServer(match, targetIdx, updateUrl);
    if (!started) {
      [50, 150, 300, 600, 1000, 1800].forEach(d => {
        setTimeout(() => {
          if (state.selectedMatch && String(state.selectedMatch.id) === String(matchId)) {
            if (!state.activeWatch || String(state.activeWatch.match?.id) !== String(matchId)) {
              startMatchServer(state.selectedMatch, targetIdx, updateUrl);
            }
          }
        }, d);
      });
    }
  }

  async function restoreRoute(push = false) {
    const isReload = (function() {
      try {
        const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
        if (nav && nav.type === "reload") return true;
        if (performance.navigation && performance.navigation.type === 1) return true;
      } catch (e) {}
      return false;
    })();

    if (isReload) {
      state.selectedMatch = null;
      state.activeWatch = null;
      closeCricketPlayer(false);
      try {
        sessionStorage.removeItem("cricfreex_auth_pass");
        sessionStorage.removeItem("cricfreex_session_active");
      } catch (e) {}
      const cleanPath = location.pathname.replace(/\/index\.html$/i, "") || "/";
      try { history.replaceState(null, "", cleanPath); } catch (e) {}
      selectPage("live", false);
      return;
    }

    const params = new URLSearchParams(location.search);
    const hash = location.hash;

    const hasRouteParams = Boolean(
      params.get("match") || params.get("channel") || params.get("server") ||
      params.get("series") || params.get("team") || params.get("news") ||
      params.get("view") || params.get("tab")
    );

    const isNewSession = !sessionStorage.getItem("cricfreex_session_active");
    sessionStorage.setItem("cricfreex_session_active", "1");
    if (isNewSession && !hasRouteParams) {
      const cleanPath = cleanCricketPath(location);
      if (location.search || location.hash) {
        history.replaceState(null, "", cleanPath);
      }
    }

    if (hash === "#cricketCenter" || hash === "#cricket") {
      const cleanPath = cleanCricketPath(location);
      history.replaceState(null, "", cleanPath + (location.search || ""));
    }

    const view = params.get("view");
    const channel = params.get("channel");
    const show = params.get("show");
    const episode = params.get("episode");

    if (view === "channels" || channel || show || episode) {
      window.setSiteMode?.("channels");
      return;
    }

    if (view === "suggestion" || hash === "#suggestion") {
      state.page = "live";
      root.hidden = false;
      channelSection.hidden = true;
      document.body.classList.add("cricket-active");
      window.setSiteMode?.("matches");
      renderCenter();
      renderPageContentSafe();
      setTimeout(() => {
        document.getElementById("suggestionSection")?.scrollIntoView({ behavior: "smooth", block: "center" });
        document.getElementById("suggestionInput")?.focus();
      }, 350);
      return;
    }

    const matchId = params.get("match");
    const tab = params.get("tab");
    const server = params.get("server");
    const news = params.get("news");
    const series = params.get("series");
    const team = params.get("team");
    const archive = params.get("archive");

    root.hidden = false;
    channelSection.hidden = true;
    document.body.classList.add("cricket-active");
    window.setSiteMode?.("matches");

    if (matchId) {
      const serverNum = server ? parseInt(server, 10) : null;
      await openMatchById(matchId, tab || "scorecard", serverNum, push);
      return;
    }

    if (news) {
      await openArticle({ path: news, title: "Cricket News" }, push);
      return;
    }

    if (series) {
      await openSeries({ path: series, title: "Series" }, "series", params.get("seriesTab") || "matches", push);
      return;
    }

    if (team) {
      await openTeam({ path: team, title: "Team" }, params.get("teamTab") || "schedule", push);
      return;
    }

    if (archive) {
      await openArchiveYear({ path: archive, title: "Archive" }, push);
      return;
    }

    const validTabs = tabs.map(([k]) => k);
    const targetTab = validTabs.includes(tab) ? tab : "live";
    selectPage(targetTab, push);

    if (targetTab === "live" && !params.toString()) {
      if (location.search || location.hash || location.pathname.toLowerCase().endsWith("/index.html")) {
        const cleanPath = cleanCricketPath(location);
        history.replaceState(null, "", cleanPath);
      }
    }
  }

  window.addEventListener("popstate", () => {
    restoreRoute(false);
  });

  async function updateLiveScoresSilent() {
    if (root.hidden || document.hidden) return;

    if (state.page === "live") {
      try {
        const result = await request("/api/matches/live");
        const matches = result.matches || [];
        if (!matches.length) return;
        const pool = Object.values(state.allKnownMatches || {});
        pool.forEach(um => {
          if ((isMatchStartingSoon(um) || isLiveMatch(um)) && !isCompletedMatch(um)) {
            if (!matches.some(m => String(m.id) === String(um.id))) {
              matches.push(um);
            }
          }
        });
        state.matches = matches;

        matches.forEach(m => {
          if (m.auto_servers?.length) {
            state.autoServers[String(m.id)] = m.auto_servers;
          }
        });
        syncAllrounderClient();

        // Update cards in-place with state, scores, and watch server links
        matches.forEach(match => {
          const card = root.querySelector(`.cricket-match-card[data-card-match-id="${match.id}"]`);
          if (card) {
            updateMatchCardInPlace(card, match, shouldAllowWatchLinks(match));
          }
        });
      } catch (err) {
        // silent fail on network glitch
      }
    } else if (state.page === "match" && state.selectedMatch && isLiveMatch(state.selectedMatch)) {
      // If user is inside a live match view, update commentary/scorecard silently
      try {
        const mid = state.selectedMatch.id;
        const tab = state.matchTab || "scorecard";
        if (["scorecard", "commentary", "overs"].includes(tab)) {
          const apiVersion = tab === "overs" ? "v4" : "v3";
          const res = await request(`/api/${apiVersion}/match/${mid}/${tab}`);
          if (res?.data && state.selectedMatch?.id === mid && state.matchTab === tab) {
            const target = root.querySelector(".cricket-match-data");
            if (target && !target.classList.contains("is-loading")) {
              target.textContent = "";
              renderMatchData(tab, res.data, target, state.selectedMatch);
            }
          }
        }
      } catch (e) {}
    }

    if (watchLinks.length) {
      pruneCompletedWatchLinks();
    }
  }

  window.setInterval(() => {
    updateLiveScoresSilent();
  }, 4000);

  window.setInterval(() => {
    syncAllrounderClient();
  }, 10000);

  window.addEventListener("cricfreex:content-updated", event => {
    watchLinks = (event.detail || []).filter(item =>
      String(item.category || "").startsWith(watchLinkPrefix)
    );
    if (
      !root.hidden &&
      (state.page === "live" || state.page === "match") &&
      !document.hidden
    ) {
      updateDomMatchServers();
    }
  });

  window.addEventListener("pagehide", () => {
    watchPlayer?.querySelector("iframe")?.setAttribute("src", "about:blank");
  });

  window.addEventListener("cricfreex:stop-cricket-stream", () => {
    closeCricketPlayer(true);
  });

  window.addEventListener("cricfreex:unlocked", () => {
    restoreRoute(false);
  });

  function enforceCricketFullscreen() {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    const wrap = root.querySelector(".cricket-watch-frame-wrap");
    if (wrap) {
      wrap.classList.toggle("is-fullscreen", Boolean(fs));
    }
    if (fs && fs.classList && fs.classList.contains("cricket-watch-frame")) {
      const cWrap = fs.closest(".cricket-watch-frame-wrap");
      if (cWrap && cWrap !== fs) {
        if (cWrap.requestFullscreen) cWrap.requestFullscreen().catch(() => {});
        else if (cWrap.webkitRequestFullscreen) cWrap.webkitRequestFullscreen();
      }
    }
  }
  document.addEventListener("fullscreenchange", enforceCricketFullscreen, true);
  document.addEventListener("webkitfullscreenchange", enforceCricketFullscreen, true);

  window.CricfreexCricket = {
    open,
    selectPage,
    openMatch,
    openMatchById,
    openSeries,
    openTeam,
    openArticle,
    openArchiveYear,
    closeWatchPlayer: (updateUrl = false) => closeCricketPlayer(updateUrl),
    startMatchServer,
    restoreRoute
  };

  preloadMatchData();
  restoreRoute(false);
})();
