// Quick numeric rep entry: big −/+ stepper plus direct numeric input.

import { h } from "../dom.js";
import { openModal, numberStepper } from "./dialog.js";

/**
 * @returns {Promise<number | "clear" | null>} null = cancelled
 */
export function openRepEntry({ title = "Reps", initial = 0, min = 0, max = 100, allowClear = false, hint = "" } = {}) {
  let stepper;
  return openModal({
    title,
    className: "sheet-reps",
    cancelValue: null,
    build: (close) => {
      const error = h("p", { class: "field-error", role: "alert" });
      stepper = numberStepper({
        value: initial, step: 1, min, max, integer: true, label: "Reps",
        onInput: () => { error.textContent = ""; },
      });
      const submit = (e) => {
        e?.preventDefault();
        const v = stepper.get();
        if (v == null || !Number.isInteger(v) || v < min || v > max) {
          error.textContent = `Enter whole reps from ${min} to ${max}.`;
          stepper.input.focus();
          return;
        }
        close(v);
      };
      return h("form", { class: "sheet-form", novalidate: true, onSubmit: submit },
        hint ? h("p", { class: "sheet-message" }, hint) : null,
        h("div", { class: "stepper-row stepper-row-big" }, stepper.el, h("span", { class: "stepper-unit" }, "reps")),
        error,
        h("div", { class: "sheet-actions" },
          allowClear
            ? h("button", { type: "button", class: "btn btn-danger-ghost", onClick: () => close("clear") }, "Un-complete")
            : h("button", { type: "button", class: "btn btn-secondary", onClick: () => close(null) }, "Cancel"),
          h("button", { type: "submit", class: "btn btn-primary" }, "Log reps"),
        ),
        allowClear ? h("button", { type: "button", class: "btn btn-ghost btn-block", onClick: () => close(null) }, "Cancel") : null,
      );
    },
    initialFocus: () => stepper.input,
  });
}
