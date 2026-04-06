import { useState, useEffect } from "react";

const TABS = [
    { id:"competitors", label:"Competitor", icon:"🕵️" },
    { id:"strategy", label:"Strategia", icon:"🎬" },
    { id:"optimizer", label:"Optimizer", icon:"⚡" },
    { id:"explorer", label:"Explorer", icon:"🌍" },
];
const NICHES = ["Nutrizione","Fitness","Benessere mentale","Cucina sana","Dimagrimento","Sport & Performance"];
const PLATFORMS = ["TikTok","Instagram Reels","YouTube Shorts","LinkedIn"];
const TAB_COLORS = { explorer:"var(--acc-green)", optimizer:"var(--acc-orange)", strategy:"var(--acc-purple)", competitors:"var(--acc-blue)" };
const glow = (c="var(--acc-green)") => {
  if(c.startsWith("var(--")) {
     const v = c.slice(4, -1);
     return { boxShadow:`0 0 20px rgba(var(${v}-rgb), 0.15), 0 0 40px rgba(var(${v}-rgb), 0.08)`, border:`1px solid rgba(var(${v}-rgb), 0.25)` };
  }
  return { boxShadow:`0 0 20px ${c}22,0 0 40px ${c}11`, border:`1px solid ${c}44` };
};

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
async function loadSavedStrategies() {
  try { const r=window.localStorage.getItem("viralos_strategies"); return r?JSON.parse(r):[]; } catch { return []; }
}
async function saveStrategies(list) {
  try { window.localStorage.setItem("viralos_strategies",JSON.stringify(list)); } catch {}
}
function loadSavedOptimizations() {
  try { const r=window.localStorage.getItem("viralos_optimizations"); return r?JSON.parse(r):[]; } catch { return []; }
}
function saveOptimizations(list) {
  try { window.localStorage.setItem("viralos_optimizations",JSON.stringify(list)); } catch {}
}
async function loadExplorerCreators() {
  try { const r=window.localStorage.getItem("viralos_exp_cr"); return r?JSON.parse(r):[]; } catch { return []; }
}
async function saveExplorerCreators(list) {
  try { window.localStorage.setItem("viralos_exp_cr",JSON.stringify(list)); } catch {}
}
async function loadExplorerIdeas() {
  try { const r=window.localStorage.getItem("viralos_exp_id"); return r?JSON.parse(r):[]; } catch { return []; }
}
async function saveExplorerIdeas(list) {
  try { window.localStorage.setItem("viralos_exp_id",JSON.stringify(list)); } catch {}
}

// ─── SHARED UI ────────────────────────────────────────────────────
const Spinner = ({color="var(--acc-green)",label="Analisi in corso…"}) => (
  <div style={{display:"flex",alignItems:"center",gap:10,color,fontSize:13,marginTop:14}}>
    <div style={{width:14,height:14,border:`2px solid ${color}44`,borderTop:`2px solid ${color}`,borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
    {label}
  </div>
);

const ResultBox = ({text,color="var(--acc-green)"}) => !text?null:(
  <div style={{marginTop:18,padding:"16px",background:"linear-gradient(135deg,var(--bg-input-hover),var(--bg-panel))",...glow(color),borderRadius:12,whiteSpace:"pre-wrap",lineHeight:1.7,fontSize:13,color:"var(--text-main)",fontFamily:"'Courier New',monospace",maxHeight:380,overflowY:"auto"}}>
    {text}
  </div>
);

function renderRichText(text) {
  if (typeof text !== "string") return text;
  const html = text
    .replace(/(?:^|\n)\s*\**►\s*\**(\d+[\.\-\)])\**\s*/g, '\n$1 ')
    .replace(/(?:^|\n)\s*(?:###|##)\s*\**(\d+[\.\-\)])\**\s*/g, '\n$1 ')
    .replace(/(?:^|\n)##\s+(.*?)(?=\n|$)/g, '<div style="color: var(--acc-blue); font-weight: 800; font-size: 14.5px; margin-top: 18px; margin-bottom: 8px; letter-spacing: 0.5px; border-bottom: 1px solid rgba(var(--acc-blue-rgb), 0.2); padding-bottom: 4px; text-transform: uppercase;">$1</div>')
    .replace(/(?:^|\n)###\s+(.*?)(?=\n|$)/g, '<div style="color: var(--acc-purple); font-weight: 800; font-size: 13.5px; margin-top: 14px; margin-bottom: 6px; letter-spacing: 0.5px;">$1</div>')
    .replace(/\*?\*?(Giorno \d+|Video \d+|Lunedì|Martedì|Mercoledì|Giovedì|Venerdì|Sabato|Domenica)\*?\*?:?/gi, '<div style="background: linear-gradient(90deg, rgba(var(--acc-purple-rgb), 0.27), transparent); padding: 8px 12px; margin-top: 18px; margin-bottom: 6px; border-radius: 4px; border-left: 4px solid var(--acc-purple); font-weight: 800; color: var(--text-main); letter-spacing: 1px; text-transform: uppercase; font-size: 13px;">$1</div>')
    .replace(/\**►\s*\**([^:]{1,120}?)\**(?:[:]\s*|\s*\n|\s*$)/g, '<div style="background: linear-gradient(90deg, rgba(var(--acc-green-rgb), 0.13), transparent); padding: 8px 12px; margin-top: 16px; margin-bottom: 8px; border-radius: 4px; border-left: 4px solid var(--acc-green); font-weight: 800; color: var(--acc-green); letter-spacing: 1px; text-transform: uppercase; font-size: 13px; text-shadow: 0 0 10px rgba(var(--acc-green-rgb), 0.13);">$1</div>')
    .replace(/\*?\*?HOOK VIRALE\*?\*?:?\s*([\s\S]*?)(?=<div|\n\s*\*?\*?(?:HOOK|PATTERN|TRACCIA|BRIDGE|BODY|LOOP|GIORNO|VIDEO)\b|$)/gi, '<div style="background: rgba(var(--acc-orange-rgb), 0.07); border: 1px solid rgba(var(--acc-orange-rgb), 0.27); border-radius: 6px; padding: 10px; margin-bottom: 8px; margin-top: 8px;"><div style="color: var(--acc-orange); font-weight: 800; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 4px;">🎣 HOOK VIRALE (0-3S)</div><div style="color: var(--text-main); font-size: 13px;">$1</div></div>')
    .replace(/\*?\*?PATTERN INTERRUPT\*?\*?:?\s*([\s\S]*?)(?=<div|\n\s*\*?\*?(?:HOOK|PATTERN|TRACCIA|BRIDGE|BODY|LOOP|GIORNO|VIDEO)\b|$)/gi, '<div style="background: rgba(var(--acc-blue-rgb), 0.07); border: 1px solid rgba(var(--acc-blue-rgb), 0.27); border-radius: 6px; padding: 10px; margin-bottom: 8px;"><div style="color: var(--acc-blue); font-weight: 800; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 4px;">💥 PATTERN INTERRUPT VISUALE</div><div style="color: var(--text-muted); font-size: 13px;">$1</div></div>')
    .replace(/\*?\*?TRACCIA VISIVA\*?\*?:?\s*([\s\S]*?)(?=<div|\n\s*\*?\*?(?:HOOK|PATTERN|TRACCIA|BRIDGE|BODY|LOOP|GIORNO|VIDEO)\b|$)/gi, '<div style="background: rgba(var(--acc-green-rgb), 0.07); border: 1px solid rgba(var(--acc-green-rgb), 0.27); border-radius: 6px; padding: 10px; margin-bottom: 8px;"><div style="color: var(--acc-green); font-weight: 800; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 4px;">👁️ TRACCIA VISIVA</div><div style="color: var(--text-muted); font-size: 13px;">$1</div></div>')
    .replace(/\*?\*?BRIDGE\*?\*?:?\s*([\s\S]*?)(?=<div|\n\s*\*?\*?(?:HOOK|PATTERN|TRACCIA|BRIDGE|BODY|LOOP|GIORNO|VIDEO)\b|$)/gi, '<div style="background: rgba(var(--acc-purple-rgb), 0.05); border: 1px solid rgba(var(--acc-purple-rgb), 0.27); border-radius: 6px; padding: 10px; margin-bottom: 8px;"><div style="color: var(--acc-purple); font-weight: 800; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 4px;">🌉 BRIDGE / RE-HOOK (3-5S)</div><div style="color: var(--text-muted); font-size: 13px;">$1</div></div>')
    .replace(/\*?\*?BODY\*?\*?:?\s*([\s\S]*?)(?=\n\s*\*?\*?(?:HOOK VIRALE|PATTERN INTERRUPT|TRACCIA VISIVA|BRIDGE|LOOP|GIORNO|VIDEO)\b|$)/gi, '<div style="background: rgba(var(--acc-green-rgb), 0.05); border: 1px solid rgba(var(--acc-green-rgb), 0.27); border-radius: 6px; padding: 10px; margin-bottom: 8px;"><div style="color: var(--acc-green); font-weight: 800; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 4px;">🥩 CONTENUTO E SVOLGIMENTO</div><div style="color: var(--text-main); font-size: 13px; white-space: pre-wrap;">\n$1</div></div>')
    .replace(/\*?\*?LOOP\*?\*?:?\s*([\s\S]*?)(?=<div|\n\s*\*?\*?(?:HOOK VIRALE|PATTERN INTERRUPT|TRACCIA VISIVA|BRIDGE|BODY|GIORNO|VIDEO)\b|$)/gi, '<div style="background: rgba(var(--acc-red-rgb), 0.05); border: 1px solid rgba(var(--acc-red-rgb), 0.27); border-radius: 6px; padding: 10px; margin-bottom: 12px;"><div style="color: var(--acc-red); font-weight: 800; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 4px;">♻️ LOOP / CTA (FINE)</div><div style="color: var(--text-muted); font-size: 13px; white-space: pre-wrap;">$1</div></div>')
    .replace(/(^|\n)(1\.|2\.|3\.|4\.|5\.|6\.|7\.|8\.|9\.)\s*(.*?)(?=\n|$)/g, '$1<div style="display:flex;align-items:flex-start;margin-top:10px;margin-bottom:10px;"><div style="background:rgba(var(--acc-blue-rgb),0.13);color:var(--acc-blue);min-width:22px;width:22px;height:22px;text-align:center;border-radius:50%;border:1px solid rgba(var(--acc-blue-rgb),0.27);font-weight:800;font-size:11px;line-height:22px;margin-right:10px;flex-shrink:0;box-sizing:border-box;">$2</div><div style="flex:1;min-width:0;">$3</div></div>')
    .replace(/^\s*[\-\*]\s+(.*?)(?=\n|$)/gm, '<div style="display:flex;align-items:flex-start;margin-top:6px;margin-bottom:2px;"><span style="color:var(--acc-green);margin-right:8px;font-weight:bold;flex-shrink:0;line-height:1.6;">•</span><span style="flex:1;min-width:0;">$1</span></div>')
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color: var(--text-main); font-weight: 700;">$1</strong>')
    .replace(/\*\*/g, '');
  
  return <div dangerouslySetInnerHTML={{__html: html}} />;
}

function CollapsibleSection({title, color="var(--acc-blue)", children, defaultOpen=true, icon=""}) {
  const [open,setOpen]=useState(defaultOpen);
  return (
    <div style={{marginBottom:10,border:`1px solid ${color}22`,borderRadius:12,overflow:"hidden"}}>
      <div onClick={()=>setOpen(!open)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",background:`${color}0d`,cursor:"pointer",color,fontFamily:"monospace",fontSize:14,fontWeight:700,textTransform:"uppercase",letterSpacing:1.2,userSelect:"none"}}>
        <span style={{display:"flex",alignItems:"center",gap:10}}>{icon&&<span>{icon}</span>}{title}</span>
        <span style={{fontSize:14,opacity:.7,flexShrink:0,marginLeft:10}}>{open?"▲":"▼"}</span>
      </div>
      {open&&<div style={{padding:"12px 14px",background:"var(--bg-input)",fontSize:13,color:"var(--text-muted)",lineHeight:1.75,whiteSpace:"pre-wrap"}}>{renderRichText(children)}</div>}
    </div>
  );
}

function DebugPanel({info, rawText}) {
  const [open,setOpen]=useState(false);
  if(!info&&!rawText) return null;
  return (
    <div style={{marginTop:12,borderRadius:8,overflow:"hidden",border:"1px solid var(--border)"}}>
      <button onClick={()=>setOpen(!open)} style={{width:"100%",padding:"12px 14px",background:"var(--bg-panel)",border:"none",color:"var(--text-muted)",fontSize:13,cursor:"pointer",textAlign:"left",fontFamily:"monospace",display:"flex",justifyContent:"space-between",fontWeight:"bold"}}>
        <span>🐛 Debug panel</span><span>{open?"▲":"▼"}</span>
      </button>
      {open&&(
        <div style={{background:"#020508",padding:12,maxHeight:300,overflowY:"auto"}}>
          {info&&<div style={{fontSize:11,color:"var(--acc-orange)",fontFamily:"monospace",marginBottom:8,whiteSpace:"pre-wrap"}}>{info}</div>}
          {rawText&&(
            <div>
              <div style={{fontSize:10,color:"var(--text-muted)",marginBottom:4,fontFamily:"monospace"}}>— Risposta grezza API —</div>
              <div style={{fontSize:11,color:"var(--text-muted)",fontFamily:"monospace",whiteSpace:"pre-wrap",wordBreak:"break-all"}}>{rawText.slice(0,1500)}{rawText.length>1500?"…":""}</div>
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
      <label style={{display:"block",marginBottom:5,fontSize:10,color:"var(--text-muted)",letterSpacing:2,textTransform:"uppercase"}}>{label}</label>
      <select value={value} onChange={e=>onChange(e.target.value)} style={{width:"100%",padding:"12px 14px",background:"var(--bg-panel)",border:"1px solid var(--border)",borderRadius:8,color:"var(--text-main)",fontSize:16,outline:"none",fontFamily:"inherit"}}>
        {options.map(o=><option key={o}>{o}</option>)}
      </select>
    </div>
  );
}
function Textarea({value,onChange,placeholder,rows=3}) {
  return <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows} style={{width:"100%",padding:"14px 16px",background:"var(--bg-panel)",border:"1px solid var(--border)",borderRadius:8,color:"var(--text-main)",fontSize:16,outline:"none",resize:"vertical",fontFamily:"inherit",lineHeight:1.6,boxSizing:"border-box",marginBottom:14}}/>;
}
function Btn({onClick,loading,children,color="var(--acc-green)",small=false}) {
  return (
    <button onClick={onClick} disabled={loading} style={{width:small?"auto":"100%",padding:small?"8px 14px":"13px 20px",background:loading?"var(--bg-input-hover)":`linear-gradient(135deg,${color}22,${color}11)`,border:`1px solid ${loading?"var(--border)":color}`,color:loading?"var(--text-muted)":color,borderRadius:8,fontSize:small?12:14,fontWeight:600,cursor:loading?"not-allowed":"pointer",letterSpacing:.5,transition:"all .2s",fontFamily:"inherit"}}>
      {children}
    </button>
  );
}

// ─── EXPLORER ─────────────────────────────────────────────────────
function Explorer({onGoToScan, requestedMode, clearRequestedMode}) {
  const [mode, setMode] = useState("creator"); // "creator" | "ideas"
  
  useEffect(() => {
     if(requestedMode) {
        setMode(requestedMode);
        clearRequestedMode();
     }
  }, [requestedMode, clearRequestedMode]);
  const [platform, setPlatform] = useState("TikTok");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [creators, setCreators] = useState([]);
  const [ideasResult, setIdeasResult] = useState([]); // Ora è array
  const [searched, setSearched] = useState(false);
  const [historyCreators, setHistoryCreators] = useState([]);
  const [historyIdeas, setHistoryIdeas] = useState([]);

  useEffect(() => {
    loadExplorerCreators().then(setHistoryCreators);
    loadExplorerIdeas().then(setHistoryIdeas);
  }, []);

  const handleSearch = async () => {
    if(!query.trim()) return;
    setLoading(true); setCreators([]); setIdeasResult(""); setSearched(true);
    
    if(mode === "creator") {
      const plat = platform === "TikTok" ? "tiktok" : "instagram";
      const domain = platform === "TikTok" ? "tiktok.com" : "instagram.com";
      const { results } = await tavilySearch({
        query: `${query} ${plat} profilo`,
        maxResults: 8,
        searchDepth: "basic",
        includeDomains: [domain]
      });
      
      const arr = [];
      (results||[]).forEach(r => {
        let handleMatch = r.url.match(/tiktok\.com\/@([^\/\?]+)/);
        if(!handleMatch) handleMatch = r.url.match(/instagram\.com\/([^\/\?]+)/);
        if(handleMatch) {
          const handle = handleMatch[1];
          // Prevenire handle spazzatura o troppo lunghi spesso catturati da tavily per sbaglio
          if(handle.length < 30 && !arr.some(a=>a.handle===handle)) {
             arr.push({ handle: `@${handle}`, profileUrl: r.url, desc: (r.content||r.snippet||"").slice(0, 200) });
          }
        }
      });
      setCreators(arr);
      if(arr.length > 0) {
        setHistoryCreators(prev => {
          const n = [{ id: Date.now().toString(), name: `[C] ${query} (${platform})`, date: new Date().toLocaleDateString("it-IT"), data: arr }, ...prev];
          saveExplorerCreators(n);
          return n;
        });
      }
    } else {
      // 1. LLM Query Translation
      const qSys = `Converti l'intento dell'utente in massimo 2 query di ricerca web super sintetiche. Rispondi SOLO con JSON: {"queries":["query1","query2"]}. Le query devono avere max 3 parole. NON includere il nome della piattaforma.`;
      const qPrompt = `Testo utente: ${query}`;
      const {text: qText} = await callLLM({ provider: ACTIVE_PROVIDER, prompt: qPrompt, system: qSys });
      const {json: qJson} = extractJsonBlock(qText);
      const searchQueries = (qJson?.queries || []).slice(0, 2);
      
      if(!searchQueries.length) { setIdeasResult([]); setLoading(false); return; }

      // 2. Web Scraping
      const domain = platform === "TikTok" ? "tiktok.com" : "instagram.com";
      const platWord = platform === "TikTok" ? "tiktok" : "instagram";
      let allResults = [];
      for(const q of searchQueries) {
         const {results} = await tavilySearch({ query: `${q} ${platWord}`, maxResults: 3, searchDepth: "basic", includeDomains:[domain] });
         allResults = [...allResults, ...(results||[])];
      }
      const sourcesContext = buildSourcesFromResults(allResults);

      // 3. Json Array Extraction
      const exSystem = `Sei un content analyst esperto di social media. Leggi le FONTI in tempo reale e delinea i format/trend attuali scoperti per questo settore. Usa il markdown nella descrizione. Organizza il contenuto a PUNTI ELENCO, mettendo la parola chiave in MAIUSCOLO E GRASSETTO (es. **FOCUS:** desc..., **TARGET:** desc..., **ESEMPI:** desc...).
Rispondi RIGOROSAMENTE con questo JSON esatto (zero markdown fuori dal JSON):
{"formats": [ {"title": "NOME FORMAT IN MAIUSCOLO", "description": "Spiegazione dettagliata a punti chiave in markdown", "links":["url reale del video o profilo preso dalle fonti", "..."]} ]}`;
      const exPrompt = `Idea Iniziale Utente: ${query}\nPiattaforma: ${platform}\n\nFONTI IN TEMPO REALE:\n${sourcesContext || "Nessuna fonte trovata, genera idee probabili basate sull'idea iniziale."}`;

      const {text: exText} = await callLLM({ provider: ACTIVE_PROVIDER, prompt: exPrompt, system: exSystem});
      const {json: exJson} = extractJsonBlock(exText);
      
      const resData = (exJson?.formats || []).filter(f=>f.title);
      setIdeasResult(resData);
      
      if(resData.length > 0) {
        setHistoryIdeas(prev => {
          const n = [{ id: Date.now().toString(), name: `[I] ${query} (${platform})`, date: new Date().toLocaleDateString("it-IT"), data: resData }, ...prev];
          saveExplorerIdeas(n);
          return n;
        });
      }
    }
    setLoading(false);
  };

  return (
    <div>
      <div style={{display:"flex",gap:6,marginBottom:16}}>
        <button onClick={()=>{setMode("creator"); setSearched(false);}} style={{flex:1,padding:"10px",background:mode==="creator"?"rgba(var(--acc-green-rgb), 0.13)":"#060d1a",border:mode==="creator"?"1px solid var(--acc-green)":"1px solid var(--border)",borderRadius:8,color:mode==="creator"?"var(--acc-green)":"var(--text-muted)",fontSize:13,fontFamily:"monospace",fontWeight:"bold"}}>🕵 Cerca Creator</button>
        <button onClick={()=>{setMode("ideas"); setSearched(false);}} style={{flex:1,padding:"10px",background:mode==="ideas"?"rgba(var(--acc-green-rgb), 0.13)":"#060d1a",border:mode==="ideas"?"1px solid var(--acc-green)":"1px solid var(--border)",borderRadius:8,color:mode==="ideas"?"var(--acc-green)":"var(--text-muted)",fontSize:13,fontFamily:"monospace",fontWeight:"bold"}}>💡 Cerca Idee & Format</button>
      </div>

      <div style={{background:"var(--bg-panel)",border:"1px solid var(--border)",borderRadius:10,padding:14,marginBottom:18}}>
        <Sel value={platform} onChange={setPlatform} options={PLATFORMS.slice(0,2)} label="Piattaforma"/>
        <div style={{marginBottom:14}}>
          <label style={{display:"block",marginBottom:5,fontSize:10,color:"var(--text-muted)",letterSpacing:2,textTransform:"uppercase"}}>
            {mode==="creator"?"Che tipo di profili cerchi?":"Cosa vuoi esplorare?"}
          </label>
          <Textarea value={query} onChange={setQuery} placeholder={mode==="creator"?"es. nutrizionista sportivo vegano":"es. format video estivi per personal trainer"} rows={2}/>
        </div>
        <Btn onClick={handleSearch} loading={loading} color="var(--acc-green)">{loading?"Ricerca…":mode==="creator"?"🌍 Trova Profili":"🌍 Trova Idee"}</Btn>
      </div>

      {loading&&<Spinner color="var(--acc-green)"/>}

      {!loading && searched && mode === "creator" && (
        <div style={{marginTop: 20}}>
          <div id="explorer-creator-top" />
          <div style={{fontSize:10,color:"var(--text-muted)",letterSpacing:2,textTransform:"uppercase",marginBottom:10,fontFamily:"monospace"}}>Risultati ({creators.length})</div>
          {creators.length > 0 ? creators.map((it, i) => (
             <CollapsibleSection key={`${it.handle}-${i}`} title={
               <span style={{display:"flex",alignItems:"center",gap:8}}>
                 {it.handle}
                 <button onClick={e=>{e.stopPropagation(); onGoToScan(it.handle, platform);}} style={{background:"var(--bg-input-hover)",border:`1px solid rgba(var(--acc-green-rgb), 0.4)`,color:"var(--acc-green)",borderRadius:5,padding:"4px 8px",cursor:"pointer",fontSize:11,fontFamily:"monospace",lineHeight:1.4}}>
                   🔍 Scansiona
                 </button>
               </span>
             } icon="🌍" color="var(--acc-green)" defaultOpen={false}>
               {it.profileUrl&&<a href={it.profileUrl} target="_blank" rel="noreferrer" style={{display:"inline-block",color:"var(--acc-green)",fontFamily:"monospace",fontSize:12,marginBottom:8,textDecoration:"none",fontWeight:700}}>{it.profileUrl}</a>}
               {it.desc&&<div style={{color:"var(--text-muted)",lineHeight:1.6,fontSize:11}}>{it.desc}</div>}
             </CollapsibleSection>
          )) : <ResultBox text="Nessun profilo trovato. Prova con altre parole chiave." color="var(--acc-red)"/>}
        </div>
      )}

      {!loading && searched && mode === "ideas" && (
        <div style={{marginTop: 20}}>
          <div id="explorer-ideas-top" />
          <div style={{fontSize:10,color:"var(--text-muted)",letterSpacing:2,textTransform:"uppercase",marginBottom:10,fontFamily:"monospace"}}>Format e Idee Trovate</div>
          {Array.isArray(ideasResult) && ideasResult.length > 0 ? (
            ideasResult.map((f, i) => (
             <CollapsibleSection key={i} title={f.title} icon="💡" color="var(--acc-green)" defaultOpen={false}>
               <div style={{color:"var(--text-muted)", lineHeight:1.7}}>
                  {renderRichText(f.description)}
               </div>
               {f.links && f.links.length > 0 && (
                 <div style={{marginTop:12, paddingTop:12, borderTop:"1px dashed var(--border)"}}>
                   <div style={{fontSize:10,color:"var(--acc-green)",letterSpacing:1,textTransform:"uppercase",marginBottom:8,fontFamily:"monospace"}}>🔗 Riferimenti Format</div>
                   {f.links.map((lnk,idx)=>(
                      <a key={idx} href={lnk} target="_blank" rel="noreferrer" style={{display:"block",color:"var(--acc-blue)",fontSize:11,textDecoration:"none",marginBottom:6,fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>→ {lnk}</a>
                   ))}
                 </div>
               )}
             </CollapsibleSection>
            ))
          ) : (
            <ResultBox text="Nessun format generato. Prova termini più chiari." color="var(--acc-red)"/>
          )}
        </div>
      )}

      {/* HISTORIES */}
      {!loading && mode === "creator" && historyCreators.length > 0 && (
        <div style={{marginTop: 30, paddingTop: 20, borderTop: "1px dashed var(--border)"}}>
          <div style={{fontSize:10,color:"var(--text-muted)",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Archivio Ricerche Creator</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {historyCreators.map(item => (
              <div key={item.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:"var(--bg-input-hover)",border:"1px solid rgba(var(--acc-green-rgb), 0.2)",borderRadius:8}}>
                <div onClick={() => { setCreators(item.data); setSearched(true); setTimeout(()=>document.getElementById('explorer-creator-top')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150); }} style={{cursor:"pointer",flex:1,display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:12,color:"var(--acc-green)",fontWeight:"bold"}}>{item.name}</span>
                  <span style={{fontSize:10,color:"var(--text-muted)"}}>{item.date}</span>
                </div>
                <button onClick={(e) => {
                  e.stopPropagation();
                  setHistoryCreators(prev => {
                     const n = prev.filter(x => x.id !== item.id);
                     saveExplorerCreators(n);
                     return n;
                  });
                }} style={{background:"none",border:"none",color:"var(--acc-red)",cursor:"pointer",fontSize:13,padding:"4px 8px"}} title="Elimina Ricerca">🗑️</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && mode === "ideas" && historyIdeas.length > 0 && (
        <div style={{marginTop: 30, paddingTop: 20, borderTop: "1px dashed var(--border)"}}>
          <div style={{fontSize:10,color:"var(--text-muted)",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Archivio Ricerche Idee</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {historyIdeas.map(item => (
              <div key={item.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:"var(--bg-input-hover)",border:"1px solid rgba(var(--acc-green-rgb), 0.2)",borderRadius:8}}>
                <div onClick={() => { setIdeasResult(item.data); setSearched(true); setTimeout(()=>document.getElementById('explorer-ideas-top')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150); }} style={{cursor:"pointer",flex:1,display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:12,color:"var(--acc-green)",fontWeight:"bold"}}>{item.name}</span>
                  <span style={{fontSize:10,color:"var(--text-muted)"}}>{item.date}</span>
                </div>
                <button onClick={(e) => {
                  e.stopPropagation();
                  setHistoryIdeas(prev => {
                     const n = prev.filter(x => x.id !== item.id);
                     saveExplorerIdeas(n);
                     return n;
                  });
                }} style={{background:"none",border:"none",color:"var(--acc-red)",cursor:"pointer",fontSize:13,padding:"8px 8px"}} title="Elimina Ricerca">🗑️</button>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// ─── PIANO EDITORIALE ─────────────────────────────────────────────
function PianoEditoriale({text, onOptimize}) {
  const days = text.split(/(?=GIORNO \d+:)/i).map(p=>p.trim()).filter(Boolean);
  if(!days.length) return <div style={{whiteSpace:"pre-wrap",fontSize:13,color:"var(--text-muted)"}}>{text}</div>;
  return (
    <div>
      {days.map((part,i)=>{
        const m = part.match(/^GIORNO (\d+):/i);
        const num = m ? m[1] : i+1;
        const content = part.replace(/^GIORNO \d+:\s*/i,"");
        const title = (
          <span style={{display:"flex",alignItems:"center",gap:10,width:"100%"}}>
            <span>Giorno {num}</span>
            {onOptimize&&(
              <button onClick={e=>{e.stopPropagation();onOptimize(`Giorno ${num}:\n${content}`);}}
                style={{background:"rgba(var(--acc-orange-rgb),0.12)",border:"1px solid rgba(var(--acc-orange-rgb),0.35)",color:"var(--acc-orange)",borderRadius:5,padding:"2px 9px",cursor:"pointer",fontSize:10,fontFamily:"monospace",fontWeight:700}}>
                ⚡ Ottimizza
              </button>
            )}
          </span>
        );
        return <CollapsibleSection key={i} title={title} color="var(--acc-purple)" defaultOpen={i===0}>{content}</CollapsibleSection>;
      })}
    </div>
  );
}

// ─── OPTIMIZER ────────────────────────────────────────────────────
function Optimizer({initialInput="", onClearInput}) {
  const [input,setInput]=useState(initialInput);
  const [platform,setPlatform]=useState("TikTok");
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState(null);
  const [history,setHistory]=useState(()=>loadSavedOptimizations());

  useEffect(()=>{ if(initialInput){ setInput(initialInput); setResult(null); } },[initialInput]);

  const run = async () => {
    if(!input.trim()) return; setLoading(true); setResult(null);
    const sys=`Sei un esperto di content creation per social media. A partire dall'idea/struttura fornita, genera versioni ottimizzate per ogni elemento del video.
Rispondi SOLO con questi tag XML:
<hook>3-5 varianti di hook (prime 3 secondi) con diversi angoli emotivi. Usa "► VARIANTE X:" come prefisso.</hook>
<reHook>3 varianti di re-hook/bridge per trattenere dopo il 3° secondo</reHook>
<visual>3-5 idee di pattern interrupt visivo e scenografia specifica</visual>
<contenuto>3 varianti di struttura del contenuto/body ottimizzate</contenuto>
<chiusura>3-5 varianti di chiusura/CTA che rilanciano le views o convertono</chiusura>
Rispondi in italiano. Sii specifico e pratico. Usa "► NOME:" per i punti cardine.`;
    const {text,error}=await callAI(`Piattaforma: ${platform}\n\nIDEA/STRUTTURA VIDEO:\n${input}`,sys);
    if(error){setResult({_error:error.message});setLoading(false);return;}
    const pt=(tag)=>{const m=text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`,`i`));return m?m[1].trim():"";};
    const r={hook:pt("hook"),reHook:pt("reHook"),visual:pt("visual"),contenuto:pt("contenuto"),chiusura:pt("chiusura")};
    setResult(r);
    const autoName=input.trim().split(/\s+/).slice(0,5).join(" ");
    const entry={id:Date.now(),name:autoName,date:new Date().toLocaleDateString("it-IT"),platform,input,data:r};
    const updated=[entry,...history];
    setHistory(updated);
    saveOptimizations(updated);
    setLoading(false);
  };

  const loadFromHistory = (item) => {
    setInput(item.input);
    setPlatform(item.platform);
    setResult(item.data);
    setShowSave(false);
    window.scrollTo({top:0,behavior:"smooth"});
  };

  const deleteFromHistory = (id) => {
    const updated=history.filter(h=>h.id!==id);
    setHistory(updated);
    saveOptimizations(updated);
  };

  return (
    <div>
      {initialInput&&onClearInput&&(
        <div style={{marginBottom:12,padding:"8px 12px",background:"rgba(var(--acc-orange-rgb),0.07)",border:"1px solid rgba(var(--acc-orange-rgb),0.25)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:11,color:"var(--acc-orange)",fontFamily:"monospace"}}>📋 Importato dal piano editoriale</span>
          <button onClick={onClearInput} style={{background:"none",border:"none",color:"var(--text-muted)",cursor:"pointer",fontSize:11,fontFamily:"monospace"}}>✕ Pulisci</button>
        </div>
      )}
      <div style={{marginBottom:14}}>
        <label style={{display:"block",marginBottom:5,fontSize:10,color:"var(--text-muted)",letterSpacing:2,textTransform:"uppercase"}}>Idea o struttura video *</label>
        <Textarea value={input} onChange={setInput} placeholder={"Descrivi il tuo video o incolla la struttura di un giorno del piano editoriale...\n\nEs: HOOK VIRALE: 'Pensavi che la colazione facesse dimagrire?'\nBODY: 3 miti sulla colazione\nLOOP: CTA per la guida gratuita"} rows={7}/>
      </div>
      <Sel value={platform} onChange={setPlatform} options={PLATFORMS} label="Piattaforma"/>
      <Btn onClick={run} loading={loading} color="var(--acc-orange)">{loading?"Ottimizzazione…":"⚡ Ottimizza Video"}</Btn>
      {loading&&<Spinner color="var(--acc-orange)"/>}
      {result?._error&&<ResultBox text={`Errore: ${result._error}`} color="var(--acc-red)"/>}
      {result&&!result._error&&(
        <div style={{marginTop:18}}>
          {result.hook&&<CollapsibleSection title="🎣 HOOK (0–3s)" color="var(--acc-red)" defaultOpen={true}>{result.hook}</CollapsibleSection>}
          {result.reHook&&<CollapsibleSection title="🌉 RE-HOOK / BRIDGE" color="var(--acc-blue)" defaultOpen={false}>{result.reHook}</CollapsibleSection>}
          {result.visual&&<CollapsibleSection title="👁️ PATTERN INTERRUPT VISIVO" color="var(--acc-green)" defaultOpen={false}>{result.visual}</CollapsibleSection>}
          {result.contenuto&&<CollapsibleSection title="🥩 CONTENUTO OTTIMIZZATO" color="var(--acc-green)" defaultOpen={false}>{result.contenuto}</CollapsibleSection>}
          {result.chiusura&&<CollapsibleSection title="♻️ CHIUSURA / CTA" color="var(--acc-orange)" defaultOpen={false}>{result.chiusura}</CollapsibleSection>}
        </div>
      )}
      {history.length>0&&(
        <div style={{marginTop:28}}>
          <div style={{fontSize:10,color:"var(--text-muted)",letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Storico ottimizzazioni</div>
          {history.map(item=>(
            <div key={item.id} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:8,marginBottom:6}}>
              <div onClick={()=>loadFromHistory(item)} style={{flex:1,cursor:"pointer",minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:"var(--text-main)",fontFamily:"monospace",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.name}</div>
                <div style={{fontSize:10,color:"var(--text-muted)",marginTop:2}}>{item.platform} · {item.date}</div>
              </div>
              <button onClick={()=>loadFromHistory(item)} style={{background:"rgba(var(--acc-orange-rgb),0.12)",color:"var(--acc-orange)",border:"none",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontSize:11,fontFamily:"monospace",whiteSpace:"nowrap"}}>Carica</button>
              <button onClick={()=>deleteFromHistory(item.id)} style={{background:"none",border:"none",color:"var(--text-muted)",cursor:"pointer",fontSize:14,padding:"0 2px"}}>🗑️</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── STRATEGY ─────────────────────────────────────────────────────
function parseStrategyOutput(text) {
  const parseTag = (tag) => {
    const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
    return match ? match[1].trim() : "";
  };

  const parsed = {
    pianoEditoriale: parseTag("pianoEditoriale"),
    analisiComune: parseTag("analisiComune"),
    strategiaDifferenziante: parseTag("strategiaDifferenziante"),
    strutturaVideo: parseTag("strutturaVideo"),
    kpiPrincipali: parseTag("kpiPrincipali"),
    ctaStrategy: parseTag("ctaStrategy")
  };

  if (!Object.values(parsed).some(val => val.length > 0)) {
     throw new Error("Nessun tag riconosciuto. Formattazione invalidata dall'AI.");
  }
  return parsed;
}

function VideoStrategy({selectedAccounts=[], onClearAccounts, onGoToExplorer, onOptimizeDay}) {
  const [goal,setGoal]=useState(""); const [audience,setAudience]=useState("");
  const [platform,setPlatform]=useState("Instagram Reels"); const [loading,setLoading]=useState(false); const [result,setResult]=useState(null);
  const [rawText, setRawText] = useState(""); const [debugInfo, setDebugInfo] = useState("");
  const [history, setHistory] = useState([]);

  useEffect(() => {
    loadSavedStrategies().then(list => setHistory(list || []));
  }, []);
  
  const generateStrategy = async () => {
    if(!selectedAccounts.length && !goal) return;
    setLoading(true); setResult(null); setRawText(""); setDebugInfo("");

    const isCompetitor = selectedAccounts.length > 0;

    // Contesto base condiviso tra le due chiamate
    let baseContext = "";
    if (isCompetitor) {
      const accountList = selectedAccounts.map(a=>{
        let out = `- ${a.handle} (${a.platform})${a.profileUrl?` → ${a.profileUrl}`:""}`;
        if(a.profileAnalysis) out += `\n  [ANALISI PROFILO]: ${a.profileAnalysis.replace(/\n+/g," ").slice(0,1000)}`;
        if(a.videos?.length>0) {
          const topVids = a.videos.filter(v=>v.title).sort((v1,v2)=>(v2.score||0)-(v1.score||0)).slice(0,6).map(v=>v.title).join(" | ");
          out += `\n  [VIDEO TOP]: ${topVids}`;
        }
        return out;
      }).join("\n\n");
      baseContext = `Competitor:\n${accountList}${goal?`\n\nOBIETTIVO: ${goal}`:""}${audience?`\nTARGET: ${audience}`:""}${platform?`\nPIATTAFORMA: ${platform}`:""}`;
    } else {
      baseContext = `Obiettivo: ${goal}\nTarget: ${audience||"n/a"}\nPiattaforma: ${platform}`;
    }

    const styleRules = `MOLTO IMPORTANTE: Rivolgiti sempre in seconda persona ("tu", "il tuo piano"). Usa "► NOME:" per i punti cardine (senza grassetti attorno al nome). Usa ## e ### per i titoli. Rispondi in italiano. Usa SOLO i tag XML indicati, senza backticks.`;

    // ── CHIAMATA 1: Piano editoriale ──────────────────────────────
    setDebugInfo("⏳ Fase 1/2 — Generazione piano editoriale...");
    const sys1 = `Sei uno stratega di content marketing. ${styleRules}
Genera SOLO il piano editoriale per 7 giorni nel tag seguente:
<pianoEditoriale>
Usa questo schema per OGNI giorno (ripetilo 7 volte):
GIORNO X:
HOOK VIRALE: (testo hook)
PATTERN INTERRUPT: (suggerimento visivo)
BRIDGE: (come trattenere dopo il 3° secondo)
BODY: (3 concetti o step)
LOOP: (CTA o chiusura che rilancia le views)
</pianoEditoriale>`;

    const {text: text1, error: err1} = await callAI(baseContext, sys1);
    if (err1) {
      setDebugInfo(`❌ Errore fase 1: ${JSON.stringify(err1)}`);
      setResult({ _error: err1.message }); setLoading(false); return;
    }
    setDebugInfo("✅ Fase 1/2 completata — Generazione strategia...");

    // ── CHIAMATA 2: Il resto della strategia ─────────────────────
    const sys2 = isCompetitor
      ? `Sei uno stratega di content marketing. ${styleRules}
Genera la strategia differenziante basata sui competitor nel formato seguente:
<analisiComune>Pattern comuni emersi dai competitor (breve)</analisiComune>
<strategiaDifferenziante>Inizia con "► GAP DI MERCATO:" poi aggiungi altri punti con "► "</strategiaDifferenziante>`
      : `Sei uno stratega di content marketing. ${styleRules}
Genera la struttura video e le metriche nel formato seguente:
<strutturaVideo>Struttura secondo per secondo con box "► "</strutturaVideo>
<kpiPrincipali>Metriche chiave da monitorare</kpiPrincipali>
<ctaStrategy>Strategie call-to-action</ctaStrategy>`;

    const {text: text2, error: err2} = await callAI(baseContext, sys2);
    if (err2) {
      setDebugInfo(`❌ Errore fase 2: ${JSON.stringify(err2)}`);
      setResult({ _error: err2.message }); setLoading(false); return;
    }

    const combinedText = text1 + "\n" + text2;
    setRawText(combinedText);
    setDebugInfo(`✅ Entrambe le fasi completate (${combinedText.length} char totali)`);

    try {
      const parsed = parseStrategyOutput(combinedText);

      const strategyName = selectedAccounts.length > 0 
        ? `[Competitor] ${selectedAccounts.map(a=>a.handle).join(', ')}`
        : `[Manuale] ${goal.trim().split(' ').slice(0,3).join(' ')}...`;
      
      const newEntry = {
        id: Date.now(),
        date: new Date().toLocaleDateString('it-IT', { hour: '2-digit', minute: '2-digit' }),
        name: strategyName,
        data: parsed
      };

      setResult(parsed);
      setHistory(prev => {
        const next = [newEntry, ...prev].slice(0, 30);
        saveStrategies(next);
        return next;
      });

      setDebugInfo(prev => prev + `\n\n✅ Estrazione Tag XML completata (${combinedText.length} char)`);
    } catch(err) {
      setDebugInfo(prev => prev + `\n\n❌ ERRORE PARSING TAG XML: ${err.message}\nTesto:\n${combinedText.slice(0,500)}`);
      setResult({ _error: `Impossibile analizzare i tag testuali dall'AI.\nProva a generarlo di nuovo.\nTesto originale:\n${combinedText.slice(0,500)}...` });
    }

    setLoading(false);
  };
  const safeStr = (val) => typeof val === "string" ? val : JSON.stringify(val, null, 2);

  return (
    <div>
      {selectedAccounts.length>0&&(
        <div style={{marginBottom:18,border:"1px solid rgba(var(--acc-purple-rgb), 0.2)",borderRadius:10,padding:12,background:"var(--bg-panel)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div style={{fontSize:10,color:"var(--acc-purple)",letterSpacing:2,textTransform:"uppercase",fontFamily:"monospace"}}>Account selezionati ({selectedAccounts.length})</div>
            {onClearAccounts&&<button onClick={onClearAccounts} style={{background:"var(--bg-input-hover)",border:"1px solid rgba(var(--acc-purple-rgb), 0.33)",borderRadius: 6,color:"var(--acc-purple)",cursor:"pointer",fontSize:11,fontFamily:"monospace",padding:"8px 12px"}}>✕ Svuota</button>}
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
            {selectedAccounts.map(a=>(
              <span key={a.handle} style={{fontSize:11,color:"var(--acc-purple)",background:"var(--bg-input-hover)",border:"1px solid rgba(var(--acc-purple-rgb), 0.2)",borderRadius:6,padding:"3px 8px",fontFamily:"monospace"}}>{a.handle}</span>
            ))}
          </div>
        </div>
      )}
      <div style={{marginBottom:14}}>
        <label style={{display:"block",marginBottom:5,fontSize:10,color:"var(--text-muted)",letterSpacing:2,textTransform:"uppercase"}}>Obiettivo principale {selectedAccounts.length===0?"*":""}</label>
        <Textarea value={goal} onChange={setGoal} placeholder="es. acquisire clienti per consulenze..." rows={2}/>
        <button onClick={() => onGoToExplorer("ideas")} style={{background:"none",border:"none",color:"var(--acc-purple)",textDecoration:"underline",fontSize:11,cursor:"pointer",marginTop:6,fontFamily:"monospace"}}>Non sai da dove partire? 🌍 Trova spunti e format in Explorer</button>
      </div>
      <div style={{marginBottom:14}}><label style={{display:"block",marginBottom:5,fontSize:10,color:"var(--text-muted)",letterSpacing:2,textTransform:"uppercase"}}>Target audience</label><Textarea value={audience} onChange={setAudience} placeholder="es. donne 30-45 anni..." rows={2}/></div>
      <Sel value={platform} onChange={setPlatform} options={PLATFORMS} label="Piattaforma principale"/>
      <Btn onClick={generateStrategy} loading={loading} color="var(--acc-purple)">
        {loading?"Costruzione…":selectedAccounts.length>0?"🎬 Genera strategia dai competitor":"🎬 Crea Strategia"}
      </Btn>
      {loading&&<Spinner color="var(--acc-purple)"/>}

      {history.length > 0 && !loading && (
        <div style={{marginTop: 20, marginBottom: 12}}>
          <div style={{fontSize:10,color:"var(--text-muted)",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Strategie Salvate</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {history.map(item => (
              <div key={item.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:"var(--bg-input-hover)",border:"1px solid rgba(var(--acc-purple-rgb), 0.2)",borderRadius:8}}>
                <div onClick={() => { setResult(item.data); setTimeout(()=>document.getElementById('strategy-result-top')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150); }} style={{cursor:"pointer",flex:1,display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:12,color:"var(--acc-purple)",fontWeight:"bold"}}>{item.name}</span>
                  <span style={{fontSize:10,color:"var(--text-muted)"}}>{item.date}</span>
                </div>
                <button onClick={(e) => {
                  e.stopPropagation();
                  setHistory(prev => {
                     const n = prev.filter(x => x.id !== item.id);
                     saveStrategies(n);
                     if (result && result === item.data) setResult(null); // Clear view if we delete active
                     return n;
                  });
                }} style={{background:"none",border:"none",color:"var(--acc-orange)",cursor:"pointer",fontSize:16,padding:"8px 12px"}} title="Elimina Strategia">🗑️</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {result && typeof result === "object" && result._error && (
        <ResultBox text={`Errore:\n${result._error}`} color="var(--acc-red)"/>
      )}
      {result && typeof result === "object" && !result._error && (
        <div style={{marginTop: 18}}>
          <div id="strategy-result-top" />
          {result.pianoEditoriale && <CollapsibleSection title="📋 PIANO EDITORIALE 7 GIORNI" color="var(--acc-purple)" defaultOpen={true}><PianoEditoriale text={safeStr(result.pianoEditoriale)} onOptimize={onOptimizeDay}/></CollapsibleSection>}
          {result.strutturaVideo && <CollapsibleSection title="🎬 STRUTTURA VIDEO" color="var(--acc-purple)" defaultOpen={false}>{safeStr(result.strutturaVideo)}</CollapsibleSection>}
          {result.analisiComune && <CollapsibleSection title="🔍 ANALISI COMUNE" color="var(--acc-purple)" defaultOpen={false}>{safeStr(result.analisiComune)}</CollapsibleSection>}
          {result.strategiaDifferenziante && <CollapsibleSection title="🎬 STRATEGIA DIFFERENZIANTE E GAP" color="var(--acc-purple)" defaultOpen={false}>{safeStr(result.strategiaDifferenziante)}</CollapsibleSection>}
          {result.kpiPrincipali && <CollapsibleSection title="📈 KPI PRINCIPALI" color="var(--acc-purple)" defaultOpen={false}>{safeStr(result.kpiPrincipali)}</CollapsibleSection>}
          {result.ctaStrategy && <CollapsibleSection title="🤝 CTA STRATEGY" color="var(--acc-purple)" defaultOpen={false}>{safeStr(result.ctaStrategy)}</CollapsibleSection>}
        </div>
      )}
      {result && typeof result === "string" && (
        <ResultBox text={result} color="var(--acc-purple)"/>
      )}
      <DebugPanel info={debugInfo} rawText={rawText} />
    </div>
  );
}


// ─── COMPETITORS ──────────────────────────────────────────────────
function ScoreBadge({score}) {
  const n=Number(score)||0;
  const c=n>=8?"var(--acc-green)":n>=6?"var(--acc-orange)":"var(--acc-red)";
  return <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:36,height:36,borderRadius:"50%",background:`${c}18`,border:`2px solid ${c}`,color:c,fontWeight:700,fontSize:13,fontFamily:"monospace",flexShrink:0}}>{n}</div>;
}

function VideoCard({video,onDelete}) {
  const [open,setOpen]=useState(false);
  return (
    <div style={{background:"var(--bg-input)",border:"1px solid var(--border)",borderRadius:8,padding:12,marginBottom:8}}>
      <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
        <ScoreBadge score={video.score}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{color:"var(--text-main)",fontSize:13,fontWeight:600,marginBottom:4,lineHeight:1.4}}>{video.title}</div>
          {video.tags?.length>0&&(
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>
              {video.tags.slice(0,3).map((t,i)=><span key={i} style={{fontSize:10,color:"var(--acc-blue)",background:"rgba(var(--acc-blue-rgb), 0.09)",padding:"2px 6px",borderRadius:4,fontFamily:"monospace"}}>{t}</span>)}
            </div>
          )}
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            {video.url&&video.url.startsWith("http")&&(
              <a href={video.url} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:"var(--acc-blue)",textDecoration:"none",fontFamily:"monospace"}}>🔗 Apri video</a>
            )}
            {video.analysis&&<button onClick={()=>setOpen(!open)} style={{background:"none",border:"none",color:"var(--text-muted)",fontSize:11,cursor:"pointer",fontFamily:"monospace",padding:0}}>{open?"▲ meno":"▼ analisi"}</button>}
            <button onClick={()=>onDelete(video.url||video.title)} style={{background:"none",border:"none",color:"var(--border-focus)",fontSize:14,cursor:"pointer",marginLeft:"auto"}}>✕</button>
          </div>
          {open&&video.analysis&&<div style={{marginTop:8,padding:"8px 10px",background:"var(--bg-panel)",borderRadius:6,fontSize:12,color:"var(--text-muted)",lineHeight:1.6,fontFamily:"monospace"}}>{video.analysis}</div>}
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
    <div style={{background:"var(--bg-panel)",border:"1px solid var(--border)",borderRadius:10,padding:14,marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:20}}>{icon}</span>
          <div>
            <div style={{color:"var(--text-main)",fontWeight:600,fontSize:14}}>{comp.handle}</div>
            <div style={{color:"var(--text-muted)",fontSize:11,fontFamily:"monospace"}}>{comp.platform}</div>
            {comp.searchKeywords?.trim() && <div style={{color:"var(--border-focus)",fontSize:10,fontFamily:"monospace"}}>Keywords: {comp.searchKeywords}</div>}
          </div>
        </div>
        <button onClick={()=>onDelete(comp.id)} style={{background:"none",border:"none",color:"var(--border-focus)",cursor:"pointer",fontSize:18,padding:"2px 8px"}}>✕</button>
      </div>
      {comp.lastScan&&<div style={{fontSize:10,color:"var(--text-muted)",fontFamily:"monospace",marginBottom:10}}>{comp.videos?.length||0} video · scansione {new Date(comp.lastScan).toLocaleDateString("it-IT")}</div>}
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <Btn onClick={()=>onScan(comp)} loading={scanning===comp.id} color="var(--acc-blue)" small>
          {scanning===comp.id?"🔍 Ricerca…":"🔍 Scansiona"}
        </Btn>
        {comp.lastScan && (
          <>
            <Btn onClick={()=>onView(comp)} color="var(--acc-green)" small>📖 Apri</Btn>
            <Btn onClick={()=>onToggleStrategy(comp)} color="var(--acc-purple)" small>
              {isSelected ? "✅ In Strategia" : "➕ Aggiungi a Strategia"}
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}

function Competitors({selectedAccounts=[], onAddAccount, onRemoveAccount, onGoToStrategy, onGoToExplorer, pendingScan, clearPendingScan}) {
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

  useEffect(() => {
    if (pendingScan && storageReady) {
       const doScan = async () => {
         const clean=pendingScan.handle.replace(/^@/,"");
         const newComp = {id:Date.now().toString(),handle:"@"+clean,platform:pendingScan.platform,searchKeywords:"",addedAt:Date.now(),lastScan:null,videos:[]};
         const currentList = await loadCompetitors();
         let target = currentList.find(c => c.handle.toLowerCase() === newComp.handle.toLowerCase());
         if(!target) {
            target = newComp;
            await persist([...currentList, target]);
         }
         scanContent(target);
         clearPendingScan();
       };
       doScan();
    }
  }, [pendingScan, storageReady]);

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
    setTimeout(() => document.getElementById('competitor-result-top')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
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
      <div style={{background:"var(--bg-panel)",border:"1px solid var(--border)",borderRadius:10,padding:14,marginBottom:18}}>
        <div style={{fontSize:10,color:"var(--acc-blue)",letterSpacing:2,textTransform:"uppercase",marginBottom:12,fontFamily:"monospace"}}>+ Aggiungi Competitor</div>
        <div style={{marginBottom:10}}>
          <label style={{display:"block",marginBottom:5,fontSize:10,color:"var(--text-muted)",letterSpacing:2,textTransform:"uppercase"}}>Handle o URL profilo</label>
          <input value={handle} onChange={e=>setHandle(e.target.value)} placeholder="@beardedscara o URL" onKeyDown={e=>e.key==="Enter"&&addCompetitor()} style={{width:"100%",padding:"14px 16px",background:"var(--bg-input)",border:"1px solid var(--border)",borderRadius:8,color:"var(--text-main)",fontSize:16,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
        </div>
        <div style={{marginBottom:10}}>
          <label style={{display:"block",marginBottom:5,fontSize:10,color:"var(--text-muted)",letterSpacing:2,textTransform:"uppercase"}}>Parole chiave (opzionale)</label>
          <input value={searchKeywords} onChange={e=>setSearchKeywords(e.target.value)} placeholder="es. beard tips viaggio germany" style={{width:"100%",padding:"14px 16px",background:"var(--bg-input)",border:"1px solid var(--border)",borderRadius:8,color:"var(--text-main)",fontSize:16,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          <div style={{flex:1}}>
            <label style={{display:"block",marginBottom:5,fontSize:10,color:"var(--text-muted)",letterSpacing:2,textTransform:"uppercase"}}>Piattaforma</label>
            <select value={platform} onChange={e=>setPlatform(e.target.value)} style={{width:"100%",padding:"12px 14px",background:"var(--bg-input)",border:"1px solid var(--border)",borderRadius:8,color:"var(--text-main)",fontSize:16,outline:"none",fontFamily:"inherit"}}>
              <option>TikTok</option><option>Instagram</option>
            </select>
          </div>
        </div>
        <Btn onClick={addCompetitor} loading={false} color="var(--acc-blue)">🔍 Scansiona</Btn>
        <div style={{marginTop: 10, textAlign: "left"}}>
           <button onClick={()=>onGoToExplorer("creator")} style={{background:"none",border:"none",color:"var(--acc-blue)",textDecoration:"underline",fontSize:11,cursor:"pointer",fontFamily:"monospace"}}>Zero idee sui nomi? 🌍 Cerca nuovi Competitor in Explorer</button>
        </div>
      </div>

      {storageReady&&(
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:14,fontSize:11,color:"var(--text-muted)",fontFamily:"monospace"}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:"var(--acc-blue)",boxShadow:"0 0 6px var(--acc-blue)"}}/>
          {competitors.length} competitor salvati
        </div>
      )}

      {selectedAccounts.length>0&&(
        <div style={{marginBottom:14,border:"1px solid rgba(var(--acc-purple-rgb), 0.27)",borderRadius:10,padding:10,background:"var(--bg-panel)"}}>
          <div style={{fontSize:10,color:"var(--acc-purple)",letterSpacing:2,textTransform:"uppercase",fontFamily:"monospace",marginBottom:8}}>Account selezionati ({selectedAccounts.length})</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
            {selectedAccounts.map(a=>(
              <span key={a.handle} style={{display:"inline-flex",alignItems:"center",gap:8,fontSize:12,color:"var(--acc-purple)",background:"var(--bg-input-hover)",border:"1px solid rgba(var(--acc-purple-rgb), 0.2)",borderRadius:6,padding:"6px 12px",fontFamily:"monospace"}}>
                {a.handle}
                <button onClick={()=>onRemoveAccount(a.handle)} style={{background:"none",border:"none",color:"var(--text-muted)",cursor:"pointer",fontSize:16,padding:"4px",margin:"-4px -8px -4px 0",lineHeight:1}}>✕</button>
              </span>
            ))}
          </div>
          <Btn onClick={onGoToStrategy} color="var(--acc-purple)" small>🎬 Genera strategia dai competitor →</Btn>
        </div>
      )}

      {competitors.length===0?(
        <div style={{textAlign:"center",color:"var(--border-focus)",padding:"28px 0",fontFamily:"monospace",fontSize:13,lineHeight:1.8}}>
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
          <div id="competitor-result-top" />
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div style={{fontSize:13,color:"var(--acc-blue)",fontFamily:"monospace",fontWeight:600}}>🎬 {selectedComp.handle}</div>
            <div style={{fontSize:10,color:"var(--text-muted)",fontFamily:"monospace"}}>🟢≥8 🟡≥6 🔴&lt;6</div>
          </div>
          {selectedComp.searchKeywords?.trim() && (
            <div style={{fontSize:10,color:"var(--border-focus)",fontFamily:"monospace",marginBottom:10}}>
              + parole chiave: {selectedComp.searchKeywords}
            </div>
          )}

          {!scanning&&(
            <div style={{display:"flex",gap:6,marginBottom:12,overflowX:"auto"}}>
              {["video","profilo","competitor"].map(tab=>(
                <button key={tab} onClick={()=>setScanTab(tab)} style={{flexShrink:0,padding:"8px 12px",borderRadius:8,border:scanTab===tab?`1px solid rgba(var(--acc-blue-rgb), 0.4)`:"1px solid var(--border)",background:scanTab===tab?"var(--bg-input-hover)":"var(--bg-panel)",color:scanTab===tab?"var(--acc-blue)":"var(--text-muted)",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"monospace",textTransform:"uppercase"}}>
                  {tab==="video"?"Video":tab==="profilo"?"Analisi Profilo":"Competitor"}
                </button>
              ))}
            </div>
          )}

          {scanning===selectedComp.id&&(
            <div>
              <Spinner color="var(--acc-blue)" label="Ricerca in corso…"/>
              {scanLog.length>0&&(
                <div style={{marginTop:10,background:"#020508",border:"1px solid var(--border)",borderRadius:8,padding:10,maxHeight:160,overflowY:"auto"}}>
                  {scanLog.map((l,i)=>(
                    <div key={i} style={{fontSize:11,color:l.includes("✅")?"var(--acc-green)":l.includes("❌")?"var(--acc-red)":l.includes("⚠️")?"var(--acc-orange)":"var(--text-muted)",fontFamily:"monospace",lineHeight:1.6}}>{l}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!scanning&&scanTab==="video"&&selectedComp.videos?.length>0&&(
            selectedComp.videos.map((v,i)=><VideoCard key={i} video={v} onDelete={key=>deleteVideo(selectedComp.id,key)}/>)
          )}

          {!scanning&&scanTab==="video"&&selectedComp.videos?.length===0&&(
            <div style={{background:"var(--bg-panel)",border:"1px dashed var(--border)",borderRadius:8,padding:14,marginBottom:10}}>
              <div style={{color:"var(--text-muted)",fontFamily:"monospace",fontSize:12,marginBottom:10}}>
                Nessun video trovato automaticamente. Puoi incollare link o caption manualmente:
              </div>
              <button onClick={()=>setShowManual(!showManual)} style={{background:"none",border:"1px solid var(--border)",color:"var(--text-muted)",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:12,fontFamily:"monospace",marginBottom:10}}>
                {showManual?"▲ Nascondi":"📋 Incolla link / caption manualmente"}
              </button>
              {showManual&&(
                <>
                  <Textarea value={manualLinks} onChange={setManualLinks} placeholder={"Incolla link o caption dei video, uno per riga:\nhttps://tiktok.com/@.../video/123\noppure: 'Mangio solo proteine per 7 giorni - risultati shock'\n..."} rows={5}/>
                  <Btn onClick={()=>scoreManualLinks(selectedComp)} loading={scanning===selectedComp.id} color="var(--acc-blue)">⭐ Analizza e dai voto</Btn>
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
                  <CollapsibleSection key={id} title={label} icon={icon} color="var(--acc-purple)" defaultOpen={id==="overview"}>
                    {val || "N/D"}
                  </CollapsibleSection>
                ))}
              </div>
            ) : (
              profileResult
                ? <ResultBox text={profileResult} color="var(--acc-purple)"/>
                : <div style={{color:"var(--border-focus)",fontFamily:"monospace",fontSize:12}}>Nessuna analisi profilo disponibile. Esegui prima la scansione.</div>
            )
          )}

          {!scanning&&scanTab==="competitor"&&(
            similarItems.length>0 ? (
              <div>
                {similarResult&&<div style={{fontSize:10,color:"var(--text-muted)",fontFamily:"monospace",marginBottom:10}}>Query usate: {similarResult}</div>}
                {similarItems.map((it,i)=>{
                  return (
                    <CollapsibleSection key={`${it.handle}-${i}`} title={
                      <span style={{display:"flex",alignItems:"center",gap:8}}>
                        {it.handle}
                        <button onClick={e=>{e.stopPropagation(); handleScanSimilar(it);}} style={{background:"var(--bg-input-hover)",border:`1px solid rgba(var(--acc-blue-rgb), 0.4)`,color:"var(--acc-blue)",borderRadius:5,padding:"2px 7px",cursor:"pointer",fontSize:10,fontFamily:"monospace",lineHeight:1.4}}>
                          🔍 Scansiona
                        </button>
                      </span>
                    } icon="👤" color="var(--acc-orange)" defaultOpen={false}>
                      {it.profileUrl&&<a href={it.profileUrl} target="_blank" rel="noreferrer" style={{display:"inline-block",color:"var(--acc-green)",fontFamily:"monospace",fontSize:12,marginBottom:8,textDecoration:"none",fontWeight:700}}>{it.profileUrl}</a>}
                      {it.query&&<div style={{fontSize:10,color:"var(--text-muted)",fontFamily:"monospace",marginBottom:6}}>Query: {it.query}</div>}
                      {it.desc&&<div style={{color:"var(--text-muted)",lineHeight:1.6,fontSize:11}}>{it.desc}</div>}
                    </CollapsibleSection>
                  );
                })}
              </div>
            ) : (
              <div style={{color:"var(--border-focus)",fontFamily:"monospace",fontSize:12}}>Nessun risultato. Clicca "Trova simili" per cercare competitor simili.</div>
            )
          )}

          {/* Debug panel always shown after scan */}
          {!scanning&&(scanLog.length>0||rawResponse)&&(
            <DebugPanel info={scanLog.join("\n")} rawText={rawResponse}/>
          )}
        </div>
      )}

      {(analyzing||batchLoading||discovering)&&<Spinner color="var(--acc-purple)"/>}
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────
export default function App() {
  const [activeTab,setActiveTab]=useState("competitors");
  const [selectedAccounts,setSelectedAccounts]=useState([]);
  const [accountsLoaded,setAccountsLoaded]=useState(false);
  const [pendingScan, setPendingScan]=useState(null);
  const [explorerRequestedMode, setExplorerRequestedMode] = useState(null);
  const [optimizerInput, setOptimizerInput] = useState("");
  
  const handleGoToExplorer = (mode) => {
     setExplorerRequestedMode(mode);
     setActiveTab("explorer");
  };
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

  const [theme, setTheme] = useState(() => {
     return window.localStorage.getItem("viralos_theme") || "light";
  });

  useEffect(() => {
     document.documentElement.setAttribute("data-theme", theme);
     window.localStorage.setItem("viralos_theme", theme);
  }, [theme]);

  const toggleTheme = () => {
     setTheme(t => t === "light" ? "dark" : "light");
  };

  return (
    <div style={{minHeight:"100vh",background:"var(--bg-input)",fontFamily:"'Georgia','Times New Roman',serif",paddingBottom:60,backgroundImage:`radial-gradient(ellipse at 20% 50%,rgba(var(--acc-green-rgb), 0.03),transparent 50%),radial-gradient(ellipse at 80% 20%,rgba(var(--acc-purple-rgb), 0.03),transparent 50%)`}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}@keyframes slideIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:var(--bg-panel)}::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}select option{background:var(--bg-panel)}textarea::placeholder,input::placeholder{color:var(--border-focus)}`}</style>

      <div style={{padding:"22px 16px 18px",borderBottom:"1px solid var(--border)",background:"linear-gradient(180deg,var(--bg-panel),transparent)", position: "relative"}}>
        <button onClick={toggleTheme} style={{position:"absolute", top: 22, right: 16, background:"var(--bg-input-hover)", border:"1px solid var(--border)", borderRadius:"20px", padding:"6px 12px", cursor:"pointer", fontSize:16, boxShadow:"0 2px 10px rgba(0,0,0,0.1)", zIndex:10}}>
           {theme === "light" ? "🌙" : "☀️"}
        </button>
        <div style={{maxWidth:700,margin:"0 auto"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:"var(--acc-green)",animation:"pulse 2s ease-in-out infinite",boxShadow:"0 0 12px var(--acc-green)"}}/>
            <span style={{fontSize:10,color:"var(--acc-green)",letterSpacing:3,textTransform:"uppercase",fontFamily:"monospace"}}>Content Intelligence System</span>
          </div>
          <h1 style={{fontSize:26,fontWeight:700,color:"var(--text-main)",margin:0,fontFamily:"'Georgia',serif"}}>ViralOS</h1>
          <p style={{color:"var(--text-muted)",fontSize:12,margin:"4px 0 0",fontFamily:"monospace"}}>Il tuo co-pilota AI per contenuti che esplodono</p>
        </div>
      </div>

      <div style={{maxWidth:700,margin:"0 auto",padding:"0 12px"}}>
        <div style={{display:"flex",gap:6,marginTop:16,marginBottom:18,overflowX:"auto",paddingBottom:4}}>
          {TABS.map(tab=>{
            const isActive=activeTab===tab.id; const color=TAB_COLORS[tab.id];
            return <button key={tab.id} onClick={()=>setActiveTab(tab.id)} style={{flexShrink:0,padding:"12px 18px",borderRadius:12,border:isActive?`1px solid rgba(var(${color.slice(4,-1)}-rgb), 0.4)`:"1px solid var(--border)",background:isActive?`linear-gradient(135deg,rgba(var(${color.slice(4,-1)}-rgb), 0.1),rgba(var(${color.slice(4,-1)}-rgb), 0.05))`:"var(--bg-panel)",color:isActive?color:"var(--text-muted)",fontSize:14,fontWeight:600,cursor:"pointer",transition:"all .2s",fontFamily:"monospace",display:"flex",alignItems:"center",gap:8,whiteSpace:"nowrap"}}>
              <span style={{fontSize:20}}>{tab.icon}</span><span>{tab.label}</span>
            </button>;
          })}
        </div>
        <div style={{background:"linear-gradient(135deg,var(--bg-panel),var(--bg-input-hover))",...glow(activeColor),borderRadius:14,padding:"18px 14px",animation:"slideIn .25s ease-out"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:18}}>
            <span style={{fontSize:18}}>{TABS.find(t=>t.id===activeTab)?.icon}</span>
            <h2 style={{margin:0,fontSize:17,color:activeColor,fontFamily:"monospace",letterSpacing:.5}}>{TABS.find(t=>t.id===activeTab)?.label}</h2>
          </div>
          <div style={{display:activeTab==="competitors"?"block":"none"}}><Competitors selectedAccounts={selectedAccounts} onAddAccount={addAccount} onRemoveAccount={removeAccount} onGoToStrategy={()=>setActiveTab("strategy")} onGoToExplorer={handleGoToExplorer} pendingScan={pendingScan} clearPendingScan={()=>setPendingScan(null)}/></div>
          <div style={{display:activeTab==="strategy"?"block":"none"}}><VideoStrategy selectedAccounts={selectedAccounts} onClearAccounts={clearAccounts} onGoToExplorer={handleGoToExplorer} onOptimizeDay={day=>{setOptimizerInput(day);setActiveTab("optimizer");}}/></div>
          <div style={{display:activeTab==="optimizer"?"block":"none"}}><Optimizer initialInput={optimizerInput} onClearInput={()=>setOptimizerInput("")}/></div>
          <div style={{display:activeTab==="explorer"?"block":"none"}}><Explorer requestedMode={explorerRequestedMode} clearRequestedMode={()=>setExplorerRequestedMode(null)} onGoToScan={(h, p)=> { setPendingScan({handle:h, platform:p}); setActiveTab("competitors"); }}/></div>
        </div>
        <p style={{textAlign:"center",color:"var(--border)",fontSize:10,marginTop:16,fontFamily:"monospace"}}>Powered by Gemini AI · Dati salvati in modo persistente</p>
      </div>
    </div>
  );
}
