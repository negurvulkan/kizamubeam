// Neues Schlüsselpaar für den Katalog der Erweiterungen erzeugen.
// Aufruf: node scripts/catalog-keygen.mjs
// Den geheimen Schlüssel als Repository-Secret PACKS_SIGNING_KEY eintragen (Settings → Secrets and variables →
// Actions), den öffentlichen als CATALOG_PUBKEY in src/catalog.ts. Danach erkennen ältere App-Versionen den
// Katalog nicht mehr, bis sie aktualisiert sind.
import { etc, keygenAsync } from '@noble/ed25519';

const { secretKey, publicKey } = await keygenAsync();
console.log(`PACKS_SIGNING_KEY (geheim): ${etc.bytesToHex(secretKey)}`);
console.log(`CATALOG_PUBKEY (öffentlich): ${etc.bytesToHex(publicKey)}`);
