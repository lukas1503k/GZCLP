// T1 warm-up generation. Pure.
import { roundToLoadable } from "./plates.js";

export function warmupSets(workingWeight, cfg, scheme) {
  if (workingWeight == null) return [];
  const out = [];
  const seen = new Set();
  for (const { pct, reps } of scheme ?? []) {
    const isBar = pct === 0;
    const weight = isBar ? cfg.barWeight : roundToLoadable(pct * workingWeight, cfg);
    if (!isBar && weight <= cfg.barWeight) continue;
    if (weight >= workingWeight) continue;
    if (seen.has(weight)) continue;
    seen.add(weight);
    out.push({ weight, reps, pct });
  }
  return out;
}
