# API Routes

## Auth

### `GET /login`
Renders the login form. Redirects to the player's own dashboard if already authenticated.

### `POST /login`
Authenticates a player.

**Form fields:** `username`, `password`

**Success:** `302` redirect to `/player/<user_id>` (or the `?next=` param if set).  
**Failure:** `401` with the login form re-rendered and a flash error message.

---

### `GET /logout`
Ends the current session and redirects to `/login`. Requires login.

---

### `GET /register`
Renders the account creation form. Redirects to dashboard if already authenticated.

### `POST /register`
Creates a new player account.

**Form fields:** `username`, `email`, `password` (min 8 chars), `age_confirmed` (checkbox)

**Success:** `302` redirect to `/login` with a success flash message.  
**Failure:** `400` validation errors or `409` duplicate username/email, form re-rendered with flash errors.

**Rules enforced:**
- Username and email must be unique.
- Password must be at least 8 characters (hashed with `werkzeug.security.generate_password_hash`).
- Player must confirm age 13+.
- Plain-text passwords are never stored or logged.

---

## Access Control

All `/player/*` routes require login (`@login_required`). Unauthenticated requests redirect to `/login`.

| Role     | Own dashboard | Other player's dashboard |
|----------|---------------|--------------------------|
| `player` | ✅ allowed    | ❌ 403                   |
| `admin`  | ✅ allowed    | ✅ allowed               |

Roles are stored in `users.role` (`'player'` or `'admin'`). Default role on registration is `'player'`.

---

## Player Dashboard

### `GET /player/<user_id>`
Player profile: username, level scores table (every row is a personal best, marked ⭐), and a Chart.js line chart of best times per level.

**Auth:** login required; player can only view their own `user_id`. Admins can view any.  
**Errors:** `403` wrong player, `404` unknown user_id.

---

### `GET /player/<user_id>/chart-data?level=<1-20>`
JSON endpoint for the progress chart.

**Auth:** login required; player can only query their own `user_id`. Admins can query any.

**Query params:** `level` (integer 1–20, required)

**Success response `200`:**
```json
{ "data": { "labels": ["2025-06-01"], "times": [42.5] }, "error": null }
```
Times are in **seconds** (float). Labels are ISO date strings (`YYYY-MM-DD`). Empty arrays when the player has no score for that level.

**Error responses:** `400` bad/out-of-range level, `403` wrong player, `404` unknown user_id.

---

### `GET /player/<user_id>/compare?level=<1-20>`
Loop-efficiency comparison page.

**Auth:** login required; player can only view their own `user_id`. Admins can view any.

Splits the player's personal-best scores into two groups by `loops_used`:
- **Early clears** (loops 1–2): vault cracked quickly
- **Late clears** (loops 3–5): needed more attempts

Renders a two-line Chart.js chart (red = early, blue = late) for the selected level, plus a summary stats box with avg best time per group and the gap in seconds and percentage. Level dropdown reloads the page. Invalid level params are clamped to 1.

**Error responses:** `403` wrong player, `404` unknown user_id.

---

## Game (planned)
- `GET /play/<level>` — load a level
- `POST /score` — submit level completion time
- `GET /leaderboard/<level>` — per-level leaderboard
- `GET /leaderboard/overall` — all-20-levels leaderboard

## Ghosts (session-scoped, planned)
- `POST /ghost/record` — save a loop recording
- `GET /ghost/<level>/<loop>` — retrieve ghost data for playback
