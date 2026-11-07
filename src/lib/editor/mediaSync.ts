/** When the preview re-seeks a <video> to the timeline's time. Pure - see
 * tests/desktop/mediaSync.test.ts.
 *
 * An element that reached its end reports `ended` until it's seeked. The
 * preview used to leave ended elements alone (re-seeking one parked at its
 * end loops), but nothing else clears `ended` - so once the playhead had
 * touched the end of the recording (played to it, or dragged to the edge),
 * the picture stayed on one frame for good: no seek, and no play either.
 * Now an ended element is only left alone when the wanted time is at its
 * end too; anywhere earlier it's seeked, which clears `ended`.
 */

export interface MediaState {
  readyState: number;
  seeking: boolean;
  ended: boolean;
  duration: number;
  currentTime: number;
}

/** How close to the end counts as "at the end" (a frame or so). */
export const END_SLACK = 0.05;

/** Whether to seek `el` to `target` (seconds): it can seek, isn't seeking
 * already, is off by more than `tolerance`, and - if it ended - the target
 * is before its end. `driven` (freeze / reversed slots) always follows. */
export function shouldSeek(el: MediaState, target: number, tolerance: number, driven = false): boolean {
  if (el.readyState < 1 || el.seeking) return false;
  if (!(Math.abs(el.currentTime - target) > tolerance)) return false;
  if (el.ended && !driven && Number.isFinite(el.duration) && target >= el.duration - END_SLACK) return false;
  return true;
}
