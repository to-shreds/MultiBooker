# MultiBooker

MultiBooker is a lightweight mobile-first scheduling app for groups that need to find a time when enough people can participate without manually comparing calendars.

## Live app

Production: https://multibooker-api.jonathanjablon.workers.dev/

The production Cloudflare Worker serves both the static frontend and the API. The HTML, CSS, JavaScript, Worker source, tests, and deployment configuration remain versioned in this repository.

## Workflow

1. An organizer creates a reusable group and chooses a group code.
2. The organizer defines the number of people needed, booking date range, activity duration, allowed days, and normal weekday/weekend hours.
3. The organizer shares the group code or direct link.
4. Each participant joins by name and marks each 30-minute block as **Available**, **Maybe**, **Unavailable**, or leaves it unanswered.
5. MultiBooker automatically ranks complete activity windows instead of making users inspect the raw grid.
6. The organizer chooses a qualifying time and the exact required roster, then confirms the booking with the organizer PIN.
7. The group can be reused for another booking while keeping the participant list.

## Architecture

```text
GitHub repository, source of truth
        |
        | deployment copies the four frontend files
        v
Cloudflare Worker: multibooker-api
   |                    |
   | static assets      | API
   v                    v
HTML/CSS/JS       SQLite-backed Durable Object per group code
```

The frontend is plain HTML, CSS, and JavaScript in the repository root. There are no frontend frameworks or third-party browser runtime dependencies.

The Worker source is under `worker/`. Each group code maps to its own Durable Object so the group's configuration, participants, availability, confirmed booking, and recent booking history are isolated and persistent.

`worker/public/` is generated only for deployment and is not source. The deployment process copies `index.html`, `styles.css`, `app.js`, and `manifest.webmanifest` into that directory before Wrangler uploads the Worker and static assets as one unit.

## Scheduling behavior

- No participant accounts.
- Organizer actions require a 4 to 8 digit organizer PIN. The browser generates a 6 digit PIN by default.
- Groups can contain more participants than the number required for a booking.
- Availability is stored as Available, Maybe, Unavailable, or unanswered.
- Candidate times are evaluated across the entire requested activity duration, not only the starting 30-minute block.
- A candidate is **Works now** when at least the required number of participants are definitely available for the full duration.
- A candidate is **Could work** when enough people are available or maybe for the full duration.
- Candidates can also show that more responses are needed or that the time conflicts.
- The organizer chooses the exact required roster when confirming a time.
- Confirmed times remain visible to everyone and are flagged if a selected participant later changes availability in a way that breaks the booking.
- Starting another booking keeps the group and participant list, clears current availability, and preserves recent booking history.
- Weekday and weekend time windows can be configured separately.
- Allowed days can be selected independently.

## Security model

MultiBooker is intended for small private scheduling groups, not sensitive information.

The organizer PIN is stored only as a salted SHA-256 hash. Administrative actions require that PIN.

Participant editing intentionally uses a convenience model instead of account authentication. A participant rejoins by group code and exact name, while the browser remembers the returned participant ID. Someone who knows both a group code and another participant's exact name could therefore act as that participant. If stronger participant identity becomes useful later, per-participant edit tokens can be added without changing the scheduling model.

Group codes should be treated as share links, not passwords.

## API

The Worker exposes:

- `GET /health`
- `POST /api/groups`
- `GET /api/groups/:code`
- `POST /api/groups/:code/participants`
- `PUT /api/groups/:code/availability`
- `POST /api/groups/:code/confirm`
- `POST /api/groups/:code/unconfirm`
- `POST /api/groups/:code/rounds`
- `DELETE /api/groups/:code/participants/:participantId`

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

Then open `http://127.0.0.1:8000`. The frontend automatically uses the local Worker at `http://127.0.0.1:8787` on localhost.

For a local full-stack deployment test, copy the frontend files into `worker/public/` before running a Wrangler deploy or dry-run:

```sh
mkdir -p worker/public
cp index.html styles.css app.js manifest.webmanifest worker/public/
```

## Verification

`.github/workflows/verify.yml` runs on pushes and pull requests. It checks browser JavaScript syntax, installs the Worker dependencies, runs the scheduling test suite, prepares the Worker static assets, and performs a Wrangler dry-run.

The Worker tests cover group-code normalization, weekday/weekend slot construction, multi-slot activity duration handling, Available/Maybe candidate ranking, and exact roster validation.

Production deployment currently uses `to-shreds/arcade/.github/workflows/deploy-multibooker-worker.yml` only as a credential bridge because the existing Cloudflare Actions secrets are repository-scoped there. That workflow checks out the current MultiBooker `main` branch, prepares the frontend assets, reruns the tests, deploys `multibooker-api`, and verifies the public health and root endpoints. MultiBooker remains the application source of truth.

## Source of truth and continuation

This repository is the source of truth for MultiBooker application code and deployment configuration. `HANDOFF.md` records continuation-critical implementation state. Project readiness is tracked in `to-shreds/ProjectStatus` under `projects/multibooker/STATUS.md`.
