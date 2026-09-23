const ALGORITHM = "pbkdf2-sha256";
// Workers cap PBKDF2 at 100k iterations.
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

// A real hash of a discarded random password. Login derives against it for unknown
// emails so the response time does not reveal whether an email is registered.
export const DUMMY_HASH =
  "pbkdf2-sha256$100000$16B-XhAd8oj32_cMuH1xtQ$0EmFxqKMEABm2Dd4G7swrmyrqLhysWNtbwxtGBZzSv8";

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, KEY_BITS);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `${ALGORITHM}$${ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterationsStr, saltStr, hashStr] = stored.split("$");
  const iterations = Number(iterationsStr);
  if (algorithm !== ALGORITHM || !Number.isInteger(iterations) || iterations <= 0 || !saltStr || !hashStr) {
    return false;
  }
  const expected = fromBase64Url(hashStr);
  const actual = await derive(password, fromBase64Url(saltStr), iterations);
  if (expected.byteLength !== actual.byteLength) return false;
  return crypto.subtle.timingSafeEqual(actual, expected);
}
