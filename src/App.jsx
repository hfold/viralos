import { useState, useEffect } from "react";

const TABS = [
    { id:"competitors", label:"Competitor", icon:"🕵️" },
    { id:"trend", label:"Trend", icon:"📡" },
    { id:"hook", label:"Hook", icon:"🎣" },
    { id:"strategy", label:"Strategia", icon:"🎬" },
    { id:"viral", label:"Virale", icon:"🔥" },
];
const NICHES = ["Nutrizione","Fitness","Benessere mentale","Cucina sana","Dimagrimento","Sport & Performance"];
const PLATFORMS = ["TikTok","Instagram Reels","YouTube Shorts","LinkedIn"];
const TAB_COLORS = { trend:"#00ff9d", hook:"#ff6b35", strategy:"#a78bfa", viral:"#f59e0b", competitors:"#38bdf8" };
const glow = (c="#00ff9d") => ({ boxShadow:`0 0 20px ${c}22,0 0 40px ${c}11`, border:`1px solid ${c}44` });

// ─── LLM API (Netlify Function) ───────────────────────────────────────────────────

async function callLLM({provider="gemini", prompt, system, useSearch=false, model}) {
  const body = {
    provider,
    prompt,
    system,
    useSearch: !!useSearch,
    model
  };
  try {
    const r = await fetch("/.netlify/functions/llm",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(body)
    });
    const data = await r.json();
    return { text: data.text || "", raw: data.raw || data, error: data.error || null };
  } catch (e) {
    return { text:"", raw:null, error:{message:e.message||"Network error"} };
  }
}

const ACTIVE_PROVIDER = "gemini";

async function callClaude(prompt, system, useSearch=false) {
  return callLLM({ provider: ACTIVE_PROVIDER, prompt, system, useSearch });
}


// ─── JSON EXTRACTION ──────────────────────────────────────────────
function extractVideos(rawText) {
  if(!rawText) return { videos:[], debugInfo:"Testo vuoto" };
  let debugInfo = "";

  // Strategy 1: find JSON block
  try {
    const s = rawText.indexOf('{"videos"');
    const s2 = rawText.indexOf('{ "videos"');
    const start = s!==-1 ? s : s2!==-1 ? s2 : -1;
    if(start!==-1){
      const end = rawText.lastIndexOf("}");
      const chunk = rawText.slice(start, end+1);
      const parsed = JSON.parse(chunk);
      if(Array.isArray(parsed.videos)){
        debugInfo = `✅ JSON trovato (strategia 1) · ${parsed.videos.length} video`;
        return { videos: parsed.videos.filter(v=>v.title), debugInfo };
      }
    }
  } catch(e){ debugInfo += `S1 fail: ${e.message}\n`; }

  // Strategy 2: extract from markdown code block
  try {
    const match = rawText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if(match){
      const parsed = JSON.parse(match[1]);
      if(Array.isArray(parsed.videos)){
        debugInfo += `✅ JSON in code block · ${parsed.videos.length} video`;
        return { videos: parsed.videos.filter(v=>v.title), debugInfo };
      }
    }
  } catch(e){ debugInfo += `S2 fail: ${e.message}\n`; }

  // Strategy 3: scrape urls + titles from plain text
  try {
    const urlRegex = /https?:\/\/(www\.)?(tiktok\.com|instagram\.com)\/[^\s\)\]"']+/g;
    const urls = rawText.match(urlRegex) || [];
    if(urls.length > 0){
      const videos = urls.map((url,i) => {
        // try to find nearby title text
        const idx = rawText.indexOf(url);
        const before = rawText.slice(Math.max(0,idx-200), idx);
        const titleMatch = before.match(/["*-]\s*(.{10,80})\s*$/);
        return {
          title: titleMatch ? titleMatch[1].trim() : `Video ${i+1}`,
          url,
          score: 6,
          tags:[],
          analysis:"Estratto da testo libero — analisi non disponibile"
        };
      });
      debugInfo += `⚠️ URL estratti da testo (strategia 3) · ${videos.length} trovati`;
      return { videos, debugInfo };
    }
  } catch(e){ debugInfo += `S3 fail: ${e.message}\n`; }

  debugInfo += `❌ Nessun video estratto\n--- TESTO RAW (primi 500 char) ---\n${rawText.slice(0,500)}`;
  return { videos:[], debugInfo };
}

function extractJsonBlock(rawText) {
  if(!rawText) return { json:null, error:"Testo vuoto" };
  try {
    const match = rawText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if(match) return { json: JSON.parse(match[1]), error:null };
  } catch (e) {}
  try {
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if(start !== -1 && end !== -1 && end > start) {
      const chunk = rawText.slice(start, end+1);
      return { json: JSON.parse(chunk), error:null };
    }
  } catch (e) {}
  return { json:null, error:"JSON non valido" };
}

function formatProfileAnalysis(data) {
  if(!data || typeof data !== "object") return "";
  const ideas = Array.isArray(data.stealIdeas) ? data.stealIdeas : [];
  const keywords = Array.isArray(data.keywords) ? data.keywords : [];
  const blocks = [
    data.overview ? `OVERVIEW PROFILO\n${data.overview}` : "",
    data.strategy ? `STRATEGIA CONTENUTI\n${data.strategy}` : "",
    data.patterns ? `PATTERN VINCENTI\n${data.patterns}` : "",
    data.positioning ? `POSIZIONAMENTO\n${data.positioning}` : "",
    ideas.length ? `IDEE RUBABILI\n${ideas.map(i=>`- ${i}`).join("\n")}` : "",
    data.weaknesses ? `PUNTI DEBOLI\n${data.weaknesses}` : "",
    keywords.length ? `KEYWORDS\n${keywords.map(k=>`- ${k}`).join("\n")}` : ""
  ];
  return blocks.filter(Boolean).join("\n\n");
}

async function tavilySearch({query, maxResults=6, searchDepth="basic", includeDomains, excludeDomains, timeRange}) {
  try {
    const r = await fetch("/.netlify/functions/search",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        query,
        max_results: maxResults,
        search_depth: searchDepth,
        include_domains: includeDomains,
        exclude_domains: excludeDomains,
        time_range: timeRange
      })
    });
    const data = await r.json();
    if(!r.ok) return { results: [], raw: data, error: data.error || data };
    return { results: data.results || [], raw: data, error: null };
  } catch (e) {
    return { results: [], raw: null, error: { message: e.message || "Network error" } };
  }
}

function buildSourcesFromResults(results) {
  return (results || []).map((r,i)=>{
    const title = r.title || `Risultato ${i+1}`;
    const url = r.url || "";
    const snippet = (r.content || r.snippet || "").slice(0,400);
    return `[${i+1}] ${title}\n${url}\n${snippet}`;
  }).join("\n\n");
}

async function callSearchLLM({query, prompt, system, maxResults=6, searchDepth="basic", includeDomains}) {
  const search = await tavilySearch({query, maxResults, searchDepth, includeDomains});
  if(search.error){
    return { text: "", raw: search.raw, error: search.error };
  }
  const sources = buildSourcesFromResults(search.results || []);
  const fullPrompt = `${prompt}

FONTI (usa solo queste, non inventare URL):
${sources || "Nessun risultato."}`;
  return callLLM({ provider: ACTIVE_PROVIDER, prompt: fullPrompt, system });
}


// ─── STORAGE ──────────────────────────────────────────────────────
async function loadCompetitors() {
  try { const r=await window.storage.get("viralosc2"); return r?JSON.parse(r.value):[]; } catch { return []; }
}
async function saveCompetitors(list) {
  try { await window.storage.set("viralosc2",JSON.stringify(list)); } catch {}
}

// ─── SHARED UI ────────────────────────────────────────────────────
const Spinner = ({color="#00ff9d",label="Analisi in corso…"}) => (
  <div style={{display:"flex",alignItems:"center",gap:10,color,fontSize:13,marginTop:14}}>
    <div style={{width:14,height:14,border:`2px solid ${color}44`,borderTop:`2px solid ${color}`,borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
    {label}
  </div>
);

const ResultBox = ({text,color="#00ff9d"}) => !text?null:(
  <div style={{marginTop:18,padding:"16px",background:"linear-gradient(135deg,#0a1628,#0d1f3c)",...glow(color),borderRadius:12,whiteSpace:"pre-wrap",lineHeight:1.7,fontSize:13,color:"#c8d8f0",fontFamily:"'Courier New',monospace",maxHeight:380,overflowY:"auto"}}>
    {text}
  </div>
);

function DebugPanel({info, rawText}) {
  const [open,setOpen]=useState(false);
  if(!info&&!rawText) return null;
  return (
    <div style={{marginTop:12,borderRadius:8,overflow:"hidden",border:"1px solid #1e3a5f"}}>
      <button onClick={()=>setOpen(!open)} style={{width:"100%",padding:"8px 12px",background:"#070f1e",border:"none",color:"#4a6a8a",fontSize:11,cursor:"pointer",textAlign:"left",fontFamily:"monospace",display:"flex",justifyContent:"space-between"}}>
        <span>🐛 Debug panel</span><span>{open?"▲":"▼"}</span>
      </button>
      {open&&(
        <div style={{background:"#020508",padding:12,maxHeight:300,overflowY:"auto"}}>
          {info&&<div style={{fontSize:11,color:"#f59e0b",fontFamily:"monospace",marginBottom:8,whiteSpace:"pre-wrap"}}>{info}</div>}
          {rawText&&(
            <div>
              <div style={{fontSize:10,color:"#4a6a8a",marginBottom:4,fontFamily:"monospace"}}>— Risposta grezza API —</div>
              <div style={{fontSize:11,color:"#7a9bc0",fontFamily:"monospace",whiteSpace:"pre-wrap",wordBreak:"break-all"}}>{rawText.slice(0,1500)}{rawText.length>1500?"…":""}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Sel({value,onChange,options,label}) {
  return (
    <div style={{marginBottom:14}}>
      <label style={{display:"block",marginBottom:5,fontSize:10,color:"#7a9bc0",letterSpacing:2,textTransform:"uppercase"}}>{label}</label>
      <select value={value} onChange={e=>onChange(e.target.value)} style={{width:"100%",padding:"10px 12px",background:"#070f1e",border:"1px solid #1e3a5f",borderRadius:8,color:"#c8d8f0",fontSize:14,outline:"none",fontFamily:"inherit"}}>
        {options.map(o=><option key={o}>{o}</option>)}
      </select>
    </div>
  );
}
function Textarea({value,onChange,placeholder,rows=3}) {
  return <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows} style={{width:"100%",padding:"11px 13px",background:"#070f1e",border:"1px solid #1e3a5f",borderRadius:8,color:"#c8d8f0",fontSize:14,outline:"none",resize:"vertical",fontFamily:"inherit",lineHeight:1.6,boxSizing:"border-box",marginBottom:14}}/>;
}
function Btn({onClick,loading,children,color="#00ff9d",small=false}) {
  return (
    <button onClick={onClick} disabled={loading} style={{width:small?"auto":"100%",padding:small?"8px 14px":"13px 20px",background:loading?"#0a1628":`linear-gradient(135deg,${color}22,${color}11)`,border:`1px solid ${loading?"#1e3a5f":color}`,color:loading?"#4a6a8a":color,borderRadius:8,fontSize:small?12:14,fontWeight:600,cursor:loading?"not-allowed":"pointer",letterSpacing:.5,transition:"all .2s",fontFamily:"inherit"}}>
      {children}
    </button>
  );
}

// ─── TREND ────────────────────────────────────────────────────────
function TrendScanner() {
  const [niche,setNiche]=useState("Nutrizione");
  const [loading,setLoading]=useState(false); const [result,setResult]=useState("");
  const runAI = async () => {
    setLoading(true); setResult("");
    const sys = [
      "Genera trend PROBABILI:",
      "1. TOP 5 TREND",
      "2. 3 ANGOLI VIRALI",
      "3. TARGET PSICOLOGICO",
      "Specifica che sono stime AI. Rispondi in italiano."
    ].join("\n");
    const {text} = await callClaude(`Nicchia: ${niche}`, sys);
    setResult(text); setLoading(false);
  };
  return (
    <div>
      <Sel value={niche} onChange={setNiche} options={NICHES} label="Nicchia"/>
      <div style={{background:"#2a1a0a",border:"1px solid #f59e0b44",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#f59e0b",fontFamily:"monospace"}}>Attenzione: trend probabili AI, non dati real-time.</div>
      <Btn onClick={runAI} loading={loading} color="#00ff9d">{loading?"Generazione?":"Genera Trend AI"}</Btn>
      {loading&&<Spinner/>}
      <ResultBox text={result} color="#00ff9d"/>
    </div>
  );
}


// ─── HOOK ─────────────────────────────────────────────────────────
function HookGenerator() {
  const [topic,setTopic]=useState(""); const [platform,setPlatform]=useState("TikTok");
  const [hookType,setHookType]=useState("Curiosità"); const [loading,setLoading]=useState(false); const [result,setResult]=useState("");
  const run = async () => {
    if(!topic) return; setLoading(true); setResult("");
    const {text} = await callClaude(`Argomento: ${topic}\nPiattaforma: ${platform}\nTipo: ${hookType}`,`Sei un esperto di copywriting virale. Genera:\n1. 🎣 10 HOOK che fermano lo scroll\n2. 🗣️ SCRIPT APERTURA per i 3 migliori (15 sec)\n3. 🎭 VARIANTI TONO\n4. 📱 TESTO SOVRIMPRESSO\nRispondi in italiano.`);
    setResult(text); setLoading(false);
  };
  return (
    <div>
      <div style={{marginBottom:14}}><label style={{display:"block",marginBottom:5,fontSize:10,color:"#7a9bc0",letterSpacing:2,textTransform:"uppercase"}}>Argomento del video *</label><Textarea value={topic} onChange={setTopic} placeholder="es. 'perché stai fallendo con la dieta'..." rows={2}/></div>
      <Sel value={platform} onChange={setPlatform} options={PLATFORMS} label="Piattaforma"/>
      <Sel value={hookType} onChange={setHookType} options={["Curiosità","Paura/Problema","Risultato shock","Contro-intuitivo","Storia personale","Sfida"]} label="Tipo di hook"/>
      <Btn onClick={run} loading={loading} color="#ff6b35">{loading?"Generazione…":"🎣 Genera Hook"}</Btn>
      {loading&&<Spinner color="#ff6b35"/>}
      <ResultBox text={result} color="#ff6b35"/>
    </div>
  );
}

// ─── STRATEGY ─────────────────────────────────────────────────────
function VideoStrategy() {
  const [goal,setGoal]=useState(""); const [audience,setAudience]=useState("");
  const [platform,setPlatform]=useState("Instagram Reels"); const [loading,setLoading]=useState(false); const [result,setResult]=useState("");
  const run = async () => {
    if(!goal) return; setLoading(true); setResult("");
    const {text} = await callClaude(`Obiettivo: ${goal}\nTarget: ${audience||"n/a"}\nPiattaforma: ${platform}`,`Sei uno stratega di content marketing. Crea:\n1. 🎬 STRUTTURA VIDEO secondo per secondo\n2. 📋 PIANO EDITORIALE 30 GIORNI\n3. 🔁 FRAMEWORK RIPETIBILE\n4. 📈 KPI E METRICHE\n5. 🤝 CTA STRATEGY\nRispondi in italiano.`);
    setResult(text); setLoading(false);
  };
  return (
    <div>
      <div style={{marginBottom:14}}><label style={{display:"block",marginBottom:5,fontSize:10,color:"#7a9bc0",letterSpacing:2,textTransform:"uppercase"}}>Obiettivo principale *</label><Textarea value={goal} onChange={setGoal} placeholder="es. acquisire clienti per consulenze..." rows={2}/></div>
      <div style={{marginBottom:14}}><label style={{display:"block",marginBottom:5,fontSize:10,color:"#7a9bc0",letterSpacing:2,textTransform:"uppercase"}}>Target audience</label><Textarea value={audience} onChange={setAudience} placeholder="es. donne 30-45 anni..." rows={2}/></div>
      <Sel value={platform} onChange={setPlatform} options={PLATFORMS} label="Piattaforma principale"/>
      <Btn onClick={run} loading={loading} color="#a78bfa">{loading?"Costruzione…":"🎬 Crea Strategia"}</Btn>
      {loading&&<Spinner color="#a78bfa"/>}
      <ResultBox text={result} color="#a78bfa"/>
    </div>
  );
}

// ─── VIRAL ────────────────────────────────────────────────────────
function ViralFormula() {
  const [videoIdea,setVideoIdea]=useState(""); const [loading,setLoading]=useState(false); const [result,setResult]=useState("");
  const run = async () => {
    if(!videoIdea) return; setLoading(true); setResult("");
    const {text} = await callClaude(`Idea: ${videoIdea}`,`Sei un esperto di psicologia virale. Analizza:\n1. 🧠 SCORE VIRALE /10\n2. ⚗️ INGREDIENTI MANCANTI\n3. 🔄 RIFORMULAZIONE OTTIMIZZATA\n4. 💬 5 VARIANTI TITOLO A/B\n5. 🎭 STRUTTURA EMOTIVA\n6. 📣 AMPLIFICATORI\nRispondi in italiano.`);
    setResult(text); setLoading(false);
  };
  return (
    <div>
      <div style={{marginBottom:14}}><label style={{display:"block",marginBottom:5,fontSize:10,color:"#7a9bc0",letterSpacing:2,textTransform:"uppercase"}}>Descrivi la tua idea video *</label><Textarea value={videoIdea} onChange={setVideoIdea} placeholder="es. '5 alimenti che pensavi sani ma che fanno ingrassare'..." rows={4}/></div>
      <Btn onClick={run} loading={loading} color="#f59e0b">{loading?"Analisi…":"🔥 Analizza Potenziale Virale"}</Btn>
      {loading&&<Spinner color="#f59e0b"/>}
      <ResultBox text={result} color="#f59e0b"/>
    </div>
  );
}

// ─── COMPETITORS ──────────────────────────────────────────────────
function ScoreBadge({score}) {
  const n=Number(score)||0;
  const c=n>=8?"#00ff9d":n>=6?"#f59e0b":"#ff6b35";
  return <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:36,height:36,borderRadius:"50%",background:`${c}18`,border:`2px solid ${c}`,color:c,fontWeight:700,fontSize:13,fontFamily:"monospace",flexShrink:0}}>{n}</div>;
}

function VideoCard({video,onDelete}) {
  const [open,setOpen]=useState(false);
  return (
    <div style={{background:"#04080f",border:"1px solid #1e3a5f",borderRadius:8,padding:12,marginBottom:8}}>
      <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
        <ScoreBadge score={video.score}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{color:"#e8f4ff",fontSize:13,fontWeight:600,marginBottom:4,lineHeight:1.4}}>{video.title}</div>
          {video.tags?.length>0&&(
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>
              {video.tags.slice(0,3).map((t,i)=><span key={i} style={{fontSize:10,color:"#38bdf8",background:"#38bdf818",padding:"2px 6px",borderRadius:4,fontFamily:"monospace"}}>{t}</span>)}
            </div>
          )}
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            {video.url&&video.url.startsWith("http")&&(
              <a href={video.url} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:"#38bdf8",textDecoration:"none",fontFamily:"monospace"}}>🔗 Apri video</a>
            )}
            {video.analysis&&<button onClick={()=>setOpen(!open)} style={{background:"none",border:"none",color:"#4a6a8a",fontSize:11,cursor:"pointer",fontFamily:"monospace",padding:0}}>{open?"▲ meno":"▼ analisi"}</button>}
            <button onClick={()=>onDelete(video.url||video.title)} style={{background:"none",border:"none",color:"#2a4a6a",fontSize:14,cursor:"pointer",marginLeft:"auto"}}>✕</button>
          </div>
          {open&&video.analysis&&<div style={{marginTop:8,padding:"8px 10px",background:"#070f1e",borderRadius:6,fontSize:12,color:"#7a9bc0",lineHeight:1.6,fontFamily:"monospace"}}>{video.analysis}</div>}
        </div>
      </div>
    </div>
  );
}

// Search strategies
function buildSearchQueries(handle, platform, keywords="") {
  const h = handle.replace("@", "");
  const k = keywords ? ` ${keywords}` : "";
  if(platform==="TikTok") return [
    { label:"profilo + video", q:`site:tiktok.com/@${h} video tiktok${k}` },
    { label:"profilo diretto", q:`site:tiktok.com/@${h} tiktok${k}` },
    { label:"@handle", q:`"@${h}" tiktok video${k}` },
  ];
  return [
    { label:"profilo diretto", q:`site:instagram.com/${h}/ instagram${k}` },
    { label:"post del profilo", q:`site:instagram.com/${h}/p/ instagram${k}` },
    { label:"reel", q:`"${h}" instagram reel${k}` },
    { label:"post", q:`"${h}" instagram post${k}` },
  ];
}

function buildSimilarQueries(platform, keywords="") {
  const k = keywords ? ` ${keywords}` : "";
  if(platform==="TikTok") return [
    { label:"web", q:`tiktok creator${k}`, useSite:false },
    { label:"web 2", q:`tiktok profili${k}`, useSite:false },
  ];
  return [
    { label:"site", q:`site:instagram.com instagram reel creator${k}`, useSite:true },
    { label:"web", q:`instagram reel creator${k}`, useSite:false },
  ];
}

function extractHandleFromUrl(url, platform) {
  if(!url) return "";
  try {
    const u = new URL(url);
    if(platform==="TikTok") {
      const m = u.pathname.match(/\/@([^/]+)/);
      return m ? `@${m[1]}` : "";
    }
    if(platform==="Instagram") {
      const parts = u.pathname.split("/").filter(Boolean);
      return parts.length ? `@${parts[0]}` : "";
    }
  } catch {}
  return "";
}

function filterVideosByHandle(videos, handle, platform) {
  const h = (handle||"").replace(/^@/, "").toLowerCase();
  if(!h) return videos;
  return videos.filter(v => {
    const url = (v.url||"").toLowerCase();
    if(platform==="TikTok") return url.includes(`/@${h}/`);
    if(platform==="Instagram") {
      if(url.includes(`instagram.com/${h}`)) return true;
      if(url.includes("instagram.com/reel/")) return true;
      if(url.includes("instagram.com/p/")) return true;
      return false;
    }
    return true;
  });
}

async function validateProfileUrls(videos, platform) {
  if(platform!=="TikTok") return videos;
  const urls = videos.map(v=>v.url).filter(Boolean);
  if(urls.length===0) return videos;
  try {
    const r = await fetch("/.netlify/functions/validate",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ platform, urls })
    });
    const data = await r.json();
    if(r.ok && Array.isArray(data.validUrls)) {
      const set = new Set(data.validUrls);
      return videos.filter(v=>set.has(v.url));
    }
  } catch (e) {}
  return videos;
}


const SCAN_SYSTEM = `Sei un analista di contenuti social. Il tuo compito e trovare video/reel pubblicati dal profilo indicato.

Usa solo le FONTI fornite. Analizza i risultati e per ogni video/reel trovato con URL specifico estrai le informazioni.

IMPORTANTISSIMO: rispondi SOLO con questo JSON esatto, zero testo prima o dopo:
{"videos":[{"title":"titolo o caption del video","url":"https://url-diretto","score":7,"tags":["#hashtag1","#hashtag2"],"analysis":"1-2 frasi sul potenziale virale"}],"searchNote":"cosa hai trovato o non trovato"}

Regole:
- Includi SOLO URL che appartengono al profilo indicato
- Per TikTok accetta solo URL con /@handle/
- Per Instagram accetta URL dei contenuti anche se non contengono l'handle (es. /reel/ o /p/)
- score da 1-10 basato su hook del titolo, emozione, tema trending
- se non trovi video con URL specifici restituisci {"videos":[],"searchNote":"motivo"}
- NON inventare URL, usa solo quelli reali dalle FONTI
- includi solo video con URL che inizia con https://tiktok.com o https://instagram.com`;

const PROFILE_SYSTEM = `Sei un analista di contenuti social. In base ai video e alle fonti profilo, ricostruisci il profilo del creator.

Rispondi SOLO con questo JSON esatto, zero testo prima o dopo:
{"overview":"chi e cosa fa il creator","strategy":"formati e strategia contenuti","patterns":"pattern ricorrenti e format vincenti","positioning":"posizionamento percepito e target","stealIdeas":["idea 1","idea 2","idea 3"],"weaknesses":"punti deboli o gap evidenti","keywords":["parole chiave 1","parole chiave 2","parole chiave 3"]}

Regole:
- Usa solo le informazioni deducibili dai video e dalle FONTI PROFILO
- Se mancano dati, indica in modo esplicito cosa non e chiaro
- keywords: 6-12 parole chiave brevi, senza @, senza hashtag, 1-3 parole ciascuna`;


function CompetitorRow({comp,onDelete,onScan,onProfile,onDiscover,scanning,analyzing,discovering}) {
  const icon=comp.platform==="Instagram"?"📸":"🎵";
  return (
    <div style={{background:"#070f1e",border:"1px solid #1e3a5f",borderRadius:10,padding:14,marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:20}}>{icon}</span>
          <div>
            <div style={{color:"#e8f4ff",fontWeight:600,fontSize:14}}>{comp.handle}</div>
            <div style={{color:"#4a6a8a",fontSize:11,fontFamily:"monospace"}}>{comp.platform}</div>
            {comp.searchKeywords?.trim() && <div style={{color:"#2a4a6a",fontSize:10,fontFamily:"monospace"}}>Keywords: {comp.searchKeywords}</div>}
          </div>
        </div>
        <button onClick={()=>onDelete(comp.id)} style={{background:"none",border:"none",color:"#2a4a6a",cursor:"pointer",fontSize:18,padding:"2px 8px"}}>✕</button>
      </div>
      {comp.lastScan&&<div style={{fontSize:10,color:"#4a6a8a",fontFamily:"monospace",marginBottom:10}}>{comp.videos?.length||0} video · scansione {new Date(comp.lastScan).toLocaleDateString("it-IT")}</div>}
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <Btn onClick={()=>onScan(comp)} loading={scanning===comp.id} color="#38bdf8" small>
          {scanning===comp.id?"🔍 Ricerca…":"🔍 Scansiona"}
        </Btn>
        {/* Solo Scansiona */}
      </div>
    </div>
  );
}

function Competitors() {
  const [competitors,setCompetitors]=useState([]);
  const [handle,setHandle]=useState(""); const [platform,setPlatform]=useState("TikTok");
  const [searchKeywords,setSearchKeywords]=useState("");
  const [scanning,setScanning]=useState(null); const [analyzing,setAnalyzing]=useState(null); const [discovering,setDiscovering]=useState(null); const [batchLoading,setBatchLoading]=useState(false);
  const [similarResult,setSimilarResult]=useState(""); const [similarComp,setSimilarComp]=useState(null);
  const [similarDebugInfo,setSimilarDebugInfo]=useState(""); const [similarRaw,setSimilarRaw]=useState("");
  const [similarItems,setSimilarItems]=useState([]);
  const [selectedComp,setSelectedComp]=useState(null);
  const [scanTab,setScanTab]=useState("video");
  const [profileTab,setProfileTab]=useState("overview");
  const [profileResult,setProfileResult]=useState(""); const [profileTitle,setProfileTitle]=useState("");
  const [storageReady,setStorageReady]=useState(false);
  const [scanLog,setScanLog]=useState([]); // debug log
  const [rawResponse,setRawResponse]=useState("");
  const [manualLinks,setManualLinks]=useState(""); const [showManual,setShowManual]=useState(false);

  useEffect(()=>{ loadCompetitors().then(list=>{setCompetitors(list);setStorageReady(true);}); },[]);

  const persist = async (list) => { setCompetitors(list); await saveCompetitors(list); };

  const addCompetitor = async () => {
    if(!handle.trim()) return;
    const clean=handle.replace(/^@/,"").replace(/https?:\/\/(www\.)?(instagram|tiktok)\.com\//,"").replace(/\?.*/,"").replace(/\//g,"");
    await persist([...competitors,{id:Date.now().toString(),handle:"@"+clean,platform,searchKeywords:searchKeywords.trim(),addedAt:Date.now(),lastScan:null,videos:[]}]);
    setHandle("");
    setSearchKeywords("");
  };

  const deleteCompetitor = async (id) => {
    await persist(competitors.filter(c=>c.id!==id));
    if(selectedComp?.id===id){setSelectedComp(null);setProfileResult("");setScanLog([]);setRawResponse("");}
  };

  const deleteVideo = async (compId,key) => {
    const updated=competitors.map(c=>c.id===compId?{...c,videos:c.videos.filter(v=>(v.url||v.title)!==key)}:c);
    await persist(updated);
    setSelectedComp(prev=>prev?.id===compId?{...prev,videos:prev.videos.filter(v=>(v.url||v.title)!==key)}:prev);
  };

  // Multi-strategy scan
  const scanContent = async (comp) => {
    setScanning(comp.id); setSelectedComp({...comp,videos:[]}); setProfileResult("");
    setProfileTitle(""); setScanLog([]); setRawResponse(""); setShowManual(false);
    setScanTab("video");
    setProfileTab("overview");
    const queries = buildSearchQueries(comp.handle, comp.platform, comp.searchKeywords || "");
    let allVideos = [];
    const log = [];

    for(const {label,q} of queries){
      log.push(`🔍 Strategia: ${label}`);
      log.push(`   Query: "${q}"`);
      setScanLog([...log]);

      try {
        const {text, raw, error} = await callSearchLLM({
          query: q,
          prompt: `Cerca i contenuti di "${comp.handle}" su ${comp.platform}. Usa la query fornita e trova video/reel con URL specifici.`,
          system: SCAN_SYSTEM,
          maxResults: 8,
          includeDomains: comp.platform==="TikTok" ? ["tiktok.com"] : ["instagram.com"]
        });

        if(error){
          log.push(`   ❌ Errore API: ${error.message||JSON.stringify(error)}`);
          setScanLog([...log]);
          setRawResponse(JSON.stringify(raw,null,2));
          continue;
        }

        log.push(`   📥 Risposta ricevuta (${text.length} char)`);
        setRawResponse(text);
        setScanLog([...log]);

        let {videos, debugInfo} = extractVideos(text);
        if(videos.length===0 && raw && Array.isArray(raw.results)) {
          const fallback = raw.results
            .map(r=>({
              title: r.title || "Post",
              url: r.url || "",
              score: 6,
              tags: [],
              analysis: "Estratto dai risultati di ricerca"
            }))
            .filter(v=>{
              const url = (v.url||"").toLowerCase();
              if(comp.platform==="Instagram") return url.includes("instagram.com/p/") || url.includes("instagram.com/reel/") || url.includes("instagram.com/tv/");
              if(comp.platform==="TikTok") return url.includes("tiktok.com/@") && url.includes("/video/");
              return false;
            });
          if(fallback.length>0){
            videos = fallback;
            debugInfo += ` | Fallback: ${fallback.length} URL da Tavily`;
          }
        }
        const filtered = filterVideosByHandle(videos, comp.handle, comp.platform);
        log.push(`   Verifica URL...`);
        setScanLog([...log]);
        const validated = await validateProfileUrls(filtered, comp.platform);
        log.push(`   ${debugInfo}`);
        if(filtered.length<videos.length){
          log.push(`   ATTENZIONE: Filtrati ${videos.length-filtered.length} risultati non del profilo`);
        }
        if(validated.length<filtered.length){
          log.push(`   ATTENZIONE: Scartati ${filtered.length-validated.length} URL non validi`);
        }
        setScanLog([...log]);

        if(validated.length>0){
          // deduplicate
          const existingUrls = new Set(allVideos.map(v=>v.url));
          const newVids = validated.filter(v=>!existingUrls.has(v.url));
          allVideos=[...allVideos,...newVids];
          log.push(`   ✅ Totale video unici: ${allVideos.length}`);
          setScanLog([...log]);
          if(allVideos.length>=8) break; // enough
        }
      } catch(e){
        log.push(`   ❌ Eccezione: ${e.message}`);
        setScanLog([...log]);
      }
    }

    // Fallback per Instagram: riprova senza filtro dominio se zero risultati
    if(allVideos.length===0 && comp.platform==="Instagram") {
      log.push(`\n🔁 Fallback Instagram: riprovo senza filtro dominio`);
      setScanLog([...log]);
      const fallbackQueries = buildSearchQueries(comp.handle, comp.platform, comp.searchKeywords || "");
      for(const {label,q} of fallbackQueries){
        log.push(`   Query fallback: "${q}"`);
        setScanLog([...log]);
        try {
          const {text, raw, error} = await callSearchLLM({
            query: q,
            prompt: `Cerca i contenuti di "${comp.handle}" su Instagram. Trova reel o post con URL specifici.`,
            system: SCAN_SYSTEM,
            maxResults: 8
          });
          if(error){
            log.push(`   ❌ Errore API: ${error.message||JSON.stringify(error)}`);
            setScanLog([...log]);
            setRawResponse(JSON.stringify(raw,null,2));
            continue;
          }
          log.push(`   📥 Risposta ricevuta (${text.length} char)`);
          setRawResponse(text);
          const {videos, debugInfo} = extractVideos(text);
          const filtered = filterVideosByHandle(videos, comp.handle, comp.platform);
          const validated = await validateProfileUrls(filtered, comp.platform);
          log.push(`   ${debugInfo}`);
          if(validated.length>0){
            const existingUrls = new Set(allVideos.map(v=>v.url));
            const newVids = validated.filter(v=>!existingUrls.has(v.url));
            allVideos=[...allVideos,...newVids];
            log.push(`   ✅ Totale video unici: ${allVideos.length}`);
            setScanLog([...log]);
            break;
          }
        } catch(e){
          log.push(`   ❌ Eccezione: ${e.message}`);
          setScanLog([...log]);
        }
      }
    }

    log.push(allVideos.length>0 ? `\n✅ FATTO — ${allVideos.length} video trovati` : `\n⚠️ Nessun video trovato — prova la modalità manuale`);
    setScanLog([...log]);

    let analysisText = "";
    let analysisKeywords = [];
    let profileData = null;
    if(allVideos.length>0){
      const analysis = await runProfileAnalysisFromVideos(comp, allVideos);
      analysisText = analysis.analysisText || "";
      analysisKeywords = Array.isArray(analysis.keywords) ? analysis.keywords : [];
      profileData = analysis.data || null;
      if(analysisText){
        setProfileTitle(`📊 ${comp.handle} — Analisi da video`);
        setProfileResult(analysisText);
      }
    }

    const updated=competitors.map(c=>c.id===comp.id?{...c,lastScan:Date.now(),videos:allVideos,profileAnalysis:analysisText,analysisKeywords,profileData}:c);
    await persist(updated);
    setSelectedComp({...comp,videos:allVideos,profileAnalysis:analysisText,analysisKeywords,profileData});
    setScanning(null);

    if(allVideos.length>0){
      await runSimilarSearch({...comp,analysisKeywords}, analysisKeywords);
    }
  };

  // Manual link scoring
  const scoreManualLinks = async (comp) => {
    if(!manualLinks.trim()) return;
    setScanning(comp.id);
    setScanLog(["Analisi manuale - analisi link incollati..."]);

    const lines = manualLinks.split("\n").filter(l=>l.trim().length>5).slice(0,15);
    const kw = comp.searchKeywords ? `Parole chiave: ${comp.searchKeywords}` : "Parole chiave: (nessuna)";
    const {text} = await callClaude(
      `Analizza questi link/testi di video ${comp.platform} del profilo "${comp.handle}". ${kw}\n${lines.join("\n")}`,
      `Sei un analista di contenuti. Per ogni link o caption fornita assegna un voto virale e analisi.\nRispondi SOLO con JSON:\n{"videos":[{"title":"titolo o prima parte caption","url":"url se presente altrimenti stringa vuota","score":7,"tags":[],"analysis":"perche questo score"}]}`
    );
    const {videos, debugInfo} = extractVideos(text);
    setScanLog([`Analisi manuale: ${debugInfo}`]);
    setRawResponse(text);

    const existing=competitors.find(c=>c.id===comp.id)?.videos||[];
    const merged=[...existing,...videos.filter(v=>!existing.find(e=>e.title===v.title))];
    const updated=competitors.map(c=>c.id===comp.id?{...c,lastScan:Date.now(),videos:merged}:c);
    await persist(updated);
    setSelectedComp({...comp,videos:merged});
    setManualLinks(""); setScanning(null);
  };

  const runProfileAnalysisFromVideos = async (comp, videos) => {
    if(!videos || videos.length===0) return { analysisText:"", keywords:[], data:null };
    const lines = videos.map(v=>{
      const tags = Array.isArray(v.tags) ? v.tags.join(" ") : "";
      return `- ${v.title || "Video"} | ${v.url || ""} | score ${v.score || ""} | ${tags} | ${v.analysis || ""}`;
    }).join("\n");
    const kw = comp.searchKeywords ? `Parole chiave: ${comp.searchKeywords}` : "Parole chiave: (nessuna)";

    const accountQuery = comp.platform==="TikTok"
      ? `site:tiktok.com/@${comp.handle.replace(/^@/,"")}`
      : `site:instagram.com/${comp.handle.replace(/^@/,"")}/`;
    const accountSearch = await tavilySearch({
      query: accountQuery,
      maxResults: 6,
      searchDepth: "basic",
      includeDomains: comp.platform==="TikTok" ? ["tiktok.com"] : ["instagram.com"]
    });
    const profileSources = buildSourcesFromResults(accountSearch.results || []);

    const prompt = `Profilo: ${comp.handle}\nPiattaforma: ${comp.platform}\n${kw}\n\nVIDEO TROVATI:\n${lines}\n\nFONTI PROFILO (ricerca account, senza parole chiave):\n${profileSources || "Nessuna fonte profilo."}`;
    const {text} = await callLLM({ provider: ACTIVE_PROVIDER, prompt, system: PROFILE_SYSTEM });
    const { json } = extractJsonBlock(text);
    if(json) {
      return {
        analysisText: formatProfileAnalysis(json),
        keywords: Array.isArray(json.keywords) ? json.keywords : [],
        data: json
      };
    }
    return { analysisText: text, keywords: [], data:null };
  };

  const runSimilarSearch = async (comp, overrideKeywords=[]) => {
    setDiscovering(comp.id); setSimilarResult(""); setSimilarComp(comp);
    setSimilarDebugInfo(""); setSimilarRaw("");

    const list = Array.isArray(overrideKeywords) ? overrideKeywords : [];
    const keywordsText = list.length ? list.join(" ") : (comp.analysisKeywords?.length ? comp.analysisKeywords.join(" ") : (comp.searchKeywords || ""));
    const keywords = keywordsText.trim().split(/\s+/).slice(0,12).join(" ");
    const queries = buildSimilarQueries(comp.platform, keywords);
    const log = [];
    const rawPayloads = [];
    let allResults = [];

    for (const { label, q } of queries) {
      log.push(`Strategia: ${label}`);
      log.push(`Query: "${q}"`);
      setSimilarDebugInfo(log.join("\n"));

      const { results, raw, error } = await tavilySearch({
        query: q,
        maxResults: 8,
        searchDepth: "basic",
        includeDomains: comp.platform === "TikTok" ? ["tiktok.com"] : ["instagram.com"]
      });

      rawPayloads.push({ label, query: q, error: error || null, raw });

      if (error) {
        const msg = error.message || (typeof error === "string" ? error : JSON.stringify(error));
        log.push(`Errore API: ${msg}`);
        setSimilarDebugInfo(log.join("\n"));
        continue;
      }

      const filtered = (results || []).filter(r => {
        const url = (r.url || "").toLowerCase();
        if (comp.platform === "TikTok") return url.includes("tiktok.com/@");
        return url.includes("instagram.com/");
      });

      const existing = new Set(allResults.map(r => r.url));
      const deduped = filtered.filter(r => r.url && !existing.has(r.url));
      allResults = [...allResults, ...deduped];

      log.push(`Risultati validi: ${filtered.length} | Totale unici: ${allResults.length}`);
      setSimilarDebugInfo(log.join("\n"));
    }

    const handles = Array.from(new Set(allResults.map(r=>extractHandleFromUrl(r.url, comp.platform)).filter(Boolean))).slice(0, 8);
    const profileSourcesByHandle = {};
    for(const h of handles){
      const q = comp.platform==="TikTok"
        ? `site:tiktok.com/@${h.replace(/^@/,"")}`
        : `site:instagram.com/${h.replace(/^@/,"")}/`;
      const search = await tavilySearch({
        query: q,
        maxResults: 5,
        searchDepth: "basic",
        includeDomains: comp.platform==="TikTok" ? ["tiktok.com"] : ["instagram.com"]
      });
      profileSourcesByHandle[h] = search.results || [];
    }

    const profileSources = handles.map((h,i)=>`[${i+1}] ${h}\n${buildSourcesFromResults(profileSourcesByHandle[h] || [])}`).join("\n\n");
    const baseContext = `Profilo di partenza: ${comp.handle}\nPiattaforma: ${comp.platform}\nParole chiave: ${keywords || "(nessuna)"}`;

    const evalPrompt = `${baseContext}\n\nValuta se questi profili sono competitor rilevanti in base ai contenuti. Usa SOLO le FONTI.\n\nFONTI PROFILI:\n${profileSources || "Nessuna fonte profilo."}`;
    const evalSystem = `Rispondi SOLO con JSON:\n{"competitors":[{"handle":"@handle","profileUrl":"https://...","summary":"1-2 frasi sul profilo","relevance":"alta|media|bassa","reason":"perche e rilevante"}]}\nRegole: includi solo competitor con relevance alta o media. Se non ci sono, usa lista vuota.`;
    const evalResp = await callLLM({ provider: ACTIVE_PROVIDER, prompt: evalPrompt, system: evalSystem });
    const evalJson = extractJsonBlock(evalResp.text || "").json;

    if(evalJson && Array.isArray(evalJson.competitors)) {
      const comps = evalJson.competitors.filter(c=>c.handle).map(c=>({
        title: c.handle,
        url: c.profileUrl || "",
        desc: [c.summary, c.reason].filter(Boolean).join(" · ")
      }));
      setSimilarItems(comps);
    } else {
      const fallbackItems = handles.map(h=>{
        const results = profileSourcesByHandle[h] || [];
        const url = results[0]?.url || "";
        const desc = (results[0]?.content || results[0]?.snippet || "").slice(0, 220);
        return { title: h, url, desc };
      });
      setSimilarItems(fallbackItems);
    }

    setSimilarRaw(JSON.stringify({ keywords, queries, results: allResults, raw: rawPayloads, handles, profiles: profileSourcesByHandle }, null, 2));

    if (allResults.length === 0) {
      setSimilarResult("Nessuna fonte verificabile trovata per i simili. Prova ad aggiungere parole chiave o cambiare piattaforma.");
      setDiscovering(null);
      return;
    }

    const sources = buildSourcesFromResults(allResults);
    const keywordsLine = keywords ? `Parole chiave richieste: ${keywords}` : "Parole chiave richieste: (nessuna)";

    const prompt = `Trova creator simili su ${comp.platform} basandoti sui contenuti e sulle parole chiave. ${keywordsLine}.
Non usare il nome dell'account di partenza. Usa solo le fonti fornite e includi solo profili reali con URL verificabili.`;

    const system = `Sei un esperto di social media scouting. Analizza i contenuti e cerca creator simili sulla stessa piattaforma.

Produci una lista di creator simili con:
1. PERCHE E SIMILE - stile, nicchia, approccio
2. DIMENSIONE - follower stimati
3. DIFFERENZA CHIAVE - cosa fa di diverso rispetto al profilo di partenza
4. PERCHE MONITORARLO - cosa puoi imparare

Formato risposta:
---
**@handle** ? [piattaforma]
Follower: ~Xk
Simile perche: ...
Si differenzia per: ...
Monitoralo perche: ...
Profilo: https://...
---

Regole: usa SOLO le fonti. Se un profilo non ha URL verificabile nelle fonti, non inserirlo. Rispondi in italiano.`;

    const fullPrompt = `${prompt}

FONTI (usa solo queste, non inventare URL):
${sources}`;
    const { text, error } = await callLLM({ provider: ACTIVE_PROVIDER, prompt: fullPrompt, system });

    if (error || !text || !text.trim()) {
      setSimilarResult("");
    } else {
      setSimilarResult(text);
    }
    setDiscovering(null);
  };

  const discoverSimilar = async (comp) => {
    await runSimilarSearch(comp);
  };

  const analyzeProfile = async (comp) => {
    setAnalyzing(comp.id); setProfileResult(""); setProfileTitle(`📊 ${comp.handle}`);
    if(comp.profileAnalysis){
      setProfileResult(comp.profileAnalysis);
      setAnalyzing(null);
      return;
    }
    if(comp.videos?.length>0){
      const analysis = await runProfileAnalysisFromVideos(comp, comp.videos);
      const analysisText = analysis.analysisText || "";
      const analysisKeywords = Array.isArray(analysis.keywords) ? analysis.keywords : [];
      const profileData = analysis.data || null;
      if(analysisText){
        const updated=competitors.map(c=>c.id===comp.id?{...c,profileAnalysis:analysisText,analysisKeywords,profileData}:c);
        await persist(updated);
        setProfileResult(analysisText);
      }
      setAnalyzing(null);
      return;
    }
    setProfileResult("Prima esegui Scansiona per trovare i video e creare l'analisi profilo.");
    setAnalyzing(null);
  };

  const analyzeAll = async () => {
    if(competitors.length<2) return;
    setBatchLoading(true); setProfileResult(""); setProfileTitle("📊 Analisi Comparativa");
    const handles=competitors.map(c=>`${c.handle} (${c.platform}${c.searchKeywords?`, ${c.searchKeywords}`:""})`).join("\n");
    const {text}=await callClaude(`Confronta:\n${handles}`,`Confronta e analizza:\n1. 🏆 RANKING\n2. 📊 PUNTI FORZA/DEBOLEZZA\n3. 🎯 GAP DI MERCATO\n4. 🔥 PATTERN VINCENTI\n5. 💡 STRATEGIA DIFFERENZIANTE\n6. ⚡ 3 AZIONI IMMEDIATE\nRispondi in italiano.`);
    setProfileResult(text); setBatchLoading(false);
  };

  return (
    <div>
      {/* Add form */}
      <div style={{background:"#070f1e",border:"1px solid #1e3a5f",borderRadius:10,padding:14,marginBottom:18}}>
        <div style={{fontSize:10,color:"#38bdf8",letterSpacing:2,textTransform:"uppercase",marginBottom:12,fontFamily:"monospace"}}>+ Aggiungi Competitor</div>
        <div style={{marginBottom:10}}>
          <label style={{display:"block",marginBottom:5,fontSize:10,color:"#7a9bc0",letterSpacing:2,textTransform:"uppercase"}}>Handle o URL profilo</label>
          <input value={handle} onChange={e=>setHandle(e.target.value)} placeholder="@beardedscara o URL" onKeyDown={e=>e.key==="Enter"&&addCompetitor()} style={{width:"100%",padding:"10px 12px",background:"#04080f",border:"1px solid #1e3a5f",borderRadius:8,color:"#c8d8f0",fontSize:14,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
        </div>
        <div style={{marginBottom:10}}>
          <label style={{display:"block",marginBottom:5,fontSize:10,color:"#7a9bc0",letterSpacing:2,textTransform:"uppercase"}}>Parole chiave (opzionale)</label>
          <input value={searchKeywords} onChange={e=>setSearchKeywords(e.target.value)} placeholder="es. beard tips viaggio germany" style={{width:"100%",padding:"10px 12px",background:"#04080f",border:"1px solid #1e3a5f",borderRadius:8,color:"#c8d8f0",fontSize:14,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          <div style={{flex:1}}>
            <label style={{display:"block",marginBottom:5,fontSize:10,color:"#7a9bc0",letterSpacing:2,textTransform:"uppercase"}}>Piattaforma</label>
            <select value={platform} onChange={e=>setPlatform(e.target.value)} style={{width:"100%",padding:"9px 10px",background:"#04080f",border:"1px solid #1e3a5f",borderRadius:8,color:"#c8d8f0",fontSize:13,outline:"none",fontFamily:"inherit"}}>
              <option>TikTok</option><option>Instagram</option>
            </select>
          </div>
        </div>
        <Btn onClick={addCompetitor} loading={false} color="#38bdf8">➕ Aggiungi alla lista</Btn>
      </div>

      {storageReady&&(
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:14,fontSize:11,color:"#4a6a8a",fontFamily:"monospace"}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:"#38bdf8",boxShadow:"0 0 6px #38bdf8"}}/>
          {competitors.length} competitor salvati
        </div>
      )}

      {competitors.length===0?(
        <div style={{textAlign:"center",color:"#2a4a6a",padding:"28px 0",fontFamily:"monospace",fontSize:13,lineHeight:1.8}}>
          Nessun competitor ancora.<br/>Aggiungine uno sopra per iniziare.
        </div>
      ):(
        <>
          {competitors.map(c=>(
            <CompetitorRow key={c.id} comp={c} onDelete={deleteCompetitor} onScan={scanContent} onProfile={analyzeProfile} onDiscover={discoverSimilar} scanning={scanning} analyzing={analyzing} discovering={discovering}/>
          ))}
          {competitors.length>=2&&(
            <div style={{marginTop:4}}>
              <Btn onClick={analyzeAll} loading={batchLoading} color="#a78bfa">
                {batchLoading?"📊 Analisi comparativa…":`📊 Confronta tutti i ${competitors.length} competitor`}
              </Btn>
            </div>
          )}
        </>
      )}

      {/* Results */}
      {selectedComp&&(
        <div style={{marginTop:22}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div style={{fontSize:13,color:"#38bdf8",fontFamily:"monospace",fontWeight:600}}>🎬 {selectedComp.handle}</div>
            <div style={{fontSize:10,color:"#4a6a8a",fontFamily:"monospace"}}>🟢≥8 🟡≥6 🔴&lt;6</div>
          </div>
          {selectedComp.searchKeywords?.trim() && (
            <div style={{fontSize:10,color:"#2a4a6a",fontFamily:"monospace",marginBottom:10}}>
              + parole chiave: {selectedComp.searchKeywords}
            </div>
          )}

          {!scanning&&(
            <div style={{display:"flex",gap:6,marginBottom:12,overflowX:"auto"}}>
              {["video","profilo","competitor"].map(tab=>(
                <button key={tab} onClick={()=>setScanTab(tab)} style={{flexShrink:0,padding:"8px 12px",borderRadius:8,border:scanTab===tab?`1px solid #38bdf866`:"1px solid #0e2040",background:scanTab===tab?"#0b1b33":"#060d1a",color:scanTab===tab?"#38bdf8":"#4a6a8a",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"monospace",textTransform:"uppercase"}}>
                  {tab==="video"?"Video":tab==="profilo"?"Analisi Profilo":"Competitor"}
                </button>
              ))}
            </div>
          )}

          {scanning===selectedComp.id&&(
            <div>
              <Spinner color="#38bdf8" label="Ricerca in corso…"/>
              {scanLog.length>0&&(
                <div style={{marginTop:10,background:"#020508",border:"1px solid #1e3a5f",borderRadius:8,padding:10,maxHeight:160,overflowY:"auto"}}>
                  {scanLog.map((l,i)=>(
                    <div key={i} style={{fontSize:11,color:l.includes("✅")?"#00ff9d":l.includes("❌")?"#ff6b35":l.includes("⚠️")?"#f59e0b":"#4a6a8a",fontFamily:"monospace",lineHeight:1.6}}>{l}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!scanning&&scanTab==="video"&&selectedComp.videos?.length>0&&(
            selectedComp.videos.map((v,i)=><VideoCard key={i} video={v} onDelete={key=>deleteVideo(selectedComp.id,key)}/>)
          )}

          {!scanning&&scanTab==="video"&&selectedComp.videos?.length===0&&(
            <div style={{background:"#070f1e",border:"1px dashed #1e3a5f",borderRadius:8,padding:14,marginBottom:10}}>
              <div style={{color:"#4a6a8a",fontFamily:"monospace",fontSize:12,marginBottom:10}}>
                Nessun video trovato automaticamente. Puoi incollare link o caption manualmente:
              </div>
              <button onClick={()=>setShowManual(!showManual)} style={{background:"none",border:"1px solid #1e3a5f",color:"#7a9bc0",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:12,fontFamily:"monospace",marginBottom:10}}>
                {showManual?"▲ Nascondi":"📋 Incolla link / caption manualmente"}
              </button>
              {showManual&&(
                <>
                  <Textarea value={manualLinks} onChange={setManualLinks} placeholder={"Incolla link o caption dei video, uno per riga:\nhttps://tiktok.com/@.../video/123\noppure: 'Mangio solo proteine per 7 giorni - risultati shock'\n..."} rows={5}/>
                  <Btn onClick={()=>scoreManualLinks(selectedComp)} loading={scanning===selectedComp.id} color="#38bdf8">⭐ Analizza e dai voto</Btn>
                </>
              )}
            </div>
          )}

          {!scanning&&scanTab==="profilo"&&(
            selectedComp?.profileData ? (
              <div>
                <div style={{display:"flex",gap:6,marginBottom:12,overflowX:"auto"}}>
                  {[
                    {id:"overview",label:"Overview"},
                    {id:"strategy",label:"Strategia"},
                    {id:"patterns",label:"Pattern"},
                    {id:"positioning",label:"Posizionamento"},
                    {id:"ideas",label:"Idee"},
                    {id:"weaknesses",label:"Debolezze"},
                    {id:"keywords",label:"Keywords"}
                  ].map(tab=>(
                    <button key={tab.id} onClick={()=>setProfileTab(tab.id)} style={{flexShrink:0,padding:"7px 10px",borderRadius:7,border:profileTab===tab.id?`1px solid #a78bfa66`:"1px solid #0e2040",background:profileTab===tab.id?"#15122a":"#060d1a",color:profileTab===tab.id?"#a78bfa":"#4a6a8a",fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"monospace",textTransform:"uppercase"}}>
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div style={{background:"linear-gradient(135deg,#0a1628,#0d1f3c)",...glow("#a78bfa"),borderRadius:12,padding:14,fontSize:12,color:"#c8d8f0",lineHeight:1.7,whiteSpace:"pre-wrap"}}>
                  {profileTab==="overview" && (selectedComp.profileData.overview || "N/D")}
                  {profileTab==="strategy" && (selectedComp.profileData.strategy || "N/D")}
                  {profileTab==="patterns" && (selectedComp.profileData.patterns || "N/D")}
                  {profileTab==="positioning" && (selectedComp.profileData.positioning || "N/D")}
                  {profileTab==="ideas" && (Array.isArray(selectedComp.profileData.stealIdeas) ? selectedComp.profileData.stealIdeas.map(i=>`- ${i}`).join("\n") : "N/D")}
                  {profileTab==="weaknesses" && (selectedComp.profileData.weaknesses || "N/D")}
                  {profileTab==="keywords" && (Array.isArray(selectedComp.profileData.keywords) ? selectedComp.profileData.keywords.map(k=>`- ${k}`).join("\n") : "N/D")}
                </div>
              </div>
            ) : (
              profileResult ? (
                <ResultBox text={profileResult} color="#a78bfa"/>
              ) : (
                <div style={{color:"#2a4a6a",fontFamily:"monospace",fontSize:12}}>Nessuna analisi profilo disponibile. Esegui prima la scansione.</div>
              )
            )
          )}

          {!scanning&&scanTab==="competitor"&&(
            (similarItems.length>0) ? (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10}}>
                {similarItems.map((it,i)=>(
                  <div key={`${it.url}-${i}`} style={{background:"#070f1e",border:"1px solid #1e3a5f",borderRadius:10,padding:12}}>
                    <div style={{fontSize:12,color:"#f59e0b",fontFamily:"monospace",fontWeight:700,marginBottom:6}}>
                      {it.title}
                    </div>
                    {it.url && (
                      <a href={it.url} target="_blank" rel="noreferrer" style={{fontSize:11,color:"#7a9bc0",fontFamily:"monospace",textDecoration:"none",display:"block",marginBottom:6,wordBreak:"break-all"}}>
                        {it.url}
                      </a>
                    )}
                    {it.desc && (
                      <div style={{fontSize:11,color:"#4a6a8a",fontFamily:"monospace",lineHeight:1.5}}>
                        {it.desc}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{color:"#2a4a6a",fontFamily:"monospace",fontSize:12}}>Nessun competitor rilevante trovato. Esegui prima la scansione o amplia le parole chiave.</div>
            )
          )}

          {/* Debug panel always shown after scan */}
          {!scanning&&(scanLog.length>0||rawResponse)&&(
            <DebugPanel info={scanLog.join("\n")} rawText={rawResponse}/>
          )}
        </div>
      )}

      {(analyzing||batchLoading||discovering)&&<Spinner color="#a78bfa"/>}
      {!discovering&&(similarDebugInfo||similarRaw)&&(
        <DebugPanel info={similarDebugInfo} rawText={similarRaw}/>
      )}
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────
export default function App() {
  const [activeTab,setActiveTab]=useState("competitors");
  const activeColor=TAB_COLORS[activeTab];
  return (
    <div style={{minHeight:"100vh",background:"#04080f",fontFamily:"'Georgia','Times New Roman',serif",paddingBottom:60,backgroundImage:`radial-gradient(ellipse at 20% 50%,#00ff9d08,transparent 50%),radial-gradient(ellipse at 80% 20%,#a78bfa08,transparent 50%)`}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}@keyframes slideIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#070f1e}::-webkit-scrollbar-thumb{background:#1e3a5f;border-radius:2px}select option{background:#070f1e}textarea::placeholder,input::placeholder{color:#2a4a6a}`}</style>

      <div style={{padding:"22px 16px 18px",borderBottom:"1px solid #0e2040",background:"linear-gradient(180deg,#060d1a,transparent)"}}>
        <div style={{maxWidth:700,margin:"0 auto"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:"#00ff9d",animation:"pulse 2s ease-in-out infinite",boxShadow:"0 0 12px #00ff9d"}}/>
            <span style={{fontSize:10,color:"#00ff9d",letterSpacing:3,textTransform:"uppercase",fontFamily:"monospace"}}>Content Intelligence System</span>
          </div>
          <h1 style={{fontSize:26,fontWeight:700,color:"#e8f4ff",margin:0,fontFamily:"'Georgia',serif"}}>ViralOS</h1>
          <p style={{color:"#4a6a8a",fontSize:12,margin:"4px 0 0",fontFamily:"monospace"}}>Il tuo co-pilota AI per contenuti che esplodono</p>
        </div>
      </div>

      <div style={{maxWidth:700,margin:"0 auto",padding:"0 12px"}}>
        <div style={{display:"flex",gap:6,marginTop:16,marginBottom:18,overflowX:"auto",paddingBottom:4}}>
          {TABS.map(tab=>{
            const isActive=activeTab===tab.id; const color=TAB_COLORS[tab.id];
            return <button key={tab.id} onClick={()=>setActiveTab(tab.id)} style={{flexShrink:0,padding:"10px 14px",borderRadius:9,border:isActive?`1px solid ${color}66`:"1px solid #0e2040",background:isActive?`linear-gradient(135deg,${color}18,${color}08)`:"#060d1a",color:isActive?color:"#4a6a8a",fontSize:12,fontWeight:600,cursor:"pointer",transition:"all .2s",fontFamily:"monospace",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap"}}>
              <span style={{fontSize:16}}>{tab.icon}</span><span>{tab.label}</span>
            </button>;
          })}
        </div>
        <div style={{background:"linear-gradient(135deg,#070f1e,#0a1628)",...glow(activeColor),borderRadius:14,padding:"18px 14px",animation:"slideIn .25s ease-out"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:18}}>
            <span style={{fontSize:18}}>{TABS.find(t=>t.id===activeTab)?.icon}</span>
            <h2 style={{margin:0,fontSize:17,color:activeColor,fontFamily:"monospace",letterSpacing:.5}}>{TABS.find(t=>t.id===activeTab)?.label}</h2>
          </div>
          {activeTab==="trend"&&<TrendScanner/>}
          {activeTab==="hook"&&<HookGenerator/>}
          {activeTab==="strategy"&&<VideoStrategy/>}
          {activeTab==="viral"&&<ViralFormula/>}
          {activeTab==="competitors"&&<Competitors/>}
        </div>
        <p style={{textAlign:"center",color:"#1e3a5f",fontSize:10,marginTop:16,fontFamily:"monospace"}}>Powered by Claude AI · Dati salvati in modo persistente</p>
      </div>
    </div>
  );
}
