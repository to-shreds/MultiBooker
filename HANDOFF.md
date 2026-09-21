# MultiBooker Handoff

## Current state

MultiBooker v1.1 has a redesigned tabbed group workspace committed on `main` and deployed to the temporary Worker fallback.

Canonical application repository: `to-shreds/MultiBooker`.

Current usable fallback URL: `https://multibooker-api.jonathanjablon.workers.dev/`.

Target frontend URL: `https://to-shreds.github.io/MultiBooker/`.

The remaining hosting blocker is GitHub Pages activation for this new repository. The Pages workflow is already committed, but GitHub rejects its Configure Pages step until the repository setting is enabled.

## Product behavior

- Creating or joining a group lands directly on **My Times**.
- The group workspace is split into **My Times**, **Best Times**, and **Group** tabs.
- Availability entry no longer sits below candidate/conflict output.
- My Times uses a compact date selector plus direct Available, Maybe, No, and Clear modes.
- Time tiles apply the currently selected state directly instead of requiring repeated cycling.
- A whole day can be marked with the current state in one action.
- Best Times excludes conflict-only candidates. When no workable overlap exists, it shows a compact progress message instead of a wall of conflicts.
- Group contains sharing, participant progress, and organizer controls.
- Major sections do not require page scrolling. Long content can scroll within its active tab.
- Reusable groups, full-duration candidate evaluation, extra invitees beyond required headcount, confirmation, booking history, and organizer controls remain preserved.

## Architecture

Canonical frontend source:
- `index.html`
- `styles.css`
- `app.js`
- `manifest.webmanifest`

Backend:
- `worker/src/index.js`
- `worker/src/core.js`
- `worker/wrangler.toml`
- `worker/test/core.test.mjs`

Target production architecture:

```text
GitHub Pages -> frontend
Cloudflare Worker -> API only
Cloudflare Durable Object -> persistent group state
```

Current temporary architecture:

```text
Cloudflare Worker -> API plus temporary copy of canonical GitHub frontend files
```

The temporary Worker frontend exists only to avoid breaking the usable app before GitHub Pages is enabled. There is no separately maintained frontend copy.

## GitHub Pages blocker

Workflow: `.github/workflows/pages.yml`.

Failed Pages run: `35563981239`.

The static site build and `node --check app.js` succeeded. GitHub failed at `actions/configure-pages@v6` with:

`Get Pages site failed. Please verify that the repository has Pages enabled and configured to build using GitHub Actions.`

The connected GitHub tools do not expose the repository administration action required to enable a Pages site.

Required manual repository setting:

1. Open the MultiBooker repository.
2. Open **Settings > Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Rerun the `Deploy MultiBooker to GitHub Pages` workflow.

After the Pages deployment succeeds, immediately remove the temporary `[assets]` block from `worker/wrangler.toml` and remove the static-file copy/root check from the Arcade deployment bridge.

## Cloudflare deployment

Cloudflare credentials remain repository-scoped Actions secrets in `to-shreds/arcade`.

Credential bridge: `to-shreds/arcade/.github/workflows/deploy-multibooker-worker.yml`.

Latest fallback deployment after the tabbed redesign: bridge run `35564056273`, which completed successfully.

Do not move application source into Arcade. The Arcade workflow exists only because that repository already has the Cloudflare deployment credentials.

## Verification

Already verified for the tabbed redesign:

- `app.js` redesign commit `78d036e62249b01f795a0048268be77333a9b49e`: MultiBooker Verify run `35563931378` succeeded.
- `styles.css` redesign commit `4692bd44a937fa90e31997613353bbc579dcd6e2`: MultiBooker Verify run `35563955834` succeeded.
- Pages workflow source build on run `35563981239`: JavaScript validation and static site build succeeded before GitHub rejected the unenabled Pages site.
- Worker fallback bridge run `35564056273`: succeeded after the hosting transition work.

Final current-main verification must remain green before this handoff is treated as complete.

## Do not break

- GitHub is the canonical source of all frontend files.
- **My Times** is the default group tab.
- Availability entry must remain immediately accessible without scrolling through Best Times.
- Best Times must remain a separate tab and should not show conflict-only rows.
- Unanswered must remain distinct from Unavailable.
- Candidate evaluation must cover the full activity duration.
- More participants than required must remain supported.
- Confirmation must require exactly `requiredPeople` participants who are Available or Maybe for the full duration.
- Preserve reusable groups and booking-round history.
- Do not create a second editable frontend source under `worker/public/`.

## Known limitations

- GitHub Pages is not live until the repository setting above is enabled.
- Participant identity remains convenience-based rather than strongly authenticated.
- There are no notifications, calendar integrations, or court/venue reservations.

## Next action

Enable GitHub Pages with Source set to GitHub Actions. Then rerun the Pages deployment, verify `https://to-shreds.github.io/MultiBooker/`, remove the temporary Worker frontend fallback, redeploy the Worker as API-only, and update ProjectStatus to READY.
