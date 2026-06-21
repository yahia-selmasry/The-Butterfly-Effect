import os

from flask import Flask, abort, flash, jsonify, redirect, render_template, request, url_for
from flask_login import (
    LoginManager,
    current_user,
    login_required,
    login_user,
    logout_user,
)
from werkzeug.security import check_password_hash, generate_password_hash

import psycopg2.errors

from database import (
    create_user,
    get_password_hash,
    load_user_by_id,
    load_user_by_username,
)
from models import (
    get_all_level_scores,
    get_all_players,
    get_player,
    get_player_all_loop_comparisons,
    get_player_loop_comparison,
    get_player_scores,
    get_player_scores_for_level,
    get_team_fastest_per_level,
    upsert_level_score,
)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-in-production")

login_manager = LoginManager(app)
login_manager.login_view = "login"
login_manager.login_message = "Please log in to access this page."

LEVELS = list(range(1, 21))  # levels 1-20


@login_manager.user_loader
def user_loader(user_id):
    return load_user_by_id(user_id)


def ms_to_display(ms: int) -> str:
    """Convert milliseconds to MM:SS.cs string (e.g. 272100 → '4:32.10')."""
    minutes = int(ms // 60000)
    whole_seconds = int((ms % 60000) // 1000)
    centiseconds = (ms // 10) % 100
    return f"{minutes}:{whole_seconds:02d}.{centiseconds:02d}"


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------

@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("player_dashboard", user_id=current_user.user_id))

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        try:
            user = load_user_by_username(username)
            stored_hash = get_password_hash(username) if user else None
        except Exception as e:
            app.logger.error("DB error on login: %s", e)
            flash(f"Database error: {e}", "error")
            return render_template("login.html"), 500

        if user is None or stored_hash is None or not check_password_hash(stored_hash, password):
            flash("Invalid username or password.", "error")
            return render_template("login.html"), 401

        login_user(user)
        next_page = request.args.get("next")
        return redirect(next_page or url_for("play"))

    return render_template("login.html")


@app.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for("login"))


@app.route("/register", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        return redirect(url_for("player_dashboard", user_id=current_user.user_id))

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        email = request.form.get("email", "").strip()
        password = request.form.get("password", "")
        age_confirmed = request.form.get("age_confirmed") == "on"

        errors = []
        if not username:
            errors.append("Username is required.")
        if not email:
            errors.append("Email is required.")
        if len(password) < 8:
            errors.append("Password must be at least 8 characters.")
        if not age_confirmed:
            errors.append("You must confirm you are 13 or older.")

        if errors:
            for msg in errors:
                flash(msg, "error")
            return render_template("register.html"), 400

        hashed = generate_password_hash(password)
        try:
            create_user(username, email, hashed, age_confirmed)
        except Exception:
            flash("Username or email already taken.", "error")
            return render_template("register.html"), 409

        flash("Account created! Please log in.", "success")
        return redirect(url_for("login"))

    return render_template("register.html")


# ---------------------------------------------------------------------------
# Debug route — remove after fixing schema
# ---------------------------------------------------------------------------

@app.route("/debug/schema")
def debug_schema():
    from database import get_connection
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT table_name, column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public'
                ORDER BY table_name, ordinal_position
            """)
            rows = cur.fetchall()
        return jsonify({"data": [dict(r) for r in rows], "error": None})
    except Exception as e:
        return jsonify({"data": None, "error": str(e)})
    finally:
        conn.close()


@app.route("/debug/initdb")
def debug_initdb():
    from database import get_connection
    import psycopg2
    conn = get_connection()
    conn.autocommit = True  # DDL outside transaction block avoids partial-rollback issues
    try:
        with conn.cursor() as cur:
            cur.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')
            cur.execute("DROP TABLE IF EXISTS ghost_recordings CASCADE")
            cur.execute("DROP TABLE IF EXISTS level_scores CASCADE")
            cur.execute("DROP TABLE IF EXISTS overall_scores CASCADE")
            cur.execute("DROP TABLE IF EXISTS users CASCADE")
            cur.execute("DROP TABLE IF EXISTS posts CASCADE")
            cur.execute("DROP TABLE IF EXISTS sessions CASCADE")
            cur.execute("""
                CREATE TABLE users (
                    user_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                    username       TEXT        NOT NULL UNIQUE,
                    email          TEXT        NOT NULL UNIQUE,
                    password_hash  TEXT        NOT NULL,
                    email_verified BOOLEAN     NOT NULL DEFAULT FALSE,
                    age_confirmed  BOOLEAN     NOT NULL DEFAULT FALSE,
                    role           TEXT        NOT NULL DEFAULT 'player' CHECK(role IN ('player', 'admin')),
                    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE TABLE level_scores (
                    score_id     UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id      UUID    NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                    level_number INTEGER NOT NULL CHECK(level_number BETWEEN 1 AND 20),
                    best_time_ms INTEGER NOT NULL,
                    loops_used   INTEGER NOT NULL CHECK(loops_used BETWEEN 1 AND 5),
                    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE(user_id, level_number)
                )
            """)
            cur.execute("CREATE INDEX idx_level_scores_leaderboard ON level_scores (level_number, best_time_ms ASC)")
            cur.execute("""
                CREATE TABLE overall_scores (
                    overall_score_id UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id          UUID    NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
                    total_time_ms    INTEGER NOT NULL,
                    completed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
        return jsonify({"data": "Schema created successfully", "error": None})
    except Exception as e:
        return jsonify({"data": None, "error": str(e)})
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Public routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    if current_user.is_authenticated:
        return redirect(url_for("play"))
    return redirect(url_for("login"))


@app.route("/play")
def play():
    return render_template("game.html")


@app.route("/api/score", methods=["POST"])
def submit_score():
    if not current_user.is_authenticated:
        return jsonify({"data": None, "error": None}), 200  # guests silently ignored

    data = request.get_json(silent=True) or {}
    level_number = data.get("level_number")
    time_ms = data.get("time_ms")
    loops_used = data.get("loops_used")

    if not isinstance(level_number, int) or level_number not in LEVELS:
        return jsonify({"data": None, "error": "invalid level_number"}), 400
    if not isinstance(time_ms, int) or time_ms <= 0:
        return jsonify({"data": None, "error": "invalid time_ms"}), 400
    if not isinstance(loops_used, int) or loops_used not in range(1, 6):
        return jsonify({"data": None, "error": "invalid loops_used"}), 400

    upsert_level_score(current_user.user_id, level_number, time_ms, loops_used)
    return jsonify({"data": {"saved": True}, "error": None}), 200


# ---------------------------------------------------------------------------
# Protected routes
# ---------------------------------------------------------------------------

@app.route("/player/<user_id>")
@login_required
def player_dashboard(user_id: str):
    # Players can only view their own dashboard; admins can view any.
    if not current_user.is_admin and current_user.user_id != user_id:
        abort(403)

    player = get_player(user_id)
    if player is None:
        abort(404)

    scores = get_player_scores(user_id)

    rows = []
    for score in scores:
        rows.append({
            "level_number": score["level_number"],
            "best_time_ms": score["best_time_ms"],
            "time_display": ms_to_display(score["best_time_ms"]),
            "loops_used": score["loops_used"],
            "completed_at": score["completed_at"],
            "is_personal_best": True,
        })

    default_level = rows[0]["level_number"] if rows else 1

    return render_template(
        "dashboard.html",
        player=player,
        rows=rows,
        levels=LEVELS,
        default_level=default_level,
    )


@app.route("/player/<user_id>/chart-data")
@login_required
def player_chart_data(user_id: str):
    if not current_user.is_admin and current_user.user_id != user_id:
        abort(403)

    player = get_player(user_id)
    if player is None:
        abort(404)

    try:
        level = int(request.args.get("level", 1))
    except (TypeError, ValueError):
        return jsonify({"data": None, "error": "level must be an integer"}), 400

    if level not in LEVELS:
        return jsonify({"data": None, "error": "level must be between 1 and 20"}), 400

    score = get_player_scores_for_level(user_id, level)

    if score is None:
        return jsonify({"data": {"labels": [], "times": []}, "error": None})

    completed_at = score["completed_at"]
    label = completed_at.strftime("%Y-%m-%d") if hasattr(completed_at, "strftime") else str(completed_at)[:10]

    return jsonify({
        "data": {
            "labels": [label],
            "times": [round(score["best_time_ms"] / 1000, 3)],
        },
        "error": None,
    })


@app.route("/player/<user_id>/compare")
@login_required
def player_compare(user_id: str):
    if not current_user.is_admin and current_user.user_id != user_id:
        abort(403)

    player = get_player(user_id)
    if player is None:
        abort(404)

    try:
        level = int(request.args.get("level", 1))
    except (TypeError, ValueError):
        level = 1

    if level not in LEVELS:
        level = 1

    # Per-level split for the two-line chart
    comparison = get_player_loop_comparison(user_id, level)

    # Cross-level aggregates for the stats box
    all_splits = get_player_all_loop_comparisons(user_id)
    early_rows = all_splits["early"]
    late_rows  = all_splits["late"]

    def avg_ms(rows):
        if not rows:
            return None
        return sum(r["best_time_ms"] for r in rows) / len(rows)

    avg_early_ms = avg_ms(early_rows)
    avg_late_ms  = avg_ms(late_rows)

    if avg_early_ms is not None and avg_late_ms is not None:
        gap_ms  = avg_late_ms - avg_early_ms
        gap_pct = (gap_ms / avg_late_ms) * 100
    else:
        gap_ms  = None
        gap_pct = None

    def _chart_point(row):
        if row is None:
            return None
        completed_at = row["completed_at"]
        label = completed_at.strftime("%Y-%m-%d") if hasattr(completed_at, "strftime") else str(completed_at)[:10]
        return {"label": label, "time_s": round(row["best_time_ms"] / 1000, 3)}

    return render_template(
        "compare.html",
        player=player,
        levels=LEVELS,
        selected_level=level,
        early_point=_chart_point(comparison["early"]),
        late_point=_chart_point(comparison["late"]),
        avg_early_ms=avg_early_ms,
        avg_late_ms=avg_late_ms,
        avg_early_display=ms_to_display(round(avg_early_ms)) if avg_early_ms is not None else None,
        avg_late_display=ms_to_display(round(avg_late_ms))  if avg_late_ms  is not None else None,
        early_count=len(early_rows),
        late_count=len(late_rows),
        gap_ms=gap_ms,
        gap_pct=gap_pct,
    )


@app.route("/team")
@login_required
def team_dashboard():
    if not current_user.is_admin:
        abort(403)

    players = get_all_players()
    all_scores = get_all_level_scores()
    team_fastest = get_team_fastest_per_level()

    # Build per-player PB lookup: {user_id: {level_number: best_time_ms}}
    pb_by_player = {}
    for row in all_scores:
        uid = str(row["user_id"])
        pb_by_player.setdefault(uid, {})[row["level_number"]] = row["best_time_ms"]

    player_rows = []
    for p in players:
        uid = str(p["user_id"])
        player_rows.append({
            "user_id": uid,
            "username": p["username"],
            "created_at": p["created_at"],
            "pbs": pb_by_player.get(uid, {}),
        })

    return render_template(
        "team.html",
        player_rows=player_rows,
        levels=LEVELS,
        team_fastest=team_fastest,
        ms_to_display=ms_to_display,
    )


@app.route("/add")
@login_required
def add_score():
    if not current_user.is_admin:
        abort(403)
    return render_template("add.html")


if __name__ == "__main__":
    app.run(debug=True)
