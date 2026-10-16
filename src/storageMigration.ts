// Bis Version 1.0.0-alpha hieß die App „Laserwerk“ und speicherte ihre Einstellungen unter „laserwerk.*“.
// Beim ersten Start nach der Umbenennung werden diese Einträge nach „kizamubeam.*“ kopiert. Die alten
// Einträge bleiben stehen, damit eine ältere Version weiter ihre Einstellungen findet.
// Muss vor allen anderen Modulen geladen werden (erster Import in main.ts), weil manche beim Laden lesen.
const OLD = 'laserwerk.';
const NEW = 'kizamubeam.';

export function migrateStorage(store: Storage) {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k?.startsWith(OLD)) keys.push(k);
  }
  for (const k of keys) {
    const target = NEW + k.slice(OLD.length);
    const v = store.getItem(k);
    if (v !== null && store.getItem(target) === null) store.setItem(target, v);
  }
}

try {
  migrateStorage(localStorage);
} catch {
  /* kein Speicher verfügbar, z. B. privates Fenster */
}
