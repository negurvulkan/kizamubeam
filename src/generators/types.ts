// Gemeinsame Schnittstelle aller Generatoren (Zahnrad, später Box, Zahnstange …).
// Ein Generator ist eine reine Funktion von Parametern auf Geometrie: kein Zugriff auf Editor, DOM oder Maschine.
// Damit lässt er sich testen, über MCP aufrufen und später auch als Community-Generator laden.
import type { SubPath } from '../model';

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

interface SpecBase {
  key: string;
  label: string;
  /** Erklärung als Tooltip im Dialog und als Beschreibung für KI-Agenten */
  title?: string;
  /** Abschnitt im Dialog: Hauptfelder oder eingeklappt unter „Erweitert“ */
  advanced?: boolean;
  /** Feld nur zeigen (und beachten), wenn diese Bedingung gilt */
  showIf?: (p: Params) => boolean;
}

export type ParamSpec =
  | (SpecBase & {
      /** length = mm, angle = Grad, int = ganze Zahl, number = Faktor ohne Einheit */
      type: 'length' | 'angle' | 'int' | 'number';
      min: number;
      max: number;
      def: number;
    })
  | (SpecBase & { type: 'enum'; options: [string, string][]; def: string })
  | (SpecBase & { type: 'bool'; def: boolean });

export interface Issue {
  /** Betroffenes Feld (fehlt bei Problemen, die mehrere Felder betreffen) */
  key?: string;
  /** error sperrt Erzeugen, warn nicht */
  level: 'error' | 'warn';
  msg: string;
}

export interface GenResult {
  /** Konturen in lokalen Koordinaten (mm, y nach unten), als Bézierkurven */
  subs: SubPath[];
  /** Kennwerte für den Dialog (z. B. Teilkreis- und Kopfkreisdurchmesser) */
  info: [string, string][];
}

export interface Generator {
  id: string;
  /** Wird erhöht, wenn sich Parameter ändern; migrate() bringt ältere Parameter auf den Stand */
  version: number;
  /** part = ein Bauteil, assembly = Baugruppe aus mehreren Teilen */
  kind: 'part' | 'assembly';
  name: string;
  icon: string;
  schema: ParamSpec[];
  /** Prüft die (bereits normalisierten) Parameter */
  validate(p: Params): Issue[];
  /** Erzeugt die Geometrie; wird nur aufgerufen, wenn validate() keinen Fehler meldet */
  generate(p: Params): GenResult;
  /** Kurzer Name für das Objekte-Fenster, z. B. „Zahnrad z=24 m=2“ */
  label(p: Params): string;
  migrate?(p: Params, from: number): Params;
}
