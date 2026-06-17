import os
import psycopg2
from psycopg2.extras import RealDictCursor


def get_connection():
    """Return a new psycopg2 connection using DATABASE_URL from the environment."""
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    return psycopg2.connect(database_url, cursor_factory=RealDictCursor)


def get_cursor(conn):
    """Return a RealDictCursor for the given connection."""
    return conn.cursor()
