// Rest timer service (CONTRACTS §6).
//
// The timer is timestamp-based: TimerState stores `endsAt` (epoch ms) and every
// tick recomputes `endsAt - now()`. Nothing ever accumulates elapsed time, so the
// display is correct after the phone sleeps or the tab is backgrounded.

/** Build a new TimerState that ends `seconds` from `now`. */
export function startTimer(now, seconds, meta = {}) {
  const sec = Math.max(0, Number(seconds) || 0);
  return {
    endsAt: now + sec * 1000,
    durationSec: sec,
    exerciseId: meta.exerciseId ?? null,
    slotIndex: meta.slotIndex ?? null,
    setIndex: meta.setIndex ?? null,
    kind: meta.kind === "warmup" ? "warmup" : "working",
    nextLabel: meta.nextLabel ?? null,
  };
}

/** Milliseconds left (may be negative once expired). */
export function remainingMs(timer, now) {
  return timer.endsAt - now;
}

/** Shift endsAt by deltaSec (±), never earlier than `now`. Returns a new object. */
export function adjustTimer(timer, deltaSec, now) {
  const endsAt = Math.max(now, timer.endsAt + (Number(deltaSec) || 0) * 1000);
  return { ...timer, endsAt };
}

/** "m:ss", rounding up to whole seconds (a countdown shows 0:00 only when done). */
export function formatRemaining(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Default scheduler: animation frames while visible (smooth progress bar),
// a 250 ms timeout otherwise (rAF does not run in background tabs).
function defaultSchedule(fn) {
  const g = globalThis;
  const hidden = g.document && g.document.visibilityState === "hidden";
  if (typeof g.requestAnimationFrame === "function" && !hidden) {
    return { raf: g.requestAnimationFrame(fn) };
  }
  return { to: setTimeout(fn, 250) };
}

function defaultCancel(handle) {
  if (!handle) return;
  if (handle.raf !== undefined && typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(handle.raf);
  }
  if (handle.to !== undefined) clearTimeout(handle.to);
}

/**
 * Drives onTick/onFinish for the current TimerState.
 * onFinish fires exactly once per endsAt value.
 */
export function createTimerRunner({
  now = () => Date.now(),
  schedule = defaultSchedule,
  cancel = defaultCancel,
  onTick = () => {},
  onFinish = () => {},
  doc,
} = {}) {
  let timer = null;
  let handle = null;
  let firedFor = null; // endsAt value that has already fired (or was silenced)

  function clearScheduled() {
    if (handle !== null) {
      cancel(handle);
      handle = null;
    }
  }

  function tick() {
    handle = null;
    if (!timer) return;
    const current = timer;
    const rem = remainingMs(current, now());
    onTick(rem, current);
    if (timer !== current) return; // onTick replaced/cleared the timer
    if (rem <= 0) {
      if (firedFor !== current.endsAt) {
        firedFor = current.endsAt;
        onFinish(current);
      }
      return; // finished: stop ticking until a new timer is set
    }
    handle = schedule(tick);
  }

  function sync() {
    clearScheduled();
    tick();
  }

  function onVisibility() {
    sync();
  }

  if (doc && typeof doc.addEventListener === "function") {
    doc.addEventListener("visibilitychange", onVisibility);
  }

  return {
    set(next, { silentIfExpired = false } = {}) {
      clearScheduled();
      timer = next || null;
      if (!timer) return;
      if (silentIfExpired && remainingMs(timer, now()) <= 0) {
        firedFor = timer.endsAt;
      }
      tick();
    },
    sync,
    stop() {
      clearScheduled();
      timer = null;
      if (doc && typeof doc.removeEventListener === "function") {
        doc.removeEventListener("visibilitychange", onVisibility);
      }
    },
  };
}
