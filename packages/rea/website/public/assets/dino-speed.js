// Speed rule recovered from wayou's Chromium-derived browser edition.
// Source and controlled checks: website/evidence/calculator-and-dino.md.
export const SPEED_RULE = Object.freeze({
  start: 6,
  acceleration: 0.001,
  threshold: 13,
});

/** Advance one collision-free update using the inspected speed rule. */
export function advanceSpeed(speed) {
  return speed < SPEED_RULE.threshold ? speed + SPEED_RULE.acceleration : speed;
}

/** Replay the recovered rule for a chosen number of updates. */
export function simulateSpeed(updates) {
  let speed = SPEED_RULE.start;
  for (let update = 0; update < updates; update += 1) {
    speed = advanceSpeed(speed);
  }
  return speed;
}
