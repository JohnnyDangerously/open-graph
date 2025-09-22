import React, { useEffect, useMemo, useState } from "react"
import { askNLQ } from "../lib/nlq"

function copyToClipboard(s: string) {
  try { navigator.clipboard.writeText(s) } catch {}
}

export default function NaturalLanguage(){
  const [q, setQ] = useState("")
  const [topK, setTopK] = useState(15)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string>("")
  const [data, setData] = useState<any | null>(null)
  const [copied, setCopied] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [nlqBase, setNlqBase] = useState(()=>{
    try { return localStorage.getItem("NLQ_BASE_URL") || "http://localhost:8099" } catch { return "http://localhost:8099" }
  })

  useEffect(()=>{
    try { const last = sessionStorage.getItem("NLQ_LAST_Q"); if (last) setQ(last) } catch {}
  },[])

  async function submit(){
    const trimmed = q.trim()
    if (!trimmed || loading) return
    try { sessionStorage.setItem("NLQ_LAST_Q", trimmed) } catch {}
    setLoading(true); setErr(""); setData(null)
    try {
      const res = await askNLQ(trimmed, Math.max(1, Math.min(50, topK)))
      setData(res)
    } catch(e:any){
      setErr(e?.message || "Request failed")
    } finally {
      setLoading(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>){
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault()
      submit()
    }
  }

  function saveBase(){
    try { localStorage.setItem("NLQ_BASE_URL", nlqBase.trim()) } catch {}
    setShowSettings(false)
  }

  const rowsPreview: any[] = useMemo(()=> (data?.rows || []).slice(0,5), [data])

  return (
    <div style={{ padding: 16, display: "grid", gap: 12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <h3 style={{ margin: 0 }}>Ask (Natural Language)</h3>
        <button onClick={()=>setShowSettings(s=>!s)} title="Settings">⚙️</button>
      </div>

      {showSettings && (
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <label>NLQ Base URL:</label>
          <input style={{ flex:1 }} value={nlqBase} onChange={e=>setNlqBase(e.target.value)} />
          <button onClick={saveBase}>Save</button>
        </div>
      )}

      <textarea
        value={q}
        onChange={e=>setQ(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask about companies, people, titles, locations…"
        rows={4}
        style={{ width:"100%", padding:8, fontFamily:"inherit" }}
      />
      <div style={{ display:"flex", gap:12, alignItems:"center" }}>
        <button onClick={submit} disabled={loading || !q.trim()}>
          {loading ? "Thinking…" : "Ask"}
        </button>
        <label>Top K:</label>
        <input
          type="number"
          min={1} max={50}
          value={topK}
          onChange={e=>setTopK(Math.max(1, Math.min(50, Number(e.target.value)||15)))}
          style={{ width: 72 }}
        />
        {err && <span style={{ color:"tomato" }}>{err}</span>}
      </div>

      {!q.trim() && !data && !loading && !err && (
        <div style={{ opacity:0.8 }}>Ask about companies, people, titles, locations…</div>
      )}

      {data?.answer && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Answer</div>
          <div>{data.answer}</div>
        </div>
      )}

      {data?.sql && (
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ fontWeight:600 }}>SQL</div>
            <button onClick={()=>{ copyToClipboard(data.sql); setCopied(true); setTimeout(()=>setCopied(false), 1200) }}>
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre style={{ background:"#1113", padding:8, borderRadius:6, overflow:"auto" }}>
            {data.sql}
          </pre>
        </div>
      )}

      {rowsPreview.length > 0 && (
        <div>
          <div style={{ fontWeight:600, marginBottom:6 }}>Preview (first {rowsPreview.length})</div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr>
                  {Object.keys(rowsPreview[0]).map(k=>(
                    <th key={k} style={{ textAlign:"left", borderBottom:"1px solid #444", padding:"4px 6px" }}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsPreview.map((row,i)=>(
                  <tr key={i}>
                    {Object.keys(rowsPreview[0]).map(k=>(
                      <td key={k} style={{ borderBottom:"1px solid #333", padding:"4px 6px" }}>
                        {String(row[k] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {Array.isArray(data?.followups) && data.followups.length > 0 && (
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {data.followups.map((f:string, idx:number)=>(
            <button
              key={idx}
              onClick={()=>{ setQ(f); setTimeout(submit, 0) }}
              style={{ padding:"6px 10px", borderRadius:999 }}
              title="Ask follow-up"
            >{f}</button>
          ))}
        </div>
      )}
    </div>
  )
}


