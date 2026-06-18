import os
import psycopg2
from psycopg2.extras import RealDictCursor
from flask_login import UserMixin


class User(UserMixin):
    """Lightweight user object for flask-login; backed by the users table."""

    def __init__(self, user_id, username, email, role, email_verified, age_confirmed):
        self.id = str(user_id)          # flask-login uses .id
        self.user_id = str(user_id)
        self.username = username
        self.email = email
        self.role = role                # 'player' | 'admin'
        self.email_verified = email_verified
        self.age_confirmed = age_confirmed

    @property
    def is_admin(self):
        return self.role == "admin"

    @staticmethod
    def from_row(row):
        if row is None:
            return None
        return User(
            user_id=row["user_id"],
            username=row["username"],
            email=row["email"],
            role=row.get("role", "player"),
            email_verified=row["email_verified"],
            age_confirmed=row["age_confirmed"],
        )


def get_connection():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    if "sslmode" not in database_url:
        database_url += "?sslmode=require"
    return psycopg2.connect(database_url, cursor_factory=RealDictCursor)


def load_user_by_id(user_id: str):
    """Return a User object for flask-login's user_loader, or None."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT user_id, username, email, role, email_verified, age_confirmed "
                "FROM users WHERE user_id = %s",
                (user_id,),
            )
            return User.from_row(cur.fetchone())
    finally:
        conn.close()


def load_user_by_username(username: str):
    """Return a User object by username, or None."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT user_id, username, email, role, email_verified, age_confirmed "
                "FROM users WHERE username = %s",
                (username,),
            )
            return User.from_row(cur.fetchone())
    finally:
        conn.close()


def get_password_hash(username: str):
    """Return the stored password_hash for a username, or None."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT password_hash FROM users WHERE username = %s",
                (username,),
            )
            row = cur.fetchone()
            return row["password_hash"] if row else None
    finally:
        conn.close()


def create_user(username: str, email: str, password_hash: str, age_confirmed: bool, role: str = "player"):
    """Insert a new user row; raises psycopg2.errors.UniqueViolation on duplicate."""
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO users (username, email, password_hash, age_confirmed, role)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING user_id
                    """,
                    (username, email, password_hash, age_confirmed, role),
                )
                return str(cur.fetchone()["user_id"])
    finally:
        conn.close()


def init_db():
    conn = get_connection()
    with conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE EXTENSION IF NOT EXISTS "pgcrypto";

                CREATE TABLE IF NOT EXISTS users (
                    user_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                    username       TEXT        NOT NULL UNIQUE,
                    email          TEXT        NOT NULL UNIQUE,
                    password_hash  TEXT        NOT NULL,
                    email_verified BOOLEAN     NOT NULL DEFAULT FALSE,
                    age_confirmed  BOOLEAN     NOT NULL DEFAULT FALSE,
                    role           TEXT        NOT NULL DEFAULT 'player' CHECK(role IN ('player', 'admin')),
                    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS level_scores (
                    score_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id      UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                    level_number INTEGER     NOT NULL CHECK(level_number BETWEEN 1 AND 20),
                    best_time_ms INTEGER     NOT NULL,
                    loops_used   INTEGER     NOT NULL CHECK(loops_used BETWEEN 1 AND 5),
                    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE(user_id, level_number)
                );

                CREATE INDEX IF NOT EXISTS idx_level_scores_leaderboard
                    ON level_scores (level_number, best_time_ms ASC);

                CREATE TABLE IF NOT EXISTS overall_scores (
                    overall_score_id UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id          UUID        NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
                    total_time_ms    INTEGER     NOT NULL,
                    completed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS ghost_recordings (
                    recording_id UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id      UUID        REFERENCES users(user_id) ON DELETE SET NULL,
                    level_number INTEGER     NOT NULL CHECK(level_number BETWEEN 1 AND 20),
                    loop_number  INTEGER     NOT NULL CHECK(loop_number BETWEEN 1 AND 5),
                    session_id   TEXT        NOT NULL,
                    action_data  JSONB       NOT NULL DEFAULT '[]',
                    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

            """)
    conn.close()
