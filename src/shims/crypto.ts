// oxmsg (via uuid) gebruikt crypto.randomFillSync; Web Crypto biedt hetzelfde
export function randomFillSync<T extends ArrayBufferView>(buf: T): T {
  globalThis.crypto.getRandomValues(buf as unknown as Uint8Array);
  return buf;
}
export function randomBytes(n: number) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}
export default { randomFillSync, randomBytes };
