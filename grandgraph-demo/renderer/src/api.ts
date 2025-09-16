// Configurable API base/bearer with localStorage persistence
let API_BASE = (window as any).REMOTE_API_BASE || localStorage.getItem('API_BASE') || "http://34.192.99.41";
let BEARER = (window as any).REMOTE_API_BEARER || localStorage.getItem('API_BEARER') || "";

export function setApiConfig(base: string, bearer: string){
  if (base) API_BASE = base;
  BEARER = bearer || "";
  try { localStorage.setItem('API_BASE', API_BASE); localStorage.setItem('API_BEARER', BEARER); } catch {}
}

export async function fetchEgoBinary(personId: string, variant = "all", limit = 1500) {
  const url = `${API_BASE}/graph/ego?person_id=${encodeURIComponent(personId)}&variant=${variant}&limit=${limit}`;
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 6000);
  const res = await fetch(url, { headers: BEARER ? { Authorization: `Bearer ${BEARER}` } : {}, signal: controller.signal as any }).catch((e)=>{ throw new Error(`network error: ${e?.message||e}`) });
  clearTimeout(to);
  if (!res.ok) throw new Error(`fetch failed ${res.status}`);
  const buf = await res.arrayBuffer();
  return buf;
}

export async function resolveLinkedIn(urlOrVanity: string): Promise<string | null> {
  const s = urlOrVanity.trim();
  if (!s) return null;
  const url = `${API_BASE}/resolve?linkedin_url=${encodeURIComponent(s)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json().catch(()=>null as any);
  return json?.person_id ?? null;
}

export async function fetchEgoJSON(personId: string, variant = "all", limit = 1500) {
  const url = `${API_BASE}/graph/ego?person_id=${encodeURIComponent(personId)}&variant=${variant}&limit=${limit}&format=json`;
  const res = await fetch(url, { headers: BEARER ? { Authorization: `Bearer ${BEARER}` } : {} });
  if (!res.ok) throw new Error(`fetch failed ${res.status}`);
  return res.json();
}


