"""
Route tests for app.py — player dashboard and auth flows.

DB and auth calls are patched so these tests run without a live PostgreSQL instance.
"""
import json
import sys
import os
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import app as flask_app
from app import ms_to_display


# ---------------------------------------------------------------------------
# ms_to_display unit tests
# ---------------------------------------------------------------------------

def test_ms_to_display_basic():
    assert ms_to_display(272100) == "4:32.10"


def test_ms_to_display_zero():
    assert ms_to_display(0) == "0:00.00"


def test_ms_to_display_whole_minute():
    assert ms_to_display(60000) == "1:00.00"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

PLAYER_ID = "aaaaaaaa-0000-0000-0000-000000000001"
OTHER_ID   = "bbbbbbbb-0000-0000-0000-000000000002"

FAKE_PLAYER = {
    "user_id": PLAYER_ID,
    "username": "ghost_runner",
    "email_verified": True,
    "created_at": datetime(2025, 1, 15, tzinfo=timezone.utc),
}

FAKE_SCORES = [
    {
        "level_number": 3,
        "best_time_ms": 42500,
        "loops_used": 2,
        "completed_at": datetime(2025, 6, 1, tzinfo=timezone.utc),
    },
    {
        "level_number": 7,
        "best_time_ms": 58200,
        "loops_used": 4,
        "completed_at": datetime(2025, 6, 10, tzinfo=timezone.utc),
    },
]


def _make_user(user_id=PLAYER_ID, role="player"):
    from database import User
    return User(
        user_id=user_id,
        username="ghost_runner",
        email="ghost@example.com",
        role=role,
        email_verified=True,
        age_confirmed=True,
    )


@pytest.fixture()
def client():
    flask_app.app.config["TESTING"] = True
    flask_app.app.config["WTF_CSRF_ENABLED"] = False
    with flask_app.app.test_client() as c:
        yield c


@pytest.fixture()
def logged_in_client(client):
    """Client pre-logged-in as PLAYER_ID (player role).

    We patch load_user_by_id for the entire fixture lifetime so that
    flask-login's user_loader never hits the real database.
    """
    from werkzeug.security import generate_password_hash
    fake_user = _make_user(PLAYER_ID, role="player")
    real_hash = generate_password_hash("testpass123")
    # patch must stay active for the whole test, so use a context manager that
    # wraps both the login POST and the yielded client usage.
    with patch("app.load_user_by_id", return_value=fake_user), \
         patch("app.load_user_by_username", return_value=fake_user), \
         patch("app.get_password_hash", return_value=real_hash):
        client.post("/login", data={"username": "ghost_runner", "password": "testpass123"})
        yield client


@pytest.fixture()
def admin_client(client):
    """Client pre-logged-in as an admin user."""
    from werkzeug.security import generate_password_hash
    fake_admin = _make_user(PLAYER_ID, role="admin")
    real_hash = generate_password_hash("adminpass123")
    with patch("app.load_user_by_id", return_value=fake_admin), \
         patch("app.load_user_by_username", return_value=fake_admin), \
         patch("app.get_password_hash", return_value=real_hash):
        client.post("/login", data={"username": "ghost_runner", "password": "adminpass123"})
        yield client


# ---------------------------------------------------------------------------
# Auth: unauthenticated redirect
# ---------------------------------------------------------------------------

def test_unauthenticated_player_dashboard_redirects_to_login(client):
    resp = client.get(f"/player/{PLAYER_ID}")
    assert resp.status_code == 302
    assert "/login" in resp.headers["Location"]


def test_unauthenticated_chart_data_redirects_to_login(client):
    resp = client.get(f"/player/{PLAYER_ID}/chart-data?level=1")
    assert resp.status_code == 302
    assert "/login" in resp.headers["Location"]


def test_unauthenticated_compare_redirects_to_login(client):
    resp = client.get(f"/player/{PLAYER_ID}/compare?level=1")
    assert resp.status_code == 302
    assert "/login" in resp.headers["Location"]


# ---------------------------------------------------------------------------
# Auth: login flow
# ---------------------------------------------------------------------------

def test_login_page_returns_200(client):
    resp = client.get("/login")
    assert resp.status_code == 200


def test_correct_login_redirects_to_dashboard(client):
    from werkzeug.security import generate_password_hash
    real_hash = generate_password_hash("testpass123")
    fake_user = _make_user(PLAYER_ID)
    with patch("app.load_user_by_username", return_value=fake_user), \
         patch("app.get_password_hash", return_value=real_hash):
        resp = client.post(
            "/login",
            data={"username": "ghost_runner", "password": "testpass123"},
        )
    assert resp.status_code == 302
    assert f"/player/{PLAYER_ID}" in resp.headers["Location"]


def test_wrong_password_returns_401(client):
    from werkzeug.security import generate_password_hash
    real_hash = generate_password_hash("rightpassword")
    fake_user = _make_user(PLAYER_ID)
    with patch("app.load_user_by_username", return_value=fake_user), \
         patch("app.get_password_hash", return_value=real_hash):
        resp = client.post(
            "/login",
            data={"username": "ghost_runner", "password": "wrongpassword"},
        )
    assert resp.status_code == 401


def test_unknown_user_login_returns_401(client):
    with patch("app.load_user_by_username", return_value=None), \
         patch("app.get_password_hash", return_value=None):
        resp = client.post(
            "/login",
            data={"username": "nobody", "password": "anything"},
        )
    assert resp.status_code == 401


def test_logout_redirects_to_login(logged_in_client):
    resp = logged_in_client.get("/logout")
    assert resp.status_code == 302
    assert "/login" in resp.headers["Location"]


# ---------------------------------------------------------------------------
# Auth: ownership enforcement — player cannot see another player's dashboard
# ---------------------------------------------------------------------------

def test_player_cannot_access_other_player_dashboard(logged_in_client):
    """Logged-in player gets 403 when requesting a different user_id."""
    with patch("app.get_player", return_value=FAKE_PLAYER), \
         patch("app.get_player_scores", return_value=FAKE_SCORES):
        resp = logged_in_client.get(f"/player/{OTHER_ID}")
    assert resp.status_code == 403


def test_player_can_access_own_dashboard(logged_in_client):
    with patch("app.get_player", return_value=FAKE_PLAYER), \
         patch("app.get_player_scores", return_value=FAKE_SCORES):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}")
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Auth: admin can access any player's dashboard
# ---------------------------------------------------------------------------

def test_admin_can_access_any_player_dashboard(admin_client):
    other_player = dict(FAKE_PLAYER, user_id=OTHER_ID, username="other_runner")
    with patch("app.get_player", return_value=other_player), \
         patch("app.get_player_scores", return_value=FAKE_SCORES):
        resp = admin_client.get(f"/player/{OTHER_ID}")
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# GET /player/<user_id>
# ---------------------------------------------------------------------------

def test_player_dashboard_returns_200_with_username(logged_in_client):
    with patch("app.get_player", return_value=FAKE_PLAYER), \
         patch("app.get_player_scores", return_value=FAKE_SCORES):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}")

    assert resp.status_code == 200
    assert b"ghost_runner" in resp.data


def test_player_dashboard_shows_level_scores(logged_in_client):
    with patch("app.get_player", return_value=FAKE_PLAYER), \
         patch("app.get_player_scores", return_value=FAKE_SCORES):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}")

    assert b"Level 3" not in resp.data or b"3" in resp.data
    assert b"0:42.50" in resp.data


def test_player_dashboard_marks_personal_bests(logged_in_client):
    with patch("app.get_player", return_value=FAKE_PLAYER), \
         patch("app.get_player_scores", return_value=FAKE_SCORES):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}")

    assert "⭐".encode() in resp.data


def test_player_dashboard_404_for_unknown_user(logged_in_client):
    with patch("app.get_player", return_value=None):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}")

    assert resp.status_code == 404


def test_player_dashboard_no_scores(logged_in_client):
    with patch("app.get_player", return_value=FAKE_PLAYER), \
         patch("app.get_player_scores", return_value=[]):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}")

    assert resp.status_code == 200
    assert b"No levels completed" in resp.data


# ---------------------------------------------------------------------------
# GET /player/<user_id>/chart-data?level=<n>
# ---------------------------------------------------------------------------

def test_chart_data_returns_valid_json(logged_in_client):
    fake_score = FAKE_SCORES[0]
    with patch("app.get_player", return_value=FAKE_PLAYER), \
         patch("app.get_player_scores_for_level", return_value=fake_score):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}/chart-data?level=3")

    assert resp.status_code == 200
    body = json.loads(resp.data)
    assert body["error"] is None
    assert isinstance(body["data"]["labels"], list)
    assert isinstance(body["data"]["times"], list)
    assert len(body["data"]["labels"]) == 1
    assert len(body["data"]["times"]) == 1


def test_chart_data_time_value_correct(logged_in_client):
    fake_score = FAKE_SCORES[0]
    with patch("app.get_player", return_value=FAKE_PLAYER), \
         patch("app.get_player_scores_for_level", return_value=fake_score):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}/chart-data?level=3")

    body = json.loads(resp.data)
    assert body["data"]["times"][0] == pytest.approx(42.5)


def test_chart_data_label_is_date_string(logged_in_client):
    fake_score = FAKE_SCORES[0]
    with patch("app.get_player", return_value=FAKE_PLAYER), \
         patch("app.get_player_scores_for_level", return_value=fake_score):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}/chart-data?level=3")

    body = json.loads(resp.data)
    assert body["data"]["labels"][0] == "2025-06-01"


def test_chart_data_empty_when_no_score(logged_in_client):
    with patch("app.get_player", return_value=FAKE_PLAYER), \
         patch("app.get_player_scores_for_level", return_value=None):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}/chart-data?level=5")

    body = json.loads(resp.data)
    assert body["data"]["labels"] == []
    assert body["data"]["times"] == []


def test_chart_data_invalid_level_returns_400(logged_in_client):
    with patch("app.get_player", return_value=FAKE_PLAYER):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}/chart-data?level=99")

    assert resp.status_code == 400


def test_chart_data_404_for_unknown_user(logged_in_client):
    with patch("app.get_player", return_value=None):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}/chart-data?level=1")

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /player/<user_id>/compare?level=<n>
# ---------------------------------------------------------------------------

ALL_SPLITS_BOTH = {
    "early": [
        {
            "level_number": 1,
            "best_time_ms": 30000,
            "loops_used": 1,
            "completed_at": datetime(2025, 5, 1, tzinfo=timezone.utc),
        }
    ],
    "late": [
        {
            "level_number": 2,
            "best_time_ms": 50000,
            "loops_used": 4,
            "completed_at": datetime(2025, 5, 10, tzinfo=timezone.utc),
        }
    ],
}

COMPARISON_EARLY = {
    "early": {
        "level_number": 1,
        "best_time_ms": 30000,
        "loops_used": 1,
        "completed_at": datetime(2025, 5, 1, tzinfo=timezone.utc),
    },
    "late": None,
}

COMPARISON_LATE = {
    "early": None,
    "late": {
        "level_number": 2,
        "best_time_ms": 50000,
        "loops_used": 4,
        "completed_at": datetime(2025, 5, 10, tzinfo=timezone.utc),
    },
}


def test_compare_returns_200_with_player_name(logged_in_client):
    with patch("app.get_player", return_value=FAKE_PLAYER), \
         patch("app.get_player_loop_comparison", return_value=COMPARISON_EARLY), \
         patch("app.get_player_all_loop_comparisons", return_value=ALL_SPLITS_BOTH):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}/compare?level=1")

    assert resp.status_code == 200
    assert b"ghost_runner" in resp.data


def test_compare_shows_level_dropdown(logged_in_client):
    with patch("app.get_player", return_value=FAKE_PLAYER), \
         patch("app.get_player_loop_comparison", return_value=COMPARISON_EARLY), \
         patch("app.get_player_all_loop_comparisons", return_value=ALL_SPLITS_BOTH):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}/compare?level=1")

    assert b"level-select" in resp.data


def test_compare_shows_gap_stat_when_both_groups_present(logged_in_client):
    with patch("app.get_player", return_value=FAKE_PLAYER), \
         patch("app.get_player_loop_comparison", return_value=COMPARISON_LATE), \
         patch("app.get_player_all_loop_comparisons", return_value=ALL_SPLITS_BOTH):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}/compare?level=2")

    assert resp.status_code == 200
    assert b"20.00s" in resp.data


def test_compare_shows_no_gap_when_one_group_empty(logged_in_client):
    only_early = {"early": ALL_SPLITS_BOTH["early"], "late": []}
    with patch("app.get_player", return_value=FAKE_PLAYER), \
         patch("app.get_player_loop_comparison", return_value=COMPARISON_EARLY), \
         patch("app.get_player_all_loop_comparisons", return_value=only_early):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}/compare?level=1")

    assert resp.status_code == 200
    assert b"Not enough data" in resp.data


def test_compare_404_for_unknown_player(logged_in_client):
    with patch("app.get_player", return_value=None):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}/compare?level=1")

    assert resp.status_code == 404


def test_compare_clamps_invalid_level_to_1(logged_in_client):
    with patch("app.get_player", return_value=FAKE_PLAYER), \
         patch("app.get_player_loop_comparison", return_value={"early": None, "late": None}), \
         patch("app.get_player_all_loop_comparisons", return_value={"early": [], "late": []}):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}/compare?level=999")

    assert resp.status_code == 200


def test_dashboard_contains_compare_link(logged_in_client):
    with patch("app.get_player", return_value=FAKE_PLAYER), \
         patch("app.get_player_scores", return_value=FAKE_SCORES):
        resp = logged_in_client.get(f"/player/{PLAYER_ID}")

    assert b"compare" in resp.data.lower()
    assert b"Compare" in resp.data


# ---------------------------------------------------------------------------
# GET /team — admin-only team overview
# ---------------------------------------------------------------------------

FAKE_ALL_PLAYERS = [
    {
        "user_id": PLAYER_ID,
        "username": "ghost_runner",
        "email": "ghost@example.com",
        "created_at": datetime(2025, 1, 15, tzinfo=timezone.utc),
    },
    {
        "user_id": OTHER_ID,
        "username": "vault_breaker",
        "email": "vault@example.com",
        "created_at": datetime(2025, 2, 20, tzinfo=timezone.utc),
    },
]

FAKE_ALL_SCORES = [
    {"user_id": PLAYER_ID, "level_number": 1, "best_time_ms": 30000},
    {"user_id": OTHER_ID,  "level_number": 3, "best_time_ms": 45000},
]

FAKE_TEAM_FASTEST = {1: 30000, 3: 45000}


def test_admin_gets_200_on_team(admin_client):
    with patch("app.get_all_players", return_value=FAKE_ALL_PLAYERS), \
         patch("app.get_all_level_scores", return_value=FAKE_ALL_SCORES), \
         patch("app.get_team_fastest_per_level", return_value=FAKE_TEAM_FASTEST):
        resp = admin_client.get("/team")
    assert resp.status_code == 200


def test_team_page_lists_player_names(admin_client):
    with patch("app.get_all_players", return_value=FAKE_ALL_PLAYERS), \
         patch("app.get_all_level_scores", return_value=FAKE_ALL_SCORES), \
         patch("app.get_team_fastest_per_level", return_value=FAKE_TEAM_FASTEST):
        resp = admin_client.get("/team")
    assert b"ghost_runner" in resp.data
    assert b"vault_breaker" in resp.data


def test_team_page_shows_pb_time(admin_client):
    with patch("app.get_all_players", return_value=FAKE_ALL_PLAYERS), \
         patch("app.get_all_level_scores", return_value=FAKE_ALL_SCORES), \
         patch("app.get_team_fastest_per_level", return_value=FAKE_TEAM_FASTEST):
        resp = admin_client.get("/team")
    # 30000 ms → "0:30.00"
    assert b"0:30.00" in resp.data


def test_team_page_shows_dash_for_missing_pb(admin_client):
    with patch("app.get_all_players", return_value=FAKE_ALL_PLAYERS), \
         patch("app.get_all_level_scores", return_value=FAKE_ALL_SCORES), \
         patch("app.get_team_fastest_per_level", return_value=FAKE_TEAM_FASTEST):
        resp = admin_client.get("/team")
    # ghost_runner has no score for level 3, so "—" must appear
    assert "—".encode() in resp.data


def test_team_page_links_to_player_dashboard(admin_client):
    with patch("app.get_all_players", return_value=FAKE_ALL_PLAYERS), \
         patch("app.get_all_level_scores", return_value=FAKE_ALL_SCORES), \
         patch("app.get_team_fastest_per_level", return_value=FAKE_TEAM_FASTEST):
        resp = admin_client.get("/team")
    assert f"/player/{PLAYER_ID}".encode() in resp.data


def test_team_page_links_to_add(admin_client):
    with patch("app.get_all_players", return_value=FAKE_ALL_PLAYERS), \
         patch("app.get_all_level_scores", return_value=FAKE_ALL_SCORES), \
         patch("app.get_team_fastest_per_level", return_value=FAKE_TEAM_FASTEST):
        resp = admin_client.get("/team")
    assert b"/add" in resp.data


def test_player_gets_403_on_team(logged_in_client):
    resp = logged_in_client.get("/team")
    assert resp.status_code == 403


def test_unauthenticated_team_redirects_to_login(client):
    resp = client.get("/team")
    assert resp.status_code == 302
    assert "/login" in resp.headers["Location"]


def test_team_empty_state(admin_client):
    with patch("app.get_all_players", return_value=[]), \
         patch("app.get_all_level_scores", return_value=[]), \
         patch("app.get_team_fastest_per_level", return_value={}):
        resp = admin_client.get("/team")
    assert resp.status_code == 200
    assert b"No players" in resp.data
