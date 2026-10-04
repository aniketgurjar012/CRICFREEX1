"use strict";
const C=window.CRICFREEX_CONFIG;
const db=window.supabase.createClient(C.SUPABASE_URL,C.SUPABASE_ANON_KEY);
const $=id=>document.getElementById(id);
let settings=null,sections=[],content=[],section="sports",filter="all",activeSeries=null,selected="";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
async function load(){
const [a,b,c]=await Promise.all([
db.from("site_settings").select("*").eq("id",1).maybeSingle(),
db.from("sections").select("*").eq("published",true).order("sort_order"),
db.from("content").select("*").eq("published",true).order("sort_order")
]);
if(a.data)settings=a.data;
sections=b.data||[];
content=c.data||[];
if(!sections.some(x=>x.slug===section)&&sections.length)section=sections[0].slug;
renderAll();
}
function brand(name){
if(/^cricfreex$/i.test(name||""))return `CRIC<span class="brand-red">FREEX</span>`;
return esc(name||"CricFreeX");
}
function renderAll(){
const name=settings?.site_name||"CricFreeX";
$("brandWord").innerHTML=brand(name);
$("footerLogo").innerHTML=brand(name);
$("heroKicker").textContent=settings?.hero_kicker||"CRICFREEX LIVE";
const parts=(settings?.hero_title||"YOUR GAME.|YOUR SCREEN.").split("|");
$("heroTitle").innerHTML=`${esc(parts[0])}${parts[1]?`<span>${esc(parts[1])}</span>`:""}`;
$("heroText").textContent=settings?.hero_text||"Sports, shows and entertainment organised in one fast, responsive interface.";
renderTabs();renderFilters();render();
}
function renderTabs(){
$("mainTabs").replaceChildren();
sections.forEach(s=>{
const b=document.createElement("button");
b.className="main-tab"+(section===s.slug?" active":"");
b.textContent=`${s.icon||""} ${s.name}`.trim();
b.onclick=()=>{section=s.slug;filter="all";activeSeries=null;selected="";$("search").value="";renderTabs();renderFilters();render()};
$("mainTabs").append(b);
});
}
function sectionObj(){return sections.find(x=>x.slug===section)}
function renderFilters(){
$("filters").replaceChildren();
if(activeSeries){$("filters").style.display="none";return}
$("filters").style.display="flex";
const cats=["all",...new Set(content.filter(x=>x.section_slug===section&&!x.parent_id).map(x=>x.category).filter(Boolean))];
cats.forEach(cat=>{
const b=document.createElement("button");
b.className="filter"+(filter===cat?" active":"");
b.textContent=cat==="all"?"All":cat;
b.onclick=()=>{filter=cat;renderFilters();render()};
$("filters").append(b);
});
}
function card(x,label,meta){
const b=document.createElement("button");
b.className="channel-card"+(selected===x.id?" selected":"");
if(x.image_url){const img=document.createElement("img");img.className="channel-thumb";img.src=x.image_url;img.alt="";b.append(img)}
const top=document.createElement("div");top.className="channel-top";
const live=document.createElement("div");live.className="channel-live";live.innerHTML="<i></i>";live.append(document.createTextNode(label));
const cat=document.createElement("div");cat.className="channel-category";cat.textContent=x.category||x.kind;
top.append(live,cat);
const n=document.createElement("div");n.className="channel-name";n.textContent=x.title;
const id=document.createElement("div");id.className="channel-id";id.textContent=meta||x.public_id||"";
b.append(top,n,id);
return b;
}
function render(){
const q=$("search").value.trim().toLowerCase();
$("channelGrid").replaceChildren();
if(activeSeries){
$("seriesBack").classList.add("show");
$("kicker").textContent="EPISODES";
$("sectionTitle").textContent=activeSeries.title;
const list=content.filter(x=>x.parent_id===activeSeries.id&&x.kind==="episode"&&(!q||x.title.toLowerCase().includes(q)||(x.public_id||"").toLowerCase().includes(q)));
$("channelCount").textContent=`${list.length} episode${list.length===1?"":"s"}`;
if(!list.length)return empty("No episodes found.");
list.forEach(x=>{const b=card(x,"WATCH",`EPISODE ${x.episode_number||""}`);b.onclick=()=>play(x);$("channelGrid").append(b)});
return;
}
$("seriesBack").classList.remove("show");
const s=sectionObj();
$("kicker").textContent=(s?.name||"EXPLORE").toUpperCase();
$("sectionTitle").textContent=s?.name||"Content";
const list=content.filter(x=>x.section_slug===section&&!x.parent_id&&(filter==="all"||x.category===filter)&&(!q||x.title.toLowerCase().includes(q)||(x.public_id||"").toLowerCase().includes(q)));
$("channelCount").textContent=`${list.length} item${list.length===1?"":"s"}`;
if(!list.length)return empty("No content found.");
list.forEach(x=>{const series=x.kind==="series";const episodes=series?content.filter(e=>e.parent_id===x.id).length:0;const b=card(x,series?"SERIES":"LIVE",series?`${episodes} EPISODES`:x.public_id);b.onclick=()=>series?openSeries(x):play(x);$("channelGrid").append(b)});
}
function empty(text){const d=document.createElement("div");d.className="empty";d.textContent=text;$("channelGrid").append(d)}
function openSeries(x){activeSeries=x;filter="all";$("search").value="";renderFilters();render();$("channels").scrollIntoView({behavior:"smooth"})}
function mediaURL(value){
if(!value)return null;
try{const u=new URL(value,location.href);return["https:","http:"].includes(u.protocol)?u.href:null}catch{return null}
}
function play(x){
selected=x.id;$("playingTitle").textContent=x.title;$("playingCategory").textContent=(x.category||x.kind||"CRICFREEX").toUpperCase();$("playingStatus").textContent="LOADING";render();
const url=mediaURL(x.media_url);
$("playerWrap").replaceChildren();
if(!url){$("playingStatus").textContent="UNAVAILABLE";$("playerWrap").innerHTML='<div class="player-empty"><div><strong>Source not configured</strong>No media source is configured.</div></div>';return}
if(x.media_type==="video"){
const v=document.createElement("video");v.className="stream-video";v.controls=true;v.playsInline=true;v.autoplay=true;v.preload="metadata";v.controlsList="nodownload";v.src=url;v.onloadeddata=()=>$("playingStatus").textContent="NOW PLAYING";$("playerWrap").append(v);
}else{
const f=document.createElement("iframe");f.className="stream-frame";f.allow="autoplay; encrypted-media; fullscreen; picture-in-picture";f.allowFullscreen=true;f.referrerPolicy="strict-origin-when-cross-origin";f.src=url;f.onload=()=>$("playingStatus").textContent="NOW PLAYING";$("playerWrap").append(f);
}
$("watch").scrollIntoView({behavior:"smooth",block:"start"});
}
$("seriesBack").onclick=()=>{activeSeries=null;$("search").value="";renderFilters();render()};
$("search").oninput=render;
$("brand").onclick=()=>scrollTo({top:0,behavior:"smooth"});
$("exploreButton").onclick=()=>$("channels").scrollIntoView({behavior:"smooth"});
$("watchButton").onclick=()=>$("watch").scrollIntoView({behavior:"smooth"});
$("adminEntry").onclick=()=>location.href="./admin.html";
db.channel("cricfreex-public").on("postgres_changes",{event:"*",schema:"public",table:"site_settings"},load).on("postgres_changes",{event:"*",schema:"public",table:"sections"},load).on("postgres_changes",{event:"*",schema:"public",table:"content"},load).subscribe();
load();