// Motive: Fahrzeuge, Haus & Alltag, Werkzeug, Musik & Freizeit, Symbole, Sternzeichen, Weltraum
import { Def, group } from './defs';
import {
  arc, arcPts, blob, circle, cr, D, edge, ellipse, heart, hollow, I, leaf, mirror, ngon, off, over, poly, polar, rect, ring, round, star, stroke,
  sym, T, taper, U, Pt, Shape,
} from './kit';

const wheel = (cx: number, cy: number, r: number) => U(ring(cx, cy, r * 0.72, r * 0.56), circle(cx, cy, r * 0.22));

// ---------- Fahrzeuge ----------

function car() {
  let body = round(U(rect(6, 50, 88, 22, 6), poly([[24, 52], [34, 30], [68, 30], [80, 52]])), 2);
  body = D(body, poly([[30, 50], [37, 35], [49, 35], [49, 50]]), poly([[53, 50], [53, 35], [66, 35], [74, 50]]));
  body = D(body, circle(26, 72, 12), circle(74, 72, 12));
  return U(body, wheel(26, 72, 10), wheel(74, 72, 10), D(rect(86, 56, 6, 4, 1), []));
}

function bicycle() {
  let s = U(ring(22, 66, 16, 3.4), ring(78, 66, 16, 3.4), circle(22, 66, 2.6), circle(78, 66, 2.6));
  s = U(s, stroke([[22, 66], [40, 36], [70, 36], [48, 66], [22, 66]], 3.6, 'round', false, 'round'));
  s = U(s, stroke([[48, 66], [38, 30]], 3.6), stroke([[30, 28], [44, 28]], 4), stroke([[78, 66], [66, 24], [74, 18]], 3.6, 'round'));
  s = U(s, circle(48, 66, 4.5), stroke([[44, 72], [52, 60]], 2));
  return s;
}

function scooter() {
  let s = blob([[16, 66], [22, 54], [40, 52], [56, 56], [62, 44], [70, 30], [76, 30], [72, 46], [80, 60], [84, 70], [70, 70], [28, 70]], 0.4);
  s = U(s, rect(30, 46, 26, 8, 4), stroke([[72, 32], [66, 18], [60, 16]], 3.4, 'round', true), stroke([[62, 16], [76, 14]], 3.4));
  s = D(s, circle(24, 72, 11), circle(80, 72, 11));
  s = U(s, wheel(24, 72, 9.5), wheel(80, 72, 9.5));
  s = D(s, circle(76, 36, 2));
  return s;
}

function truck() {
  let s = U(rect(4, 24, 58, 46, 2), round(poly([[64, 36], [82, 36], [94, 52], [94, 70], [64, 70]]), 2));
  s = D(s, poly([[69, 41], [80, 41], [88, 52], [69, 52]]), stroke([[63, 24], [63, 72]], 1.8));
  s = D(s, circle(20, 74, 11), circle(46, 74, 11), circle(80, 74, 11));
  return U(s, wheel(20, 74, 9.5), wheel(46, 74, 9.5), wheel(80, 74, 9.5));
}

function tractor() {
  let s = U(rect(30, 46, 52, 22, 3), rect(36, 18, 30, 30, 2), rect(74, 34, 5, 14, 1));
  s = D(s, rect(41, 23, 20, 18, 1));
  s = U(s, stroke([[34, 18], [70, 18]], 3));
  s = D(s, circle(32, 70, 22), circle(80, 76, 14));
  s = U(s, wheel(32, 70, 20), wheel(80, 76, 12));
  return s;
}

function sailboat() {
  const hull = poly([[8, 70], [92, 70], [78, 86], [22, 86]]);
  let s = U(round(hull, 1.5), rect(48, 8, 3.4, 64));
  s = U(s, poly([[46, 12], [46, 64], [14, 64]]), poly([[53, 18], [86, 64], [53, 64]]));
  s = U(s, poly([[51, 6], [64, 10], [51, 14]]));
  s = U(s, stroke([[6, 94], [20, 90], [34, 94], [48, 90], [62, 94], [76, 90], [94, 94]], 2.4, 'round', true));
  return s;
}

function airplane() {
  const body = U(ellipse(50, 50, 7, 44), poly([[50, 30], [96, 56], [96, 62], [50, 52], [4, 62], [4, 56]]), poly([[50, 78], [70, 90], [70, 95], [50, 90], [30, 95], [30, 90]]));
  return round(body, 1.2);
}

function locomotive() {
  let s = U(rect(10, 40, 50, 26, 6), rect(56, 22, 34, 44, 2), rect(16, 20, 10, 20, 1), rect(13, 16, 16, 6, 2), rect(52, 18, 42, 6, 2));
  s = D(s, rect(63, 30, 20, 14, 1));
  s = U(s, poly([[4, 66], [12, 58], [12, 66]]));
  s = D(s, circle(22, 74, 10), circle(46, 74, 10), circle(74, 72, 13));
  s = U(s, wheel(22, 74, 8.5), wheel(46, 74, 8.5), wheel(74, 72, 11.5), stroke([[22, 74], [74, 72]], 2.4));
  s = U(s, circle(14, 10, 4), circle(22, 6, 5), circle(32, 4, 4));
  return s;
}

function hotAirBalloon() {
  let env = sym([[50, 4], [70, 8], [84, 24], [84, 44], [70, 62], [58, 72], [50, 73]], 50, 0.5);
  env = D(env, stroke(cr([[50, 6], [38, 30], [44, 72]], false), 1.6), stroke(cr([[50, 6], [62, 30], [56, 72]], false), 1.6), stroke(cr([[50, 6], [24, 26], [40, 66]], false), 1.4), stroke(cr([[50, 6], [76, 26], [60, 66]], false), 1.4));
  let s = U(env, stroke([[42, 72], [42, 84]], 1.4), stroke([[58, 72], [58, 84]], 1.4), rect(40, 82, 20, 14, 2));
  s = D(s, stroke([[40, 87], [60, 87]], 1.2));
  return s;
}

function camper() {
  let s = round(U(rect(6, 30, 86, 42, 8), rect(6, 26, 60, 10, 4)), 2);
  s = D(s, rect(14, 38, 16, 14, 2), rect(36, 38, 16, 14, 2), rect(70, 36, 16, 16, 3), rect(57, 38, 9, 26, 2));
  s = D(s, stroke([[6, 58], [56, 58]], 1.6));
  s = D(s, circle(26, 74, 12), circle(72, 74, 12));
  return U(s, wheel(26, 74, 10), wheel(72, 74, 10));
}

// ---------- Haus & Alltag ----------

function house() {
  let s = U(poly([[50, 8], [94, 46], [84, 46], [84, 92], [16, 92], [16, 46], [6, 46]]), rect(66, 14, 10, 22));
  s = D(s, rect(40, 62, 20, 30, 1), rect(24, 52, 12, 12, 1), rect(64, 52, 12, 12, 1));
  s = D(s, stroke([[30, 52], [30, 64]], 1.2), stroke([[24, 58], [36, 58]], 1.2), stroke([[70, 52], [70, 64]], 1.2), stroke([[64, 58], [76, 58]], 1.2));
  return U(s, circle(55, 78, 1.6));
}

function key() {
  let s = U(D(circle(26, 50, 20), circle(26, 50, 9)), rect(40, 45, 54, 10, 2), rect(70, 52, 8, 16, 1), rect(84, 52, 8, 12, 1));
  s = D(s, stroke([[48, 50], [64, 50]], 1.4));
  return s;
}

function padlock() {
  let s = U(rect(18, 44, 64, 50, 8), D(rect(28, 8, 44, 50, 22), rect(37, 17, 26, 40, 13)));
  s = D(s, U(circle(50, 64, 6), poly([[46, 66], [54, 66], [56, 82], [44, 82]])));
  return s;
}

function lightbulb() {
  const glass = sym([[50, 4], [64, 7], [76, 20], [76, 38], [68, 52], [62, 62], [62, 68], [50, 68]], 50, 0.5);
  let s = D(glass, stroke(cr([[42, 66], [40, 44], [46, 34], [50, 42], [54, 34], [60, 44], [58, 66]], false), 1.8));
  s = U(s, rect(38, 72, 24, 5, 2), rect(38, 79, 24, 5, 2), rect(42, 86, 16, 7, 3));
  s = D(s, stroke(arcPts(50, 30, 18, 200, 250), 2.4));
  return s;
}

function anchor() {
  let s = U(ring(50, 14, 7, 4.5), rect(46, 22, 8, 62), rect(30, 28, 40, 7, 3));
  s = U(s, stroke(arcPts(50, 50, 38, 20, 160), 7, 'butt'));
  s = U(s, mirror(poly([[84, 56], [96, 50], [90, 68]])), poly([[40, 84], [50, 96], [60, 84]]));
  return round(s, 0.5);
}

function crown() {
  let s = poly([[10, 80], [8, 30], [30, 52], [50, 18], [70, 52], [92, 30], [90, 80]]);
  s = round(s, 0.8);
  s = U(s, circle(8, 26, 5), circle(50, 14, 5), circle(92, 26, 5), rect(10, 82, 80, 10, 2));
  s = D(s, circle(30, 70, 4), ngon(50, 68, 4, 6, -90), circle(70, 70, 4));
  return s;
}

function diamond() {
  let s = poly([[26, 20], [74, 20], [94, 40], [50, 92], [6, 40]]);
  const cutw = 1.6;
  s = D(s, stroke([[6, 40], [94, 40]], cutw), stroke([[26, 20], [38, 40], [50, 20], [62, 40], [74, 20]], cutw, 'round', false, 'round'), stroke([[38, 40], [50, 90]], cutw), stroke([[62, 40], [50, 90]], cutw));
  return s;
}

function umbrella() {
  const top = poly([...arcPts(50, 50, 44, 180, 360), [94, 50], [83, 46], [72, 50], [61, 46], [50, 50], [39, 46], [28, 50], [17, 46]]);
  let s = U(round(top, 0.6), stroke([[50, 48], [50, 84], ...arcPts(42, 84, 8, 0, 180).slice(1)], 4));
  s = D(s, stroke(cr([[50, 8], [36, 22], [30, 46]], false), 1.4), stroke(cr([[50, 8], [64, 22], [70, 46]], false), 1.4));
  return U(s, circle(50, 5, 2.6));
}

function alarmClock() {
  let s = U(circle(50, 54, 34), stroke([[28, 82], [20, 94]], 5), stroke([[72, 82], [80, 94]], 5));
  s = U(s, D(circle(22, 22, 13), circle(30, 32, 16)), D(circle(78, 22, 13), circle(70, 32, 16)));
  s = D(s, circle(50, 54, 27));
  for (let i = 0; i < 12; i++) s = U(s, T(rect(48.8, 29, 2.4, i % 3 ? 3 : 6), { rot: i * 30, cx: 50, cy: 54 }));
  s = U(s, stroke([[50, 54], [50, 36]], 3), stroke([[50, 54], [62, 60]], 3), circle(50, 54, 3.4));
  s = U(s, rect(46, 14, 8, 6, 1));
  return s;
}

function glasses() {
  let s = U(ring(28, 54, 16, 5), ring(72, 54, 16, 5), stroke(arcPts(50, 54, 9, 200, 340), 4));
  s = U(s, stroke([[13, 50], [4, 38]], 4), stroke([[87, 50], [96, 38]], 4));
  return s;
}

function envelope() {
  let s = rect(8, 22, 84, 58, 4);
  s = D(s, stroke([[14, 28], [50, 56], [86, 28]], 2.4, 'round', false, 'round'), stroke([[14, 74], [40, 50]], 2), stroke([[86, 74], [60, 50]], 2));
  return s;
}

function camera() {
  let s = U(rect(8, 30, 84, 56, 8), rect(34, 20, 32, 14, 3), rect(14, 24, 14, 8, 2));
  s = D(s, circle(50, 58, 21));
  s = U(s, D(circle(50, 58, 16), circle(50, 58, 9)));
  s = D(s, circle(80, 42, 3.5));
  return s;
}

function book() {
  const page = (x: number) => (x < 50 ? poly([[50, 28], [44, 22], [26, 20], [8, 24], [8, 84], [26, 80], [44, 82], [50, 88]]) : poly([[50, 28], [56, 22], [74, 20], [92, 24], [92, 84], [74, 80], [56, 82], [50, 88]]));
  let s = U(round(page(0), 1), round(page(100), 1));
  s = D(s, stroke([[50, 28], [50, 88]], 2));
  for (const y of [34, 44, 54, 64]) s = D(s, stroke([[16, y], [42, y + 1]], 1.6), stroke([[58, y + 1], [84, y]], 1.6));
  return s;
}

// ---------- Werkzeug ----------

function hammer() {
  let s = U(round(poly([[22, 10], [72, 10], [80, 18], [80, 26], [72, 30], [22, 30], [10, 24], [10, 16]]), 1.5), rect(42, 30, 12, 66, 4));
  s = D(s, stroke([[42, 44], [54, 44]], 1.4));
  return s;
}

function wrench() {
  let s = T(U(rect(44, 24, 12, 62, 4), circle(50, 18, 16), circle(50, 88, 11)), { rot: 45, cx: 50, cy: 50 });
  s = D(s, T(U(rect(44, 0, 12, 18), circle(50, 18, 6)), { rot: 45, cx: 50, cy: 50 }), T(ngon(50, 88, 6, 6), { rot: 45, cx: 50, cy: 50 }));
  return s;
}

function screwdriver() {
  let s = T(U(round(rect(42, 4, 16, 40, 5), 1), rect(46.5, 44, 7, 40), poly([[46.5, 84], [53.5, 84], [52, 96], [48, 96]])), { rot: 40, cx: 50, cy: 50 });
  s = D(s, T(U(rect(45, 10, 2, 28, 1), rect(49, 10, 2, 28, 1), rect(53, 10, 2, 28, 1)), { rot: 40, cx: 50, cy: 50 }));
  return s;
}

function saw() {
  let blade = poly([[30, 30], [96, 52], [96, 64], [30, 64]]);
  const teeth: Pt[] = [];
  for (let x = 30; x <= 96; x += 4) teeth.push([x, 64], [x + 2, 70]);
  blade = U(blade, poly([[30, 64], ...teeth, [96, 64]]));
  const handle = round(D(poly([[4, 24], [34, 24], [38, 70], [8, 74]]), rect(13, 33, 15, 24, 6)), 3);
  return over(blade, handle, 1.6);
}

function scissors() {
  let s = U(ring(26, 72, 10, 5), ring(74, 72, 10, 5));
  s = U(s, leaf([33, 64], [70, 6], 10, -4), leaf([67, 64], [30, 6], 10, 4));
  s = D(s, edge(leaf([67, 64], [30, 6], 10, 4), 1.6));
  s = U(s, leaf([67, 64], [30, 6], 10, 4));
  return D(s, circle(50, 38, 2));
}

function pencil() {
  let s = T(U(rect(42, 18, 16, 60), poly([[42, 78], [58, 78], [50, 96]]), rect(42, 6, 16, 10, 3)), { rot: 35, cx: 50, cy: 50 });
  s = D(s, T(U(stroke([[42, 17], [58, 17]], 1.6), stroke([[42, 79], [58, 79]], 1.6), stroke([[47.3, 20], [47.3, 76]], 1.2), stroke([[52.7, 20], [52.7, 76]], 1.2)), { rot: 35, cx: 50, cy: 50 }));
  return s;
}

function paintbrush() {
  let s = T(U(rect(45, 4, 10, 46, 5), rect(42, 50, 16, 12, 1), blob([[42, 62], [58, 62], [60, 78], [54, 92], [50, 98], [46, 92], [40, 78]], 0.5)), { rot: -35, cx: 50, cy: 50 });
  s = D(s, T(stroke([[42, 56], [58, 56]], 1.6), { rot: -35, cx: 50, cy: 50 }));
  return s;
}

function gear() {
  let s = U(circle(50, 50, 34), polar(round(rect(43, 6, 14, 18, 1), 0.5), 10));
  s = D(s, circle(50, 50, 14));
  for (let i = 0; i < 5; i++) s = D(s, T(circle(50, 27, 4.5), { rot: i * 72, cx: 50, cy: 50 }));
  return s;
}

// ---------- Musik & Freizeit ----------

function note() {
  let s = U(ellipse(34, 80, 14, 10, -20), rect(44, 10, 5, 70));
  s = U(s, taper([[47, 12], [62, 22], [72, 38], [66, 54]], 7, 2));
  return s;
}

function notes() {
  let s = U(ellipse(24, 80, 12, 9, -20), ellipse(72, 72, 12, 9, -20), rect(31.5, 22, 5, 58), rect(79.5, 14, 5, 58));
  s = U(s, poly([[31.5, 22], [84.5, 10], [84.5, 22], [31.5, 34]]));
  return s;
}

function guitar() {
  let s = T(U(circle(50, 74, 22), circle(50, 46, 16), rect(46, 2, 8, 50), round(rect(43, 0, 14, 14, 3), 1)), { rot: 30, cx: 50, cy: 50 });
  s = D(s, T(U(circle(50, 62, 7), rect(40, 82, 20, 4, 1)), { rot: 30, cx: 50, cy: 50 }));
  s = D(s, T(U(stroke([[48.5, 10], [48.5, 56]], 0.9), stroke([[51.5, 10], [51.5, 56]], 0.9)), { rot: 30, cx: 50, cy: 50 }));
  return s;
}

function headphones() {
  let s = arc(50, 56, 38, 180, 360, 7);
  s = U(s, rect(6, 52, 16, 34, 6), rect(78, 52, 16, 34, 6), rect(20, 56, 8, 26, 3), rect(72, 56, 8, 26, 3));
  return s;
}

function soccerBall() {
  const disc = circle(50, 50, 44);
  let s = U(hollow(disc, 4), ngon(50, 50, 5, 13));
  for (let i = 0; i < 5; i++) {
    const a = ((-90 + i * 72) * Math.PI) / 180;
    s = U(s, stroke([[50 + 13 * Math.cos(a), 50 + 13 * Math.sin(a)], [50 + 30 * Math.cos(a), 50 + 30 * Math.sin(a)]], 2.6));
    const b = a + Math.PI / 5;
    s = U(s, I(ngon(50 + 44 * Math.cos(b), 50 + 44 * Math.sin(b), 5, 13, (b * 180) / Math.PI), disc));
    s = U(s, stroke([[50 + 30 * Math.cos(a), 50 + 30 * Math.sin(a)], [50 + 34 * Math.cos(b), 50 + 34 * Math.sin(b)]], 2.6));
    s = U(s, stroke([[50 + 30 * Math.cos(a), 50 + 30 * Math.sin(a)], [50 + 34 * Math.cos(a - Math.PI / 5), 50 + 34 * Math.sin(a - Math.PI / 5)]], 2.6));
  }
  return s;
}

function dice() {
  let s = round(rect(10, 10, 80, 80, 14), 1);
  for (const [x, y] of [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]] as Pt[]) s = D(s, circle(x, y, 7));
  return s;
}

function chessPawn() {
  const body = sym([[50, 10], [58, 12], [62, 20], [58, 30], [56, 32], [66, 36], [56, 40], [58, 56], [64, 70], [72, 76], [72, 82], [50, 82]], 50, 0.4);
  return U(body, rect(22, 82, 56, 10, 3));
}

function gamepad() {
  let s = round(U(rect(14, 30, 72, 34, 16), circle(26, 64, 15), circle(74, 64, 15)), 2);
  s = D(s, rect(22, 43, 18, 6, 1), rect(28, 37, 6, 18, 1));
  for (const [x, y] of [[68, 40], [76, 48], [68, 56], [60, 48]] as Pt[]) s = D(s, circle(x, y, 3.6));
  return s;
}

function tent() {
  let s = poly([[50, 12], [94, 86], [6, 86]]);
  s = round(s, 1);
  s = D(s, poly([[50, 42], [66, 86], [34, 86]]));
  s = U(s, stroke([[50, 12], [44, 2]], 2.4), stroke([[50, 12], [56, 2]], 2.4));
  s = U(s, rect(2, 86, 96, 5, 2));
  return s;
}

function palette() {
  let s = blob([[50, 8], [76, 12], [94, 32], [92, 58], [78, 70], [62, 66], [56, 76], [62, 88], [50, 94], [26, 88], [8, 66], [8, 36], [24, 16]], 0.5);
  for (const [x, y, r] of [[30, 30, 7], [52, 22, 7], [72, 30, 7], [24, 54, 7], [36, 76, 8]]) s = D(s, circle(x, y, r));
  return s;
}

// ---------- Symbole ----------

function heartMotif() {
  return heart(50, 50, 92);
}

function paw() {
  let s = U(ellipse(50, 70, 22, 18), ellipse(30, 52, 6, 4));
  s = blob([[50, 52], [62, 54], [72, 66], [72, 80], [60, 86], [50, 82], [40, 86], [28, 80], [28, 66], [38, 54]], 0.5);
  s = U(s, ellipse(22, 44, 8, 10, -20), ellipse(40, 28, 8, 11, -8), ellipse(60, 28, 8, 11, 8), ellipse(78, 44, 8, 10, 20));
  return s;
}

function yinYang() {
  let s = D(circle(50, 50, 46), circle(50, 50, 42));
  const dark = U(D(poly([...arcPts(50, 50, 42, 90, 270)]), circle(50, 29, 21)), circle(50, 71, 21));
  s = U(s, D(dark, circle(50, 71, 6)), circle(50, 29, 6));
  return s;
}

function peace() {
  let s = ring(50, 50, 40, 8);
  s = U(s, rect(46, 10, 8, 80), T(rect(46, 50, 8, 40), { rot: 45, cx: 50, cy: 50 }), T(rect(46, 50, 8, 40), { rot: -45, cx: 50, cy: 50 }));
  return I(s, circle(50, 50, 44));
}

function infinity() {
  const pts: Pt[] = [];
  for (let i = 0; i <= 200; i++) {
    const t = (i / 200) * Math.PI * 2;
    const d = 1 + Math.sin(t) ** 2;
    pts.push([50 + (44 * Math.cos(t)) / d, 50 + (44 * Math.sin(t) * Math.cos(t)) / d]);
  }
  return stroke(pts, 7);
}

function recycle() {
  let s: Shape = [];
  for (let i = 0; i < 3; i++) {
    const a0 = -80 + i * 120,
      a1 = a0 + 84;
    const r = (x: number) => (x * Math.PI) / 180;
    let a = arc(50, 52, 34, a0, a1, 10, 'butt');
    const ex = 50 + 34 * Math.cos(r(a1)),
      ey = 52 + 34 * Math.sin(r(a1));
    const tx = -Math.sin(r(a1)),
      ty = Math.cos(r(a1));
    const nx = Math.cos(r(a1)),
      ny = Math.sin(r(a1));
    a = U(a, poly([[ex + nx * 12, ey + ny * 12], [ex + tx * 16, ey + ty * 16], [ex - nx * 12, ey - ny * 12]]));
    s = U(s, a);
  }
  return s;
}

function horseshoe() {
  let s = arc(50, 48, 32, 125, 415, 16, 'butt');
  s = U(s, mirror(rect(66, 72, 16, 10, 2)));
  for (const a of [145, 180, 215, 250, 290, 325, 360, 395]) {
    const r = (a * Math.PI) / 180;
    s = D(s, ellipse(50 + 32 * Math.cos(r), 48 + 32 * Math.sin(r), 1.8, 3, a + 90));
  }
  return s;
}

function footprints() {
  const foot = (cx: number, cy: number, flip: number) => {
    let f = U(ellipse(cx, cy, 9, 15), ellipse(cx + flip * 1, cy + 18, 7, 7));
    for (const [dx, dy, r] of [[-7, -19, 3.4], [-1.5, -21, 2.8], [3, -20, 2.4], [6.5, -18, 2.1], [9, -15, 1.8]]) f = U(f, circle(cx + flip * dx, cy + dy, r));
    return f;
  };
  return U(foot(32, 62, 1), foot(68, 38, -1));
}

function hourglass() {
  let s = U(rect(20, 6, 60, 8, 2), rect(20, 86, 60, 8, 2));
  const glass = sym([[50, 14], [72, 14], [72, 22], [56, 48], [56, 52], [72, 78], [72, 86], [50, 86]], 50, 0.3);
  s = U(s, hollow(glass, 3.2));
  s = U(s, poly([[34, 84], [66, 84], [50, 66]]), poly([[40, 30], [60, 30], [50, 46]]));
  return s;
}

function heartbeat() {
  let s = D(heart(50, 50, 92), heart(50, 50, 78));
  s = U(s, stroke([[10, 52], [32, 52], [40, 36], [50, 70], [58, 44], [64, 52], [90, 52]], 4, 'round', false, 'round'));
  return s;
}

// ---------- Sternzeichen ----------

const W = 7;
const zs = (pts: Pt[], smooth = false) => stroke(pts, W, 'round', smooth);

const ZODIAC: [string, string, string, () => Shape][] = [
  ['aries', 'Widder', 'Aries', () => U(zs([[50, 92], [50, 40]]), zs(arcPts(32, 36, 18, 0, -200)), zs(arcPts(68, 36, 18, 180, 380)))],
  ['taurus', 'Stier', 'Taurus', () => U(ring(50, 66, 22, W), zs(arcPts(50, 12, 32, 15, 165)))],
  ['gemini', 'Zwillinge', 'Gemini', () => U(zs([[36, 24], [36, 76]]), zs([[64, 24], [64, 76]]), zs([[16, 16], [50, 26], [84, 16]], true), zs([[16, 84], [50, 74], [84, 84]], true))],
  ['cancer', 'Krebs', 'Cancer', () => {
    const half = U(ring(28, 38, 10, W), zs(arcPts(54, 46, 30, 200, 330)));
    return U(half, T(half, { rot: 180, cx: 50, cy: 50 }));
  }],
  ['leo', 'Löwe', 'Leo', () => U(ring(28, 66, 13, W), zs([[38, 58], [34, 34], [48, 14], [66, 18], [70, 38], [60, 62], [64, 82], [80, 86]], true))],
  ['virgo', 'Jungfrau', 'Virgo', () => U(zs([[14, 22], [14, 86]]), zs([[14, 32], [26, 20], [36, 32], [36, 86]], true), zs([[36, 32], [48, 20], [58, 32], [58, 74]], true), zs([[58, 74], [66, 90], [82, 78], [78, 60], [62, 64], [58, 74]], true))],
  ['libra', 'Waage', 'Libra', () => U(zs([[12, 84], [88, 84]]), zs([[12, 66], [34, 66]]), zs([[66, 66], [88, 66]]), zs([[34, 66], ...arcPts(50, 52, 18, 140, 400).slice(2, -2), [66, 66]], true))],
  ['scorpio', 'Skorpion', 'Scorpio', () => U(zs([[12, 22], [12, 80]]), zs([[12, 32], [24, 20], [34, 32], [34, 80]], true), zs([[34, 32], [46, 20], [56, 32], [56, 76], [64, 86], [82, 86]], true), round(poly([[78, 76], [94, 86], [78, 96]]), 0.5))],
  ['sagittarius', 'Schütze', 'Sagittarius', () => U(zs([[16, 84], [80, 20]]), poly([[90, 10], [86, 40], [76, 30], [60, 14]]), zs([[30, 46], [54, 70]]))],
  ['capricorn', 'Steinbock', 'Capricorn', () => U(zs([[10, 20], [22, 22], [32, 76], [44, 20], [48, 66]], false), ring(64, 70, 12, W), zs(arcPts(64, 70, 12, 120, 180).reverse().concat([[44, 90], [30, 92]]), true))],
  ['aquarius', 'Wassermann', 'Aquarius', () => U(zs([[10, 44], [24, 30], [38, 44], [52, 30], [66, 44], [80, 30], [92, 42]]), zs([[10, 74], [24, 60], [38, 74], [52, 60], [66, 74], [80, 60], [92, 72]]))],
  ['pisces', 'Fische', 'Pisces', () => U(zs(arcPts(-6, 50, 40, -55, 55)), zs(arcPts(106, 50, 40, 125, 235)), zs([[22, 50], [78, 50]]))],
];

// ---------- Weltraum ----------

function rocket() {
  let body = sym([[50, 2], [60, 12], [66, 30], [66, 60], [62, 74], [50, 74]], 50, 0.45);
  body = D(body, ring(50, 36, 7, 3.6));
  body = U(body, circle(50, 36, 4));
  let s = U(body, mirror(round(poly([[66, 50], [82, 70], [82, 84], [64, 72]]), 1)));
  s = U(s, blob([[42, 78], [58, 78], [56, 88], [50, 98], [44, 88]], 0.5));
  s = D(s, stroke([[34, 76], [66, 76]], 1.6));
  return s;
}

function saturn() {
  let s = circle(50, 50, 26);
  const rng = D(ellipse(50, 50, 48, 13, -20), ellipse(50, 50, 38, 8, -20));
  const front = D(rng, T(rect(0, 0, 100, 50), { rot: -20, cx: 50, cy: 50 }));
  s = U(D(s, off(front, 2)), front, D(rng, circle(50, 50, 28)));
  return s;
}

function ufo() {
  let s = U(ellipse(50, 58, 46, 12), D(circle(50, 48, 20), rect(0, 50, 100, 50)));
  s = D(s, stroke([[6, 58], [94, 58]], 1.6));
  for (const x of [26, 42, 58, 74]) s = D(s, circle(x, 63, 2.6));
  s = U(s, poly([[38, 72], [62, 72], [74, 96], [26, 96]]));
  s = D(s, edge(ellipse(50, 58, 47, 13), 1.2));
  return s;
}

function shootingStar() {
  let s = round(star(68, 32, 5, 26, 11, -80), 1.5);
  s = U(s, taper([[10, 90], [30, 70], [50, 50]], 1, 7), taper([[24, 96], [42, 76], [56, 60]], 1, 5), taper([[4, 72], [24, 56], [44, 44]], 1, 5));
  return s;
}

const A = (...a: [string, string, string, string, () => Shape, number?][]) => a;

export const THINGS: Def[] = [
  ...group('motif', 'vehicles', A(
    ['car', 'Auto', 'Car', 'Auto/car, fahren/driving', car],
    ['bicycle', 'Fahrrad', 'Bicycle', 'Fahrrad/bike, Radfahren/cycling', bicycle],
    ['scooter', 'Motorroller', 'Scooter', 'Roller/scooter, Italien/italy', scooter],
    ['truck', 'Lastwagen', 'Truck', 'LKW/truck, Transport/transport', truck],
    ['tractor', 'Traktor', 'Tractor', 'Traktor/tractor, Bauernhof/farm', tractor],
    ['sailboat', 'Segelboot', 'Sailboat', 'Boot/boat, Segeln/sailing, Meer/sea', sailboat],
    ['airplane', 'Flugzeug', 'Airplane', 'Flugzeug/plane, Reisen/travel, Urlaub/holiday', airplane],
    ['locomotive', 'Dampflok', 'Steam locomotive', 'Zug/train, Eisenbahn/railway', locomotive],
    ['hot-air-balloon', 'Heißluftballon', 'Hot-air balloon', 'Ballon/balloon, fliegen/flying, Reisen/travel', hotAirBalloon],
    ['camper', 'Wohnmobil', 'Camper van', 'Camping/camping, Urlaub/holiday, Reisen/travel', camper],
  )),
  ...group('motif', 'home', A(
    ['house', 'Haus', 'House', 'Haus/house, Zuhause/home', house],
    ['key', 'Schlüssel', 'Key', 'Schlüssel/key, Zuhause/home', key],
    ['padlock', 'Vorhängeschloss', 'Padlock', 'Schloss/lock, Liebesschloss/love lock, Sicherheit/security', padlock],
    ['lightbulb', 'Glühbirne', 'Light bulb', 'Lampe/lamp, Idee/idea, Licht/light', lightbulb],
    ['anchor', 'Anker', 'Anchor', 'Anker/anchor, maritim/nautical, Meer/sea', anchor],
    ['crown', 'Krone', 'Crown', 'Krone/crown, König/king, Prinzessin/princess', crown],
    ['diamond', 'Diamant', 'Diamond', 'Diamant/diamond, Edelstein/gem, Schmuck/jewellery', diamond],
    ['umbrella', 'Regenschirm', 'Umbrella', 'Schirm/umbrella, Regen/rain', umbrella],
    ['alarm-clock', 'Wecker', 'Alarm clock', 'Uhr/clock, Zeit/time, Wecker/alarm', alarmClock],
    ['glasses', 'Brille', 'Glasses', 'Brille/glasses, Optiker/optician', glasses],
    ['envelope', 'Briefumschlag', 'Envelope', 'Brief/letter, Post/mail, E-Mail/email', envelope],
    ['camera', 'Fotokamera', 'Camera', 'Kamera/camera, Foto/photo', camera],
    ['book', 'Buch', 'Book', 'Buch/book, lesen/reading, Schule/school', book],
  )),
  ...group('motif', 'tools', A(
    ['hammer', 'Hammer', 'Hammer', 'Hammer/hammer, Werkstatt/workshop, Handwerk/craft', hammer],
    ['wrench', 'Schraubenschlüssel', 'Wrench', 'Schlüssel/spanner, Werkstatt/workshop, Reparatur/repair', wrench],
    ['screwdriver', 'Schraubendreher', 'Screwdriver', 'Schraubenzieher/screwdriver, Werkstatt/workshop', screwdriver],
    ['saw', 'Säge', 'Saw', 'Säge/saw, Holz/wood, Werkstatt/workshop', saw],
    ['scissors', 'Schere', 'Scissors', 'Schere/scissors, Basteln/crafts, Friseur/hairdresser', scissors],
    ['pencil', 'Bleistift', 'Pencil', 'Stift/pencil, Schule/school, zeichnen/drawing', pencil],
    ['paintbrush', 'Pinsel', 'Paintbrush', 'Pinsel/brush, malen/painting, Kunst/art', paintbrush],
    ['gear', 'Zahnrad', 'Gear', 'Zahnrad/gear, Technik/engineering, Einstellungen/settings', gear],
  )),
  ...group('motif', 'leisure', A(
    ['music-note', 'Note', 'Music note', 'Musik/music, Note/note', note],
    ['music-notes', 'Noten', 'Music notes', 'Musik/music, Noten/notes', notes],
    ['guitar', 'Gitarre', 'Guitar', 'Gitarre/guitar, Musik/music', guitar],
    ['headphones', 'Kopfhörer', 'Headphones', 'Kopfhörer/headphones, Musik/music', headphones],
    ['soccer-ball', 'Fußball', 'Football', 'Fußball/soccer, Ball/ball, Sport/sport', soccerBall],
    ['dice', 'Würfel', 'Die', 'Würfel/dice, Spiel/game', dice],
    ['chess-pawn', 'Schachfigur', 'Chess pawn', 'Schach/chess, Spiel/game', chessPawn],
    ['gamepad', 'Gamecontroller', 'Game controller', 'Spiel/game, Gaming/gaming, Konsole/console', gamepad],
    ['tent', 'Zelt', 'Tent', 'Zelt/tent, Camping/camping, Outdoor/outdoor', tent],
    ['palette', 'Malpalette', 'Paint palette', 'Malen/painting, Kunst/art, Farbe/colour', palette],
  )),
  ...group('motif', 'symbols', A(
    ['heart', 'Herz', 'Heart', 'Herz/heart, Liebe/love, Valentinstag/valentine', heartMotif],
    ['paw-print', 'Pfotenabdruck', 'Paw print', 'Pfote/paw, Hund/dog, Katze/cat, Haustier/pet', paw],
    ['yin-yang', 'Yin und Yang', 'Yin and yang', 'Yin Yang/yin yang, Balance/balance', yinYang],
    ['peace', 'Friedenszeichen', 'Peace sign', 'Frieden/peace, Hippie/hippie', peace],
    ['infinity', 'Unendlich', 'Infinity', 'Unendlichkeit/infinity, für immer/forever, Liebe/love', infinity],
    ['recycle', 'Kreislauf-Pfeile', 'Recycling arrows', 'Recycling/recycling, Umwelt/environment, Pfeile/arrows', recycle],
    ['horseshoe', 'Hufeisen', 'Horseshoe', 'Hufeisen/horseshoe, Glück/luck, Pferd/horse', horseshoe],
    ['footprints', 'Fußspuren', 'Footprints', 'Füße/feet, Baby/baby, Spuren/tracks', footprints],
    ['hourglass', 'Sanduhr', 'Hourglass', 'Zeit/time, Sanduhr/hourglass', hourglass],
    ['heartbeat', 'Herzschlag', 'Heartbeat', 'Herz/heart, Puls/pulse, Medizin/medicine', heartbeat],
  )),
  ...ZODIAC.map(([id, de, en, draw]): Def => ({ id: `zodiac-${id}`, de, en, cat: 'motif', group: 'zodiac', tags: [['Horoskop', 'horoscope'], ['Astrologie', 'astrology']], draw })),
  ...group('motif', 'space', A(
    ['rocket', 'Rakete', 'Rocket', 'Rakete/rocket, Raumfahrt/spaceflight, Kinder/kids', rocket],
    ['saturn', 'Planet mit Ring', 'Ringed planet', 'Planet/planet, Saturn/saturn', saturn],
    ['ufo', 'UFO', 'UFO', 'UFO/ufo, Außerirdische/alien', ufo],
    ['shooting-star', 'Sternschnuppe', 'Shooting star', 'Stern/star, Wunsch/wish, Nacht/night', shootingStar],
  )),
];
