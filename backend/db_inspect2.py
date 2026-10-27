"""补充查询：精确行数 + routes 表文本字段采样 + 关键字段去重值概览"""
import psycopg2

conn = psycopg2.connect(host="127.0.0.1", port=5432, dbname="smart_traffic",
                        user="postgres", password="Zt20060509")
SCHEMA = "transport"

with conn.cursor() as cur:
    # 1. 精确行数
    cur.execute("""SELECT table_name FROM information_schema.tables
                   WHERE table_schema = %s AND table_type = 'BASE TABLE'
                   ORDER BY table_name""", (SCHEMA,))
    tables = [r[0] for r in cur.fetchall()]
    print("=== 各表精确行数 ===")
    for t in tables:
        cur.execute(f'SELECT count(*) FROM {SCHEMA}."{t}"')
        print(f"  {t}: {cur.fetchone()[0]} 行")

    # 2. routes 表前 3 行文本字段（排除 geom）
    print("\n=== chengdu_metro_routes 文本字段采样（前 3 行）===")
    cur.execute(f"""
        SELECT id, route_cn, route_en, city_code, route_type, company_cn,
               s_stop_cn, e_stop_cn, distance, total_stop,
               start_time, end_time, loop, status, basic_prc, total_prc,
               city_cn, merged_cnt, type_en, length
        FROM {SCHEMA}.chengdu_metro_routes ORDER BY id LIMIT 3
    """)
    cols = [d[0] for d in cur.description]
    for row in cur.fetchall():
        print("---")
        for c, v in zip(cols, row):
            print(f"  {c:<14}: {v}")

    # 3. stops 表线路去重概览
    print("\n=== chengdu_metro_stops 线路去重（route_cn 唯一值数 + 前 10）===")
    cur.execute(f"SELECT count(DISTINCT route_cn) FROM {SCHEMA}.chengdu_metro_stops")
    print(f"  线路数: {cur.fetchone()[0]}")
    cur.execute(f"""SELECT route_cn, count(*) AS stop_cnt
                    FROM {SCHEMA}.chengdu_metro_stops
                    GROUP BY route_cn ORDER BY route_cn LIMIT 10""")
    for r, c in cur.fetchall():
        print(f"  {r}: {c} 站")

    # 4. segments 表字段值分布采样
    print("\n=== chengdu_metro_segments：distance/num 取值概览 ===")
    cur.execute(f"""SELECT count(*), min(distance), max(distance), min(num), max(num)
                    FROM {SCHEMA}.chengdu_metro_segments""")
    r = cur.fetchone()
    print(f"  段数={r[0]}, distance min={r[1]} max={r[2]}, num min={r[3]} max={r[4]}")

conn.close()
