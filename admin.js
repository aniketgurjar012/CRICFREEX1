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

let sections=[];
let content=[];
let settings={};
let loading=false;

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
      content.filter(x=>x.kind!=="series"&&x.kind!=="episode"&&!String(x.category||"").startsWith("__cricket_watch__:")).length;

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

    $("editorPanel").classList.add("hidden");
  };
});

function renderContent(){
  const query=
    $("contentSearch").value
      .trim()
      .toLowerCase();

  $("contentList").replaceChildren();

  const list=content.filter(item=>{
    if(item.kind==="series"||item.kind==="episode"||String(item.category||"").startsWith("__cricket_watch__:"))return false;
    if(!query)return true;

    return [
      item.title,
      item.public_id,
      item.category,
      item.section_slug,
      item.kind
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
      thumb.textContent="CX";
    }

    const info=document.createElement("div");

    const title=document.createElement("b");
    title.textContent=item.title;

    const details=document.createElement("small");

    const parts=[
      item.kind,
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

  if(item.section_slug){
    const hasOption=Array.from($("contentSection").options).some(o=>o.value===item.section_slug);
    if(!hasOption){
      const opt=document.createElement("option");
      opt.value=item.section_slug;
      opt.textContent=item.section_slug;
      $("contentSection").appendChild(opt);
    }
  }
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
    const id=$("contentId").value.trim();

    const existing=id
      ?content.find(x=>String(x.id)===String(id))
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

    if(mediaUrl && /<iframe/i.test(mediaUrl)){
      const srcMatch=mediaUrl.match(/src=["']([^"']+)["']/i);
      if(srcMatch && srcMatch[1]){
        mediaUrl=srcMatch[1].trim();
      }
    }
    if(mediaUrl && mediaUrl.startsWith("//")){
      mediaUrl=`https:${mediaUrl}`;
    }

    const sectionSlug=
      $("contentSection").value.trim()||
      existing?.section_slug||
      (sections[0]?.slug||"channels");

    const payload={
      title,
      public_id:
        $("publicId").value.trim()||
        null,

      section_slug: sectionSlug,

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
        .eq("id",isNaN(Number(id))?id:Number(id));
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

    alert("Channel saved successfully!");
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
      .eq("id",isNaN(Number(item.id))?item.id:Number(item.id));

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
  const curId=$("contentId").value.trim();
  const item=content.find(
    x=>
      String(x.id)===
      String(curId)
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

/* =========================================================
   THEME TOGGLE
========================================================= */

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