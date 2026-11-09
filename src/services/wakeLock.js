// Screen Wake Lock wrapper (CONTRACTS §6). Never throws; silently no-ops where unsupported.
//
// The browser drops a wake lock whenever the page is hidden, so while the lock is
// wanted we re-request it on visibilitychange -> visible.

export function createWakeLock({ nav = globalThis.navigator, doc = globalThis.document } = {}) {
  let wanted = false;
  let sentinel = null;
  let pending = null;
  let listening = false;

  const supported = () => !!(nav && nav.wakeLock && typeof nav.wakeLock.request === "function");
  const visible = () => !doc || doc.visibilityState === undefined || doc.visibilityState === "visible";

  async function releaseSentinel() {
    const s = sentinel;
    sentinel = null;
    if (s && !s.released && typeof s.release === "function") {
      try { await s.release(); } catch { /* ignore */ }
    }
  }

  async function acquire() {
    if (!wanted || !supported() || !visible()) return;
    if (sentinel && !sentinel.released) return;
    if (pending) return pending;
    pending = (async () => {
      try {
        const s = await nav.wakeLock.request("screen");
        if (!wanted) {
          try { await s?.release?.(); } catch { /* ignore */ }
          return;
        }
        sentinel = s || null;
        if (s && typeof s.addEventListener === "function") {
          s.addEventListener("release", () => { if (sentinel === s) sentinel = null; });
        }
      } catch {
        // NotAllowedError (hidden page, battery saver, permissions policy) — ignore.
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  function onVisibility() {
    if (wanted && visible()) acquire();
  }

  function listen(on) {
    if (!doc || typeof doc.addEventListener !== "function") return;
    if (on && !listening) doc.addEventListener("visibilitychange", onVisibility);
    if (!on && listening) doc.removeEventListener("visibilitychange", onVisibility);
    listening = on;
  }

  return {
    async enable() {
      try {
        wanted = true;
        listen(true);
        await acquire();
      } catch { /* never throw */ }
    },
    async disable() {
      try {
        wanted = false;
        listen(false);
        if (pending) { try { await pending; } catch { /* ignore */ } }
        await releaseSentinel();
      } catch { /* never throw */ }
    },
    isActive() {
      return !!(sentinel && !sentinel.released);
    },
  };
}
