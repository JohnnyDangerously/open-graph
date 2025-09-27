export type NlqIntent = 'bridges' | 'compare' | 'paths' | 'show' | 'migration' | 'unsupported'

export type NlqResult =
  | { intent: 'bridges', args: { left: string, right: string, limit?: number } }
  | { intent: 'compare', args: { left: string, right: string } }
  | { intent: 'paths', args: { S: string, company: string, icp?: string, k?: number, minRMT?: number } }
  | { intent: 'migration', args: { left: string, right: string, limit?: number, windowMonths?: number, since?: string, until?: string } }
  | { intent: 'show', args: { id: string } }
  | { intent: 'unsupported', reason?: string }

type ChatMessage = { role: 'system'|'user'; content: string }

function getOpenAiApiKey(): string | null {
  try { const k = localStorage.getItem('OPENAI_API_KEY'); if (k && k.trim()) return k.trim() } catch {}
  try { const env = (process as any)?.env?.OPENAI_API_KEY as string | undefined; if (env && env.trim()) return env.trim() } catch {}
  return null
}

export async function askNlq(question: string, opts?: { model?: string, systemPrompt?: string }): Promise<NlqResult> {
  const apiKey = getOpenAiApiKey()
  if (!apiKey) return { intent: 'unsupported', reason: 'OpenAI API key missing' }

  const model = opts?.model || 'gpt-4o-mini'
  const system: ChatMessage = {
    role: 'system',
    content: [
      'You are a query planner for a graph analysis app. Translate the user question into ONE allowed intent and return ONLY strict JSON.',
      'Allowed intents: bridges, compare, paths, migration, show. If not applicable: unsupported.',
      'Rules:',
      '- Entities MUST be canonical ids: person:<id> or company:<id> (numeric only). Do NOT guess from names.',
      '- For show: args: { id } with canonical id.',
      '- For bridges: args: { left, right, limit? } companies only.',
      '- For compare: args: { left, right } entities (person/company).',
      '- For paths: args: { S, company, icp?, k?, minRMT? } where S is person:<id> and company is company:<id>.',
      '- For migration: args: { left, right, limit?, windowMonths?, since?, until? } companies only.',
      'Respond ONLY with JSON and no extra text. Examples:',
      '{"intent":"bridges","args":{"left":"company:1","right":"company:2"}}',
      '{"intent":"unsupported","reason":"Needs canonical ids"}'
    ].join('\n')
  }
  const user: ChatMessage = { role: 'user', content: question }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [system, user],
        temperature: 0.1,
      })
    })
    if (!res.ok) {
      return { intent: 'unsupported', reason: `OpenAI error ${res.status}` }
    }
    const data = await res.json()
    const text: string = data?.choices?.[0]?.message?.content || ''
    const trimmed = (text || '').trim()
    const jsonStart = trimmed.indexOf('{')
    const jsonEnd = trimmed.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) return { intent: 'unsupported', reason: 'LLM did not return JSON' }
    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as NlqResult
    // Validate canonical ids strictly to avoid hallucinations
    const isPerson = (s:string)=> /^person:\d+$/i.test(s)
    const isCompany = (s:string)=> /^company:\d+$/i.test(s)
    const isId = (s:string)=> isPerson(s) || isCompany(s)
    if (parsed.intent === 'show') { if (!isId(parsed.args.id)) return { intent:'unsupported', reason:'id must be canonical' } }
    if (parsed.intent === 'compare') { if (!isId(parsed.args.left) || !isId(parsed.args.right)) return { intent:'unsupported', reason:'compare ids must be canonical' } }
    if (parsed.intent === 'bridges') { if (!isCompany(parsed.args.left) || !isCompany(parsed.args.right)) return { intent:'unsupported', reason:'bridges requires company:<id>' } }
    if (parsed.intent === 'paths') { if (!isPerson(parsed.args.S) || !isCompany(parsed.args.company)) return { intent:'unsupported', reason:'paths requires person:<id> and company:<id>' } }
    if (parsed.intent === 'migration') { if (!isCompany(parsed.args.left) || !isCompany(parsed.args.right)) return { intent:'unsupported', reason:'migration requires company:<id>' } }
    if (!parsed || typeof parsed.intent !== 'string') return { intent: 'unsupported', reason: 'Invalid JSON' }
    return parsed
  } catch (e: any) {
    return { intent: 'unsupported', reason: e?.message || 'request failed' }
  }
}


