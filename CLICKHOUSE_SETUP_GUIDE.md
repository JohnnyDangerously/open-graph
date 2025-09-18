# ClickHouse Test Database Setup Guide

## Overview
This document provides a complete reference for the ClickHouse test database setup with fake data, including schemas, endpoints, and usage examples for development and testing.

## Database Configuration

### Connection Details
- **Host**: localhost
- **Native Port**: 9000 (for clickhouse-client)
- **HTTP Port**: 8123 (for REST API access)
- **Database**: `via_test`
- **Authentication**: Default user, no password (development setup)

### Connection Examples
```bash
# Command line client
clickhouse-client

# HTTP API
curl "http://localhost:8123/?query=SELECT count(*) FROM via_test.companies"

# Connection string format
clickhouse://default@localhost:9000/via_test
```

## Database Schema

### Companies Table (`via_test.companies`)
Core company reference data with 1,000 records.

```sql
CREATE TABLE via_test.companies (
    company_id String,                    -- Canonical company identifier
    company_id_64 UInt64,                -- Numeric ID for performance (derived from company_id)
    company_id_str Nullable(String),     -- Optional original string ID
    name String,                         -- Company name (non-null)
    domain Nullable(String),             -- Company domain (88% populated)
    linkedin Nullable(String),           -- LinkedIn company URL
    linkedin_numeric_id Nullable(Int64), -- LinkedIn numeric ID
    address Nullable(String),            -- Single-line street address
    country Nullable(String),            -- Country name
    location Nullable(String),           -- City/location
    industry Nullable(String),           -- Industry category (Tech, Finance, Healthcare, Retail, Education)
    employee_count Nullable(Int32),      -- Number of employees (10-10,000 range)
    type Nullable(String),               -- Company type (Private, Public, Nonprofit)
    founded_year Nullable(Int32),        -- Year founded (1950-2023 range)
    ticker Nullable(String),             -- Stock ticker symbol (30% populated)
    sic_codes Array(String),             -- SIC industry codes (1-3 codes per company)
    parent_id Nullable(UInt64),          -- Parent company ID (21% have parents)
    parent_id_str Nullable(String),      -- Parent company string ID
    parent_name Nullable(String),        -- Parent company name
    parent_domain Nullable(String),      -- Parent company domain
    parent_ticker Nullable(String),      -- Parent company ticker
    source_file Nullable(String),        -- Source file reference
    run_id Nullable(String),             -- ETL run identifier
    ingest_date Date,                    -- Date of data ingestion
    ingest_ts DateTime64(6, 'UTC')       -- Timestamp of data ingestion
) ENGINE = MergeTree()
ORDER BY company_id;
```

### Stints Table (`via_test.stints`)
Professional work history/stint data with 5,000 records across 1,803 unique persons.

```sql
CREATE TABLE via_test.stints (
    p UInt8,                             -- Partition key (0-63, derived from company_id_64 % 64)
    person_id UInt64,                    -- Numeric person identifier
    person_id_str Nullable(String),      -- String person identifier
    company_id UInt64,                   -- Links to companies.company_id_64
    company_id_str Nullable(String),     -- String company identifier
    original_company_id_str Nullable(String), -- Original company ID before normalization
    start_date Date,                     -- Stint start date (2000-2024 range)
    end_date Nullable(Date),             -- Stint end date (30% are open-ended/NULL)
    start_precision String,              -- Date precision: "day", "month", "year", "unknown"
    end_precision String,                -- End date precision (mostly "day" or "unknown")
    S Int32,                            -- Months since 1970 for start_date
    E Nullable(Int32),                  -- Months since 1970 for end_date (NULL for open-ended)
    months Nullable(Int32),             -- Duration in months (E - S + 1, NULL for open-ended)
    seniority_bucket Int8,              -- Seniority level (1-5 scale)
    link_scope String,                  -- Scope: "GLOBAL" or "PERSON"
    ingest_date Date,                   -- Date of data ingestion
    ingest_ts DateTime64(6, 'UTC')      -- Timestamp of data ingestion
) ENGINE = MergeTree()
PARTITION BY p
ORDER BY (company_id, person_id, start_date);
```

## Data Characteristics

### Volume Statistics
- **Companies**: 1,000 records (100% unique company_id)
- **Stints**: 5,000 records (1,803 unique persons, avg 2.8 stints per person)
- **Coverage**: 99.3% of companies have associated stints

### Data Quality Patterns
- **Domains**: 88.2% of companies have domain names
- **Parent Companies**: 21.5% of companies have parent relationships
- **Open Stints**: 30.4% of stints are currently active (end_date IS NULL)
- **Date Range**: Stints span from 2000-01-05 to 2024-12-28
- **Industries**: Balanced distribution across 5 major sectors

### Industry Distribution
| Industry   | Companies | Avg Employees | Stints | Unique People |
|------------|-----------|---------------|--------|---------------|
| Education  | 213       | 5,046         | 1,073  | 808           |
| Healthcare | 207       | 4,662         | 1,024  | 795           |
| Retail     | 197       | 5,018         | 966    | 767           |
| Tech       | 197       | 5,189         | 996    | 764           |
| Finance    | 186       | 5,105         | 941    | 745           |

## API Endpoints & Usage

### HTTP API Access
ClickHouse provides a REST API on port 8123 for web applications.

#### Basic Query Endpoint
```
GET http://localhost:8123/?query=<SQL_QUERY>
```

#### Example API Calls
```bash
# Get company count
curl "http://localhost:8123/?query=SELECT count(*) FROM via_test.companies"

# Get companies by industry (JSON format)
curl "http://localhost:8123/?query=SELECT name, domain, employee_count FROM via_test.companies WHERE industry='Tech' LIMIT 10&default_format=JSONEachRow"

# Get stint analytics
curl "http://localhost:8123/?query=SELECT industry, count(*) as stints FROM via_test.companies c JOIN via_test.stints s ON c.company_id_64=s.company_id GROUP BY industry&default_format=JSON"
```

#### Response Formats
- `TabSeparated` (default)
- `JSON` - Single JSON object with data/meta
- `JSONEachRow` - One JSON object per row
- `CSV` - Comma-separated values
- `Parquet` - Binary columnar format

### Common Query Patterns

#### Company Queries
```sql
-- Get all companies in tech industry
SELECT name, domain, employee_count, founded_year 
FROM via_test.companies 
WHERE industry = 'Tech' 
ORDER BY employee_count DESC;

-- Find companies with parent relationships
SELECT c.name as company, p.name as parent, c.employee_count
FROM via_test.companies c
JOIN via_test.companies p ON c.parent_id = p.company_id_64
ORDER BY c.employee_count DESC;

-- Company size distribution
SELECT 
    CASE 
        WHEN employee_count < 100 THEN 'Small'
        WHEN employee_count < 1000 THEN 'Medium' 
        ELSE 'Large' 
    END as size_category,
    count(*) as companies
FROM via_test.companies 
GROUP BY size_category;
```

#### Stint Analytics
```sql
-- Current employees by industry
SELECT 
    c.industry,
    count(*) as current_employees,
    avg(dateDiff('month', s.start_date, today())) as avg_tenure_months
FROM via_test.companies c
JOIN via_test.stints s ON c.company_id_64 = s.company_id
WHERE s.end_date IS NULL
GROUP BY c.industry
ORDER BY current_employees DESC;

-- Career mobility analysis
SELECT 
    person_id,
    count(*) as total_stints,
    count(DISTINCT company_id) as companies_worked,
    min(start_date) as career_start,
    max(coalesce(end_date, today())) as career_latest
FROM via_test.stints
GROUP BY person_id
HAVING total_stints > 3
ORDER BY total_stints DESC;

-- Stint duration patterns
SELECT 
    seniority_bucket,
    count(*) as stints,
    round(avg(months), 1) as avg_duration_months,
    countIf(end_date IS NULL) as currently_active
FROM via_test.stints
WHERE months IS NOT NULL
GROUP BY seniority_bucket
ORDER BY seniority_bucket;
```

#### Performance Queries
```sql
-- Partitioned query (efficient for large datasets)
SELECT count(*) 
FROM via_test.stints 
WHERE p IN (0, 1, 2, 3, 4);  -- Query specific partitions

-- Time-series analysis
SELECT 
    toYear(start_date) as year,
    count(*) as new_hires,
    count(DISTINCT company_id) as hiring_companies
FROM via_test.stints
WHERE start_date >= '2020-01-01'
GROUP BY year
ORDER BY year;
```

## Integration Examples

### Python Integration
```python
import requests
import json

# Query via HTTP API
def query_clickhouse(sql):
    response = requests.get(
        'http://localhost:8123/',
        params={'query': sql, 'default_format': 'JSONEachRow'}
    )
    return [json.loads(line) for line in response.text.strip().split('\n')]

# Example usage
companies = query_clickhouse("SELECT * FROM via_test.companies LIMIT 10")
print(f"Found {len(companies)} companies")
```

### JavaScript/Node.js Integration
```javascript
const axios = require('axios');

async function queryClickHouse(sql) {
    const response = await axios.get('http://localhost:8123/', {
        params: { 
            query: sql, 
            default_format: 'JSON' 
        }
    });
    return response.data.data;
}

// Example usage
queryClickHouse('SELECT industry, count(*) FROM via_test.companies GROUP BY industry')
    .then(data => console.log(data));
```

## Development Workflows

### Frontend Testing Scenarios
1. **Pagination**: Use `LIMIT` and `OFFSET` for data paging
2. **Filtering**: Filter by industry, company size, date ranges
3. **Search**: Use `LIKE` or `ILIKE` for name/domain searches
4. **Aggregations**: Industry analytics, employee counts, stint patterns
5. **Joins**: Company-stint relationships for detailed views

### Data Refresh
To regenerate test data with different parameters:
```bash
# Generate new dataset
python3 /home/ubuntu/via-infra/tools/fake_data_generator.py \
    --num-companies 2000 \
    --num-stints 10000 \
    --num-persons 4000 \
    --output-dir "/home/ubuntu/via-infra/tools/fake_data/large_test"

# Clear existing data
clickhouse-client --query "TRUNCATE TABLE via_test.companies"
clickhouse-client --query "TRUNCATE TABLE via_test.stints"

# Load new data
clickhouse-client --query "INSERT INTO via_test.companies FORMAT Parquet" < /path/to/new/fake_companies.parquet
clickhouse-client --query "INSERT INTO via_test.stints FORMAT Parquet" < /path/to/new/fake_stints.parquet
```

### Performance Optimization
- Use `PREWHERE` instead of `WHERE` for better performance
- Leverage partitioning: filter by `p` values for stint queries
- Use `SAMPLE` for quick data exploration on large datasets
- Consider materialized views for frequently accessed aggregations

## File Locations
- **Fake Data Generator**: `/home/ubuntu/via-infra/tools/fake_data_generator.py`
- **Generated Data**: `/home/ubuntu/via-infra/tools/fake_data/medium_test/`
- **ClickHouse Config**: `/etc/clickhouse-server/`
- **ClickHouse Logs**: `/var/log/clickhouse-server/`

## Troubleshooting

### Common Issues
1. **Connection Refused**: Check if service is running with `sudo systemctl status clickhouse-server`
2. **Permission Denied**: Ensure proper file permissions for Parquet files
3. **Memory Issues**: Monitor with `clickhouse-client --query "SHOW PROCESSLIST"`
4. **Slow Queries**: Use `EXPLAIN` to analyze query execution plans

### Useful Commands
```bash
# Check service status
sudo systemctl status clickhouse-server

# View recent logs
sudo tail -f /var/log/clickhouse-server/clickhouse-server.log

# Monitor active queries
clickhouse-client --query "SHOW PROCESSLIST"

# Check table sizes
clickhouse-client --query "
SELECT 
    table,
    formatReadableSize(sum(bytes)) as size,
    sum(rows) as rows
FROM system.parts 
WHERE database = 'via_test' 
GROUP BY table"
```

This setup provides a robust foundation for frontend development with realistic data patterns, efficient querying capabilities, and scalable architecture that mirrors production ETL outputs.
