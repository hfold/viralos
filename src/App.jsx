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
    
    const contentType = r.headers.get("content-type") || "";
    if(contentType.includes("text/html")) {
      const htmlText = await r.text();
      return { 
        text: "", 
        raw: htmlText, 
        error: { message: `Il server (Netlify) ha restituito una pagina d'errore HTML invece dei dati dell'AI (HTTP Status: ${r.status}). Cause possibili: 1) Stai testando da localhost con 'npm run dev' invece di 'netlify dev' e le API backend non sono collegate. 2) C'è stato un crash/timeout interno di Google Gemini.` } 
      };
    }

    const data = await r.json();
    return { text: data.text || "", raw: data.raw || data, error: data.error || null };
  } catch (e) {
    return { text:"", raw:null, error:{message:e.message||"Network error"} };
  }
}

const ACTIVE_PROVIDER = "gemini";

async function callAI(prompt, system, useSearch=false) {
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
  try { const r=window.localStorage.getItem("viralosc2"); return r?JSON.parse(r):[]; } catch { return []; }
}
async function saveCompetitors(list) {
  try { window.localStorage.setItem("viralosc2",JSON.stringify(list)); } catch {}
}
async function loadSelectedAccounts() {
  try { const r=window.localStorage.getItem("viralos_selected"); return r?JSON.parse(r):[]; } catch { return []; }
}
async function saveSelectedAccounts(list) {
  try { window.localStorage.setItem("viralos_selected",JSON.stringify(list)); } catch {}
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

function CollapsibleSection({title, color="#38bdf8", children, defaultOpen=true, icon=""}) {
  const [open,setOpen]=useState(defaultOpen);
  return (
    <div style={{marginBottom:6,border:`1px solid ${color}22`,borderRadius:10,overflow:"hidden"}}>
      <div onClick={()=>setOpen(!open)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:`${color}0d`,cursor:"pointer",color,fontFamily:"monospace",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:.8,userSelect:"none"}}>
        <span style={{display:"flex",alignItems:"center",gap:6}}>{icon&&<span>{icon}</span>}{title}</span>
        <span style={{fontSize:10,opacity:.7,flexShrink:0,marginLeft:8}}>{open?"▲":"▼"}</span>
      </div>
      {open&&<div style={{padding:"12px 14px",background:"#04080f",fontSize:12,color:"#c8d8f0",lineHeight:1.75,whiteSpace:"pre-wrap"}}>{children}</div>}
    </div>
  );
}

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
    const {text} = await callAI(`Nicchia: ${niche}`, sys);
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
    const {text} = await callAI(`Argomento: ${topic}\nPiattaforma: ${platform}\nTipo: ${hookType}`,`Sei un esperto di copywriting virale. Genera:\n1. 🎣 10 HOOK che fermano lo scroll\n2. 🗣️ SCRIPT APERTURA per i 3 migliori (15 sec)\n3. 🎭 VARIANTI TONO\n4. 📱 TESTO SOVRIMPRESSO\nRispondi in italiano.`);
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
function VideoStrategy({selectedAccounts=[], onClearAccounts}) {
  const [goal,setGoal]=useState(""); const [audience,setAudience]=useState("");
  const [platform,setPlatform]=useState("Instagram Reels"); const [loading,setLoading]=useState(false); const [result,setResult]=useState("");
  const [rawText, setRawText] = useState(""); const [debugInfo, setDebugInfo] = useState("");
  
  const run = async () => {
    if(!goal) return; setLoading(true); setResult(""); setRawText(""); setDebugInfo("");
    setDebugInfo("Chiamata AI per Genera Strategia da form manuale...");
    const {text, raw, error} = await callAI(`Obiettivo: ${goal}\nTarget: ${audience||"n/a"}\nPiattaforma: ${platform}`,`Sei uno stratega di content marketing. Crea:\n1. 🎬 STRUTTURA VIDEO secondo per secondo\n2. 📋 PIANO EDITORIALE 30 GIORNI\n3. 🔁 FRAMEWORK RIPETIBILE\n4. 📈 KPI E METRICHE\n5. 🤝 CTA STRATEGY\nRispondi in italiano.`);
    if(error) setDebugInfo(prev => prev + `\n❌ ERRORE RESTITUITO: ${JSON.stringify(error)}`);
    else setDebugInfo(prev => prev + `\n✅ Risposta Ricevuta (${text.length} caratteri)`);
    setRawText(typeof raw === "string" ? raw : JSON.stringify(raw, null, 2) || "");
    setResult(text); setLoading(false);
  };
  const runFromCompetitors = async () => {
    if(!selectedAccounts.length) return; setLoading(true); setResult(""); setRawText(""); setDebugInfo("");
    const accountList = selectedAccounts.map(a=>{
      let out = `- ${a.handle} (${a.platform})${a.profileUrl?` → ${a.profileUrl}`:""}`;
      if(a.profileAnalysis) out += `\n  [ANALISI PROFILO]: ${a.profileAnalysis.replace(/\n+/g," ").slice(0, 1000)}`;
      if(a.videos && a.videos.length > 0) {
        const topVids = a.videos.filter(v=>v.title).sort((v1,v2)=>(v2.score||0)-(v1.score||0)).slice(0,6).map(v=>v.title).join(" | ");
        out += `\n  [VIDEO TOP ESTRATTI]: ${topVids}`;
      }
      return out;
    }).join("\n\n");
    const basePrompt = `Dati completi dei competitor selezionati:\n${accountList}`;
    const userGoal = goal ? `\n\nOBIETTIVO DEL CLIENTE: ${goal}` : "";
    const userAudience = audience ? `\nTARGET DEL CLIENTE: ${audience}` : "";
    const userPlatform = platform ? `\nPIATTAFORMA PRINCIPALE: ${platform}` : "";
    const finalPrompt = basePrompt + userGoal + userAudience + userPlatform;

    setDebugInfo(`Chiamata AI per Genera Strategia dai Competitor...\nLunghezza dati input: ${finalPrompt.length} caratteri.\nCompetitor inseriti: ${selectedAccounts.length}\n\n--- INIZIO PAYLOAD INVIATO ALL'AI ---\n${finalPrompt}\n--- FINE PAYLOAD ---`);
    const {text, raw, error} = await callAI(
      finalPrompt,
      `Sei uno stratega di content marketing. Leggi l'analisi profilo e i titoli dei video virali estratti da questi competitor e crea una strategia differenziante per superarli e per far raggiungere al cliente il suo OBIETTIVO specifico:\n1. 🔍 ANALISI COMUNE - pattern emersi dai dati forniti\n2. 🎯 GAP DI MERCATO - angoli o macro-temi ignorati\n3. 🎬 STRATEGIA DIFFERENZIANTE - come raggiungere l'obiettivo del cliente distinguendosi dai competitor\n4. 📋 PIANO EDITORIALE 30 GIORNI - format e titoli suggeriti\n5. 🔁 FRAMEWORK RIPETIBILE\n6. ⚡ 3 AZIONI IMMEDIATE\nRispondi in italiano in modo formattato e leggibile.`
    );
    if(error) setDebugInfo(prev => prev + `\n\n❌ ERRORE RESTITUITO DAL SERVER LLM: ${JSON.stringify(error)}`);
    else setDebugInfo(prev => prev + `\n\n✅ Risposta Ricevuta con successo (${text.length} caratteri elaborati)`);
    setRawText(typeof raw === "string" ? raw : JSON.stringify(raw, null, 2) || "");
    setResult(text); setLoading(false);
  };
  return (
    <div>
      {selectedAccounts.length>0&&(
        <div style={{marginBottom:18,border:"1px solid #a78bfa33",borderRadius:10,padding:12,background:"#0d0a1f"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div style={{fontSize:10,color:"#a78bfa",letterSpacing:2,textTransform:"uppercase",fontFamily:"monospace"}}>Account selezionati ({selectedAccounts.length})</div>
            {onClearAccounts&&<button onClick={onClearAccounts} style={{background:"none",border:"none",color:"#2a4a6a",cursor:"pointer",fontSize:11,fontFamily:"monospace"}}>✕ Svuota</button>}
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
            {selectedAccounts.map(a=>(
              <span key={a.handle} style={{fontSize:11,color:"#a78bfa",background:"#1a1035",border:"1px solid #a78bfa33",borderRadius:6,padding:"3px 8px",fontFamily:"monospace"}}>{a.handle}</span>
            ))}
          </div>
          <Btn onClick={runFromCompetitors} loading={loading} color="#a78bfa">
            {loading?"Analisi…":"🎬 Genera strategia dai competitor"}
          </Btn>
        </div>
      )}
      <div style={{marginBottom:14}}><label style={{display:"block",marginBottom:5,fontSize:10,color:"#7a9bc0",letterSpacing:2,textTransform:"uppercase"}}>Obiettivo principale *</label><Textarea value={goal} onChange={setGoal} placeholder="es. acquisire clienti per consulenze..." rows={2}/></div>
      <div style={{marginBottom:14}}><label style={{display:"block",marginBottom:5,fontSize:10,color:"#7a9bc0",letterSpacing:2,textTransform:"uppercase"}}>Target audience</label><Textarea value={audience} onChange={setAudience} placeholder="es. donne 30-45 anni..." rows={2}/></div>
      <Sel value={platform} onChange={setPlatform} options={PLATFORMS} label="Piattaforma principale"/>
      <Btn onClick={run} loading={loading} color="#a78bfa">{loading?"Costruzione…":"🎬 Crea Strategia"}</Btn>
      {loading&&<Spinner color="#a78bfa"/>}
      <ResultBox text={result} color="#a78bfa"/>
      <DebugPanel info={debugInfo} rawText={rawText} />
    </div>
  );
}

// ─── VIRAL ────────────────────────────────────────────────────────
function ViralFormula() {
  const [videoIdea,setVideoIdea]=useState(""); const [loading,setLoading]=useState(false); const [result,setResult]=useState("");
  const run = async () => {
    if(!videoIdea) return; setLoading(true); setResult("");
    const {text} = await callAI(`Idea: ${videoIdea}`,`Sei un esperto di psicologia virale. Analizza:\n1. 🧠 SCORE VIRALE /10\n2. ⚗️ INGREDIENTI MANCANTI\n3. 🔄 RIFORMULAZIONE OTTIMIZZATA\n4. 💬 5 VARIANTI TITOLO A/B\n5. 🎭 STRUTTURA EMOTIVA\n6. 📣 AMPLIFICATORI\nRispondi in italiano.`);
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
    { label:"@handle video", q:`"@${h}" tiktok video${k}` },
    { label:"@handle creator", q:`"${h}" tiktok creator${k}` },
    { label:"@handle post", q:`"${h}" tiktok${k}` },
  ];
  return [
    { label:"reel", q:`"${h}" instagram${k}` },
    { label:"post", q:`"${h}" instagram post${k}` },
    { label:"handle creator", q:`"${h}" instagram creator${k}` },
    { label:"handle profilo", q:`"${h}" instagram${k}` },
  ];
}

function buildSimilarQueries(platform, keywords="", videos=[]) {
  const plat = platform === "TikTok" ? "tiktok" : "instagram";

  // Pick 2 random videos with a title and use their titles as queries
  const titled = (videos || []).filter(v => v.title && v.title.length > 5);
  const picked = titled.sort(() => Math.random() - 0.5).slice(0, 2);

  if (picked.length > 0) {
    return picked.map((v, i) => ({
      label: `video ${i + 1}: "${v.title.slice(0, 60)}"`,
      q: `${v.title.slice(0, 80)} ${plat}`,
    }));
  }

  // Fallback to keywords if no videos available
  const k = keywords ? ` ${keywords}` : "";
  return [
    { label:"keywords 1", q:`${plat} creator${k}` },
    { label:"keywords 2", q:`${plat}${k}` },
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

function extractHandleFromText(text="") {
  const m = text.match(/@([a-zA-Z0-9._]+)/);
  return m ? `@${m[1]}` : "";
}

function buildProfileUrlFromHandle(handle, platform) {
  const h = (handle||"").replace(/^@/, "");
  if(!h) return "";
  if(platform==="TikTok") return `https://www.tiktok.com/@${h}`;
  if(platform==="Instagram") return `https://www.instagram.com/${h}/`;
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


function CompetitorRow({comp,onDelete,onScan,onView,onProfile,onDiscover,scanning,analyzing,discovering, isSelected, onToggleStrategy}) {
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
        {comp.lastScan && (
          <>
            <Btn onClick={()=>onView(comp)} color="#00ff9d" small>📖 Apri</Btn>
            <Btn onClick={()=>onToggleStrategy(comp)} color="#a78bfa" small>
              {isSelected ? "✅ In Strategia" : "➕ Aggiungi a Strategia"}
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}

function Competitors({selectedAccounts=[], onAddAccount, onRemoveAccount, onGoToStrategy}) {
  const [competitors,setCompetitors]=useState([]);
  const [handle,setHandle]=useState(""); const [platform,setPlatform]=useState("TikTok");
  const [searchKeywords,setSearchKeywords]=useState("");
  const [scanning,setScanning]=useState(null); const [analyzing,setAnalyzing]=useState(null); const [discovering,setDiscovering]=useState(null); const [batchLoading,setBatchLoading]=useState(false);
  const [similarResult,setSimilarResult]=useState(""); const [similarComp,setSimilarComp]=useState(null);
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
    const newComp = {id:Date.now().toString(),handle:"@"+clean,platform,searchKeywords:searchKeywords.trim(),addedAt:Date.now(),lastScan:null,videos:[]};
    const currentList = await loadCompetitors();
    await persist([...currentList, newComp]);
    setHandle("");
    setSearchKeywords("");
    scanContent(newComp);
  };

  const deleteCompetitor = async (id) => {
    const currentList = await loadCompetitors();
    await persist(currentList.filter(c=>c.id!==id));
    if(selectedComp?.id===id){setSelectedComp(null);setProfileResult("");setScanLog([]);setRawResponse("");}
  };

  const deleteVideo = async (compId,key) => {
    const currentList = await loadCompetitors();
    const updated=currentList.map(c=>c.id===compId?{...c,videos:c.videos.filter(v=>(v.url||v.title)!==key)}:c);
    await persist(updated);
    setSelectedComp(prev=>prev?.id===compId?{...prev,videos:prev.videos.filter(v=>(v.url||v.title)!==key)}:prev);
  };

  const handleScanSimilar = async (it) => {
    const currentList = await loadCompetitors();
    let targetComp = currentList.find(c => c.handle.toLowerCase() === it.handle.toLowerCase());
    if(!targetComp) {
      targetComp = {id:Date.now().toString(),handle:it.handle,platform:(selectedComp?.platform || "TikTok"),searchKeywords:"",addedAt:Date.now(),lastScan:null,videos:[]};
      await persist([...currentList, targetComp]);
    }
    scanContent(targetComp);
  };

  const handleView = (comp) => {
    setSelectedComp(comp);
    setScanTab("video");
    setProfileTab("overview");
    setProfileTitle(`📊 ${comp.handle}`);
    setProfileResult(comp.profileAnalysis || "");
    setScanLog([]);
    setRawResponse("");
    setSimilarItems(comp.similarItems || []);
    setSimilarResult(comp.similarResult || "");
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

    const currentList = await loadCompetitors();
    const updated=currentList.map(c=>c.id===comp.id?{...c,lastScan:Date.now(),videos:allVideos,profileAnalysis:analysisText,analysisKeywords,profileData}:c);
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

    const currentList = await loadCompetitors();
    const existing=currentList.find(c=>c.id===comp.id)?.videos||[];
    const merged=[...existing,...videos.filter(v=>!existing.find(e=>e.title===v.title))];
    const updated=currentList.map(c=>c.id===comp.id?{...c,lastScan:Date.now(),videos:merged}:c);
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

    const h0 = comp.handle.replace(/^@/,"");
    const accountQuery = comp.platform==="TikTok"
      ? `"@${h0}" tiktok creator`
      : `"${h0}" instagram profilo`;
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
    setDiscovering(comp.id); setSimilarResult(""); setSimilarComp(comp); setSimilarItems([]);

    const videoTitles = (comp.videos || []).filter(v=>v.title).map(v=>`- ${v.title}`).join("\n");
    const keywords = (overrideKeywords.length ? overrideKeywords.join(" ") : comp.analysisKeywords?.join(" ") || comp.searchKeywords || "").trim();
    const profileOverview = comp.profileData?.overview || "";

    // Step 1: LLM genera query brevi con termini professionali/di nicchia
    const qPrompt = `Profilo: ${comp.handle}\nPiattaforma: ${comp.platform}${keywords?`\nNicchia: ${keywords}`:""}${profileOverview?`\nOverview: ${profileOverview}`:""}${videoTitles?`\nVideo:\n${videoTitles}`:""}`;
    const qSystem = `Analizza questo creator e genera 4 query per trovare account simili. Ogni query deve essere il NOME DI UN TIPO DI PERSONA o PROFESSIONE, massimo 3 parole.

ESEMPI CORRETTI (nomi di figure professionali o creator):
- "nutrizionista mamme"
- "dietista sportivo"
- "coach alimentazione"
- "medico nutrizione"

ESEMPI SBAGLIATI (non usare mai):
- "ricette nutrizione consigli" ❌ (argomenti, non persone)
- "dieta sana instagram" ❌ (contiene piattaforma)
- "reels fitness" ❌ (contiene formato)

Le 4 query devono descrivere 4 tipi diversi di creator/professionisti simili al profilo analizzato.
NON includere l'handle del profilo di partenza.
NON includere il nome della piattaforma.
Rispondi SOLO con JSON: {"queries":["query1","query2","query3","query4"]}`;
    const { text: qText } = await callLLM({ provider: ACTIVE_PROVIDER, prompt: qPrompt, system: qSystem });
    const { json: qJson } = extractJsonBlock(qText || "");
    const searchQueries = (qJson?.queries || []).filter(Boolean).slice(0, 4);

    if (!searchQueries.length) {
      setSimilarResult("Impossibile generare query di ricerca.");
      setDiscovering(null);
      return;
    }

    // Step 2: Tavily cerca per ogni query — includi sempre "profilo" per preferire pagine account
    const plat = comp.platform === "TikTok" ? "tiktok" : "instagram";
    const rawResults = [];
    for (const q of searchQueries) {
      const { results } = await tavilySearch({
        query: `${q} ${plat} profilo`,
        maxResults: 6,
        searchDepth: "basic",
        includeDomains: comp.platform === "TikTok" ? ["tiktok.com"] : ["instagram.com"]
      });
      (results||[]).forEach(r => { if(r.url) rawResults.push({...r, _query: q}); });
    }

    // Step 3: estrai handle, deduplicA per account, costruisci URL profilo
    const accountMap = new Map();
    for (const r of rawResults) {
      const handle = extractHandleFromUrl(r.url, comp.platform);
      if (!handle) continue;
      const lh = handle.toLowerCase();
      if (lh === comp.handle.replace(/^@/,"").toLowerCase()) continue; // escludi il profilo di partenza
      if (!accountMap.has(lh)) {
        const profileUrl = buildProfileUrlFromHandle(handle, comp.platform);
        accountMap.set(lh, {
          handle,
          profileUrl,
          desc: (r.content || r.snippet || "").slice(0, 300),
          query: r._query || ""
        });
      }
    }

    const updatedSimilars = [...accountMap.values()];
    const simResultText = searchQueries.join(" · ");

    const currentList = await loadCompetitors();
    const updated = currentList.map(c => c.id === comp.id ? { ...c, similarItems: updatedSimilars, similarResult: simResultText } : c);
    await persist(updated);

    setSelectedComp(prev => prev?.id === comp.id ? { ...prev, similarItems: updatedSimilars, similarResult: simResultText } : prev);
    setSimilarItems(updatedSimilars);
    setSimilarResult(simResultText);
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
        const currentList = await loadCompetitors();
        const updated=currentList.map(c=>c.id===comp.id?{...c,profileAnalysis:analysisText,analysisKeywords,profileData}:c);
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
        <Btn onClick={addCompetitor} loading={false} color="#38bdf8">🔍 Scansiona</Btn>
      </div>

      {storageReady&&(
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:14,fontSize:11,color:"#4a6a8a",fontFamily:"monospace"}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:"#38bdf8",boxShadow:"0 0 6px #38bdf8"}}/>
          {competitors.length} competitor salvati
        </div>
      )}

      {selectedAccounts.length>0&&(
        <div style={{marginBottom:14,border:"1px solid #a78bfa44",borderRadius:10,padding:10,background:"#0d0a1f"}}>
          <div style={{fontSize:10,color:"#a78bfa",letterSpacing:2,textTransform:"uppercase",fontFamily:"monospace",marginBottom:8}}>Account selezionati ({selectedAccounts.length})</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
            {selectedAccounts.map(a=>(
              <span key={a.handle} style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:"#a78bfa",background:"#1a1035",border:"1px solid #a78bfa33",borderRadius:6,padding:"3px 8px",fontFamily:"monospace"}}>
                {a.handle}
                <button onClick={()=>onRemoveAccount(a.handle)} style={{background:"none",border:"none",color:"#4a3a6a",cursor:"pointer",fontSize:12,padding:0,lineHeight:1}}>✕</button>
              </span>
            ))}
          </div>
          <Btn onClick={onGoToStrategy} color="#a78bfa" small>🎬 Genera strategia dai competitor →</Btn>
        </div>
      )}

      {competitors.length===0?(
        <div style={{textAlign:"center",color:"#2a4a6a",padding:"28px 0",fontFamily:"monospace",fontSize:13,lineHeight:1.8}}>
          Nessun competitor ancora.<br/>Aggiungine uno sopra per iniziare.
        </div>
      ):(
        <>
          {competitors.map(c=>{
            const isSelected = selectedAccounts.some(a=>a.handle===c.handle);
            return <CompetitorRow key={c.id} comp={c} onDelete={deleteCompetitor} onScan={scanContent} onView={handleView} onProfile={analyzeProfile} onDiscover={discoverSimilar} scanning={scanning} analyzing={analyzing} discovering={discovering} isSelected={isSelected} onToggleStrategy={comp => isSelected ? onRemoveAccount(comp.handle) : onAddAccount({handle:comp.handle, platform:comp.platform, profileUrl: buildProfileUrlFromHandle(comp.handle, comp.platform), profileAnalysis: comp.profileAnalysis, videos: comp.videos})} />;
          })}
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
                {[
                  {id:"overview",   label:"Overview",        icon:"🧠", val: selectedComp.profileData.overview},
                  {id:"strategy",   label:"Strategia",       icon:"🎬", val: selectedComp.profileData.strategy},
                  {id:"patterns",   label:"Pattern",         icon:"🔁", val: selectedComp.profileData.patterns},
                  {id:"positioning",label:"Posizionamento",  icon:"🎯", val: selectedComp.profileData.positioning},
                  {id:"ideas",      label:"Idee da rubare",  icon:"💡", val: Array.isArray(selectedComp.profileData.stealIdeas) ? selectedComp.profileData.stealIdeas.map(i=>`• ${i}`).join("\n") : selectedComp.profileData.stealIdeas},
                  {id:"weaknesses", label:"Debolezze",       icon:"⚠️", val: selectedComp.profileData.weaknesses},
                  {id:"keywords",   label:"Keywords",        icon:"🔑", val: Array.isArray(selectedComp.profileData.keywords) ? selectedComp.profileData.keywords.map(k=>`• ${k}`).join("\n") : selectedComp.profileData.keywords},
                ].map(({id,label,icon,val})=>(
                  <CollapsibleSection key={id} title={label} icon={icon} color="#a78bfa" defaultOpen={id==="overview"}>
                    {val || "N/D"}
                  </CollapsibleSection>
                ))}
              </div>
            ) : (
              profileResult
                ? <ResultBox text={profileResult} color="#a78bfa"/>
                : <div style={{color:"#2a4a6a",fontFamily:"monospace",fontSize:12}}>Nessuna analisi profilo disponibile. Esegui prima la scansione.</div>
            )
          )}

          {!scanning&&scanTab==="competitor"&&(
            similarItems.length>0 ? (
              <div>
                {similarResult&&<div style={{fontSize:10,color:"#4a6a8a",fontFamily:"monospace",marginBottom:10}}>Query usate: {similarResult}</div>}
                {similarItems.map((it,i)=>{
                  return (
                    <CollapsibleSection key={`${it.handle}-${i}`} title={
                      <span style={{display:"flex",alignItems:"center",gap:8}}>
                        {it.handle}
                        <button onClick={e=>{e.stopPropagation(); handleScanSimilar(it);}} style={{background:"#0a1628",border:`1px solid #38bdf866`,color:"#38bdf8",borderRadius:5,padding:"2px 7px",cursor:"pointer",fontSize:10,fontFamily:"monospace",lineHeight:1.4}}>
                          🔍 Scansiona
                        </button>
                      </span>
                    } icon="👤" color="#f59e0b" defaultOpen={false}>
                      {it.profileUrl&&<a href={it.profileUrl} target="_blank" rel="noreferrer" style={{display:"inline-block",color:"#00ff9d",fontFamily:"monospace",fontSize:12,marginBottom:8,textDecoration:"none",fontWeight:700}}>{it.profileUrl}</a>}
                      {it.query&&<div style={{fontSize:10,color:"#4a6a8a",fontFamily:"monospace",marginBottom:6}}>Query: {it.query}</div>}
                      {it.desc&&<div style={{color:"#8aa8c8",lineHeight:1.6,fontSize:11}}>{it.desc}</div>}
                    </CollapsibleSection>
                  );
                })}
              </div>
            ) : (
              <div style={{color:"#2a4a6a",fontFamily:"monospace",fontSize:12}}>Nessun risultato. Clicca "Trova simili" per cercare competitor simili.</div>
            )
          )}

          {/* Debug panel always shown after scan */}
          {!scanning&&(scanLog.length>0||rawResponse)&&(
            <DebugPanel info={scanLog.join("\n")} rawText={rawResponse}/>
          )}
        </div>
      )}

      {(analyzing||batchLoading||discovering)&&<Spinner color="#a78bfa"/>}
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────
export default function App() {
  const [activeTab,setActiveTab]=useState("competitors");
  const [selectedAccounts,setSelectedAccounts]=useState([]);
  const [accountsLoaded,setAccountsLoaded]=useState(false);
  const activeColor=TAB_COLORS[activeTab];

  useEffect(()=>{ loadSelectedAccounts().then(list=>{ setSelectedAccounts(list); setAccountsLoaded(true); }); },[]);
  useEffect(()=>{ if(accountsLoaded) saveSelectedAccounts(selectedAccounts); },[selectedAccounts,accountsLoaded]);

  const addAccount = (account) => {
    setSelectedAccounts(prev=> prev.some(a=>a.handle===account.handle) ? prev : [...prev,account]);
  };
  const removeAccount = (handle) => {
    setSelectedAccounts(prev=> prev.filter(a=>a.handle!==handle));
  };
  const clearAccounts = () => { setSelectedAccounts([]); };

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
          <div style={{display:activeTab==="trend"?"block":"none"}}><TrendScanner/></div>
          <div style={{display:activeTab==="hook"?"block":"none"}}><HookGenerator/></div>
          <div style={{display:activeTab==="strategy"?"block":"none"}}><VideoStrategy selectedAccounts={selectedAccounts} onClearAccounts={clearAccounts}/></div>
          <div style={{display:activeTab==="viral"?"block":"none"}}><ViralFormula/></div>
          <div style={{display:activeTab==="competitors"?"block":"none"}}><Competitors selectedAccounts={selectedAccounts} onAddAccount={addAccount} onRemoveAccount={removeAccount} onGoToStrategy={()=>setActiveTab("strategy")}/></div>
        </div>
        <p style={{textAlign:"center",color:"#1e3a5f",fontSize:10,marginTop:16,fontFamily:"monospace"}}>Powered by Gemini AI · Dati salvati in modo persistente</p>
      </div>
    </div>
  );
}
