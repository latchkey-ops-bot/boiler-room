/**
 * Follows the film command's events file: `fs.watch` for speed, and a poll every second in case a
 * change notification is missed. Hands each complete line over once, in order.
 */
import {
  closeSync,
  existsSync,
  type FSWatcher,
  openSync,
  readSync,
  statSync,
  watch,
} from 'node:fs';
import { basename, dirname } from 'node:path';

export class EventTail {
  private readonly file: string;
  private readonly onLine: (line: string) => void;
  private offset = 0;
  private partial = '';
  private watcher: FSWatcher | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly decoder = new TextDecoder();

  constructor(file: string, onLine: (line: string) => void) {
    this.file = file;
    this.onLine = onLine;
  }

  start(pollMs = 1000) {
    try {
      this.watcher = watch(dirname(this.file), (_event, name) => {
        if (!name || name === basename(this.file)) this.read();
      });
      this.watcher.on('error', () => undefined);
    } catch {
      // The poll below still reads the file.
    }
    this.timer = setInterval(() => this.read(), pollMs);
    this.read();
  }

  /** Reads whatever was appended since the last read. */
  read() {
    if (!existsSync(this.file)) return;
    let size: number;
    try {
      size = statSync(this.file).size;
    } catch {
      return;
    }
    if (size <= this.offset) return;
    const fd = openSync(this.file, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(size - this.offset, 4 * 1024 * 1024));
      const read = readSync(fd, buffer, 0, buffer.length, this.offset);
      this.offset += read;
      const text = this.partial + this.decoder.decode(buffer.subarray(0, read), { stream: true });
      const lines = text.split('\n');
      this.partial = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) this.onLine(line);
    } finally {
      closeSync(fd);
    }
    if (size > this.offset) this.read();
  }

  /** Stops following, after a last read. A last line with no newline still counts. */
  stop() {
    this.watcher?.close();
    if (this.timer) clearInterval(this.timer);
    this.read();
    const rest = this.partial + this.decoder.decode();
    this.partial = '';
    if (rest.trim()) this.onLine(rest);
  }
}
