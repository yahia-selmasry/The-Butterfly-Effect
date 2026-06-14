# Data Model

See SPEC.md §4 for the full schema definition.

## Tables

### `users`
- `user_id` UUID PK
- `username` String unique
- `email` String unique
- `password_hash` String
- `email_verified` Boolean
- `age_confirmed` Boolean
- `created_at` Timestamp

### `level_scores`
- `score_id` UUID PK
- `user_id` UUID FK → users
- `level_number` Integer (1–20)
- `best_time_ms` Integer
- `loops_used` Integer (1–5)
- `completed_at` Timestamp

One row per user per level. Updated in place on personal best.

### `overall_scores`
- `overall_score_id` UUID PK
- `user_id` UUID FK → users
- `total_time_ms` Integer
- `completed_at` Timestamp

One row per user. Updated when all 20 levels are completed.

### `ghost_recordings`
- `recording_id` UUID PK
- `user_id` UUID FK → users (null for guests)
- `level_number` Integer (1–20)
- `loop_number` Integer (1–5)
- `session_id` String
- `action_data` JSON
- `recorded_at` Timestamp

Ephemeral — discarded after session ends.
