// Dev harness: renders each screen with fixture State and stub actions that
// console.log, mutate the fixture and re-render. Open /src/ui/dev/preview.html
// Query params: ?scenario=<id>&bare=1 (hide dev bar). Route comes from the hash.

import { SCENARIOS } from "./fixtures.js";
import { loadProgram, effectiveProgram } from "../../logic/program.js";
import { logSet, clearSet, toggleWarmup, buildWorkout, nextSet, describeSet, allSetsDone } from "../../logic/workout.js";
import { finishWorkout, undoLastWorkout, applyOverride, setSubstitution, addCustomExercise, ensureLifts } from "../../logic/session.js";
import { resolveDecision } from "../../logic/progression.js";
import { startTimer, adjustTimer, remainingMs } from "../../services/timer.js";
import { parseRoute, navigate, onRouteChange } from "../router.js";
import { createTimerBar } from "../components/timerBar.js";
import { showToast, showUpdateBanner } from "../components/dialog.js";
import * as workoutScreen from "../screens/workout.js";
import * as summaryScreen from "../screens/summary.js";
import * as historyScreen from "../screens/history.js";
import * as settingsScreen from "../screens/settings.js";

const SCREENS = { workout: workoutScreen, summary: summaryScreen, history: historyScreen, settings: settingsScreen };
const params = new URLSearchParams(location.search);
if (params.get("bare")) document.documentElement.classList.add("bare");

let baseProgram;
let program;
let fixture = { state: null };
let scenarioId = params.get("scenario") || "workout-mid";
let cleanup = null;
let timerBar;

const now = () => Date.now();

function set(next, why) {
  console.log("[preview] action:", why);
  fixture.state = next;
  program = effectiveProgram(baseProgram, next.program);
  render();
}

function startRest(seconds, meta) {
  fixture.state = { ...fixture.state, timer: startTimer(now(), seconds, meta) };
}

const log = (name, ...args) => console.log(`[preview] ${name}`, ...args);

const actions = {
  logSet(slotIndex, setIndex, reps) {
    log("logSet", slotIndex, setIndex, reps);
    const workout = logSet(fixture.state.inProgress, slotIndex, setIndex, reps);
    fixture.state = { ...fixture.state, inProgress: workout };
    const slot = workout.slots[slotIndex];
    if (!allSetsDone(workout)) {
      startRest(fixture.state.settings.rest[slot.tier], {
        exerciseId: slot.exerciseId, slotIndex, setIndex, kind: "working",
        nextLabel: describeSet(workout, program, nextSet(workout)),
      });
    }
    set(fixture.state, "logSet");
  },
  clearSet(slotIndex, setIndex) { log("clearSet", slotIndex, setIndex); set({ ...fixture.state, inProgress: clearSet(fixture.state.inProgress, slotIndex, setIndex) }, "clearSet"); },
  toggleWarmup(slotIndex, i) { log("toggleWarmup", slotIndex, i); set({ ...fixture.state, inProgress: toggleWarmup(fixture.state.inProgress, slotIndex, i) }, "toggleWarmup"); },
  changeDay(dayId) { log("changeDay", dayId); set({ ...fixture.state, timer: null, inProgress: buildWorkout(fixture.state, program, dayId, now()) }, "changeDay"); },
  finishWorkout() {
    log("finishWorkout");
    const r = finishWorkout(fixture.state, program, now());
    fixture.state = r.state;
    navigate("summary");
  },
  discardWorkout() { log("discardWorkout"); set({ ...fixture.state, inProgress: null, timer: null }, "discard"); },
  resolveDecision(id, choice) {
    log("resolveDecision", id, choice);
    const d = fixture.state.pendingDecisions.find((x) => x.id === id);
    set(resolveDecision(fixture.state, d, choice, program, now()), "resolveDecision");
  },
  dismissSummary() { log("dismissSummary"); navigate("workout"); },
  timerAdjust(delta) { log("timerAdjust", delta); if (fixture.state.timer) fixture.state = { ...fixture.state, timer: adjustTimer(fixture.state.timer, delta, now()) }; },
  timerSkip() { log("timerSkip"); fixture.state = { ...fixture.state, timer: null }; timerBar.hide(); },
  setStartingWeight(exerciseId, tier, weight) {
    log("setStartingWeight", exerciseId, tier, weight);
    const next = applyOverride(fixture.state, exerciseId, tier, { weight, stageStartWeight: weight }, "starting weight", now());
    const ip = next.inProgress && {
      ...next.inProgress,
      slots: next.inProgress.slots.map((sl) => (sl.exerciseId === exerciseId && sl.tier === tier ? { ...sl, weight } : sl)),
    };
    set({ ...next, inProgress: ip }, "setStartingWeight");
  },
  updateSettings(patch) {
    log("updateSettings", patch);
    const st = fixture.state.settings;
    set({ ...fixture.state, settings: { ...st, ...patch, rest: { ...st.rest, ...(patch.rest || {}) } } }, "updateSettings");
  },
  overrideLift(exerciseId, tier, patch, reason) { log("overrideLift", exerciseId, tier, patch, reason); set(applyOverride(fixture.state, exerciseId, tier, patch, reason, now()), "overrideLift"); },
  setSubstitution(dayId, slotIndex, id) {
    log("setSubstitution", dayId, slotIndex, id);
    const next = setSubstitution(fixture.state, dayId, slotIndex, id);
    set(ensureLifts(next, effectiveProgram(baseProgram, next.program)), "setSubstitution");
  },
  addCustomExercise({ name, type, startingWeight, increment }) {
    log("addCustomExercise", name, type, startingWeight, increment);
    const id = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    const sw = { T1: startingWeight ?? null, T2: startingWeight ?? null, T3: startingWeight ?? null };
    set(addCustomExercise(fixture.state, {
      id, name, type, startingWeight: sw, increment, smallIncrement: null,
      warmup: type === "barbell", plates: type === "barbell", ...(type === "bodyweight" ? { startingRepTarget: 10 } : {}),
    }), "addCustomExercise");
    return id;
  },
  undoLastWorkout() { log("undoLastWorkout"); set(undoLastWorkout(fixture.state), "undo"); },
  exportData() { log("exportData"); showToast("(preview) export would download a file"); },
  previewImport(text) {
    log("previewImport", text.length);
    try {
      const data = JSON.parse(text);
      const st = data.state || data;
      return { ok: true, summary: { schemaVersion: st.schemaVersion, workouts: (st.workouts || []).length, lifts: [] } };
    } catch (e) { return { ok: false, error: `Not valid JSON: ${e.message}` }; }
  },
  confirmImport(text) { log("confirmImport", text.length); showToast("(preview) import confirmed"); },
  resetAll() { log("resetAll"); loadScenario("empty"); },
  reloadForUpdate() { log("reloadForUpdate"); },
};

function render() {
  const route = parseRoute(location.hash);
  if (route === "workout" && !fixture.state.inProgress && !fixture.state.pendingDecisions.length) {
    fixture.state = ensureLifts(fixture.state, program);
    fixture.state = { ...fixture.state, inProgress: buildWorkout(fixture.state, program, program.rotation[fixture.state.rotationIndex], now()) };
  }
  if (typeof cleanup === "function") cleanup();
  const ctx = { state: fixture.state, program, baseProgram, version: "1.0.0-preview", actions, navigate };
  cleanup = SCREENS[route].render(document.getElementById("screen"), ctx);
  for (const a of document.querySelectorAll("#tabs a")) {
    const on = a.getAttribute("href") === `#/${route}` || (route === "summary" && a.getAttribute("href") === "#/workout");
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
}

function loadScenario(id) {
  scenarioId = SCENARIOS[id] ? id : "workout-mid";
  const sc = SCENARIOS[scenarioId];
  const st = sc.build();
  // Rebase fixture timer to real "now" so it counts down in the browser.
  if (st.timer) st.timer = { ...st.timer, endsAt: now() + 128 * 1000 };
  fixture = { state: st };
  program = effectiveProgram(baseProgram, st.program);
  document.getElementById("dev-scenario").value = scenarioId;
  const url = new URL(location.href);
  url.searchParams.set("scenario", scenarioId);
  url.hash = `#/${sc.route}`;
  history.replaceState(null, "", url);
  render();
}

function tick() {
  const t = fixture.state?.timer;
  if (t) {
    const ms = remainingMs(t, now());
    timerBar.show(t, ms);
    if (ms <= -1500) { fixture.state = { ...fixture.state, timer: null }; timerBar.hide(); }
  } else {
    timerBar.hide();
  }
  setTimeout(tick, 250);
}

async function boot() {
  baseProgram = await loadProgram("../../../program.json", (u) => fetch(u));
  const sel = document.getElementById("dev-scenario");
  for (const [id, sc] of Object.entries(SCENARIOS)) sel.append(new Option(sc.label, id));
  sel.addEventListener("change", () => loadScenario(sel.value));
  document.getElementById("dev-reset").addEventListener("click", () => loadScenario(scenarioId));
  timerBar = createTimerBar(document.getElementById("timer"), {
    onAdjust: (d) => actions.timerAdjust(d), onSkip: () => actions.timerSkip(),
  });
  onRouteChange(() => render());
  loadScenario(scenarioId);
  if (params.get("banner")) showUpdateBanner(() => log("reload"));
  tick();
}

boot().catch((err) => { console.error(err); document.getElementById("screen").textContent = `Preview failed: ${err.message}`; });
