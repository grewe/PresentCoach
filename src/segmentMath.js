/** Number of 10s sequences (last may be shorter). Returns 0 if invalid. */
export function segmentCountFromDuration(durationSec) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.ceil(durationSec / 10);
}
