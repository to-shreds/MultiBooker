# MultiBooker Handoff

## Objective

MultiBooker is a mobile-first group scheduling site for quickly finding and confirming time windows that work for a required number of people. The primary example is coordinating four-person doubles matches among a larger group of adults.

## Source of truth

- Application repository: `to-shreds/MultiBooker`
- Default branch: `main`
- Frontend production target: `https://to-shreds.github.io/MultiBooker/`
- Worker production target: `https://multibooker-api.jonathanjablon.workers.dev`
- Readiness record: `to-shreds/ProjectStatus/projects/multibooker/STATUS.md`

## Current architecture

- Plain HTML/CSS/JavaScript frontend at repository root, served by GitHub Pages.
- Cloudflare Worker in `worker/`.
- One SQLite-backed Durable Object named `BookingGroup` per normalized group code.
- GitHub Actions for verification, Pages deployment, and Worker deployment.

## Product decisions that control the current implementation

- No participant accounts.
- Organizer-only actions use a 4 to 8 digit PIN. The default generated PIN is six digits.
- Participant status has four states: unanswered, available, maybe, unavailable.
- Scheduling granularity is 30 minutes.
- Activity length is configurable in 30-minute increments from 30 minutes through 6 hours.
- Weekday and weekend general hours can be different.
- Individual weekdays can be enabled or disabled.
- A group can contain more participants than the number required for a booking.
- Candidate calculations evaluate the full activity duration across consecutive blocks.
- Ranked results favor enough definite availability first, then fewer maybes and unanswered responses, then earlier times.
- The organizer confirms the time manually and chooses exactly the required number of participants.
- A confirmed booking is flagged if a selected participant later changes availability so the booking no longer works.
- Groups are reusable. Starting another booking preserves participants and recent booking history while clearing availability.

## API

- `GET /health`
- `POST /api/groups`
- `GET /api/groups/:code`
- `POST /api/groups/:code/participants`
- `PUT /api/groups/:code/availability`
- `POST /api/groups/:code/confirm`
- `POST /api/groups/:code/unconfirm`
- `POST /api/groups/:code/rounds`
- `DELETE /api/groups/:code/participants/:participantId`

## Security and identity constraints

Organizer PINs are salted and hashed before persistence. Participant identity is intentionally lightweight: a browser stores its participant ID, while entering an existing exact participant name rejoins that participant. This is suitable for friendly groups but is not strong authentication. Do not silently describe participant identity as secure authentication. A future hardening path is per-participant edit tokens.

CORS should remain restricted to the GitHub Pages origin and explicit local development origins.

## Verification completed before initial repository publication

- `node --check app.js`
- `node --check worker/src/core.js`
- `node --check worker/src/index.js`
- `npm test` under `worker/`: 5 tests passing
- HTML parsed successfully with Python's standard HTML parser.

The local environment did not have outbound npm access, so a local Wrangler dry-run could not complete. The GitHub verification workflow is intended to perform that check in CI.

## Do not break

- Keep the static frontend deployable independently from the Worker.
- Keep the Worker URL in `app.js` synchronized with `worker/wrangler.toml` if the Worker name or account subdomain changes.
- Do not reduce candidate evaluation to a single start block. Every 30-minute block covered by the activity must qualify.
- Do not treat unanswered availability as unavailable or as a maybe.
- Do not treat a "could work" result as equivalent to confirmed availability.
- Do not auto-confirm a booking merely because a candidate becomes viable.
- Do not require every member of a group to participate when `requiredPeople` is smaller than the participant count.
- Preserve reusable groups and the participant list across booking rounds.

## Next action

Verify the first GitHub Actions runs after publication. If Worker deployment reports missing Cloudflare secrets, add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` to this repository or make the existing account-level secrets available to it. If the Pages workflow reports that Pages is not configured, set the repository's Pages publishing source to GitHub Actions. Once both endpoints are live, run an end-to-end create, join, availability, confirm, revise, and new-round smoke test before declaring the application ready.