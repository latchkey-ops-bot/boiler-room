import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { emptyStore, type StoreData, upgradeStore } from './store.ts';

/** The CLI's store: one JSON file for every day. Per-day outputs go in `<root>/<date>/`. */
export const storePath = (root: string) => join(root, 'store.json');
export const dayDir = (root: string, date: string) => join(root, date);

export function loadStore(root: string): StoreData {
  const path = storePath(root);
  if (!existsSync(path)) return emptyStore();
  return upgradeStore(JSON.parse(readFileSync(path, 'utf8')) as Partial<StoreData>);
}

/**
 * Writes the store atomically: a temporary file, then a rename, so a crash mid-write never leaves
 * half a suppression list. The high-water mark of suppression rows only ever rises.
 */
export function saveStore(root: string, store: StoreData): void {
  store.flags.suppression_high_water = Math.max(
    store.flags.suppression_high_water,
    store.suppression.length,
  );
  const path = storePath(root);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`);
  renameSync(temporary, path);
}

/** Writes one per-day output file, such as the report or the review file. */
export function writeDayFile(root: string, date: string, name: string, content: string): string {
  const path = join(dayDir(root, date), name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

/** The counts an import into D1 must match before the hosted executor may start a live lane. */
export function exportCounts(store: StoreData) {
  return {
    suppression: store.suppression.length,
    contacts: store.contacts.length,
    actions: store.actions.length,
  };
}
