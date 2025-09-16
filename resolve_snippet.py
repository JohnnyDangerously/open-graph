@app.get("/resolve")
def resolve(linkedin_url: str):
    s = linkedin_url.strip()
    v = s.split("/in/")[-1].strip("/") if "/in/" in s else s
    row = con.execute(
        "SELECT person_id FROM people_linkedin_identifiers WHERE value = ? LIMIT 1",
        [v],
    ).fetchone()
    if not row:
        row = con.execute(
            "SELECT person_id FROM people_linkedin_identifiers WHERE value = ? LIMIT 1",
            [s],
        ).fetchone()
    return {"person_id": (row[0] if row else None)}
