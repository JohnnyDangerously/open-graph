# Fake Data Specification

## Overview

This document describes the synthetic dataset generated for testing and development of the professional network analysis system. The fake data is designed to mirror production schemas while providing realistic overlaps, clusters, and career patterns for comprehensive testing.

## Data Generation

### Generator Location
- **Script**: `tools/enhanced_fake_data_generator.py`
- **Output Directory**: `tools/fake_data/large_scale/`
- **Database**: `via_test` (ClickHouse)

### Generation Parameters (Current Dataset)
```bash
python3 tools/enhanced_fake_data_generator.py \
  --num-persons 1000000 \
  --num-companies 50000 \
  --output-dir tools/fake_data/large_scale \
  --seed 43 \
  --partition-stints \
  --bridge-person-rate 0.4 \
  --transfer-wave-pairs 20 \
  --transfer-wave-size 1000 \
  --min-career-years 12 \
  --current-rate 0.35 \
  --num-anchors 40 \
  --enforce-unique-domains
```

## Dataset Characteristics

### Scale
- **Persons**: 1,000,000 individuals
- **Companies**: 50,000 organizations
- **Stints**: ~3,000,000 employment records
- **Bridge People**: 40% of persons have multi-company careers
- **Anchor Companies**: 40 major companies with high employee counts

### Realistic Features

#### 1. Career Patterns
- **Multi-Company Careers**: 40% of people work at multiple companies
- **Tenure Distribution**: 
  - 1 year: 30% of stints
  - 3 years: 25% of stints  
  - 5 years: 25% of stints
  - 10+ years: 20% of stints
- **Minimum Career Length**: 12 years cumulative experience
- **Current Employment**: 35% of people have current roles (NULL end_date)

#### 2. Company Structure
- **Anchor Companies**: 40 real-world company names (Google, Apple, Microsoft, etc.)
- **Employee Scaling**: Stint counts proportional to company size
- **Industry Tags**: Realistic industry classifications
- **Unique Domains**: All companies have unique, realistic domains
- **Size Distribution**: Mix of large (10k+ employees) and small (100-500) companies

#### 3. Network Overlaps
- **Transfer Waves**: 20 pairs of anchor companies with 1000+ people moving between them
- **Bridge Cohorts**: Groups of people connecting different companies
- **Super Connectors**: Individuals with extensive multi-company experience
- **Overlap Duration**: Minimum 24+ months for meaningful connections

#### 4. Seniority Levels
- **CEO**: C-level executives
- **VP**: Vice Presidents
- **Director**: Directors and Senior Directors  
- **Manager**: Managers and Senior Managers
- **IC**: Individual Contributors (Engineers, Analysts, etc.)
- **Intern**: Entry-level positions

## Schema Alignment

### Production Compatibility
The fake data schemas are designed to match production ETL schemas:

#### Core Tables
1. **persons_large** → mirrors `persons_mt`
2. **companies_large** → mirrors `companies_mt`  
3. **stints_large** → mirrors `stints` (jobs data)

#### Serving Layer Tables
1. **stints_compact** → optimized stint records
2. **person_profile_current** → current role snapshots
3. **person_recent3** → recent employment history
4. **companies_lite** → company metadata
5. **search_people** → search-optimized person data
6. **k_start_events** / **k_last_events** → roaring bitmap tables

### Key Differences from Production

#### 1. ID Strategy
- **Production**: Uses real LinkedIn person IDs and company identifiers
- **Fake Data**: Uses synthetic IDs with consistent hashing
  - `person_id_64`: UInt64 hash of synthetic person identifier
  - `pid32`: UInt32 for bitmap operations (cityHash64 → UInt32)
  - `company_id_64`: UInt64 hash of synthetic company identifier

#### 2. Data Sources
- **Production**: Real LinkedIn profiles, employment data, company information
- **Fake Data**: Faker-generated names, synthetic career paths, curated company list

#### 3. Scale Differences
- **Production**: 14.5B+ records across all tables
- **Fake Data**: ~4M total records (optimized for development/testing)

#### 4. Temporal Range
- **Production**: Historical data spanning decades
- **Fake Data**: Concentrated 2010-2024 timeframe

#### 5. Data Quality
- **Production**: Real-world inconsistencies, missing data, varying quality
- **Fake Data**: Consistent, clean data with controlled randomness

## Database Schema

### Core Tables

#### persons_large
```sql
CREATE TABLE via_test.persons_large
(
    person_id_64 UInt64,
    person_id_str String,
    name LowCardinality(String),
    linkedin LowCardinality(String),
    current_title LowCardinality(String),
    current_company_id UInt64,
    current_company_name LowCardinality(String),
    current_started_at Date,
    ingest_date Date,
    ingest_ts DateTime64(6, 'UTC')
)
ENGINE = MergeTree
ORDER BY person_id_64;
```

#### companies_large  
```sql
CREATE TABLE via_test.companies_large
(
    company_id_64 UInt64,
    company_id_str String,
    name String,
    domain String,
    industry LowCardinality(String),
    employee_count Int32,
    country LowCardinality(String),
    location String,
    ingest_date Date,
    ingest_ts DateTime64(6, 'UTC')
)
ENGINE = MergeTree
ORDER BY company_id_64;
```

#### stints_large
```sql
CREATE TABLE via_test.stints_large
(
    person_id UInt64,
    person_id_str String,
    company_id_str String,
    original_company_id_str String,
    start_date Date,
    end_date Date NULL,
    start_precision LowCardinality(String),
    end_precision LowCardinality(String),
    title LowCardinality(String),
    seniority_bucket Int8,
    link_scope LowCardinality(String),
    ingest_date Date,
    ingest_ts DateTime64(6, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_date)
ORDER BY (person_id, start_date);
```

### Serving Layer Tables

#### stints_compact (Optimized for Queries)
```sql
CREATE TABLE via_test.stints_compact
(
    p UInt8,                           -- Partition key
    company_id UInt64,                 -- Numeric company ID
    pid32 UInt32,                      -- 32-bit person ID for bitmaps
    person_id UInt64,                  -- 64-bit person ID
    person_id_str String,              -- Original person ID
    company_id_str String,             -- Original company ID
    original_company_id_str String,    -- Source company ID
    start_date Date,                   -- Employment start
    end_date Date NULL,                -- Employment end (NULL = current)
    start_precision LowCardinality(String),
    end_precision LowCardinality(String),
    S Int32,                           -- Start month (YYYYMM format)
    E Int32 NULL,                      -- End month (YYYYMM format)
    months Int32 NULL,                 -- Duration in months
    seniority_bucket Int8,             -- Seniority level (0-4)
    link_scope LowCardinality(String), -- GLOBAL or PERSON
    ingest_date Date,
    ingest_ts DateTime64(6, 'UTC')
)
ENGINE = MergeTree
PARTITION BY p
ORDER BY (company_id, S, pid32);
```

#### Roaring Bitmap Tables
```sql
-- Start events (when people join companies)
CREATE TABLE via_test.k_start_events
(
    p UInt8,
    company_id UInt64,
    month Int32,
    bm AggregateFunction(groupBitmap, UInt32)  -- Roaring bitmap
)
ENGINE = AggregatingMergeTree
PARTITION BY p
ORDER BY (company_id, month);

-- Last events (when people leave companies)  
CREATE TABLE via_test.k_last_events
(
    p UInt8,
    company_id UInt64,
    month Int32,
    bm AggregateFunction(groupBitmap, UInt32)  -- Roaring bitmap
)
ENGINE = AggregatingMergeTree
PARTITION BY p
ORDER BY (company_id, month);
```

## Usage Patterns

### 1. Basic Queries

#### Find All Employees at a Company
```sql
SELECT person_id, person_id_str, start_date, end_date, months
FROM via_test.stints_compact 
WHERE company_id = {company_id}
ORDER BY start_date DESC;
```

#### Current Employees Only
```sql
SELECT person_id, person_id_str, start_date
FROM via_test.stints_compact 
WHERE company_id = {company_id} AND end_date IS NULL;
```

#### Person's Career History
```sql
SELECT c.name, s.start_date, s.end_date, s.months
FROM via_test.stints_compact s
JOIN via_test.companies_lite c ON s.company_id = c.company_id
WHERE s.person_id = {person_id}
ORDER BY s.start_date DESC;
```

### 2. Network Analysis Queries

#### Company-to-Company Overlaps
```sql
SELECT 
    a.company_id AS company_a,
    b.company_id AS company_b,
    count() AS shared_people
FROM via_test.stints_compact a
JOIN via_test.stints_compact b ON a.pid32 = b.pid32
WHERE a.company_id != b.company_id
  AND a.company_id = {company_a_id}
  AND b.company_id = {company_b_id}
GROUP BY a.company_id, b.company_id;
```

#### Bridge People Between Companies
```sql
SELECT pid32, count() AS company_count
FROM via_test.stints_compact
WHERE company_id IN ({company_a}, {company_b})
GROUP BY pid32
HAVING company_count >= 2;
```

### 3. Roaring Bitmap Queries

#### Company Headcount by Month
```sql
SELECT 
    month,
    bitmapCardinality(groupBitmapMergeState(bm)) AS headcount
FROM via_test.k_start_events
WHERE company_id = {company_id}
GROUP BY month
ORDER BY month;
```

#### Intersection of Two Company Alumni
```sql
WITH 
company_a_people AS (
    SELECT groupBitmapMergeState(bm) AS bm_a
    FROM via_test.k_start_events 
    WHERE company_id = {company_a}
),
company_b_people AS (
    SELECT groupBitmapMergeState(bm) AS bm_b  
    FROM via_test.k_start_events
    WHERE company_id = {company_b}
)
SELECT bitmapCardinality(bitmapAnd(bm_a, bm_b)) AS shared_alumni
FROM company_a_people, company_b_people;
```

## Data Quality Metrics

### Current Dataset Statistics
- **Total Persons**: 1,000,000
- **Total Companies**: 50,000  
- **Total Stints**: ~3,000,000
- **Average Stints per Person**: ~3.0
- **Bridge People**: ~400,000 (40%)
- **Current Employees**: ~350,000 (35%)
- **Companies with 100+ employees**: ~5,000
- **Anchor Companies**: 40

### Validation Queries
```sql
-- Person count
SELECT count() FROM via_test.persons_large;

-- Company count  
SELECT count() FROM via_test.companies_large;

-- Stint count
SELECT count() FROM via_test.stints_large;

-- Bridge people count
SELECT count() FROM (
    SELECT person_id 
    FROM via_test.stints_large 
    GROUP BY person_id 
    HAVING uniq(company_id_str) > 1
);

-- Current employment rate
SELECT 
    countIf(end_date IS NULL) AS current_roles,
    count() AS total_stints,
    current_roles / total_stints AS current_rate
FROM via_test.stints_large;
```

## Performance Characteristics

### Query Performance Targets
- **Simple lookups**: <100ms
- **Company employee lists**: <500ms  
- **Network overlaps**: <2s
- **Bitmap operations**: <1s
- **Complex bridges**: <5s

### Optimization Features
- **Partitioning**: 64 partitions for parallel processing
- **Indexing**: Optimized ORDER BY clauses for common queries
- **LowCardinality**: Used for enum-like fields
- **Roaring Bitmaps**: Efficient set operations on large datasets
- **Materialized Views**: Pre-computed bitmap aggregations

## Integration Notes

### API Compatibility
The fake data is designed to work with existing API endpoints by:
1. Maintaining identical column names and types
2. Preserving foreign key relationships  
3. Supporting all production query patterns
4. Providing realistic data distributions

### Swapping to Production
To switch from fake to production data:
1. Update database connection to production ClickHouse
2. Change table names from `via_test.*` to production schema
3. Adjust for production ID formats and scales
4. No code changes required for query logic

### Testing Scenarios
The fake data supports testing of:
- **Graph visualization**: Dense networks with clear clusters
- **Search functionality**: Realistic names and titles
- **Performance**: Large-scale bitmap operations
- **Edge cases**: Various career patterns and company sizes
- **Network analysis**: Multi-hop connections and bridges

## Maintenance

### Regeneration
To regenerate the dataset with different parameters:
```bash
cd /home/ubuntu/via-infra
python3 tools/enhanced_fake_data_generator.py [options]
```

### Data Refresh
To update ClickHouse with new data:
1. Generate new Parquet files
2. Truncate existing tables
3. Load new data via INSERT FROM s3() or local files
4. Optimize bitmap tables with OPTIMIZE TABLE ... FINAL

### Monitoring
Key metrics to monitor:
- Row counts in all tables
- Bitmap table sizes and cardinalities  
- Query performance on common patterns
- Data freshness (ingest_date/ingest_ts)
