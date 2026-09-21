# MultiBooker

MultiBooker is a lightweight mobile-first scheduling app for groups that need to find a time when enough people can participate without manually comparing calendars.

## Hosting

The canonical frontend source is `index.html`, `styles.css`, `app.js`, and `manifest.webmanifest` in this repository. The intended production frontend host is GitHub Pages at:

`https://to-shreds.github.io/MultiBooker/`

The Cloudflare Worker at `https://multibooker-api.jonathanjablon.workers.dev` is the shared-data API and Durable Object backend.

GitHub Pages is not yet enabled for this newly created repository. Until that repository setting is enabled, the Worker temporarily serves the same GitHub-managed frontend files as a fallback so the app remains usable. No editable frontend source is maintained outside this repository.

## Current user experience

After creating or joining a group, MultiBooker opens directly to **My Times**. The group workspace uses three persistent tabs:

- **My Times**: the participant's own availability, with a compact date selector and direct Available, Maybe, No, and Clear modes.
- **Best Times**: only meaningful candidate windows. Conflict-only rows are not shown.
- **Group**: group code, sharing, participant progress, and organizer controls.

The page itself does not require scrolling between those major sections. Long date or candidate content, when necessary, scrolls only inside the active tab.

## Workflow

1. An organizer creates a reusable group and chooses a group code.
2. The organizer defines the number of people needed, booking date range, activity duration, allowed days, and normal weekday/weekend hours.
3. The organizer shares the group code or direct link.
4. Each participant joins by name and marks each 30-minute block as Available, Maybe, Unavailable, or unanswered.
5. MultiBooker automatically ranks complete activity windows.
6. The organizer chooses a qualifying time and exact required roster, then confirms the booking with the organizer PIN.
7. The group can be reused for another booking while keeping the participant list.

## Architecture

```text
GitHub repository
  |
  +-- GitHub Pages: HTML / CSS / JavaScript
  |
  +-- Cloudflare Worker: /api/* and /health
          |
          v
     SQLite-backed Durable Object per group code
```

The frontend has no framework or third-party browser runtime dependency. Shared group state is stored in a SQLite-backed Cloudflare Durable Object, one logical object per normalized group code.

While GitHub Pages activation is pending, the Worker static-assets binding is retained only as a temporary availability fallback. It should be removed after the Pages deployment succeeds.

## Scheduling behavior

- No participant accounts.
- Organizer actions require a 4 to 8 digit organizer PIN.
- Groups may contain more participants than the number required for a booking.
- Availability states are Available, Maybe, Unavailable, and unanswered.
- Candidate times are evaluated across the full requested activity duration.
- A ready candidate has at least the required number of definitely available participants for the full duration.
- A possible candidate has enough Available plus Maybe participants for the full duration.
- The organizer chooses the exact required roster when confirming a time.
- Confirmed times are flagged if later availability changes make the selected roster no longer work.
- Starting another booking keeps the group and participant list, clears current availability, and preserves recent booking history.

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

Then open `http://127.0.0.1:8000`. The frontend uses the local Worker at `http://127.0.0.1:8787` on localhost.

## Deployment

### Frontend

`.github/workflows/pages.yml` builds the four root frontend files and deploys them to GitHub Pages. The repository must first have **Settings > Pages > Build and deployment > Source** set to **GitHub Actions**.

### Backend

Cloudflare credentials remain repository-scoped GitHub Actions secrets in `to-shreds/arcade`. `to-shreds/arcade/.github/workflows/deploy-multibooker-worker.yml` is therefore used only as the credential bridge for Worker deployment. It checks out the canonical MultiBooker repository before testing and deploying.

Once GitHub Pages is live, remove the temporary Worker static-assets configuration and the corresponding fallback-copy step from the Arcade bridge so Cloudflare is API-only.

## Verification

`.github/workflows/verify.yml` checks browser JavaScript syntax, Worker syntax and tests, and a Wrangler dry-run. The scheduling tests cover group-code normalization, weekday/weekend slot construction, full-duration candidate evaluation, Available/Maybe ranking, and exact roster validation.

## Source of truth and continuation

This repository is the source of truth for MultiBooker application code and deployment configuration. `HANDOFF.md` records continuation-critical implementation state. Project readiness is tracked in `to-shreds/ProjectStatus` under `projects/multibooker/STATUS.md`.
