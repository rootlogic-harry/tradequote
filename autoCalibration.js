/**
 * Determines whether auto-calibration should trigger based on the number
 * of completed jobs since the last calibration run.
 *
 * @param {number} completedSinceLastRun - Jobs completed since last calibration
 * @param {number} threshold - Minimum jobs needed to trigger (default: 5)
 * @returns {boolean}
 */
export function shouldAutoCalibrate(completedSinceLastRun, threshold = 5) {
  return completedSinceLastRun >= threshold;
}
