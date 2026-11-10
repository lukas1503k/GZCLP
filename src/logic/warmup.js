// Warm-up generation for any tier. Pure.
import { roundToLoadable } from "./plates.js";

// Plate-loaded lifts start with the empty bar and round to loadable weights.
// Other weighted lifts (machines, dumbbells) skip the bar set and round to `step` lb.
export function warmupSets(workingWeight, cfg, scheme, { plates = true, step = 5 } = {}) {
  if (workingWeight == null) return [];
  const out = [];
  const seen = new Set();
  for (const { pct, reps } of scheme ?? []) {
    const isBar = pct === 0;
    if (isBar && !plates) continue;
    const weight = isBar
      ? cfg.barWeight
      : plates
        ? roundToLoadable(pct * workingWeight, cfg)
        : Math.round((pct * workingWeight) / step) * step;
    if (plates && !isBar && weight <= cfg.barWeight) continue;
    if (!plates && weight <= 0) continue;
    if (weight >= workingWeight) continue;
    if (seen.has(weight)) continue;
    seen.add(weight);
    out.push({ weight, reps, pct });
  }
  return out;
}
