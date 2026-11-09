// Hash-based router: "#/workout" | "#/history" | "#/settings" | "#/summary".

export const ROUTES = ["workout", "history", "settings", "summary"];

export function parseRoute(hash) {
  const name = String(hash || "").replace(/^#\/?/, "").split(/[/?]/)[0].toLowerCase();
  return ROUTES.includes(name) ? name : "workout";
}

export function navigate(route) {
  const target = `#/${parseRoute(`#/${route}`)}`;
  if (location.hash === target) {
    // Same hash: hashchange won't fire, so notify listeners manually.
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    location.hash = target;
  }
}

export function onRouteChange(cb) {
  const handler = () => cb(parseRoute(location.hash));
  window.addEventListener("hashchange", handler);
  return () => window.removeEventListener("hashchange", handler);
}
