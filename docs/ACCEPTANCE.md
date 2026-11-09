# Acceptance Checklist

**Program & rotation**
- [ ] First launch shows A1 with the exact starting weights in §2.
- [ ] Completing A1 → next shows B1; B2 → A1. Discarding does not advance.
- [ ] Barbell curl prompts for a starting weight once and never again.
- [ ] Editing `program.json` (e.g. changing Squat increment to 5) changes behaviour with no code change.

**Progression**
- [ ] T1 all sets hit → weight + increment, same stage.
- [ ] T1 stage 1 fail → stage 2 same weight; stage 2 fail → stage 3; stage 3 fail → reset decision with tested-5RM and Epley options; chosen path → stage 1 at round(0.85 × 5RM).
- [ ] T2 3×10 fail → 3×8 → 3×6 → reset decision proposing `stageStartWeight + 15` with editable value; new `stageStartWeight` recorded.
- [ ] T3 last set ≥ 25 → +5; 24 → unchanged.
- [ ] Hanging leg raise last set ≥ 15 (target 10) → target 12.
- [ ] Manual override of weight/stage takes effect next workout and appears in history.
- [ ] Substituting T2 Deadlift → RDL gives RDL independent state; Deadlift T1 unaffected.
- [ ] Incomplete sets on finish are treated as failures after confirmation.

**Plates & warm-ups**
- [ ] All ten vectors in §5 pass.
- [ ] Enabling 1.25 plates makes 2.5 lb steps loadable; disabling re-rounds displayed weights.
- [ ] T1 at 245 shows warm-ups bar×10, 100×5 (≈40%), 145×3 (≈60%), 185×2 (≈75%), 210×1 (≈85%) — each rounded to loadable with plates shown.
- [ ] Lat pulldown and leg raise never show plates.

**Timer & device**
- [ ] Completing a working set starts the correct tier default.
- [ ] ±30 s and skip work; defaults editable.
- [ ] Timer remains correct after backgrounding for longer than its duration (fake-clock test + manual).
- [ ] Beep + vibrate on finish (vibrate where supported). Wake Lock held during workout, released after.

**Persistence & data**
- [ ] Mid-workout reload resumes with all logged sets and running timer.
- [ ] Export produces a JSON file; import of that file on a cleared app restores identical state (test round-trip).
- [ ] Import rejects malformed JSON and newer schema versions with a clear message.
- [ ] Undo last workout restores pre-workout weights, stages and rotation.

**History**
- [ ] Log lists workouts with expandable sets and progression outcomes.
- [ ] e1RM chart renders for each T1 lift from T1 sets only; points tappable.

**PWA & deploy**
- [ ] Lighthouse (or manual check) shows installable; app loads from cache with network disabled.
- [ ] Bumping `VERSION` and redeploying causes an "update available" prompt on next open.
- [ ] Works when served from a subpath (`/<repo>/`).

**Quality**
- [ ] `npm test` passes with zero external dependencies.
- [ ] No console errors on any screen.
- [ ] All interactive targets ≥ 56 px; primary actions reachable by thumb on a 6.1" phone.
