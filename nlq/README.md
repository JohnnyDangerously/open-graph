NLQ Service (FastAPI)

A FastAPI service providing a Natural Language Query (NLQ) endpoint that uses tool-calling to generate and run safe SQL against ClickHouse.

Environment

Create a `.env` (see `.env.example`) with:

```
OPENAI_API_KEY=sk-***
CLICKHOUSE_HTTP_BASE=http://localhost:8123
OPENAI_MODEL=gpt-4o-mini
NLQ_MAX_LIMIT=50
```

Run locally

```bash
pip install -r requirements.txt
uvicorn app:app --reload --port 8099
```

API

- POST `/nlq`
  - Request body:
    ```json
    { "question": "Who do I know at Google?" }
    ```
  - Example (PowerShell caret continuations):
    ```bash
    curl -sS -X POST http://localhost:8099/nlq ^
      -H "Content-Type: application/json" ^
      -d "{\"question\":\"Who do I know at Google?\"}"
    ```

- POST `/run_sql`
  - Request body:
    ```json
    { "query": "SELECT 1 FORMAT JSONEachRow" }
    ```
  - Response body:
    ```json
    { "rows": [{"1": 1}] }
    ```

Notes

- The service enforces SELECT-only queries under `via_test.*`, caps LIMIT to `NLQ_MAX_LIMIT`, and requires/forces `FORMAT JSONEachRow`.

