export type NLQResponse = {
  answers: Array<{ title: string; snippet?: string; personId?: string; companyId?: string }>
  raw?: any
  diagnostics?: any
}

export async function askNLQ(question: string, topK = 15): Promise<NLQResponse> {
  const baseRaw = (typeof localStorage !== 'undefined' ? (localStorage.getItem("NLQ_BASE_URL") || "http://localhost:8099") : "http://localhost:8099")
  const base = baseRaw.replace(/\/+$/,'')
  const body = { query: String(question || '').trim(), topK: Math.max(1, Math.min(50, topK|0)) }
  const r = await fetch(`${base}/api/nlq`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
  const text = await r.text()
  if (!r.ok) {
    let errMsg = 'NLQ request failed'
    try { const j = JSON.parse(text); errMsg = j?.error?.message || errMsg } catch {}
    throw new Error(`NLQ ${r.status}: ${errMsg}`)
  }
  return JSON.parse(text)
}


