export async function cacheResolve(q: string): Promise<string | null> {
  try {
    const res = await fetch('/cache/resolver.json');
    if (!res.ok) return null;
    const j = await res.json();
    const s = q.trim().toLowerCase();
    if (j.peopleByLinkedIn && j.peopleByLinkedIn[s]) return j.peopleByLinkedIn[s];
    if (j.peopleByName && j.peopleByName[s]) return j.peopleByName[s];
    if (j.companiesByName && j.companiesByName[s]) return j.companiesByName[s];
    return null;
  } catch {
    return null;
  }
}

export async function cacheTile(key: string): Promise<{ kind: 'binary', buf: ArrayBuffer } | { kind: 'json', json: any }> {
  const isCompany = key.startsWith('company:');
  const id = key.replace(/^company:|^person:/, '');
  const base = `/cache/${isCompany ? 'company' : 'person'}/${id}`;
  try {
    const r1 = await fetch(`${base}.bin`);
    if (r1.ok) return { kind: 'binary', buf: await r1.arrayBuffer() };
  } catch {}
  const r2 = await fetch(`${base}.json`).catch(() => null as any);
  if (r2 && r2.ok) return { kind: 'json', json: await r2.json() };
  throw new Error(`No cache tile for ${key}`);
}
