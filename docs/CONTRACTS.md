# Module Contracts (FROZEN)

Build against this document, not against other agents' code. Any change goes through the orchestrator.
Where `docs/SPEC.md` and this file disagree on names or shapes, this file wins.

## 0. Conventions

- ES modules, relative imports **with `.js` extensions**. No dependencies. No `Date.now()`, `Math.random()`, DOM, `localStorage` or `fetch` inside `src/logic/` — time and ids are passed in.
- **Timestamps are epoch milliseconds (numbers)** everywhere (`startedAt`, `finishedAt`, `at`, `endsAt`).
- **Stages are 1-based** (1, 2, 3). Tier keys are the strings `"T1"`, `"T2"`, `"T3"`.
- Logic functions **never mutate their inputs**; they return new objects (deep-clone what you change; `structuredClone` is available in Node 17+ and browsers).
- Weights are pounds (numbers). `null` weight = "not set yet" (needs prompt) for weighted lifts, or "no weight" for bodyweight lifts.
- Ids: exercise ids are snake_case strings from `program.json` (`squat`, `bench`, `ohp`, `deadlift`, `lat_pulldown`, `barbell_row`, `barbell_curl`, `hanging_leg_raise`, plus library exercises such as `rdl`). Custom exercise ids are prefixed `custom_`.

## 1. File ownership

| Owner | Files |
|---|---|
| A — Logic | `program.json`, `src/logic/*.js`, `tests/{progression,plates,warmup,onerm,rotation,program-json,workout,session}.test.js` |
| B — State | `src/state/*.js`, `tests/{storage,exportImport,migrations}.test.js` |
| C — UI | `index.html`, `src/ui/**`, `src/styles/*.css` |
| D — Platform | `manifest.webmanifest`, `sw.js`, `precache.js`, `assets/*`, `tools/*`, `src/services/*.js`, `tests/{timer,sw-precache,services}.test.js` |
| Orchestrator | `src/app.js`, `src/version.js`, `package.json`, `README.md`, `docs/*` |

## 2. `program.json` shape

```jsonc
{
  "version": 1,
  "rotation": ["A1", "B1", "A2", "B2"],
  "days": {
    "A1": { "name": "A1", "slots": [
      { "exerciseId": "squat",             "tier": "T1", "label": "T1"  },
      { "exerciseId": "bench",             "tier": "T2", "label": "T2"  },
      { "exerciseId": "lat_pulldown",      "tier": "T3", "label": "T3a" },
      { "exerciseId": "hanging_leg_raise", "tier": "T3", "label": "T3b" }
    ]}
    // B1, A2, B2 per SPEC §2
  },
  "exercises": {
    "squat": {
      "id": "squat", "name": "Squat", "type": "barbell",        // "barbell" | "machine" | "bodyweight"
      "startingWeight": { "T1": 245, "T2": 185 },             // per tier; null = prompt on first use
      "increment": 10,                                          // lb added on success (any tier)
      "smallIncrement": null,                                   // lb used instead when settings.smallIncrements && settings.smallPlates (bench/ohp: 2.5)
      "warmup": true,                                           // generate warm-ups when used as T1
      "plates": true                                            // show plate breakdown
    },
    "hanging_leg_raise": {
      "id": "hanging_leg_raise", "name": "Hanging leg raise", "type": "bodyweight",
      "startingWeight": { "T3": null }, "startingRepTarget": 10,
      "increment": 0, "smallIncrement": null, "warmup": false, "plates": false
    },
    "rdl": { "id": "rdl", "name": "Romanian deadlift", "type": "barbell",
      "startingWeight": { "T1": null, "T2": null, "T3": null }, "increment": 10, "smallIncrement": null,
      "warmup": true, "plates": true, "library": true }        // library: true = not used by default days, offered for substitution
  },
  "tiers": {
    "T1": { "stages": [ {"sets":5,"reps":3,"amrap":true}, {"sets":6,"reps":2,"amrap":true}, {"sets":10,"reps":1,"amrap":true} ],
            "reset": { "type": "t1-reset", "percentOf5RM": 0.85, "lookbackWorkouts": 3 } },
    "T2": { "stages": [ {"sets":3,"reps":10,"amrap":false}, {"sets":3,"reps":8,"amrap":false}, {"sets":3,"reps":6,"amrap":false} ],
            "reset": { "type": "t2-reset", "addMin": 15, "addMax": 20 } },
    "T3": { "stages": [ {"sets":3,"reps":15,"amrap":true} ],
            "weighted":   { "amrapThreshold": 25 },                       // last set >= 25 -> weight + exercise.increment
            "bodyweight": { "sets": 3, "amrapBonus": 5, "repTargetIncrement": 2 } } // last set >= target+5 -> target+2
  },
  "defaults": {
    "barWeight": 45,
    "plates": [45, 35, 25, 15, 10, 5, 2.5],   // gym has 15s (SPEC §5 vectors are tested against the set without 15)
    "smallPlates": [1.25],
    "rest": { "T1": 180, "T2": 120, "T3": 75, "warmup": 60 },
    "warmup": [ {"pct":0,"reps":10}, {"pct":0.4,"reps":5}, {"pct":0.6,"reps":3}, {"pct":0.75,"reps":2}, {"pct":0.85,"reps":1} ]
  }
}
```
`pct: 0` means "the empty bar". Library exercises to include at minimum: `rdl` (Romanian deadlift), `front_squat`, `incline_bench`, `dumbbell_row` (machine-type, plates:false), `chin_up` (bodyweight). Bodyweight exercises use the bodyweight rule regardless of tier.

## 3. State shapes

```js
State = {
  schemaVersion: 1,
  program: {                      // user's modifications to program.json (never edits program.json itself)
    substitutions: { [slotKey]: exerciseId },   // slotKey = `${dayId}:${slotIndex}`, e.g. "B1:1"
    customExercises: { [id]: Exercise }          // same shape as program.json exercises; id starts with "custom_"
  },
  lifts: { [exerciseId]: { [tier]: LiftState } },
  rotationIndex: 0,               // index into program.rotation of the NEXT day to do
  workouts: Workout[],            // finished workouts, oldest first (UI reverses for display)
  inProgress: Workout | null,
  timer: TimerState | null,
  pendingDecisions: Decision[],   // unresolved reset decisions; summary screen must resolve them
  settings: Settings
}

Settings = {
  smallIncrements: false,         // use exercise.smallIncrement (bench/ohp 2.5) — only effective when smallPlates is true
  smallPlates: false,             // add program.defaults.smallPlates (1.25) to the plate set
  barWeight: 45,
  rest: { T1: 180, T2: 120, T3: 75, warmup: 60 },
  warmupStartsTimer: false,
  sound: true,
  vibration: true
}

LiftState = {
  weight: number | null,          // working weight; null = needs prompt (weighted) / n.a. (bodyweight)
  stage: 1,                       // always 1 for T3
  stageStartWeight: number | null,// weight at the start of the current stage-1 run (T1/T2). Initialised = starting weight.
  repTarget: number | null,       // bodyweight lifts only; null otherwise
  history: Event[]
}

Event = {
  at: number,                     // epoch ms
  type: "progress" | "stage" | "reset" | "override" | "init",
  workoutId: string | null,
  from: { weight, stage, stageStartWeight, repTarget },
  to:   { weight, stage, stageStartWeight, repTarget },
  reason: string | null,          // overrides: user text; resets: "tested-5rm" | "estimated-5rm" | "t2-reset"
  detail: object | null           // optional extra info (e.g. reset source sets)
}

Workout = {
  id: string,                     // `w${startedAt}`
  dayId: "A1" | "B1" | "A2" | "B2",
  startedAt: number,
  finishedAt: number | null,
  slots: Slot[],
  changes: Change[] | null,       // filled on finish
  snapshotBefore: { lifts, rotationIndex } | null   // only kept on the MOST RECENT finished workout
}

Slot = {
  slotIndex: number,              // index in the day's slot list
  label: "T1" | "T2" | "T3a" | "T3b",
  exerciseId: string,             // effective exercise (after substitution)
  tier: "T1" | "T2" | "T3",
  stage: number,
  weight: number | null,          // weight to lift = roundToLoadable(lift.weight) for plate exercises, raw otherwise
  requestedWeight: number | null, // (added in review round) raw lift.weight before rounding; UI flags ≈ when it differs
  repTarget: number | null,       // bodyweight only
  scheme: string,                 // display, e.g. "5×3", "3×10", "3×15", "3×10+" (×, U+00D7)
  sets: Set[],
  warmups: Warmup[]               // [] unless tier T1 and exercise.warmup
}
Set = { target: number, reps: number | null, amrap: boolean, done: boolean }
Warmup = { weight: number, reps: number, pct: number, done: boolean }

TimerState = {
  endsAt: number,                 // epoch ms
  durationSec: number,            // original duration (for progress bar)
  exerciseId: string | null,
  slotIndex: number | null,
  setIndex: number | null,
  kind: "working" | "warmup",
  nextLabel: string | null        // e.g. "Squat · set 3 of 5" or null when workout complete
}

Change = {
  slotIndex: number,
  exerciseId: string, tier: string, name: string,
  success: boolean,               // every set >= target (T3/bodyweight: same definition, for display only)
  kind: "increase" | "stage" | "same" | "repTarget" | "pending" | "reset",
  from: { weight, stage, repTarget },
  to:   { weight, stage, repTarget } | null,   // null while kind === "pending"
  message: string                 // human text, e.g. "Next: 255 lb, stage 1" / "Next: stage 2 (6×2) at 245 lb" / "Reset decision needed"
}

Decision = {
  id: string,                     // `${workoutId}:${exerciseId}:${tier}`
  type: "t1-reset" | "t2-reset",
  workoutId: string,
  exerciseId: string, tier: "T1" | "T2", name: string,
  suggestion: T1Suggestion | T2Suggestion,
  context: { currentWeight: number, stageStartWeight: number | null }
}
T1Suggestion = {
  estimated5RM: number | null,    // unrounded e1RM / (1 + 5/30); null if no usable sets
  e1RM: number | null,
  weight: number | null,          // roundToLoadable(0.85 * estimated5RM)
  sourceSets: [{ workoutId, date, weight, reps, e1RM }]  // the best set per considered workout; best one has best:true
}
T2Suggestion = { weight: number, min: number, max: number }  // round(ssw+15), round(ssw+15), round(ssw+20)

DecisionChoice =
  | { method: "tested", fiveRM: number }   // t1: new weight = round(0.85 * fiveRM)
  | { method: "estimate" }                 // t1: use suggestion.weight
  | { weight: number }                     // t2: any value; rounded to loadable for barbell exercises
```

## 4. Logic API (Agent A) — all pure

### `src/logic/plates.js`
```js
plateConfig(program, settings) -> { barWeight, plates: number[] /* desc */ }
  // barWeight = settings.barWeight ?? program.defaults.barWeight; plates = defaults.plates (+ defaults.smallPlates if settings.smallPlates)
loadStep(cfg) -> number                       // 2 × smallest plate (5, or 2.5 with 1.25s)
roundToLoadable(weight, cfg) -> number        // nearest bar + k*step, k>=0; exact ties round DOWN; below bar -> bar
isLoadable(weight, cfg) -> boolean
platesPerSide(weight, cfg) -> number[]        // greedy largest-first for roundToLoadable(weight); [] for bar only
formatPlates(plates) -> string                // [] -> "bar"; [45,25,5] -> "45 + 25 + 5"; 2.5 -> "2.5", 1.25 -> "1.25"
plateBreakdown(weight, cfg) -> { requested, loaded, exact, plates, text }
```
### `src/logic/onerm.js`
```js
epley(weight, reps) -> number                 // w*(1+r/30); reps<=0 or weight null -> 0
estimate5RM(e1rm) -> number                   // e1rm / (1 + 5/30)
bestE1RM(sets) -> { e1RM, set } | null        // sets: [{weight, reps, ...}]; ignores reps<=0
e1rmSeries(workouts, exerciseId, tier = "T1") -> [{ workoutId, date, e1RM, weight, reps }]  // one point per workout (best working set), chronological
```
### `src/logic/warmup.js`
```js
warmupSets(workingWeight, cfg, scheme) -> [{ weight, reps, pct }]
  // scheme = program.defaults.warmup. pct 0 -> bar. Others round to loadable. Drop any non-bar entry <= bar,
  // drop entries >= workingWeight, drop duplicates (keep first). 245 -> bar×10, 100×5, 145×3, 185×2, 210×1.
```
### `src/logic/rotation.js`
```js
nextDayId(program, rotationIndex) -> dayId
advance(program, rotationIndex) -> number     // (i + 1) % rotation.length
```
### `src/logic/program.js`
```js
validateProgram(json) -> { ok: boolean, errors: string[] }
loadProgram(url, fetchFn) -> Promise<Program>                 // fetch + JSON + validate; throws Error with message on invalid
effectiveProgram(baseProgram, stateProgram) -> Program        // merges customExercises into exercises and applies substitutions to days (slot.exerciseId replaced; slot.originalExerciseId kept)
getDay(program, dayId) -> Day
getExercise(program, exerciseId) -> Exercise
listSlots(program) -> [{ dayId, slotIndex, exerciseId, tier, label, originalExerciseId }]  // for settings substitution UI
```
All other logic functions receive the **effective** program.

### `src/logic/progression.js`
```js
incrementFor(exercise, settings) -> number
prescription(program, exerciseId, tier, liftState) -> { stage, sets: [{ target, amrap }], scheme }
  // bodyweight: tiers.T3.bodyweight.sets sets of repTarget, last amrap, scheme "3×10+"
initialLiftState(program, exerciseId, tier) -> LiftState      // weight = startingWeight[tier] ?? null, stage 1, ssw = weight, repTarget for bodyweight
applyWorkout(state, workout, program, now) -> { state, changes: Change[], pendingDecisions: Decision[] }
  // applies §3 to state.lifts for every slot of `workout` (incomplete sets count as reps 0). Base weight for
  // "+ increment" and "same weight" is slot.weight (what was actually lifted). Appends Events to lift history.
  // For stage-3 failures: lift state is left unchanged and a Decision is returned (not yet in state).
  // Does NOT touch workouts/rotation/inProgress/pendingDecisions — see session.finishWorkout.
resolveDecision(state, decision, choice, program, now) -> State
  // applies the reset to state.lifts (stage 1, new weight, stageStartWeight = new weight, history Event type "reset"),
  // removes decision from state.pendingDecisions, and patches the matching Change in state.workouts
  // (kind "reset", `to` filled, message updated). Throws on invalid choice (e.g. tested fiveRM <= 0).
t1ResetWeight(fiveRM, cfg, program, exercise?) -> number     // percentOf5RM * fiveRM, rounded via roundWeightFor(exercise) when given, else roundToLoadable
roundWeightFor(exercise, w, cfg) -> number                   // roundToLoadable if exercise.plates, else w
previewOutcomes(program, exerciseId, tier, liftState, settings) -> { onSuccess: string, onFail: string }
  // human text for the history/state card, e.g. { onSuccess: "255 lb", onFail: "Stage 2 (6×2) at 245 lb" }
slotSuccess(slot) -> boolean                                  // every set reps >= target
```
### `src/logic/workout.js`
```js
buildSlot(state, program, dayId, slotIndex) -> Slot           // uses state.lifts (or initialLiftState if missing)
buildWorkout(state, program, dayId, now) -> Workout           // id `w${now}`, startedAt now, all slots built
logSet(workout, slotIndex, setIndex, reps) -> Workout         // reps integer >= 0; done = true
clearSet(workout, slotIndex, setIndex) -> Workout             // reps null, done false
toggleWarmup(workout, slotIndex, warmupIndex) -> Workout
allSetsDone(workout) -> boolean                               // working sets only
nextSet(workout) -> { slotIndex, setIndex } | null            // first not-done working set in slot order
describeSet(workout, program, pointer) -> string | null       // "Squat · set 3 of 5"
```
### `src/logic/session.js`
```js
ensureLifts(state, program) -> State          // adds initialLiftState for every (exerciseId, tier) used by the effective program's days that is missing; never touches existing
finishWorkout(state, program, now) -> { state, changes, pendingDecisions }
  // requires state.inProgress. snapshotBefore = { lifts, rotationIndex } (deep clone, BEFORE applying);
  // applyWorkout; workout.finishedAt = now, workout.changes = changes; strips snapshotBefore from all older workouts;
  // push workout; rotationIndex = advance(); inProgress = null; timer = null; pendingDecisions = [...existing, ...new].
undoLastWorkout(state) -> State               // restores rotationIndex, and lifts ONLY for the (exerciseId, tier) pairs in the undone workout's slots, from its snapshot, removes that workout,
                                              // removes pendingDecisions with that workoutId, clears inProgress & timer. Throws if nothing to undo.
canUndo(state) -> boolean
applyOverride(state, exerciseId, tier, patch, reason, now) -> State
  // patch: any of { weight, stage, stageStartWeight, repTarget }; logs Event type "override" with reason (null if blank).
  // Creates the lift state if missing (needs program? no — patch is applied over defaults {weight:null,stage:1,ssw:null,repTarget:null}).
setSubstitution(state, dayId, slotIndex, exerciseId | null) -> State     // null removes; does not touch any lift state
addCustomExercise(state, exercise) -> State   // exercise.id must start with "custom_"
```
Substitution must never alter the original exercise's lift state or history (test it).

## 5. State API (Agent B)

### `src/state/schema.js`
```js
SCHEMA_VERSION = 1
defaultSettings(programDefaults) -> Settings
defaultState(programDefaults) -> State        // lifts {} (app calls ensureLifts), rotationIndex 0, workouts [], inProgress null, timer null, pendingDecisions [], program {substitutions:{}, customExercises:{}}
validateState(obj) -> { ok: boolean, errors: string[] }   // structural validation used by import and load
```
### `src/state/migrations.js`
```js
migrations: { [fromVersion]: (state) => state }   // migrations[0] upgrades v0 -> v1; migrations[1] is not defined (v1 is current)
migrate(raw) -> State                              // applies in order up to SCHEMA_VERSION; throws Error("newer schema version N; this app supports M") if raw.schemaVersion > SCHEMA_VERSION; missing schemaVersion = 0
```
v0 (pre-release) = a state object with no `schemaVersion` and no `pendingDecisions`/`timer` fields; v0→v1 adds them with defaults. Include a test proving it.
### `src/state/storage.js`
```js
STORAGE_KEY = "gzclp.state.v1"   // single namespaced key (the ".v1" is fixed; real version lives in schemaVersion)
createStorage(backend = globalThis.localStorage) -> {
  load() -> State | null         // null if absent; migrates; throws on corrupt/newer (app shows message)
  save(state) -> boolean         // JSON.stringify; false on quota/other error
  clear() -> void
  raw() -> string | null
}
createMemoryBackend() -> { getItem, setItem, removeItem }   // localStorage shim for tests (exported for app tests too)
```
### `src/state/exportImport.js`
```js
backupFilename(now) -> "gzclp-backup-YYYY-MM-DD.json"   // local date of `now`
serializeBackup(state, now) -> { filename, text }        // text = JSON with { app: "gzclp", exportedAt: now, schemaVersion, state }
parseBackup(text) -> { ok: true, state, summary } | { ok: false, error: string }
  // rejects malformed JSON, wrong shape, newer schemaVersion (clear messages); migrates older.
  // summary = { schemaVersion, workouts: number, lifts: [{ exerciseId, tier, weight, stage, repTarget }] }
```
Round-trip test: `parseBackup(serializeBackup(s).text).state` deep-equals `s`.

## 6. Services API (Agent D)

### `src/services/timer.js`
```js
startTimer(now, seconds, meta) -> TimerState     // meta: { exerciseId, slotIndex, setIndex, kind, nextLabel }
remainingMs(timer, now) -> number                // endsAt - now (may be negative)
adjustTimer(timer, deltaSec, now) -> TimerState  // endsAt += delta*1000, clamped so endsAt >= now
formatRemaining(ms) -> "m:ss"                    // negative -> "0:00"
createTimerRunner({ now = () => Date.now(), schedule, cancel, onTick, onFinish, doc }) -> {
  set(timer | null, { silentIfExpired = false } = {}),   // starts ticking (or stops for null)
  sync(),                                     // recompute immediately (called on visibilitychange)
  stop()
}
  // schedule/cancel default to requestAnimationFrame-or-250ms setTimeout. Each tick computes remaining from now().
  // onTick(remainingMs, timer); onFinish(timer) fires exactly once per endsAt when remaining <= 0
  // (not fired if set(..., {silentIfExpired:true}) and already expired). If doc given, listens to visibilitychange -> sync().
```
### `src/services/wakeLock.js`
```js
createWakeLock({ nav = navigator, doc = document } = {}) -> { enable(), disable(), isActive() }
  // enable: request 'screen' lock, remember wanted=true, re-acquire on visibilitychange->visible; disable: release, wanted=false. Never throws.
```
### `src/services/alerts.js`
```js
unlockAudio()                       // create/resume AudioContext; safe to call on every gesture
beep({ durationMs = 200, frequency = 880, repeats = 3 } = {})
vibrate(pattern = [200, 100, 200])  // no-op if unsupported
alertTimerDone(settings)            // beep if settings.sound, vibrate if settings.vibration
```
### PWA
- `precache.js` (classic script, generated by `tools/gen-precache.mjs`): `self.APP_VERSION = "1.0.0"; self.PRECACHE_URLS = ["./", "./index.html", ...];`
  The generator reads `src/version.js` and walks the repo, excluding `.git`, `tests`, `tools`, `docs`, `node_modules`, `src/ui/dev`, `README.md`, `package.json`, `sw.js` and `precache.js` (the browser fetches those itself). `program.json` is included.
- `sw.js` (classic): `importScripts('./precache.js')`; cache `gzclp-${APP_VERSION}`; install precaches + `skipWaiting()`; activate deletes other `gzclp-*` caches + `clients.claim()` then `postMessage({type:"sw-updated", version})` to all clients; fetch: cache-first for same-origin GET, network fallback, navigation fallback to `./index.html`.
- `tests/sw-precache.test.js` fails if `precache.js` is stale (different version or file list than the generator would produce).
- App registers `./sw.js` with `{ updateViaCache: "none" }`. Update detection in app: if a controller existed before and `controllerchange` fires or a `sw-updated` message arrives → show "Update available — reload".

## 7. UI API (Agent C)

### Context object passed to every screen
```js
ctx = {
  state,                   // current State (treat as read-only)
  program,                 // effective program
  baseProgram,             // program.json as loaded (for substitution UI)
  version,                 // VERSION string
  actions,                 // see below; all return void unless noted, app re-renders after each
  navigate(route)          // "workout" | "history" | "settings" | "summary"
}
```
### Actions implemented by `src/app.js` (UI calls these; never mutates state itself)
```js
actions = {
  logSet(slotIndex, setIndex, reps),            // logs + saves + starts rest timer (working sets)
  clearSet(slotIndex, setIndex),
  toggleWarmup(slotIndex, warmupIndex),
  changeDay(dayId),                             // rebuild inProgress for dayId (UI confirms first if any set done)
  finishWorkout(),                              // UI confirms first if !allSetsDone; app navigates to summary
  discardWorkout(),                             // UI confirms first
  resolveDecision(decisionId, choice),          // choice per DecisionChoice; may throw -> UI shows message
  dismissSummary(),                             // only allowed when pendingDecisions is empty; navigates to workout
  timerAdjust(deltaSec), timerSkip(),
  setStartingWeight(exerciseId, tier, weight),  // override with reason "starting weight"; refreshes the slot in inProgress
  updateSettings(patch),                        // shallow merge; `rest` merged one level deep
  overrideLift(exerciseId, tier, patch, reason),
  setSubstitution(dayId, slotIndex, exerciseIdOrNull),
  addCustomExercise({ name, type, startingWeight, increment }) -> id,
  undoLastWorkout(),                            // UI confirms first
  exportData(),                                 // triggers download
  previewImport(text) -> { ok, summary } | { ok:false, error },
  confirmImport(text),
  resetAll(),                                   // UI confirms first
  reloadForUpdate()
}
```
### Exports
```js
// src/ui/router.js
parseRoute(hash) -> "workout" | "history" | "settings" | "summary"   // default "workout"
navigate(route)                    // sets location.hash = `#/${route}`
onRouteChange(cb) -> unsubscribe   // cb(route) on hashchange

// src/ui/screens/{workout,summary,history,settings}.js
export function render(root, ctx) -> (cleanup?: () => void)          // replace root's contents

// src/ui/components/timerBar.js
createTimerBar(el, { onAdjust(deltaSec), onSkip() }) -> { show(timer, remainingMs), hide() }
// src/ui/components/repEntry.js
openRepEntry({ title, initial, min = 0, max = 100, allowClear = false }) -> Promise<number | "clear" | null>  // null = cancelled
// src/ui/components/dialog.js
confirmDialog(message, { okLabel, cancelLabel, danger }) -> Promise<boolean>
promptNumber({ title, message, initial, step, min, max }) -> Promise<number | null>
showToast(message)
showUpdateBanner(onReload)
// src/ui/components/plateBadge.js
plateBadge(weight, cfg) -> HTMLElement          // "245 lb · 45 + 45 + 10", flagged if !exact
// src/ui/components/setButton.js
createSetButton({ set, index, onTap, onFewer }) -> HTMLElement   // long-press 500ms -> onFewer; visible "fewer" control too
// src/ui/components/chart.js
renderE1rmChart(el, series, { onPointTap }) -> void                // inline SVG + table fallback
```
### `index.html` landmarks
`<main id="screen">` (screen root), `<div id="timer">` (timer bar mount, fixed bottom, above nav), `<nav id="tabs">` with links `#/workout`, `#/history`, `#/settings`, `<div id="modal-root">`, `<div id="banner-root">`. Loads `./src/styles/base.css`, `./src/styles/screens.css`, `<script type="module" src="./src/app.js">`. Links `./manifest.webmanifest`, Apple meta tags, `./assets/icon-192.png` as apple-touch-icon.

Dev harness (optional, not shipped in precache): `src/ui/dev/preview.html` + `src/ui/dev/fixtures.js` render screens with fake state and stub actions.

## 8. Behaviour decisions (resolved ambiguities)

1. **First launch**: app auto-builds `inProgress` for the next day whenever the workout screen is shown with `inProgress === null` and no pending decisions. Discard → a fresh one is built next time.
2. **Null starting weight** (barbell curl, substitutes): the slot renders an "Enter starting weight" button instead of set buttons; `setStartingWeight` persists via override. App also proactively prompts when the workout screen opens with such a slot. Once set, never asked again.
3. **Progression base** = `slot.weight` (the rounded, actually-lifted weight). Machine/non-plate weights are not rounded.
4. **T1 Epley lookback** = the last 3 finished workouts (including the one being finished) containing that exerciseId as T1; best set per workout listed; best overall used.
5. **T2 reset** uses `stageStartWeight` literally as specified. After a reset (T1 or T2) `stageStartWeight = new weight`.
6. **Incomplete sets** on finish count as reps 0 (failure).
7. **Change day** replaces `inProgress`; completing any day advances `rotationIndex` by exactly one.
8. **Warm-ups** with `warmupStartsTimer` use `settings.rest.warmup` (60 s).
9. **Bodyweight exercises** always use the rep-target rule, any tier. Substitution UI only offers non-bodyweight exercises for T1/T2 slots.
10. **Snapshot** kept only on the newest finished workout (undo is limited to it) to keep storage small.
11. **Expired timer on reload**: cleared silently (no beep).
12. **Increment toggle**: `smallIncrement` applies only if both `smallIncrements` and `smallPlates` are on; UI notes the dependency.
