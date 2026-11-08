const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** A random id such as `flm_4k8d2…`: 20 characters of base32, about 100 bits. */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % 32];
  return `${prefix}_${out}`;
}
