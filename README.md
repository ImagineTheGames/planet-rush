# Planet Rush

A top-down 2D space arena game. One ship, three jobs, never enough time.
TypeScript + PixiJS, online and offline, desktop and mobile (PWA-installable).
See [`GDD.md`](./GDD.md) for the design and [`style-guide.md`](./style-guide.md)
for the art contract.

## Play

- **Live game (GitHub Pages):** https://imaginethegames.github.io/planet-rush/

The latest green `main` is what's live at that URL. (The stable
tagged-build-at-root split — with `main`'s newest on a `/dev` path — lands later
per GDD §4.8; for now `main` deploys straight to Pages.)

## Develop

```bash
npm ci          # install pinned deps
npm run dev      # Vite dev server
npm run typecheck # tsc --noEmit
npm test          # vitest (add -- run for a single pass)
npm run build     # typecheck + production build to dist/
```

## CI, deploys & milestone pings

Everything is driven by [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)
(GDD §4.8):

- **On every push and PR — `build`:** typecheck → vitest → determinism-replay
  (QA stub) → headless-smoke (QA stub) → production build. A commit that breaks
  the game can't merge. The two QA gates are named no-op steps today; the QA
  Agent fills in their bodies.
- **On green `main` or a `v*` tag — `deploy`:** publishes `dist/` to GitHub
  Pages via `actions/deploy-pages`.
- **After a `v*` tag deploy — `notify`:** POSTs an [ntfy](https://ntfy.sh) push
  with the play URL and that milestone's "what to test" notes, so a phone gets
  pinged the moment a playable milestone is live (GDD §4.6a).

### One-time setup

1. **GitHub Pages** must be set to build from GitHub Actions. This is enabled
   once for the repo:
   ```bash
   gh api repos/{owner}/{repo}/pages -X POST -f build_type=workflow
   ```
   (Safe to skip if Pages is already enabled — the API returns 409.)

2. **ntfy topic** for milestone pings. Pick any hard-to-guess topic name (it is
   effectively a public channel — anyone who knows the name can read it), then
   store it as a repo secret so the workflow can POST to it:
   ```bash
   gh secret set NTFY_TOPIC --body "planet-rush-<something-unguessable>"
   ```
   Subscribe on your phone by installing the ntfy app and adding that same topic
   (or open `https://ntfy.sh/<topic>` in a browser). If the secret is unset the
   deploy still succeeds — the ping step just logs a warning and skips.

### Milestones

[`milestones.json`](./milestones.json) holds each playable milestone's
`test_notes` (GDD §4.6). The `notify` job looks up the pushed tag under `.tags`
and falls back to `.default`; add a `tags` entry when you tag a milestone,
copying the matching day's notes from the `days` array.

### Tagging a milestone release

```bash
git tag v0.1 && git push origin v0.1
```
CI builds, deploys to Pages, then pings ntfy with the URL and notes.
