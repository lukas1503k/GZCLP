# GZCLP Tracker

A mobile-first, offline-capable workout tracker for the GZCLP linear progression program. It shows the next workout, the working weight and plates per side, times your rest, applies the progression rules when you finish, and tells you what changes next time.

Static vanilla HTML/CSS/JS — no build step, no dependencies. Installable as a PWA; works with no signal at the gym. All data stays in your browser's `localStorage`.

_Screenshots: TODO_

## Run locally

```bash
python3 -m http.server 8000
```

Open http://localhost:8000/. (A service worker caches the app; use a private window or DevTools → Application → "Update on reload" while developing.)

## Tests

```bash
npm test
```

Uses Node's built-in test runner (Node 20+); nothing to install.

## Editing the program

Everything about the program lives in [`program.json`](program.json): the day rotation, slot order, exercises (starting weights per tier, increments, whether to show plates/warm-ups), tier stage schemes and reset rules, rest defaults, bar weight, available plates and the warm-up scheme. The code reads it at startup — e.g. change `"increment": 10` on squat to `5` and squat progresses by 5 lb. `tests/program-json.test.js` validates the shipped file.

Starting weights only apply to lifts with no saved state yet; use **Settings → Manual override** to change a lift you've already been training.

After editing any shipped file, bump the version (below) so installed copies pick it up.

## Deploy to GitHub Pages

1. Push to `main`.
2. Repo **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
3. Wait a few minutes for the first deploy; the app is at `https://<user>.github.io/<repo>/`. All paths are relative, so the subpath works.

### Shipping an update

1. Bump `VERSION` in [`src/version.js`](src/version.js).
2. Run `npm run precache` to regenerate `precache.js` (the service worker's file list + cache name). `npm test` fails if you forget.
3. Commit and push. Next time the app is opened, it shows **"Update available — reload"**.

If you add or rename files, step 2 is required too. Icons are regenerated with `npm run icons`.

## Project layout

| Path | What |
|---|---|
| `src/logic/` | Pure progression, plates, warm-ups, e1RM, rotation, workout/session transitions |
| `src/state/` | Schema, migrations, localStorage persistence, backup export/import |
| `src/services/` | Rest timer (timestamp-based), wake lock, beep/vibrate |
| `src/ui/` | Hash router, screens (workout, summary, history, settings), components |
| `src/app.js` | Bootstrap and wiring |
| `sw.js`, `precache.js`, `manifest.webmanifest` | PWA |
| `docs/` | Spec, module contracts, acceptance checklist |

## Known platform limits

- **iOS Safari** doesn't support `navigator.vibrate` — the timer only beeps.
- **Screen Wake Lock** requires iOS/iPadOS 16.4+ (and HTTPS); elsewhere the screen may dim during rest.
- **Audio** needs a user gesture first; the app unlocks it on your first tap each session. The beep won't sound if the phone is on silent (iOS) or the app is fully backgrounded.
- Data lives in one browser on one device. Use **Settings → Export** for backups. iOS may evict storage for home-screen apps that go unused for weeks.
