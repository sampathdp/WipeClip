/** Serial, failure-aware writer for one output file. MediaRecorder hands
 * out chunks faster than a slow disk may take them and in any order the
 * event loop likes; this keeps them in order, never runs two writes to the
 * same file at once, and remembers the first failure so the session can
 * stop cleanly instead of writing a file with a hole in it. Pure (the
 * actual write is injected) - see tests/desktop/recorder.test.ts.
 */

export type WriteFn = (bytes: Uint8Array) => Promise<void>;

export class ChunkWriter {
  private tail: Promise<void> = Promise.resolve();
  private failed: Error | null = null;
  private pending = 0;
  bytes = 0;
  private write: WriteFn;
  private onError: (err: Error) => void;

  constructor(write: WriteFn, onError: (err: Error) => void) {
    this.write = write;
    this.onError = onError;
  }

  get error(): Error | null {
    return this.failed;
  }

  /** Bytes queued but not yet written. */
  get backlog(): number {
    return this.pending;
  }

  push(data: Blob | Uint8Array): void {
    if (this.failed) return;
    const size = data instanceof Uint8Array ? data.byteLength : data.size;
    if (size === 0) return;
    this.pending += size;
    this.tail = this.tail.then(async () => {
      try {
        if (this.failed) return;
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
        await this.write(bytes);
        this.bytes += bytes.byteLength;
      } catch (e) {
        this.failed = e instanceof Error ? e : new Error(String(e));
        this.onError(this.failed);
      } finally {
        this.pending -= size;
      }
    });
  }

  /** Resolves once everything queued so far is written (or failed). */
  flush(): Promise<void> {
    return this.tail;
  }
}
