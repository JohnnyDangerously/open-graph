## Data, Schema, Rationale, and Usage Guide

This document summarizes the current production data layout, ClickHouse schemas and types, the rationale behind the design, and how to query and extend it.

---

## 1) Where the data lives

- S3 (cold storage, Parquet)
  - Bucket: `s3://connectvia-lab/`
  - Primary prefixes of interest:
    - `parquet/gold/persons_mt/` (canonical people records)
    - `parquet/companies_mt/` (company metadata; alternate gold lives under `parquet/gold/companies_mt/`)
    - `parquet/stints_compact/` (planned; denormalized employment spans)

- ClickHouse (hot serving, production DB)
  - Database: `via_cluster`
  - Current tables:
    - `companies_mt` (existing, large)
    - `person_profile_current` (serving snapshot for fast enrichment)
  - Example server IPs:
    - Public: see EC2 metadata; example during setup was `34.236.80.1`
    - Private: VPC IP; example during setup was `10.0.1.227`

---

## 2) Production schemas and types

### 2.1 companies_mt (existing)
Minimum columns you can expect (names may vary slightly by upstream):

```sql
-- via_cluster.companies_mt (existing large table)
company_id      UInt64,
name            String,
domain          String,
-- optional extras (industry, employee_count, country, location, ...)
```

Row count example: ~229,691,344 rows (≈4.83 GiB on disk).

### 2.2 person_profile_current (serving snapshot)
One row per person for instant UI enrichment (names + current role/company when available). Until job/stints data is loaded, `current_*` will be NULL.

```sql
CREATE TABLE IF NOT EXISTS via_cluster.person_profile_current
(
  person_id            UInt64,
  name                 LowCardinality(String),
  linkedin             LowCardinality(String),
  current_company_id   Nullable(UInt64),
  current_company_name LowCardinality(Nullable(String)),
  current_title        LowCardinality(Nullable(String)),
  current_started_at   Nullable(Date)
)
ENGINE = MergeTree
ORDER BY person_id;
```

Row count example: ~21,306,149 rows (≈925.76 MiB on disk) loaded from S3 `gold/persons_mt`.

### 2.3 stints_compact (planned)
Denormalized employment spans for full work history, overlaps, and path-style queries. Will be added later.

```sql
-- Proposed minimal shape when ingested locally
person_id  UInt64,
company_id UInt64,
start_date Date,
end_date   Nullable(Date),
title_norm String,
seniority  UInt8,
location   String
-- ENGINE = MergeTree
-- PARTITION BY toUInt8(cityHash64(person_id) % 64)
-- ORDER BY (person_id, start_date)
```

Until this exists locally, you can query Parquet in S3 via ClickHouse’s S3 engine/table function for occasional drill-downs.

---

## 3) Why this design

- Performance and UX: Fast, predictable enrichment for 5k-node graphs and browsing. `person_profile_current` lets the UI get names/title/company immediately without scanning raw Parquet.
- Cost control: Keep raw, wide data in S3; ingest only thin, query-ready slices into ClickHouse. This avoids loading every attribute/PII field.
- Composability: When `stints_compact` is added, you get full work histories and overlap analysis without changing the serving snapshot.
- Safety: Use `UInt64 person_id` as the canonical join key everywhere. If later we add bitmap cohort analytics, we can also carry a `pid32 UInt32` for fast set math, while preserving `person_id` for exact joins.

---

## 4) How to use it (queries)

### 4.1 Explore databases and tables
```sql
SHOW DATABASES;
SHOW TABLES FROM via_cluster;

-- Table sizes
SELECT database, table, sum(rows) AS rows,
       formatReadableSize(sum(bytes_on_disk)) AS size
FROM system.parts
WHERE active = 1 AND database = 'via_cluster'
GROUP BY database, table
ORDER BY rows DESC;
```

### 4.2 Enrich a batch of person IDs (names + linkedin)
```sql
-- Option A: simple list filter
SELECT person_id, name, linkedin
FROM via_cluster.person_profile_current
WHERE person_id IN (123, 456, 789);

-- Option B: from a temp table (best for large lists)
CREATE TEMPORARY TABLE ids (person_id UInt64) ENGINE = Memory;
INSERT INTO ids VALUES (123), (456), (789);
SELECT p.person_id, p.name, p.linkedin
FROM ids
LEFT JOIN via_cluster.person_profile_current AS p USING (person_id);
```

### 4.3 Search (MVP contains search)
If you enable the optional search table, you can do token/contains queries:
```sql
-- Optional table (to add): via_cluster.search_people
-- Columns: person_id UInt64, name String, title String, company String
-- Index:   tokenbf_v1 on (name, title, company)

SELECT person_id, name, title, company
FROM via_cluster.search_people
WHERE name ILIKE '%susan%'
   OR title ILIKE '%engineer%'
   OR company ILIKE '%hub%'
SETTINGS allow_experimental_analyzer = 1;
```

### 4.4 Full work history for a person (when stints are added)
```sql
SELECT s.person_id,
       anyOrNull(c.name) AS company_name,
       s.start_date, s.end_date, s.title_norm, s.seniority, s.location
FROM via_cluster.stints_compact AS s
LEFT JOIN via_cluster.companies_mt AS c USING (company_id)
WHERE s.person_id = {person_id:UInt64}
ORDER BY s.start_date DESC;
```

### 4.5 Query Parquet in-place (occasional drill-down)
```sql
-- Read Parquet directly from S3 without ingest (requires ClickHouse S3 access)
SELECT person_id, name, linkedin
FROM s3('https://s3.us-east-1.amazonaws.com/connectvia-lab/parquet/gold/persons_mt/run_id=*/**/*.parquet', 'Parquet')
LIMIT 10;
```

---

## 5) Operational notes

- S3 Access: ClickHouse needs S3 List/Get on `connectvia-lab/parquet/*`. We currently inject AWS creds into the clickhouse-server service; prefer using an instance role with least-privilege policy.
- Refresh: Re-run `INSERT INTO via_cluster.person_profile_current ... FROM s3(...)` to pick up new persons. For incremental patterns, use run_id filters.
- Monitoring: Track row counts and `system.parts` sizes post-refresh.

---

## 6) What comes next (optional layers)

- Current role enrichment: Populate `current_*` columns in `person_profile_current` once jobs/stints are available (rank the “best current role” per person).
- `person_recent3`: compact top-3 roles per person for richer tooltips.
- Cohort analytics: add bitmap-based tables (e.g., monthly start/last events) for fast unions/intersections and flows (A→B) if needed.

---

## 7) Quick checklist

- [x] `via_cluster.companies_mt` present (large, up to date)
- [x] `via_cluster.person_profile_current` loaded from `gold/persons_mt`
- [ ] `via_cluster.stints_compact` (planned)
- [ ] Optional: `search_people`, `person_recent3`


