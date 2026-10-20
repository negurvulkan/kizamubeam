// catalog.json signieren (Ed25519): schreibt catalog.json.sig (Base64) daneben.
// Aufruf: PACKS_SIGNING_KEY=<hex> node scripts/sign-catalog.mjs website/catalog/catalog.json
// Ohne Schlüssel gibt es nur eine Warnung; die App benutzt einen Katalog ohne gültige Signatur nicht.
import { etc, getPublicKeyAsync, signAsync } from '@noble/ed25519';
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('Aufruf: node scripts/sign-catalog.mjs <catalog.json>');
const key = (process.env.PACKS_SIGNING_KEY ?? '').trim();
if (!/^[0-9a-f]{64}$/i.test(key)) {
  console.log('::warning::PACKS_SIGNING_KEY fehlt oder ist ungültig – der Katalog bleibt unsigniert und wird von der App nicht benutzt.');
  process.exit(0);
}
const secret = etc.hexToBytes(key.toLowerCase());
const sig = await signAsync(readFileSync(file), secret);
writeFileSync(file + '.sig', Buffer.from(sig).toString('base64') + '\n');
console.log(`signiert: ${file}.sig (öffentlicher Schlüssel ${etc.bytesToHex(await getPublicKeyAsync(secret))})`);
