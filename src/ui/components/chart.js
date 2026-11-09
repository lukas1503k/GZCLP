// Hand-rolled inline SVG e1RM chart with tappable points and a table fallback.

import { h, s, mount, formatDate, fmtNum } from "../dom.js";

const W = 340;
const H = 190;
const PAD = { top: 16, right: 18, bottom: 30, left: 44 };

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 10; max += 10; }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => span / st <= count) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { lo, hi, ticks };
}

function pointText(p) {
  return `${formatDate(p.date)} · ${fmtNum(p.weight, 2)} lb × ${p.reps} → e1RM ${fmtNum(p.e1RM)} lb`;
}

export function renderE1rmChart(el, series, { onPointTap, title = "e1RM" } = {}) {
  const points = (series || []).filter((p) => p && Number.isFinite(p.e1RM) && p.e1RM > 0);
  if (!points.length) {
    mount(el, h("p", { class: "chart-empty" }, "No T1 sets logged yet — the chart fills in as you train."));
    return;
  }

  const readout = h("p", { class: "chart-readout", "aria-live": "polite" }, "Tap a point to see the set it came from.");
  const values = points.map((p) => p.e1RM);
  const { lo, hi, ticks } = niceTicks(Math.min(...values), Math.max(...values));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v) => PAD.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;

  const svg = s("svg", {
    class: "chart-svg", viewBox: `0 0 ${W} ${H}`, role: "group",
    "aria-label": `${title} over time, ${points.length} workouts`, preserveAspectRatio: "xMidYMid meet",
  });

  for (const t of ticks) {
    svg.append(
      s("line", { class: "chart-grid", x1: PAD.left, x2: W - PAD.right, y1: y(t), y2: y(t) }),
      s("text", { class: "chart-axis", x: PAD.left - 6, y: y(t) + 4, "text-anchor": "end" }, fmtNum(t, 0)),
    );
  }
  const first = points[0];
  const last = points[points.length - 1];
  svg.append(s("text", { class: "chart-axis", x: x(0), y: H - 8, "text-anchor": points.length === 1 ? "middle" : "start" }, formatDate(first.date, { month: "short", day: "numeric" })));
  if (points.length > 1) {
    svg.append(s("text", { class: "chart-axis", x: x(points.length - 1), y: H - 8, "text-anchor": "end" }, formatDate(last.date, { month: "short", day: "numeric" })));
  }

  if (points.length > 1) {
    const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.e1RM).toFixed(1)}`).join(" ");
    svg.append(s("path", { class: "chart-line", d }));
  }

  const dots = [];
  const select = (i) => {
    dots.forEach((dot, j) => dot.classList.toggle("is-selected", i === j));
    readout.textContent = pointText(points[i]);
    onPointTap?.(points[i]);
  };
  points.forEach((p, i) => {
    const dot = s("circle", { class: "chart-dot", cx: x(i), cy: y(p.e1RM), r: 5 });
    const hit = s("circle", {
      class: "chart-hit", cx: x(i), cy: y(p.e1RM), r: 18, tabindex: "0", role: "button",
      "aria-label": pointText(p),
    });
    hit.addEventListener("click", () => select(i));
    hit.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(i); }
    });
    dots.push(dot);
    svg.append(dot);
    svg.append(hit);
  });

  const table = h("table", { class: "data-table" },
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Date"), h("th", { scope: "col" }, "Best set"), h("th", { scope: "col", class: "num" }, "e1RM"))),
    h("tbody", {}, [...points].reverse().map((p) => h("tr", {},
      h("td", {}, formatDate(p.date, { month: "short", day: "numeric" })),
      h("td", {}, `${fmtNum(p.weight, 2)} × ${p.reps}`),
      h("td", { class: "num" }, fmtNum(p.e1RM))))),
  );

  mount(el,
    h("div", { class: "chart" }, svg),
    readout,
    h("details", { class: "chart-table" }, h("summary", {}, "Show as table"), table),
  );
}
