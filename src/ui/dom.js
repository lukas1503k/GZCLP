// Tiny DOM helpers. Text is always inserted as text nodes (never innerHTML),
// so user-provided strings such as custom exercise names are safe.

const SVG_NS = "http://www.w3.org/2000/svg";

function applyAttrs(el, attrs, isSvg) {
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === "class" || key === "className") {
      if (isSvg) el.setAttribute("class", value); else el.className = value;
    } else if (key === "dataset") {
      Object.assign(el.dataset, value);
    } else if (key === "style" && typeof value === "object") {
      for (const [p, v] of Object.entries(value)) el.style.setProperty(p, v);
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (!isSvg && (key === "value" || key === "checked" || key === "disabled" || key === "selected" || key === "hidden")) {
      el[key] = value;
      if (key !== "value") el.toggleAttribute(key, !!value);
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === true) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** h("button", { class: "btn", onClick }, "Label", ...) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  applyAttrs(el, attrs, false);
  append(el, children);
  return el;
}

/** Same as h() but for SVG elements. */
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  applyAttrs(el, attrs, true);
  append(el, children);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

/** Replace el's contents with children. */
export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

let uid = 0;
export function uniqueId(prefix = "id") {
  uid += 1;
  return `${prefix}-${uid}`;
}

export function formatDate(ms, opts = { weekday: "short", month: "short", day: "numeric" }) {
  if (ms == null) return "";
  try {
    return new Date(ms).toLocaleDateString(undefined, opts);
  } catch {
    return new Date(ms).toDateString();
  }
}

/** 2.5 -> "2.5", 245 -> "245", 101.234 -> "101.2" */
export function fmtNum(n, digits = 1) {
  if (n == null || Number.isNaN(n)) return "–";
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return String(r);
}

export function fmtLb(n) {
  return n == null ? "–" : `${fmtNum(n, 2)} lb`;
}
