// Epley 1RM estimation. Pure functions.

export function epley(weight, reps) {
  if (weight == null || reps == null || reps <= 0) return 0;
  return weight * (1 + reps / 30);
}

export function estimate5RM(e1rm) {
  return e1rm / (1 + 5 / 30);
}

export function bestE1RM(sets) {
  let best = null;
  for (const set of sets ?? []) {
    if (set == null || set.weight == null || set.reps == null || set.reps <= 0) continue;
    const e1RM = epley(set.weight, set.reps);
    if (best === null || e1RM > best.e1RM) best = { e1RM, set };
  }
  return best;
}

/** Working sets of one exercise/tier in one workout, as [{ weight, reps }]. */
export function workoutSets(workout, exerciseId, tier) {
  const sets = [];
  for (const slot of workout.slots ?? []) {
    if (slot.exerciseId !== exerciseId || slot.tier !== tier) continue;
    for (const s of slot.sets ?? []) sets.push({ weight: slot.weight, reps: s.reps });
  }
  return sets;
}

export function workoutDate(workout) {
  return workout.finishedAt ?? workout.startedAt;
}

export function e1rmSeries(workouts, exerciseId, tier = "T1") {
  const series = [];
  for (const w of workouts ?? []) {
    const best = bestE1RM(workoutSets(w, exerciseId, tier));
    if (!best) continue;
    series.push({
      workoutId: w.id,
      date: workoutDate(w),
      e1RM: best.e1RM,
      weight: best.set.weight,
      reps: best.set.reps,
    });
  }
  return series.sort((a, b) => a.date - b.date);
}
