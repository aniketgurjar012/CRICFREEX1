"use strict";

const C=window.CRICFREEX_CONFIG;

const db=window.supabase.createClient(
  C.SUPABASE_URL,
  C.SUPABASE_ANON_KEY
);

const $=id=>document.getElementById(id);

let settings=null;
let sections=[];
let content=[];

let section="sports";
let filter="all";
let activeSeries=null;
let selected="";

let initialURLRestored=false;

/* ============================================================
   HELPERS
============================================================ */

const esc=value=>
  String(value??"")
    .replace(
      /[&<>"']/g,
      char=>({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;",
        "'":"&#039;"
      }[char])
    );

function brand(name){

  if(
    /^cricfreex$/i.test(
      name||""
    )
  ){
    return `CRIC<span class="brand-red">FREEX</span>`;
  }

  return esc(
    name||"CricFreeX"
  );
}

function mediaURL(value){

  if(!value){
    return null;
  }

  try{

    const url=
      new URL(
        value,
        window.location.href
      );

    if(
      ![
        "https:",
        "http:"
      ].includes(url.protocol)
    ){
      return null;
    }

    return url.href;

  }catch{

    return null;
  }
}

function sectionObj(){

  return sections.find(
    item=>
      item.slug===section
  );
}

function getItemByPublicId(
  publicId
){

  if(!publicId){
    return null;
  }

  return content.find(
    item=>
      item.public_id===
      publicId
  )||null;
}

function getParentSeries(
  episode
){

  if(!episode?.parent_id){
    return null;
  }

  return content.find(
    item=>
      item.id===
      episode.parent_id &&
      item.kind==="series"
  )||null;
}

/* ============================================================
   DATABASE LOAD
============================================================ */

async function load(){

  try{

    const [
      settingsResult,
      sectionsResult,
      contentResult
    ]=await Promise.all([

      db
        .from("site_settings")
        .select("*")
        .eq("id",1)
        .maybeSingle(),

      db
        .from("sections")
        .select("*")
        .eq("published",true)
        .order(
          "sort_order",
          {ascending:true}
        ),

      db
        .from("content")
        .select("*")
        .eq("published",true)
        .order(
          "sort_order",
          {ascending:true}
        )

    ]);

    if(settingsResult.error){
      throw settingsResult.error;
    }

    if(sectionsResult.error){
      throw sectionsResult.error;
    }

    if(contentResult.error){
      throw contentResult.error;
    }

    if(settingsResult.data){
      settings=
        settingsResult.data;
    }

    sections=
      sectionsResult.data||[];

    content=
      contentResult.data||[];

    /*
      Keep current section if it exists.

      Otherwise use first available section.
    */

    if(
      !sections.some(
        item=>
          item.slug===section
      ) &&
      sections.length
    ){
      section=
        sections[0].slug;
    }

    renderAll();

  }catch(error){

    console.error(
      "CricFreeX load error:",
      error
    );
  }
}

/* ============================================================
   SITE RENDER
============================================================ */

function renderAll(){

  const name=
    settings?.site_name||
    "CricFreeX";

  $("brandWord").innerHTML=
    brand(name);

  $("footerLogo").innerHTML=
    brand(name);

  document.title=
    `${name} — Sports & Entertainment`;

  $("heroKicker").textContent=
    settings?.hero_kicker||
    "CRICFREEX LIVE";

  const heroParts=
    (
      settings?.hero_title||
      "YOUR GAME.|YOUR SCREEN."
    ).split("|");

  $("heroTitle").innerHTML=
    `${esc(heroParts[0])}${
      heroParts[1]
        ?`<span>${esc(heroParts[1])}</span>`
        :""
    }`;

  $("heroText").textContent=
    settings?.hero_text||
    "Sports, shows and entertainment organised in one fast, responsive interface.";

  renderTabs();
  renderFilters();
  render();
}

/* ============================================================
   MAIN TABS
============================================================ */

function renderTabs(){

  $("mainTabs")
    .replaceChildren();

  sections.forEach(item=>{

    const button=
      document.createElement(
        "button"
      );

    button.type=
      "button";

    button.className=
      "main-tab"+
      (
        section===item.slug
          ?" active"
          :""
      );

    button.textContent=
      `${item.icon||""} ${item.name}`
        .trim();

    button.addEventListener(
      "click",
      ()=>{

        section=
          item.slug;

        filter=
          "all";

        activeSeries=
          null;

        selected=
          "";

        $("search").value=
          "";

        clearShareURL();

        renderTabs();
        renderFilters();
        render();

        $("channels")
          .scrollIntoView({
            behavior:"smooth",
            block:"start"
          });
      }
    );

    $("mainTabs")
      .append(button);
  });
}

/* ============================================================
   FILTERS
============================================================ */

function renderFilters(){

  $("filters")
    .replaceChildren();

  if(activeSeries){

    $("filters").style.display=
      "none";

    return;
  }

  $("filters").style.display=
    "flex";

  const categories=[
    "all",
    ...new Set(
      content
        .filter(
          item=>
            item.section_slug===
              section &&
            !item.parent_id
        )
        .map(
          item=>item.category
        )
        .filter(Boolean)
    )
  ];

  categories.forEach(
    category=>{

      const button=
        document.createElement(
          "button"
        );

      button.type=
        "button";

      button.className=
        "filter"+
        (
          filter===category
            ?" active"
            :""
        );

      button.textContent=
        category==="all"
          ?"All"
          :category;

      button.addEventListener(
        "click",
        ()=>{

          filter=
            category;

          renderFilters();
          render();
        }
      );

      $("filters")
        .append(button);
    }
  );
}

/* ============================================================
   CONTENT CARD
============================================================ */

function card(
  item,
  label,
  meta
){

  const button=
    document.createElement(
      "button"
    );

  button.type=
    "button";

  button.className=
    "channel-card"+
    (
      selected===item.id
        ?" selected"
        :""
    );

  /*
    Thumbnail
  */

  if(item.image_url){

    const image=
      document.createElement(
        "img"
      );

    image.className=
      "channel-thumb";

    image.src=
      item.image_url;

    image.alt="";

    image.loading=
      "lazy";

    button.append(image);
  }

  /*
    Top row
  */

  const top=
    document.createElement(
      "div"
    );

  top.className=
    "channel-top";

  const live=
    document.createElement(
      "div"
    );

  live.className=
    "channel-live";

  const dot=
    document.createElement(
      "i"
    );

  live.append(
    dot,
    document.createTextNode(
      label
    )
  );

  const category=
    document.createElement(
      "div"
    );

  category.className=
    "channel-category";

  category.textContent=
    item.category||
    item.kind||
    "";

  top.append(
    live,
    category
  );

  /*
    Name
  */

  const name=
    document.createElement(
      "div"
    );

  name.className=
    "channel-name";

  name.textContent=
    item.title;

  /*
    Public ID / episode metadata
  */

  const id=
    document.createElement(
      "div"
    );

  id.className=
    "channel-id";

  id.textContent=
    meta||
    item.public_id||
    "";

  button.append(
    top,
    name,
    id
  );

  return button;
}

/* ============================================================
   MAIN CONTENT RENDER
============================================================ */

function render(){

  const query=
    $("search")
      .value
      .trim()
      .toLowerCase();

  $("channelGrid")
    .replaceChildren();

  /*
    SERIES EPISODE VIEW
  */

  if(activeSeries){

    $("seriesBack")
      .classList
      .add("show");

    $("kicker").textContent=
      "EPISODES";

    $("sectionTitle").textContent=
      activeSeries.title;

    const episodes=
      content.filter(item=>{

        const belongs=
          item.parent_id===
            activeSeries.id &&
          item.kind==="episode";

        if(!belongs){
          return false;
        }

        if(!query){
          return true;
        }

        return (
          item.title
            ?.toLowerCase()
            .includes(query)
          ||
          item.public_id
            ?.toLowerCase()
            .includes(query)
          ||
          String(
            item.episode_number||
            ""
          ).includes(query)
        );
      });

    $("channelCount")
      .textContent=
        `${episodes.length} episode${
          episodes.length===1
            ?""
            :"s"
        }`;

    if(!episodes.length){

      empty(
        "No episodes found."
      );

      return;
    }

    episodes.forEach(
      episode=>{

        const button=
          card(
            episode,
            "WATCH",
            `EPISODE ${
              episode.episode_number||
              ""
            }`
          );

        button.addEventListener(
          "click",
          ()=>play(episode)
        );

        $("channelGrid")
          .append(button);
      }
    );

    return;
  }

  /*
    NORMAL SECTION VIEW
  */

  $("seriesBack")
    .classList
    .remove("show");

  const current=
    sectionObj();

  $("kicker").textContent=
    (
      current?.name||
      "EXPLORE"
    ).toUpperCase();

  $("sectionTitle").textContent=
    current?.name||
    "Content";

  const list=
    content.filter(item=>{

      const sectionMatch=
        item.section_slug===
        section;

      const parentMatch=
        !item.parent_id;

      const categoryMatch=
        filter==="all"||
        item.category===filter;

      const searchMatch=
        !query
        ||
        item.title
          ?.toLowerCase()
          .includes(query)
        ||
        item.public_id
          ?.toLowerCase()
          .includes(query);

      return (
        sectionMatch &&
        parentMatch &&
        categoryMatch &&
        searchMatch
      );
    });

  $("channelCount")
    .textContent=
      `${list.length} item${
        list.length===1
          ?""
          :"s"
      }`;

  if(!list.length){

    empty(
      "No content found."
    );

    return;
  }

  list.forEach(item=>{

    const isSeries=
      item.kind==="series";

    let episodeCount=0;

    if(isSeries){

      episodeCount=
        content.filter(
          episode=>
            episode.parent_id===
              item.id &&
            episode.kind===
              "episode"
        ).length;
    }

    const button=
      card(
        item,
        isSeries
          ?"SERIES"
          :"LIVE",
        isSeries
          ?`${episodeCount} EPISODES`
          :item.public_id
      );

    button.addEventListener(
      "click",
      ()=>{
        if(isSeries){
          openSeries(item);
        }else{
          play(item);
        }
      }
    );

    $("channelGrid")
      .append(button);
  });
}

function empty(text){

  const element=
    document.createElement(
      "div"
    );

  element.className=
    "empty";

  element.textContent=
    text;

  $("channelGrid")
    .append(element);
}

/* ============================================================
   SHAREABLE URL
============================================================ */

function clearShareURL(){

  const url=
    new URL(
      window.location.href
    );

  url.searchParams.delete(
    "channel"
  );

  url.searchParams.delete(
    "show"
  );

  url.searchParams.delete(
    "episode"
  );

  history.replaceState(
    {},
    "",
    url
  );
}

function updateShareURL(
  item
){

  const url=
    new URL(
      window.location.href
    );

  url.searchParams.delete(
    "channel"
  );

  url.searchParams.delete(
    "show"
  );

  url.searchParams.delete(
    "episode"
  );

  /*
    EPISODE
  */

  if(
    item.kind==="episode"
  ){

    const parent=
      getParentSeries(item);

    if(parent?.public_id){

      url.searchParams.set(
        "show",
        parent.public_id
      );
    }

    if(item.public_id){

      url.searchParams.set(
        "episode",
        item.public_id
      );
    }

  /*
    SERIES
  */

  }else if(
    item.kind==="series"
  ){

    if(item.public_id){

      url.searchParams.set(
        "show",
        item.public_id
      );
    }

  /*
    CHANNEL / MOVIE / OTHER
  */

  }else{

    if(item.public_id){

      url.searchParams.set(
        "channel",
        item.public_id
      );
    }
  }

  history.replaceState(
    {},
    "",
    url
  );
}

/* ============================================================
   OPEN SERIES
============================================================ */

function openSeries(
  item,
  options={}
){

  activeSeries=
    item;

  section=
    item.section_slug||
    section;

  filter=
    "all";

  selected=
    "";

  $("search").value=
    "";

  if(
    options.updateURL!==
    false
  ){

    updateShareURL(item);
  }

  renderTabs();
  renderFilters();
  render();

  if(
    options.scroll!==
    false
  ){

    $("channels")
      .scrollIntoView({
        behavior:"smooth",
        block:"start"
      });
  }
}

/* ============================================================
   PLAYER
============================================================ */

function playerUnavailable(){

  $("playingStatus")
    .textContent=
      "UNAVAILABLE";

  $("playerWrap")
    .innerHTML=
      '<div class="player-empty"><div><strong>Source not configured</strong>No media source is configured.</div></div>';
}

function play(
  item,
  options={}
){

  selected=
    item.id;

  section=
    item.section_slug||
    section;

  /*
    If episode opened from direct URL,
    restore its series view.
  */

  if(
    item.kind==="episode"
  ){

    const parent=
      getParentSeries(item);

    if(parent){
      activeSeries=parent;
    }

  }else{
    activeSeries=null;
  }

  $("playingTitle")
    .textContent=
      item.title;

  $("playingCategory")
    .textContent=
      (
        item.category||
        item.kind||
        "CRICFREEX"
      ).toUpperCase();

  $("playingStatus")
    .textContent=
      "LOADING";

  if(
    options.updateURL!==
    false
  ){

    updateShareURL(item);
  }

  renderTabs();
  renderFilters();
  render();

  const url=
    mediaURL(
      item.media_url
    );

  $("playerWrap")
    .replaceChildren();

  if(!url){

    playerUnavailable();

    if(
      options.scroll!==
      false
    ){

      $("watch")
        .scrollIntoView({
          behavior:"smooth",
          block:"start"
        });
    }

    return;
  }

  /*
    DIRECT VIDEO
  */

  if(
    item.media_type===
    "video"
  ){

    const video=
      document.createElement(
        "video"
      );

    video.className=
      "stream-video";

    video.controls=
      true;

    video.playsInline=
      true;

    video.autoplay=
      true;

    video.preload=
      "metadata";

    video.controlsList=
      "nodownload";

    video.addEventListener(
      "loadeddata",
      ()=>{

        $("playingStatus")
          .textContent=
            "NOW PLAYING";
      }
    );

    video.addEventListener(
      "error",
      ()=>{

        $("playingStatus")
          .textContent=
            "ERROR";
      }
    );

    video.src=url;

    $("playerWrap")
      .append(video);

  /*
    IFRAME
  */

  }else{

    const frame=
      document.createElement(
        "iframe"
      );

    frame.className=
      "stream-frame";

    frame.title=
      item.title||
      "CricFreeX Player";

    frame.allow=
      "autoplay; encrypted-media; fullscreen; picture-in-picture";

    frame.allowFullscreen=
      true;

    frame.referrerPolicy=
      "strict-origin-when-cross-origin";

    frame.addEventListener(
      "load",
      ()=>{

        $("playingStatus")
          .textContent=
            "NOW PLAYING";
      }
    );

    frame.addEventListener(
      "error",
      ()=>{

        $("playingStatus")
          .textContent=
            "ERROR";
      }
    );

    frame.src=url;

    $("playerWrap")
      .append(frame);
  }

  if(
    options.scroll!==
    false
  ){

    $("watch")
      .scrollIntoView({
        behavior:"smooth",
        block:"start"
      });
  }
}

/* ============================================================
   RESTORE SHARED URL
============================================================ */

function restoreSharedURL(){

  const params=
    new URLSearchParams(
      window.location.search
    );

  const channelId=
    params.get("channel");

  const showId=
    params.get("show");

  const episodeId=
    params.get("episode");

  /*
    Priority:
    episode > channel > show

    Episode may also contain ?show=
    but episode public_id alone is enough.
  */

  if(episodeId){

    const episode=
      content.find(
        item=>
          item.public_id===
            episodeId &&
          item.kind===
            "episode"
      );

    if(episode){

      const parent=
        getParentSeries(
          episode
        );

      section=
        episode.section_slug||
        parent?.section_slug||
        section;

      activeSeries=
        parent;

      filter=
        "all";

      selected=
        episode.id;

      $("search").value=
        "";

      renderTabs();
      renderFilters();
      render();

      play(
        episode,
        {
          updateURL:false,
          scroll:true
        }
      );

      return true;
    }
  }

  /*
    CHANNEL / MOVIE / NORMAL CONTENT
  */

  if(channelId){

    const item=
      content.find(
        entry=>
          entry.public_id===
            channelId &&
          entry.kind!==
            "series" &&
          entry.kind!==
            "episode"
      );

    if(item){

      section=
        item.section_slug||
        section;

      filter=
        "all";

      activeSeries=
        null;

      selected=
        item.id;

      $("search").value=
        "";

      renderTabs();
      renderFilters();
      render();

      play(
        item,
        {
          updateURL:false,
          scroll:true
        }
      );

      return true;
    }
  }

  /*
    SERIES
  */

  if(showId){

    const show=
      content.find(
        item=>
          item.public_id===
            showId &&
          item.kind===
            "series"
      );

    if(show){

      section=
        show.section_slug||
        section;

      filter=
        "all";

      activeSeries=
        show;

      selected=
        "";

      $("search").value=
        "";

      renderTabs();
      renderFilters();
      render();

      $("channels")
        .scrollIntoView({
          behavior:"smooth",
          block:"start"
        });

      return true;
    }
  }

  return false;
}

/* ============================================================
   BACK FROM SERIES
============================================================ */

$("seriesBack")
  .addEventListener(
    "click",
    ()=>{

      activeSeries=null;

      selected="";

      filter="all";

      $("search").value="";

      clearShareURL();

      renderFilters();
      render();
    }
  );

/* ============================================================
   SEARCH
============================================================ */

$("search")
  .addEventListener(
    "input",
    render
  );

/* ============================================================
   HEADER / HERO CONTROLS
============================================================ */

$("brand")
  .addEventListener(
    "click",
    ()=>{

      window.scrollTo({
        top:0,
        behavior:"smooth"
      });
    }
  );

$("exploreButton")
  .addEventListener(
    "click",
    ()=>{

      $("channels")
        .scrollIntoView({
          behavior:"smooth",
          block:"start"
        });
    }
  );

$("watchButton")
  .addEventListener(
    "click",
    ()=>{

      $("watch")
        .scrollIntoView({
          behavior:"smooth",
          block:"start"
        });
    }
  );

/* ============================================================
   INVISIBLE ADMIN ENTRY
============================================================ */

$("adminEntry")
  .addEventListener(
    "click",
    ()=>{

      window.location.href=
        "./admin.html";
    }
  );

/* ============================================================
   REALTIME DATABASE UPDATES
============================================================ */

let realtimeTimer=null;

function realtimeReload(){

  clearTimeout(
    realtimeTimer
  );

  realtimeTimer=
    setTimeout(
      async ()=>{

        /*
          Keep current public URL.

          Do not automatically reopen/scroll
          everything on each realtime event.
        */

        await load();

      },
      250
    );
}

db
  .channel(
    "cricfreex-public"
  )
  .on(
    "postgres_changes",
    {
      event:"*",
      schema:"public",
      table:"site_settings"
    },
    realtimeReload
  )
  .on(
    "postgres_changes",
    {
      event:"*",
      schema:"public",
      table:"sections"
    },
    realtimeReload
  )
  .on(
    "postgres_changes",
    {
      event:"*",
      schema:"public",
      table:"content"
    },
    realtimeReload
  )
  .subscribe();

/* ============================================================
   BROWSER BACK / FORWARD
============================================================ */

window.addEventListener(
  "popstate",
  ()=>{

    restoreSharedURL();
  }
);

/* ============================================================
   START APPLICATION
============================================================ */

async function startApp(){

  await load();

  if(!initialURLRestored){

    initialURLRestored=true;

    restoreSharedURL();
  }
}

startApp();