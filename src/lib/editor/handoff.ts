/** Passes a file picked elsewhere (e.g. the homepage cleanup tool) to the
 * editor across a client-side navigation, so the user doesn't have to pick
 * it again. Module state survives next/link / router.push navigation; a full
 * page load clears it, in which case the editor just shows its own picker.
 */
let pending: File | null = null;

export function handOffToEditor(file: File): void {
  pending = file;
}

export function takeHandedOffFile(): File | null {
  const file = pending;
  pending = null;
  return file;
}
