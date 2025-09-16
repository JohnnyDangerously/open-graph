let BASE = (localStorage.getItem('API_BASE_URL') || 'http://localhost:8001').replace(/\/+$/,'')
export const setApiBase = (u:string) => { BASE = u.replace(/\/+$/,''); try{ localStorage.setItem('API_BASE_URL', BASE) }catch{} }
export const getApiBase = () => BASE

async function asJSON(r: Response){
  const ct = r.headers.get('content-type') || ''
  const txt = await r.text()
  if (!ct.includes('application/json')) throw new Error(`Expected JSON at ${r.url}; got ${ct}: ${ct}\n${txt.slice(0,120)}`)
  return JSON.parse(txt)
}

export async function healthz(){ return asJSON(await fetch(`${BASE}/healthz`, { mode:'cors' })) }

export async function resolvePerson(q: string){
  const r = await fetch(`${BASE}/resolve/person?q=${encodeURIComponent(q)}`)
  if (!r.ok) return null
  const j = await asJSON(r)
  if (j.id && String(j.id).startsWith('person:')) return j.id as string
  if (j.person_id) return `person:${j.person_id}`
  return null
}
export async function resolveCompany(q: string){
  const r = await fetch(`${BASE}/resolve/company?q=${encodeURIComponent(q)}`)
  if (!r.ok) return null
  const j = await asJSON(r)
  if (j.id && String(j.id).startsWith('company:')) return j.id as string
  if (j.company_id) return `company:${j.company_id}`
  return null
}

export async function fetchEgoJSON(id: string, limit=1500){
  const isCo = id.startsWith('company:')
  const key = id.replace(/^company:|^person:/,'')
  const param = isCo ? 'company_id' : 'person_id'
  const r = await fetch(`${BASE}/graph/ego?${param}=${encodeURIComponent(key)}&limit=${limit}&format=json`)
  if (!r.ok) throw new Error(`ego json ${r.status}`)
  return asJSON(r)
}
export async function fetchEgoBinary(id: string, limit=1500){
  const isCo = id.startsWith('company:')
  const key = id.replace(/^company:|^person:/,'')
  const param = isCo ? 'company_id' : 'person_id'
  const r = await fetch(`${BASE}/graph/ego?${param}=${encodeURIComponent(key)}&limit=${limit}&format=binary`)
  if (!r.ok) throw new Error(`ego bin ${r.status}`)
  return r.arrayBuffer()
}
