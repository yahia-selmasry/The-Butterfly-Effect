# CLAUDE.md — The Butterfly Effect

This file gives Claude Code context about this project. Read it before touching any code.

---

## Project Summary

**The Butterfly Effect** is a browser-based 3D time-loop puzzle game for ages 13–17. Players have 60 seconds per loop to break into a vault. Each loop records the player's actions, which replay as a ghost clone in the next loop. Up to 5 loops per level. 20 handcrafted levels of increasing difficulty. Registered players compete on leaderboards.

Full product spec: `SPEC.md`

---

## Commands

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm run test

# Run linter
npm run lint

# Build for production
npm run build

# Preview production build
npm run preview
```

> If these commands don't yet exist, scaffold them before writing feature code.

---

## Tech Stack (Planned)

- **Frontend:** React + TypeScript
- **3D Rendering:** Three.js (via React Three Fiber)
- **Styling:** Tailwind CSS
- **Backend:** Node.js + Express (or Next.js API routes — TBD)
- **Database:** PostgreSQL
- **Auth:** JWT with email verification flow
- **Hosting:** TBD

Update this section as stack decisions are finalized. Do not assume a library is installed — check `package.json` first.

---

## Project Structure

```
/
├── CLAUDE.md          ← you are here
├── SPEC.md            ← full product spec, source of truth
├── src/
│   ├── game/          ← all game logic (loops, ghosts, levels)
│   ├── components/    ← React UI components
│   ├── scenes/        ← Three.js 3D scenes per level
│   ├── hooks/         ← custom React hooks
│   ├── api/           ← backend API routes
│   ├── db/            ← database models and migrations
│   └── auth/          ← authentication logic
├── public/
│   └── levels/        ← level config files (JSON)
└── tests/
```

---

## Core Game Rules (Critical — Do Not Get These Wrong)

- Each loop is exactly **60 seconds**. The timer resets at the start of every loop.
- Ghost recording captures **all player actions** in real time. No editing, no filtering.
- Ghosts replay with **exact timing** from the previous loop's recording.
- The **timer is hidden** until the last 10 seconds of each loop. Only the 10-second countdown is shown.
- If the vault is not opened after Loop 5, the player advances to the next level automatically. No game over screen.
- Ghost recordings are **session-only**. They are never persisted between sessions.
- A player's **personal best** per level is what goes on the leaderboard, not every attempt.

---

## Data Model

Four tables: `users`, `level_scores`, `overall_scores`, `ghost_recordings`.  
Full schema with field names and types is in `SPEC.md § 4. Data Model`.

Key rules:
- `level_scores` stores one row per user per level (upsert on personal best).
- `ghost_recordings` are ephemeral — store in memory for session, do not persist.
- `overall_scores.total_time_ms` is the sum of `level_scores.best_time_ms` across all 20 levels.

---

## Auth Rules

- Registration requires: username, email, password, age confirmation (13+).
- Email must be verified before leaderboard access is granted.
- Guest players can play but do not appear on leaderboards and have no saved progress.
- No OAuth or social login in V1.
- Minimum age is 13. No under-13 flows or parental consent in V1.

---

## What Is Explicitly Out of Scope (Do Not Build)

- Hard mode / shared timer across loops
- Ghost recording persistence between sessions
- Replay viewer
- Social features (friends, chat, sharing)
- OAuth / social login
- Mobile native app
- Monetization
- Localization
- Accessibility features (deferred to V2)

If a request seems to touch these areas, check `SPEC.md § 5` and flag it before proceeding.

---

## Key Constraints

- **Leaderboard reads must be fast.** Expect concurrent players. Index `level_scores` on `(level_number, best_time_ms)`.
- **Ghost recordings are timing-sensitive.** Action replay must be frame-accurate. Use timestamps in milliseconds, not frames.
- **The minimap updates in real time** for all ghosts and the player. Keep this rendering path lightweight.
- **Level configs are data, not code.** Define each of the 20 levels as JSON files, not hardcoded logic.

---

## Conventions

- TypeScript strict mode on. No `any`.
- All game state lives in clearly named hooks or a state manager — not scattered across components.
- API routes return consistent JSON: `{ data, error }`.
- Database queries go in `/src/db/` — never inline in API routes.
- Tests live next to the files they test (`foo.test.ts` beside `foo.ts`).
- Commit messages: imperative, present tense ("Add ghost recording hook", not "Added").
