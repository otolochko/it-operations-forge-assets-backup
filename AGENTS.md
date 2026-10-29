# AGENTS.md

Guidance for coding agents working in this repository.

<!-- standards:start -->
## Shared standards

These rules apply to every Forge app we build. The source is `STANDARDS.md` in `../it-operations-forge-template`, and `scripts/sync.sh` copies it here: edit it there, not here. The app-specific sections of this file add to these rules and win when they conflict.

### Workflow

- After cloning, run `npm run setup` once: it installs dependencies and enables the pre-commit hook. `npm run check` must pass before every commit. The hook runs `npm run check:fast`, CI runs `npm run check` on every push.
- Never run `forge deploy`, `forge install`, `forge uninstall`, `forge register`, `forge variables set` or any other environment change yourself: print the exact commands and let the user run them. `forge lint` needs a login, so the user runs it before a deploy.
- `forge deploy` does not build the UI: build first. The user hard refreshes Jira after a deploy.
- Commit or push only when the user asks. User-visible changes go under `## Unreleased` in `CHANGELOG.md`.
- Shared files (see the template README) change in the template first, then `scripts/sync.sh` copies them into each app.

### Privacy and security

- Frontend only by default: no resolvers, no `@forge/api`, no `asApp()`, no Forge storage, KVS or SQL, no triggers, unless this app's own sections say otherwise. If a call fails as the user, do not switch to `asApp()`.
- No external egress (`permissions.external`), no remote CDNs, fonts or scripts, no analytics or telemetry.
- Never log, store or write to a file tokens (for example `mediaJwtToken`), user `emailAddress` or other personal data. No `console` calls in UI code.
- No `delete:*` scopes and no delete calls unless this app's own sections allow them. Ask for the fewest scopes that work.
- `manifest.yml` is gitignored because it holds the app id. The committed copy is `manifest.yml.example` with `REPLACE_ME`: mirror every other manifest change there. Never commit `.env`; `.env.example` lists the variables.

### Dependencies

- Runtime dependencies: React, `react-dom`, `@forge/bridge`, `@atlaskit/tokens` and `fflate`; apps with resolvers add the `@forge/*` packages they need. Dev tooling: Vite, `@vitejs/plugin-react`, ESLint 9 (pinned major), Vitest. Ask before adding anything else. No UI component libraries in new apps.
- Dependabot opens one monthly PR for minor and patch updates; major updates come as separate PRs (ESLint majors are ignored).
- Use the Node version from `.nvmrc`.

### Code, docs and UI copy

- English for code, comments, docs and commit messages. Reply to the user in Ukrainian.
- Never use the em dash character anywhere: the check fails on it.
- Sentence case in the UI. The display name lives in one place in code (`src/appInfo.js` in new apps) and in the manifest.
- UI follows `../it-operations-forge-template/DESIGN.md`: read it before UI work and finish with its checklist (section 16). Plain HTML components and `var(--ds-...)` tokens with fallbacks, no hard-coded colors.
- Before working with Atlassian APIs read `../it-operations-forge-template/api-notes.md`; add new verified findings there with their source.

### Quality gate

- `npm run check` runs the rules in `scripts/check-rules.mjs`, lint, tests, the build and the bundle size check.
- Never disable a rule, skip a test or raise a limit just to get a green check: fix the cause or tell the user.
<!-- standards:end -->

## What this is

Assets backup: a private Atlassian Forge app (not published, one Jira site) that backs up Jira Service Management Assets schemas on per-plan schedules and keeps them for a configurable time (target size: up to 20 000 objects). Sibling of `../it-operations-forge-assets-export`, whose export code (`export/*`, `api/*`) is ported into `src/`.

Current phase: v1 with backup plans. The admin page (`static/main`, Custom UI, React) manages plans stored in Forge KVS (`src/plans.js`): schemas, weekdays, hour in Europe/Copenhagen, retention 1-30 days. An hourly trigger (`tick` in `src/index.js`, logic in `src/jobs.js`) queues the plans due in the current local hour; an async consumer (`timeoutSeconds: 900`) runs `src/backup.js`, which reads the schemas through `asApp()`, builds the ZIP with the ported export core (`src/export/*`, `src/api/*`) and uploads it to Forge Object Store with the plan's retention as TTL. `docs/spike-results.md` holds the spike findings.

KVS keys: `plan:{id}` (plan), `slot:{id}` (last local hour a plan was queued, makes a repeated hour run once), `backup:{planId}:{stamp}` (one record per run: status, size, counts, `expiresAt`). ZIPs are `backups/{planId}/{stamp}.zip`. The tick deletes records and ZIPs after `expiresAt` and marks runs stuck in `running` as failed; KVS TTL is not used (its maximum is not documented). A single backup can also be deleted from the history table (`deleteBackup` resolver, `deleteStoredBackup` in `src/jobs.js`; a running backup is refused). `kvs.query` is eventually consistent, so the UI updates its state from the response of a save instead of re-listing.

## Differences from the export app

This app overrides the shared "frontend only" default. It has a backend, so these are allowed here (root `package.json`: `@forge/api`, `@forge/events`, `@forge/kvs`, `@forge/object-store`, `@forge/resolver`, `fflate`):

- Resolvers (`@forge/resolver`), `@forge/api` and `asApp()` (the backup reads Assets as the app).
- Scheduled triggers (hourly `tick`) and async events (`@forge/events`, consumer with `timeoutSeconds: 900`).
- Forge KVS (`@forge/kvs`) for plans, slots and backup records, and Forge Object Store (`@forge/object-store`) for the ZIPs.

Stricter rules that still apply:

- Still read-only on Assets: no write scopes. The only deletes are of this app's own KVS records and Object Store ZIPs (expiry and the history table), never of Assets data.
- Never export emails, avatars or media tokens (`avatar.mediaClientConfig.mediaJwtToken`, `emailAddress`).
- No `console` logging of object data in the backend: only status, timing and counts.
- No external egress until a decision to use Azure Blob or S3 is made.
- Linting covers the UI in `static/main` only, not the root resolver code.
- `static/main/eslint.config.js` sets `react-hooks/set-state-in-effect`, `react-hooks/purity` and `react-hooks/refs` to `warn` for legacy code in `App.jsx` and `PlanForm.jsx`: fix the warnings, then remove the override.
- The UI build goes to `static/main/build` (the shared bundle check reads that folder); `manifest.yml` and `manifest.yml.example` point to it.

## Commands

```bash
npm run setup        # once after cloning: install root and UI dependencies, enable the pre-commit hook
npm run check        # full gate: rules, lint (UI), tests, build, bundle size
npm run check:fast   # rules and lint (the pre-commit hook)
npm run lint         # ESLint for static/main
npm test             # vitest, repo root
npm run build        # UI build; forge deploy does NOT build the UI
node --check src/index.js
```

## Architecture notes

- `src/api/requestQueue.js` does not import Forge: `src/index.js` injects the request function with `configureRequest` (`asApp().requestJira`). Tests inject a mock.
- Import Object Store as `import { objectStore } from '@forge/object-store'`; the default import is not the client in the bundle.
- The consumer (`runPlan` in `src/jobs.js`) catches errors and records them as a failed backup instead of throwing: a thrown error makes Forge retry the event for up to 24 hours.
- The default imports of `@forge/*` packages can be the whole module in the bundle, not the class from the docs ("is not a constructor"). Use named exports: `objectStore`, `kvs`, `makeResolver`, `Queue`.
- `objectStore.download` in the UI calls the `downloadUrls` resolver with `{ keys }` and expects `{ [downloadUrl]: key }`. Only keys of backups with status `ok` are accepted.
- Same quirks as the export app (see `../it-operations-forge-assets-export/AGENTS.md`): use `totalcount`, never AQL `total`, `hasMoreResults` or flat `objectCount`; the `route` tag rejects `/` in strings, so `assetsClient.js` builds validated paths and `index.js` wraps them with `assumeTrustedRoute`.
- Changing `flatten.js` or `machine.js` changes the package format: update `docs/backup-format.md`.

## Conventions

- Mirror every manifest change in `manifest.yml.example`.
