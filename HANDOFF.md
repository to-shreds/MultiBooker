# MultiBooker Handoff

## Current state

MultiBooker v1 is implemented and live.

Production URL: https://multibooker-api.jonathanjablon.workers.dev/

Canonical application repository: `to-shreds/MultiBooker`, branch `main`.

The repository is the source of truth for the frontend, Worker, scheduling logic, tests, and deployment configuration. The production Worker serves the static frontend and API together. Shared group state is stored in SQLite-backed Cloudflare Durable Objects.

## Product behavior

- Create a reusable scheduling group with a chosen or generated group code.
- Organizer chooses the number of people required.
- More participants may join than are required for a booking.
- Configure a date range, activity duration, allowed weekdays, weekday hours, and weekend hours.
- Availability is entered in 30-minute blocks as Available, Maybe, Unavailable, or unanswered.
- MultiBooker evaluates the complete activity duration for every candidate start time.
- Candidate times are ranked automatically so users do not need to compare the raw grid manually.
- Enough definite participants produces a ready candidate.
- Definite plus maybe participants can produce a possible candidate.
- Unanswered availability is kept distinct from Unavailable.
- Organizer selects the exact required roster and confirms a time with the organizer PIN.
- A confirmed booking is flagged if later availability changes break it.
- New booking rounds retain the participant list and archive recent booking results.
- Organizer can remove participants.
- Direct group links use `?group=CODE`.

## Architecture

Frontend:
- `index.html`
- `styles.css`
- `app.js`
- `manifest.webmanifest`

Backend:
- `worker/src/index.js`
- `worker/src/core.js`
- `worker/wrangler.toml`
- `worker/test/core.test.mjs`

Cloudflare Worker:
- name: `multibooker-api`
- production URL: https://multibooker-api.jonathanjablon.workers.dev/
- Durable Object binding: `BOOKING_GROUPS`
- Durable Object class: `BookingGroup`
- current storage model: SQLite-backed Durable Object, one logical object per normalized group code

Static assets:
- `worker/public/` is generated during CI/deployment and is intentionally ignored by Git.
- Deployment copies the four root frontend files there.
- Wrangler uploads those assets with the Worker.
- API and health paths run through the Worker first.

## Deployment

The Cloudflare credentials already existed as repository-scoped GitHub Actions secrets in `to-shreds/arcade`, not in the new MultiBooker repository.

Production deployment therefore uses this credential-only bridge:

`to-shreds/arcade/.github/workflows/deploy-multibooker-worker.yml`

That workflow:
1. Checks out the current `to-shreds/MultiBooker` `main` branch.
2. Generates `worker/public/` from the canonical root frontend files.
3. Installs dependencies and runs `npm run check`.
4. Deploys with the existing Cloudflare account credentials.
5. Verifies both the production `/health` endpoint and the production root HTML.

Do not move application source into Arcade. The Arcade workflow is only a deployment credential bridge.

MultiBooker itself keeps `.github/workflows/verify.yml`, which validates every push and pull request. The earlier direct Worker deploy and GitHub Pages workflows were intentionally removed because the new repository does not contain the existing Cloudflare secrets and the current GitHub integration cannot activate a new Pages site. The production Worker static-assets deployment removes both dependencies.

## Verification completed on September 20, 2026

Repository/source checks:
- Exact large-source Git blob hashes were compared after bootstrap and matched the locally tested files.
- MultiBooker GitHub CI passes.
- Browser JavaScript syntax passes.
- Worker source syntax passes.
- Wrangler dry-run with generated static assets passes.
- Worker npm audit during deployment reported zero vulnerabilities.

Scheduling tests pass:
1. Group-code normalization.
2. Weekday/weekend 30-minute slot construction.
3. Full activity-duration evaluation.
4. Definite availability ranking ahead of Maybe.
5. Exact required-player confirmation and unanswered-slot rejection.

Production deployment checks pass:
- Wrangler deployed the Worker and four static assets.
- `GET /health` returned `{"ok":true,"service":"multibooker-api","version":"0.1.0"}`.
- The production root returned the MultiBooker HTML.
- A one-time live smoke test created a real throwaway group, added a second participant, saved both participants' availability, found a 60-minute candidate as `ready`, confirmed the exact two-person roster, and read the confirmed booking back successfully.
- The one-time smoke step was removed after that successful test.

## Security and identity model

Organizer PIN:
- 4 to 8 digits.
- Stored only as salted SHA-256.
- Required for confirmation, unconfirmation, new rounds, and participant removal.

Participant identity:
- Deliberately account-free for v1.
- Group code plus exact participant name can recover that participant identity.
- Browser local storage remembers participant IDs and organizer PINs on that device.
- This is suitable for low-sensitivity friend scheduling, not sensitive data.
- A future hardening path is per-participant edit tokens.

## Do not break

- GitHub remains the canonical source.
- Do not maintain a separate editable copy of frontend source under `worker/public/`.
- Keep unanswered distinct from Unavailable.
- Candidate evaluation must cover the entire activity duration.
- More participants than required must remain supported.
- Confirmation must require exactly `requiredPeople` participants who are Available or Maybe for the full duration.
- Keep the raw availability editor secondary to the ranked answer to “when can we do this?”
- Preserve reusable groups and booking-round history.
- Preserve the existing Worker name and production URL unless all client references and deployment configuration are deliberately migrated together.

## Known limitations

- Participant identity is convenience-based rather than strongly authenticated.
- There are no notifications, calendar integrations, or court/venue reservations in v1.
- Confirming a booking records the agreed time but does not create an external calendar event.
- The deployment bridge must be run when a production deployment is desired because the Cloudflare Actions secrets remain scoped to Arcade.

## Next logical work

Use the live app with a real scheduling group and collect UX feedback. The most likely v1.1 improvements are participant edit tokens, calendar export, optional notifications, per-date hour overrides, and a cleaner production hostname if desired. Do not add those merely because they are listed here.
