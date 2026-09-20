# MultiBooker

MultiBooker is a lightweight group scheduling web app for finding a time when enough people can participate without making everyone compare calendars manually.

It is designed around a simple workflow:

1. An organizer creates a reusable group and defines the booking window, required number of people, activity length, and normal weekday/weekend hours.
2. The organizer shares the group code or direct link.
3. Each participant marks each 30-minute block as **Available**, **Maybe**, **Unavailable**, or leaves it unanswered.
4. MultiBooker continuously ranks the best complete time windows for the requested activity duration.
5. The organizer confirms a candidate time and exact roster with the organizer PIN.
6. The group can be reused for the next booking without recreating the participant list.

## Architecture

```text
GitHub Pages frontend
        |
        v
Cloudflare Worker: multibooker-api
        |
        v
SQLite-backed Durable Object per group code
```

The frontend is plain HTML, CSS, and JavaScript in the repository root. There are no frontend frameworks or third-party runtime dependencies.

The Worker source is under `worker/`. Each group code maps to its own Durable Object so the group's configuration, participants, availability, confirmed booking, and recent booking history are isolated and persistent.

## Expected production URLs

- Frontend: `https://to-shreds.github.io/MultiBooker/`
- API: `https://multibooker-api.jonathanjablon.workers.dev`

The frontend automatically uses `http://127.0.0.1:8787` when opened from localhost and the production Worker URL otherwise.

## Main behavior

- No participant accounts.
- Organizer actions require a 4 to 8 digit organizer PIN. The browser generates a 6 digit PIN by default.
- Groups can have more invited participants than the number required for a booking.
- Candidate times are based on the entire requested activity duration, not only the starting block.
- A candidate is **Works now** when at least the required number of participants are fully available.
- A candidate is **Could work** when enough people are available or maybe.
- A candidate can also show that responses are still needed or that there is a conflict.
- The organizer chooses the exact required roster when confirming a time.
- Confirmed times remain visible to everyone and are flagged if a selected participant later changes availability in a way that breaks the booking.
- Starting another booking keeps the group and participant list but clears the current availability and preserves a short booking history.

## Security model

MultiBooker is intended for small private groups, not sensitive scheduling data.

The organizer PIN is stored only as a salted SHA-256 hash. Administrative actions require the PIN. Participant editing intentionally uses a convenience model rather than account authentication: a participant rejoins by group code and exact name, while the browser remembers the returned participant ID. Anyone who knows both a group code and a participant's exact name could therefore act as that participant. If stronger participant identity becomes useful later, per-participant edit tokens can be added without changing the scheduling model.

Group codes should be treated as share links, not passwords.

## Local development

Run the Worker:

```sh
cd worker
npm install
npm run check
npm run dev
```

Serve the repository root separately, for example:

```sh
python -m http.server 8000
```

Then open `http://127.0.0.1:8000`.

## Deployment

### Cloudflare Worker

`.github/workflows/deploy-worker.yml` deploys the Worker when `worker/**` changes on `main`. The repository needs these GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The token must be authorized to deploy Workers in the Cloudflare account that owns `jonathanjablon.workers.dev`.

### GitHub Pages

`.github/workflows/pages.yml` publishes the static frontend from the repository root. GitHub Pages must use **GitHub Actions** as its publishing source.

## Verification

`npm test` in `worker/` covers the scheduling engine, including weekday/weekend constraints, activity durations spanning multiple blocks, Available/Maybe candidate ranking, and confirmation roster validation.

`.github/workflows/verify.yml` runs syntax checks, the Worker test suite, and a Wrangler dry-run on pushes and pull requests.

## Source of truth

This repository is the source of truth for MultiBooker application code and deployment configuration. `HANDOFF.md` records continuation-critical implementation state. Project readiness is tracked in `to-shreds/ProjectStatus` under `projects/multibooker/STATUS.md`.