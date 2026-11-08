import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CAPS, type CapName } from '../gtm/config.ts';
import { templatesHash } from '../gtm/copy.ts';
import { type Flags, setFlag } from '../gtm/store.ts';
import { loadStore, saveStore } from '../gtm/store-file.ts';

/**
 * `pnpm gtm:flags`: shows the store's flags, and sets the ones a person records during activation.
 * Every change writes an audit row. Setting a flag never sends anything by itself: a lane goes live
 * only when its flag and every precondition pass at run time.
 *
 *   --set key=value        mode, film_lane, x_lane, email_lane, postal_address, founder_user_id,
 *                          app_base, executor_key_minted_at, caps.<name>, rulings.<name>
 *   --approve-templates    records the hash of today's caption templates as the approved set
 */
const { values } = parseArgs({
  options: {
    set: { type: 'string', multiple: true, default: [] },
    'approve-templates': { type: 'boolean', default: false },
  },
});
const root = process.env.GTM_OUT ?? fileURLToPath(new URL('../../../out/gtm/', import.meta.url));
const store = loadStore(root);
const at = new Date().toISOString();
const by = 'gtm:flags';

const ENUMS: Partial<Record<keyof Flags, readonly string[]>> = {
  mode: ['dry_run', 'live', 'halted'],
  film_lane: ['off', 'dry_run', 'live'],
  x_lane: ['off', 'dry_run', 'standalone', 'pack', 'consent'],
  email_lane: ['off', 'dry_run', 'live'],
};
const TEXT: readonly (keyof Flags)[] = [
  'postal_address',
  'founder_user_id',
  'app_base',
  'executor_key_minted_at',
];

for (const item of values.set) {
  const split = item.indexOf('=');
  if (split < 1) throw new Error(`--set takes key=value, not ${item}`);
  const key = item.slice(0, split);
  const value = item.slice(split + 1);
  if (key.startsWith('caps.')) {
    const name = key.slice(5) as CapName;
    if (!(name in CAPS)) throw new Error(`no cap named ${name}`);
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > CAPS[name].max) {
      throw new Error(`${name} is a number from 0 to its hard maximum, ${CAPS[name].max}`);
    }
    setFlag(store, 'caps', { ...store.flags.caps, [name]: number }, by, at);
  } else if (key.startsWith('rulings.')) {
    const name = key.slice(8) as keyof Flags['rulings'];
    if (!(name in store.flags.rulings) || name === 'x_templates_approved') {
      throw new Error(`no ruling named ${name}; approve templates with --approve-templates`);
    }
    setFlag(store, 'rulings', { ...store.flags.rulings, [name]: value === 'true' }, by, at);
  } else if (ENUMS[key as keyof Flags]) {
    if (!ENUMS[key as keyof Flags]?.includes(value))
      throw new Error(`${key} is one of ${ENUMS[key as keyof Flags]?.join(', ')}`);
    setFlag(store, key as 'mode', value as Flags['mode'], by, at);
  } else if ((TEXT as readonly string[]).includes(key)) {
    if (key === 'app_base' && !/^https:\/\/[^/]+$/.test(value))
      throw new Error('app_base is https://<host>, with no path');
    setFlag(store, key as 'postal_address', value || null, by, at);
  } else {
    throw new Error(`${key} cannot be set here`);
  }
}
if (values['approve-templates']) {
  setFlag(
    store,
    'rulings',
    { ...store.flags.rulings, x_templates_approved: templatesHash() },
    by,
    at,
  );
}
if (values.set.length || values['approve-templates']) saveStore(root, store);
console.log(JSON.stringify(store.flags, null, 2));
