// Motive: Pflanzen, Essen & Trinken, Natur & Wetter, Feste
import { Def, group } from './defs';
import {
  arc, arcPts, blob, circle, D, edge, ellipse, heart, hollow, I, leaf, mirror, ngon, off, over, poly, polar, rect, ring, round, spiralPts,
  star, stroke, sym, symPoly, T, taper, U, Pt, Shape, cr,
} from './kit';

const veins = (s: Shape, top: Pt, bottom: Pt, n: number, spread: number, w = 1.3): Shape => {
  s = D(s, stroke([top, bottom], w * 1.2));
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const x = top[0] + (bottom[0] - top[0]) * t,
      y = top[1] + (bottom[1] - top[1]) * t;
    s = D(s, stroke([[x, y], [x + spread, y - spread * 0.7]], w), stroke([[x, y], [x - spread, y - spread * 0.7]], w));
  }
  return s;
};

// ---------- Pflanzen ----------

function leafSimple() {
  let s = sym([[50, 4], [62, 18], [70, 40], [66, 62], [56, 80], [50, 86]], 50, 0.5);
  s = veins(s, [50, 14], [50, 84], 5, 12);
  return U(s, stroke([[50, 84], [50, 98]], 3));
}

function maple() {
  const half: Pt[] = [[50, 2], [57, 16], [63, 12], [61, 34], [74, 22], [77, 29], [90, 24], [86, 38], [97, 44], [78, 58], [81, 66], [61, 64], [53, 74], [50, 74]];
  let s = round(symPoly(half), 0.6);
  s = U(s, stroke([[50, 70], [50, 98]], 2.6));
  s = D(s, stroke([[50, 12], [50, 70]], 1.4), stroke([[50, 64], [76, 34]], 1.3), stroke([[50, 64], [24, 34]], 1.3), stroke([[50, 68], [78, 58]], 1.2), stroke([[50, 68], [22, 58]], 1.2));
  return s;
}

function oakLeaf() {
  let s = sym([[50, 4], [58, 8], [60, 16], [68, 16], [70, 26], [62, 32], [72, 38], [76, 48], [66, 54], [72, 62], [68, 72], [58, 72], [56, 80], [50, 82]], 50, 0.55);
  s = veins(s, [50, 10], [50, 80], 4, 11);
  return U(s, stroke([[50, 80], [50, 96]], 3));
}

function ginkgo() {
  const fan = poly([[50, 90], ...arcPts(50, 90, 46, 215, 325)]);
  let s = round(fan, 2);
  s = D(s, poly([[46, 42], [54, 42], [50, 62]]));
  for (let a = 225; a <= 315; a += 10) {
    const r = (x: number) => (x * Math.PI) / 180;
    s = D(s, stroke([[50 + 14 * Math.cos(r(a)), 90 + 14 * Math.sin(r(a))], [50 + 40 * Math.cos(r(a)), 90 + 40 * Math.sin(r(a))]], 1));
  }
  return U(s, stroke([[50, 86], [52, 99]], 2.6));
}

function monstera() {
  let s = blob([[50, 14], [64, 6], [82, 14], [92, 32], [90, 54], [78, 74], [60, 86], [50, 88], [40, 86], [22, 74], [10, 54], [8, 32], [18, 14], [36, 6]], 0.5);
  s = D(s, poly([[46, 6], [54, 6], [50, 20]]));
  for (const [y, len] of [[30, 26], [46, 30], [62, 24]] as [number, number][]) {
    s = D(s, stroke([[100, y - 6], [100 - len, y + 4]], 3.6), stroke([[0, y - 6], [len, y + 4]], 3.6));
  }
  for (const [x, y] of [[62, 36], [38, 36], [62, 54], [38, 54]] as Pt[]) s = D(s, ellipse(x, y, 3, 4.5));
  s = D(s, stroke([[50, 22], [50, 84]], 1.6));
  return U(s, stroke([[50, 84], [46, 99]], 3));
}

function fern() {
  let s = stroke([[50, 98], [50, 60], [52, 30], [56, 6]], 2.4, 'round', true);
  for (let i = 0; i < 10; i++) {
    const y = 88 - i * 8.4;
    const len = 30 - i * 2.6;
    const x = 50 + i * 0.5;
    s = U(s, leaf([x, y], [x + len, y - len * 0.45], 7 - i * 0.4), leaf([x, y], [x - len, y - len * 0.45], 7 - i * 0.4));
  }
  return s;
}

function tree() {
  const crown = U(circle(50, 34, 22), circle(28, 48, 16), circle(72, 48, 16), circle(38, 24, 15), circle(62, 24, 15), circle(50, 52, 16));
  const trunk = U(poly([[44, 56], [56, 56], [59, 96], [41, 96]]), stroke([[50, 72], [36, 58]], 4), stroke([[52, 66], [66, 54]], 4));
  return over(trunk, crown, 2);
}

function fir() {
  let s = U(
    poly([[50, 4], [70, 30], [30, 30]]),
    poly([[50, 18], [78, 52], [22, 52]]),
    poly([[50, 36], [88, 78], [12, 78]]),
  );
  s = round(s, 1);
  s = U(s, rect(44, 76, 12, 20));
  return s;
}

function palm() {
  let s = taper([[44, 98], [46, 70], [52, 46], [58, 34]], 9, 5);
  for (let i = 1; i < 6; i++) s = D(s, stroke([[38 + i * 1.2, 98 - i * 11], [56 - i * 0.2, 96 - i * 11]], 1.2));
  const fronds: [Pt, Pt, number][] = [
    [[58, 32], [18, 34], -10], [[58, 32], [26, 14], -8], [[58, 32], [58, 2], -6], [[58, 32], [92, 12], 8], [[58, 32], [98, 38], 10], [[58, 32], [30, 56], 6], [[58, 32], [82, 60], -6],
  ];
  for (const [a, b, bend] of fronds) s = U(s, leaf(a, b, 12, bend));
  return U(s, circle(54, 38, 3.5), circle(62, 38, 3.5));
}

function tulip() {
  const cup = blob([[36, 20], [43, 30], [50, 16], [57, 30], [64, 20], [67, 38], [62, 52], [50, 57], [38, 52], [33, 38]], 0.3);
  let s = D(cup, stroke([[43, 30], [46, 48]], 1.4), stroke([[57, 30], [54, 48]], 1.4));
  s = U(s, stroke([[50, 54], [50, 98]], 3));
  s = U(s, leaf([50, 96], [28, 56], 14, -4), leaf([50, 96], [74, 64], 12, 4));
  return s;
}

function daisy() {
  const petals = polar(ellipse(50, 22, 6, 17), 16);
  return over(petals, circle(50, 50, 13), 2);
}

function rose() {
  const outer = U(polar(circle(50, 22, 14), 7), circle(50, 50, 30));
  let s = round(outer, 2);
  s = D(s, edge(circle(50, 50, 31), 1.6));
  s = D(s, stroke(spiralPts(50, 50, 2, 26, 3, 0), 1.6));
  return s;
}

function sunflower() {
  const petals = polar(poly([[50, 4], [56, 22], [50, 30], [44, 22]]), 20);
  let s = over(round(petals, 0.6), circle(50, 50, 22), 2);
  for (let r = 4; r < 19; r += 4.2) {
    const n = Math.round((2 * Math.PI * r) / 4.6);
    for (let i = 0; i < n; i++) s = D(s, circle(50 + r * Math.cos((i / n) * Math.PI * 2 + r), 50 + r * Math.sin((i / n) * Math.PI * 2 + r), 1.1));
  }
  return s;
}

function cactus() {
  let s = U(rect(40, 14, 20, 66, 10), stroke([[42, 56], [26, 56], [24, 34]], 10, 'round'), stroke([[58, 46], [74, 46], [76, 26]], 10, 'round'));
  s = D(s, stroke([[50, 22], [50, 76]], 1.3), stroke([[25, 40], [25, 52]], 1.2), stroke([[75, 32], [75, 42]], 1.2));
  const pot = poly([[30, 78], [70, 78], [64, 98], [36, 98]]);
  s = over(s, U(pot, rect(27, 76, 46, 7, 1.5)), 1.8);
  return s;
}

function mushroom() {
  const cap = U(poly(arcPts(50, 50, 44, 180, 360)), rect(6, 46, 88, 8, 4));
  let s = over(rect(38, 50, 24, 44, 8), round(cap, 2), 2);
  for (const [x, y, r] of [[30, 34, 6], [52, 22, 7], [72, 36, 5], [44, 42, 3.5], [64, 14, 3]]) s = D(s, circle(x, y, r));
  return s;
}

function lotus() {
  let s = leaf([50, 78], [50, 12], 26);
  s = over(s, U(leaf([46, 80], [18, 30], 22, -6), leaf([54, 80], [82, 30], 22, 6)), 1.6);
  s = over(s, U(leaf([46, 82], [4, 58], 18, -6), leaf([54, 82], [96, 58], 18, 6)), 1.6);
  s = over(s, U(ellipse(50, 84, 30, 6)), 1.6);
  return s;
}

function clover() {
  let s = polar(heart(50, 31, 38), 4, 50, 50, 45);
  s = D(s, polar(stroke([[50, 50], [50, 24]], 1.4), 4, 50, 50, 45));
  return U(s, stroke([[50, 52], [60, 76], [70, 98]], 3.6, 'round', true));
}

function acorn() {
  const nut = sym([[50, 38], [66, 40], [72, 56], [66, 78], [56, 90], [50, 96]], 50, 0.5);
  const cap = U(poly(arcPts(50, 46, 26, 180, 360)), rect(24, 40, 52, 10, 5), stroke([[50, 22], [54, 8]], 4));
  let s = over(nut, cap, 2);
  for (let x = 30; x <= 70; x += 8) s = D(s, stroke([[x, 26], [x - 10, 48]], 1.2), stroke([[x, 26], [x + 10, 48]], 1.2));
  return s;
}

function sprout() {
  let s = stroke([[50, 90], [50, 60], [52, 44]], 3.4, 'round', true);
  s = U(s, leaf([51, 50], [16, 32], 24, -6), leaf([52, 44], [86, 20], 26, 6));
  s = D(s, stroke([[50, 49], [24, 36]], 1.3), stroke([[52, 43], [78, 26]], 1.3));
  s = U(s, U(poly(arcPts(50, 100, 36, 180, 360))));
  return s;
}

function wheat() {
  let s = stroke([[50, 98], [50, 20]], 2.6);
  for (let i = 0; i < 6; i++) {
    const y = 70 - i * 9.5;
    s = U(s, leaf([50, y + 6], [38, y - 8], 9, -2), leaf([50, y + 6], [62, y - 8], 9, 2));
  }
  s = U(s, leaf([50, 22], [50, 2], 8));
  return s;
}

function cherryBlossom() {
  const petal = D(blob([[50, 50], [62, 34], [64, 18], [56, 8], [50, 14], [44, 8], [36, 18], [38, 34]], 0.5), poly([[46, 4], [54, 4], [50, 14]]));
  let s = polar(petal, 5);
  s = D(s, polar(stroke([[50, 50], [50, 30]], 1.4), 5));
  s = D(s, circle(50, 50, 6));
  s = U(s, circle(50, 50, 3));
  for (let i = 0; i < 5; i++) {
    const a = ((i * 72 + 36 - 90) * Math.PI) / 180;
    s = D(s, circle(50 + 14 * Math.cos(a), 50 + 14 * Math.sin(a), 1.6));
  }
  return s;
}

function pottedPlant() {
  let s = U(
    leaf([50, 64], [50, 8], 18), leaf([48, 66], [16, 24], 16, -6), leaf([52, 66], [84, 24], 16, 6), leaf([48, 68], [10, 54], 14, -4), leaf([52, 68], [90, 54], 14, 4),
  );
  s = D(s, stroke([[50, 60], [50, 14]], 1.2));
  const pot = U(poly([[30, 70], [70, 70], [64, 98], [36, 98]]), rect(26, 66, 48, 8, 2));
  return over(s, pot, 2);
}

function branch() {
  const path: Pt[] = [[6, 92], [30, 72], [60, 44], [92, 10]];
  let s = stroke(path, 2.6, 'round', true);
  const pts = cr(path, false);
  for (let i = 1; i <= 7; i++) {
    const k = Math.round((i / 8.2) * (pts.length - 1));
    const [x, y] = pts[k];
    const [x2, y2] = pts[Math.min(pts.length - 1, k + 1)];
    const a = Math.atan2(y2 - y, x2 - x) + (i % 2 ? -0.9 : 0.9);
    s = U(s, leaf([x, y], [x + 22 * Math.cos(a), y + 22 * Math.sin(a)], 9, i % 2 ? 2 : -2));
  }
  return U(s, leaf([90, 12], [99, 0], 8));
}

function lavender() {
  let s = stroke([[50, 98], [50, 36]], 2.2);
  for (let i = 0; i < 9; i++) {
    const y = 62 - i * 6.2;
    const w = 7 - i * 0.4;
    s = U(s, ellipse(50 - w * 0.7, y, w * 0.55, 3, -30), ellipse(50 + w * 0.7, y, w * 0.55, 3, 30));
  }
  s = U(s, ellipse(50, 6, 2.6, 4));
  s = U(s, leaf([50, 92], [34, 70], 6, -2), leaf([50, 88], [66, 68], 6, 2));
  return s;
}

// ---------- Essen & Trinken ----------

function apple() {
  const body = U(circle(37, 56, 26), circle(63, 56, 26), circle(50, 70, 24));
  let s = D(round(body, 2), circle(50, 30, 6));
  s = U(s, stroke([[50, 34], [52, 22], [56, 14]], 3, 'round', true), leaf([54, 24], [80, 14], 12, -3));
  s = D(s, stroke(arcPts(40, 52, 16, 200, 250), 2.4));
  return s;
}

function pear() {
  let s = sym([[50, 22], [58, 24], [62, 38], [72, 56], [74, 74], [64, 90], [50, 94]], 50, 0.5);
  s = U(s, stroke([[50, 24], [52, 12], [56, 6]], 2.8, 'round', true), leaf([53, 16], [74, 10], 10, -3));
  s = D(s, stroke(arcPts(48, 70, 16, 140, 200), 2.2));
  return s;
}

function cherries() {
  let s = U(circle(30, 72, 17), circle(68, 76, 17));
  s = U(s, stroke([[30, 56], [42, 30], [56, 10]], 2.4, 'round', true), stroke([[68, 60], [62, 34], [56, 10]], 2.4, 'round', true));
  s = U(s, leaf([56, 10], [86, 8], 12, -4));
  s = D(s, stroke(arcPts(30, 72, 11, 200, 250), 2.2), stroke(arcPts(68, 76, 11, 200, 250), 2.2));
  return s;
}

function strawberry() {
  let s = sym([[50, 24], [66, 22], [80, 32], [78, 52], [66, 74], [54, 92], [50, 94]], 50, 0.5);
  const top = U(polar(leaf([50, 26], [50, 8], 9), 1), leaf([50, 26], [30, 16], 9, -2), leaf([50, 26], [70, 16], 9, 2), leaf([50, 26], [24, 30], 8), leaf([50, 26], [76, 30], 8), stroke([[50, 22], [52, 6]], 3));
  s = over(s, top, 1.6);
  const seeds: Pt[] = [[38, 40], [50, 38], [62, 40], [32, 52], [44, 52], [56, 52], [68, 52], [40, 64], [52, 64], [62, 64], [46, 76], [56, 76], [51, 86]];
  for (const [x, y] of seeds) s = D(s, ellipse(x, y, 1.3, 2.2));
  return s;
}

function lemon() {
  let s = circle(50, 50, 42);
  s = D(s, circle(50, 50, 36));
  s = U(s, circle(50, 50, 33));
  s = D(s, polar(stroke([[50, 50], [50, 18]], 2.6), 10), circle(50, 50, 4));
  return s;
}

function grapes() {
  let s: Shape = [];
  const rows = [[32, 42, 52, 62, 72], [37, 47, 57, 67], [42, 52, 62], [47, 57], [52]];
  rows.forEach((xs, r) => xs.forEach((x) => (s = over(s, circle(x - 2, 36 + r * 12, 6.2), 1.4))));
  s = U(s, stroke([[50, 30], [52, 8]], 2.6), leaf([52, 16], [82, 8], 16, -3));
  return s;
}

function watermelon() {
  let s = poly(arcPts(50, 10, 46, 0, 180));
  s = D(s, arc(50, 10, 39, -5, 185, 1.8, 'butt'));
  for (const [x, y] of [[36, 22], [50, 24], [64, 22], [43, 34], [57, 34], [50, 44]] as Pt[]) s = D(s, ellipse(x, y, 1.6, 2.6));
  return s;
}

function carrot() {
  let s = taper([[50, 30], [50, 60], [50, 96]], 26, 2);
  for (const y of [42, 54, 66]) s = D(s, stroke([[38 + (y - 42) * 0.25, y], [48, y + 2]], 1.6));
  s = D(s, stroke([[56, 48], [62 - 0.1, 47]], 1.6), stroke([[54, 74], [58, 73]], 1.6));
  s = over(s, U(leaf([50, 30], [50, 2], 9), leaf([48, 30], [30, 6], 8, -2), leaf([52, 30], [70, 6], 8, 2)), 1.6);
  return s;
}

function avocado() {
  let s = sym([[50, 6], [60, 10], [68, 30], [80, 56], [78, 80], [64, 94], [50, 96]], 50, 0.5);
  s = D(s, sym([[50, 14], [57, 18], [64, 36], [72, 58], [70, 78], [60, 88], [50, 89]], 50, 0.5));
  s = U(s, circle(50, 64, 17));
  s = D(s, stroke(arcPts(50, 64, 11, 200, 260), 2.2));
  return s;
}

function iceCream() {
  const cone = poly([[30, 46], [70, 46], [50, 98]]);
  let c = D(cone, stroke([[34, 52], [60, 86]], 1.4), stroke([[44, 50], [64, 74]], 1.4), stroke([[66, 52], [40, 86]], 1.4), stroke([[56, 50], [36, 74]], 1.4));
  const scoops = U(circle(50, 22, 15), circle(36, 40, 12), circle(64, 40, 12), circle(50, 40, 12));
  let s = over(c, scoops, 2);
  s = U(s, circle(50, 6, 4.5), stroke([[50, 4], [56, 0]], 1.6));
  s = D(s, stroke(arcPts(46, 20, 8, 200, 260), 2));
  return s;
}

function cupcake() {
  const base = poly([[26, 56], [74, 56], [66, 96], [34, 96]]);
  let b = base;
  for (const x of [36, 44, 52, 60]) b = D(b, stroke([[x + 1, 58], [x + (x - 48) * 0.1 + 2, 96]], 1.6));
  const top = U(ellipse(50, 50, 30, 10), ellipse(50, 40, 24, 9), ellipse(50, 30, 16, 8), circle(50, 18, 7));
  let s = over(b, top, 2);
  s = U(s, stroke([[52, 12], [58, 2]], 2));
  s = D(s, stroke([[30, 52], [70, 52]], 1.4), stroke([[34, 43], [66, 43]], 1.4), stroke([[38, 34], [62, 34]], 1.4));
  return s;
}

function donut() {
  let s = D(circle(50, 50, 44), circle(50, 50, 14));
  const icing = D(blob([[50, 12], [70, 16], [86, 32], [88, 52], [80, 68], [70, 64], [64, 76], [50, 80], [34, 74], [24, 78], [14, 60], [14, 38], [26, 20]], 0.5), circle(50, 50, 18));
  s = D(s, edge(icing, 1.8));
  for (const [x, y, r] of [[30, 34, 20], [50, 24, -30], [68, 30, 60], [74, 50, 10], [32, 58, -60], [62, 66, 40], [44, 70, 0]]) s = D(s, T(rect(x - 3.5, y - 1, 7, 2, 1), { rot: r, cx: x, cy: y }));
  return s;
}

function pizza() {
  const slice = poly([[50, 96], [8, 16], [92, 16]]);
  let s = U(round(slice, 2), rect(4, 6, 92, 14, 7));
  s = D(s, stroke([[10, 22], [90, 22]], 1.8));
  for (const [x, y, r] of [[36, 36, 7], [62, 34, 6], [50, 56, 6.5], [48, 78, 4]]) s = D(s, ring(x, y, r - 1.5, 1.6));
  return s;
}

function pretzel() {
  const loop = cr([[50, 30], [62, 14], [80, 12], [92, 28], [88, 56], [72, 80], [50, 90], [28, 80], [12, 56], [8, 28], [20, 12], [38, 14]], true);
  let s = stroke([...loop, loop[0]], 10);
  const a1 = stroke([[46, 32], [58, 58], [68, 82]], 9, 'round', true);
  const a2 = stroke([[54, 32], [42, 58], [32, 82]], 9, 'round', true);
  s = over(over(s, a2, 1.6), a1, 1.6);
  for (const [x, y] of [[24, 30], [76, 30], [20, 58], [80, 58], [50, 82]] as Pt[]) s = D(s, ellipse(x, y, 1.2, 2));
  return s;
}

function cup() {
  let s = U(poly([[18, 30], [72, 30], [66, 84], [24, 84]]), D(circle(74, 50, 14), circle(74, 50, 7)));
  s = round(s, 2);
  s = U(s, ellipse(46, 90, 38, 5));
  s = D(s, stroke([[18, 86.5], [74, 86.5]], 1.6));
  for (const x of [34, 46, 58]) s = U(s, stroke([[x, 24], [x - 4, 16], [x + 2, 8], [x - 2, 2]], 2.6, 'round', true));
  return s;
}

function wineGlass() {
  const bowl = U(poly(arcPts(50, 30, 24, 0, 180)), rect(26, 6, 48, 24));
  let s = hollow(round(bowl, 4), 3);
  s = U(s, I(round(bowl, 4), rect(0, 34, 100, 30)));
  s = U(s, rect(48, 52, 4, 34), ellipse(50, 90, 18, 4));
  return s;
}

function beerMug() {
  let s = U(rect(22, 24, 46, 68, 4), D(rect(58, 36, 26, 40, 12), rect(66, 46, 10, 20, 4)));
  s = D(s, rect(30, 36, 4, 50, 2), rect(42, 36, 4, 50, 2), rect(54, 36, 4, 50, 2));
  s = over(s, U(circle(28, 20, 9), circle(42, 14, 10), circle(56, 18, 9), circle(64, 24, 6), rect(20, 18, 48, 10, 4)), 1.8);
  return s;
}



// ---------- Natur & Wetter ----------

function sun() {
  const rays = polar(round(poly([[50, 2], [56, 18], [44, 18]]), 0.6), 12);
  return U(rays, circle(50, 50, 24));
}

function moon() {
  let s = D(circle(46, 50, 40), circle(66, 40, 34));
  s = U(s, star(78, 74, 5, 8, 3.4));
  return s;
}

function cloud() {
  return round(U(circle(32, 58, 18), circle(52, 44, 24), circle(72, 56, 18), rect(14, 56, 76, 20, 10)), 1);
}

function rainCloud() {
  let s = round(U(circle(32, 42, 16), circle(52, 30, 22), circle(72, 42, 16), rect(16, 40, 72, 18, 9)), 1);
  for (const [x, y] of [[30, 70], [50, 76], [70, 70], [40, 90], [60, 92]] as Pt[]) s = U(s, drop(x, y, 4.2));
  return s;
}

function drop(cx: number, cy: number, r: number): Shape {
  return U(circle(cx, cy, r), poly([[cx - r * 0.95, cy - r * 0.3], [cx, cy - r * 2.6], [cx + r * 0.95, cy - r * 0.3]]));
}

function thunder() {
  let s = round(U(circle(32, 38, 16), circle(52, 26, 22), circle(72, 38, 16), rect(16, 36, 72, 18, 9)), 1);
  const bolt = poly([[56, 50], [38, 76], [50, 76], [42, 98], [66, 66], [54, 66], [62, 50]]);
  return over(s, bolt, 2);
}

function raindrop() {
  let s = round(drop(50, 64, 30), 1);
  s = D(s, stroke(arcPts(50, 64, 20, 110, 170), 3));
  return s;
}

function rainbow() {
  let s: Shape = [];
  for (let i = 0; i < 4; i++) s = U(s, arc(50, 70, 44 - i * 8, 180, 360, 6, 'butt'));
  s = U(s, U(circle(14, 76, 9), circle(24, 74, 8), rect(4, 76, 26, 8, 4)), U(circle(86, 76, 9), circle(76, 74, 8), rect(70, 76, 26, 8, 4)));
  return s;
}

function mountains() {
  let s = U(poly([[4, 90], [38, 26], [70, 90]]), poly([[40, 90], [68, 40], [96, 90]]));
  s = D(s, poly([[38, 26], [46, 41], [41, 38], [36, 44], [31, 39]]), poly([[68, 40], [74, 51], [70, 49], [66, 53], [62, 50]]));
  s = D(s, stroke([[52, 64], [60, 52]], 1.6));
  s = U(s, circle(80, 18, 8));
  return s;
}

function wave() {
  const top = [...arcPts(40, 60, 30, 180, 330), ...arcPts(52, 52, 12, 330, 540).map(([x, y]): Pt => [x, y])];
  void top;
  let s = blob([[6, 92], [8, 70], [18, 50], [34, 38], [54, 36], [70, 44], [74, 56], [66, 62], [58, 56], [52, 52], [46, 58], [48, 70], [60, 80], [80, 84], [96, 82], [96, 92]], 0.5);
  s = D(s, stroke([[16, 84], [22, 64], [36, 50], [52, 46]], 1.6, 'round', true));
  return s;
}

function flame() {
  const outer = blob([[50, 4], [58, 20], [72, 32], [80, 52], [78, 72], [66, 90], [50, 96], [34, 90], [22, 72], [22, 52], [32, 40], [36, 54], [42, 40], [44, 22]], 0.5);
  const inner = blob([[52, 44], [60, 58], [64, 72], [58, 86], [50, 89], [42, 86], [36, 74], [40, 62], [46, 66]], 0.5);
  return D(outer, edge(inner, 2), D(inner, off(inner, -100)));
}

function volcano() {
  let s = poly([[4, 94], [36, 40], [64, 40], [96, 94]]);
  s = D(s, poly([[36, 40], [44, 54], [50, 46], [56, 56], [64, 40]]));
  s = U(s, circle(50, 22, 9), circle(38, 26, 7), circle(62, 26, 7), circle(48, 10, 6));
  s = D(s, stroke([[44, 66], [38, 84]], 1.6), stroke([[58, 70], [64, 86]], 1.6));
  return s;
}

function snowmanTree() {
  return fir();
}
void snowmanTree;

// ---------- Feste ----------

function xmasTree() {
  let s = U(
    poly([[50, 10], [68, 34], [32, 34]]),
    poly([[50, 22], [76, 56], [24, 56]]),
    poly([[50, 40], [86, 82], [14, 82]]),
  );
  s = round(s, 1);
  for (const [x, y] of [[44, 30], [58, 48], [38, 50], [50, 66], [30, 74], [68, 72], [62, 62]] as Pt[]) s = D(s, circle(x, y, 2.8));
  s = U(s, rect(44, 80, 12, 14), star(50, 8, 5, 8, 3.4));
  return s;
}

function xmasStar() {
  let s = star(50, 50, 8, 48, 20, -90);
  s = D(s, polar(stroke([[50, 50], [50, 12]], 1.4), 8));
  return round(s, 0.4);
}

function bauble() {
  let s = circle(50, 58, 36);
  s = D(s, stroke([[14, 50], [30, 46], [40, 54], [50, 46], [60, 54], [70, 46], [86, 50]], 2.2, 'round'), stroke([[14, 66], [86, 66]], 2));
  for (const x of [26, 38, 50, 62, 74]) s = D(s, circle(x, 76, 2.4));
  s = U(s, rect(42, 14, 16, 10, 2), D(circle(50, 10, 6), circle(50, 10, 3.5)));
  return s;
}

function gift() {
  let s = U(rect(12, 40, 76, 16, 2), rect(18, 58, 64, 38, 2));
  s = D(s, rect(45, 38, 10, 60));
  s = U(s, rect(46.6, 40, 6.8, 56));
  const bow = U(blob([[50, 38], [36, 18], [24, 22], [26, 34]], 0.5), blob([[50, 38], [64, 18], [76, 22], [74, 34]], 0.5));
  s = U(s, D(bow, off(rect(44, 30, 12, 12, 3), 1.4)), rect(44, 30, 12, 12, 3));
  return s;
}

function candyCane() {
  let s = stroke([[60, 96], [60, 30], ...arcPts(44, 30, 16, 0, -180).slice(1), [28, 40]], 12, 'round');
  for (let y = 36; y < 96; y += 12) s = D(s, stroke([[50, y + 6], [70, y - 2]], 3));
  s = D(s, T(stroke([[50, 14], [44, 24]], 3), {}), stroke([[30, 26], [38, 30]], 3));
  return s;
}

function snowflake(variant: number) {
  return () => {
    let arm: Shape;
    if (variant === 0) {
      arm = U(stroke([[50, 50], [50, 6]], 4), stroke([[50, 22], [40, 12]], 3), stroke([[50, 22], [60, 12]], 3), stroke([[50, 36], [38, 26]], 3), stroke([[50, 36], [62, 26]], 3));
    } else if (variant === 1) {
      arm = U(stroke([[50, 50], [50, 8]], 3.6), ngon(50, 22, 4, 6, 0), stroke([[50, 34], [42, 40]], 3), stroke([[50, 34], [58, 40]], 3), circle(50, 7, 3.5));
    } else {
      arm = U(stroke([[50, 50], [50, 4]], 3.2), leaf([50, 44], [50, 14], 10), stroke([[50, 16], [42, 8]], 2.6), stroke([[50, 16], [58, 8]], 2.6));
      arm = D(arm, stroke([[50, 40], [50, 18]], 1.4));
    }
    let s = polar(arm, 6);
    s = U(s, ngon(50, 50, 6, 8, 0));
    if (variant !== 1) s = D(s, circle(50, 50, 3));
    return s;
  };
}

function snowman() {
  let s = U(circle(50, 74, 22), circle(50, 40, 15));
  s = over(s, U(rect(36, 14, 28, 6, 1), rect(41, 0, 18, 16, 2)), 1.6);
  s = D(s, circle(45, 37, 1.8), circle(55, 37, 1.8), circle(50, 64, 2.2), circle(50, 74, 2.2), circle(50, 84, 2.2));
  s = D(s, poly([[50, 42], [64, 44], [50, 46]]));
  s = D(s, stroke([[36, 52], [64, 52]], 2.2));
  s = U(s, stroke([[30, 64], [14, 52], [10, 44]], 2.4, 'round', true), stroke([[70, 64], [86, 52], [90, 44]], 2.4, 'round', true));
  return s;
}

function gingerbread() {
  let s = U(circle(50, 22, 15), rect(32, 34, 36, 40, 10), stroke([[36, 42], [14, 54]], 14), stroke([[64, 42], [86, 54]], 14), stroke([[40, 66], [30, 90]], 15), stroke([[60, 66], [70, 90]], 15));
  s = D(s, circle(45, 20, 2.2), circle(55, 20, 2.2), stroke(arcPts(50, 23, 6, 30, 150), 1.8));
  s = D(s, circle(50, 46, 2.6), circle(50, 58, 2.6));
  s = D(s, stroke([[16, 50], [20, 58]], 1.5), stroke([[84, 50], [80, 58]], 1.5), stroke([[27, 84], [36, 88]], 1.5), stroke([[73, 84], [64, 88]], 1.5));
  return s;
}

function bell(cx: number, cy: number, rot: number): Shape {
  let b = U(sym([[50, 20], [60, 22], [66, 36], [68, 58], [78, 72], [50, 72]], 50, 0.5), circle(50, 78, 6));
  b = D(b, stroke([[24, 72.5], [76, 72.5]], 1.6));
  return T(b, { rot, cx: 50, cy: 20, dx: cx - 50, dy: cy - 20 });
}
function bells() {
  let s = U(bell(36, 32, 20), bell(64, 32, -20));
  s = U(s, U(blob([[50, 26], [36, 10], [28, 16], [36, 24]]), blob([[50, 26], [64, 10], [72, 16], [64, 24]]), circle(50, 26, 5)));
  return s;
}

function candle() {
  let s = rect(36, 40, 28, 54, 3);
  s = D(s, stroke([[36, 52], [44, 48], [48, 56]], 2, 'round', true));
  s = U(s, stroke([[50, 40], [50, 32]], 2), blob([[50, 4], [58, 18], [58, 26], [50, 30], [42, 26], [42, 18]], 0.5));
  s = D(s, blob([[50, 14], [54, 22], [50, 26], [46, 22]], 0.5));
  return s;
}

function santaHat() {
  const hat = blob([[18, 76], [24, 50], [40, 26], [62, 14], [80, 18], [90, 30], [86, 44], [80, 32], [68, 34], [72, 52], [80, 76]], 0.45);
  let s = over(hat, round(rect(10, 70, 80, 18, 9), 1), 2);
  s = over(s, circle(88, 50, 9), 1.6);
  return s;
}

function stocking() {
  let s = blob([[34, 22], [64, 22], [64, 64], [80, 72], [90, 84], [82, 96], [60, 96], [40, 88], [34, 74]], 0.35);
  s = over(s, rect(28, 6, 42, 18, 4), 1.8);
  s = D(s, stroke([[38, 40], [60, 40]], 1.6), stroke([[38, 52], [60, 52]], 1.6));
  return s;
}

function easterEgg() {
  let s = sym([[50, 4], [64, 10], [76, 34], [80, 62], [72, 84], [50, 96]], 50, 0.5);
  const zig: Pt[] = [];
  for (let i = 0; i <= 10; i++) zig.push([16 + i * 6.8, i % 2 ? 48 : 40]);
  s = D(s, stroke(zig, 2.2, 'round', false, 'miter'), stroke([[16, 62], [84, 62]], 2.2), stroke([[24, 30], [76, 30]], 2.2));
  for (const x of [32, 44, 56, 68]) s = D(s, circle(x, 74, 2.6));
  return s;
}

function easterBunny() {
  const body = blob([[40, 50], [56, 46], [70, 56], [78, 74], [74, 92], [30, 92], [28, 74], [32, 60]], 0.5);
  const head = circle(42, 38, 14);
  const ears = U(ellipse(36, 14, 6, 15, -12), ellipse(50, 14, 6, 15, 14));
  let s = U(over(ears, head, 1.8), body, circle(82, 82, 7));
  s = D(s, stroke(arcPts(42, 38, 15, 30, 110), 1.6));
  s = D(s, circle(37, 35, 1.8));
  s = D(s, stroke([[46, 72], [44, 92]], 1.5));
  return s;
}

function pumpkin() {
  let s = U(ellipse(32, 58, 22, 32), ellipse(68, 58, 22, 32), ellipse(50, 58, 24, 34));
  s = U(s, taper([[50, 30], [52, 18], [58, 10]], 8, 5));
  s = D(s, poly([[30, 46], [42, 46], [36, 36]]), poly([[58, 46], [70, 46], [64, 36]]), poly([[46, 58], [54, 58], [50, 52]]));
  s = D(s, poly([[26, 66], [34, 70], [40, 66], [46, 72], [54, 72], [60, 66], [66, 70], [74, 66], [70, 78], [60, 82], [50, 84], [40, 82], [30, 78]]));
  return s;
}

function ghost() {
  const pts: Pt[] = [...arcPts(50, 40, 32, 180, 360)];
  pts.push([82, 92], [72, 84], [62, 94], [50, 84], [38, 94], [28, 84], [18, 92]);
  let s = round(poly(pts), 2);
  s = D(s, ellipse(40, 40, 5, 7), ellipse(60, 40, 5, 7), ellipse(50, 60, 6, 8));
  return s;
}

function witchHat() {
  const cone = blob([[30, 74], [40, 50], [50, 26], [58, 12], [74, 6], [64, 18], [62, 40], [70, 74]], 0.4);
  let s = U(cone, ellipse(50, 80, 46, 10));
  s = D(s, stroke([[32, 70], [68, 70]], 6));
  s = U(s, rect(44, 66, 12, 8, 1));
  s = D(s, rect(47, 68, 6, 4));
  return s;
}

function birthdayCake() {
  let s = U(rect(14, 62, 72, 32, 3), rect(24, 38, 52, 22, 3));
  s = D(s, stroke([[14, 72], [26, 78], [38, 72], [50, 78], [62, 72], [74, 78], [86, 72]], 2), stroke([[24, 46], [36, 52], [50, 46], [64, 52], [76, 46]], 2));
  for (const x of [36, 50, 64]) s = U(s, rect(x - 2.5, 20, 5, 16, 1), blob([[x, 6], [x + 4, 14], [x, 18], [x - 4, 14]], 0.5));
  return s;
}

function balloons() {
  const b = (cx: number, cy: number) => U(ellipse(cx, cy, 15, 19), poly([[cx - 4, cy + 21], [cx + 4, cy + 21], [cx, cy + 17]]));
  let s = over(over(b(30, 30), b(70, 28)), b(50, 42));
  for (const [x, y] of [[30, 51], [70, 49], [50, 63]] as Pt[]) s = U(s, stroke([[x, y], [x + 3, y + 10], [x - 2, y + 22], [50, 98]], 1.4, 'round', true));
  s = D(s, stroke(arcPts(46, 40, 10, 200, 250), 2), stroke(arcPts(26, 28, 10, 200, 250), 2), stroke(arcPts(66, 26, 10, 200, 250), 2));
  return s;
}

function weddingRings() {
  const A = ring(38, 60, 23, 7),
    B = ring(62, 60, 23, 7);
  const upper = rect(0, 0, 100, 60),
    lower = rect(0, 60, 100, 60);
  let s = U(D(B, off(I(A, upper), 1.6)), D(A, off(I(B, lower), 1.6)));
  s = over(s, round(ngon(62, 30, 4, 9, -90), 0.5), 1.6);
  return s;
}

const A = (...a: [string, string, string, string, () => Shape, number?][]) => a;

export const NATURE: Def[] = [
  ...group('motif', 'plants', A(
    ['leaf', 'Blatt', 'Leaf', 'Blatt/leaf, Natur/nature', leafSimple],
    ['maple-leaf', 'Ahornblatt', 'Maple leaf', 'Ahorn/maple, Blatt/leaf, Herbst/autumn, Kanada/canada', maple],
    ['oak-leaf', 'Eichenblatt', 'Oak leaf', 'Eiche/oak, Blatt/leaf, Herbst/autumn', oakLeaf],
    ['ginkgo-leaf', 'Ginkgoblatt', 'Ginkgo leaf', 'Ginkgo/ginkgo, Blatt/leaf, Japan/japan', ginkgo],
    ['monstera', 'Monstera-Blatt', 'Monstera leaf', 'Monstera/monstera, Blatt/leaf, Zimmerpflanze/houseplant, tropisch/tropical', monstera],
    ['fern', 'Farn', 'Fern', 'Farn/fern, Wald/forest', fern],
    ['tree', 'Laubbaum', 'Tree', 'Baum/tree, Wald/forest, Natur/nature', tree],
    ['fir', 'Tanne', 'Fir tree', 'Tanne/fir, Baum/tree, Wald/forest', fir],
    ['palm', 'Palme', 'Palm tree', 'Palme/palm, Strand/beach, Urlaub/holiday, tropisch/tropical', palm],
    ['tulip', 'Tulpe', 'Tulip', 'Tulpe/tulip, Blume/flower, Frühling/spring', tulip],
    ['daisy', 'Gänseblümchen', 'Daisy', 'Blume/flower, Blüte/blossom', daisy],
    ['rose', 'Rose', 'Rose', 'Rose/rose, Blume/flower, Liebe/love', rose],
    ['sunflower', 'Sonnenblume', 'Sunflower', 'Sonnenblume/sunflower, Blume/flower, Sommer/summer', sunflower],
    ['cactus', 'Kaktus', 'Cactus', 'Kaktus/cactus, Zimmerpflanze/houseplant, Wüste/desert', cactus],
    ['mushroom', 'Fliegenpilz', 'Toadstool', 'Pilz/mushroom, Wald/forest, Glück/luck', mushroom],
    ['lotus', 'Lotusblüte', 'Lotus', 'Lotus/lotus, Yoga/yoga, Blume/flower', lotus],
    ['clover', 'Glücksklee', 'Four-leaf clover', 'Klee/clover, Glück/luck, Irland/ireland', clover],
    ['acorn', 'Eichel', 'Acorn', 'Eichel/acorn, Herbst/autumn', acorn],
    ['sprout', 'Keimling', 'Sprout', 'Keimling/sprout, Wachstum/growth, Garten/garden', sprout],
    ['wheat', 'Weizenähre', 'Ear of wheat', 'Weizen/wheat, Getreide/grain, Ernte/harvest, Bäcker/bakery', wheat],
    ['cherry-blossom', 'Kirschblüte', 'Cherry blossom', 'Kirschblüte/cherry blossom, Sakura/sakura, Japan/japan, Frühling/spring', cherryBlossom],
    ['potted-plant', 'Topfpflanze', 'Potted plant', 'Zimmerpflanze/houseplant, Topf/pot', pottedPlant],
    ['branch', 'Zweig', 'Branch', 'Zweig/branch, Blätter/leaves', branch],
    ['lavender', 'Lavendel', 'Lavender', 'Lavendel/lavender, Kräuter/herbs', lavender],
  )),
  ...group('motif', 'food', A(
    ['apple', 'Apfel', 'Apple', 'Apfel/apple, Obst/fruit, Schule/school', apple],
    ['pear', 'Birne', 'Pear', 'Birne/pear, Obst/fruit', pear],
    ['cherries', 'Kirschen', 'Cherries', 'Kirsche/cherry, Obst/fruit', cherries],
    ['strawberry', 'Erdbeere', 'Strawberry', 'Erdbeere/strawberry, Obst/fruit, Sommer/summer', strawberry],
    ['lemon', 'Zitronenscheibe', 'Lemon slice', 'Zitrone/lemon, Zitrus/citrus, Obst/fruit', lemon],
    ['grapes', 'Weintrauben', 'Grapes', 'Trauben/grapes, Wein/wine, Obst/fruit', grapes],
    ['watermelon', 'Wassermelone', 'Watermelon', 'Melone/melon, Obst/fruit, Sommer/summer', watermelon],
    ['carrot', 'Karotte', 'Carrot', 'Karotte/carrot, Möhre/carrot, Gemüse/vegetable, Ostern/easter', carrot],
    ['avocado', 'Avocado', 'Avocado', 'Avocado/avocado, Gemüse/vegetable', avocado],
    ['ice-cream', 'Eistüte', 'Ice cream cone', 'Eis/ice cream, Sommer/summer, Dessert/dessert', iceCream],
    ['cupcake', 'Cupcake', 'Cupcake', 'Kuchen/cake, Muffin/muffin, Geburtstag/birthday, Backen/baking', cupcake],
    ['donut', 'Donut', 'Doughnut', 'Donut/donut, Süßes/sweets', donut],
    ['pizza', 'Pizzastück', 'Pizza slice', 'Pizza/pizza, Italien/italy', pizza],
    ['pretzel', 'Brezel', 'Pretzel', 'Brezel/pretzel, Bäcker/bakery, Oktoberfest/oktoberfest, Bayern/bavaria', pretzel],
    ['coffee-cup', 'Kaffeetasse', 'Coffee cup', 'Kaffee/coffee, Tasse/cup, Tee/tea, Café/cafe', cup],
    ['wine-glass', 'Weinglas', 'Wine glass', 'Wein/wine, Glas/glass, Prost/cheers', wineGlass],
    ['beer-mug', 'Bierkrug', 'Beer mug', 'Bier/beer, Oktoberfest/oktoberfest, Prost/cheers', beerMug],
  )),
  ...group('motif', 'nature', A(
    ['sun', 'Sonne', 'Sun', 'Sonne/sun, Sommer/summer, Wetter/weather', sun],
    ['moon', 'Mond und Stern', 'Moon and star', 'Mond/moon, Stern/star, Nacht/night, schlafen/sleep', moon],
    ['cloud', 'Wolke', 'Cloud', 'Wolke/cloud, Himmel/sky, Wetter/weather', cloud],
    ['rain-cloud', 'Regenwolke', 'Rain cloud', 'Regen/rain, Wolke/cloud, Wetter/weather', rainCloud],
    ['thunderstorm', 'Gewitter', 'Thunderstorm', 'Blitz/lightning, Gewitter/storm, Wetter/weather', thunder],
    ['raindrop', 'Tropfen', 'Drop', 'Tropfen/drop, Wasser/water', raindrop],
    ['rainbow', 'Regenbogen', 'Rainbow', 'Regenbogen/rainbow, Kinder/kids', rainbow],
    ['mountains', 'Berge', 'Mountains', 'Berge/mountains, Wandern/hiking, Alpen/alps', mountains],
    ['wave', 'Welle', 'Wave', 'Welle/wave, Meer/sea, Surfen/surfing', wave],
    ['flame', 'Flamme', 'Flame', 'Feuer/fire, Flamme/flame', flame],
    ['volcano', 'Vulkan', 'Volcano', 'Vulkan/volcano, Berg/mountain', volcano],
  )),
  ...group('motif', 'holidays', A(
    ['xmas-tree', 'Weihnachtsbaum', 'Christmas tree', 'Weihnachten/christmas, Tanne/fir, Winter/winter', xmasTree],
    ['xmas-star', 'Weihnachtsstern', 'Christmas star', 'Weihnachten/christmas, Stern/star', xmasStar],
    ['bauble', 'Christbaumkugel', 'Bauble', 'Weihnachten/christmas, Kugel/ornament', bauble],
    ['gift', 'Geschenk', 'Gift', 'Geschenk/gift, Geburtstag/birthday, Weihnachten/christmas', gift],
    ['candy-cane', 'Zuckerstange', 'Candy cane', 'Weihnachten/christmas, Süßes/sweets', candyCane],
    ['snowflake-1', 'Schneeflocke 1', 'Snowflake 1', 'Schnee/snow, Winter/winter, Weihnachten/christmas', snowflake(0)],
    ['snowflake-2', 'Schneeflocke 2', 'Snowflake 2', 'Schnee/snow, Winter/winter, Weihnachten/christmas', snowflake(1)],
    ['snowflake-3', 'Schneeflocke 3', 'Snowflake 3', 'Schnee/snow, Winter/winter, Weihnachten/christmas', snowflake(2)],
    ['snowman', 'Schneemann', 'Snowman', 'Schnee/snow, Winter/winter, Weihnachten/christmas', snowman],
    ['gingerbread', 'Lebkuchenmann', 'Gingerbread man', 'Lebkuchen/gingerbread, Weihnachten/christmas, Backen/baking', gingerbread],
    ['bells', 'Glocken', 'Bells', 'Glocke/bell, Weihnachten/christmas, Hochzeit/wedding', bells],
    ['candle', 'Kerze', 'Candle', 'Kerze/candle, Advent/advent, Weihnachten/christmas', candle],
    ['santa-hat', 'Weihnachtsmütze', 'Santa hat', 'Weihnachten/christmas, Mütze/hat', santaHat],
    ['stocking', 'Nikolausstiefel', 'Christmas stocking', 'Weihnachten/christmas, Nikolaus/st nicholas', stocking],
    ['easter-egg', 'Osterei', 'Easter egg', 'Ostern/easter, Ei/egg', easterEgg],
    ['easter-bunny', 'Osterhase', 'Easter bunny', 'Ostern/easter, Hase/rabbit', easterBunny],
    ['pumpkin', 'Kürbisgesicht', 'Jack-o’-lantern', 'Halloween/halloween, Kürbis/pumpkin, Herbst/autumn', pumpkin],
    ['ghost', 'Gespenst', 'Ghost', 'Halloween/halloween, Geist/ghost', ghost],
    ['witch-hat', 'Hexenhut', 'Witch hat', 'Halloween/halloween, Hexe/witch', witchHat],
    ['birthday-cake', 'Geburtstagstorte', 'Birthday cake', 'Geburtstag/birthday, Torte/cake, Party/party', birthdayCake],
    ['balloons', 'Luftballons', 'Balloons', 'Geburtstag/birthday, Party/party, Ballon/balloon', balloons],
    ['wedding-rings', 'Eheringe', 'Wedding rings', 'Hochzeit/wedding, Ringe/rings, Liebe/love', weddingRings],
  )),
];
void [hollow, rect, ring, mirror, ngon, edge];
