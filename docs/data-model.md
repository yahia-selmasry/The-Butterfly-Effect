# Data Model — The Butterfly Effect

PostgreSQL database. Initialize by calling `database.init_db()` on first run.  
Connection is configured via the `DATABASE_URL` environment variable.

---

## Tables

### `users`

| Column           | Type        | Notes                                          |
|------------------|-------------|------------------------------------------------|
| `user_id`        | UUID        | Primary key, generated via `gen_random_uuid()` |
| `username`       | TEXT        | Unique; shown on leaderboards                  |
| `email`          | TEXT        | Unique; used for login and verification        |
| `password_hash`  | TEXT        | Hashed with werkzeug.security                  |
| `email_verified` | BOOLEAN     | False until verification link is clicked       |
| `age_confirmed`  | BOOLEAN     | Player confirmed age 13+ at registration       |
| `created_at`     | TIMESTAMPTZ | Account creation time, defaults to `NOW()`     |

---

### `level_scores`

| Column        | Type        | Notes                                                |
|---------------|-------------|------------------------------------------------------|
| `score_id`    | UUID        | Primary key                                          |
| `user_id`     | UUID        | FK → users.user_id, CASCADE delete                   |
| `level_number`| INTEGER     | 1–20 (enforced by CHECK constraint)                  |
| `best_time_ms`| INTEGER     | Personal best time in milliseconds                   |
| `loops_used`  | INTEGER     | Loop on which the vault was opened (1–5)             |
| `completed_at`| TIMESTAMPTZ | When this personal best was set                      |

One row per user per level (`UNIQUE(user_id, level_number)`). Upserted when the player beats their personal best.

**Index:** `idx_level_scores_leaderboard ON level_scores (level_number, best_time_ms ASC)` — keeps per-level leaderboard queries fast under concurrent load.

---

### `overall_scores`

| Column            | Type        | Notes                                          |
|-------------------|-------------|------------------------------------------------|
| `overall_score_id`| UUID        | Primary key                                    |
| `user_id`         | UUID        | Unique FK → users.user_id, CASCADE delete      |
| `total_time_ms`   | INTEGER     | Sum of `best_time_ms` across all 20 levels     |
| `completed_at`    | TIMESTAMPTZ | When Level 20 was completed                    |

One row per user. Updated whenever the player completes all 20 levels and improves their cumulative time.

---

### `ghost_recordings`

| Column        | Type        | Notes                                                        |
|---------------|-------------|--------------------------------------------------------------|
| `recording_id`| UUID        | Primary key                                                  |
| `user_id`     | UUID        | Nullable FK → users.user_id (NULL for guest players)         |
| `level_number`| INTEGER     | 1–20 (enforced by CHECK constraint)                          |
| `loop_number` | INTEGER     | 1–5 (enforced by CHECK constraint)                           |
| `session_id`  | TEXT        | Groups all loops belonging to the same play session          |
| `action_data` | JSONB       | Time-stamped sequence of player actions (ms timestamps)      |
| `recorded_at` | TIMESTAMPTZ | When this recording was made                                 |

**Ephemeral** — discarded when the session ends. Never shown on leaderboards, never persisted between sessions. For guests, stored in server memory only for the duration of the session.

---

## Helper Functions (`database.py`)

| Function       | Signature                  | Description                                      |
|----------------|----------------------------|--------------------------------------------------|
| `get_connection` | `() → psycopg2.Connection` | Returns a `RealDictCursor` connection via `DATABASE_URL` |
| `init_db`      | `() → None`                | Creates all tables and indexes if they don't exist |

All other database queries (inserts, leaderboard reads, upserts) live in `models.py`.

---

## Key Constraints

- Leaderboard reads hit `idx_level_scores_leaderboard` — never do a full table scan for leaderboard queries.
- `ghost_recordings.action_data` must store timestamps in **milliseconds**, not frames — see CLAUDE.md § Key Constraints.
- `overall_scores.total_time_ms` must always equal the sum of the player's `level_scores.best_time_ms` across all 20 levels — recalculate on every level completion.
