"""
数据库连接测试 + transport schema 表结构分析

连接本机 PostgreSQL 数据库 smart_traffic，schema=transport，
枚举该 schema 下所有表，逐表输出字段清单（类型 / 可空 / 默认值 / 注释），
并采样少量数据，辅助理解每个字段的含义。

用法：python db_inspect.py
"""

import sys
import psycopg2
from psycopg2 import sql

DB_NAME = "smart_traffic"
SCHEMA = "transport"

# 本机常见凭据候选，按顺序尝试
CREDENTIALS = [
    {"user": "postgres", "password": "Zt20060509"},
    {"user": "postgres", "password": "postgres"},
    {"user": "postgres", "password": "123456"},
    {"user": "postgres", "password": ""},
]


def try_connect():
    last_err = None
    for cred in CREDENTIALS:
        try:
            conn = psycopg2.connect(
                host="127.0.0.1",
                port=5432,
                dbname=DB_NAME,
                user=cred["user"],
                password=cred["password"],
            )
            print(f"[OK] 连接成功（user={cred['user']}）")
            return conn
        except psycopg2.OperationalError as e:
            last_err = e
            print(f"[尝试] user={cred['user']} 失败：{str(e).strip().splitlines()[0]}")
            continue
    print(f"[失败] 所有凭据均无法连接，最后错误：{last_err}")
    return None


def list_tables(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = %s AND table_type = 'BASE TABLE'
            ORDER BY table_name
            """,
            (SCHEMA,),
        )
        return [r[0] for r in cur.fetchall()]


def describe_table(conn, table):
    with conn.cursor() as cur:
        # 字段明细（含列注释）
        cur.execute(
            """
            SELECT
                a.attname AS column_name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
                a.attnotnull AS not_null,
                pg_get_expr(ad.adbin, ad.adrelid) AS default_val,
                col_description(a.attrelid, a.attnum) AS column_comment
            FROM pg_catalog.pg_attribute a
            LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
            WHERE a.attrelid = to_regclass(%s)
              AND a.attnum > 0
              AND NOT a.attisdropped
            ORDER BY a.attnum
            """,
            (f"{SCHEMA}.{table}",),
        )
        cols = cur.fetchall()

        # 表注释
        cur.execute("SELECT obj_description(to_regclass(%s), 'pg_class')", (f"{SCHEMA}.{table}",))
        table_comment = cur.fetchone()[0]

        # 行数（估算即可）
        cur.execute(
            "SELECT reltuples::bigint FROM pg_class WHERE oid = to_regclass(%s)",
            (f"{SCHEMA}.{table}",),
        )
        est_rows = cur.fetchone()[0]

    return table_comment, est_rows, cols


def sample_rows(conn, table, limit=3):
    """采样几行原始数据，便于理解字段值形态"""
    with conn.cursor() as cur:
        try:
            cur.execute(
                sql.SQL("SELECT * FROM {}.{} LIMIT {}").format(
                    sql.Identifier(SCHEMA),
                    sql.Identifier(table),
                    sql.SQL(str(limit)),
                )
            )
            rows = cur.fetchall()
            col_names = [d[0] for d in cur.description]
            return col_names, rows
        except Exception as e:
            return None, [f"采样失败：{e}"]


def main():
    conn = try_connect()
    if conn is None:
        sys.exit(1)

    tables = list_tables(conn)
    print(f"\n=== schema '{SCHEMA}' 下共 {len(tables)} 张表 ===\n")

    for table in tables:
        table_comment, est_rows, cols = describe_table(conn, table)
        print(f"── 表：{SCHEMA}.{table}  （约 {est_rows} 行）")
        if table_comment:
            print(f"   表注释：{table_comment}")
        print(f"   字段（{len(cols)} 列）：")
        for name, dtype, not_null, default, comment in cols:
            flags = []
            if not_null:
                flags.append("NOT NULL")
            if default is not None:
                flags.append(f"DEFAULT {default}")
            flag_str = f"  [{' | '.join(flags)}]" if flags else ""
            comment_str = f"  -- {comment}" if comment else ""
            print(f"     {name:<24} {dtype:<20}{flag_str}{comment_str}")

        col_names, rows = sample_rows(conn, table)
        if rows and col_names:
            print(f"   采样数据（最多 3 行）：")
            for r in rows:
                sample = ", ".join(
                    f"{n}={v!r}" for n, v in zip(col_names, r)
                )
                # 截断过长字段，避免刷屏
                if len(sample) > 300:
                    sample = sample[:300] + " ..."
                print(f"     {sample}")
        print()

    conn.close()
    print("分析完成。")


if __name__ == "__main__":
    main()
