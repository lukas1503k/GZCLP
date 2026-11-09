// Modal dialogs (bottom-sheet style, thumb reachable), toasts and the update banner.
// Everything renders into #modal-root / #banner-root.

import { h, uniqueId } from "../dom.js";

const stack = [];

function modalRoot() {
  let root = document.getElementById("modal-root");
  if (!root) {
    root = h("div", { id: "modal-root" });
    document.body.append(root);
  }
  return root;
}

function focusables(el) {
  return [...el.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )].filter((n) => n.offsetParent !== null || n === document.activeElement);
}

/**
 * Open a modal sheet. build(close) returns the sheet body nodes; close(value) resolves the promise.
 * Escape / backdrop tap resolves with `cancelValue`.
 * @returns {Promise<any>}
 */
export function openModal({ title, labelledBy, build, cancelValue = null, initialFocus, className = "" }) {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    const titleId = labelledBy || uniqueId("dlg-title");
    let done = false;

    const close = (value) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (!stack.length) document.documentElement.classList.remove("modal-open");
      if (previouslyFocused && typeof previouslyFocused.focus === "function" && previouslyFocused.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
      resolve(value);
    };

    const sheet = h("div", {
      class: `sheet ${className}`.trim(), role: "dialog", "aria-modal": "true", "aria-labelledby": titleId,
    });
    if (title != null) sheet.append(h("h2", { class: "sheet-title", id: titleId }, title));
    const body = build(close);
    for (const node of [body].flat()) if (node) sheet.append(node);

    const overlay = h("div", { class: "overlay" }, sheet);
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) overlay.dataset.downOnBackdrop = "1";
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay && overlay.dataset.downOnBackdrop) close(cancelValue);
      delete overlay.dataset.downOnBackdrop;
    });

    function onKey(e) {
      if (stack[stack.length - 1] !== entry) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(cancelValue);
      } else if (e.key === "Tab") {
        const items = focusables(sheet);
        if (!items.length) { e.preventDefault(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!sheet.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    }

    const entry = { close, cancelValue };
    stack.push(entry);
    document.addEventListener("keydown", onKey, true);
    document.documentElement.classList.add("modal-open");
    modalRoot().append(overlay);

    const target = (typeof initialFocus === "function" ? initialFocus() : initialFocus) || focusables(sheet)[0];
    if (target) requestAnimationFrame(() => target.focus({ preventScroll: true }));
  });
}

/** Close every open modal (resolving each with its cancel value). */
export function closeAllModals() {
  for (const entry of [...stack].reverse()) entry.close(entry.cancelValue);
}

export function confirmDialog(message, { okLabel = "OK", cancelLabel = "Cancel", danger = false, title = null } = {}) {
  let okBtn;
  return openModal({
    title: title ?? (danger ? "Are you sure?" : "Confirm"),
    cancelValue: false,
    build: (close) => [
      h("p", { class: "sheet-message" }, message),
      h("div", { class: "sheet-actions" },
        h("button", { type: "button", class: "btn btn-secondary", onClick: () => close(false) }, cancelLabel),
        (okBtn = h("button", {
          type: "button", class: `btn ${danger ? "btn-danger" : "btn-primary"}`, onClick: () => close(true),
        }, okLabel)),
      ),
    ],
    initialFocus: () => (danger ? null : okBtn),
  });
}

function clampNum(v, min, max) {
  if (min != null && v < min) v = min;
  if (max != null && v > max) v = max;
  return v;
}

/** Number field with large −/+ buttons. Returns { el, input, get(), set(v) }. */
export function numberStepper({ value, step = 1, min = 0, max = 9999, label = "Value", onInput, integer = false }) {
  const input = h("input", {
    class: "stepper-input", type: "number", inputmode: integer ? "numeric" : "decimal",
    pattern: integer ? "[0-9]*" : null, step: String(step), min: min != null ? String(min) : null,
    max: max != null ? String(max) : null, value: value == null ? "" : String(value), "aria-label": label,
    enterkeyhint: "done",
  });
  const get = () => {
    const raw = input.value.trim();
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const set = (v) => {
    input.value = v == null ? "" : String(Math.round(v * 1000) / 1000);
    onInput?.(get());
  };
  const bump = (dir) => {
    const cur = get() ?? (dir > 0 ? (min ?? 0) - step : (min ?? 0));
    set(clampNum(Math.round((cur + dir * step) * 1000) / 1000, min, max));
  };
  input.addEventListener("input", () => onInput?.(get()));
  input.addEventListener("focus", () => input.select());
  const el = h("div", { class: "stepper" },
    h("button", { type: "button", class: "stepper-btn", "aria-label": `Decrease by ${step}`, onClick: () => bump(-1) }, "−"),
    input,
    h("button", { type: "button", class: "stepper-btn", "aria-label": `Increase by ${step}`, onClick: () => bump(1) }, "+"),
  );
  return { el, input, get, set };
}

export function promptNumber({ title = "Enter a number", message = "", initial = null, step = 1, min = 0, max = 9999, okLabel = "Save", unit = "lb" } = {}) {
  let stepper;
  return openModal({
    title,
    cancelValue: null,
    build: (close) => {
      const error = h("p", { class: "field-error", role: "alert" });
      const submit = (e) => {
        e?.preventDefault();
        const v = stepper.get();
        if (v == null || (min != null && v < min) || (max != null && v > max)) {
          error.textContent = `Enter a number between ${min} and ${max}.`;
          stepper.input.focus();
          return;
        }
        close(v);
      };
      stepper = numberStepper({ value: initial, step, min, max, label: title, onInput: () => { error.textContent = ""; } });
      const form = h("form", { class: "sheet-form", novalidate: true, onSubmit: submit },
        message ? h("p", { class: "sheet-message" }, message) : null,
        h("div", { class: "stepper-row" }, stepper.el, unit ? h("span", { class: "stepper-unit" }, unit) : null),
        error,
        h("div", { class: "sheet-actions" },
          h("button", { type: "button", class: "btn btn-secondary", onClick: () => close(null) }, "Cancel"),
          h("button", { type: "submit", class: "btn btn-primary" }, okLabel),
        ),
      );
      return form;
    },
    initialFocus: () => stepper.input,
  });
}

/** Choose one of several options; resolves with the option value or null. */
export function chooseOption({ title, message = "", options, current = null }) {
  return openModal({
    title,
    cancelValue: null,
    build: (close) => [
      message ? h("p", { class: "sheet-message" }, message) : null,
      h("div", { class: "choice-grid" },
        options.map((o) => h("button", {
          type: "button",
          class: `btn btn-choice${o.value === current ? " is-current" : ""}`,
          "aria-pressed": o.value === current ? "true" : "false",
          onClick: () => close(o.value),
        }, h("span", { class: "choice-label" }, o.label), o.detail ? h("span", { class: "choice-detail" }, o.detail) : null)),
      ),
      h("div", { class: "sheet-actions" },
        h("button", { type: "button", class: "btn btn-secondary", onClick: () => close(null) }, "Cancel")),
    ],
  });
}

function bannerRoot() {
  let root = document.getElementById("banner-root");
  if (!root) {
    root = h("div", { id: "banner-root" });
    document.body.append(root);
  }
  return root;
}

export function showToast(message, { timeoutMs = 3200 } = {}) {
  const root = bannerRoot();
  const toast = h("div", { class: "toast", role: "status", "aria-live": "polite" }, String(message));
  root.append(toast);
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 300);
  }, timeoutMs);
}

export function showUpdateBanner(onReload) {
  const root = bannerRoot();
  if (root.querySelector(".update-banner")) return;
  const dismiss = () => { banner.remove(); document.documentElement.classList.remove("has-banner"); };
  const banner = h("div", { class: "update-banner", role: "alert" },
    h("span", { class: "update-text" }, "Update available"),
    h("button", { type: "button", class: "btn btn-primary btn-small", onClick: () => onReload?.() }, "Reload"),
    h("button", { type: "button", class: "btn btn-ghost btn-small", "aria-label": "Dismiss", onClick: dismiss }, "✕"),
  );
  root.prepend(banner);
  document.documentElement.classList.add("has-banner");
}
