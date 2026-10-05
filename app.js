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
let restored=false;

const esc=v=>
  String(v??"").replace(
    /[&<>"']/g,
    c=>({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      '"':"&quot;",
      "'":"&#039;"
    }[c])
  );

function brand(name){
  if(/^cricfreex$/i.test(name||"")){
    return `CRIC<span class="brand-red">FREEX</span>`;
  }

  return esc(name||"CricFreeX");
}

function safeURL(value){
  if(!value)return null;

  try{
    const u=new URL(
      value,
      location.href
    );

    return [
      "https:",
      "http:"
    ].includes(u.protocol)
      ?u.href
      :null;

  }catch{
    return null;
  }
}

async function load(){
  try{
    const [a,b,c]=await Promise.all([
      db.from("site_settings")
        .select("*")
        .eq("id",1)
        .maybeSingle(),

      db.from("sections")
        .select("*")
        .eq("published",true)
        .order("sort_order"),

      db.from("content")
        .select("*")
        .eq("published",true)
        .order("sort_order")
    ]);

    if(a.error)throw a.error;
    if(b.error)throw b.error;
    if(c.error)throw c.error;

    settings=a.data||null;
    sections=b.data||[];
    content=c.data||[];

    if(
      !sections.some(
        x=>x.slug===section
      ) &&
      sections.length
    ){
      section=sections[0].slug;
    }

    renderAll();

  }catch(error){
    console.error(error);
  }
}

function renderAll(){
  const name=
    settings?.site_name||
    "CricFreeX";

  $("brandWord").innerHTML=
    brand(name);

  $("footerLogo").innerHTML=
    brand(name);

  const parts=(
    settings?.hero_title||
    "YOUR GAME.|YOUR SCREEN."
  ).split("|");

  $("heroKicker").textContent=
    settings?.hero_kicker||
    "CRICFREEX LIVE";

  $("heroTitle").innerHTML=
    `${esc(parts[0])}${
      parts[1]
        ?`<span>${esc(parts[1])}</span>`
        :""
    }`;

  $("heroText").textContent=
    settings?.hero_text||
    "Sports, shows and entertainment organised in one fast, responsive interface.";

  renderTabs();
  renderFilters();
  render();
}

function renderTabs(){
  $("mainTabs").replaceChildren();

  sections.forEach(s=>{
    const b=document.createElement("button");

    b.className=
      "main-tab"+
      (
        section===s.slug
          ?" active"
          :""
      );

    b.textContent=
      `${s.icon||""} ${s.name}`.trim();

    b.onclick=()=>{
      section=s.slug;
      filter="all";
      activeSeries=null;
      selected="";
      $("search").value="";

      clearURL();

      renderTabs();
      renderFilters();
      render();
    };

    $("mainTabs").append(b);
  });
}

function renderFilters(){
  $("filters").replaceChildren();

  if(activeSeries){
    $("filters").style.display="none";
    return;
  }

  $("filters").style.display="flex";

  const categories=[
    "all",
    ...new Set(
      content
        .filter(
          x=>
            x.section_slug===section &&
            !x.parent_id
        )
        .map(x=>x.category)
        .filter(Boolean)
    )
  ];

  categories.forEach(cat=>{
    const b=document.createElement("button");

    b.className=
      "filter"+
      (
        filter===cat
          ?" active"
          :""
      );

    b.textContent=
      cat==="all"
        ?"All"
        :cat;

    b.onclick=()=>{
      filter=cat;
      renderFilters();
      render();
    };

    $("filters").append(b);
  });
}

function makeCard(item,label,meta){
  const b=document.createElement("button");

  b.className=
    "channel-card"+
    (
      selected===item.id
        ?" selected"
        :""
    );

  if(item.image_url){
    const img=document.createElement("img");
    img.className="channel-thumb";
    img.src=item.image_url;
    img.alt="";
    img.loading="lazy";
    b.append(img);
  }

  const top=document.createElement("div");
  top.className="channel-top";

  const live=document.createElement("div");
  live.className="channel-live";

  const dot=document.createElement("i");

  live.append(
    dot,
    document.createTextNode(label)
  );

  const category=document.createElement("div");
  category.className="channel-category";
  category.textContent=
    item.category||
    item.kind||
    "";

  top.append(live,category);

  const name=document.createElement("div");
  name.className="channel-name";
  name.textContent=item.title;

  const id=document.createElement("div");
  id.className="channel-id";
  id.textContent=
    meta||
    item.public_id||
    "";

  b.append(top,name,id);

  return b;
}

function empty(text){
  const e=document.createElement("div");
  e.className="empty";
  e.textContent=text;
  $("channelGrid").append(e);
}

function render(){
  const q=
    $("search").value
      .trim()
      .toLowerCase();

  $("channelGrid").replaceChildren();

  if(activeSeries){
    $("seriesBack").classList.add("show");

    $("kicker").textContent="EPISODES";
    $("sectionTitle").textContent=
      activeSeries.title;

    const episodes=content.filter(x=>
      x.kind==="episode" &&
      x.parent_id===activeSeries.id &&
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

    $("channelCount").textContent=
      `${episodes.length} episode${
        episodes.length===1
          ?""
          :"s"
      }`;

    if(!episodes.length){
      empty("No episodes found.");
      return;
    }

    episodes.forEach(ep=>{
      const b=makeCard(
        ep,
        "WATCH",
        `EPISODE ${
          ep.episode_number||""
        }`
      );

      b.onclick=()=>play(ep);

      $("channelGrid").append(b);
    });

    return;
  }

  $("seriesBack").classList.remove("show");

  const s=sections.find(
    x=>x.slug===section
  );

  $("kicker").textContent=
    (s?.name||"EXPLORE")
      .toUpperCase();

  $("sectionTitle").textContent=
    s?.name||"Content";

  const list=content.filter(x=>
    x.section_slug===section &&
    !x.parent_id &&
    x.kind!=="episode" &&
    (
      filter==="all" ||
      x.category===filter
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

  $("channelCount").textContent=
    `${list.length} item${
      list.length===1?"":"s"
    }`;

  if(!list.length){
    empty("No content found.");
    return;
  }

  list.forEach(item=>{
    const series=
      item.kind==="series";

    const count=series
      ?content.filter(
          x=>
            x.kind==="episode" &&
            x.parent_id===item.id
        ).length
      :0;

    const b=makeCard(
      item,
      series?"SERIES":"LIVE",
      series
        ?`${count} EPISODES`
        :item.public_id
    );

    b.onclick=()=>
      series
        ?openSeries(item)
        :play(item);

    $("channelGrid").append(b);
  });
}

function clearURL(){
  const u=new URL(location.href);

  [
    "channel",
    "show",
    "episode"
  ].forEach(
    key=>u.searchParams.delete(key)
  );

  history.replaceState(
    {},
    "",
    u
  );
}

function updateURL(item){
  const u=new URL(location.href);

  [
    "channel",
    "show",
    "episode"
  ].forEach(
    key=>u.searchParams.delete(key)
  );

  if(item.kind==="episode"){
    const parent=content.find(
      x=>x.id===item.parent_id
    );

    if(parent?.public_id){
      u.searchParams.set(
        "show",
        parent.public_id
      );
    }

    if(item.public_id){
      u.searchParams.set(
        "episode",
        item.public_id
      );
    }

  }else if(item.kind==="series"){
    if(item.public_id){
      u.searchParams.set(
        "show",
        item.public_id
      );
    }

  }else if(item.public_id){
    u.searchParams.set(
      "channel",
      item.public_id
    );
  }

  history.replaceState(
    {},
    "",
    u
  );
}

function openSeries(item,update=true){
  activeSeries=item;
  section=item.section_slug;
  filter="all";
  selected="";
  $("search").value="";

  if(update){
    updateURL(item);
  }

  renderTabs();
  renderFilters();
  render();

  $("channels").scrollIntoView({
    behavior:"smooth"
  });
}

function play(item,update=true){

  /* =========================================================
     BASIC PLAYER STATE
  ========================================================= */

  selected=item.id;

  /*
    Episode hai to uska parent show restore karo.
  */

  if(item.kind==="episode"){

    const parent=content.find(
      x=>
        x.id===item.parent_id &&
        x.kind==="series"
    );

    if(parent){

      activeSeries=parent;

      section=
        parent.section_slug||
        item.section_slug||
        section;

    }else{

      section=
        item.section_slug||
        section;

    }

  }else{

    section=
      item.section_slug||
      section;

    activeSeries=null;
  }

  /*
    Shareable URL update.
  */

  if(update){
    updateURL(item);
  }

  /*
    Player information.
  */

  $("playingTitle").textContent=
    item.title;

  $("playingCategory").textContent=
    (
      item.category||
      item.kind||
      "CRICFREEX"
    ).toUpperCase();

  $("playingStatus").textContent=
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

  const url=
    safeURL(
      item.media_url
    );

  /*
    Completely clear previous player.
  */

  $("playerWrap")
    .replaceChildren();

  if(!url){

    $("playingStatus").textContent=
      "UNAVAILABLE";

    $("playerWrap").innerHTML=
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
      behavior:"smooth",
      block:"start"
    });

    return;
  }

  /* =========================================================
     EXTERNAL STREAM / DOWNLOAD LINK
  ========================================================= */

  if(item.media_type==="link"){

    $("playingStatus").textContent=
      "LINK READY";

    const wrapper=
      document.createElement(
        "div"
      );

    wrapper.className=
      "link-player";

    const inner=
      document.createElement(
        "div"
      );

    inner.className=
      "link-player-inner";

    const icon=
      document.createElement(
        "div"
      );

    icon.className=
      "link-player-icon";

    icon.textContent="↗";

    const heading=
      document.createElement(
        "h2"
      );

    heading.textContent=
      "Stream / Download Available";

    const message=
      document.createElement(
        "p"
      );

    message.textContent=
      "This content is available through an external link. Continue using the button below.";

    const openButton=
      document.createElement(
        "a"
      );

    openButton.className=
      "link-open-button";

    openButton.href=url;

    openButton.target=
      "_blank";

    openButton.rel=
      "noopener noreferrer";

   openButton.textContent=url;

    const note=
      document.createElement(
        "small"
      );

    note.className=
      "link-note";

    note.textContent=
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
      behavior:"smooth",
      block:"start"
    });

    return;
  }

  /* =========================================================
     HLS / M3U8
  ========================================================= */

  if(
    item.media_type==="hls" ||
    /\.m3u8($|\?)/i.test(url)
  ){

    const video=
      document.createElement(
        "video"
      );

    video.className=
      "stream-video";

    video.controls=true;

    video.playsInline=true;

    video.autoplay=true;

    video.preload="metadata";

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

    if(
      video.canPlayType(
        "application/vnd.apple.mpegurl"
      )
    ){

      video.src=url;

      video.addEventListener(
        "loadedmetadata",
        ()=>{

          $("playingStatus").textContent=
            "NOW PLAYING";

          video.play()
            .catch(()=>{});
        }
      );

      video.addEventListener(
        "error",
        ()=>{

          $("playingStatus").textContent=
            "ERROR";
        }
      );

    }

    /*
      Chrome / Edge / Android etc.
    */

    else if(
      window.Hls &&
      Hls.isSupported()
    ){

      const hls=
        new Hls({

          enableWorker:true,

          lowLatencyMode:false,

          backBufferLength:30

        });

      /*
        Keep reference on video.
      */

      video._hls=
        hls;

      hls.loadSource(
        url
      );

      hls.attachMedia(
        video
      );

      hls.on(
        Hls.Events.MANIFEST_PARSED,
        ()=>{

          $("playingStatus").textContent=
            "NOW PLAYING";

          video.play()
            .catch(()=>{});
        }
      );

      hls.on(
        Hls.Events.ERROR,
        (
          event,
          data
        )=>{

          console.error(
            "HLS playback error:",
            data
          );

          /*
            Ignore recoverable errors.
          */

          if(!data.fatal){
            return;
          }

          /*
            Network failure:
            attempt reconnect.
          */

          if(
            data.type===
            Hls.ErrorTypes.NETWORK_ERROR
          ){

            $("playingStatus").textContent=
              "RECONNECTING";

            hls.startLoad();

            return;
          }

          /*
            Media decode problem:
            attempt recovery.
          */

          if(
            data.type===
            Hls.ErrorTypes.MEDIA_ERROR
          ){

            $("playingStatus").textContent=
              "RECOVERING";

            hls.recoverMediaError();

            return;
          }

          /*
            Non-recoverable.
          */

          $("playingStatus").textContent=
            "ERROR";

          hls.destroy();
        }
      );

    }else{

      $("playingStatus").textContent=
        "UNSUPPORTED";

      $("playerWrap").innerHTML=
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
      behavior:"smooth",
      block:"start"
    });

    return;
  }

  /* =========================================================
     DIRECT MP4 / WEBM VIDEO
  ========================================================= */

  if(item.media_type==="video"){

    const video=
      document.createElement(
        "video"
      );

    video.className=
      "stream-video";

    video.controls=true;

    video.playsInline=true;

    video.autoplay=true;

    video.preload="metadata";

    video.setAttribute(
      "controlsList",
      "nodownload"
    );

    video.addEventListener(
      "loadeddata",
      ()=>{

        $("playingStatus").textContent=
          "NOW PLAYING";
      }
    );

    video.addEventListener(
      "playing",
      ()=>{

        $("playingStatus").textContent=
          "NOW PLAYING";
      }
    );

    video.addEventListener(
      "waiting",
      ()=>{

        $("playingStatus").textContent=
          "BUFFERING";
      }
    );

    video.addEventListener(
      "error",
      ()=>{

        $("playingStatus").textContent=
          "ERROR";
      }
    );

    video.src=url;

    $("playerWrap").append(
      video
    );

    /*
      Autoplay may be blocked.
      That's normal; controls remain available.
    */

    video.play()
      .catch(()=>{});

    $("watch").scrollIntoView({
      behavior:"smooth",
      block:"start"
    });

    return;
  }

  /* =========================================================
     IFRAME / EMBED
  ========================================================= */

  const iframe=
    document.createElement(
      "iframe"
    );

  iframe.className=
    "stream-frame";

  iframe.title=
    item.title||
    "CricFreeX Player";

  iframe.allow=
    "autoplay; encrypted-media; fullscreen; picture-in-picture";

  iframe.allowFullscreen=
    true;

  iframe.referrerPolicy=
    "strict-origin-when-cross-origin";

  iframe.addEventListener(
    "load",
    ()=>{

      $("playingStatus").textContent=
        "NOW PLAYING";
    }
  );

  iframe.addEventListener(
    "error",
    ()=>{

      $("playingStatus").textContent=
        "ERROR";
    }
  );

  iframe.src=url;

  $("playerWrap").append(
    iframe
  );

  $("watch").scrollIntoView({
    behavior:"smooth",
    block:"start"
  });
}




function restoreURL(){
  const p=
    new URLSearchParams(
      location.search
    );

  const episodeId=p.get("episode");
  const channelId=p.get("channel");
  const showId=p.get("show");

  if(episodeId){
    const episode=content.find(
      x=>
        x.kind==="episode" &&
        x.public_id===episodeId
    );

    if(episode){
      play(episode,false);
      return;
    }
  }

  if(channelId){
    const channel=content.find(
      x=>
        x.public_id===channelId &&
        x.kind!=="episode" &&
        x.kind!=="series"
    );

    if(channel){
      play(channel,false);
      return;
    }
  }

  if(showId){
    const show=content.find(
      x=>
        x.kind==="series" &&
        x.public_id===showId
    );

    if(show){
      openSeries(show,false);
    }
  }
}

$("seriesBack").onclick=()=>{
  activeSeries=null;
  selected="";
  filter="all";
  $("search").value="";
  clearURL();
  renderFilters();
  render();
};

$("search").oninput=render;

$("brand").onclick=()=>
  scrollTo({
    top:0,
    behavior:"smooth"
  });

$("exploreButton").onclick=()=>
  $("channels").scrollIntoView({
    behavior:"smooth"
  });

$("watchButton").onclick=()=>
  $("watch").scrollIntoView({
    behavior:"smooth"
  });

$("adminEntry").onclick=()=>
  location.href="./admin.html";

let timer=null;

function refresh(){
  clearTimeout(timer);

  timer=setTimeout(
    load,
    250
  );
}

db.channel("cricfreex-public")
  .on(
    "postgres_changes",
    {
      event:"*",
      schema:"public",
      table:"site_settings"
    },
    refresh
  )
  .on(
    "postgres_changes",
    {
      event:"*",
      schema:"public",
      table:"sections"
    },
    refresh
  )
  .on(
    "postgres_changes",
    {
      event:"*",
      schema:"public",
      table:"content"
    },
    refresh
  )
  .subscribe();

async function start(){
  await load();

  if(!restored){
    restored=true;
    restoreURL();
  }
}

start();