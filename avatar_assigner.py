#!/usr/bin/env python3

import argparse
import csv
import hashlib
import os
import random
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from typing import Iterable, List, Tuple, Dict

import boto3
import clickhouse_connect

FEMALE_NAMES = {'jessica','jennifer','amanda','ashley','sarah','stephanie','melissa','nicole','elizabeth','heather','tiffany','michelle','amber','megan','amy','rachel','kimberly','christina','brittany','rebecca','laura','danielle','kayla','samantha','angela','erin','allison','katherine','maria','lisa'}
MALE_NAMES = {'michael','christopher','matthew','joshua','david','james','daniel','robert','john','joseph','andrew','ryan','brandon','jason','justin','william','jonathan','brian','brent','kevin','steven','thomas','timothy','richard','charles','paul','mark','donald'}

S3_BUCKET = 'via-production-avatars'
S3_PREFIX = 'p/'
S3_URL_FMT = 'https://s3.amazonaws.com/via-production-avatars/p/{hash}'

DB_HOST_ENV = 'CH_HOST'
DB_USER_ENV = 'CH_USER'
DB_PASS_ENV = 'CH_PASS'
DB_NAME = 'via_test'
TABLE = 'person_avatars'
PEOPLE_TABLE = 'persons_large'

rand = random.Random(42)


def connect_ch():
    raw = os.getenv(DB_HOST_ENV, 'http://34.236.80.1:8123')
    user = os.getenv(DB_USER_ENV) or ''
    password = os.getenv(DB_PASS_ENV) or ''
    # Parse host/port from env; accept http://host:port, host:port, or host
    host = '34.236.80.1'
    port = 8123
    try:
        if '://' in raw:
            from urllib.parse import urlparse
            u = urlparse(raw)
            if u.hostname:
                host = u.hostname
            if u.port:
                port = int(u.port)
        else:
            if ':' in raw:
                h, p = raw.split(':', 1)
                host = h or host
                try: port = int(p)
                except: pass
            elif raw:
                host = raw
    except Exception:
        pass
    client = clickhouse_connect.get_client(host=host, port=port, username=user or None, password=password or None, database=DB_NAME)
    return client


def ensure_table(client):
    client.command(f"""
CREATE TABLE IF NOT EXISTS {DB_NAME}.{TABLE}
(
    person_id_str String,
    avatar_hash String,
    avatar_url String,
    gender_guess LowCardinality(String),
    assigned_at DateTime64(6, 'UTC') DEFAULT now64()
)
ENGINE = MergeTree
ORDER BY person_id_str
""")
    client.command(f"""
CREATE TABLE IF NOT EXISTS {DB_NAME}.person_avatars_by_id
(
    person_id UInt64,
    avatar_url String,
    assigned_at DateTime64(6, 'UTC') DEFAULT now64()
)
ENGINE = MergeTree
ORDER BY person_id
""")


def strip_accents(text: str) -> str:
    if not text:
        return ''
    return ''.join(c for c in unicodedata.normalize('NFKD', text) if not unicodedata.combining(c))


def normalize_first_name(name: str) -> str:
    if not name:
        return ''
    name_norm = strip_accents(name).strip().lower()
    name_norm = re.sub(r"\(.*?\)", "", name_norm)
    name_norm = re.sub(r",\s*(jr|sr|ii|iii|iv|phd|mba|md)$", "", name_norm)
    token = re.split(r"[\s\-]+", name_norm.strip())[0] if name_norm else ''
    token = re.sub(r"[^a-z]", "", token)
    return token

def list_s3_avatars(max_keys: int) -> List[str]:
    s3 = boto3.client('s3')
    hashes: List[str] = []
    kwargs = dict(Bucket=S3_BUCKET, Prefix=S3_PREFIX, MaxKeys=min(1000, max_keys))
    while True:
        resp = s3.list_objects_v2(**kwargs)
        for obj in resp.get('Contents', []):
            key = obj['Key']
            if not key.startswith(S3_PREFIX):
                continue
            name = key.split('/')[-1]
            if len(name) == 32:
                hashes.append(name)
                if len(hashes) >= max_keys:
                    return hashes
        if not resp.get('IsTruncated'):
            break
        kwargs['ContinuationToken'] = resp.get('NextContinuationToken')
        if len(hashes) >= max_keys:
            break
    return hashes


def first_name(name: str) -> str:
    return normalize_first_name(name)


def normalize_linkedin_slug(linkedin: str) -> str:
    if not linkedin:
        return ''
    s = linkedin.strip()
    s = re.sub(r"^https?://([a-z.]*linkedin\.com)?", "", s, flags=re.IGNORECASE)
    m = re.search(r"/in/([^/?#]+)", s, flags=re.IGNORECASE)
    if m:
        s = m.group(1)
    s = s.split('?')[0].split('#')[0].strip('/')
    return s.lower()


def load_slug_hash_csv(path: str) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    if not path or not os.path.exists(path):
        return mapping
    with open(path, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        for row in reader:
            if not row or len(row) < 2:
                continue
            slug = str(row[0]).strip()
            hashv = str(row[1]).strip()
            if slug.lower() in {'slug','linkedin','linkedin_slug','profile','url'}:
                continue
            slug = normalize_linkedin_slug(slug)
            if not slug:
                continue
            if len(hashv) == 32 and re.fullmatch(r"[0-9a-fA-F]{32}", hashv):
                mapping[slug] = hashv.lower()
    return mapping


def gender_guess_advanced(name: str, ssa_stats: Dict[str, float]) -> Tuple[str, float, str]:
    fn = first_name(name)
    if not fn:
        return ('neutral', 0.5, 'empty')
    if fn in FEMALE_NAMES:
        return ('female', 0.95, 'list')
    if fn in MALE_NAMES:
        return ('male', 0.95, 'list')
    if ssa_stats:
        p_f = ssa_stats.get(fn)
        if p_f is not None:
            if p_f >= 0.5:
                return ('female', p_f, 'ssa')
            return ('male', 1.0 - p_f, 'ssa')
    return ('neutral', 0.5, 'unknown')


def deterministic_index(seed: str, n: int) -> int:
    h = hashlib.sha256(seed.encode('utf-8')).digest()
    # take 8 bytes for stable 64-bit
    val = int.from_bytes(h[:8], 'big', signed=False)
    return val % max(1, n)


def assign_avatars(client, max_avatars: int, batch_size: int, limit: int, overwrite: bool, stats_only: bool, sample: int,
                   slug_csv: str = '', ssa_csv: str = '', min_gender_conf: float = 0.8, skip_ambiguous: bool = False):
    hashes = list_s3_avatars(max_avatars)
    if not hashes:
        print('No avatars discovered in S3; aborting', file=sys.stderr)
        return
    # Split evenly into 3 buckets for gender
    third = max(1, len(hashes)//3)
    female_pool = hashes[:third]
    male_pool = hashes[third:third*2]
    neutral_pool = hashes[third*2:]

    print(f'Loaded {len(hashes)} avatars: female={len(female_pool)}, male={len(male_pool)}, neutral={len(neutral_pool)}')
    # Optional inputs
    slug_to_hash = load_slug_hash_csv(slug_csv) if slug_csv else {}
    if slug_to_hash:
        print(f'Loaded {len(slug_to_hash)} slug->hash mappings from CSV')
    ssa_stats: Dict[str, float] = {}
    if ssa_csv:
        try:
            # Flexible parser: try DictReader first
            ssa_stats = {}
            with open(ssa_csv, 'r', encoding='utf-8') as f:
                test_line = f.readline()
                f.seek(0)
                if ',' in test_line and 'name' in test_line.lower():
                    reader = csv.DictReader(f)
                    for row in reader:
                        try:
                            nm = normalize_first_name(row.get('name') or row.get('first_name') or '')
                            if not nm:
                                continue
                            if 'female_prob' in row:
                                p = float(row['female_prob'])
                                if 0.0 <= p <= 1.0:
                                    ssa_stats[nm] = p
                            elif 'female_count' in row and 'male_count' in row:
                                fc = float(row['female_count'] or 0)
                                mc = float(row['male_count'] or 0)
                                tot = fc + mc
                                if tot > 0:
                                    ssa_stats[nm] = fc / tot
                        except Exception:
                            continue
                else:
                    reader = csv.reader(f)
                    for row in reader:
                        if not row:
                            continue
                        try:
                            nm = normalize_first_name(row[0])
                            if len(row) >= 3:
                                fc = float(row[1] or 0)
                                mc = float(row[2] or 0)
                                tot = fc + mc
                                if tot > 0 and nm:
                                    ssa_stats[nm] = fc / tot
                            elif len(row) >= 2:
                                p = float(row[1])
                                if nm and 0.0 <= p <= 1.0:
                                    ssa_stats[nm] = p
                        except Exception:
                            continue
        except Exception:
            ssa_stats = {}
    if ssa_stats:
        print(f'Loaded {len(ssa_stats)} first-name stats from SSA CSV')

    # Count total people
    total = client.query(f"SELECT count() FROM {DB_NAME}.{PEOPLE_TABLE}").result_rows[0][0]
    if limit:
        total = min(total, limit)
    print(f'Processing {total} people...')

    # Prepare insert
    insert_sql = f"INSERT INTO {DB_NAME}.{TABLE} (person_id_str, avatar_hash, avatar_url, gender_guess) VALUES"

    processed = 0
    start = time.time()
    rows_buffer: List[Tuple[str,str,str,str]] = []

    # Pass A: persons_large → maintain legacy person_avatars (by string key) and by_id where possible
    offset = 0
    while processed < total:
        take = min(batch_size, total - processed)
        rows = client.query(
            f"SELECT toString(person_id) AS pid, toString(person_id_str) AS id_str, anyLast(name) AS name, anyLast(linkedin) AS linkedin FROM {DB_NAME}.{PEOPLE_TABLE} GROUP BY person_id, person_id_str LIMIT {take} OFFSET {offset}"
        ).result_rows
        offset += take
        if not rows:
            break
        for pid, id_str, name, linkedin in rows:
            # Prefer CSV mapping when linkedin slug is present
            ah = None
            if slug_to_hash and linkedin:
                slug = normalize_linkedin_slug(str(linkedin))
                if slug and slug in slug_to_hash:
                    ah = slug_to_hash[slug]
            if ah is None:
                label, conf, _src = gender_guess_advanced(name or '', ssa_stats)
                if skip_ambiguous and conf < min_gender_conf:
                    continue
                pool = neutral_pool
                if label == 'female' and female_pool:
                    pool = female_pool
                elif label == 'male' and male_pool:
                    pool = male_pool
                idx = deterministic_index(str(pid), len(pool))
                ah = pool[idx]
            url = S3_URL_FMT.format(hash=ah)
            rows_buffer.append((str(id_str), ah, url, ''))
            try:
                client.insert('person_avatars_by_id', [(int(pid), url,)], column_names=['person_id','avatar_url'])
            except Exception:
                pass
        processed += len(rows)

        if stats_only:
            continue

        if rows_buffer:
            if overwrite:
                # Use a temp table for ids to avoid massive IN() payloads
                client.command(f"DROP TEMPORARY TABLE IF EXISTS tmp_ids")
                client.command("CREATE TEMPORARY TABLE tmp_ids(id String) ENGINE=Memory")
                client.insert('tmp_ids', [(r[0],) for r in rows_buffer], column_names=['id'])
                client.command(f"ALTER TABLE {DB_NAME}.{TABLE} DELETE WHERE person_id_str IN (SELECT id FROM tmp_ids)")
            client.insert(TABLE, rows_buffer, column_names=['person_id_str','avatar_hash','avatar_url','gender_guess'])
            rows_buffer.clear()

        print(f'Batch complete: {processed}/{total} in {time.time()-start:.1f}s')

    if stats_only:
        # show distribution by gender
        dist = {'female':0,'male':0,'neutral':0}
        for pid, name in client.query(f"SELECT toString(person_id_str), anyLast(name) FROM {DB_NAME}.{PEOPLE_TABLE} LIMIT {total}").result_rows:
            dist[gender_guess(name or '')] += 1
        print('Stats only. Approx gender distribution:', dist)
    else:
        print('Done. Total inserted/updated:', processed)

    # Pass B: person_profile_current → ensure by_id is fully populated for numeric ids present in tiles
    print('Ensuring by_id coverage from person_profile_current...')
    processed2 = 0
    offset2 = 0
    # Determine total rows in profile table (approx)
    try:
        total2 = client.query(f"SELECT count() FROM {DB_NAME}.person_profile_current").result_rows[0][0]
    except Exception:
        total2 = total
    if limit:
        total2 = min(total2, limit)
    while processed2 < total2:
        take = min(batch_size, total2 - processed2)
        rows = client.query(
            f"SELECT toUInt64(pp.person_id) AS pid, anyLast(pl.name) AS name, anyLast(pl.linkedin) AS linkedin FROM {DB_NAME}.person_profile_current pp LEFT JOIN {DB_NAME}.{PEOPLE_TABLE} pl ON pl.person_id_64 = pp.person_id GROUP BY pp.person_id LIMIT {take} OFFSET {offset2}"
        ).result_rows
        offset2 += take
        if not rows:
            break
        rows_byid: List[Tuple[int,str]] = []
        for pid, name, linkedin in rows:
            ah = None
            if slug_to_hash and linkedin:
                slug = normalize_linkedin_slug(str(linkedin))
                if slug and slug in slug_to_hash:
                    ah = slug_to_hash[slug]
            if ah is None:
                label, conf, _src = gender_guess_advanced(name or '', ssa_stats)
                if skip_ambiguous and conf < min_gender_conf:
                    continue
                pool = female_pool if label == 'female' and female_pool else male_pool if label == 'male' and male_pool else neutral_pool
                idx = deterministic_index(str(pid), len(pool))
                ah = pool[idx]
            url = S3_URL_FMT.format(hash=ah)
            try:
                rows_byid.append((int(pid), url))
            except Exception:
                continue
        processed2 += len(rows)
        if stats_only:
            continue
        if rows_byid:
            if overwrite:
                client.command(f"DROP TEMPORARY TABLE IF EXISTS tmp_ids2")
                client.command("CREATE TEMPORARY TABLE tmp_ids2(id UInt64) ENGINE=Memory")
                client.insert('tmp_ids2', [(r[0],) for r in rows_byid], column_names=['id'])
                client.command(f"ALTER TABLE {DB_NAME}.person_avatars_by_id DELETE WHERE person_id IN (SELECT id FROM tmp_ids2)")
            client.insert('person_avatars_by_id', rows_byid, column_names=['person_id','avatar_url'])
    print('by_id coverage complete')
    if sample:
        print('\nSample assignments:')
        q = client.query(f"SELECT person_id_str, avatar_url, gender_guess FROM {DB_NAME}.{TABLE} LIMIT {sample}")
        for r in q.result_rows:
            print(r)


def main():
    p = argparse.ArgumentParser(description='Assign avatars from S3 to people and write to ClickHouse')
    p.add_argument('--max-avatars', type=int, default=10000)
    p.add_argument('--batch-size', type=int, default=10000)
    p.add_argument('--limit', type=int, default=0)
    p.add_argument('--overwrite', action='store_true')
    p.add_argument('--stats-only', action='store_true')
    p.add_argument('--sample', type=int, default=0)
    p.add_argument('--slug-csv', type=str, default='', help='CSV path with columns slug,hash')
    p.add_argument('--ssa-names-csv', type=str, default='', help='Optional CSV: name,female_prob or name,female_count,male_count')
    p.add_argument('--min-gender-confidence', type=float, default=0.8)
    p.add_argument('--skip-ambiguous', action='store_true')
    args = p.parse_args()

    client = connect_ch()
    ensure_table(client)
    conf = max(0.5, min(1.0, args.min_gender_confidence))
    assign_avatars(client, args.max_avatars, args.batch_size, args.limit, args.overwrite, args.stats_only, args.sample,
                   slug_csv=args.slug_csv, ssa_csv=args.ssa_names_csv, min_gender_conf=conf, skip_ambiguous=args.skip_ambiguous)

if __name__ == '__main__':
    main()
