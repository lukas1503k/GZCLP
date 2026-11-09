// App bootstrap: loads the program and state, wires UI actions to pure logic + storage,
// runs the rest timer, manages wake lock, and registers the service worker.

import { VERSION } from "./version.js";
import { loadProgram, effectiveProgram } from "./logic/program.js";
import { ensureLifts, finishWorkout, undoLastWorkout, applyOverride, setSubstitution, addCustomExercise } from "./logic/session.js";
import { buildWorkout, buildSlot, logSet, clearSet, toggleWarmup, allSetsDone, nextSet, describeSet } from "./logic/workout.js";
import { resolveDecision } from "./logic/progression.js";
import { nextDayId } from "./logic/rotation.js";
import { defaultState } from "./state/schema.js";
import { createStorage } from "./state/storage.js";
import { serializeBackup, parseBackup } from "./state/exportImport.js";
import { startTimer, adjustTimer, createTimerRunner } from "./services/timer.js";
import { createWakeLock } from "./services/wakeLock.js";
import { unlockAudio, alertTimerDone } from "./services/alerts.js";
import { parseRoute, navigate, onRouteChange } from "./ui/router.js";
import { createTimerBar } from "./ui/components/timerBar.js";
import { confirmDialog, promptNumber, showToast, showUpdateBanner } from "./ui/components/dialog.js";
import * as workoutScreen from "./ui/screens/workout.js";
import * as summaryScreen from "./ui/screens/summary.js";
import * as historyScreen from "./ui/screens/history.js";
import * as settingsScreen from "./ui/screens/settings.js";

const SCREENS = { workout: workoutScreen, summary: summaryScreen, history: historyScreen, settings: settingsScreen };

const storage = createStorage();
const wakeLock = createWakeLock();
let baseProgram = null;
let program = null;
let state = null;
let cleanup = null;
let timerBar = null;
let runner = null;
const promptedStartingWeights = new Set();

const now = () => Date.now();

// ---------- state plumbing ----------

function commit(next, { rerender = true } = {}) {
  state = next;
  program = effectiveProgram(baseProgram, state.program);
  if (!storage.save(state)) showToast("Couldn't save — storage may be full. Export a backup.");
  if (rerender) render();
}

function slotHasProgress(slot) {
  return slot.sets.some((s) => s.done) || slot.warmups.some((w) => w.done);
}

// Rebuild in-progress slots the user hasn't touched yet, so setting/override/substitution
// changes show up immediately without wiping logged sets.
function refreshUntouchedSlots(s, filter = () => true) {
  if (!s.inProgress) return s;
  const prog = effectiveProgram(baseProgram, s.program);
  const withLifts = ensureLifts(s, prog);
  const slots = withLifts.inProgress.slots.map((slot) =>
    !slotHasProgress(slot) && filter(slot) ? buildSlot(withLifts, prog, withLifts.inProgress.dayId, slot.slotIndex) : slot
  );
  return { ...withLifts, inProgress: { ...withLifts.inProgress, slots } };
}

function ensureInProgress() {
  if (state.inProgress || state.pendingDecisions.length) return;
  const dayId = nextDayId(program, state.rotationIndex);
  commit({ ...state, inProgress: buildWorkout(state, program, dayId, now()) }, { rerender: false });
}

// ---------- timer ----------

function setTimer(timer) {
  commit({ ...state, timer }, { rerender: false });
  runner.set(timer);
  if (!timer) timerBar.hide();
}

function startRest(seconds, meta) {
  if (!seconds || seconds <= 0) return;
  setTimer(startTimer(now(), seconds, meta));
}

function onTimerFinish() {
  alertTimerDone(state.settings);
  commit({ ...state, timer: null }, { rerender: false });
  setTimeout(() => { if (!state.timer) timerBar.hide(); }, 1500);
}

// ---------- actions ----------

const actions = {
  logSet(slotIndex, setIndex, reps) {
    ensureInProgress();
    const wasDone = state.inProgress.slots[slotIndex].sets[setIndex].done;
    const workout = logSet(state.inProgress, slotIndex, setIndex, reps);
    commit({ ...state, inProgress: workout });
    if (wasDone || allSetsDone(workout)) return;
    const slot = workout.slots[slotIndex];
    startRest(state.settings.rest[slot.tier], {
      exerciseId: slot.exerciseId, slotIndex, setIndex, kind: "working",
      nextLabel: describeSet(workout, program, nextSet(workout)),
    });
  },
  clearSet(slotIndex, setIndex) {
    commit({ ...state, inProgress: clearSet(state.inProgress, slotIndex, setIndex) });
  },
  toggleWarmup(slotIndex, warmupIndex) {
    const workout = toggleWarmup(state.inProgress, slotIndex, warmupIndex);
    commit({ ...state, inProgress: workout });
    const slot = workout.slots[slotIndex];
    if (state.settings.warmupStartsTimer && slot.warmups[warmupIndex].done) {
      startRest(state.settings.rest.warmup, {
        exerciseId: slot.exerciseId, slotIndex, setIndex: null, kind: "warmup",
        nextLabel: describeSet(workout, program, nextSet(workout)),
      });
    }
  },
  changeDay(dayId) {
    commit({ ...state, inProgress: buildWorkout(state, program, dayId, now()), timer: null });
    runner.set(null); timerBar.hide();
  },
  finishWorkout() {
    const result = finishWorkout(state, program, now());
    runner.set(null); timerBar.hide();
    commit(result.state, { rerender: false });
    navigate("summary");
    render();
  },
  discardWorkout() {
    runner.set(null); timerBar.hide();
    commit({ ...state, inProgress: null, timer: null });
  },
  resolveDecision(decisionId, choice) {
    const decision = state.pendingDecisions.find((d) => d.id === decisionId);
    if (!decision) throw new Error("That decision was already resolved.");
    commit(resolveDecision(state, decision, choice, program, now()));
  },
  dismissSummary() {
    if (state.pendingDecisions.length) { showToast("Resolve the reset decision first."); return; }
    navigate("workout");
  },
  timerAdjust(deltaSec) {
    if (state.timer) setTimer(adjustTimer(state.timer, deltaSec, now()));
  },
  timerSkip() {
    setTimer(null);
  },
  setStartingWeight(exerciseId, tier, weight) {
    let next = applyOverride(state, exerciseId, tier, { weight, stageStartWeight: weight }, "starting weight", now());
    next = refreshUntouchedSlots(next, (s) => s.exerciseId === exerciseId && s.tier === tier);
    commit(next);
  },
  updateSettings(patch) {
    const settings = { ...state.settings, ...patch, rest: { ...state.settings.rest, ...(patch.rest || {}) } };
    commit(refreshUntouchedSlots({ ...state, settings }));
  },
  overrideLift(exerciseId, tier, patch, reason) {
    let next = applyOverride(state, exerciseId, tier, patch, reason || null, now());
    next = refreshUntouchedSlots(next, (s) => s.exerciseId === exerciseId && s.tier === tier);
    commit(next);
  },
  setSubstitution(dayId, slotIndex, exerciseIdOrNull) {
    let next = setSubstitution(state, dayId, slotIndex, exerciseIdOrNull);
    next = ensureLifts(next, effectiveProgram(baseProgram, next.program));
    if (next.inProgress?.dayId === dayId) next = refreshUntouchedSlots(next, (s) => s.slotIndex === slotIndex);
    commit(next);
  },
  addCustomExercise({ name, type, startingWeight, increment }) {
    const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "exercise";
    const id = `custom_${slug}_${now().toString(36)}`;
    const sw = startingWeight && typeof startingWeight === "object"
      ? startingWeight
      : { T1: startingWeight ?? null, T2: startingWeight ?? null, T3: startingWeight ?? null };
    const isBarbell = type === "barbell";
    commit(addCustomExercise(state, {
      id, name: String(name).trim() || "Custom exercise", type,
      startingWeight: type === "bodyweight" ? { T1: null, T2: null, T3: null } : sw,
      ...(type === "bodyweight" ? { startingRepTarget: 10 } : {}),
      increment: type === "bodyweight" ? 0 : Number(increment) || 5,
      smallIncrement: null, warmup: isBarbell, plates: isBarbell,
    }));
    return id;
  },
  undoLastWorkout() {
    runner.set(null); timerBar.hide();
    commit(undoLastWorkout(state));
    showToast("Last workout undone.");
  },
  exportData() {
    const { filename, text } = serializeBackup(state, now());
    downloadText(filename, text);
  },
  previewImport(text) {
    const r = parseBackup(text);
    return r.ok ? { ok: true, summary: r.summary } : { ok: false, error: r.error };
  },
  confirmImport(text) {
    const r = parseBackup(text);
    if (!r.ok) { showToast(r.error); return; }
    runner.set(null); timerBar.hide();
    const imported = r.state;
    commit(ensureLifts(imported, effectiveProgram(baseProgram, imported.program)), { rerender: false });
    runner.set(state.timer, { silentIfExpired: true });
    navigate(state.pendingDecisions.length ? "summary" : "workout");
    render();
    showToast("Backup imported.");
  },
  resetAll() {
    runner.set(null); timerBar.hide();
    storage.clear();
    promptedStartingWeights.clear();
    const fresh = defaultState(baseProgram.defaults);
    commit(ensureLifts(fresh, effectiveProgram(baseProgram, fresh.program)), { rerender: false });
    navigate("workout");
    render();
    showToast("All data reset.");
  },
  reloadForUpdate() {
    location.reload();
  },
};

function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- rendering ----------

function currentRoute() {
  let route = parseRoute(location.hash);
  if (state.pendingDecisions.length && route === "workout") route = "summary";
  if (route === "summary" && !state.workouts.length) route = "workout";
  return route;
}

function render() {
  const route = currentRoute();
  if (`#/${route}` !== location.hash) history.replaceState(null, "", `#/${route}`);
  if (route === "workout") ensureInProgress();

  if (typeof cleanup === "function") cleanup();
  const root = document.getElementById("screen");
  const ctx = { state, program, baseProgram, version: VERSION, actions, navigate };
  cleanup = SCREENS[route].render(root, ctx);

  for (const a of document.querySelectorAll("#tabs a")) {
    const active = a.getAttribute("href") === `#/${route}` || (route === "summary" && a.getAttribute("href") === "#/workout");
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }

  if (route === "workout" || route === "summary") wakeLock.enable(); else wakeLock.disable();
  if (route === "workout") promptMissingStartingWeights();
}

// Proactively ask once per session for any working weight that's still unset (e.g. barbell curl).
async function promptMissingStartingWeights() {
  const slot = state.inProgress?.slots.find((s) => {
    const ex = program.exercises[s.exerciseId];
    return s.weight == null && ex && ex.type !== "bodyweight" && !promptedStartingWeights.has(`${s.exerciseId}:${s.tier}`);
  });
  if (!slot) return;
  promptedStartingWeights.add(`${slot.exerciseId}:${slot.tier}`);
  const name = program.exercises[slot.exerciseId].name;
  const weight = await promptNumber({
    title: `Starting weight: ${name}`,
    message: `No ${slot.tier} weight set for ${name} yet. Enter your working weight in lb (you can change it later in Settings).`,
    initial: 45, step: 5, min: 0, max: 1000,
  });
  if (weight != null && weight >= 0) actions.setStartingWeight(slot.exerciseId, slot.tier, weight);
}

function showFatal(message) {
  const root = document.getElementById("screen");
  root.textContent = "";
  const box = document.createElement("div");
  box.className = "fatal";
  const h = document.createElement("h1"); h.textContent = "Something went wrong";
  const p = document.createElement("p"); p.textContent = message;
  box.append(h, p);
  root.append(box);
  return box;
}

// ---------- service worker ----------

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let shown = false;
  const offerUpdate = () => {
    if (shown || !hadController) return;
    shown = true;
    showUpdateBanner(() => actions.reloadForUpdate());
  };
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data && e.data.type === "sw-updated") offerUpdate();
  });
  navigator.serviceWorker.addEventListener("controllerchange", offerUpdate);
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((reg) => {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
  }).catch(() => {});
}

// ---------- boot ----------

async function boot() {
  for (const evt of ["pointerdown", "keydown", "touchstart"]) {
    document.addEventListener(evt, unlockAudio, { passive: true, capture: true });
  }

  try {
    baseProgram = await loadProgram("./program.json", (url) => fetch(url));
  } catch (err) {
    showFatal(`Couldn't load program.json: ${err.message}`);
    return;
  }

  let loaded = null;
  try {
    loaded = storage.load();
  } catch (err) {
    const box = showFatal(`Saved data couldn't be read: ${err.message}`);
    const exportBtn = document.createElement("button");
    exportBtn.className = "btn"; exportBtn.textContent = "Download raw data";
    exportBtn.addEventListener("click", () => downloadText(`gzclp-raw-${new Date().toISOString().slice(0, 10)}.json`, storage.raw() || ""));
    const resetBtn = document.createElement("button");
    resetBtn.className = "btn btn-danger"; resetBtn.textContent = "Start fresh";
    resetBtn.addEventListener("click", async () => {
      if (await confirmDialog("Erase the unreadable data and start fresh?", { okLabel: "Erase", danger: true })) {
        storage.clear(); location.reload();
      }
    });
    box.append(exportBtn, resetBtn);
    return;
  }

  const initial = loaded ?? defaultState(baseProgram.defaults);
  state = ensureLifts(initial, effectiveProgram(baseProgram, initial.program));
  program = effectiveProgram(baseProgram, state.program);
  storage.save(state);

  timerBar = createTimerBar(document.getElementById("timer"), {
    onAdjust: (d) => actions.timerAdjust(d),
    onSkip: () => actions.timerSkip(),
  });
  runner = createTimerRunner({
    onTick: (ms, timer) => timerBar.show(timer, ms),
    onFinish: onTimerFinish,
    doc: document,
  });
  if (state.timer && state.timer.endsAt <= now()) commit({ ...state, timer: null }, { rerender: false });
  runner.set(state.timer, { silentIfExpired: true });

  onRouteChange(() => render());
  render();
  registerServiceWorker();
}

boot();
