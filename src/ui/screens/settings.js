// Settings: plates & increments, rest timer, overrides, substitutions, custom exercises, data.

import { h, mount, fmtNum, uniqueId } from "../dom.js";
import { plateConfig, loadStep } from "../../logic/plates.js";
import { listSlots } from "../../logic/program.js";
import { weightLabel } from "../components/plateBadge.js";
import { numberStepper, confirmDialog, showToast } from "../components/dialog.js";

// UI-only memory across re-renders.
let overrideKey = null;
let importPreview = null; // { fileName, text, result }
let rootRef = null;
let ctxRef = null;

const rerender = () => { if (rootRef && ctxRef) render(rootRef, ctxRef); };

function exerciseOf(ctx, id) {
  return ctx.program.exercises?.[id] || ctx.baseProgram?.exercises?.[id] || { id, name: id, type: "barbell", plates: false };
}

function section(title, ...children) {
  const id = uniqueId("sec");
  return h("section", { class: "card settings-section", "aria-labelledby": id },
    h("h2", { class: "section-title", id }, title), ...children);
}

function toggleRow({ label, description, checked, disabled = false, onToggle }) {
  const labelId = uniqueId("tg");
  const descId = description ? uniqueId("tgd") : null;
  return h("div", { class: `setting-row toggle-row${disabled ? " is-disabled" : ""}` },
    h("div", { class: "setting-text" },
      h("span", { class: "setting-label", id: labelId }, label),
      description ? h("span", { class: "setting-desc", id: descId }, description) : null),
    h("button", {
      type: "button", role: "switch", class: "switch", "aria-checked": checked ? "true" : "false",
      "aria-labelledby": labelId, "aria-describedby": descId, disabled,
      onClick: () => onToggle(!checked),
    }, h("span", { class: "switch-knob", "aria-hidden": "true" })),
  );
}

function numberRow({ label, description, value, unit, step = 1, min = 0, max = 9999, onCommit }) {
  const id = uniqueId("num");
  const input = h("input", {
    id, class: "num-input", type: "number", inputmode: step % 1 ? "decimal" : "numeric", step: String(step),
    min: String(min), max: String(max), value: value == null ? "" : String(value), enterkeyhint: "done",
  });
  input.addEventListener("change", () => {
    const n = Number(input.value);
    if (input.value.trim() === "" || !Number.isFinite(n) || n < min || n > max) {
      showToast(`${label}: enter a number from ${min} to ${max}.`);
      input.value = value == null ? "" : String(value);
      return;
    }
    if (n !== value) onCommit(n);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
  return h("div", { class: "setting-row" },
    h("label", { class: "setting-text", for: id },
      h("span", { class: "setting-label" }, label),
      description ? h("span", { class: "setting-desc" }, description) : null),
    h("span", { class: "num-wrap" }, input, unit ? h("span", { class: "num-unit" }, unit) : null));
}

function selectField({ label, value, options, onChange, id = uniqueId("sel") }) {
  const select = h("select", { id, class: "select" },
    options.map((o) => h("option", { value: o.value, selected: o.value === value }, o.label)));
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  return h("div", { class: "field" }, h("label", { class: "field-label", for: id }, label), select);
}

function usedLiftKeys(ctx) {
  const keys = [];
  const seen = new Set();
  const add = (id, tier) => {
    const k = `${id}:${tier}`;
    if (!seen.has(k)) { seen.add(k); keys.push({ key: k, exerciseId: id, tier }); }
  };
  for (const dayId of ctx.program.rotation || Object.keys(ctx.program.days || {})) {
    for (const sl of ctx.program.days?.[dayId]?.slots || []) add(sl.exerciseId, sl.tier);
  }
  for (const [id, tiers] of Object.entries(ctx.state.lifts || {})) for (const tier of Object.keys(tiers || {})) add(id, tier);
  const order = { T1: 0, T2: 1, T3: 2 };
  return keys.sort((a, b) => order[a.tier] - order[b.tier]);
}

// ---------- sections ----------

function platesSection(ctx) {
  const st = ctx.state.settings;
  const smallIncLifts = Object.values(ctx.program.exercises || {}).filter((e) => e.smallIncrement && !e.library).map((e) => e.name);
  const cfg = plateConfig(ctx.program, st);
  return section("Plates & increments",
    toggleRow({
      label: "1.25 lb plates", description: `Plates per side: ${cfg.plates.map((p) => fmtNum(p, 2)).join(", ")}`,
      checked: !!st.smallPlates, onToggle: (v) => ctx.actions.updateSettings({ smallPlates: v }),
    }),
    toggleRow({
      label: `Small increments${smallIncLifts.length ? ` for ${smallIncLifts.join(" / ")}` : ""}`,
      description: "Add +2.5 lb instead of +5. Only applies when 1.25 lb plates are enabled.",
      checked: !!st.smallIncrements, disabled: !st.smallPlates,
      onToggle: (v) => ctx.actions.updateSettings({ smallIncrements: v }),
    }),
    numberRow({
      label: "Bar weight", value: st.barWeight, unit: "lb", step: 5, min: 0, max: 100,
      onCommit: (n) => ctx.actions.updateSettings({ barWeight: n }),
    }),
  );
}

function timerSection(ctx) {
  const st = ctx.state.settings;
  const rest = st.rest || {};
  const restRow = (key, label) => numberRow({
    label, value: rest[key], unit: "sec", step: 15, min: 0, max: 900,
    onCommit: (n) => ctx.actions.updateSettings({ rest: { [key]: n } }),
  });
  return section("Rest timer",
    restRow("T1", "T1 rest"), restRow("T2", "T2 rest"), restRow("T3", "T3 rest"), restRow("warmup", "Warm-up rest"),
    toggleRow({
      label: "Warm-ups start the timer", description: "Ticking a warm-up starts the warm-up rest.",
      checked: !!st.warmupStartsTimer, onToggle: (v) => ctx.actions.updateSettings({ warmupStartsTimer: v }),
    }),
    toggleRow({ label: "Sound", description: "Beep when rest is over.", checked: !!st.sound, onToggle: (v) => ctx.actions.updateSettings({ sound: v }) }),
    toggleRow({ label: "Vibration", description: "Not supported on iPhone.", checked: !!st.vibration, onToggle: (v) => ctx.actions.updateSettings({ vibration: v }) }),
  );
}

function overrideSection(ctx) {
  const cfg = plateConfig(ctx.program, ctx.state.settings);
  const keys = usedLiftKeys(ctx);
  if (!keys.length) return section("Adjust a lift", h("p", { class: "muted" }, "No lifts yet."));
  if (!overrideKey || !keys.some((k) => k.key === overrideKey)) overrideKey = keys[0].key;
  const { exerciseId, tier } = keys.find((k) => k.key === overrideKey);
  const ex = exerciseOf(ctx, exerciseId);
  const lift = ctx.state.lifts?.[exerciseId]?.[tier] || { weight: null, stage: 1, stageStartWeight: null, repTarget: null };
  const bodyweight = ex.type === "bodyweight";
  const staged = !bodyweight && (tier === "T1" || tier === "T2");
  const step = ex.plates ? loadStep(cfg) : 5;

  const preview = h("div", { class: "decision-result" });
  const updatePreview = (v) => mount(preview, v == null ? h("span", { class: "muted" }, "No weight set") : weightLabel(v, ex, cfg));
  const weight = bodyweight ? null : numberStepper({ value: lift.weight, step, min: 0, max: 2000, label: "Weight (lb)", onInput: updatePreview });
  if (weight) updatePreview(weight.get());
  const ssw = staged ? numberStepper({ value: lift.stageStartWeight, step, min: 0, max: 2000, label: "Stage-1 start weight (lb)" }) : null;
  const rep = bodyweight ? numberStepper({ value: lift.repTarget, step: 1, min: 1, max: 100, integer: true, label: "Rep target" }) : null;
  const stages = ctx.program.tiers?.[tier]?.stages || [];
  let stageValue = String(lift.stage || 1);
  const stageSelect = staged ? selectField({
    label: "Stage", value: stageValue,
    options: stages.map((st, i) => ({ value: String(i + 1), label: `Stage ${i + 1} · ${st.sets}×${st.reps}${st.amrap ? "+" : ""}` })),
    onChange: (v) => { stageValue = v; },
  }) : null;
  const reasonId = uniqueId("reason");
  const reason = h("input", { id: reasonId, class: "text-input", type: "text", maxlength: "120", placeholder: "e.g. deload after illness", autocomplete: "off" });

  const apply = () => {
    const patch = {};
    if (weight) { const v = weight.get(); if (v !== lift.weight) patch.weight = v; }
    if (staged) {
      const sv = Number(stageValue); if (sv !== lift.stage) patch.stage = sv;
      const v = ssw.get(); if (v !== lift.stageStartWeight) patch.stageStartWeight = v;
    }
    if (rep) { const v = rep.get(); if (v != null && v !== lift.repTarget) patch.repTarget = v; }
    if (!Object.keys(patch).length) { showToast("Nothing changed."); return; }
    try {
      ctx.actions.overrideLift(exerciseId, tier, patch, reason.value.trim() || null);
      showToast(`${ex.name} ${tier} updated.`);
    } catch (err) {
      showToast(err?.message || "Couldn't apply override.");
    }
  };

  return section("Adjust a lift",
    h("p", { class: "setting-desc" }, "Manual changes take effect next workout and are logged in the lift's history."),
    selectField({
      label: "Lift", value: overrideKey,
      options: keys.map((k) => ({ value: k.key, label: `${exerciseOf(ctx, k.exerciseId).name} · ${k.tier}` })),
      onChange: (v) => { overrideKey = v; rerender(); },
    }),
    weight ? h("div", { class: "field" }, h("span", { class: "field-label" }, "Working weight"),
      h("div", { class: "stepper-row" }, weight.el, h("span", { class: "stepper-unit" }, "lb")), preview) : null,
    stageSelect,
    ssw ? h("div", { class: "field" }, h("span", { class: "field-label" }, "Stage-1 start weight (used by T2 reset)"),
      h("div", { class: "stepper-row" }, ssw.el, h("span", { class: "stepper-unit" }, "lb"))) : null,
    rep ? h("div", { class: "field" }, h("span", { class: "field-label" }, "Rep target"),
      h("div", { class: "stepper-row" }, rep.el, h("span", { class: "stepper-unit" }, "reps"))) : null,
    h("div", { class: "field" }, h("label", { class: "field-label", for: reasonId }, "Reason (optional)"), reason),
    h("button", { type: "button", class: "btn btn-primary btn-block", onClick: apply }, "Apply change"),
  );
}

function substitutionSection(ctx) {
  const slots = listSlots(ctx.baseProgram);
  const subs = ctx.state.program?.substitutions || {};
  const all = Object.values(ctx.program.exercises || {});
  const byDay = new Map();
  for (const sl of slots) {
    if (!byDay.has(sl.dayId)) byDay.set(sl.dayId, []);
    byDay.get(sl.dayId).push(sl);
  }
  return section("Exercise substitution",
    h("p", { class: "setting-desc" }, "Swap any slot's exercise. The substitute keeps its own weights; the original's history is untouched."),
    [...byDay.entries()].map(([dayId, list]) => h("div", { class: "sub-day" },
      h("h3", { class: "sub-day-title" }, ctx.baseProgram.days?.[dayId]?.name || dayId),
      list.map((sl) => {
        const key = `${sl.dayId}:${sl.slotIndex}`;
        const original = sl.originalExerciseId || sl.exerciseId;
        const candidates = all.filter((e) => e.id !== original && ((sl.tier === "T1" || sl.tier === "T2") ? e.type !== "bodyweight" : true));
        return selectField({
          label: `${sl.label || sl.tier} · ${exerciseOf(ctx, original).name}`,
          value: subs[key] || "",
          options: [{ value: "", label: `${exerciseOf(ctx, original).name} (default)` },
            ...candidates.map((e) => ({ value: e.id, label: e.name }))],
          onChange: (v) => ctx.actions.setSubstitution(sl.dayId, sl.slotIndex, v || null),
        });
      }))),
  );
}

function customExerciseSection(ctx) {
  const nameId = uniqueId("cx");
  const name = h("input", { id: nameId, class: "text-input", type: "text", maxlength: "40", required: true, placeholder: "e.g. Pendlay row", autocomplete: "off" });
  let type = "barbell";
  const weight = numberStepper({ value: null, step: 5, min: 0, max: 2000, label: "Starting weight (lb)" });
  const inc = numberStepper({ value: 5, step: 2.5, min: 0, max: 50, label: "Increment (lb)" });
  const weightFields = h("div", { class: "weight-fields" },
    h("div", { class: "field" }, h("span", { class: "field-label" }, "Starting weight (optional — asked on first use)"),
      h("div", { class: "stepper-row" }, weight.el, h("span", { class: "stepper-unit" }, "lb"))),
    h("div", { class: "field" }, h("span", { class: "field-label" }, "Increment on success"),
      h("div", { class: "stepper-row" }, inc.el, h("span", { class: "stepper-unit" }, "lb"))));
  const typeField = selectField({
    label: "Type", value: type,
    options: [{ value: "barbell", label: "Barbell (plates shown)" }, { value: "machine", label: "Machine / dumbbell" }, { value: "bodyweight", label: "Bodyweight (rep target)" }],
    onChange: (v) => { type = v; weightFields.hidden = v === "bodyweight"; },
  });
  const error = h("p", { class: "field-error", role: "alert" });
  const form = h("form", {
    class: "sheet-form", novalidate: true,
    onSubmit: (e) => {
      e.preventDefault();
      const n = name.value.trim();
      if (!n) { error.textContent = "Give the exercise a name."; name.focus(); return; }
      try {
        ctx.actions.addCustomExercise({
          name: n, type,
          startingWeight: type === "bodyweight" ? null : weight.get(),
          increment: type === "bodyweight" ? 0 : (inc.get() ?? 5),
        });
        showToast(`Added ${n}. Pick it under Exercise substitution.`);
      } catch (err) {
        error.textContent = err?.message || "Couldn't add exercise.";
      }
    },
  },
    h("div", { class: "field" }, h("label", { class: "field-label", for: nameId }, "Name"), name),
    typeField, weightFields, error,
    h("button", { type: "submit", class: "btn btn-secondary btn-block" }, "Add exercise"));
  return section("Add custom exercise", form);
}

function importPreviewPanel(ctx) {
  if (!importPreview) return null;
  const { fileName, text, result } = importPreview;
  const cancel = h("button", { type: "button", class: "btn btn-secondary", onClick: () => { importPreview = null; rerender(); } }, "Cancel");
  if (!result.ok) {
    return h("div", { class: "import-preview is-error", role: "alert" },
      h("p", {}, h("strong", {}, `Can't import ${fileName}: `), result.error),
      h("div", { class: "sheet-actions" }, cancel));
  }
  const sum = result.summary || {};
  const lifts = (sum.lifts || []).filter((l) => l.weight != null || l.repTarget != null);
  return h("div", { class: "import-preview" },
    h("p", {}, h("strong", {}, fileName)),
    h("p", { class: "muted" }, `Schema v${sum.schemaVersion ?? "?"} · ${sum.workouts ?? 0} workout${sum.workouts === 1 ? "" : "s"}`),
    lifts.length ? h("table", { class: "data-table" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Lift"), h("th", { scope: "col" }, "Tier"), h("th", { scope: "col", class: "num" }, "Current"))),
      h("tbody", {}, lifts.map((l) => h("tr", {},
        h("td", {}, exerciseOf(ctx, l.exerciseId).name),
        h("td", {}, l.tier),
        h("td", { class: "num" }, l.weight != null ? `${fmtNum(l.weight, 2)} lb${l.stage && l.tier !== "T3" ? ` · S${l.stage}` : ""}` : `${l.repTarget} reps`))))) : null,
    h("p", { class: "setting-desc" }, "Importing replaces everything on this device."),
    h("div", { class: "sheet-actions" }, cancel,
      h("button", {
        type: "button", class: "btn btn-danger",
        onClick: async () => {
          const ok = await confirmDialog("Replace all current data with this backup?", { okLabel: "Replace data", danger: true });
          if (!ok) return;
          importPreview = null;
          ctx.actions.confirmImport(text);
        },
      }, "Replace data")));
}

function dataSection(ctx) {
  const fileId = uniqueId("file");
  const file = h("input", { id: fileId, class: "visually-hidden", type: "file", accept: ".json,application/json" });
  file.addEventListener("change", async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    let text = "";
    try { text = await f.text(); } catch { text = ""; }
    let result;
    try { result = ctx.actions.previewImport(text); } catch (err) { result = { ok: false, error: err?.message || "Unreadable file." }; }
    importPreview = { fileName: f.name, text, result };
    file.value = "";
    rerender();
  });
  return section("Data",
    h("p", { class: "setting-desc" }, "Everything is stored on this device only. Export a backup now and then."),
    h("div", { class: "button-stack" },
      h("button", { type: "button", class: "btn btn-secondary btn-block", onClick: () => ctx.actions.exportData() }, "Export backup"),
      h("label", { class: "btn btn-secondary btn-block file-label", for: fileId }, "Import backup…"),
      file),
    importPreviewPanel(ctx),
    h("div", { class: "danger-zone" },
      h("button", {
        type: "button", class: "btn btn-danger btn-block",
        onClick: async () => {
          const ok = await confirmDialog("Erase all workouts, lift progress and settings? This can't be undone — export a backup first if you might want it.", {
            okLabel: "Erase everything", danger: true,
          });
          if (ok) ctx.actions.resetAll();
        },
      }, "Reset all data")),
  );
}

function aboutSection(ctx) {
  return section("About",
    h("p", {}, "GZCLP Tracker ", h("span", { class: "version" }, `v${ctx.version}`)),
    h("p", { class: "setting-desc" }, "Works offline. Install it from your browser's share menu (Add to Home Screen)."));
}

export function render(root, ctx) {
  rootRef = root;
  ctxRef = ctx;
  const scrollY = window.scrollY;
  mount(root, h("div", { class: "screen screen-settings" },
    h("header", { class: "screen-header" }, h("div", { class: "title-block" }, h("h1", {}, "Settings"))),
    platesSection(ctx),
    timerSection(ctx),
    overrideSection(ctx),
    substitutionSection(ctx),
    customExerciseSection(ctx),
    dataSection(ctx),
    aboutSection(ctx),
  ));
  if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
  return () => { rootRef = null; ctxRef = null; };
}
