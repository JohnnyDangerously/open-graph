export type NLQResponse = {
  answer: string
  sql: string
  rows: any[]
  followups?: string[]
  confidence?: number
}

export async function askNLQ(question: string, topK = 15): Promise<NLQResponse> {
  const baseRaw = (typeof localStorage !== 'undefined' ? (localStorage.getItem("NLQ_BASE_URL") || "http://localhost:8099") : "http://localhost:8099")
  const base = baseRaw.replace(/\/+$/, "")
  const body = { question: String(question || '').trim(), top_k: Math.max(1, Math.min(50, topK|0)) }
  const r = await fetch(`${base}/nlq`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
  const text = await r.text()
  if (!r.ok) {
    const snippet = text.slice(0, 120).replace(/\s+/g, " ")
    throw new Error(`NLQ ${r.status}: ${snippet || "request failed"}`)
  }
  return JSON.parse(text)
}


