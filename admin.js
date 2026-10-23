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
const CRICKET_API_BASE=String(
  CONFIG.CRICKET_API_URL||""
).replace(/\/+$/,"");

let sections=[];
let content=[];
let settings={};
let loading=false;
let watchMatches={live:[],upcoming:[]};
let selectedMatchLinks=[];
let matchRequest=0;

function isCricketWatchLink(item){
  return String(item?.category||"")
    .startsWith(CRICKET_WATCH_LINK_PREFIX);
}

function cricketWatchMatchId(item){
  return String(item?.category||"")
    .slice(CRICKET_WATCH_LINK_PREFIX.length);
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

  $("loginButton").disabled=false;
  $("loginButton").textContent="Continue";
};

$("logout").onclick=async()=>{
  await db.auth.signOut();
  location.reload();
};

$("openSite").onclick=()=>{
  location.href="./index.html";
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
    content=c.data||[];
    settings=w.data||{};

    $("statSections").textContent=sections.length;
    $("statContent").textContent=
      content.filter(x=>!isCricketWatchLink(x)).length;
    $("statShows").textContent=
      content.filter(
        x=>!isCricketWatchLink(x)&&x.kind==="series"
      ).length;
    $("statEpisodes").textContent=
      content.filter(
        x=>!isCricketWatchLink(x)&&x.kind==="episode"
      ).length;

    renderContent();
    renderSections();
    fillWebsite();
    fillSelectors();

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

    $("editorPanel").classList.add("hidden");
    if(tab==="watchLinks"){
      loadCricketMatches(
        $("watchMatchCategory").value
      );
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
  return [
    teams||"Match",
    match.description,
    match.series,
    match.state
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

  watchMatches[category].forEach(match=>{
    const option=document.createElement("option");
    option.value=String(match.id);
    option.textContent=matchOptionLabel(match);
    select.append(option);
  });

  if(watchMatches[category].some(
    match=>String(match.id)===previous
  )){
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

function addWatchLinkRow(item={}){
  if($("watchLinkRows").children.length>=3){
    setWatchLinkStatus("A match can have up to three watch servers.");
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
  $("addWatchLink").disabled=count>=3;
  $("addWatchLink").textContent=count>=3
    ?"Maximum 3 servers"
    :"+ Add another server";
}

function loadSelectedMatchLinks(){
  const matchId=$("watchMatch").value;
  selectedMatchLinks=matchId
    ?content.filter(item=>
      isCricketWatchLink(item)&&
      cricketWatchMatchId(item)===matchId
    )
    :[];
  $("watchLinkRows").replaceChildren();
  selectedMatchLinks.forEach(addWatchLinkRow);
  if(matchId&&!selectedMatchLinks.length){
    addWatchLinkRow();
  }
}

$("watchMatchCategory").addEventListener("change",()=>{
  $("watchMatch").value="";
  $("watchLinkRows").replaceChildren();
  selectedMatchLinks=[];
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
});

$("refreshWatchMatches").addEventListener("click",()=>{
  loadCricketMatches($("watchMatchCategory").value);
});

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
  if(records.length>3){
    setWatchLinkStatus("A match can have up to three watch servers.",true);
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
    setWatchLinkStatus(
      `${records.length} watch link${records.length===1?"":"s"} saved. They are now available on this match card.`
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
    if(isCricketWatchLink(item))return false;
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
  const oldParent=$("parentId").value;

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

  $("parentId").innerHTML=
    '<option value="">Select Parent Show</option>';

  content
    .filter(x=>x.kind==="series")
    .forEach(show=>{
      const option=document.createElement("option");
      option.value=show.id;
      option.textContent=show.title;
      $("parentId").append(option);
    });

  if(
    content.some(
      x=>
        x.id===oldParent &&
        x.kind==="series"
    )
  ){
    $("parentId").value=oldParent;
  }
}

function applyKindRules(){
  const kind=$("contentKind").value;
  const isEpisode=kind==="episode";

  $("parentId").disabled=!isEpisode;
  $("episodeNumber").disabled=!isEpisode;

  if(!isEpisode){
    $("parentId").value="";
    $("episodeNumber").value="";
  }
}

$("contentKind").addEventListener(
  "change",
  applyKindRules
);

$("parentId").addEventListener(
  "change",
  ()=>{
    if(
      $("contentKind").value!=="episode"
    )return;

    const show=content.find(
      x=>
        x.id===$("parentId").value &&
        x.kind==="series"
    );

    if(!show)return;

    /*
      Episodes inherit show location.
    */

    $("contentSection").value=
      show.section_slug||"";

    $("contentCategory").value=
      show.category||"series";
  }
);

/* =========================================================
   EDITOR
========================================================= */

function resetEditor(){
  $("contentForm").reset();
  $("contentId").value="";
  $("sortOrder").value="0";
  $("published").value="true";
  $("contentKind").value="channel";
  $("mediaType").value="iframe";
  $("editorHeading").textContent="Add Content";
  $("deleteContent").classList.add("hidden");

  fillSelectors();

  if(sections.length){
    $("contentSection").value=
      sections[0].slug;
  }else{
    throw new Error(
      "No content section is available. Refresh Admin and try again."
    );
  }

  applyKindRules();
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
  $("contentKind").value=item.kind||"channel";

  /*
    Enable episode controls before
    setting parent.
  */

  applyKindRules();

  if(item.kind==="episode"){
    $("parentId").value=item.parent_id||"";
    $("episodeNumber").value=
      item.episode_number||"";
  }

  $("mediaType").value=
    item.media_type||"iframe";

  $("mediaUrl").value=
    item.media_url||"";

  $("sortOrder").value=
    item.sort_order||0;

  $("published").value=
    String(item.published);

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

    const kind=$("contentKind").value;

    const title=$("contentTitle")
      .value
      .trim();

    if(!title){
      throw new Error("Title is required.");
    }

    let parent=null;

    if(kind==="episode"){
      const parentId=$("parentId").value;

      if(!parentId){
        throw new Error(
          "Episode must have a Parent Show."
        );
      }

      parent=content.find(
        x=>
          x.id===parentId &&
          x.kind==="series"
      );

      if(!parent){
        throw new Error(
          "Selected parent show is invalid."
        );
      }
    }

    const videoFile=
      $("videoUpload").files[0];

    let mediaUrl=
      $("mediaUrl").value.trim()
      ||
      existing?.media_url
      ||
      null;

    let mediaType=
      $("mediaType").value;

    if(videoFile){
      uploadedVideo=
        await uploadFile(
          videoFile,
          "videos"
        );

      mediaUrl=uploadedVideo;
      mediaType="video";
    }

    /*
      Series = container.
      Its media is not used by player.
    */

    if(kind==="series"){
      mediaUrl=null;
    }

    const payload={
      title,
      public_id:
        $("publicId").value.trim()||
        null,

      section_slug:
        kind==="episode"
          ?parent.section_slug
          :$("contentSection").value,

      category:
        kind==="episode"
          ?(parent.category||"series")
          :($("contentCategory").value.trim()||null),

      kind,

      parent_id:
        kind==="episode"
          ?parent.id
          :null,

      media_type:
        mediaType,

      media_url:
        mediaUrl,

      image_url:
        existing?.image_url||null,

      episode_number:
        kind==="episode"
          ?(
              $("episodeNumber").value
                ?Number(
                    $("episodeNumber").value
                  )
                :null
            )
          :null,

      sort_order:
        Number(
          $("sortOrder").value
        )||0,

      published:
        $("published").value==="true",

      updated_at:
        new Date().toISOString()
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

    /*
      If an existing channel/video is
      converted into a Series, its old
      uploaded player media is no longer
      referenced.
    */

    if(
      existing?.media_url &&
      kind==="series"
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
  if(
    document.visibilityState==="visible"&&
    document.querySelector('.tab[data-tab="watchLinks"]')?.classList.contains("active")
  ){
    loadCricketMatches($("watchMatchCategory").value);
  }
},60000);

/* =========================================================
   START
========================================================= */

bootstrap();