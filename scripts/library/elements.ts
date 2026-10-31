// Designelemente der mitgelieferten Bibliothek: Rahmen, Bordüren, Ecken, Trenner, Ornamente, Rosetten,
// Abzeichen, Banner, Muster und Formen. Vieles entsteht aus wenigen Bausteinen mit verschiedenen Werten.
import { Def, group } from './defs';
import {
  arc, arcPts, blob, circle, cr, D, edge, ellipse, heart, hollow, I, leaf, ngon, off, outline, over, poly, polar, rect, ring, round,
  row, spiralPts, star, stroke, T, taper, U, flipX, flipY, Pt, Shape,
} from './kit';

const LW = 2.4; // Linienbreite der Rahmen (bei 100 Einheiten Breite)
const rad = (d: number) => (d * Math.PI) / 180;

// ---------- Punktzüge ----------

/** Abgerundetes Rechteck als Punktzug */
function rrPts(x: number, y: number, w: number, h: number, r: number): Pt[] {
  if (r <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  return [...arcPts(x + w - r, y + r, r, -90, 0), ...arcPts(x + w - r, y + h - r, r, 0, 90), ...arcPts(x + r, y + h - r, r, 90, 180), ...arcPts(x + r, y + r, r, 180, 270)];
}
const circPts = (cx: number, cy: number, r: number, ry = r) => arcPts(cx, cy, r, 0, 360, ry, 120).slice(0, -1);
/** Punkte gleichmäßig entlang eines geschlossenen Punktzugs (mit Richtung) */
function along(pts: Pt[], step: number, offset = 0): { p: Pt; a: number }[] {
  const ring2 = [...pts, pts[0]];
  const out: { p: Pt; a: number }[] = [];
  let next = offset;
  let acc = 0;
  for (let i = 1; i < ring2.length; i++) {
    const [x0, y0] = ring2[i - 1],
      [x1, y1] = ring2[i];
    const l = Math.hypot(x1 - x0, y1 - y0);
    while (next <= acc + l) {
      const t = (next - acc) / (l || 1);
      out.push({ p: [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t], a: Math.atan2(y1 - y0, x1 - x0) });
      next += step;
    }
    acc += l;
  }
  return out;
}
const perimeter = (pts: Pt[]) => pts.reduce((s, p, i) => s + Math.hypot(p[0] - pts[(i + 1) % pts.length][0], p[1] - pts[(i + 1) % pts.length][1]), 0);
/** n gleich verteilte Punkte auf einem geschlossenen Punktzug */
const spread = (pts: Pt[], n: number) => along(pts, perimeter(pts) / n, perimeter(pts) / n / 2).slice(0, n);
/** Gestrichelte Linie entlang eines geschlossenen Punktzugs */
function dashed(pts: Pt[], dash: number, w: number, n: number): Shape {
  const L = perimeter(pts);
  const step = L / n;
  const marks = along(pts, step / 8, 0);
  let s: Shape = [];
  for (let i = 0; i < n; i++) {
    const seg = marks.filter((m, k) => {
      void m;
      const pos = (k * step) / 8 - i * step;
      return pos >= 0 && pos <= dash;
    });
    if (seg.length > 1) s = U(s, stroke(seg.map((m) => m.p), w, 'round'));
  }
  return s;
}
/** Form an jeden der Punkte setzen (gedreht nach der Richtung, wenn turn) */
function place(pos: { p: Pt; a: number }[], make: (x: number, y: number, a: number) => Shape): Shape {
  return U(...pos.map(({ p, a }) => make(p[0], p[1], a)));
}

// ---------- Rahmen ----------

const R = { x: 2, y: 2, w: 96, h: 66 };
const rr = (inset: number, r: number) => rrPts(R.x + inset, R.y + inset, R.w - 2 * inset, R.h - 2 * inset, Math.max(0, r - inset));
const frameLine = (pts: Pt[], w = LW) => outline(pts, w, false, 'miter');

function invertedCorners(x: number, y: number, w: number, h: number, r: number): Shape {
  return D(rect(x, y, w, h), circle(x, y, r), circle(x + w, y, r), circle(x, y + h, r), circle(x + w, y + h, r));
}
function chamfer(x: number, y: number, w: number, h: number, c: number): Pt[] {
  return [[x + c, y], [x + w - c, y], [x + w, y + c], [x + w, y + h - c], [x + w - c, y + h], [x + c, y + h], [x, y + h - c], [x, y + c]];
}
function scallopShape(pts: Pt[], n: number, r: number): Shape {
  return U(poly(pts), ...spread(pts, n).map(({ p }) => circle(p[0], p[1], r)));
}
function ticketPts(): Shape {
  return D(rect(2, 2, 96, 56, 3), circle(2, 30, 8), circle(98, 30, 8));
}
function archPts(x: number, y: number, w: number, h: number): Pt[] {
  return [...arcPts(x + w / 2, y + w / 2, w / 2, 180, 360), [x + w, y + h], [x, y + h]];
}
function shieldPts(): Pt[] {
  return cr([[50, 4], [70, 10], [92, 8], [92, 40], [84, 66], [68, 84], [50, 96], [32, 84], [16, 66], [8, 40], [8, 8], [30, 10]], true, 0.4);
}
const heartPts = (): Shape => heart(50, 52, 96);

const FRAMES: [string, string, string, string, () => Shape, number?][] = [
  ['frame-rect', 'Rechteckrahmen', 'Rectangle frame', 'Rechteck/rectangle, schlicht/simple', () => frameLine(rr(0, 0))],
  ['frame-rect-double', 'Doppelrahmen', 'Double frame', 'Rechteck/rectangle, doppelt/double', () => U(frameLine(rr(0, 0)), frameLine(rr(5, 0), 1.4))],
  ['frame-rounded', 'Abgerundeter Rahmen', 'Rounded frame', 'abgerundet/rounded', () => frameLine(rr(0, 10))],
  ['frame-rounded-double', 'Abgerundeter Doppelrahmen', 'Rounded double frame', 'abgerundet/rounded, doppelt/double', () => U(frameLine(rr(0, 12)), frameLine(rr(5, 12), 1.4))],
  ['frame-inverted', 'Rahmen mit Hohlecken', 'Inverted-corner frame', 'Hohlecken/inverted corners, klassisch/classic', () => U(hollow(invertedCorners(2, 2, 96, 66, 10), LW), hollow(invertedCorners(7, 7, 86, 56, 8), 1.2))],
  ['frame-chamfer', 'Rahmen mit Fasen', 'Chamfered frame', 'Fase/chamfer, eckig/angular', () => U(frameLine(chamfer(2, 2, 96, 66, 10)), frameLine(chamfer(7, 7, 86, 56, 8), 1.2))],
  ['frame-scallop', 'Wellenrahmen', 'Scalloped frame', 'Bogen/scallop, verspielt/playful', () => U(hollow(scallopShape(rrPts(8, 8, 84, 54, 0), 34, 5), LW), frameLine(rrPts(12, 12, 76, 46, 0), 1.2))],
  ['frame-circle', 'Kreisrahmen', 'Circle frame', 'Kreis/circle, rund/round', () => frameLine(circPts(50, 50, 48))],
  ['frame-circle-double', 'Doppelter Kreisrahmen', 'Double circle frame', 'Kreis/circle, doppelt/double', () => U(frameLine(circPts(50, 50, 48)), frameLine(circPts(50, 50, 43), 1.4))],
  ['frame-oval', 'Ovaler Rahmen', 'Oval frame', 'Oval/oval, Medaillon/cameo', () => frameLine(circPts(50, 36, 48, 34))],
  ['frame-oval-double', 'Ovaler Doppelrahmen', 'Double oval frame', 'Oval/oval, doppelt/double, Medaillon/cameo', () => U(frameLine(circPts(50, 36, 48, 34)), frameLine(circPts(50, 36, 43, 29), 1.4))],
  ['frame-circle-scallop', 'Gewellter Kreisrahmen', 'Scalloped circle frame', 'Kreis/circle, Bogen/scallop', () => U(hollow(scallopShape(circPts(50, 50, 42), 24, 6), LW), frameLine(circPts(50, 50, 38), 1.2))],
  ['frame-octagon', 'Achteckrahmen', 'Octagon frame', 'Achteck/octagon', () => U(hollow(ngon(50, 50, 8, 50, -67.5), LW), hollow(ngon(50, 50, 8, 44, -67.5), 1.2))],
  ['frame-hexagon', 'Sechseckrahmen', 'Hexagon frame', 'Sechseck/hexagon, Waben/honeycomb', () => U(hollow(ngon(50, 50, 6, 50, 0), LW), hollow(ngon(50, 50, 6, 44, 0), 1.2))],
  ['frame-heart', 'Herzrahmen', 'Heart frame', 'Herz/heart, Liebe/love, Valentinstag/valentine', () => U(hollow(heartPts(), LW), hollow(off(heartPts(), -6), 1.2))],
  ['frame-ticket', 'Ticketrahmen', 'Ticket frame', 'Ticket/ticket, Gutschein/voucher, Eintrittskarte/admission', () => U(hollow(ticketPts(), LW), hollow(off(ticketPts(), -5), 1.2))],
  ['frame-arch', 'Bogenrahmen', 'Arch frame', 'Bogen/arch, Fenster/window', () => U(frameLine(archPts(2, 2, 66, 96)), frameLine(archPts(7, 7, 56, 86), 1.2))],
  ['frame-diamond', 'Rautenrahmen', 'Diamond frame', 'Raute/rhombus', () => U(frameLine([[50, 2], [98, 36], [50, 70], [2, 36]]), frameLine([[50, 9], [88, 36], [50, 63], [12, 36]], 1.2))],
  ['frame-corner-squares', 'Rahmen mit Eckquadraten', 'Corner-square frame', 'Quadrat/square, klassisch/classic', () => {
    let s = frameLine(rr(5, 0));
    for (const [x, y] of [[0, 0], [90, 0], [0, 60], [90, 60]] as Pt[]) s = U(s, D(rect(x, y, 10, 10), rect(x + 2.5, y + 2.5, 5, 5)));
    return s;
  }],
  ['frame-corner-circles', 'Rahmen mit Eckkreisen', 'Corner-circle frame', 'Kreis/circle, klassisch/classic', () => {
    let s = frameLine(rr(5, 0));
    for (const [x, y] of [[7, 7], [93, 7], [7, 63], [93, 63]] as Pt[]) s = U(s, ring(x, y, 4.5, LW));
    return D(s, U(...([[7, 7], [93, 7], [7, 63], [93, 63]] as Pt[]).map(([x, y]) => circle(x, y, 3.3))));
  }],
  ['frame-stitched', 'Steppnaht-Rahmen', 'Stitched frame', 'Naht/stitch, Leder/leather, gestrichelt/dashed', () => U(frameLine(rr(0, 8), 1.6), dashed(rr(5, 8), 3, 1.6, 70))],
  ['frame-dotted', 'Punktrahmen', 'Dotted frame', 'Punkte/dots, gepunktet/dotted', () => place(spread(rr(2, 8), 64), (x, y) => circle(x, y, 1.6))],
  ['frame-brackets', 'Eckklammern', 'Corner brackets', 'Ecken/corners, Klammern/brackets, minimal/minimal', () => {
    const c = stroke([[2, 18], [2, 2], [18, 2]], LW, 'square', false, 'miter');
    return U(c, flipX(c), flipY(c, 35), flipY(flipX(c), 35));
  }],
  ['frame-pill', 'Pillenrahmen', 'Pill frame', 'Etikett/label, rund/round', () => U(frameLine(rrPts(2, 2, 96, 36, 18)), frameLine(rrPts(6, 6, 88, 28, 14), 1.2))],
  ['frame-shield', 'Wappenrahmen', 'Shield frame', 'Wappen/shield, Schild/crest', () => U(frameLine(shieldPts()), hollow(off(poly(shieldPts()), -5), 1.2))],
  ['frame-stepped', 'Stufenrahmen', 'Stepped frame', 'Art déco/art deco, Stufen/steps', () => {
    const p: Pt[] = [[12, 2], [88, 2], [88, 7], [93, 7], [93, 12], [98, 12], [98, 58], [93, 58], [93, 63], [88, 63], [88, 68], [12, 68], [12, 63], [7, 63], [7, 58], [2, 58], [2, 12], [7, 12], [7, 7], [12, 7]];
    return U(frameLine(p), frameLine(rrPts(12, 12, 76, 46, 0), 1.2));
  }],
  ['frame-beaded-circle', 'Perlenkranz', 'Beaded circle frame', 'Kreis/circle, Perlen/beads', () => U(frameLine(circPts(50, 50, 48), 1.8), place(spread(circPts(50, 50, 42), 40), (x, y) => circle(x, y, 2.3)), frameLine(circPts(50, 50, 36), 1.2))],
  ['frame-diamond-double', 'Quadrat übereck', 'Tilted square frame', 'Quadrat/square, Raute/diamond', () => U(hollow(ngon(50, 50, 4, 50), LW), hollow(ngon(50, 50, 4, 43), 1.2))],
  ['frame-photo', 'Sofortbildrahmen', 'Instant photo frame', 'Foto/photo, Polaroid/instant photo, Bild/picture', () => D(rect(2, 2, 80, 96, 2), rect(8, 8, 68, 68))],
  ['frame-cloud', 'Wolkenrahmen', 'Cloud frame', 'Wolke/cloud, Kinder/kids', () => {
    const base = U(rect(14, 16, 72, 40, 18), ...spread(rrPts(14, 16, 72, 40, 18), 14).map(({ p }) => circle(p[0], p[1], 9)));
    return hollow(round(base, 1), LW);
  }],
];

// ---------- Bordüren ----------

const BW = 300; // Länge in Einheiten
function waveLine(y: number, amp: number, period: number, phase = 0, x0 = 0, x1 = BW): Pt[] {
  const pts: Pt[] = [];
  for (let x = x0; x <= x1 + 0.01; x += period / 24) pts.push([x, y + amp * Math.sin(((x - x0) / period) * Math.PI * 2 + phase)]);
  return pts;
}
function meander(): Shape {
  // Mäander aus Haken, jeder 40 Einheiten breit
  const u = 5;
  let s: Shape = [];
  for (let x = 0; x + 40 <= BW; x += 40) {
    s = U(s, stroke([[x, 40], [x, 4], [x + 32, 4], [x + 32, 30], [x + 12, 30], [x + 12, 16], [x + 22, 16]], u, 'square', false, 'miter'), stroke([[x, 40], [x + 40, 40]], u, 'square'));
  }
  return U(s, stroke([[0, -4], [BW, -4]], u * 0.6, 'square'), stroke([[0, 48], [BW, 48]], u * 0.6, 'square'));
}
const BORDERS: [string, string, string, string, () => Shape, number?][] = [
  ['border-wave', 'Wellenlinie', 'Wavy line', 'Welle/wave, Linie/line', () => stroke(waveLine(10, 6, 30), 3)],
  ['border-double-wave', 'Doppelwelle', 'Double wave', 'Welle/wave, doppelt/double', () => U(stroke(waveLine(10, 6, 40), 2.6), stroke(waveLine(10, 6, 40, Math.PI), 2.6))],
  ['border-zigzag', 'Zickzack', 'Zigzag', 'Zickzack/zigzag', () => stroke(Array.from({ length: 31 }, (_, i): Pt => [i * 10, i % 2 ? 2 : 14]), 2.8, 'round', false, 'miter')],
  ['border-scallop', 'Bogenkante', 'Scalloped edge', 'Bogen/scallop, Spitze/lace', () => U(rect(0, 0, BW, 8), ...Array.from({ length: 15 }, (_, i) => poly(arcPts(10 + i * 20, 8, 10, 0, 180))))],
  ['border-meander', 'Mäander', 'Greek key', 'Mäander/meander, griechisch/greek, antik/antique', meander],
  ['border-chain', 'Kette', 'Chain', 'Kette/chain, Glieder/links', () => {
    let s: Shape = [];
    for (let i = 0; i < 13; i++) {
      const x = 12 + i * 23;
      s = i % 2 ? over(s, hollow(rect(x - 14, 4, 28, 12, 6), 3.2), 1.4) : U(s, hollow(rect(x - 14, 0, 28, 20, 10), 3.2));
    }
    return s;
  }],
  ['border-rope', 'Kordel', 'Rope', 'Seil/rope, Kordel/cord, maritim/nautical', () => {
    let s: Shape = [];
    for (let x = 0; x < BW; x += 12) s = over(s, T(ellipse(x + 6, 10, 8.5, 4.2), { rot: -35, cx: x + 6, cy: 10 }), 1);
    return I(s, rect(0, 0, BW, 20));
  }],
  ['border-dots', 'Punktreihe', 'Row of dots', 'Punkte/dots', () => row(circle(5, 5, 4), 30, 10.3)],
  ['border-diamonds', 'Rautenreihe', 'Row of diamonds', 'Raute/diamond', () => U(row(ngon(8, 8, 4, 8), 19, 16), stroke([[0, 8], [BW, 8]], 1.4))],
  ['border-hearts', 'Herzreihe', 'Row of hearts', 'Herz/heart, Liebe/love', () => row(heart(10, 10, 16), 15, 20)],
  ['border-stars', 'Sternreihe', 'Row of stars', 'Stern/star', () => row(star(10, 11, 5, 10, 4.2), 15, 20)],
  ['border-vine', 'Blattranke', 'Leaf vine', 'Ranke/vine, Blätter/leaves, Natur/nature', () => {
    const path = waveLine(16, 6, 50);
    let s = stroke(path, 2);
    for (let x = 12; x < BW; x += 25) {
      const up = Math.round(x / 25) % 2 === 0;
      const y = 16 + 6 * Math.sin((x / 50) * Math.PI * 2);
      s = U(s, leaf([x, y], [x + 12, y + (up ? -12 : 12)], 7, up ? 2 : -2));
    }
    return s;
  }],
  ['border-laurel', 'Lorbeergirlande', 'Laurel garland', 'Lorbeer/laurel, Girlande/garland, klassisch/classic', () => {
    let s = stroke([[0, 15], [BW, 15]], 1.8);
    for (let x = 4; x < BW - 8; x += 12) s = U(s, leaf([x, 15], [x + 14, 4], 6, 1), leaf([x, 15], [x + 14, 26], 6, -1));
    return s;
  }],
  ['border-chevrons', 'Pfeilspitzen', 'Chevrons', 'Pfeil/arrow, Chevron/chevron', () => U(...Array.from({ length: 20 }, (_, i) => stroke([[i * 15, 2], [i * 15 + 8, 10], [i * 15, 18]], 3, 'round', false, 'miter')))],
  ['border-dash-dot', 'Strich-Punkt', 'Dash and dot', 'gestrichelt/dashed, Punkte/dots', () => U(...Array.from({ length: 15 }, (_, i) => U(stroke([[i * 20 + 2, 5], [i * 20 + 12, 5]], 3), circle(i * 20 + 17, 5, 1.8))))],
  ['border-battlement', 'Zinnen', 'Battlement', 'Burg/castle, Zinnen/crenellation', () => {
    const p: Pt[] = [[0, 20]];
    for (let x = 0; x < BW; x += 20) p.push([x, 4], [x + 10, 4], [x + 10, 12], [x + 20, 12]);
    p.push([BW, 20]);
    return poly(p);
  }],
  ['border-rings', 'Ringkette', 'Interlocking rings', 'Ringe/rings, Kreise/circles', () => {
    let s: Shape = [];
    for (let i = 0; i < 18; i++) s = i % 2 ? over(s, ring(10 + i * 16, 10, 8, 2.4), 1.2) : U(s, ring(10 + i * 16, 10, 8, 2.4));
    return s;
  }],
  ['border-lace', 'Spitzenkante', 'Lace edge', 'Spitze/lace, Bogen/scallop', () => {
    let s = U(rect(0, 0, BW, 6), ...Array.from({ length: 15 }, (_, i) => poly(arcPts(10 + i * 20, 6, 10, 0, 180))));
    s = D(s, ...Array.from({ length: 15 }, (_, i) => circle(10 + i * 20, 9, 3)), ...Array.from({ length: 30 }, (_, i) => circle(5 + i * 10, 2.5, 1.2)));
    return s;
  }],
  ['border-bunting', 'Wimpelkette', 'Bunting', 'Wimpel/bunting, Party/party, Geburtstag/birthday', () => {
    const sag = (x: number) => 4 + 6 * Math.sin((x / BW) * Math.PI);
    let s = stroke(Array.from({ length: 61 }, (_, i): Pt => [i * 5, sag(i * 5)]), 1.6, 'round', true);
    for (let x = 10; x < BW - 10; x += 24) s = U(s, poly([[x, sag(x)], [x + 18, sag(x + 18)], [x + 9, sag(x + 9) + 22]]));
    return s;
  }],
  ['border-braid', 'Flechtband', 'Braid', 'Flechtband/braid, keltisch/celtic', () => {
    const a = stroke(waveLine(12, 8, 40), 4),
      b = stroke(waveLine(12, 8, 40, Math.PI), 4);
    // abwechselnd oben und unten
    let s = U(a, b);
    for (let x = 0; x <= BW; x += 20) {
      const k = Math.round(x / 20) % 2 === 0;
      const front = I(k ? a : b, rect(x - 6, 0, 12, 24));
      s = U(D(s, off(front, 1.4)), front);
    }
    return s;
  }],
];

// ---------- Ecken ----------

// Ecken: oben links in einem Feld 100 × 100
const CORNERS: [string, string, string, string, () => Shape, number?][] = [
  ['corner-l', 'Winkelecke', 'Angle corner', 'Winkel/angle, schlicht/simple', () => stroke([[4, 96], [4, 4], [96, 4]], 4, 'square', false, 'miter')],
  ['corner-l-double', 'Doppelte Winkelecke', 'Double angle corner', 'Winkel/angle, doppelt/double', () => U(stroke([[4, 96], [4, 4], [96, 4]], 4, 'square', false, 'miter'), stroke([[14, 70], [14, 14], [70, 14]], 2, 'square', false, 'miter'))],
  ['corner-arc', 'Bogenecke', 'Arc corner', 'Bogen/arc', () => U(stroke([[4, 96], [4, 4], [96, 4]], 3, 'round', false, 'miter'), arc(4, 4, 40, 0, 90, 2.4), arc(4, 4, 30, 0, 90, 1.6))],
  ['corner-curl', 'Schnörkelecke', 'Curl corner', 'Schnörkel/curl, verspielt/ornate', () => {
    const top = taper([[96, 4], [60, 4], ...spiralPts(28, 14, 10, 2, -1.25, 270)], 1.2, 3.4);
    return U(top, flipXY(top), circle(4, 4, 3));
  }],
  ['corner-deco', 'Art-déco-Ecke', 'Art deco corner', 'Art déco/art deco, Stufen/steps', () => U(stroke([[2, 96], [2, 2], [96, 2]], 2.6, 'square', false, 'miter'), stroke([[10, 70], [10, 22], [22, 22], [22, 10], [70, 10]], 2, 'square', false, 'miter'), stroke([[18, 46], [18, 30], [30, 30], [30, 18], [46, 18]], 1.6, 'square', false, 'miter'), rect(26, 26, 6, 6))],
  ['corner-leaf', 'Blattecke', 'Leaf corner', 'Blätter/leaves, Natur/nature', () => {
    let s = U(stroke(arcPts(96, 96, 88, 180, 270), 2), circle(8, 8, 5));
    for (let a = 186; a < 266; a += 14) {
      const r = rad(a);
      const x = 96 + 88 * Math.cos(r),
        y = 96 + 88 * Math.sin(r);
      s = U(s, leaf([x, y], [x + 14 * Math.cos(r + 0.9), y + 14 * Math.sin(r + 0.9)], 7), leaf([x, y], [x + 12 * Math.cos(r - 2.4), y + 12 * Math.sin(r - 2.4)], 6));
    }
    return s;
  }],
  ['corner-heart', 'Herzecke', 'Heart corner', 'Herz/heart, Liebe/love', () => U(stroke([[4, 96], [4, 30]], 2.4), stroke([[30, 4], [96, 4]], 2.4), T(heart(18, 18, 24), { rot: -45, cx: 18, cy: 18 }), circle(4, 96, 3), circle(96, 4, 3))],
  ['corner-dot', 'Ecke mit Punkt', 'Dot corner', 'Punkt/dot, schlicht/simple', () => U(stroke([[6, 96], [6, 26]], 2.4), stroke([[26, 6], [96, 6]], 2.4), circle(12, 12, 7), stroke([[6, 26], [16, 16]], 2.4), stroke([[26, 6], [16, 16]], 2.4))],
  ['corner-triangle', 'Dreieckecke', 'Triangle corner', 'Dreieck/triangle, geometrisch/geometric', () => U(poly([[0, 0], [40, 0], [0, 40]]), stroke([[50, 2], [96, 2]], 2.4), stroke([[2, 50], [2, 96]], 2.4), stroke([[48, 10], [10, 48]], 2))],
  ['corner-lace', 'Spitzenecke', 'Lace corner', 'Spitze/lace, Bogen/scallop', () => {
    let s = poly([[0, 0], ...arcPts(0, 0, 60, 0, 90), [0, 0]]);
    s = U(s, ...Array.from({ length: 7 }, (_, i) => circle(60 * Math.cos(rad(i * 15)), 60 * Math.sin(rad(i * 15)), 8)));
    s = I(s, rect(0, 0, 100, 100));
    s = D(s, ...Array.from({ length: 7 }, (_, i) => circle(58 * Math.cos(rad(i * 15)), 58 * Math.sin(rad(i * 15)), 3.2)), arc(0, 0, 44, -5, 95, 2), arc(0, 0, 28, -5, 95, 2));
    return s;
  }],
  ['corner-flower', 'Blumenecke', 'Floral corner', 'Blume/flower, Blüte/blossom', () => {
    let s = U(polar(ellipse(22, 12, 4.5, 9), 6, 22, 22), circle(22, 22, 5));
    s = D(s, edge(circle(22, 22, 5), 1.4));
    s = U(s, stroke([[34, 14], [60, 10], [96, 6]], 2, 'round', true), stroke([[14, 34], [10, 60], [6, 96]], 2, 'round', true));
    s = U(s, leaf([50, 11], [62, 0], 7), leaf([70, 9], [80, 18], 7), leaf([11, 50], [0, 62], 7), leaf([9, 70], [18, 80], 7));
    return s;
  }],
  ['corner-loop', 'Schlaufenecke', 'Loop corner', 'Schlaufe/loop, keltisch/celtic', () => {
    const lp = (rot: number) => T(ring(30, 14, 10, 3), { rot, cx: 14, cy: 14 });
    let s = U(lp(0), lp(90), ring(14, 14, 7, 3));
    s = U(s, stroke([[40, 4], [96, 4]], 3), stroke([[4, 40], [4, 96]], 3));
    return s;
  }],
  ['corner-flourish', 'Zierschwung', 'Flourish corner', 'Schwung/flourish, Kalligrafie/calligraphy', () => {
    const a = taper(cr([[96, 6], [56, 7], [30, 12], [16, 22]], false), 0.6, 4);
    return U(a, flipXY(a), taper(spiralPts(30, 30, 9, 1.5, -1.1, 225), 3, 1.2), circle(14, 14, 3));
  }],
  ['corner-triangles', 'Geometrische Ecke', 'Geometric corner', 'Dreiecke/triangles, geometrisch/geometric', () => U(poly([[0, 0], [30, 0], [0, 30]]), poly([[36, 0], [56, 0], [36, 20]]), poly([[0, 36], [20, 36], [0, 56]]), poly([[62, 0], [74, 0], [62, 12]]), poly([[0, 62], [12, 62], [0, 74]]), poly([[34, 34], [26, 34], [34, 26]]))],
  ['corner-stars', 'Sternecke', 'Star corner', 'Stern/star', () => U(star(16, 16, 5, 14, 6), star(42, 10, 5, 7, 3), star(10, 42, 5, 7, 3), star(62, 8, 5, 4.5, 2), star(8, 62, 5, 4.5, 2), stroke([[72, 4], [96, 4]], 1.6), stroke([[4, 72], [4, 96]], 1.6))],
  ['corner-filigree', 'Filigranecke', 'Filigree corner', 'Filigran/filigree, Schnörkel/curl', () => {
    const sp1 = spiralPts(46, 22, 2, 12, 1.1, 90).reverse();
    const a = stroke([...sp1, [70, 12], [96, 10]], 2, 'round', true);
    const b = stroke(spiralPts(26, 26, 2, 16, 1.2, 135).reverse(), 2.6, 'round', true);
    return U(a, flipXY(a), b, circle(46, 22, 2.2), circle(22, 46, 2.2), circle(26, 26, 2.2));
  }],
  ['corner-bracket-diamond', 'Ecke mit Raute', 'Diamond corner', 'Raute/diamond', () => U(stroke([[2, 96], [2, 24]], 2.4), stroke([[24, 2], [96, 2]], 2.4), ngon(16, 16, 4, 12, -45), stroke([[2, 24], [10, 22]], 2), stroke([[24, 2], [22, 10]], 2))],
  ['corner-fan', 'Fächerecke', 'Fan corner', 'Fächer/fan, Art déco/art deco, Strahlen/rays', () => U(...Array.from({ length: 7 }, (_, i) => stroke([[0, 0], [70 * Math.cos(rad(i * 15)), 70 * Math.sin(rad(i * 15))]], 2.2)), arc(0, 0, 70, 0, 90, 2.4), arc(0, 0, 22, 0, 90, 6, 'butt'))],
  ['corner-vine', 'Rankenecke', 'Vine corner', 'Ranke/vine, Blätter/leaves', () => {
    const path: Pt[] = [[96, 6], [70, 8], [44, 16], [24, 28], [14, 46], [8, 70], [6, 96]];
    let s = stroke(path, 2, 'round', true);
    const pts = cr(path, false);
    for (let k = 6; k < pts.length - 4; k += 9) {
      const [x, y] = pts[k],
        [x2, y2] = pts[k + 1];
      const a = Math.atan2(y2 - y, x2 - x) + (k % 2 ? 0.9 : -0.9) + Math.PI * (k % 18 < 9 ? 0 : 1) * 0;
      s = U(s, leaf([x, y], [x + 14 * Math.cos(a), y + 14 * Math.sin(a)], 6));
    }
    return U(s, spiralCurl(30, 30));
  }],
  ['corner-notch', 'Kerbecke', 'Notched corner', 'Kerbe/notch, Vintage/vintage', () => U(stroke([[2, 96], [2, 20], [20, 20], [20, 2], [96, 2]], 2.4, 'square', false, 'miter'), stroke([[10, 96], [10, 28], [28, 28], [28, 10], [96, 10]], 1.4, 'square', false, 'miter'))],
];
function flipXY(s: Shape): Shape {
  // an der Diagonalen spiegeln (x ↔ y)
  return T(T(s, { rot: 90, cx: 0, cy: 0 }), { sx: -1, sy: 1, cx: 0 });
}
function spiralCurl(cx: number, cy: number) {
  return U(stroke(spiralPts(cx, cy, 1.5, 9, 1.2, 45), 1.8, 'round', true));
}

// ---------- Trenner ----------

const DV: [string, string, string, string, () => Shape, number?][] = [
  ['divider-diamond', 'Trenner mit Raute', 'Diamond divider', 'Raute/diamond, Linie/line', () => U(taper([[2, 10], [40, 10]], 0.6, 2.4, false), taper([[60, 10], [98, 10]], 2.4, 0.6, false), ngon(50, 10, 4, 7), ngon(40, 10, 4, 2.6), ngon(60, 10, 4, 2.6))],
  ['divider-heart', 'Trenner mit Herz', 'Heart divider', 'Herz/heart, Liebe/love', () => U(taper([[2, 10], [40, 10]], 0.6, 2.4, false), taper([[60, 10], [98, 10]], 2.4, 0.6, false), heart(50, 10, 14))],
  ['divider-circle', 'Trenner mit Kreis', 'Circle divider', 'Kreis/circle, Punkte/dots', () => U(stroke([[2, 10], [38, 10]], 1.6), stroke([[62, 10], [98, 10]], 1.6), ring(50, 10, 6, 2), circle(50, 10, 2.4), circle(41, 10, 1.6), circle(59, 10, 1.6))],
  ['divider-scroll', 'Schnörkeltrenner', 'Scroll divider', 'Schnörkel/scroll, Kalligrafie/calligraphy', () => {
    const half = U(taper([[55, 10], [98, 10]], 2.4, 0.4, false), taper(spiralPts(64, 5.5, 4.5, 1.2, -1.2, 90), 2, 1));
    return U(half, flipX(half), ngon(50, 10, 4, 3.4));
  }],
  ['divider-swash', 'Schwungstrich', 'Swash', 'Schwung/swash, Pinselstrich/brush stroke', () => taper(cr([[2, 14], [30, 8], [60, 8], [98, 4]], false), 0.5, 4)],
  ['divider-star', 'Trenner mit Stern', 'Star divider', 'Stern/star', () => U(stroke([[2, 10], [40, 10]], 1.4), stroke([[60, 10], [98, 10]], 1.4), star(50, 10.5, 5, 8, 3.4), star(36, 10.3, 5, 3.4, 1.4), star(64, 10.3, 5, 3.4, 1.4))],
  ['divider-dots', 'Drei Punkte', 'Three dots', 'Punkte/dots, minimal/minimal', () => U(circle(30, 10, 3.5), circle(50, 10, 5), circle(70, 10, 3.5))],
  ['divider-wave', 'Wellentrenner', 'Wave divider', 'Welle/wave', () => stroke(Array.from({ length: 97 }, (_, i): Pt => [2 + i, 10 + 3.5 * Math.sin((i / 16) * Math.PI * 2) * Math.sin((i / 96) * Math.PI)]), 2)],
  ['divider-double', 'Doppellinie mit Raute', 'Double-line divider', 'doppelt/double, Raute/diamond', () => U(D(U(stroke([[2, 7], [98, 7]], 1.4), stroke([[2, 13], [98, 13]], 1.4)), ngon(50, 10, 4, 11)), hollow(ngon(50, 10, 4, 9), 1.6), ngon(50, 10, 4, 3.6))],
  ['divider-arrows', 'Pfeiltrenner', 'Arrow divider', 'Pfeil/arrow', () => U(stroke([[8, 10], [42, 10]], 1.8), stroke([[58, 10], [92, 10]], 1.8), poly([[2, 10], [10, 5], [10, 15]]), poly([[98, 10], [90, 5], [90, 15]]), circle(50, 10, 3.5))],
  ['divider-laurel', 'Lorbeertrenner', 'Laurel divider', 'Lorbeer/laurel, klassisch/classic', () => {
    let half = stroke([[54, 10], [96, 10]], 1.4);
    for (let x = 56; x < 92; x += 7) half = U(half, leaf([x, 10], [x + 8, 4], 3.6, 0.6), leaf([x, 10], [x + 8, 16], 3.6, -0.6));
    return U(half, flipX(half), circle(50, 10, 3));
  }],
  ['divider-sprig', 'Zweigtrenner', 'Sprig divider', 'Zweig/sprig, Blätter/leaves', () => U(stroke([[10, 12], [90, 12]], 1.4), leaf([50, 12], [50, 0], 6), leaf([50, 12], [40, 2], 5.4, -1), leaf([50, 12], [60, 2], 5.4, 1), leaf([50, 12], [34, 6], 5, -1), leaf([50, 12], [66, 6], 5, 1))],
  ['divider-fading-dots', 'Punkte auslaufend', 'Fading dots', 'Punkte/dots', () => U(...Array.from({ length: 13 }, (_, i) => circle(8 + i * 7, 10, 1 + 2.4 * Math.sin(((i + 0.5) / 13) * Math.PI))))],
  ['divider-brackets', 'Schlaufentrenner', 'Loop divider', 'Schlaufe/loop', () => {
    const half = U(stroke([[98, 10], [66, 10]], 1.8), hollow(ellipse(59, 10, 7, 4.5), 1.8));
    return U(half, flipX(half), circle(50, 10, 2.2));
  }],
  ['divider-deco', 'Art-déco-Trenner', 'Art deco divider', 'Art déco/art deco, Fächer/fan', () => U(stroke([[2, 16], [98, 16]], 1.6), ...[-40, -20, 0, 20, 40].map((a) => stroke([[50, 16], [50 + 14 * Math.sin(rad(a)), 16 - 14 * Math.cos(rad(a))]], 1.6)), arc(50, 16, 14, 220, 320, 1.6), stroke([[10, 20], [40, 20]], 1), stroke([[60, 20], [90, 20]], 1))],
  ['divider-s-scroll', 'S-Ranke', 'S-scroll divider', 'Ranke/scroll', () => U(stroke([...spiralPts(14, 10, 1.4, 7, 1, 180).reverse(), [30, 15], [50, 10], [70, 5], ...spiralPts(86, 10, 1.4, 7, 1, 0)], 1.8, 'round', true))],
  ['divider-infinity', 'Trenner mit Unendlich', 'Infinity divider', 'Unendlich/infinity, Liebe/love', () => {
    const pts: Pt[] = [];
    for (let i = 0; i <= 120; i++) {
      const t = (i / 120) * Math.PI * 2;
      const d = 1 + Math.sin(t) ** 2;
      pts.push([50 + (14 * Math.cos(t)) / d, 10 + (14 * Math.sin(t) * Math.cos(t)) / d]);
    }
    return U(stroke(pts, 1.8), stroke([[2, 10], [34, 10]], 1.4), stroke([[66, 10], [98, 10]], 1.4));
  }],
  ['divider-snowflake', 'Wintertrenner', 'Winter divider', 'Schnee/snow, Winter/winter, Weihnachten/christmas', () => U(stroke([[2, 10], [40, 10]], 1.4), stroke([[60, 10], [98, 10]], 1.4), polar(U(stroke([[50, 10], [50, 2]], 1.4), stroke([[50, 5], [47.5, 3]], 1), stroke([[50, 5], [52.5, 3]], 1)), 6, 50, 10), circle(34, 10, 1.6), circle(66, 10, 1.6))],
  ['divider-zigzag', 'Zickzacktrenner', 'Zigzag divider', 'Zickzack/zigzag', () => stroke(Array.from({ length: 17 }, (_, i): Pt => [2 + i * 6, i % 2 ? 6 : 14]), 1.8, 'round', false, 'miter')],
  ['divider-chain', 'Rautenkette', 'Diamond chain', 'Raute/diamond, Kette/chain', () => U(...Array.from({ length: 9 }, (_, i) => hollow(ngon(10 + i * 10, 10, 4, i === 4 ? 7 : 5.2), 1.4)))],
];

// ---------- Ornamente ----------

function fleurDeLis() {
  let s = U(leaf([50, 72], [50, 4], 22));
  const side = taper(cr([[52, 66], [66, 56], [80, 40], [86, 22], [78, 14], [70, 22], [74, 34]], false), 12, 2);
  s = U(s, side, flipX(side));
  s = U(s, rect(28, 62, 44, 8, 2));
  s = U(s, blob([[44, 70], [56, 70], [62, 84], [56, 96], [50, 90], [44, 96], [38, 84]], 0.4));
  s = D(s, stroke([[24, 66], [76, 66]], 1.4), stroke([[24, 71], [76, 71]], 1.4));
  return s;
}
function swirl() {
  return taper(spiralPts(50, 50, 2, 44, 2.25, 0).reverse(), 7, 1);
}
function triskele() {
  const arm = taper([[50, 52], ...spiralPts(50, 33, 16, 3, 1.3, 90)], 6, 2);
  return U(polar(arm, 3, 50, 52), circle(50, 52, 4));
}
function triquetra() {
  const L = (rot: number) => T(D(I(circle(40, 50, 30), circle(60, 50, 30)), I(circle(42.5, 50, 26), circle(57.5, 50, 26))), { rot, cx: 50, cy: 56 });
  let s = U(L(0), L(120), L(240));
  s = U(s, ring(50, 56, 22, 3.4));
  return s;
}
function quatrefoil() {
  const f = U(circle(50, 30, 20), circle(70, 50, 20), circle(50, 70, 20), circle(30, 50, 20));
  return U(hollow(f, 4), hollow(off(f, -8), 2), ngon(50, 50, 4, 8));
}
function trefoil() {
  const f = U(circle(50, 32, 20), circle(34, 60, 20), circle(66, 60, 20), circle(50, 52, 14));
  return U(hollow(f, 4), circle(50, 50, 6));
}
function damask() {
  let s = leaf([50, 90], [50, 8], 26);
  s = D(s, leaf([50, 82], [50, 20], 14));
  s = U(s, leaf([50, 76], [50, 30], 7));
  const side = U(taper(cr([[50, 74], [30, 66], [18, 50], [22, 34], [32, 30], [36, 38], [30, 42]], false), 4, 1.5), leaf([30, 58], [10, 72], 8, -2));
  s = U(s, side, flipX(side));
  s = U(s, circle(50, 96, 3));
  return s;
}
function sunOrnament() {
  const rays = polar(leaf([50, 50], [50, 2], 9), 16);
  return U(D(rays, circle(50, 50, 22)), ring(50, 50, 18, 3), circle(50, 50, 9));
}
function compassRose() {
  let s = U(star(50, 50, 4, 48, 9), T(star(50, 50, 4, 30, 7), { rot: 45, cx: 50, cy: 50 }));
  s = D(s, ...[0, 90, 180, 270].map((a) => T(poly([[50, 50], [50, 2], [59, 41]]), { rot: a, cx: 50, cy: 50 })));
  s = U(s, ...[0, 90, 180, 270].map((a) => T(hollow(poly([[50, 50], [50, 4], [57.5, 42]]), 1.4), { rot: a, cx: 50, cy: 50 })));
  return U(s, ring(50, 50, 36, 1.8), circle(50, 50, 4));
}
function heartFlourish() {
  const h = hollow(heart(50, 46, 44), 3.4);
  const tail = taper(cr([[50, 70], [40, 80], [24, 82], [12, 74], [14, 64], [22, 64]], false), 3, 1);
  return U(h, tail, flipX(tail));
}
function star8() {
  const sq = rect(18, 18, 64, 64);
  const inner = rect(26, 26, 48, 48);
  const s = D(U(sq, T(sq, { rot: 45, cx: 50, cy: 50 })), U(inner, T(inner, { rot: 45, cx: 50, cy: 50 })));
  return U(s, ring(50, 50, 12, 3));
}
function flowerOfLife() {
  let s: Shape = [];
  const cs: Pt[] = [[50, 50]];
  for (let i = 0; i < 6; i++) cs.push([50 + 16 * Math.cos(rad(i * 60)), 50 + 16 * Math.sin(rad(i * 60))]);
  for (let i = 0; i < 6; i++) cs.push([50 + 32 * Math.cos(rad(i * 60)), 50 + 32 * Math.sin(rad(i * 60))], [50 + 27.7 * Math.cos(rad(i * 60 + 30)), 50 + 27.7 * Math.sin(rad(i * 60 + 30))]);
  for (const [x, y] of cs) s = U(s, edge(circle(x, y, 16), 1.6));
  s = I(s, circle(50, 50, 48.2));
  return U(s, ring(50, 50, 48, 2.4));
}
function seedOfLife() {
  let s: Shape = edge(circle(50, 50, 20), 2);
  for (let i = 0; i < 6; i++) s = U(s, edge(circle(50 + 20 * Math.cos(rad(i * 60)), 50 + 20 * Math.sin(rad(i * 60)), 20), 2));
  return U(s, ring(50, 50, 40, 2.4));
}
function paisley() {
  const outer = blob([[40, 96], [24, 84], [18, 62], [26, 40], [46, 26], [64, 14], [80, 4], [78, 22], [76, 44], [72, 70], [60, 88]], 0.5);
  let s = hollow(outer, 3);
  const inner = off(outer, -9);
  s = U(s, hollow(inner, 2), circle(46, 70, 7));
  for (const { p } of spread(cr(off2pts(outer, 4.5), true), 22)) s = U(s, circle(p[0], p[1], 1.2));
  return s;
}
function off2pts(s: Shape, d: number): Pt[] {
  const o = off(s, d);
  return o[0].map(({ X, Y }) => [X / 1000, Y / 1000] as Pt);
}
function maltese() {
  const arm = poly([[50, 50], [38, 6], [50, 16], [62, 6]]);
  return D(polar(arm, 4), circle(50, 50, 4));
}
function knot() {
  // Flechtknoten: zwei um 45° gedrehte Quadratschlaufen, abwechselnd oben und unten
  const w = 5;
  const a = hollow(rect(22, 22, 56, 56), w);
  const b = T(a, { rot: 45, cx: 50, cy: 50 });
  let s = U(a, b);
  for (let i = 0; i < 8; i++) {
    const ang = i * 45 + 22.5;
    const top = I(i % 2 ? a : b, circle(50 + 33 * Math.cos(rad(ang)), 50 + 33 * Math.sin(rad(ang)), 7));
    s = U(D(s, off(top, 1.4)), top);
  }
  return U(s, ring(50, 50, 9, w), D(polar(stroke([[50, 41], [50, 22]], w), 4, 50, 50, 45), circle(50, 50, 9)));
}
function lotusOrnament() {
  let s = leaf([50, 80], [50, 14], 24);
  s = D(s, leaf([50, 74], [50, 26], 12));
  const side = U(leaf([46, 82], [16, 40], 20, -6));
  s = U(s, D(side, off(leaf([50, 80], [50, 14], 24), 1.4)), D(flipX(side), off(leaf([50, 80], [50, 14], 24), 1.4)));
  s = U(s, stroke(cr([[10, 86], [30, 82], [50, 88], [70, 82], [90, 86]], false), 3));
  return s;
}
function teardropOrnament() {
  let s = hollow(round(U(circle(50, 62, 30), poly([[22, 52], [50, 4], [78, 52]])), 2), 3);
  s = U(s, hollow(round(U(circle(50, 62, 18), poly([[33, 56], [50, 24], [67, 56]])), 1.5), 2), circle(50, 64, 6));
  return s;
}
function tribal() {
  const half = taper([[50, 94], [44, 80], [30, 66], [18, 48], [18, 30], [28, 18], [40, 20], [42, 32], [34, 36]], 4.5, 1.5);
  return U(half, flipX(half), leaf([50, 88], [50, 40], 12), circle(50, 30, 4));
}
function scrollS() {
  const a = spiralPts(32, 36, 2, 18, -1.25, 540);
  const b = a.map(([x, y]): Pt => [100 - x, 100 - y]).reverse();
  return U(stroke([...a, ...b], 4, 'round', true), circle(32, 36, 3.4), circle(68, 64, 3.4));
}

const ORNAMENTS: [string, string, string, string, () => Shape, number?][] = [
  ['orn-fleur-de-lis', 'Lilie (Fleur-de-Lis)', 'Fleur-de-lis', 'Lilie/lily, Heraldik/heraldry, Frankreich/france', fleurDeLis],
  ['orn-swirl', 'Spirale', 'Swirl', 'Spirale/spiral, Schnörkel/swirl', swirl],
  ['orn-triskele', 'Triskele', 'Triskele', 'keltisch/celtic, Spirale/spiral', triskele],
  ['orn-triquetra', 'Dreifachknoten', 'Triquetra', 'keltisch/celtic, Knoten/knot', triquetra],
  ['orn-quatrefoil', 'Vierpass', 'Quatrefoil', 'gotisch/gothic, Maßwerk/tracery', quatrefoil],
  ['orn-trefoil', 'Dreipass', 'Trefoil', 'gotisch/gothic, Maßwerk/tracery', trefoil],
  ['orn-damask', 'Damastmotiv', 'Damask motif', 'Damast/damask, barock/baroque', damask],
  ['orn-sun', 'Sonnenornament', 'Sun ornament', 'Sonne/sun, Strahlen/rays', sunOrnament],
  ['orn-compass', 'Windrose', 'Compass rose', 'Kompass/compass, Navigation/navigation, maritim/nautical', compassRose],
  ['orn-heart-flourish', 'Herz mit Schwung', 'Heart flourish', 'Herz/heart, Schnörkel/flourish, Hochzeit/wedding', heartFlourish],
  ['orn-octagram', 'Achtstern', 'Eight-pointed star', 'Stern/star, orientalisch/oriental', star8],
  ['orn-flower-of-life', 'Blume des Lebens', 'Flower of life', 'Geometrie/geometry, Kreise/circles', flowerOfLife],
  ['orn-seed-of-life', 'Saat des Lebens', 'Seed of life', 'Geometrie/geometry, Kreise/circles', seedOfLife],
  ['orn-paisley', 'Paisley', 'Paisley', 'Paisley/paisley, Boho/boho, Tropfen/teardrop', paisley],
  ['orn-maltese', 'Tatzenkreuz', 'Cross pattée', 'Kreuz/cross, Heraldik/heraldry', maltese],
  ['orn-knot', 'Flechtknoten', 'Woven knot', 'Knoten/knot, keltisch/celtic, geflochten/woven', knot],
  ['orn-lotus', 'Lotusornament', 'Lotus ornament', 'Lotus/lotus, Yoga/yoga', lotusOrnament],
  ['orn-teardrop', 'Tropfenornament', 'Teardrop ornament', 'Tropfen/drop, Anhänger/pendant', teardropOrnament],
  ['orn-lyre', 'Lyra-Schnörkel', 'Lyre scroll', 'Schnörkel/scroll, symmetrisch/symmetric', tribal],
  ['orn-scroll', 'Doppelspirale', 'Double scroll', 'Spirale/spiral, Schnörkel/scroll', scrollS],
];

// ---------- Rosetten (Mandalas) ----------

interface Layer {
  kind: 'petals' | 'dots' | 'ring' | 'scallop' | 'tri' | 'leaves' | 'rays' | 'drops' | 'hollowPetals' | 'circles';
  r0: number;
  r1: number;
  n: number;
  w?: number;
  rot?: number;
}
function layer(L: Layer): Shape {
  const { r0, r1, n, w = 1, rot = 0 } = L;
  const at = (s: Shape) => polar(s, n, 50, 50, rot);
  const mid = (r0 + r1) / 2;
  const span = ((2 * Math.PI * mid) / n) * w;
  switch (L.kind) {
    case 'petals':
      return at(leaf([50, 50 - r0], [50, 50 - r1], span * 0.9));
    case 'hollowPetals':
      return at(hollow(leaf([50, 50 - r0], [50, 50 - r1], span * 0.95), 1.6));
    case 'leaves':
      return at(D(leaf([50, 50 - r0], [50, 50 - r1], span * 0.9), stroke([[50, 50 - r0 - 1], [50, 50 - r1 + 3]], 1.1)));
    case 'dots':
      return at(circle(50, 50 - mid, Math.min((r1 - r0) / 2, span / 2.4)));
    case 'circles':
      return at(ring(50, 50 - mid, Math.min((r1 - r0) / 2, span / 2.2) - 0.8, 1.4));
    case 'ring':
      return ring(50, 50, mid, r1 - r0);
    case 'scallop': {
      const s = U(...Array.from({ length: n }, (_, i) => circle(50 + r0 * Math.cos(rad((360 * i) / n + rot)), 50 + r0 * Math.sin(rad((360 * i) / n + rot)), r1 - r0)));
      return D(U(s, circle(50, 50, r0)), circle(50, 50, r0 - 1.6));
    }
    case 'tri':
      return at(poly([[50 - span / 2, 50 - r0], [50 + span / 2, 50 - r0], [50, 50 - r1]]));
    case 'rays':
      return at(stroke([[50, 50 - r0], [50, 50 - r1]], w * 1.4));
    case 'drops':
      return at(U(circle(50, 50 - r0 - (r1 - r0) * 0.3, Math.min(span / 2.2, (r1 - r0) * 0.3)), poly([[50 - Math.min(span / 2.2, (r1 - r0) * 0.3), 50 - r0 - (r1 - r0) * 0.3], [50, 50 - r1], [50 + Math.min(span / 2.2, (r1 - r0) * 0.3), 50 - r0 - (r1 - r0) * 0.3]])));
  }
}
function mandala(layers: Layer[], center = 6): () => Shape {
  return () => {
    let s: Shape = center ? circle(50, 50, center) : [];
    for (const L of layers) s = U(D(s, off(layer(L), 1.2)), layer(L));
    return s;
  };
}
const M = (kind: Layer['kind'], r0: number, r1: number, n: number, w?: number, rot?: number): Layer => ({ kind, r0, r1, n, w, rot });
const MANDALAS: [string, string, string, string, () => Shape, number?][] = [
  ['rosette-1', 'Rosette Blüte', 'Blossom rosette', 'Blüte/blossom', mandala([M('petals', 8, 24, 8), M('ring', 26, 28, 1), M('petals', 29, 46, 16), M('dots', 46, 50, 16, 1, 11.25)])],
  ['rosette-2', 'Rosette Sonne', 'Sun rosette', 'Sonne/sun, Strahlen/rays', mandala([M('ring', 9, 12, 1), M('tri', 13, 30, 12), M('ring', 31, 33, 1), M('rays', 35, 48, 24, 1.2), M('dots', 46, 50, 24, 1, 7.5)], 7)],
  ['rosette-3', 'Rosette Blätter', 'Leaf rosette', 'Blätter/leaves', mandala([M('leaves', 8, 30, 6), M('leaves', 14, 38, 6, 1, 30), M('ring', 40, 42, 1), M('scallop', 44, 49, 24)], 5)],
  ['rosette-4', 'Rosette Punkte', 'Dot rosette', 'Punkte/dots', mandala([M('dots', 8, 14, 8), M('dots', 16, 22, 12, 1, 15), M('dots', 24, 30, 16), M('dots', 32, 38, 20, 1, 9), M('dots', 40, 47, 24)], 4)],
  ['rosette-5', 'Rosette Lotus', 'Lotus rosette', 'Lotus/lotus, Yoga/yoga', mandala([M('hollowPetals', 8, 26, 8), M('hollowPetals', 12, 36, 8, 1, 22.5), M('petals', 36, 48, 16), M('dots', 26, 30, 8, 1, 22.5)], 6)],
  ['rosette-6', 'Rosette Stern', 'Star rosette', 'Stern/star', mandala([M('tri', 6, 26, 8), M('tri', 6, 18, 8, 1, 22.5), M('ring', 28, 30, 1), M('tri', 31, 48, 16), M('dots', 40, 44, 16, 1, 11.25)], 0)],
  ['rosette-7', 'Rosette Ringe', 'Ring rosette', 'Kreise/circles', mandala([M('circles', 8, 20, 6), M('ring', 21, 23, 1), M('circles', 24, 36, 12), M('ring', 37, 39, 1), M('circles', 40, 49, 18, 1, 10)], 5)],
  ['rosette-8', 'Rosette Tropfen', 'Drop rosette', 'Tropfen/drops', mandala([M('drops', 6, 22, 8), M('ring', 23, 25, 1), M('drops', 26, 44, 16, 1, 11.25), M('dots', 45, 49, 32)], 4)],
  ['rosette-9', 'Rosette Wellen', 'Scallop rosette', 'Bogen/scallop', mandala([M('scallop', 14, 19, 12), M('scallop', 26, 31, 18, 1, 10), M('scallop', 38, 44, 24)], 8)],
  ['rosette-10', 'Rosette Dahlie', 'Dahlia rosette', 'Dahlie/dahlia, Blume/flower', mandala([M('petals', 6, 18, 10), M('petals', 10, 30, 10, 1, 18), M('petals', 18, 40, 20), M('petals', 26, 49, 20, 1, 9)], 5)],
  ['rosette-11', 'Rosette Kompass', 'Compass rosette', 'Kompass/compass', mandala([M('tri', 4, 48, 4), M('tri', 4, 34, 4, 1, 45), M('tri', 4, 22, 8, 1, 22.5), M('ring', 38, 40, 1)], 0)],
  ['rosette-12', 'Rosette Spitze', 'Lace rosette', 'Spitze/lace', mandala([M('circles', 6, 14, 6), M('hollowPetals', 15, 30, 12), M('ring', 31, 33, 1), M('circles', 34, 41, 24), M('scallop', 44, 48, 36)], 3)],
  ['rosette-13', 'Rosette Feuer', 'Fire rosette', 'Feuer/fire, Flamme/flame', mandala([M('drops', 8, 30, 12), M('drops', 18, 46, 12, 1, 15), M('dots', 44, 49, 24, 1, 7.5)], 6)],
  ['rosette-14', 'Rosette Sternblüte', 'Star blossom rosette', 'Stern/star, Blüte/blossom', mandala([M('petals', 6, 26, 5), M('petals', 6, 18, 5, 1, 36), M('ring', 28, 30, 1), M('petals', 31, 49, 10), M('dots', 36, 42, 10, 1, 18)], 4)],
  ['rosette-15', 'Rosette Strahlenkranz', 'Ray wreath rosette', 'Strahlen/rays', mandala([M('ring', 10, 14, 1), M('rays', 15, 32, 36, 0.9), M('ring', 33, 35, 1), M('rays', 36, 49, 48, 0.9)], 8)],
  ['rosette-16', 'Rosette Kristall', 'Crystal rosette', 'Kristall/crystal, Schnee/snow', mandala([M('tri', 6, 30, 6), M('tri', 20, 44, 6, 1, 30), M('dots', 30, 36, 6, 1, 30), M('tri', 36, 49, 12)], 0)],
  ['rosette-17', 'Rosette Margerite', 'Marguerite rosette', 'Blume/flower, Margerite/marguerite', mandala([M('ring', 10, 13, 1), M('hollowPetals', 14, 46, 18)], 8)],
  ['rosette-18', 'Rosette Ornament', 'Ornate rosette', 'verziert/ornate', mandala([M('petals', 6, 16, 8), M('dots', 17, 21, 8, 1, 22.5), M('hollowPetals', 18, 36, 16), M('tri', 37, 44, 32), M('ring', 45, 47, 1)], 4)],
  ['rosette-19', 'Rosette Wirbel', 'Whirl rosette', 'Wirbel/whirl', () => {
    const arm = taper(spiralPts(50, 50, 4, 46, 0.5, -90), 1.5, 7);
    return U(polar(arm, 12), ring(50, 50, 6, 3));
  }],
  ['rosette-20', 'Rosette Guilloché', 'Guilloché rosette', 'Guilloché/guilloche, Linien/lines', () => {
    let s: Shape = [];
    for (let i = 0; i < 12; i++) s = U(s, T(outline(arcPts(50, 50 - 20, 14, 0, 360, 26, 90).slice(0, -1), 1.2, true, 'round'), { rot: i * 30, cx: 50, cy: 50 }));
    return U(s, ring(50, 50, 48, 1.8));
  }],
];

// ---------- Abzeichen ----------

function sawEdge(n: number, ro: number, ri: number): Shape {
  return star(50, 50, n, ro, ri);
}
function badge(outer: Shape, rings: number[] = [40]): () => Shape {
  return () => {
    let s = D(outer, circle(50, 50, rings[0]));
    for (const r of rings.slice(1)) s = U(s, ring(50, 50, r, 1.4));
    return s;
  };
}
function ribbonTails(): Shape {
  return U(poly([[36, 70], [26, 98], [36, 92], [44, 100], [50, 74]]), poly([[64, 70], [74, 98], [64, 92], [56, 100], [50, 74]]));
}
const BADGES: [string, string, string, string, () => Shape, number?][] = [
  ['badge-seal', 'Siegel gezackt', 'Serrated seal', 'Siegel/seal, Stempel/stamp', badge(sawEdge(32, 49, 44), [38, 34])],
  ['badge-seal-wavy', 'Siegel gewellt', 'Wavy seal', 'Siegel/seal', badge(U(circle(50, 50, 44), polar(circle(50, 6, 5), 20)), [37, 33])],
  ['badge-starburst', 'Sternplakette', 'Starburst badge', 'Stern/star, Angebot/offer', badge(sawEdge(16, 49, 38), [32])],
  ['badge-rosette-award', 'Siegerschleife', 'Award rosette', 'Preis/award, Sieger/winner, Schleife/ribbon', () => {
    const r = U(polar(circle(50, 12, 9), 16, 50, 40), circle(50, 40, 30));
    return U(D(over(ribbonTails(), r, 1.6), circle(50, 40, 22)), ring(50, 40, 19, 1.4));
  }],
  ['badge-medal', 'Medaille', 'Medal', 'Medaille/medal, Sport/sport, Preis/award', () => {
    let s = U(poly([[30, 2], [44, 2], [56, 40], [42, 40]]), poly([[70, 2], [56, 2], [44, 40], [58, 40]]));
    s = over(s, circle(50, 64, 30), 1.6);
    s = D(s, ring(50, 64, 22, 1.6));
    return U(s, star(50, 65, 5, 14, 6));
  }],
  ['badge-shield', 'Schildabzeichen', 'Shield badge', 'Schild/shield, Wappen/crest', () => {
    const sh = poly(shieldPts());
    return U(D(sh, off(sh, -5)), hollow(off(sh, -8), 1.4));
  }],
  ['badge-hexagon', 'Sechseckplakette', 'Hexagon badge', 'Sechseck/hexagon', () => U(D(round(ngon(50, 50, 6, 48, 0), 3), ngon(50, 50, 6, 42, 0)), hollow(ngon(50, 50, 6, 39, 0), 1.4))],
  ['badge-stamp', 'Briefmarkenrand', 'Postage stamp', 'Briefmarke/stamp, Post/mail', () => {
    let s = rect(2, 2, 76, 96);
    for (const { p } of spread(rrPts(2, 2, 76, 96, 0), 36)) s = D(s, circle(p[0], p[1], 2.4));
    return D(s, rect(10, 10, 60, 80));
  }],
  ['badge-sheriff', 'Sheriffstern', 'Sheriff star', 'Stern/star, Western/western', () => {
    let s = star(50, 52, 6, 48, 28, -90);
    s = U(s, ...Array.from({ length: 6 }, (_, i) => circle(50 + 48 * Math.cos(rad(-90 + i * 60)), 52 + 48 * Math.sin(rad(-90 + i * 60)), 5)));
    return U(D(s, circle(50, 52, 22)), ring(50, 52, 18, 1.4));
  }],
  ['badge-laurel', 'Lorbeerkranz', 'Laurel wreath', 'Lorbeer/laurel, Kranz/wreath, Sieger/winner', () => {
    let half: Shape = arc(50, 50, 38, 100, 250, 2);
    for (let a = 110; a <= 245; a += 15) {
      const x = 50 + 38 * Math.cos(rad(a)),
        y = 50 + 38 * Math.sin(rad(a));
      half = U(half, leaf([x, y], [x + 13 * Math.cos(rad(a + 70)), y + 13 * Math.sin(rad(a + 70))], 6.5, 1), leaf([x, y], [x + 12 * Math.cos(rad(a - 120)), y + 12 * Math.sin(rad(a - 120))], 6, -1));
    }
    return U(half, flipX(half));
  }],
  ['badge-circle-ribbon', 'Kreis mit Band', 'Circle with ribbon', 'Band/ribbon, Kreis/circle', () => {
    const c = U(D(circle(50, 44, 40), circle(50, 44, 35)), ring(50, 44, 31, 1.2));
    const band = U(rect(12, 54, 76, 16), poly([[12, 58], [0, 58], [6, 64], [0, 72], [14, 72]]), poly([[88, 58], [100, 58], [94, 64], [100, 72], [86, 72]]));
    return U(D(c, off(band, 1.4)), hollow(band, 2.2));
  }],
  ['badge-ticket-circle', 'Ticketkreis', 'Ticket circle', 'Kreis/circle, Gutschein/voucher', badge(D(circle(50, 50, 48), polar(circle(50, 2, 4), 24)), [38, 35])],
  ['badge-arch', 'Bogenplakette', 'Arched plaque', 'Bogen/arch, Fenster/window', () => {
    const a = poly([...arcPts(50, 40, 38, 180, 360), [88, 96], [12, 96]]);
    return U(D(a, off(a, -5)), hollow(off(a, -8), 1.4));
  }],
  ['badge-octagon', 'Achteckplakette', 'Octagon badge', 'Achteck/octagon', () => U(D(ngon(50, 50, 8, 49, -67.5), ngon(50, 50, 8, 43, -67.5)), hollow(ngon(50, 50, 8, 40, -67.5), 1.4))],
  ['badge-crest', 'Wappen mit Krone', 'Crowned crest', 'Krone/crown, Wappen/crest', () => {
    const sh = T(poly(shieldPts()), { sx: 0.8, sy: 0.75, cx: 50, cy: 100 });
    const crown = round(poly([[28, 28], [26, 6], [38, 16], [50, 2], [62, 16], [74, 6], [72, 28]]), 0.6);
    return U(hollow(sh, 4), crown);
  }],
  ['badge-sun-seal', 'Sonnensiegel', 'Sun seal', 'Sonne/sun, Siegel/seal', badge(U(circle(50, 50, 40), polar(poly([[46, 10], [50, 1], [54, 10]]), 24)), [34, 30])],
  ['badge-heart', 'Herzplakette', 'Heart badge', 'Herz/heart, Liebe/love', () => U(D(heart(50, 50, 96), off(heart(50, 50, 96), -5)), hollow(off(heart(50, 50, 96), -8), 1.4))],
  ['badge-wreath-star', 'Kranz mit Stern', 'Wreath with star', 'Stern/star, Kranz/wreath', () => {
    let half: Shape = arc(50, 52, 40, 110, 235, 1.8);
    for (let a = 118; a <= 230; a += 14) {
      const x = 50 + 40 * Math.cos(rad(a)),
        y = 52 + 40 * Math.sin(rad(a));
      half = U(half, ellipse(x, y, 6, 3, a + 60));
    }
    return U(half, flipX(half), star(50, 50, 5, 22, 9));
  }],
  ['badge-pennant-shield', 'Wimpelschild', 'Pennant badge', 'Wimpel/pennant', () => U(D(poly([[10, 4], [90, 4], [90, 70], [50, 96], [10, 70]]), poly([[16, 10], [84, 10], [84, 67], [50, 89], [16, 67]])), hollow(poly([[22, 16], [78, 16], [78, 63], [50, 81], [22, 63]]), 1.4))],
  ['badge-gear', 'Zahnradplakette', 'Gear badge', 'Zahnrad/gear, Technik/engineering', () => U(D(U(circle(50, 50, 40), polar(rect(44, 2, 12, 12, 1.5), 16)), circle(50, 50, 33)), ring(50, 50, 30, 1.4))],
];

// ---------- Banner & Schilder ----------

function scrollBanner(): Shape {
  const main = rect(16, 10, 68, 26);
  const end = (flip: boolean) => {
    const e = U(poly([[2, 18], [18, 18], [18, 44], [2, 44], [8, 31]]));
    return flip ? flipX(e) : e;
  };
  let s = U(D(U(end(false), end(true)), off(main, 1.6)), main);
  s = U(s, poly([[16, 36], [18, 44], [18, 36]]), poly([[84, 36], [82, 44], [82, 36]]));
  return s;
}
function bubble(kind: 'round' | 'rect' | 'cloud' | 'thought'): Shape {
  if (kind === 'round') return U(ellipse(50, 40, 46, 34), poly([[26, 62], [14, 92], [44, 72]]));
  if (kind === 'rect') return U(rect(4, 4, 92, 64, 10), poly([[20, 66], [16, 94], [42, 66]]));
  if (kind === 'cloud') {
    const base = rect(14, 14, 72, 44, 20);
    return U(base, ...spread(rrPts(14, 14, 72, 44, 20), 12).map(({ p }) => circle(p[0], p[1], 10)), poly([[30, 62], [20, 90], [46, 64]]));
  }
  return U(ellipse(54, 38, 42, 30), circle(22, 76, 7), circle(10, 92, 4));
}
const BANNERS: [string, string, string, string, () => Shape, number?][] = [
  ['banner-scroll', 'Spruchband', 'Ribbon banner', 'Band/ribbon, Spruchband/scroll banner', () => hollow(scrollBanner(), 2)],
  ['banner-scroll-filled', 'Spruchband gefüllt', 'Solid ribbon banner', 'Band/ribbon, Spruchband/scroll banner', () => D(scrollBanner(), rect(20, 14, 60, 18))],
  ['banner-curved', 'Gebogenes Band', 'Curved ribbon', 'Band/ribbon, gebogen/curved', () => {
    const top = arcPts(50, 120, 100, 238, 302);
    const bot = arcPts(50, 120, 76, 302, 238);
    const main = poly([...top, ...bot]);
    const endL = poly([[3, 40], [22, 42], [20, 68], [4, 70], [12, 54]]);
    let s = U(D(U(endL, flipX(endL)), off(main, 1.6)), main);
    return hollow(s, 2);
  }],
  ['banner-flag', 'Fahnenband', 'Flag banner', 'Fahne/flag, Band/ribbon', () => hollow(poly([[2, 4], [98, 4], [88, 20], [98, 36], [2, 36], [12, 20]]), 2)],
  ['banner-pennant', 'Wimpel', 'Pennant', 'Wimpel/pennant, Fahne/flag', () => U(hollow(poly([[6, 4], [96, 26], [6, 48]]), 2.2), rect(0, 0, 6, 70, 2))],
  ['banner-tag', 'Geschenkanhänger', 'Gift tag', 'Anhänger/tag, Geschenk/gift, Etikett/label', () => {
    const tag = poly([[22, 4], [96, 4], [96, 56], [22, 56], [2, 30]]);
    return U(hollow(round(tag, 3), 2.2), ring(18, 30, 4.5, 2));
  }],
  ['banner-label', 'Etikett', 'Label', 'Etikett/label, Schild/sign', () => {
    const lb = D(rect(2, 2, 96, 44, 4), circle(2, 24, 10), circle(98, 24, 10));
    return U(hollow(lb, 2.2), hollow(off(lb, -4), 1.2));
  }],
  ['banner-plaque', 'Plakette', 'Plaque', 'Schild/sign, Türschild/door sign', () => {
    const p = D(rect(2, 2, 96, 56, 2), circle(2, 2, 8), circle(98, 2, 8), circle(2, 58, 8), circle(98, 58, 8));
    return U(hollow(p, 2.4), ...([[14, 14], [86, 14], [14, 46], [86, 46]] as Pt[]).map(([x, y]) => ring(x, y, 2.4, 1.4)));
  }],
  ['banner-arrow-sign', 'Wegweiser', 'Signpost arrow', 'Pfeil/arrow, Wegweiser/signpost', () => U(hollow(poly([[2, 4], [80, 4], [98, 24], [80, 44], [2, 44]]), 2.4), ring(12, 24, 3, 1.4))],
  ['banner-bubble-round', 'Sprechblase rund', 'Round speech bubble', 'Sprechblase/speech bubble, Comic/comic', () => hollow(bubble('round'), 2.4)],
  ['banner-bubble-rect', 'Sprechblase eckig', 'Square speech bubble', 'Sprechblase/speech bubble, Chat/chat', () => hollow(bubble('rect'), 2.4)],
  ['banner-bubble-cloud', 'Sprechblase Wolke', 'Cloud speech bubble', 'Sprechblase/speech bubble, Wolke/cloud', () => hollow(round(bubble('cloud'), 1), 2.4)],
  ['banner-bubble-thought', 'Gedankenblase', 'Thought bubble', 'Gedanke/thought, Comic/comic', () => hollow(bubble('thought'), 2.4)],
  ['banner-bookmark', 'Lesezeichen', 'Bookmark', 'Lesezeichen/bookmark, Buch/book', () => U(hollow(poly([[4, 10], [36, 10], [36, 96], [20, 82], [4, 96]]), 2.4), ring(20, 22, 4, 1.8))],
  ['banner-sign-hanging', 'Hängeschild', 'Hanging sign', 'Schild/sign, Tür/door', () => {
    let s = hollow(rect(4, 34, 92, 46, 6), 2.4);
    s = U(s, stroke([[22, 36], [50, 6], [78, 36]], 1.8), circle(50, 6, 3));
    return s;
  }],
  ['banner-badge-ribbon', 'Eckband', 'Corner ribbon', 'Band/ribbon, Ecke/corner, neu/new', () => I(poly([[30, 0], [52, 0], [100, 48], [100, 70]]), rect(0, 0, 100, 100))],
  ['banner-tab', 'Reiter-Etikett', 'Tab label', 'Etikett/label, Reiter/tab, Ordner/folder', () => hollow(U(rect(2, 14, 96, 44, 6), rect(8, 2, 34, 18, 6)), 2.4)],
  ['banner-oval-label', 'Ovales Etikett', 'Oval label', 'Etikett/label, oval/oval', () => U(hollow(ellipse(50, 30, 48, 28), 2.4), hollow(ellipse(50, 30, 42, 22), 1.2))],
  ['banner-name-tag', 'Namensschild', 'Name tag', 'Name/name, Schild/badge', () => U(hollow(rect(2, 2, 96, 56, 8), 2.4), rect(2, 2, 96, 16, 8), rect(2, 10, 96, 8))],
  ['banner-door-hanger', 'Türhänger', 'Door hanger', 'Tür/door, Schild/sign, Hotel/hotel', () => {
    let s = rect(4, 4, 44, 96, 6);
    s = D(s, circle(26, 20, 9), rect(25, 0, 2, 20));
    return hollow(s, 2.2);
  }],
];

// ---------- Muster ----------

const TILE = rect(0, 0, 100, 100);
const tile = (s: Shape, border = true) => (border ? U(I(s, TILE), hollow(TILE, 1.6)) : I(s, TILE));
const PATTERNS: [string, string, string, string, () => Shape, number?][] = [
  ['pattern-honeycomb', 'Wabenmuster', 'Honeycomb', 'Waben/honeycomb, Sechseck/hexagon, Biene/bee', () => {
    let s: Shape = [];
    const r = 10;
    for (let row2 = -1; row2 < 8; row2++) for (let col = -1; col < 8; col++) s = U(s, edge(ngon(col * r * 1.732 + (row2 % 2 ? r * 0.866 : 0), row2 * r * 1.5, 6, r, -90), 1.4));
    return tile(s);
  }],
  ['pattern-grid', 'Karomuster', 'Grid', 'Karo/check, Gitter/grid', () => tile(U(...Array.from({ length: 11 }, (_, i) => U(stroke([[i * 10, 0], [i * 10, 100]], 1.2), stroke([[0, i * 10], [100, i * 10]], 1.2)))))],
  ['pattern-diagonal', 'Rautengitter', 'Diamond lattice', 'Raute/diamond, Gitter/lattice', () => tile(U(...Array.from({ length: 21 }, (_, i) => U(stroke([[i * 10 - 100, 0], [i * 10, 100]], 1.4), stroke([[i * 10, 0], [i * 10 - 100, 100]], 1.4)))))],
  ['pattern-dots', 'Punktmuster', 'Polka dots', 'Punkte/dots, Tupfen/polka', () => {
    let s: Shape = [];
    for (let y = 0; y <= 100; y += 12.5) for (let x = (y / 12.5) % 2 ? 6.25 : 0; x <= 100; x += 12.5) s = U(s, circle(x, y, 3));
    return tile(s);
  }],
  ['pattern-waves', 'Wellenmuster', 'Waves', 'Welle/wave, Wasser/water', () => tile(U(...Array.from({ length: 12 }, (_, i) => stroke(waveLine(i * 9, 3, 25, 0, 0, 100), 1.6))))],
  ['pattern-herringbone', 'Fischgrät', 'Herringbone', 'Fischgrät/herringbone, Parkett/parquet', () => {
    let s: Shape = [];
    for (let x = 0; x < 100; x += 20) for (let y = -20; y < 120; y += 10) s = U(s, stroke([[x, y], [x + 10, y + 10]], 1.4), stroke([[x + 10, y + 10], [x + 20, y]], 1.4));
    return tile(s);
  }],
  ['pattern-chevron', 'Zickzackmuster', 'Chevron', 'Zickzack/zigzag, Chevron/chevron', () => tile(U(...Array.from({ length: 12 }, (_, i) => stroke(Array.from({ length: 11 }, (_, k): Pt => [k * 10, i * 9 + (k % 2 ? 6 : 0)]), 2.4, 'butt', false, 'miter'))))],
  ['pattern-scales', 'Schuppenmuster', 'Scales', 'Schuppen/scales, Fisch/fish, Drache/dragon', () => {
    let s: Shape = [];
    for (let y = 0; y <= 110; y += 8) for (let x = (y / 8) % 2 ? 8 : 0; x <= 110; x += 16) s = U(s, arc(x, y, 8, 0, 180, 1.4));
    return tile(s);
  }],
  ['pattern-basket', 'Flechtmuster', 'Basketweave', 'Flechten/weave, Korb/basket', () => {
    let s: Shape = [];
    for (let y = 0; y < 100; y += 20) for (let x = 0; x < 100; x += 20) {
      const h = ((x + y) / 20) % 2 === 0;
      for (let k = 0; k < 3; k++) s = U(s, h ? rect(x + 1, y + 1 + k * 6.3, 18, 5, 1) : rect(x + 1 + k * 6.3, y + 1, 5, 18, 1));
    }
    return tile(s);
  }],
  ['pattern-stars', 'Sternenmuster', 'Stars', 'Stern/star, Himmel/sky', () => {
    let s: Shape = [];
    for (let y = 10; y < 100; y += 20) for (let x = (y / 20) % 2 < 1 ? 10 : 20; x < 100; x += 20) s = U(s, star(x, y, 5, 5.5, 2.3));
    return tile(s);
  }],
  ['pattern-crosses', 'Kreuzmuster', 'Crosses', 'Kreuz/cross, Plus/plus', () => {
    let s: Shape = [];
    for (let y = 10; y < 100; y += 20) for (let x = 10; x < 100; x += 20) s = U(s, rect(x - 5, y - 1.5, 10, 3), rect(x - 1.5, y - 5, 3, 10));
    return tile(s);
  }],
  ['pattern-quatrefoil', 'Vierpassmuster', 'Quatrefoil lattice', 'Vierpass/quatrefoil, marokkanisch/moroccan', () => {
    let s: Shape = [];
    for (let y = 0; y <= 100; y += 25) for (let x = 0; x <= 100; x += 25) s = U(s, edge(U(circle(x, y - 5, 6), circle(x + 5, y, 6), circle(x, y + 5, 6), circle(x - 5, y, 6)), 1.4));
    return tile(s);
  }],
  ['pattern-cubes', 'Würfelmuster', 'Isometric cubes', 'Würfel/cube, isometrisch/isometric, 3D/3d', () => {
    let s: Shape = [];
    const r = 12;
    for (let row2 = -1; row2 < 7; row2++) for (let col = -1; col < 6; col++) {
      const cx = col * r * 1.732 + (row2 % 2 ? r * 0.866 : 0),
        cy = row2 * r * 1.5;
      s = U(s, edge(ngon(cx, cy, 6, r, -90), 1.4), stroke([[cx, cy], [cx, cy + r]], 1.4), stroke([[cx, cy], [cx - r * 0.866, cy - r / 2]], 1.4), stroke([[cx, cy], [cx + r * 0.866, cy - r / 2]], 1.4));
    }
    return tile(s);
  }],
  ['pattern-circles', 'Kreismuster', 'Overlapping circles', 'Kreise/circles, Geometrie/geometry', () => {
    let s: Shape = [];
    for (let y = 0; y <= 100; y += 20) for (let x = 0; x <= 100; x += 20) s = U(s, edge(circle(x, y, 20), 1.2));
    return tile(s);
  }],
  ['pattern-triangles', 'Dreiecksmuster', 'Triangles', 'Dreieck/triangle, geometrisch/geometric', () => {
    let s: Shape = [];
    const h = 8.66 * 2;
    for (let y = 0; y < 110; y += h) s = U(s, stroke([[0, y], [100, y]], 1.2));
    for (let i = -10; i < 20; i++) s = U(s, stroke([[i * 10, 0], [i * 10 + 57.7, 100]], 1.2), stroke([[i * 10, 0], [i * 10 - 57.7, 100]], 1.2));
    return tile(s);
  }],
];

// ---------- Formen ----------

function arrowPts(): Pt[] {
  return [[2, 36], [60, 36], [60, 14], [98, 50], [60, 86], [60, 64], [2, 64]];
}
const SHAPES: [string, string, string, string, () => Shape, number?][] = [
  ['shape-star-5', 'Stern fünfzackig', 'Five-pointed star', 'Stern/star', () => star(50, 54, 5, 50, 20)],
  ['shape-star-6', 'Stern sechszackig', 'Six-pointed star', 'Stern/star', () => star(50, 50, 6, 50, 26)],
  ['shape-star-8', 'Stern achtzackig', 'Eight-pointed star', 'Stern/star', () => round(star(50, 50, 8, 50, 24), 1)],
  ['shape-star-rounded', 'Runder Stern', 'Rounded star', 'Stern/star, rund/rounded', () => round(star(50, 54, 5, 50, 22), 5)],
  ['shape-burst-12', 'Strahlenkranz', 'Starburst', 'Stern/star, Angebot/offer, Sale/sale', () => star(50, 50, 12, 50, 36)],
  ['shape-burst-24', 'Zackenkreis', 'Seal burst', 'Siegel/seal, Angebot/offer', () => star(50, 50, 24, 50, 42)],
  ['shape-heart-outline', 'Herz-Umriss', 'Heart outline', 'Herz/heart, Liebe/love', () => hollow(heart(50, 50, 96), 6)],
  ['shape-arrow', 'Pfeil', 'Arrow', 'Pfeil/arrow, Richtung/direction', () => poly(arrowPts())],
  ['shape-arrow-double', 'Doppelpfeil', 'Double arrow', 'Pfeil/arrow', () => poly([[2, 50], [30, 18], [30, 38], [70, 38], [70, 18], [98, 50], [70, 82], [70, 62], [30, 62], [30, 82]])],
  ['shape-arrow-curved', 'Gebogener Pfeil', 'Curved arrow', 'Pfeil/arrow, zurück/back', () => U(arc(50, 60, 32, 180, 340, 12, 'butt'), poly([[60, 52], [98, 46], [80, 80]]))],
  ['shape-chevron', 'Winkel', 'Chevron', 'Chevron/chevron, Pfeil/arrow', () => poly([[2, 4], [40, 4], [98, 50], [40, 96], [2, 96], [60, 50]])],
  ['shape-plus', 'Plus', 'Plus', 'Plus/plus, Kreuz/cross', () => round(U(rect(36, 4, 28, 92), rect(4, 36, 92, 28)), 1)],
  ['shape-hexagon', 'Sechseck', 'Hexagon', 'Sechseck/hexagon', () => ngon(50, 50, 6, 50, 0)],
  ['shape-triangle', 'Abgerundetes Dreieck', 'Rounded triangle', 'Dreieck/triangle', () => round(ngon(50, 58, 3, 54), 6)],
  ['shape-lens', 'Spitzoval', 'Vesica', 'Linse/lens, Oval/oval', () => I(circle(30, 50, 46), circle(70, 50, 46))],
];

export const ELEMENTS: Def[] = [
  ...group('element', 'frames', FRAMES),
  ...group('element', 'borders', BORDERS.map(([a, b, c, d, f]) => [a, b, c, d, f, 160] as const)),
  ...group('element', 'corners', CORNERS.map(([a, b, c, d, f]) => [a, b, c, d, f, 40] as const)),
  ...group('element', 'dividers', DV.map(([a, b, c, d, f]) => [a, b, c, d, f, 100] as const)),
  ...group('element', 'ornaments', ORNAMENTS.map(([a, b, c, d, f]) => [a, b, c, d, f, 60] as const)),
  ...group('element', 'mandalas', MANDALAS.map(([a, b, c, d, f]) => [a, b, c, d, f, 70] as const)),
  ...group('element', 'badges', BADGES.map(([a, b, c, d, f]) => [a, b, c, d, f, 60] as const)),
  ...group('element', 'banners', BANNERS),
  ...group('element', 'patterns', PATTERNS.map(([a, b, c, d, f]) => [a, b, c, d, f, 80] as const)),
  ...group('element', 'shapes', SHAPES.map(([a, b, c, d, f]) => [a, b, c, d, f, 50] as const)),
];
