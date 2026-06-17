"""
Smoke tests for database.py.

These tests require a real PostgreSQL instance reachable via DATABASE_URL.
They run against a throwaway schema and clean up after themselves.
"""
import os
import pytest
import psycopg2
from psycopg2.extras import RealDictCursor


@pytest.fixture(scope="module")
def conn():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        pytest.skip("DATABASE_URL not set — skipping DB tests")
    c = psycopg2.connect(database_url, cursor_factory=RealDictCursor)
    yield c
    c.close()


def test_init_db_creates_tables(conn):
    from database import init_db
    init_db()
    with conn.cursor() as cur:
        cur.execute("""
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name IN ('users', 'level_scores', 'overall_scores', 'ghost_recordings')
            ORDER BY table_name
        """)
        tables = {row["table_name"] for row in cur.fetchall()}
    assert tables == {"users", "level_scores", "overall_scores", "ghost_recordings"}


def test_leaderboard_index_exists(conn):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT indexname FROM pg_indexes
            WHERE tablename = 'level_scores'
            AND indexname = 'idx_level_scores_leaderboard'
        """)
        assert cur.fetchone() is not None


def test_users_unique_constraints(conn):
    from database import init_db
    init_db()
    with conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO users (username, email, password_hash)
                VALUES ('test_user_dup', 'dup@example.com', 'hash')
                ON CONFLICT DO NOTHING
            """)
    # Inserting the same username again must raise
    with pytest.raises(psycopg2.errors.UniqueViolation):
        with conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO users (username, email, password_hash)
                    VALUES ('test_user_dup', 'other@example.com', 'hash')
                """)
    conn.rollback()


def test_level_scores_level_number_constraint(conn):
    """level_number must be between 1 and 20."""
    from database import init_db
    init_db()
    # Insert a throwaway user to satisfy the FK
    with conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO users (username, email, password_hash)
                VALUES ('constraint_test_user', 'ct@example.com', 'hash')
                RETURNING user_id
            """)
            user_id = cur.fetchone()["user_id"]

    with pytest.raises(psycopg2.errors.CheckViolation):
        with conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO level_scores (user_id, level_number, best_time_ms, loops_used)
                    VALUES (%s, 21, 50000, 3)
                """, (user_id,))
    conn.rollback()


def test_ghost_recordings_user_id_nullable(conn):
    """ghost_recordings.user_id is nullable (guest players have no account)."""
    from database import init_db
    init_db()
    with conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO ghost_recordings
                    (user_id, level_number, loop_number, session_id, action_data)
                VALUES (NULL, 1, 1, 'guest-session-001', '[]')
                RETURNING recording_id
            """)
            row = cur.fetchone()
    assert row["recording_id"] is not None
