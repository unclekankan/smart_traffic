"""
数据库连接池配置

连接本机 PostgreSQL 的 smart_traffic 数据库，使用 psycopg2 线程安全连接池。
凭据支持环境变量覆盖，默认指向本机开发库。
"""

import os
from contextlib import contextmanager

from psycopg2.pool import ThreadedConnectionPool

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("DB_PORT", "5432")),
    "dbname": os.getenv("DB_NAME", "smart_traffic"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "Zt20060509"),
}

# 线程安全连接池，供 FastAPI 同步路由使用
_pool = ThreadedConnectionPool(minconn=1, maxconn=10, **DB_CONFIG)


@contextmanager
def get_conn():
    """从连接池取一个连接，使用完毕自动归还。"""
    conn = _pool.getconn()
    try:
        yield conn
    finally:
        _pool.putconn(conn)
