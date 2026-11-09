import { test } from "node:test";
import assert from "node:assert/strict";
import { createWakeLock } from "../src/services/wakeLock.js";
import * as alerts from "../src/services/alerts.js";
import { createAlerts } from "../src/services/alerts.js";

// ---------- fakes ----------

function fakeDoc(state = "visible") {
  const listeners = new Set();
  return {
    visibilityState: state,
    addEventListener(type, fn) { if (type === "visibilitychange") listeners.add(fn); },
    removeEventListener(type, fn) { if (type === "visibilitychange") listeners.delete(fn); },
    setVisibility(v) { this.visibilityState = v; for (const fn of [...listeners]) fn({ type: "visibilitychange" }); },
    listenerCount: () => listeners.size,
  };
}

function fakeSentinel() {
  const rel = new Set();
  return {
    released: false,
    addEventListener(type, fn) { if (type === "release") rel.add(fn); },
    async release() { if (this.released) return; this.released = true; for (const fn of rel) fn(); },
    // the browser releases the lock itself when the page is hidden
    systemRelease() { this.released = true; for (const fn of rel) fn(); },
  };
}

function nav2({ reject = false } = {}) {
  const n = { sentinels: [], requests: 0 };
  n.wakeLock = {
    async request(type) {
      n.requests++;
      if (type !== "screen") throw new Error("bad type");
      if (reject) throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
      const s = fakeSentinel();
      n.sentinels.push(s);
      return s;
    },
  };
  return n;
}

const flush = () => new Promise((r) => setImmediate(r));

// ---------- wakeLock ----------

test("wakeLock: enable acquires a screen lock, disable releases it", async () => {
  const nav = nav2();
  const doc = fakeDoc();
  const wl = createWakeLock({ nav, doc });
  assert.equal(wl.isActive(), false);
  await wl.enable();
  assert.equal(nav.requests, 1);
  assert.equal(wl.isActive(), true);
  await wl.enable(); // idempotent while held
  assert.equal(nav.requests, 1);
  await wl.disable();
  assert.equal(wl.isActive(), false);
  assert.equal(nav.sentinels[0].released, true);
  assert.equal(doc.listenerCount(), 0);
});

test("wakeLock: re-acquires when the doc becomes visible while wanted", async () => {
  const nav = nav2();
  const doc = fakeDoc();
  const wl = createWakeLock({ nav, doc });
  await wl.enable();
  // page hidden -> browser drops the lock
  nav.sentinels[0].systemRelease();
  doc.setVisibility("hidden");
  await flush();
  assert.equal(wl.isActive(), false);
  assert.equal(nav.requests, 1, "does not request while hidden");
  doc.setVisibility("visible");
  await flush();
  assert.equal(nav.requests, 2);
  assert.equal(wl.isActive(), true);
});

test("wakeLock: no re-acquire after disable", async () => {
  const nav = nav2();
  const doc = fakeDoc();
  const wl = createWakeLock({ nav, doc });
  await wl.enable();
  await wl.disable();
  doc.setVisibility("hidden");
  doc.setVisibility("visible");
  await flush();
  assert.equal(nav.requests, 1);
  assert.equal(wl.isActive(), false);
});

test("wakeLock: enable while hidden waits for visible", async () => {
  const nav = nav2();
  const doc = fakeDoc("hidden");
  const wl = createWakeLock({ nav, doc });
  await wl.enable();
  assert.equal(nav.requests, 0);
  doc.setVisibility("visible");
  await flush();
  assert.equal(wl.isActive(), true);
});

test("wakeLock: disable during a pending request releases the late lock", async () => {
  const nav = nav2();
  const doc = fakeDoc();
  const wl = createWakeLock({ nav, doc });
  const p = wl.enable();
  await wl.disable();
  await p;
  assert.equal(wl.isActive(), false);
  assert.ok(nav.sentinels.every((s) => s.released));
});

test("wakeLock: never throws when unsupported or rejected", async () => {
  for (const nav of [undefined, null, {}, { wakeLock: {} }, nav2({ reject: true }),
    { wakeLock: { request() { throw new Error("sync boom"); } } }]) {
    const wl = createWakeLock({ nav, doc: fakeDoc() });
    await assert.doesNotReject(wl.enable());
    assert.equal(wl.isActive(), false);
    await assert.doesNotReject(wl.disable());
  }
  // no doc at all
  const wl = createWakeLock({ nav: nav2(), doc: undefined });
  await wl.enable();
  assert.equal(wl.isActive(), true);
  await wl.disable();
});

test("wakeLock: default args do not throw in Node", async () => {
  const wl = createWakeLock();
  await assert.doesNotReject(wl.enable());
  await assert.doesNotReject(wl.disable());
});

// ---------- alerts ----------

function fakeAudio() {
  const log = { created: 0, resumed: 0, oscillators: [], buffersPlayed: 0 };
  const param = () => {
    const calls = [];
    return { calls, setValueAtTime: (v, t) => calls.push(["set", v, t]),
      linearRampToValueAtTime: (v, t) => calls.push(["lin", v, t]),
      exponentialRampToValueAtTime: (v, t) => calls.push(["exp", v, t]) };
  };
  class FakeAudioContext {
    constructor() { log.created++; this.state = "suspended"; this.currentTime = 5; this.destination = { dest: true }; }
    resume() { log.resumed++; this.state = "running"; return Promise.resolve(); }
    createBuffer(ch, len, rate) { return { ch, len, rate }; }
    createBufferSource() { return { connect() {}, start() { log.buffersPlayed++; } }; }
    createGain() { return { gain: param(), connect(n) { this.to = n; } }; }
    createOscillator() {
      const o = { frequency: param(), type: null, connect(n) { this.to = n; },
        start(t) { this.startAt = t; }, stop(t) { this.stopAt = t; } };
      log.oscillators.push(o);
      return o;
    }
  }
  return { FakeAudioContext, log };
}

test("alerts: module imports in Node and calls are safe without Web Audio / vibrate", () => {
  assert.equal(typeof alerts.unlockAudio, "function");
  assert.doesNotThrow(() => alerts.unlockAudio());
  assert.doesNotThrow(() => alerts.beep());
  assert.doesNotThrow(() => alerts.vibrate());
  assert.doesNotThrow(() => alerts.alertTimerDone({ sound: true, vibration: true }));
  assert.doesNotThrow(() => alerts.alertTimerDone(undefined));
});

test("alerts: AudioContext is lazy; unlockAudio creates, resumes and primes once", () => {
  const { FakeAudioContext, log } = fakeAudio();
  const a = createAlerts({ AudioContext: FakeAudioContext, nav: {} });
  assert.equal(log.created, 0, "not created at construction");
  assert.equal(a.unlockAudio(), true);
  assert.equal(log.created, 1);
  assert.equal(log.resumed, 1);
  assert.equal(log.buffersPlayed, 1);
  a.unlockAudio();
  assert.equal(log.created, 1, "single context");
  assert.equal(log.buffersPlayed, 1, "silent buffer only once");
});

test("alerts: beep schedules oscillators on the audio clock with an envelope", () => {
  const { FakeAudioContext, log } = fakeAudio();
  const a = createAlerts({ AudioContext: FakeAudioContext, nav: {} });
  assert.equal(a.beep({ durationMs: 200, frequency: 660, repeats: 3 }), true);
  assert.equal(log.oscillators.length, 3);
  const starts = log.oscillators.map((o) => o.startAt);
  assert.ok(starts[0] >= 5, "scheduled relative to currentTime");
  assert.ok(starts[1] > starts[0] + 0.2 && starts[2] > starts[1] + 0.2, "spaced beeps");
  for (const o of log.oscillators) {
    assert.ok(o.stopAt > o.startAt);
    assert.deepEqual(o.frequency.calls[0].slice(0, 2), ["set", 660]);
    const gainNode = o.to;
    assert.ok(gainNode.gain.calls.some((c) => c[0] === "lin"), "attack ramp");
    assert.ok(gainNode.gain.calls.some((c) => c[0] === "exp"), "release ramp");
    assert.deepEqual(gainNode.to, { dest: true });
  }
});

test("alerts: vibrate guards navigator.vibrate", () => {
  const calls = [];
  const a = createAlerts({ AudioContext: null, nav: { vibrate: (p) => { calls.push(p); return true; } } });
  assert.equal(a.vibrate(), true);
  assert.deepEqual(calls[0], [200, 100, 200]);
  assert.equal(createAlerts({ nav: {} }).vibrate(), false);
  assert.equal(createAlerts({ nav: null }).vibrate(), false);
  assert.equal(createAlerts({ nav: { vibrate() { throw new Error("x"); } } }).vibrate(), false);
});

test("alerts: alertTimerDone respects settings.sound / settings.vibration", () => {
  const run = (settings) => {
    const { FakeAudioContext, log } = fakeAudio();
    let vib = 0;
    createAlerts({ AudioContext: FakeAudioContext, nav: { vibrate: () => { vib++; return true; } } })
      .alertTimerDone(settings);
    return { beeps: log.oscillators.length, vib };
  };
  assert.deepEqual(run({ sound: true, vibration: true }), { beeps: 3, vib: 1 });
  assert.deepEqual(run({ sound: false, vibration: true }), { beeps: 0, vib: 1 });
  assert.deepEqual(run({ sound: true, vibration: false }), { beeps: 3, vib: 0 });
  assert.deepEqual(run({ sound: false, vibration: false }), { beeps: 0, vib: 0 });
});
