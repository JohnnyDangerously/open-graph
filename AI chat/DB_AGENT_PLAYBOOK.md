# GrandGraph — Backend Data Contract and Ops Checklist (for Agent)

Purpose: Define exactly what the remote DuckDB and API must provide so the Electron demo renders fast and reliably.

## 1) Required Tables (DuckDB)

- employments
  - person_id UUID
  - company_id UUID or VARCHAR
  - Optional for overlap variant: S INT, L INT, E INT (month indices)

- people_linkedin_identifiers
  - person_id UUID
  - value VARCHAR  // LinkedIn vanity like "john-kalogerakis" (preferred) or full URL
  - is_primary BOOLEAN (optional)
  - status VARCHAR (optional)

## 2) Required Indexes (speed-critical)

- CREATE INDEX IF NOT EXISTS idx_emp_person ON employments(person_id);
- CREATE INDEX IF NOT EXISTS idx_emp_company ON employments(company_id);
- CREATE UNIQUE INDEX IF NOT EXISTS idx_li_value ON people_linkedin_identifiers(value);

Recommendation: store normalized vanity in `value` and index that. If URLs are stored, keep vanity too.

## 3) API Endpoints (FastAPI/Uvicorn)

- GET /graph/ego?person_id=<uuid>&limit=1500&variant=all
  - Response: application/octet-stream
  - Binary layout (little-endian):
    - Header (16 bytes): [int32 count, int32 dims=2, int32 groupOffset, int32 flagsOffset]
    - Payload: Float32Array xy (count*2), Uint16Array group (count), Uint8Array flags (count)
  - Budget: < 1.5s for limit<=1500
  - Coworker query used now:
```
WITH my AS (
  SELECT company_id FROM employments WHERE person_id = ?
), cand AS (
  SELECT e.person_id AS neighbor_id
  FROM employments e
  JOIN my USING (company_id)
  WHERE e.person_id <> ?
)
SELECT neighbor_id, COUNT(*) AS w
FROM cand
GROUP BY neighbor_id
ORDER BY w DESC
LIMIT 20000;
```

- GET /resolve?linkedin_url=<string>
  - Normalize: if contains "/in/", take segment after it and strip trailing '/'; else use as-is.
  - Queries (stop at first hit):
```
SELECT person_id FROM people_linkedin_identifiers WHERE value = ? LIMIT 1; -- vanity
SELECT person_id FROM people_linkedin_identifiers WHERE value = ? LIMIT 1; -- full URL fallback
```
  - Response: { "person_id": "<uuid>" } or { "person_id": null }
  - Budget: < 300ms

## 4) Data Normalization

- Prefer vanity in `people_linkedin_identifiers.value` (e.g., `john-kalogerakis`).
- person_id is UUID across tables.

## 5) Caps and Budgets

- Nodes per tile: <= 1500
- Edges (future): <= 8000
- Endpoint budgets: resolve <300ms, ego <1.5s (p95)

## 6) Optional overlap variant (later)

Requires S/L/E columns; keep return format identical. Maintain caps.

## 7) Networking

- Service runs on port 80 (uvicorn under systemd). Demo disables CORS.

## 8) Health/Smoke

- Resolve:
```
curl -s "http://<HOST>/resolve?linkedin_url=john-kalogerakis"
```
- Ego:
```
curl -s "http://<HOST>/graph/ego?person_id=<uuid>&limit=5" -o /dev/null -w "%{http_code}\n"
```

## 9) Pitfalls to avoid

- DuckDB "No open result set": always `.fetchone()` on the same `.execute()`; do not reuse a pending result.
- Only storing full URLs in resolver: keep vanity form indexed.
- Missing employments indexes → multi-second queries.

## 10) Rollout

1) Ensure indexes (Section 2)
2) Confirm tables (Section 1)
3) Restart API (`via-graph.service`)
4) Smoke test (Section 8)

## 11) Future

- JSON fallback (`format=json`)
- Flags semantics (email-only bit) and server-side filters
- Precomputed layouts cache for hot IDs (<500ms)

Owner: Backend agent
Status: Live
