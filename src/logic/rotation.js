// Day rotation. Pure.

export function nextDayId(program, rotationIndex) {
  const n = program.rotation.length;
  return program.rotation[(((rotationIndex ?? 0) % n) + n) % n];
}

export function advance(program, rotationIndex) {
  return ((rotationIndex ?? 0) + 1) % program.rotation.length;
}
