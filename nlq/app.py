import json
import os
import re
from typing import Any, Dict, List, Optional, Set, Tuple

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI


class NLQRequest(BaseModel):
    question: str


class NLQResponse(BaseModel):
    answer: str


app = FastAPI(title="NLQ Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Settings
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
MAX_LIMIT = int(os.getenv("NLQ_MAX_LIMIT", "50"))
DB_NAME = os.getenv("NLQ_DB_NAME", "via_test")


class NLQReq(BaseModel):
    question: str
    top_k: Optional[int] = None


class APINLQReq(BaseModel):
    query: str
    topK: Optional[int] = None
    filters: Optional[Dict[str, Optional[str]]] = None


class APINLQAnswer(BaseModel):
    title: str
    snippet: Optional[str] = None
    personId: Optional[str] = None
    companyId: Optional[str] = None


class APINLQResp(BaseModel):
    answers: List[APINLQAnswer]
    raw: Optional[Dict[str, Any]] = None
    diagnostics: Optional[Dict[str, Any]] = None


@app.post("/nlq")
async def nlq_endpoint(payload: NLQReq):
    """NLQ endpoint. Uses canned templates first; falls back to LLM tool-calling."""
    question = payload.question.strip()
    top_k = payload.top_k if payload.top_k is not None else 5
    top_k = max(1, min(5, top_k))

    import time
    t0 = time.perf_counter()
    row_count_for_log = 0
    mode = "deterministic"
    try:
        # 1) Canned deterministic templates
        canned = _try_canned(question)
        if canned is not None:
            canned_sql = canned["sql"]
            prepared_sql = _prepare_query(canned_sql)
            rows = await run_sql(prepared_sql)
            rows_preview = rows[:top_k]
            row_count_for_log = len(rows_preview)

            final_answer = _format_canned_answer(canned, rows)
            followups = _suggest_followups(question)

            result = {
                "answer": final_answer,
                "sql": prepared_sql,
                "rows": rows_preview,
                "followups": followups,
                "confidence": 0.9,
            }
            t_ms = int((time.perf_counter() - t0) * 1000)
            try:
                print(json.dumps({
                    "event": "nlq_query",
                    "mode": mode,
                    "question": question,
                    "sql": prepared_sql,
                    "row_count": row_count_for_log,
                    "latency_ms": t_ms,
                    "canned_kind": canned.get("kind"),
                }))
            except Exception:
                pass
            return result

        # 2) Fallback to LLM tool-calling
        if not OPENAI_API_KEY:
            raise HTTPException(status_code=400, detail="Missing OPENAI_API_KEY in environment.")
        mode = "llm"
    client = OpenAI()

    messages: List[Dict[str, Any]] = []
    messages.append({"role": "system", "content": SYSTEM_PROMPT})
    messages.extend(FEW_SHOT_MESSAGES)
    messages.append({"role": "user", "content": question})

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
        row_count_for_log = len(rows_preview)

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

        result = {
            "answer": final_answer,
            "sql": prepared_sql,
            "rows": rows_preview,
            "followups": followups,
            "confidence": 0.7,
        }
        t_ms = int((time.perf_counter() - t0) * 1000)
        try:
            print(json.dumps({
                "event": "nlq_query",
                "mode": mode,
                "question": question,
                "sql": prepared_sql,
                "row_count": row_count_for_log,
                "latency_ms": t_ms,
            }))
        except Exception:
            pass
        return result
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


# -------------------------
# Allowed schema cache
# -------------------------
ALLOWED_TABLES: Set[str] = {"companies", "stints", "persons_large"}
ALLOWED_SCHEMA: Dict[str, Set[str]] = {}


def _strip_string_literals(sql: str) -> str:
    # Remove single-quoted and double-quoted literal contents to avoid false positives
    return re.sub(r"('[^']*'|\"[^\"]*\")", "''", sql)


def _load_allowed_schema_rows_text() -> str:
    return (
        "SELECT table, name, type\n"
        "FROM system.columns\n"
        f"WHERE database = '{DB_NAME}'\n"
        "ORDER BY table, name\n"
        "FORMAT JSONEachRow"
    )


async def _load_allowed_schema() -> None:
    global ALLOWED_SCHEMA
    url = f"{CLICKHOUSE_HTTP_BASE}/"
    query_text = _load_allowed_schema_rows_text()
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, content=query_text.encode("utf-8"), headers={"Content-Type": "text/plain; charset=utf-8"})
    if resp.status_code != 200:
        raise RuntimeError(f"Failed to load schema from ClickHouse: {resp.text[:200]}")
    rows: List[Dict[str, Any]] = []
    for line in resp.text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    schema: Dict[str, Set[str]] = {}
    for r in rows:
        table = str(r.get("table", "")).strip()
        name = str(r.get("name", "")).strip()
        if not table or not name:
            continue
        if table not in ALLOWED_TABLES:
            continue
        tbl_l = table.lower()
        col_l = name.lower()
        schema.setdefault(tbl_l, set()).add(col_l)
    ALLOWED_SCHEMA = schema
    try:
        print(json.dumps({
            "event": "nlq_schema_loaded",
            "tables": sorted(list(ALLOWED_SCHEMA.keys())),
            "columns_total": sum(len(v) for v in ALLOWED_SCHEMA.values()),
        }))
    except Exception:
        pass


@app.on_event("startup")
async def _on_startup_load_schema() -> None:
    try:
        await _load_allowed_schema()
    except Exception as exc:
        # Fail closed: if schema fails to load, keep empty allowlist which will reject queries
        print(json.dumps({"event": "nlq_schema_load_failed", "error": str(exc)[:300]}))


def _extract_table_aliases(sql: str) -> Tuple[Dict[str, str], Set[str]]:
    """Return (alias_to_table, referenced_tables) from FROM/JOIN clauses.
    Both keys/values are lowercased; referenced_tables are bare table names without DB prefix.
    """
    s = _strip_string_literals(sql)
    lower = s.lower()

    # Find all references to via_test.table in FROM and JOIN
    alias_to_table: Dict[str, str] = {}
    referenced_tables: Set[str] = set()

    for kw in ("from", "join"):
        pattern = re.compile(rf"\b{kw}\s+{re.escape(DB_NAME.lower())}\.([a-zA-Z_][\w]*)\s*(?:as\s+)?([a-zA-Z_][\w]*)?", re.IGNORECASE)
        for m in pattern.finditer(lower):
            table = m.group(1)
            alias = m.group(2) or table
            tbl = table.lower()
            als = alias.lower()
            referenced_tables.add(tbl)
            alias_to_table[als] = tbl
            # Also allow using table name directly without alias
            alias_to_table.setdefault(tbl, tbl)

    # Also validate there are no references to other databases or other tables under via_test
    for m in re.finditer(r"\b" + re.escape(DB_NAME.lower()) + r"\.([a-zA-Z_][\w]*)\b", lower):
        tbl = m.group(1).lower()
        referenced_tables.add(tbl)

    return alias_to_table, referenced_tables


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

    # Require referencing only DB_NAME.* for table access; allow constant selects without FROM/JOIN
    references_tables = bool(re.search(r"\b(from|join)\b", lower_query))
    if references_tables and f"{DB_NAME.lower()}." not in lower_query:
        raise HTTPException(status_code=400, detail=f"Queries must reference tables under the {DB_NAME}. schema.")

    # Validate tables and columns against allowlist
    alias_to_table, referenced_tables = _extract_table_aliases(query)
    # Ensure only allowed tables are referenced
    for tbl in referenced_tables:
        if tbl not in ALLOWED_TABLES:
            raise HTTPException(status_code=400, detail=f"Table not in allowlist: {DB_NAME}.{tbl}")
        if tbl not in ALLOWED_SCHEMA:
            raise HTTPException(status_code=400, detail=f"Schema unknown for table: {DB_NAME}.{tbl}")

    # Validate qualified column references like alias.column or table.column
    dotted = re.finditer(r"\b([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)\b", _strip_string_literals(query))
    for m in dotted:
        left = m.group(1).lower()
        col = m.group(2).lower()
        base_tbl = None
        if left in alias_to_table:
            base_tbl = alias_to_table[left]
        elif left in ALLOWED_TABLES:
            base_tbl = left
        else:
            # Might be function name like lower(x), skip if left isn't a known alias/table
            continue
        allowed_cols = ALLOWED_SCHEMA.get(base_tbl, set())
        if col not in allowed_cols:
            raise HTTPException(status_code=400, detail=f"Column not in allowlist: {base_tbl}.{col}")

    # If multiple tables are referenced, require that columns are qualified to avoid ambiguity
    if len(referenced_tables) > 1:
        # Any unqualified column tokens that match allowed column names across referenced tables?
        token_re = re.compile(r"(?<!\.)\b([a-zA-Z_][\w]*)\b")
        keywords = {
            "select","from","join","on","where","and","or","not","in","like","order","by","group","limit","as","is","null",
            "case","when","then","else","end","desc","asc","format","jsoneachrow","count","sum","avg","min","max","distinct","having",
            DB_NAME.lower(),
        }
        names_to_ignore = set(alias_to_table.keys()) | referenced_tables | set(ALLOWED_TABLES)
        allowed_union: Set[str] = set()
        for tbl in referenced_tables:
            allowed_union |= ALLOWED_SCHEMA.get(tbl, set())
        for m in token_re.finditer(lower_query):
            tok = m.group(1)
            if tok in keywords or tok.isdigit() or tok in names_to_ignore:
                continue
            if tok in allowed_union:
                # Likely an unqualified column when multiple tables are present
                raise HTTPException(status_code=400, detail=f"Ambiguous or unqualified column: {tok}. Qualify with table alias.")

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
            msg = resp.text.strip()
            lowered = msg.lower()
            if "unknown identifier" in lowered or "unknown column" in lowered or "there is no column" in lowered:
                raise HTTPException(status_code=400, detail="Column not in allowlist or not found.")
            if "unknown table" in lowered or "no such table" in lowered:
                raise HTTPException(status_code=400, detail="Table not in allowlist or not found.")
            raise HTTPException(status_code=400, detail=f"ClickHouse error: {msg[:300]}")
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


def _escape(s: str) -> str:
    return (s or '').replace("'", "''")


async def _api_answers_for_company(company: str, top_k: int) -> List[Dict[str, Any]]:
    co = _escape(company)
    sql = (
        f"SELECT toString(p.person_id_64) AS person_id, anyLast(p.full_name) AS full_name, "
        f"anyLast(s.title) AS title, anyLast(c.name) AS company FROM {DB_NAME}.stints s\n"
        f"JOIN {DB_NAME}.persons_large p ON p.person_id_64 = s.person_id_64\n"
        f"JOIN {DB_NAME}.companies c ON c.company_id_64 = s.company_id_64\n"
        f"WHERE (positionCaseInsensitive(c.name, '{co}') > 0 OR lower(c.name) LIKE '%{co}%')\n"
        f"ORDER BY (s.end_date IS NULL) DESC\nLIMIT {min(50, max(1, top_k))}\nFORMAT JSONEachRow"
    )
    rows = await run_sql(sql)
    answers: List[Dict[str, Any]] = []
    for r in rows:
        title = str(r.get('full_name') or '')
        snippet = str(r.get('title') or '')
        pid = str(r.get('person_id') or '')
        answers.append({
            'title': title,
            'snippet': snippet,
            'personId': f"person:{pid}" if pid else None,
        })
    return answers


async def _api_answers_for_person_neighbors(person_name: str, top_k: int) -> List[Dict[str, Any]]:
    name = _escape(person_name)
    # Resolve a person id by fuzzy match
    sql_pid = (
        f"SELECT toString(person_id_64) AS pid FROM {DB_NAME}.persons_large\n"
        f"WHERE positionCaseInsensitive(full_name, '{name}') > 0\nLIMIT 1\nFORMAT JSONEachRow"
    )
    pid_rows = await run_sql(sql_pid)
    if not pid_rows:
        return []
    pid = str(pid_rows[0].get('pid') or '')
    if not pid:
        return []
    # Find coworkers by shared company, ranked by count
    sql = (
        f"SELECT toString(s2.person_id_64) AS person_id, anyLast(p2.full_name) AS full_name, count() AS cnt FROM {DB_NAME}.stints s1\n"
        f"JOIN {DB_NAME}.stints s2 ON s1.company_id_64 = s2.company_id_64 AND s1.person_id_64 <> s2.person_id_64\n"
        f"LEFT JOIN {DB_NAME}.persons_large p2 ON p2.person_id_64 = s2.person_id_64\n"
        f"WHERE s1.person_id_64 = toUInt64({pid})\n"
        f"GROUP BY s2.person_id_64\nORDER BY cnt DESC\nLIMIT {min(50, max(1, top_k))}\nFORMAT JSONEachRow"
    )
    rows = await run_sql(sql)
    answers: List[Dict[str, Any]] = []
    for r in rows:
        title = str(r.get('full_name') or '')
        pid2 = str(r.get('person_id') or '')
        snippet = f"Coworker overlap: {r.get('cnt')}"
        answers.append({
            'title': title,
            'snippet': snippet,
            'personId': f"person:{pid2}" if pid2 else None,
        })
    return answers


@app.post("/api/nlq", response_model=APINLQResp)
async def api_nlq(payload: APINLQReq) -> APINLQResp:
    q = (payload.query or '').strip()
    top_k = int(payload.topK or 10)
    top_k = max(1, min(50, top_k))
    filters = payload.filters or {}
    try:
        # Filters take precedence
        if filters.get('companyId'):
            cid = str(filters['companyId']).replace('company:', '')
            sql = (
                f"SELECT toString(p.person_id_64) AS person_id, anyLast(p.full_name) AS full_name, anyLast(s.title) AS title FROM {DB_NAME}.stints s\n"
                f"JOIN {DB_NAME}.persons_large p ON p.person_id_64 = s.person_id_64\n"
                f"WHERE s.company_id_64 = toUInt64({cid})\n"
                f"ORDER BY (s.end_date IS NULL) DESC\nLIMIT {top_k}\nFORMAT JSONEachRow"
            )
            rows = await run_sql(sql)
            answers = [{ 'title': str(r.get('full_name') or ''), 'snippet': str(r.get('title') or ''), 'personId': f"person:{r.get('person_id')}" } for r in rows]
            return APINLQResp(answers=[APINLQAnswer(**a) for a in answers], raw={'mode': 'filter:company'})
        if filters.get('personId'):
            pid = str(filters['personId']).replace('person:', '')
            rows = await _api_answers_for_person_neighbors(pid, top_k)
            return APINLQResp(answers=[APINLQAnswer(**a) for a in rows], raw={'mode': 'filter:person'})

        # Canned detections
        m = re.match(r"^who do (?:we|i) know at\s+(.+?)\??$", q, re.IGNORECASE)
        if m:
            answers = await _api_answers_for_company(m.group(1), top_k)
            return APINLQResp(answers=[APINLQAnswer(**a) for a in answers], raw={'mode': 'deterministic'})
        m = re.match(r"^show contacts at\s+(.+?)[\.?]*$", q, re.IGNORECASE)
        if m:
            answers = await _api_answers_for_company(m.group(1), top_k)
            return APINLQResp(answers=[APINLQAnswer(**a) for a in answers], raw={'mode': 'deterministic'})
        m = re.match(r"^(?:people|persons) connected to\s+(.+?)[\.?]*$", q, re.IGNORECASE)
        if m:
            answers = await _api_answers_for_person_neighbors(m.group(1), top_k)
            return APINLQResp(answers=[APINLQAnswer(**a) for a in answers], raw={'mode': 'deterministic'})

        # Fallback: try company heuristic
        if len(q) >= 2:
            answers = await _api_answers_for_company(q, top_k)
            if answers:
                return APINLQResp(answers=[APINLQAnswer(**a) for a in answers], raw={'mode': 'heuristic'})
        return APINLQResp(answers=[], raw={'mode': 'empty'})
    except HTTPException as he:
        raise he
    except Exception as exc:
        raise HTTPException(status_code=500, detail={ 'error': { 'message': str(exc)[:300], 'code': 'NLQ_ERROR' } })


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


def _normalize_company(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip().lower()


def _try_canned(question: str) -> Optional[Dict[str, Any]]:
    q = (question or "").strip()
    ql = q.lower()

    # Who do I know at {Company} in {City}?
    m = re.match(r"^who do i know at\s+(.+?)\s+in\s+([^?]+)\??$", ql)
    if m:
        company = m.group(1).strip()
        city = m.group(2).strip()
        sql = (
            f"SELECT p.full_name, s.title, c.name FROM {DB_NAME}.stints s\n"
            f"JOIN {DB_NAME}.persons_large p ON p.person_id_64 = s.person_id_64\n"
            f"JOIN {DB_NAME}.companies c ON c.company_id_64 = s.company_id_64\n"
            "WHERE (s.end_date IS NULL) AND "
            f"(positionCaseInsensitive(c.name, '{company}') > 0 OR lower(c.name) LIKE '%{company}%') AND "
            f"lower(p.location) LIKE '%{city}%'"
        )
        return {"kind": "who_at_company_city", "sql": sql}

    # Who do I know at {Company}?
    m = re.match(r"^who do i know at\s+([^?]+)\??$", ql)
    if m:
        company = m.group(1).strip()
        sql = (
            f"SELECT p.full_name, s.title, c.name FROM {DB_NAME}.stints s\n"
            f"JOIN {DB_NAME}.persons_large p ON p.person_id_64 = s.person_id_64\n"
            f"JOIN {DB_NAME}.companies c ON c.company_id_64 = s.company_id_64\n"
            "WHERE (s.end_date IS NULL) AND "
            f"(positionCaseInsensitive(c.name, '{company}') > 0 OR lower(c.name) LIKE '%{company}%')"
        )
        return {"kind": "who_at_company", "sql": sql}

    # List directors at {Company}.
    m = re.match(r"^list directors at\s+([^.?]+)[\.?]*$", ql)
    if m:
        company = m.group(1).strip()
        sql = (
            f"SELECT p.full_name, s.title, c.name FROM {DB_NAME}.stints s\n"
            f"JOIN {DB_NAME}.persons_large p ON p.person_id_64 = s.person_id_64\n"
            f"JOIN {DB_NAME}.companies c ON c.company_id_64 = s.company_id_64\n"
            f"WHERE lower(s.title) LIKE '%director%' AND (positionCaseInsensitive(c.name, '{company}') > 0 OR lower(c.name) LIKE '%{company}%')"
        )
        return {"kind": "list_directors", "sql": sql}

    # Count people by title at {Company}.
    m = re.match(r"^count people by title at\s+([^.?]+)[\.?]*$", ql)
    if m:
        company = m.group(1).strip()
        sql = (
            f"SELECT s.title, count() AS cnt FROM {DB_NAME}.stints s\n"
            f"JOIN {DB_NAME}.companies c ON c.company_id_64 = s.company_id_64\n"
            f"WHERE (positionCaseInsensitive(c.name, '{company}') > 0 OR lower(c.name) LIKE '%{company}%')\n"
            "GROUP BY s.title\n"
            "ORDER BY cnt DESC"
        )
        return {"kind": "count_by_title", "sql": sql}

    return None


def _format_canned_answer(canned: Dict[str, Any], rows: List[Dict[str, Any]]) -> str:
    kind = canned.get("kind")
    if kind in ("who_at_company", "who_at_company_city", "list_directors"):
        names = ", ".join(str(r.get("full_name") or r.get("name") or "?") for r in rows[:5])
        return names or "No results found."
    if kind == "count_by_title":
        summary = ", ".join(f"{r.get('title')}: {r.get('cnt')}" for r in rows[:5])
        return summary or "No results found."
    return "Here are the results."

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8099, reload=True)


