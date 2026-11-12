# GZCLP Workout Tracker — Build Spec

(Original spec from the product owner, saved verbatim minus the orchestration section. Where this spec and `docs/CONTRACTS.md` differ on names or shapes, CONTRACTS.md wins — it records the orchestrator's resolution of ambiguities.)

## 0. Product summary

A mobile-first, offline-capable workout tracker for the GZCLP linear progression program. Personal use, single user, pounds only. Static site deployable from the repo root to GitHub Pages. Installable as a PWA so it works with no signal at the gym.

The app must do the thinking: show me the next workout, tell me the weight and the plates, time my rest, apply the progression rules when I finish, and tell me what changes next time.

## 1. Hard constraints (non-negotiable)

- **Static only.** Vanilla HTML/CSS/JS. No build step, no bundler, no transpiler, no framework.
- **Zero runtime dependencies.** No CDN scripts, no npm packages in the shipped app. Everything must load from the repo so it works offline. (Node's built-in test runner is allowed for tests; nothing else.)
- **ES modules everywhere** so the same source runs in the browser and in Node tests without modification.
- **Relative paths only** (`./` not `/`) so it works when served from `https://<user>.github.io/<repo>/`.
- **All data in `localStorage`**, under a single namespaced key, with a schema version and migration hook.
- **Program definition lives in `program.json`**, not in code. Logic must never hard-code exercise names, weights, or increments.
- **Progression logic is pure functions** with no DOM or storage access, fully unit tested.
- **No two subagents edit the same file.**

## 2. Program definition (`program.json`)

### Rotation
Four days, cycled in order regardless of calendar: A1 → B1 → A2 → B2 → A1 … The app always shows the next uncompleted day. Completing a workout advances the pointer. Abandoning a workout does not.

| Day | T1 | T2 | T3a | T3b | T3c |
|---|---|---|---|---|---|
| A1 | Squat | Bench | Romanian deadlift | Lat pulldown | Hanging leg raise |
| B1 | OHP | Deadlift | Barbell row | Barbell curl | Leg press |
| A2 | Bench | Squat | Romanian deadlift | Lat pulldown | Hanging leg raise |
| B2 | Deadlift | OHP | Barbell row | Barbell curl | Leg press |

Leg accessories: RDL runs on every squat day (A1/A2), right after T2; leg press on every deadlift day (B1/B2), with the other T3s.

### Starting weights (lb)
- **T1:** Squat 245, Deadlift 270, Bench 145, OHP 100
- **T2:** Squat 185, Deadlift 205, Bench 110, OHP 75
- **T3:** Barbell row 95, Lat pulldown 100, Barbell curl / Romanian deadlift / Leg press **null** → app must prompt for a starting weight on first use and persist it
- **Hanging leg raise:** bodyweight, rep-target based (starting target 3×10)

Note: the same lift has independent state in T1 and T2. Squat-as-T1 and Squat-as-T2 are tracked separately.

### Increments (lb)
- Squat +10, Deadlift +10, Bench +5, OHP +5
- Settings toggle: use +2.5 for Bench/OHP instead of +5. This toggle only makes sense when 1.25 lb plates are enabled; the UI should say so.
- T3 weighted lifts: +5 on success (RDL and leg press: +10)

### `program.json` shape
Must contain: `version`, `rotation` (ordered day ids), `days` (each with ordered slots `{exerciseId, tier}`), `exercises` (each with `id`, `name`, `type: "barbell" | "machine" | "bodyweight"`, `startingWeight` per tier where applicable, `increment`, `warmup: true/false`, `plates: true/false`), `tiers` (stage definitions per tier, below), and `defaults` (rest seconds, bar weight, available plates). Provide a JSON Schema or a validator function and test that the shipped `program.json` passes it.

## 3. Progression rules (exact semantics — implement these, not your memory of GZCLP)

All rules operate on a per-(exercise, tier) state object: `{ weight, stage, stageStartWeight, repTarget (bodyweight only), history }`.

### Definitions
- **Target reps**: the prescribed reps for a set at the current stage.
- **AMRAP set**: last set of the exercise; counts as hit if reps ≥ target.
- **Success**: every set (including AMRAP) reached ≥ target reps.
- **Failure**: any set below target.
- **Loadable weight**: a weight achievable with the 45 lb bar and the enabled plate set (see §5). Smallest step is 5 lb (2.5 lb if 1.25 plates enabled).
- **Round to loadable**: nearest loadable weight; exact ties round **down**.
- **Epley e1RM**: `w × (1 + r / 30)`. Estimated 5RM from e1RM: `e1RM / (1 + 5/30)`.

### T1
| Stage | Scheme | AMRAP |
|---|---|---|
| 1 | 5 × 3 | last set |
| 2 | 6 × 2 | last set |
| 3 | 10 × 1 | last set |

- Success at any stage → same stage, weight + increment.
- Failure at stage 1 or 2 → same weight, next stage.
- Failure at stage 3 → **reset flow**: prompt me to either (a) enter a freshly tested 5RM, or (b) accept an estimated 5RM derived from the best Epley e1RM over the last 3 workouts for this lift (show the sets it came from). New weight = round-to-loadable(0.85 × 5RM). Restart at stage 1. Record the reset event in history.

### T2
| Stage | Scheme |
|---|---|
| 1 | 3 × 10 |
| 2 | 3 × 8 |
| 3 | 3 × 6 |

- No AMRAP sets.
- Success → same stage, weight + increment.
- Failure at stage 1 or 2 → same weight, next stage.
- Failure at stage 3 → **reset flow**: propose new stage-1 weight = `stageStartWeight` (the weight used the first time I entered the *current* stage-1 run) + 15 lb, rounded to loadable, and let me adjust within a suggested 15–20 lb window or type any value. Restart at stage 1 and record the new `stageStartWeight`.

### T3 (weighted: barbell row, lat pulldown, barbell curl)
- Always 3 × 15, last set AMRAP.
- If the last set reaches **≥ 25 reps** → weight + 5 next time. Otherwise weight unchanged. No stages, no failure state.

### Romanian deadlift (T3 slot, double progression)
- Exercise-level `progression: { type: "double", sets: 3, minReps: 8, maxReps: 12 }` in `program.json`; it only applies when the exercise sits in a T3 slot (as a T1/T2 substitute it follows that tier's stages). Stiff-leg deadlift and good morning (its suggested substitutes) carry the same rule.
- 3 straight sets (no AMRAP) at the current rep goal, which starts at 8. Reps are entered per set (tapping a set opens the rep entry). UI hint: "Stop with ~2 reps in reserve".
- All 3 sets ≥ 12 → weight + 10, goal back to 8.
- Otherwise the weight stays. If every set reached the goal, the next goal is the weakest set + 1 (max 12); if not, the goal is unchanged.

### Leg press (T3, standard rule)
- 3 × 15, last set AMRAP; AMRAP ≥ 25 → + 10 lb. Suggested substitutes: hack squat, Bulgarian split squat.

### Hanging leg raise (bodyweight, rep-target)
- 3 sets, last set AMRAP, target starts at 10.
- If the last set reaches **≥ target + 5** (i.e. 15 when target is 10) → target + 2 next time.
- No weight.

### Manual overrides (always available)
- Per lift and tier: set weight, set stage, set rep target, set `stageStartWeight`. Overrides are logged in history with a reason field (optional).
- Exercise substitution in Settings: replace any slot's exercise with another (built-in or user-defined). The substitute has its own independent state (e.g. swap T2 Deadlift for Romanian deadlift at its own weight). Substitution must not corrupt the original exercise's history.

## 4. Workout screen

- **Dark theme only** (no toggle needed). High contrast, large type.
- **One-handed, thumb-reachable.** Primary actions in the bottom third of the screen. Minimum tap target 56 × 56 px.
- Header shows day name (e.g. "A2") and date. Exercises stacked vertically in slot order with tier badge.
- Each exercise shows: name, tier, stage/scheme (e.g. "T1 · Stage 1 · 5×3"), working weight, plates per side (§5), rest default.
- **Set buttons**: one large button per set showing target reps.
  - Tap → log set as completed at target reps, start rest timer.
  - Tap on an AMRAP set → open a quick numeric entry (big +/- stepper pre-filled with target, plus direct number input), then log and start timer.
  - Long-press (≈500 ms) **or** a visible secondary "fewer reps" control on any set → open the same numeric entry to log fewer reps. Do not rely on long-press alone (discoverability).
  - Tapping a completed set lets me edit or un-complete it.
- **T1 warm-ups**: auto-generated and shown collapsible above the working sets. Scheme: bar × 10, 40% × 5, 60% × 3, 75% × 2, 85% × 1 of working weight, each rounded to loadable. Drop any warm-up that rounds to ≤ bar weight (except the bar set itself) and drop duplicates. Warm-up sets are tappable to tick off but don't affect progression or start the timer unless a setting says so (default: off).
- **In-progress persistence**: every tap writes to storage immediately. Killing and reopening the app resumes the workout exactly where it was.
- **Finish**: "Finish workout" button appears once every working set has a result (or I confirm finishing with incomplete sets, which are treated as failed). On finish: apply §3 rules, save the workout, advance the rotation, and show a **summary screen** listing, per exercise: what I did, success/fail, and what changes next time (new weight, new stage, or a pending reset decision). Reset decisions (§3) are resolved on this screen before it can be dismissed.
- **Other actions**: "Change day" (pick any of the four days without altering rotation order — completing it still advances the pointer), "Discard workout".

## 5. Plate calculator

- Bar: 45 lb (editable in settings).
- Plates available per side: 45, 35, 25, 10, 5, 2.5. Settings toggle adds 1.25.
- Greedy algorithm, largest plate first. Output as a string "45 + 25 + 5" and as an array.
- Shown for **every** barbell weight displayed anywhere (working sets, warm-ups, settings previews, history). Not shown for exercises with `plates: false` (lat pulldown, hanging leg raise).
- If a weight is not loadable with the current plate set, display the nearest loadable weight and flag it visually.
- Bar-only shows "bar".

Reference vectors (must pass as tests):

| Weight | Per side |
|---|---|
| 45 | bar |
| 75 | 10 + 5 |
| 100 | 25 + 2.5 |
| 110 | 25 + 5 + 2.5 |
| 135 | 45 |
| 145 | 45 + 5 |
| 185 | 45 + 25 |
| 205 | 45 + 35 |
| 245 | 45 + 45 + 10 |
| 270 | 45 + 45 + 10 + 10 + 2.5 |

## 6. Rest timer

- Auto-starts on completing a working set. Defaults: T1 180 s, T2 120 s, T3 75 s (bodyweight T3 uses the T3 default). Editable in settings.
- Controls: −30 s, +30 s, skip. Shows remaining time large, plus which exercise/set is next.
- **Implementation**: store `endsAt` as an epoch timestamp; render by computing `endsAt − Date.now()` on each animation frame / 250 ms tick. Never count down with an accumulating `setInterval`. Must be correct after the phone sleeps or the tab is backgrounded; re-sync on `visibilitychange`.
- **On finish**: `navigator.vibrate` pattern (where supported — note iOS Safari does not support it) plus a short synthesized beep via Web Audio (no audio asset files). Audio context must be unlocked by the first user gesture of the session.
- **Wake Lock**: request `navigator.wakeLock` when a workout screen is active; release when leaving; re-acquire on `visibilitychange` → visible. Fail silently where unsupported.
- Timer persists in storage so a reload mid-rest still shows the correct remaining time.

## 7. History & progress

- **Workout log**: reverse-chronological list; tap to expand into all sets with weight × reps and success/fail markers. Each entry shows what progression it triggered.
- **Undo last workout**: restores the exact pre-workout state snapshot (progression state + rotation pointer) and deletes the entry. Only the most recent workout can be undone.
- **Per-lift e1RM chart** for the four T1 lifts: Epley e1RM from the best T1 set of each workout, plotted over time. Hand-rolled inline SVG (no library). Tap a point to see the set it came from. Show a simple table fallback under the chart.
- **Per-lift current state card**: weight, stage, last 3 results, next scheduled change.

## 8. Settings

- Increment toggle (+2.5 for Bench/OHP), 1.25 lb plate toggle, bar weight, rest defaults per tier, warm-up-starts-timer toggle, sound on/off, vibration on/off.
- Per-lift manual override panel (§3).
- Exercise substitution (§3).
- **Export**: download full state as `gzclp-backup-YYYY-MM-DD.json` (includes schema version).
- **Import**: file picker → validate against schema → preview summary (number of workouts, current weights) → confirm → replace state. Reject files with a newer schema version than the app supports; migrate older ones.
- **Reset all data** behind a confirm dialog.
- About: app version (from a `version.js` constant, also used as the service worker cache name).

## 9. PWA

- `manifest.webmanifest`: name, short name, `start_url: "./"`, `scope: "./"`, `display: "standalone"`, dark `theme_color`/`background_color`, icons 192 and 512 (maskable + any). Generate icons with a script in `tools/` that writes PNGs from an SVG, or ship a hand-written SVG icon plus PNGs; no external services.
- `sw.js`: precache every app asset on install (list generated from the file structure, including `program.json`); cache-first strategy; versioned cache name derived from `version.js`; delete old caches on activate; `skipWaiting` + `clients.claim`; post a message to the page when a new version is ready so the UI can show "Update available — reload".
- Register the SW from `app.js` with a relative path. Guard for environments without SW support.
- Add Apple meta tags (`apple-mobile-web-app-capable`, status bar style, touch icon) so Add-to-Home-Screen works on iOS.

## 10. Architecture

Every module in `src/logic/` is pure (no DOM, no storage, no `Date.now()` — time is passed in). See `docs/CONTRACTS.md` for the frozen file list, signatures and shapes.

## 13. Decisions that are not to be revisited
- lb only; no kg mode.
- Dark theme only.
- Hash-based routing; single `index.html`.
- Greedy plate algorithm, ties round down.
- Epley for all 1RM estimation.
- Undo limited to the most recent workout.
