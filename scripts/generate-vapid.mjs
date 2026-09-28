// Prints a new VAPID key pair for Web Push. The public key (uncompressed P-256 point) goes in
// wrangler.jsonc vars.VAPID_PUBLIC_KEY; the private key (the JWK "d" value) is the
// VAPID_PRIVATE_KEY secret. Replacing the pair invalidates every existing push subscription.
// Run: node scripts/generate-vapid.mjs
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
const { d } = await crypto.subtle.exportKey("jwk", privateKey);
console.log(`VAPID_PUBLIC_KEY=${Buffer.from(raw).toString("base64url")}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);
