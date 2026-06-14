# API Routes

Routes will be documented here as they are implemented.

## Auth
- `GET /` — home / lobby
- `POST /register` — create account
- `POST /login` — authenticate
- `GET /logout` — end session
- `GET /verify/<token>` — email verification

## Game
- `GET /play/<level>` — load a level
- `POST /score` — submit level completion time
- `GET /leaderboard/<level>` — per-level leaderboard
- `GET /leaderboard/overall` — all-20-levels leaderboard

## Ghosts (session-scoped)
- `POST /ghost/record` — save a loop recording
- `GET /ghost/<level>/<loop>` — retrieve ghost data for playback
