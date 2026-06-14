# The Butterfly Effect — V1 Product Specification

**Version:** 1.0  
**Date:** June 14, 2026  
**Status:** Draft for Review

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Target Users](#2-target-users)
3. [Core Features (V1)](#3-core-features-v1)
4. [Data Model](#4-data-model)
5. [Out of Scope for V1](#5-out-of-scope-for-v1)
6. [Success Metrics](#6-success-metrics)
7. [Edge Cases & Rules](#7-edge-cases--rules)
8. [End-to-End Verification](#8-end-to-end-verification)

---

## 1. Product Overview

**The Butterfly Effect** is a browser-based 3D puzzle game for teenagers. Players have 60 seconds per loop to break into a heavily guarded vault. Each loop records the player's actions, which replay as a "ghost" in the next loop. By Loop 5, the player has four ghost clones executing prior actions simultaneously, requiring careful coordination to open the vault.

The game spans 20 handcrafted levels of increasing complexity. Players compete on per-level and all-20-levels leaderboards. An account is required to appear on leaderboards; guest play is supported but unranked.

---

## 2. Target Users

**Primary:** Students aged 13–17 (middle school and high school).

**User types:**

- **Guest player** — plays without an account; can complete all 20 levels but sees only their own time at the end of each level, not the leaderboard.
- **Registered player** — has a verified account; sees leaderboards after each level and after completing all 20 levels.

**Age gate:** Users must confirm they are 13 or older during account registration. The app does not collect data from users under 13 and does not support parental consent flows in V1.

---

## 3. Core Features (V1)

### Feature 1 — Time-Loop Gameplay

Each level consists of up to 5 loops. Every loop lasts exactly **60 seconds**. The timer resets to 60 at the start of each new loop regardless of when the previous loop ended.

- **Loop 1:** Player acts alone.
- **Loop 2:** Ghost from Loop 1 replays. Player acts alongside it.
- **Loop 3:** Ghosts from Loops 1 and 2 replay. Player acts alongside them.
- **Loop 4:** Ghosts from Loops 1, 2, and 3 replay.
- **Loop 5:** Ghosts from Loops 1, 2, 3, and 4 replay. Player makes their final move.

**Ghost recording:** Everything the player does during a loop — movement, interactions with levers, gates, objects — is recorded in real time and replayed exactly in subsequent loops. There is no editing of ghost recordings.

**Loop end:** At the 50-second mark, a 10-second warning appears on screen. At exactly 60 seconds, the loop ends automatically. Whatever actions were recorded become the ghost for the next loop, even if the player did nothing useful.

**Vault opened:** If the vault is opened at any point before the 60-second mark, the level is complete. The player's total time (sum of time used across all loops up to and including the loop where the vault opened) is recorded.

**Failure:** If the vault is not opened after Loop 5 ends, the player immediately advances to the next level (or restarts at Level 1 if on Level 20). No "game over" screen — the game keeps moving.

---

### Feature 2 — 20 Progressive Levels

The game contains exactly 20 handcrafted levels. Each level is a 3D vault with a unique layout. Difficulty increases as follows:

- **Levels 1–4:** Single mechanic (e.g., pull lever → gate opens for 5 seconds). Requires 1–2 ghost loops.
- **Levels 5–9:** Introduces a second mechanic (e.g., pressure plates, timed doors). Requires 2–3 ghost loops.
- **Levels 10–14:** Combines multiple mechanics. Requires 3–4 ghost loops with precise timing.
- **Levels 15–19:** Complex multi-mechanic puzzles. Full 5-loop coordination typically required.
- **Level 20:** Maximum complexity. Serves as the final boss of the game.

Levels are played in order (1 → 20). A player cannot skip levels. Progress is saved per account. Guest players' level progress is saved in local browser storage for the duration of the session only.

---

### Feature 3 — 3D Gameplay View + HUD

**Perspective:** Third-person 3D view of the vault. The player can move in all directions and interact with vault objects (levers, buttons, doors, etc.).

**HUD elements always visible:**
- **Minimap** (corner of screen) — shows the full vault layout, real-time position of the player, and real-time positions of all active ghosts. Players use this to coordinate timing with their ghosts.
- **Ghost trails** — each ghost has a visible colored trail or silhouette so the player can see where they are moving in the main view.
- **Loop counter** — shows which loop the player is currently on (e.g., "Loop 3 / 5").

**HUD elements conditionally visible:**
- **Timer** — hidden for the first 50 seconds of each loop. Appears only during the 10-second warning countdown. This is intentional — it increases pressure and requires players to internalize timing.

---

### Feature 4 — Accounts & Authentication

**Registration requires:**
- Username (unique, display name on leaderboards)
- Email address
- Password
- Age confirmation checkbox (must confirm age 13+)

**Verification:** A verification email is sent to the provided address. The account is not activated until the email link is clicked. Unverified accounts cannot access leaderboards.

**Login:** Email + password. Standard session management.

**Guest play:** No account required to play. Guest players see their own time after each level but do not appear on leaderboards and do not have saved progress between sessions.

**Password recovery:** Via email reset link (standard flow).

**No OAuth / social login in V1.**

---

### Feature 5 — Leaderboards

**Per-level leaderboard:** Shown to registered players after completing each level. Displays the top times for that level across all registered players, with the current player's rank highlighted.

**All-20-levels leaderboard:** Shown to all players (registered and guest) after completing Level 20. For registered players, displays total cumulative time across all 20 levels. For guests, displays their own total time only, with a prompt to create an account to appear on the board.

**Congratulations screen:** Shown after Level 20 is completed, before the all-20 leaderboard.

**Leaderboard ranking:** Sorted by fastest time (ascending). In the event of a tied time, the earlier submission ranks higher.

**Score recorded:** For each level, the player's best time is stored (not every attempt — only the personal best updates the leaderboard).

---

## 4. Data Model

### `users`
| Field | Type | Notes |
|---|---|---|
| `user_id` | UUID | Primary key |
| `username` | String | Unique, shown on leaderboards |
| `email` | String | Unique, used for login and verification |
| `password_hash` | String | Hashed password |
| `email_verified` | Boolean | False until verification link clicked |
| `age_confirmed` | Boolean | Player confirmed age 13+ at registration |
| `created_at` | Timestamp | Account creation time |

---

### `level_scores`
| Field | Type | Notes |
|---|---|---|
| `score_id` | UUID | Primary key |
| `user_id` | UUID | Foreign key → users |
| `level_number` | Integer | 1–20 |
| `best_time_ms` | Integer | Personal best time in milliseconds |
| `loops_used` | Integer | Which loop the vault was opened on (1–5) |
| `completed_at` | Timestamp | When this best time was set |

One row per user per level. Updated in place when the player beats their personal best.

---

### `overall_scores`
| Field | Type | Notes |
|---|---|---|
| `overall_score_id` | UUID | Primary key |
| `user_id` | UUID | Foreign key → users |
| `total_time_ms` | Integer | Sum of best times across all 20 levels |
| `completed_at` | Timestamp | When Level 20 was completed |

One row per user. Updated when the player completes all 20 levels and improves their total time.

---

### `ghost_recordings`
| Field | Type | Notes |
|---|---|---|
| `recording_id` | UUID | Primary key |
| `user_id` | UUID | Foreign key → users (null for guests) |
| `level_number` | Integer | 1–20 |
| `loop_number` | Integer | 1–5 |
| `session_id` | String | Groups loops of the same play session |
| `action_data` | JSON | Time-stamped sequence of player actions |
| `recorded_at` | Timestamp | When this recording was made |

Ghost recordings are ephemeral — they exist only for the current play session. They are not persisted between sessions. For guests, stored in memory only. For registered players, stored temporarily server-side for the session, then discarded.

---

## 5. Out of Scope for V1

The following features were explicitly discussed and deferred to post-V1:

- **Hard mode / shared timer** — a single 60-second countdown shared across all 5 loops (instead of resetting each loop). Planned as an unlock reward after completing all 20 levels, but not in V1.
- **Level editor or custom vaults** — all levels are handcrafted; no user-generated content.
- **Social features** — no friends lists, no sharing replays, no in-game chat.
- **OAuth / social login** — no Google, Apple, or third-party sign-in.
- **Mobile native app** — V1 is browser-based only.
- **Monetization** — no ads, no in-app purchases, no subscriptions in V1.
- **Under-13 access / parental consent flows** — minimum age is 13; COPPA compliance deferred.
- **Ghost recording persistence** — ghosts are session-only and are not saved or replayable after a session ends.
- **Replay viewer** — players cannot watch back their previous runs.
- **Accessibility features** — colorblind mode, screen reader support, etc. deferred to V2.
- **Localization** — English only in V1.

---

## 6. Success Metrics

Success at the end of Month 1 is evaluated against three dimensions:

### 6.1 Player Acquisition
- **Target:** 100 registered or guest players within 30 days of launch.
- **Measured by:** Total unique player sessions (registered + guest).

### 6.2 Engagement Time
- **Target:** Average session length of at least 10 minutes.
- **Measured by:** Session duration per player, averaged across all sessions.
- **Signal of health:** Players replaying levels to improve leaderboard rank indicates strong engagement.

### 6.3 Difficulty Curve Validation
- **Target:** A clear drop-off curve across levels — most players beat Levels 1–5, fewer beat Levels 10–15, and a small percentage beat Level 20.
- **Measured by:** Level completion rate per level (registered players only, since guest progress is not persisted).
- **Healthy range:** Level 20 completion rate between 10–30% indicates the game is hard but not discouraging.

---

## 7. Edge Cases & Rules

| Scenario | Behavior |
|---|---|
| Player does nothing for 60 seconds in Loop 1 | Ghost records 60 seconds of no action. Loop 2 begins with a ghost that stands still. |
| Player opens vault in Loop 1 | Level complete. Time recorded. Only 1 ghost is ever created. |
| Player opens vault in Loop 3 with 30 seconds remaining | Time recorded as (Loop 1 time + Loop 2 time + 30 seconds). Loops 4 and 5 never occur. |
| Two players have identical times on leaderboard | Earlier submission ranks higher. |
| Guest player completes Level 20 | Sees congratulations screen and their own total time. Leaderboard prompt shown to encourage account creation. Guest time is NOT added to the global leaderboard. |
| Registered player fails all 5 loops | Automatically moves to the next level. No score is recorded for that level (no time = no personal best). |
| Registered player beats a level twice (improved time) | Only the personal best (fastest time) is stored. Overall score is recalculated using the new best time. |
| Player closes browser mid-loop | Ghost recording for the current loop is discarded. Session ends. Registered players retain previously saved level best times. |
| Email already registered | Registration rejected with a message: "An account with this email already exists." |
| User attempts to register under age 13 | Age confirmation checkbox is required. No age verification beyond self-attestation in V1. |
| Unverified account tries to access leaderboard | Redirect to "please verify your email" screen. |

---

## 8. End-to-End Verification

The following steps prove the app works correctly from sign-up to leaderboard. Run this flow manually before launch.

---

### Step 1 — Account Creation
1. Navigate to the app homepage.
2. Click "Sign Up."
3. Enter a unique username, a valid email, and a password.
4. Check the age confirmation box.
5. Submit.
6. **Expected:** "Check your email for a verification link" message shown.
7. Open the email inbox. Click the verification link.
8. **Expected:** Account activated. Redirect to login screen or game lobby.

---

### Step 2 — Login & Guest Baseline
1. Open a second browser (incognito) without logging in.
2. Start Level 1 as a guest.
3. **Expected:** Game loads. No account prompt before playing.

---

### Step 3 — Level 1 Gameplay (Registered Player)
1. Log in with the verified account.
2. Start Level 1.
3. **Loop 1:** Walk forward and pull the lever. Do NOT walk through the gate.
4. **Expected:** At 50 seconds, the 10-second timer appears. At 60 seconds, loop resets.
5. **Loop 2:** Ghost from Loop 1 pulls the lever. Run through the gate while the ghost holds it.
6. **Expected:** Vault opens. Level complete screen shown with the player's time.
7. **Expected:** Per-level leaderboard appears, showing the player's time ranked against others.

---

### Step 4 — Ghost Coordination Verification
1. Start Level 1 again (to improve personal best or just to test).
2. **Loop 1:** Pull the lever and then run to the gate entrance.
3. **Loop 2:** Watch the minimap — ghost icon should appear at the lever position. Confirm ghost pulls the lever and gate opens. Run through.
4. **Expected:** Ghost trail visible in main 3D view. Minimap shows ghost position in real time.

---

### Step 5 — Failure Flow
1. Start a level. In all 5 loops, stand still and do nothing.
2. **Expected:** After Loop 5 ends, game immediately advances to the next level. No game over screen. No time recorded for the failed level.

---

### Step 6 — Guest Leaderboard Exclusion
1. In the incognito browser (guest), complete Level 1.
2. **Expected:** Guest sees their own time only. No leaderboard rankings shown. Prompt to create an account appears.
3. Return to the registered player browser.
4. **Expected:** Guest time does NOT appear on the Level 1 leaderboard.

---

### Step 7 — Personal Best Update
1. Complete Level 1 with the registered account. Note the time (e.g., 45 seconds).
2. Replay Level 1 and complete it faster (e.g., 30 seconds).
3. **Expected:** Leaderboard updates to show 30 seconds. Previous time is replaced.
4. Replay Level 1 and complete it slower (e.g., 50 seconds).
5. **Expected:** Leaderboard still shows 30 seconds. Personal best is not overwritten by a worse time.

---

### Step 8 — All-20-Levels Completion
1. Complete all 20 levels with the registered account.
2. **Expected:** Congratulations screen shown after Level 20.
3. **Expected:** All-20-levels leaderboard shown with the player's cumulative time across all levels.
4. Verify the cumulative time equals the sum of personal best times across all 20 levels.

---

### Step 9 — Email Verification Gate
1. Register a new account but do NOT click the verification link.
2. Log in with the unverified account and complete Level 1.
3. **Expected:** After completing the level, leaderboard is not shown. Instead, a "please verify your email" message appears.

---

*End of Specification — The Butterfly Effect V1*
