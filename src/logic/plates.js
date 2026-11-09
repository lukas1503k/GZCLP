// Plate math. Pure functions; all weights in lb.

const SCALE = 10000; // work in 1/10000 lb to avoid floating-point drift
const toUnits = (w) => Math.round(w * SCALE);
const fromUnits = (u) => u / SCALE;

export function plateConfig(program, settings = {}) {
  const defaults = program.defaults;
  const barWeight = settings?.barWeight ?? defaults.barWeight;
  const base = [...defaults.plates];
  if (settings?.smallPlates) base.push(...(defaults.smallPlates ?? []));
  const plates = [...new Set(base)].filter((p) => p > 0).sort((a, b) => b - a);
  return { barWeight, plates };
}

export function loadStep(cfg) {
  return 2 * Math.min(...cfg.plates);
}

export function roundToLoadable(weight, cfg) {
  if (weight == null || Number.isNaN(weight)) return null;
  const bar = toUnits(cfg.barWeight);
  const step = toUnits(loadStep(cfg));
  const w = toUnits(weight);
  if (w <= bar) return cfg.barWeight;
  const k = Math.floor((w - bar) / step);
  const below = bar + k * step;
  const above = below + step;
  // exact ties round DOWN
  return fromUnits(above - w < w - below ? above : below);
}

function greedy(perSideUnits, cfg) {
  const out = [];
  let rest = perSideUnits;
  for (const p of cfg.plates) {
    const pu = toUnits(p);
    while (rest >= pu) {
      out.push(p);
      rest -= pu;
    }
  }
  return { plates: out, rest };
}

export function isLoadable(weight, cfg) {
  if (weight == null || Number.isNaN(weight)) return false;
  const diff = toUnits(weight) - toUnits(cfg.barWeight);
  if (diff < 0 || diff % 2 !== 0) return false;
  return greedy(diff / 2, cfg).rest === 0;
}

export function platesPerSide(weight, cfg) {
  const loaded = roundToLoadable(weight, cfg);
  if (loaded == null) return [];
  const perSide = (toUnits(loaded) - toUnits(cfg.barWeight)) / 2;
  return greedy(perSide, cfg).plates;
}

export function formatPlates(plates) {
  if (!plates || plates.length === 0) return "bar";
  return plates.map((p) => String(p)).join(" + ");
}

export function plateBreakdown(weight, cfg) {
  const loaded = roundToLoadable(weight, cfg);
  const plates = platesPerSide(weight, cfg);
  const exact = weight != null && loaded === weight && isLoadable(weight, cfg);
  return { requested: weight, loaded, exact, plates, text: formatPlates(plates) };
}
