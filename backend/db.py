"""
PostgreSQL database layer.
Drop-in replacement for the Supabase client used throughout the backend.
Provides a builder-pattern interface: db.table("leads").select("*").eq("id", x).execute()
"""
from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from functools import lru_cache

import psycopg2
import psycopg2.extras
import psycopg2.pool
from config import get_settings

logger = logging.getLogger(__name__)

psycopg2.extras.register_default_jsonb(loads=json.loads, globally=True)


@lru_cache
def _dsn() -> str:
    s = get_settings()
    return s.database_url


# Persistent connection pool — connections stay open and are reused across requests.
# Eliminates TCP handshake + SSL + auth overhead on every query.
_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=8,
            dsn=_dsn(),
            # TCP keepalives — detect dead connections in ~30s instead of waiting
            # for the OS default (which can be minutes). Prevents stale pool entries
            # after Supabase timeouts or network blips.
            keepalives=1,
            keepalives_idle=30,      # seconds idle before sending a keepalive probe
            keepalives_interval=10,  # seconds between probes
            keepalives_count=3,      # failed probes before marking connection dead
        )
    return _pool


@contextmanager
def get_conn():
    p = _get_pool()
    conn = p.getconn()
    try:
        # Health-check: if the connection died (Supabase timeout, network blip),
        # discard it and get a fresh one instead of returning a dead connection.
        if conn.closed:
            p.putconn(conn, close=True)
            conn = p.getconn()
        yield conn
        conn.commit()
    except psycopg2.OperationalError:
        # Connection-level failure — discard this connection entirely so the pool
        # replaces it with a fresh one on the next request.
        try:
            conn.rollback()
        except Exception:
            pass
        p.putconn(conn, close=True)
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        # Only return to pool if not already discarded above
        if not conn.closed:
            p.putconn(conn)


class QueryResult:
    def __init__(self, data: list[dict] | None = None, count: int | None = None):
        self.data = data or []
        self.count = count


class QueryBuilder:
    def __init__(self, table: str):
        self._table = table
        self._op = "select"
        self._columns = "*"
        self._wheres: list[tuple[str, str, object]] = []
        self._order_col: str | None = None
        self._order_desc = False
        self._limit_val: int | None = None
        self._single = False
        self._count_mode: str | None = None
        self._insert_data: dict | None = None
        self._update_data: dict | None = None
        self._upsert_data: dict | None = None
        self._upsert_conflict: str | None = None
        self._in_filters: list[tuple[str, list]] = []
        self._not_in_filters: list[tuple[str, list]] = []
        self._gte_filters: list[tuple[str, str]] = []
        self._lt_filters: list[tuple[str, str]] = []
        self._is_null_filters: list[str] = []
        self._not_is_filters: list[tuple[str, str]] = []

    # --- Builder methods ---

    def select(self, columns: str, count: str | None = None) -> QueryBuilder:
        self._op = "select"
        self._columns = columns
        self._count_mode = count
        return self

    def insert(self, data: dict) -> QueryBuilder:
        self._op = "insert"
        self._insert_data = data
        return self

    def update(self, data: dict) -> QueryBuilder:
        self._op = "update"
        self._update_data = data
        return self

    def upsert(self, data: dict, on_conflict: str = "") -> QueryBuilder:
        self._op = "upsert"
        self._upsert_data = data
        self._upsert_conflict = on_conflict
        return self

    def delete(self) -> QueryBuilder:
        self._op = "delete"
        return self

    def eq(self, col: str, val: object) -> QueryBuilder:
        self._wheres.append((col, "=", val))
        return self

    def in_(self, col: str, vals: list) -> QueryBuilder:
        self._in_filters.append((col, vals))
        return self

    def not_in(self, col: str, vals: list) -> QueryBuilder:
        self._not_in_filters.append((col, vals))
        return self

    def is_(self, col: str, val: str) -> QueryBuilder:
        """Handles .is_("col", "null") → col IS NULL"""
        if val.lower() == "null":
            self._is_null_filters.append(col)
        return self

    def lt(self, col: str, val: str) -> QueryBuilder:
        self._lt_filters.append((col, val))
        return self

    def gte(self, col: str, val: str) -> QueryBuilder:
        self._gte_filters.append((col, val))
        return self

    @property
    def not_(self) -> _NotProxy:
        return _NotProxy(self)

    def order(self, col: str, desc: bool = False) -> QueryBuilder:
        self._order_col = col
        self._order_desc = desc
        return self

    def limit(self, n: int) -> QueryBuilder:
        self._limit_val = n
        return self

    def single(self) -> QueryBuilder:
        self._single = True
        self._limit_val = 1
        return self

    # --- Execute ---

    def execute(self) -> QueryResult:
        if self._op == "select":
            return self._exec_select()
        elif self._op == "insert":
            return self._exec_insert()
        elif self._op == "update":
            return self._exec_update()
        elif self._op == "upsert":
            return self._exec_upsert()
        elif self._op == "delete":
            return self._exec_delete()
        raise ValueError(f"Unknown op: {self._op}")

    # --- Internal ---

    def _where_clause(self) -> tuple[str, list]:
        parts = []
        params: list = []
        for col, op, val in self._wheres:
            parts.append(f"{col} {op} %s")
            params.append(val)
        for col, vals in self._in_filters:
            placeholders = ", ".join(["%s"] * len(vals))
            parts.append(f"{col} IN ({placeholders})")
            params.extend(vals)
        for col, vals in self._not_in_filters:
            placeholders = ", ".join(["%s"] * len(vals))
            parts.append(f"{col} NOT IN ({placeholders})")
            params.extend(vals)
        for col in self._is_null_filters:
            parts.append(f"{col} IS NULL")
        for col, val in self._lt_filters:
            parts.append(f"{col} < %s")
            params.append(val)
        for col, val in self._gte_filters:
            parts.append(f"{col} >= %s")
            params.append(val)
        for col, val in self._not_is_filters:
            parts.append(f"{col} IS NOT {val}")
        if not parts:
            return "", params
        return " WHERE " + " AND ".join(parts), params

    def _exec_select(self) -> QueryResult:
        # Handle joined selects like "*, lead:leads(*)"
        join_table = None
        join_alias = None
        columns = self._columns

        if ":" in columns:
            import re
            match = re.search(r"(\w+):(\w+)\(\*\)", columns)
            if match:
                join_alias = match.group(1)
                join_table = match.group(2)
                columns = re.sub(r",?\s*\w+:\w+\(\*\)", "", columns).strip().rstrip(",") or "*"

        where_sql, params = self._where_clause()
        sql = f"SELECT {columns} FROM {self._table}{where_sql}"
        if self._order_col:
            direction = "DESC" if self._order_desc else "ASC"
            sql += f" ORDER BY {self._order_col} {direction}"
        if self._limit_val:
            sql += f" LIMIT {self._limit_val}"

        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, params)
                rows = [dict(r) for r in cur.fetchall()]

                # Get count if requested
                count = None
                if self._count_mode == "exact":
                    count_sql = f"SELECT COUNT(*) FROM {self._table}{where_sql}"
                    cur.execute(count_sql, params)
                    count = cur.fetchone()["count"]

                # Handle joins
                if join_table and join_alias:
                    for row in rows:
                        lead_id = row.get("lead_id")
                        if lead_id:
                            cur.execute(f"SELECT * FROM {join_table} WHERE id = %s", [lead_id])
                            joined = cur.fetchone()
                            row[join_alias] = dict(joined) if joined else None

                # Serialize for JSON compatibility
                rows = [_serialize_row(r) for r in rows]

                if self._single:
                    data = rows[0] if rows else None
                    return QueryResult(data=data, count=count)

                return QueryResult(data=rows, count=count)

    def _exec_insert(self) -> QueryResult:
        data = self._insert_data
        cols = list(data.keys())
        vals = [_json_wrap(data[c]) for c in cols]
        placeholders = ", ".join(["%s"] * len(cols))
        col_str = ", ".join(cols)
        sql = f"INSERT INTO {self._table} ({col_str}) VALUES ({placeholders}) RETURNING *"

        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, vals)
                row = cur.fetchone()
                return QueryResult(data=[_serialize_row(dict(row))] if row else [])

    def _exec_update(self) -> QueryResult:
        data = self._update_data
        set_parts = [f"{k} = %s" for k in data.keys()]
        set_vals = [_json_wrap(v) for v in data.values()]
        where_sql, where_params = self._where_clause()
        sql = f"UPDATE {self._table} SET {', '.join(set_parts)}{where_sql} RETURNING *"

        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, set_vals + where_params)
                rows = [_serialize_row(dict(r)) for r in cur.fetchall()]
                return QueryResult(data=rows)

    def _exec_upsert(self) -> QueryResult:
        data = self._upsert_data
        cols = list(data.keys())
        vals = [_json_wrap(data[c]) for c in cols]
        placeholders = ", ".join(["%s"] * len(cols))
        col_str = ", ".join(cols)
        conflict = self._upsert_conflict or cols[0]
        update_parts = [f"{c} = EXCLUDED.{c}" for c in cols if c != conflict]
        sql = (
            f"INSERT INTO {self._table} ({col_str}) VALUES ({placeholders}) "
            f"ON CONFLICT ({conflict}) DO UPDATE SET {', '.join(update_parts)} "
            f"RETURNING *"
        )

        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, vals)
                row = cur.fetchone()
                return QueryResult(data=[_serialize_row(dict(row))] if row else [])

    def _exec_delete(self) -> QueryResult:
        where_sql, params = self._where_clause()
        sql = f"DELETE FROM {self._table}{where_sql}"
        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, params)
                return QueryResult(data=[])


class _NotProxy:
    """Handles sb.table(...).not_.is_("col", "null")"""
    def __init__(self, builder: QueryBuilder):
        self._builder = builder

    def is_(self, col: str, val: str) -> QueryBuilder:
        self._builder._not_is_filters.append((col, val.upper()))
        return self._builder


class DB:
    def table(self, name: str) -> QueryBuilder:
        return QueryBuilder(name)


def get_db() -> DB:
    return DB()


def _json_wrap(val: object) -> object:
    """Wrap dicts/lists as JSON for psycopg2."""
    if isinstance(val, (dict, list)):
        return json.dumps(val)
    return val


def _serialize_row(row: dict) -> dict:
    """Make row JSON-serializable (datetimes → ISO strings, Decimals → float)."""
    from datetime import datetime, date
    from decimal import Decimal
    out = {}
    for k, v in row.items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        elif isinstance(v, date):
            out[k] = v.isoformat()
        elif isinstance(v, Decimal):
            out[k] = float(v)
        else:
            out[k] = v
    return out
