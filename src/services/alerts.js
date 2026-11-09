// Timer-finished alerts (CONTRACTS §6): synthesized Web Audio beeps + vibration.
// No audio files. Nothing touches `window` at import time, so this module imports
// cleanly in Node.
//
// iOS/Safari only lets audio play after a user gesture: call unlockAudio() from
// gesture handlers (it is cheap and safe to call every time).

const BEEP_GAP_SEC = 0.12;
const PEAK_GAIN = 0.35;

/**
 * Factory with injectable environment (used by tests). The default exports below
 * use one shared instance that reads globals lazily at call time.
 *   env.AudioContext: constructor (default: globalThis.AudioContext || webkitAudioContext)
 *   env.nav: navigator-like object (default: globalThis.navigator)
 */
export function createAlerts(env = {}) {
  let ctx = null;
  let primed = false;

  const getCtor = () =>
    env.AudioContext ?? (globalThis.AudioContext || globalThis.webkitAudioContext || null);
  const getNav = () => (env.nav !== undefined ? env.nav : globalThis.navigator);

  function context() {
    if (ctx) return ctx;
    const Ctor = getCtor();
    if (typeof Ctor !== "function") return null;
    try { ctx = new Ctor(); } catch { ctx = null; }
    return ctx;
  }

  function resume(c) {
    if (c && c.state === "suspended" && typeof c.resume === "function") {
      try {
        const p = c.resume();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch { /* ignore */ }
    }
  }

  function unlockAudio() {
    const c = context();
    if (!c) return false;
    resume(c);
    if (!primed) {
      // iOS needs something actually played inside the gesture: a 1-sample silent buffer.
      try {
        const buf = c.createBuffer(1, 1, 22050);
        const src = c.createBufferSource();
        src.buffer = buf;
        src.connect(c.destination);
        src.start(0);
        primed = true;
      } catch { /* ignore */ }
    }
    return true;
  }

  function beep({ durationMs = 200, frequency = 880, repeats = 3 } = {}) {
    const c = context();
    if (!c) return false;
    resume(c);
    try {
      const dur = Math.max(0.03, durationMs / 1000);
      const t0 = (c.currentTime || 0) + 0.02;
      for (let i = 0; i < Math.max(1, repeats | 0); i++) {
        const t = t0 + i * (dur + BEEP_GAP_SEC);
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(frequency, t);
        // Short attack/release envelope avoids clicks.
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(PEAK_GAIN, t + 0.01);
        gain.gain.setValueAtTime(PEAK_GAIN, t + Math.max(0.011, dur - 0.04));
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(t);
        osc.stop(t + dur + 0.02);
      }
      return true;
    } catch {
      return false;
    }
  }

  function vibrate(pattern = [200, 100, 200]) {
    const nav = getNav();
    if (!nav || typeof nav.vibrate !== "function") return false;
    try { return !!nav.vibrate(pattern); } catch { return false; }
  }

  function alertTimerDone(settings) {
    const s = settings ?? { sound: true, vibration: true };
    if (s.sound) beep();
    if (s.vibration) vibrate();
  }

  return { unlockAudio, beep, vibrate, alertTimerDone, _context: () => ctx };
}

let shared = null;
const inst = () => (shared ??= createAlerts());

export function unlockAudio() { return inst().unlockAudio(); }
export function beep(opts) { return inst().beep(opts); }
export function vibrate(pattern) { return inst().vibrate(pattern); }
export function alertTimerDone(settings) { return inst().alertTimerDone(settings); }
