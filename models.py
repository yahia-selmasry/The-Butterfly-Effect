# Database query helpers — see docs/data-model.md for full schema.
# All queries go here; never inline SQL in API routes.

from database import get_connection


def get_player(user_id: str):
    """Return the users row for user_id, or None if not found."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT user_id, username, email_verified, created_at FROM users WHERE user_id = %s",
                (user_id,),
            )
            return cur.fetchone()
    finally:
        conn.close()


def get_player_scores(user_id: str):
    """Return all level_scores rows for a player, ordered by level_number ASC.

    Each row already represents the player's personal best for that level —
    level_scores stores one row per (user_id, level_number) by design.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT level_number, best_time_ms, loops_used, completed_at
                FROM   level_scores
                WHERE  user_id = %s
                ORDER  BY level_number ASC
                """,
                (user_id,),
            )
            return cur.fetchall()
    finally:
        conn.close()


def get_player_scores_for_level(user_id: str, level_number: int):
    """Return the single personal-best row for (user_id, level_number), or None."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT level_number, best_time_ms, loops_used, completed_at
                FROM   level_scores
                WHERE  user_id = %s AND level_number = %s
                """,
                (user_id, level_number),
            )
            return cur.fetchone()
    finally:
        conn.close()


def get_player_loop_comparison(user_id: str, level_number: int):
    """Return loop-efficiency breakdown for one player on one level.

    level_scores holds one row per level — the personal best.  We split it
    into two buckets by loops_used so the compare view can show early-loop
    clears (loops 1-2) vs late-loop clears (loops 3-5).

    Returns a dict:
      {
        "early": {"best_time_ms": int, "loops_used": int, "completed_at": ...} | None,
        "late":  {"best_time_ms": int, "loops_used": int, "completed_at": ...} | None,
      }

    At most one of the two will be non-None (a score can only be in one bucket).
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT level_number, best_time_ms, loops_used, completed_at
                FROM   level_scores
                WHERE  user_id = %s AND level_number = %s
                """,
                (user_id, level_number),
            )
            row = cur.fetchone()
    finally:
        conn.close()

    if row is None:
        return {"early": None, "late": None}

    if row["loops_used"] <= 2:
        return {"early": dict(row), "late": None}
    return {"early": None, "late": dict(row)}


def get_all_players():
    """Return all users rows, ordered by created_at ASC then username ASC."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT user_id, username, email, created_at
                FROM   users
                ORDER  BY created_at ASC, username ASC
                """,
            )
            return cur.fetchall()
    finally:
        conn.close()


def get_all_level_scores():
    """Return every level_scores row for all players.

    Used by the team dashboard to build the per-player PB grid.
    Returns a list of rows: user_id, level_number, best_time_ms.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT user_id, level_number, best_time_ms
                FROM   level_scores
                ORDER  BY user_id, level_number ASC
                """
            )
            return cur.fetchall()
    finally:
        conn.close()


def get_team_fastest_per_level():
    """Return the team's fastest best_time_ms per level across all players.

    Returns a dict mapping level_number (int) → best_time_ms (int).
    Levels with no scores at all are absent from the dict.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT level_number, MIN(best_time_ms) AS best_time_ms
                FROM   level_scores
                GROUP  BY level_number
                ORDER  BY level_number ASC
                """
            )
            return {row["level_number"]: row["best_time_ms"] for row in cur.fetchall()}
    finally:
        conn.close()


def get_player_all_loop_comparisons(user_id: str):
    """Return every level score for a player, pre-split into early/late buckets.

    Used to compute aggregate stats across all completed levels.
    Returns {"early": [rows…], "late": [rows…]}.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT level_number, best_time_ms, loops_used, completed_at
                FROM   level_scores
                WHERE  user_id = %s
                ORDER  BY level_number ASC
                """,
                (user_id,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    early = [dict(r) for r in rows if r["loops_used"] <= 2]
    late  = [dict(r) for r in rows if r["loops_used"] >  2]
    return {"early": early, "late": late}
