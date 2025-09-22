import json
import os
import re
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from openai import OpenAI


class NLQRequest(BaseModel):
    question: str


class NLQResponse(BaseModel):
    answer: str


app = FastAPI(title="NLQ Service")

# Settings
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
MAX_LIMIT = int(os.getenv("NLQ_MAX_LIMIT", "50"))


class NLQReq(BaseModel):
    question: str
    top_k: Optional[int] = None


@app.post("/nlq")
async def nlq_endpoint(payload: NLQReq):
    """LLM-powered NLQ endpoint using tool-calling to produce safe SQL and results."""
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=400, detail="Missing OPENAI_API_KEY in environment.")

    question = payload.question.strip()
    top_k = payload.top_k if payload.top_k is not None else 5
    top_k = max(1, min(5, top_k))

    client = OpenAI()

    messages: List[Dict[str, Any]] = []
    messages.append({"role": "system", "content": SYSTEM_PROMPT})
    messages.extend(FEW_SHOT_MESSAGES)
    messages.append({"role": "user", "content": question})

    try:
        # First call: get tool call with SQL
        first = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
            temperature=0.2,
        )
        first_message = first.choices[0].message
        tool_calls = first_message.tool_calls or []
        if not tool_calls:
            raise HTTPException(status_code=400, detail="The model did not produce a SQL tool call.")

        tool_call = tool_calls[0]
        if not tool_call.function or tool_call.function.name != "run_sql":
            raise HTTPException(status_code=400, detail="Unexpected tool call.")

        try:
            args = json.loads(tool_call.function.arguments or "{}")
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Tool call arguments were not valid JSON.")

        sql_arg = (args.get("query") or "").strip()
        if not sql_arg:
            raise HTTPException(status_code=400, detail="Tool call missing 'query' argument.")

        # Sanitize/prepare and execute
        prepared_sql = _prepare_query(sql_arg)
        rows = await run_sql(prepared_sql)
        rows_preview = rows[:top_k]

        # Second call: provide tool output so model can summarize
        messages_with_tool: List[Dict[str, Any]] = []
        messages_with_tool.extend(messages)
        # Include assistant message with tool_calls to maintain chain
        messages_with_tool.append({
            "role": "assistant",
            "content": first_message.content or "",
            "tool_calls": [
                {
                    "id": tool_call.id,
                    "type": "function",
                    "function": {
                        "name": "run_sql",
                        "arguments": json.dumps({"query": sql_arg}),
                    },
                }
            ],
        })
        messages_with_tool.append({
            "role": "tool",
            "tool_call_id": tool_call.id,
            "name": "run_sql",
            "content": json.dumps({"rows": rows_preview}, ensure_ascii=False),
        })

        second = client.chat.completions.create(
            model=MODEL,
            messages=messages_with_tool,
            temperature=0.2,
        )
        final_message = second.choices[0].message
        final_answer = (final_message.content or "").strip()

        followups = _suggest_followups(question)

        return {
            "answer": final_answer,
            "sql": prepared_sql,
            "rows": rows_preview,
            "followups": followups,
            "confidence": 0.7,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"NLQ error: {str(exc)[:300]}") from exc


# Configuration
CLICKHOUSE_HTTP_BASE = os.getenv("CLICKHOUSE_HTTP_BASE", "http://localhost:8123").rstrip("/")


class RunSQLRequest(BaseModel):
    query: str


class RunSQLResponse(BaseModel):
    rows: List[Dict[str, Any]]


_DANGEROUS_KEYWORDS = re.compile(
    r"\b(insert|update|delete|drop|alter|system|set|kill|outfile|truncate|optimize)\b",
    flags=re.IGNORECASE,
)


def _prepare_query(raw_query: str) -> str:
    if not raw_query or not raw_query.strip():
        raise HTTPException(status_code=400, detail="Query must not be empty.")

    # Normalize: remove semicolons and trim whitespace
    query = raw_query.replace(";", " ").strip()

    # Must start with SELECT
    if not re.match(r"^\s*select\b", query, flags=re.IGNORECASE):
        raise HTTPException(status_code=400, detail="Only SELECT queries are allowed.")

    lower_query = query.lower()

    # Reject dangerous keywords
    if _DANGEROUS_KEYWORDS.search(lower_query):
        raise HTTPException(status_code=400, detail="Query contains disallowed keywords.")

    # Require referencing via_test.* for table access; allow constant selects without FROM/JOIN
    references_tables = bool(re.search(r"\b(from|join)\b", lower_query))
    if references_tables and "via_test." not in lower_query:
        raise HTTPException(status_code=400, detail="Queries must reference tables under the via_test. schema.")

    # Ensure LIMIT <= MAX_LIMIT
    def _limit_replacer(match: re.Match) -> str:
        value = match.group(1)
        try:
            num = int(value)
        except ValueError:
            # If not a simple integer, enforce LIMIT 50 by replacing whole clause below
            return f"LIMIT {MAX_LIMIT}"
        capped = min(num, MAX_LIMIT)
        return f"LIMIT {capped}"

    if re.search(r"\blimit\s+\d+\b", lower_query, flags=re.IGNORECASE):
        query = re.sub(r"\blimit\s+(\d+)\b", _limit_replacer, query, flags=re.IGNORECASE)
    else:
        query = f"{query} LIMIT {MAX_LIMIT}"

    # Ensure ending FORMAT JSONEachRow
    if re.search(r"\s+format\s+\w+\s*$", query, flags=re.IGNORECASE):
        query = re.sub(r"\s+format\s+\w+\s*$", " FORMAT JSONEachRow", query, flags=re.IGNORECASE)
    else:
        query = f"{query} FORMAT JSONEachRow"

    return query.strip()


async def run_sql(query: str) -> List[Dict[str, Any]]:
    prepared = _prepare_query(query)
    url = f"{CLICKHOUSE_HTTP_BASE}/"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, content=prepared.encode("utf-8"), headers={"Content-Type": "text/plain; charset=utf-8"})
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"ClickHouse error: {resp.text.strip()[:300]}")
        text = resp.text
        rows: List[Dict[str, Any]] = []
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise HTTPException(status_code=400, detail=f"Failed to parse ClickHouse response: {exc}") from exc
        return rows


@app.post("/run_sql", response_model=RunSQLResponse)
async def run_sql_endpoint(payload: RunSQLRequest) -> RunSQLResponse:
    rows = await run_sql(payload.query)
    return RunSQLResponse(rows=rows)


# -------------------------
# LLM Tooling Configuration
# -------------------------

TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "run_sql",
            "description": "Run a safe, read-only SQL query against ClickHouse. Returns JSON rows.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "A SELECT ... FROM via_test.* query with LIMIT and FORMAT JSONEachRow.",
                    }
                },
                "required": ["query"],
            },
        },
    }
]

SYSTEM_PROMPT = (
    "You are an expert data analyst helping query ClickHouse.\n"
    "Schema (only these tables):\n"
    "via_test.companies(company_id_64, name)\n"
    "via_test.stints(person_id_64, company_id_64, title, start_date, end_date, seniority_bucket, location?)\n"
    "via_test.persons_large(person_id_64, full_name, location?)\n\n"
    "Rules:\n"
    f"- Always use the run_sql tool to get answers; never invent results.\n"
    f"- SELECT-only; LIMIT <= {MAX_LIMIT}.\n"
    "- Prefer current stints first: (s.end_date IS NULL) DESC.\n"
    "- Fuzzy company match via positionCaseInsensitive(c.name, <q>) > 0 OR lower(c.name) LIKE.\n"
    "- Return concise answers and include 2-3 follow-up suggestions.\n"
)

FEW_SHOT_MESSAGES: List[Dict[str, str]] = [
    {
        "role": "user",
        "content": "Who do I know at Google in New York?",
    },
    {
        "role": "assistant",
        "content": (
            "I'll query current stints at a Google-matched company and filter by New York.\n"
            "Example SQL shape (ClickHouse):\n"
            f"SELECT p.full_name, s.title, c.name FROM via_test.stints s\n"
            "JOIN via_test.persons_large p ON p.person_id_64 = s.person_id_64\n"
            "JOIN via_test.companies c ON c.company_id_64 = s.company_id_64\n"
            "WHERE (s.end_date IS NULL) AND (positionCaseInsensitive(c.name, 'google') > 0 OR lower(c.name) LIKE '%google%') AND lower(p.location) LIKE '%new york%'\n"
            f"ORDER BY (s.end_date IS NULL) DESC\nLIMIT {MAX_LIMIT}\nFORMAT JSONEachRow"
        ),
    },
    {
        "role": "user",
        "content": "List directors at SpaceX.",
    },
    {
        "role": "assistant",
        "content": (
            "Directors at a SpaceX-matched company.\n"
            f"SELECT p.full_name, s.title, c.name FROM via_test.stints s\n"
            "JOIN via_test.persons_large p ON p.person_id_64 = s.person_id_64\n"
            "JOIN via_test.companies c ON c.company_id_64 = s.company_id_64\n"
            "WHERE lower(s.title) LIKE '%director%' AND (positionCaseInsensitive(c.name, 'spacex') > 0 OR lower(c.name) LIKE '%spacex%')\n"
            f"ORDER BY (s.end_date IS NULL) DESC\nLIMIT {MAX_LIMIT}\nFORMAT JSONEachRow"
        ),
    },
    {
        "role": "user",
        "content": "Count people by title at OpenAI.",
    },
    {
        "role": "assistant",
        "content": (
            "Counts grouped by title at an OpenAI-matched company.\n"
            f"SELECT s.title, count() AS cnt FROM via_test.stints s\n"
            "JOIN via_test.companies c ON c.company_id_64 = s.company_id_64\n"
            "WHERE (positionCaseInsensitive(c.name, 'openai') > 0 OR lower(c.name) LIKE '%openai%')\n"
            f"GROUP BY s.title\nORDER BY cnt DESC\nLIMIT {MAX_LIMIT}\nFORMAT JSONEachRow"
        ),
    },
]


def _suggest_followups(question: str) -> List[str]:
    base = "More details"
    if len(question) < 3:
        return [
            "Show top titles at the company",
            "Show recent joiners",
            "Show locations distribution",
        ]
    q = question.strip().rstrip("?.!")
    return [
        f"Break down results by title for: {q}",
        f"Show recent changes (new stints) related to: {q}",
        f"Show locations distribution for: {q}",
    ]


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8099, reload=True)


