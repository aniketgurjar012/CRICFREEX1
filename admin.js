"use strict";

const CONFIG=window.CRICFREEX_CONFIG;

if(
  !CONFIG?.SUPABASE_URL ||
  !CONFIG?.SUPABASE_ANON_KEY
){
  throw new Error(
    "CricFreeX Supabase configuration is missing."
  );
}

const db=window.supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY,
  {
    auth:{
      persistSession:true,
      autoRefreshToken:true,
      detectSessionInUrl:true
    }
  }
);

const $=id=>document.getElementById(id);

let sections=[];
let content=[];
let settings={};
let sessionUser=null;
let loadingData=false;

/* ============================================================
   LOGIN / ACCESS
============================================================ */

function showLogin(){
  $("loginPage").classList.remove("hidden");
  $("adminApp").classList.add("hidden");
}

function showAdmin(){
  $("loginPage").classList.add("hidden");
  $("adminApp").classList.remove("hidden");
}

async function verifyAdmin(user){

  if(!user){
    return false;
  }

  const {data,error}=await db
    .from("admins")
    .select("user_id")
    .eq("user_id",user.id)
    .maybeSingle();

  if(error){
    console.error(
      "Admin verification failed:",
      error
    );

    return false;
  }

  return Boolean(data);
}

async function bootstrap(){

  const {data,error}=
    await db.auth.getSession();

  if(error){
    console.error(error);
    showLogin();
    return;
  }

  const session=data.session;

  if(!session){
    showLogin();
    return;
  }

  const allowed=
    await verifyAdmin(
      session.user
    );

  if(!allowed){

    await db.auth.signOut();

    showLogin();

    return;
  }

  sessionUser=session.user;

  showAdmin();

  await loadAll();
}

$("loginForm").addEventListener(
  "submit",
  async event=>{

    event.preventDefault();

    $("loginError").textContent="";

    $("loginButton").disabled=true;
    $("loginButton").textContent=
      "Signing in...";

    try{

      const {data,error}=
        await db.auth
          .signInWithPassword({
            email:
              $("email")
                .value
                .trim(),

            password:
              $("password").value
          });

      if(error){
        throw error;
      }

      const allowed=
        await verifyAdmin(
          data.user
        );

      if(!allowed){

        await db.auth.signOut();

        $("loginError").textContent=
          "Access denied.";

        return;
      }

      sessionUser=data.user;

      showAdmin();

      await loadAll();

    }catch(error){

      console.error(error);

      $("loginError").textContent=
        "Invalid email or password.";

    }finally{

      $("loginButton").disabled=false;
      $("loginButton").textContent=
        "Continue";
    }
  }
);

$("logout").addEventListener(
  "click",
  async ()=>{

    await db.auth.signOut();

    location.reload();
  }
);

$("openSite").addEventListener(
  "click",
  ()=>{

    location.href="./index.html";
  }
);

/* ============================================================
   LOAD EVERYTHING
============================================================ */

async function loadAll(){

  if(loadingData){
    return;
  }

  loadingData=true;

  try{

    const [
      sectionResult,
      contentResult,
      settingsResult
    ]=await Promise.all([

      db
        .from("sections")
        .select("*")
        .order(
          "sort_order",
          {ascending:true}
        ),

      db
        .from("content")
        .select("*")
        .order(
          "sort_order",
          {ascending:true}
        ),

      db
        .from("site_settings")
        .select("*")
        .eq("id",1)
        .maybeSingle()

    ]);

    if(sectionResult.error){
      throw sectionResult.error;
    }

    if(contentResult.error){
      throw contentResult.error;
    }

    if(settingsResult.error){
      throw settingsResult.error;
    }

    sections=
      sectionResult.data||[];

    content=
      contentResult.data||[];

    settings=
      settingsResult.data||{};

    updateStatistics();

    renderContent();

    renderSections();

    fillWebsite();

    fillSelectors();

  }catch(error){

    console.error(
      "Admin data load failed:",
      error
    );

    alert(
      "Could not load dashboard data: "+
      error.message
    );

  }finally{

    loadingData=false;
  }
}

function updateStatistics(){

  $("statSections").textContent=
    sections.length;

  $("statContent").textContent=
    content.length;

  $("statShows").textContent=
    content.filter(
      item=>item.kind==="series"
    ).length;

  $("statEpisodes").textContent=
    content.filter(
      item=>item.kind==="episode"
    ).length;
}

/* ============================================================
   ADMIN TABS
============================================================ */

document
  .querySelectorAll(".tab")
  .forEach(button=>{

    button.addEventListener(
      "click",
      ()=>{

        document
          .querySelectorAll(".tab")
          .forEach(item=>
            item.classList
              .remove("active")
          );

        button.classList.add(
          "active"
        );

        const selected=
          button.dataset.tab;

        $("contentPanel")
          .classList
          .toggle(
            "hidden",
            selected!=="content"
          );

        $("websitePanel")
          .classList
          .toggle(
            "hidden",
            selected!=="website"
          );

        $("sectionsPanel")
          .classList
          .toggle(
            "hidden",
            selected!=="sections"
          );

        $("editorPanel")
          .classList
          .add("hidden");
      }
    );
  });

/* ============================================================
   CONTENT LIST
============================================================ */

function renderContent(){

  const query=
    $("contentSearch")
      .value
      .trim()
      .toLowerCase();

  const filtered=
    content.filter(item=>{

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
        item.category
          ?.toLowerCase()
          .includes(query)
        ||
        item.section_slug
          ?.toLowerCase()
          .includes(query)
        ||
        item.kind
          ?.toLowerCase()
          .includes(query)
      );
    });

  $("contentList")
    .replaceChildren();

  if(!filtered.length){

    $("contentList").innerHTML=
      '<div class="empty">No content found.</div>';

    return;
  }

  filtered.forEach(item=>{

    const row=
      document.createElement(
        "div"
      );

    row.className="row";

    let media;

    if(item.image_url){

      media=
        document.createElement(
          "img"
        );

      media.className="thumb";

      media.src=item.image_url;

      media.alt="";

      media.loading="lazy";

    }else{

      media=
        document.createElement(
          "div"
        );

      media.className=
        "thumb-placeholder";

      media.textContent=
        item.kind==="series"
          ?"S"
          :item.kind==="episode"
            ?"E"
            :"CX";
    }

    const info=
      document.createElement(
        "div"
      );

    const title=
      document.createElement(
        "b"
      );

    title.textContent=
      item.title;

    const details=
      document.createElement(
        "small"
      );

    const detailsParts=[
      item.kind,
      item.section_slug,
      item.category,
      item.public_id,
      item.published
        ?"Published"
        :"Draft"
    ].filter(Boolean);

    details.textContent=
      detailsParts.join(" • ");

    info.append(
      title,
      details
    );

    const actions=
      document.createElement(
        "div"
      );

    actions.className=
      "actions";

    const editButton=
      document.createElement(
        "button"
      );

    editButton.className=
      "ghost";

    editButton.textContent=
      "Edit";

    editButton.addEventListener(
      "click",
      ()=>editContent(item)
    );

    const deleteButton=
      document.createElement(
        "button"
      );

    deleteButton.className=
      "danger";

    deleteButton.textContent=
      "Delete";

    deleteButton.addEventListener(
      "click",
      ()=>removeContent(item)
    );

    actions.append(
      editButton,
      deleteButton
    );

    row.append(
      media,
      info,
      actions
    );

    $("contentList")
      .append(row);
  });
}

$("contentSearch")
  .addEventListener(
    "input",
    renderContent
  );

/* ============================================================
   FORM SELECTORS
============================================================ */

function fillSelectors(){

  const currentSection=
    $("contentSection").value;

  const currentParent=
    $("parentId").value;

  $("contentSection")
    .replaceChildren();

  sections.forEach(section=>{

    const option=
      document.createElement(
        "option"
      );

    option.value=
      section.slug;

    option.textContent=
      section.name;

    $("contentSection")
      .append(option);
  });

  if(
    currentSection &&
    sections.some(
      item=>
        item.slug===
        currentSection
    )
  ){
    $("contentSection").value=
      currentSection;
  }

  $("parentId").innerHTML=
    '<option value="">None</option>';

  content
    .filter(
      item=>
        item.kind==="series"
    )
    .forEach(show=>{

      const option=
        document.createElement(
          "option"
        );

      option.value=
        show.id;

      option.textContent=
        show.title;

      $("parentId")
        .append(option);
    });

  if(
    currentParent &&
    content.some(
      item=>
        item.id===
        currentParent &&
        item.kind==="series"
    )
  ){
    $("parentId").value=
      currentParent;
  }
}

/* ============================================================
   ADD / EDIT CONTENT
============================================================ */

function resetEditor(){

  $("contentForm").reset();

  $("contentId").value="";

  $("sortOrder").value="0";

  $("published").value="true";

  $("contentKind").value=
    "channel";

  $("mediaType").value=
    "iframe";

  $("editorHeading")
    .textContent=
      "Add Content";

  $("deleteContent")
    .classList
    .add("hidden");

  fillSelectors();

  if(sections.length){

    $("contentSection").value=
      sections[0].slug;
  }
}

$("addContent").addEventListener(
  "click",
  ()=>{

    resetEditor();

    $("editorPanel")
      .classList
      .remove("hidden");

    $("editorPanel")
      .scrollIntoView({
        behavior:"smooth",
        block:"start"
      });
  }
);

$("closeEditor").addEventListener(
  "click",
  ()=>{

    $("editorPanel")
      .classList
      .add("hidden");
  }
);

function editContent(item){

  resetEditor();

  $("editorHeading")
    .textContent=
      "Edit Content";

  $("contentId").value=
    item.id;

  $("contentTitle").value=
    item.title||"";

  $("publicId").value=
    item.public_id||"";

  $("contentSection").value=
    item.section_slug||"";

  $("contentCategory").value=
    item.category||"";

  $("contentKind").value=
    item.kind||"channel";

  $("parentId").value=
    item.parent_id||"";

  $("mediaType").value=
    item.media_type||"iframe";

  $("episodeNumber").value=
    item.episode_number||"";

  $("mediaUrl").value=
    item.media_url||"";

  $("sortOrder").value=
    item.sort_order||0;

  $("published").value=
    String(
      item.published
    );

  $("deleteContent")
    .classList
    .remove("hidden");

  $("editorPanel")
    .classList
    .remove("hidden");

  $("editorPanel")
    .scrollIntoView({
      behavior:"smooth",
      block:"start"
    });
}

/* ============================================================
   STORAGE HELPERS
============================================================ */

/*
  Only URLs belonging to this project's PUBLIC
  "media" bucket are considered deletable.

  External iframe/video URLs are ignored.
*/

function getStoragePath(
  publicUrl
){

  if(!publicUrl){
    return null;
  }

  try{

    const url=
      new URL(publicUrl);

    const projectHost=
      new URL(
        CONFIG.SUPABASE_URL
      ).host;

    /*
      Extra protection:
      only operate on this
      Supabase project.
    */

    if(
      url.host!==
      projectHost
    ){
      return null;
    }

    const markers=[

      "/storage/v1/object/public/media/",

      "/storage/v1/object/sign/media/"

    ];

    for(
      const marker of markers
    ){

      const position=
        url.pathname
          .indexOf(marker);

      if(position!==-1){

        const path=
          url.pathname.slice(
            position+
            marker.length
          );

        if(!path){
          return null;
        }

        return decodeURIComponent(
          path
        );
      }
    }

    return null;

  }catch{

    return null;
  }
}

async function deleteStoragePaths(
  paths
){

  const uniquePaths=
    [
      ...new Set(
        paths.filter(Boolean)
      )
    ];

  if(!uniquePaths.length){
    return;
  }

  const {error}=
    await db.storage
      .from("media")
      .remove(uniquePaths);

  if(error){
    throw error;
  }
}

async function deleteMediaFiles(
  records
){

  const paths=[];

  for(const record of records){

    const imagePath=
      getStoragePath(
        record.image_url
      );

    if(imagePath){
      paths.push(imagePath);
    }

    /*
      media_url is deleted only
      when it actually points to
      this project's media bucket.

      This means external iframe
      URLs remain untouched.
    */

    const mediaPath=
      getStoragePath(
        record.media_url
      );

    if(mediaPath){
      paths.push(mediaPath);
    }
  }

  await deleteStoragePaths(
    paths
  );
}

/* ============================================================
   FILE UPLOAD
============================================================ */

async function upload(
  file,
  folder
){

  if(!file){
    return null;
  }

  const isVideo=
    folder==="videos";

  const maxSize=
    isVideo
      ?250*1024*1024
      :8*1024*1024;

  if(file.size>maxSize){

    throw new Error(
      isVideo
        ?"Video is too large. Maximum 250 MB."
        :"Image is too large. Maximum 8 MB."
    );
  }

  const allowedImageTypes=[
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  const allowedVideoTypes=[
    "video/mp4",
    "video/webm"
  ];

  if(
    isVideo &&
    !allowedVideoTypes.includes(
      file.type
    )
  ){
    throw new Error(
      "Only MP4 and WebM video files are allowed."
    );
  }

  if(
    !isVideo &&
    !allowedImageTypes.includes(
      file.type
    )
  ){
    throw new Error(
      "Only JPG, PNG and WebP images are allowed."
    );
  }

  let extension=
    file.name
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(
        /[^a-z0-9]/g,
        ""
      );

  if(!extension){

    extension=
      isVideo
        ?"mp4"
        :"jpg";
  }

  const path=
    `${folder}/${crypto.randomUUID()}.${extension}`;

  const {error}=
    await db.storage
      .from("media")
      .upload(
        path,
        file,
        {
          cacheControl:"3600",
          upsert:false,
          contentType:file.type
        }
      );

  if(error){
    throw error;
  }

  const {
    data
  }=
    db.storage
      .from("media")
      .getPublicUrl(path);

  if(
    !data?.publicUrl
  ){
    throw new Error(
      "Could not generate media URL."
    );
  }

  return data.publicUrl;
}

/* ============================================================
   SAVE CONTENT
============================================================ */

$("contentForm")
  .addEventListener(
    "submit",
    async event=>{

      event.preventDefault();

      const saveButton=
        $("saveContent");

      saveButton.disabled=true;

      saveButton.textContent=
        "Saving...";

      let newImageUrl=null;
      let newVideoUrl=null;

      try{

        const id=
          $("contentId").value;

        const existing=
          id
            ?content.find(
                item=>item.id===id
              )
            :null;

        const imageFile=
          $("imageUpload")
            .files[0];

        const videoFile=
          $("videoUpload")
            .files[0];

        /*
          Start with current values.
        */

        let imageUrl=
          existing?.image_url||
          null;

        let mediaUrl=
          $("mediaUrl")
            .value
            .trim()
          ||
          existing?.media_url
          ||
          null;

        let mediaType=
          $("mediaType").value;

        /*
          Upload replacements first.
        */

        if(imageFile){

          newImageUrl=
            await upload(
              imageFile,
              "images"
            );

          imageUrl=
            newImageUrl;
        }

        if(videoFile){

          newVideoUrl=
            await upload(
              videoFile,
              "videos"
            );

          mediaUrl=
            newVideoUrl;

          mediaType="video";
        }

        const title=
          $("contentTitle")
            .value
            .trim();

        if(!title){

          throw new Error(
            "Title is required."
          );
        }

        const kind=
          $("contentKind").value;

        const parentId=
          $("parentId").value||
          null;

        /*
          Episode must have a series.
        */

        if(
          kind==="episode" &&
          !parentId
        ){

          throw new Error(
            "Select a parent show for the episode."
          );
        }

        /*
          A series itself cannot
          have another parent.
        */

        const finalParent=
          kind==="episode"
            ?parentId
            :null;

        const payload={

          title,

          public_id:
            $("publicId")
              .value
              .trim()
            ||null,

          section_slug:
            $("contentSection")
              .value,

          category:
            $("contentCategory")
              .value
              .trim()
            ||null,

          kind,

          parent_id:
            finalParent,

          media_type:
            mediaType,

          media_url:
            kind==="series"
              ?null
              :mediaUrl,

          image_url:
            imageUrl,

          episode_number:
            kind==="episode" &&
            $("episodeNumber").value
              ?Number(
                  $("episodeNumber")
                    .value
                )
              :null,

          sort_order:
            Number(
              $("sortOrder")
                .value
            )||0,

          published:
            $("published")
              .value===
              "true",

          updated_at:
            new Date()
              .toISOString()
        };

        let result;

        if(id){

          result=
            await db
              .from("content")
              .update(payload)
              .eq("id",id);

        }else{

          result=
            await db
              .from("content")
              .insert(payload);
        }

        if(result.error){
          throw result.error;
        }

        /*
          Database save succeeded.

          Now clean old files that
          were replaced.
        */

        const oldPaths=[];

        if(
          existing &&
          newImageUrl &&
          existing.image_url &&
          existing.image_url!==
          newImageUrl
        ){

          const oldImagePath=
            getStoragePath(
              existing.image_url
            );

          if(oldImagePath){
            oldPaths.push(
              oldImagePath
            );
          }
        }

        if(
          existing &&
          newVideoUrl &&
          existing.media_url &&
          existing.media_url!==
          newVideoUrl
        ){

          const oldVideoPath=
            getStoragePath(
              existing.media_url
            );

          if(oldVideoPath){
            oldPaths.push(
              oldVideoPath
            );
          }
        }

        if(oldPaths.length){

          try{

            await deleteStoragePaths(
              oldPaths
            );

          }catch(cleanupError){

            console.warn(
              "Old media cleanup failed:",
              cleanupError
            );
          }
        }

        $("editorPanel")
          .classList
          .add("hidden");

        await loadAll();

      }catch(error){

        console.error(
          "Save failed:",
          error
        );

        /*
          If upload succeeded but
          database save failed,
          remove the newly-created
          files to avoid orphan files.
        */

        const cleanup=[];

        const newImagePath=
          getStoragePath(
            newImageUrl
          );

        const newVideoPath=
          getStoragePath(
            newVideoUrl
          );

        if(newImagePath){
          cleanup.push(
            newImagePath
          );
        }

        if(newVideoPath){
          cleanup.push(
            newVideoPath
          );
        }

        if(cleanup.length){

          try{

            await deleteStoragePaths(
              cleanup
            );

          }catch(cleanupError){

            console.warn(
              "Failed upload cleanup:",
              cleanupError
            );
          }
        }

        alert(
          "Save failed: "+
          error.message
        );

      }finally{

        saveButton.disabled=false;

        saveButton.textContent=
          "Save Content";
      }
    }
  );

/* ============================================================
   DELETE CONTENT + STORAGE CLEANUP
============================================================ */

async function getRecordsForDeletion(
  item
){

  /*
    Normal content:
    only itself.

    Series:
    series + all directly attached
    episodes.

    Current data model only has
    one episode level.
  */

  if(item.kind!=="series"){

    return [{
      id:item.id,
      image_url:item.image_url,
      media_url:item.media_url,
      media_type:item.media_type
    }];
  }

  const {data,error}=
    await db
      .from("content")
      .select(
        "id,image_url,media_url,media_type"
      )
      .or(
        `id.eq.${item.id},parent_id.eq.${item.id}`
      );

  if(error){
    throw error;
  }

  return data||[];
}

async function removeContent(
  item
){

  const isSeries=
    item.kind==="series";

  const message=
    isSeries
      ?
      `Delete "${item.title}"?\n\nThis permanently deletes the show, its episodes, and associated uploaded media.`
      :
      `Delete "${item.title}"?\n\nThis permanently deletes its database record and associated uploaded media.`;

  if(!window.confirm(message)){
    return;
  }

  try{

    /*
      Read URLs before deleting DB.
    */

    const records=
      await getRecordsForDeletion(
        item
      );

    /*
      Database first.

      parent_id uses
      ON DELETE CASCADE,
      therefore deleting a series
      automatically deletes its
      episode rows.
    */

    const {error}=
      await db
        .from("content")
        .delete()
        .eq("id",item.id);

    if(error){
      throw error;
    }

    /*
      Then remove uploaded media.

      External URLs are ignored.
    */

    try{

      await deleteMediaFiles(
        records
      );

    }catch(mediaError){

      console.warn(
        "Record deleted but media cleanup failed:",
        mediaError
      );

      alert(
        "Content was deleted, but some uploaded media could not be cleaned automatically."
      );
    }

    if(
      $("contentId").value===
      item.id
    ){

      $("contentId").value="";

      $("editorPanel")
        .classList
        .add("hidden");
    }

    await loadAll();

  }catch(error){

    console.error(
      "Delete failed:",
      error
    );

    alert(
      "Delete failed: "+
      error.message
    );
  }
}

$("deleteContent")
  .addEventListener(
    "click",
    ()=>{

      const id=
        $("contentId").value;

      const item=
        content.find(
          contentItem=>
            contentItem.id===id
        );

      if(item){
        removeContent(item);
      }
    }
  );

/* ============================================================
   WEBSITE SETTINGS
============================================================ */

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
    settings.hero_text||
    "";
}

$("websiteForm")
  .addEventListener(
    "submit",
    async event=>{

      event.preventDefault();

      const siteName=
        $("siteName")
          .value
          .trim();

      if(!siteName){

        alert(
          "Website name is required."
        );

        return;
      }

      const {error}=
        await db
          .from("site_settings")
          .upsert({

            id:1,

            site_name:
              siteName,

            hero_kicker:
              $("siteHeroKicker")
                .value
                .trim(),

            hero_title:
              $("siteHeroTitle")
                .value
                .trim(),

            hero_text:
              $("siteHeroText")
                .value
                .trim(),

            updated_at:
              new Date()
                .toISOString()
          });

      if(error){

        alert(
          error.message
        );

        return;
      }

      await loadAll();

      alert(
        "Website updated."
      );
    }
  );

/* ============================================================
   SECTIONS
============================================================ */

function renderSections(){

  $("sectionList")
    .replaceChildren();

  if(!sections.length){

    $("sectionList").innerHTML=
      '<div class="empty">No sections.</div>';

    return;
  }

  sections.forEach(section=>{

    const row=
      document.createElement(
        "div"
      );

    row.className=
      "section-row";

    const name=
      document.createElement(
        "input"
      );

    name.value=
      section.name;

    name.placeholder=
      "Section name";

    const order=
      document.createElement(
        "input"
      );

    order.type=
      "number";

    order.value=
      section.sort_order||0;

    const actions=
      document.createElement(
        "div"
      );

    actions.className=
      "actions";

    const save=
      document.createElement(
        "button"
      );

    save.className=
      "ghost";

    save.textContent=
      "Save";

    save.addEventListener(
      "click",
      async ()=>{

        const newName=
          name.value.trim();

        if(!newName){

          alert(
            "Section name cannot be empty."
          );

          return;
        }

        const {error}=
          await db
            .from("sections")
            .update({

              name:newName,

              sort_order:
                Number(
                  order.value
                )||0

            })
            .eq(
              "id",
              section.id
            );

        if(error){

          alert(
            error.message
          );

          return;
        }

        await loadAll();
      }
    );

    const remove=
      document.createElement(
        "button"
      );

    remove.className=
      "danger";

    remove.textContent=
      "Delete";

    remove.addEventListener(
      "click",
      async ()=>{

        const used=
          content.some(
            item=>
              item.section_slug===
              section.slug
          );

        if(used){

          alert(
            "Move or delete the content inside this section first."
          );

          return;
        }

        if(
          !window.confirm(
            `Delete section "${section.name}"?`
          )
        ){
          return;
        }

        const {error}=
          await db
            .from("sections")
            .delete()
            .eq(
              "id",
              section.id
            );

        if(error){

          alert(
            error.message
          );

          return;
        }

        await loadAll();
      }
    );

    actions.append(
      save,
      remove
    );

    row.append(
      name,
      order,
      actions
    );

    $("sectionList")
      .append(row);
  });
}

$("addSection")
  .addEventListener(
    "click",
    async ()=>{

      const value=
        window.prompt(
          "Section name:"
        );

      const name=
        value?.trim();

      if(!name){
        return;
      }

      const slug=
        name
          .toLowerCase()
          .normalize("NFKD")
          .replace(
            /[^a-z0-9]+/g,
            "-"
          )
          .replace(
            /^-+|-+$/g,
            ""
          );

      if(!slug){

        alert(
          "Invalid section name."
        );

        return;
      }

      const {error}=
        await db
          .from("sections")
          .insert({

            slug,

            name,

            icon:"＋",

            sort_order:
              sections.length+1,

            published:true
          });

      if(error){

        alert(
          error.message
        );

        return;
      }

      await loadAll();
    }
  );

/* ============================================================
   REALTIME
============================================================ */

let refreshTimer=null;

function scheduleRefresh(){

  clearTimeout(
    refreshTimer
  );

  refreshTimer=
    setTimeout(
      ()=>loadAll(),
      200
    );
}

const realtime=
  db.channel(
    "cricfreex-admin-live"
  )
    .on(
      "postgres_changes",
      {
        event:"*",
        schema:"public",
        table:"content"
      },
      scheduleRefresh
    )
    .on(
      "postgres_changes",
      {
        event:"*",
        schema:"public",
        table:"sections"
      },
      scheduleRefresh
    )
    .on(
      "postgres_changes",
      {
        event:"*",
        schema:"public",
        table:"site_settings"
      },
      scheduleRefresh
    )
    .subscribe();

/* ============================================================
   AUTH STATE
============================================================ */

db.auth.onAuthStateChange(
  async (
    event,
    session
  )=>{

    if(
      event==="SIGNED_OUT"
    ){

      sessionUser=null;

      showLogin();
    }
  }
);

/* ============================================================
   START
============================================================ */

bootstrap();