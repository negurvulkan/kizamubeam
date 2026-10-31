// Motive: Tiere, Vögel, Meer, Insekten
import { Def, group } from './defs';
import {
  arcPts, blob, circle, D, edge, ellipse, hollow, mirror, ngon, off, over, poly, polar, rect, ring, round, star, stroke, sym,
  T, U, I, Pt, Shape,
} from './kit';

const eyes = (s: Shape, y: number, dx: number, r: number) => D(s, circle(50 - dx, y, r), circle(50 + dx, y, r));

// ---------- Tiere ----------

function catHead() {
  const ears = mirror(round(poly([[22, 50], [24, 12], [48, 34]]), 3));
  let s = U(ellipse(50, 58, 31, 26), ears);
  s = D(s, mirror(poly([[28, 38], [28, 21], [40, 33]])));
  s = D(s, ellipse(38, 54, 5.5, 6.5), ellipse(62, 54, 5.5, 6.5));
  s = U(s, ellipse(38, 54, 1.7, 5), ellipse(62, 54, 1.7, 5));
  s = D(s, poly([[45, 64], [55, 64], [50, 69.5]]));
  s = D(s, stroke([[50, 69], [50, 72]], 1.6), stroke(arcPts(46, 71, 4, 10, 120), 1.6), stroke(arcPts(54, 71, 4, 60, 170), 1.6));
  s = D(s, mirror(U(stroke([[37, 67], [25, 65]], 1.5), stroke([[37, 70], [26, 72]], 1.5))));
  return s;
}

function dogHead() {
  const face = sym([[50, 22], [63, 24], [71, 35], [72, 52], [68, 68], [60, 79], [50, 82]]);
  const ears = mirror(blob([[34, 24], [22, 22], [12, 38], [12, 58], [19, 66], [27, 58], [30, 40]]));
  let s = over(ears, face, 2);
  s = eyes(s, 47, 11, 4);
  const nose = ellipse(50, 64, 8, 5.5);
  s = U(D(s, off(nose, 1.6)), nose);
  s = D(s, stroke([[50, 70], [50, 74]], 1.6), stroke(arcPts(45, 73, 5, 0, 110), 1.6), stroke(arcPts(55, 73, 5, 70, 180), 1.6));
  return s;
}

function foxHead() {
  const head = sym([[50, 36], [62, 34], [78, 40], [86, 50], [74, 56], [62, 68], [50, 82]], 50, 0.35);
  const ears = mirror(round(poly([[54, 38], [76, 8], [80, 44]]), 2));
  let s = U(head, ears);
  s = D(s, mirror(poly([[64, 36], [74, 18], [76, 40]])));
  s = D(s, ellipse(39, 53, 5, 2.4, 25), ellipse(61, 53, 5, 2.4, -25));
  // Maske: Fuge von den Wangen zur Nase
  s = D(s, mirror(stroke([[80, 52], [66, 58], [57, 70], [53, 76]], 1.5, 'round', true)));
  s = D(s, circle(50, 78, 2.6));
  return s;
}

function owl() {
  const body = sym([[50, 22], [62, 22], [74, 14], [76, 30], [80, 50], [78, 72], [68, 88], [50, 92]], 50, 0.4);
  let s = body;
  s = D(s, circle(38, 42, 11), circle(62, 42, 11));
  s = U(s, circle(38, 42, 5), circle(62, 42, 5));
  s = D(s, poly([[46, 50], [54, 50], [50, 60]]));
  s = D(s, mirror(stroke(arcPts(50, 54, 26, 20, 75), 1.6)));
  for (const [x, y] of [[44, 66], [56, 66], [50, 74], [40, 76], [60, 76]] as Pt[]) s = D(s, stroke([[x - 3.5, y - 2], [x, y + 1], [x + 3.5, y - 2]], 1.4));
  s = U(s, mirror(stroke([[42, 90], [40, 96]], 3)), mirror(stroke([[46, 91], [46, 97]], 3)));
  return s;
}

function bearHead() {
  let s = over(U(circle(26, 30, 12), circle(74, 30, 12)), circle(50, 56, 30), 2);
  s = D(s, circle(25, 28, 5.5), circle(75, 28, 5.5));
  s = eyes(s, 48, 12, 3.6);
  const muzzle = ellipse(50, 66, 13, 10);
  s = D(s, edge(muzzle, 1.6));
  s = D(s, ellipse(50, 62, 5.5, 3.8));
  s = D(s, stroke([[50, 66], [50, 70]], 1.5), stroke(arcPts(46, 69, 4, 20, 120), 1.5), stroke(arcPts(54, 69, 4, 60, 160), 1.5));
  return s;
}

function panda() {
  const face = ellipse(50, 56, 32, 28);
  let s = U(hollow(face, 3), D(U(circle(24, 30, 11), circle(76, 30, 11)), off(face, 1.6)));
  const patch = (cx: number, rot: number) => ellipse(cx, 52, 7.5, 10, rot);
  s = U(s, D(U(patch(38, 30), patch(62, -30)), circle(39, 50, 3), circle(61, 50, 3)));
  s = U(s, ellipse(50, 64, 5, 3.5));
  s = U(s, stroke([[50, 66], [50, 70]], 1.6), stroke(arcPts(46, 69, 4, 20, 130), 1.6), stroke(arcPts(54, 69, 4, 50, 160), 1.6));
  return s;
}

function rabbit() {
  const head = ellipse(50, 66, 24, 21);
  const ears = U(ellipse(40, 30, 8, 22, -8), ellipse(60, 30, 8, 22, 8));
  let s = over(ears, head, 2);
  s = D(s, ellipse(40, 31, 3.5, 15, -8), ellipse(60, 31, 3.5, 15, 8));
  s = eyes(s, 62, 9, 3);
  s = D(s, poly([[47, 70], [53, 70], [50, 73]]));
  s = D(s, stroke([[50, 73], [50, 76]], 1.4), stroke(arcPts(47, 75, 3, 10, 130), 1.4), stroke(arcPts(53, 75, 3, 50, 170), 1.4));
  return s;
}

function mouse() {
  const head = ellipse(50, 60, 24, 21);
  let s = over(U(circle(28, 34, 16), circle(72, 34, 16)), head, 2);
  s = D(s, circle(28, 34, 9), circle(72, 34, 9));
  s = eyes(s, 56, 9, 3);
  s = D(s, circle(50, 69, 3));
  s = D(s, mirror(U(stroke([[42, 70], [32, 68]], 1.3), stroke([[42, 73], [33, 75]], 1.3))));
  return s;
}

function pig() {
  const face = ellipse(50, 56, 32, 27);
  const ears = mirror(round(poly([[26, 40], [18, 14], [44, 30]]), 3));
  let s = over(ears, face, 2);
  s = eyes(s, 46, 13, 3.5);
  const snout = ellipse(50, 64, 13, 9);
  s = D(s, edge(snout, 1.6));
  s = D(s, ellipse(45, 64, 2.4, 3.5), ellipse(55, 64, 2.4, 3.5));
  return s;
}

function lion() {
  const mane = polar(circle(50, 20, 11), 14, 50, 52);
  const face = circle(50, 54, 25);
  let s = over(U(mane, circle(50, 52, 33)), face, 2);
  s = U(s, D(U(circle(32, 34, 6), circle(68, 34, 6)), off(face, 1.6)));
  s = eyes(s, 48, 9, 3);
  s = D(s, round(poly([[44, 58], [56, 58], [50, 65]]), 1));
  s = D(s, stroke([[50, 65], [50, 69]], 1.5), stroke(arcPts(46, 68, 4, 10, 130), 1.5), stroke(arcPts(54, 68, 4, 50, 170), 1.5));
  return s;
}

function monkey() {
  const head = circle(50, 50, 26);
  let s = U(head, circle(23, 52, 10), circle(77, 52, 10));
  s = D(s, circle(23, 52, 5), circle(77, 52, 5));
  const mask = U(circle(41, 46, 10), circle(59, 46, 10), ellipse(50, 62, 17, 12));
  s = D(s, edge(mask, 1.6));
  s = D(s, circle(42, 46, 3), circle(58, 46, 3));
  s = D(s, circle(47, 58, 1.4), circle(53, 58, 1.4));
  s = D(s, stroke(arcPts(50, 62, 8, 30, 150), 1.6));
  return s;
}

function penguin() {
  const body = sym([[50, 8], [60, 9], [67, 18], [68, 34], [76, 50], [80, 70], [74, 86], [60, 92], [50, 92]], 50, 0.45);
  let s = body;
  const belly = sym([[50, 30], [56, 22], [62, 30], [64, 50], [68, 70], [62, 84], [50, 87]], 50, 0.45);
  s = D(s, belly);
  s = U(s, D(sym([[50, 30], [56, 22], [61, 28], [52, 34], [50, 34]]), poly([[0, 0]])));
  s = D(s, circle(43, 21, 2.6), circle(57, 21, 2.6));
  s = U(s, poly([[45, 27], [55, 27], [50, 34]]));
  s = U(s, mirror(ellipse(41, 94, 8, 3)));
  s = D(s, mirror(stroke([[68, 40], [76, 58], [80, 68]], 1.6, 'round', true)));
  return s;
}

function frog() {
  const head = ellipse(50, 60, 38, 26);
  let s = U(head, circle(30, 36, 14), circle(70, 36, 14));
  s = D(s, circle(30, 36, 9), circle(70, 36, 9));
  s = U(s, circle(30, 37, 4.5), circle(70, 37, 4.5));
  s = D(s, stroke(arcPts(50, 50, 26, 30, 150), 1.8));
  s = D(s, circle(45, 52, 1.3), circle(55, 52, 1.3));
  s = D(s, circle(24, 64, 4), circle(76, 64, 4));
  return s;
}

function elephant() {
  const body = blob([[30, 38], [50, 30], [72, 32], [86, 42], [88, 58], [86, 74], [80, 74], [78, 88], [70, 88], [68, 76], [44, 76], [42, 88], [34, 88], [32, 70], [28, 56]]);
  const head = blob([[22, 30], [36, 26], [44, 36], [42, 52], [34, 60], [26, 64], [18, 56]]);
  const trunk = stroke([[20, 56], [14, 68], [12, 80], [16, 86]], 7, 'round', true);
  const ear = blob([[34, 34], [46, 30], [52, 42], [50, 58], [40, 62], [34, 52]]);
  let s = U(body, head, trunk, stroke([[87, 50], [94, 62]], 2.5));
  s = over(s, ear, 1.8);
  s = D(s, circle(27, 40, 2.4));
  s = D(s, stroke([[26, 56], [34, 64]], 2.2));
  s = D(s, stroke([[44, 76], [44, 88]], 1.6), stroke([[70, 76], [70, 88]], 1.6));
  return s;
}

function horseHead() {
  const head = blob([
    [56, 8], [62, 14], [66, 22], [74, 30], [82, 50], [90, 66], [92, 76], [86, 82], [76, 80], [66, 70], [58, 62], [52, 74], [48, 92], [20, 92], [24, 70], [30, 50], [40, 30], [48, 20],
  ], 0.45);
  const mane = blob([[48, 18], [40, 22], [30, 34], [22, 50], [16, 70], [14, 92], [24, 92], [30, 50], [40, 30]], 0.4);
  let s = over(head, mane, 1.8);
  s = D(s, ellipse(66, 38, 3, 2, 30));
  s = D(s, ellipse(86, 72, 2, 3, 30));
  s = D(s, stroke([[62, 16], [66, 6]], 1.6));
  return s;
}

function stag() {
  const head = sym([[50, 40], [60, 40], [64, 50], [60, 66], [55, 84], [50, 88]], 50, 0.4);
  const ears = mirror(ellipse(70, 44, 10, 4.5, -20));
  const antler = U(
    stroke([[58, 38], [66, 26], [72, 12], [74, 2]], 4, 'round', true),
    stroke([[64, 30], [76, 26], [86, 18]], 3.4, 'round', true),
    stroke([[69, 20], [80, 12], [84, 2]], 3, 'round', true),
    stroke([[62, 34], [70, 34]], 3),
  );
  let s = U(over(ears, head, 1.6), mirror(antler));
  s = eyes(s, 54, 7, 2.4);
  s = D(s, ellipse(46, 82, 2, 3), ellipse(54, 82, 2, 3));
  return s;
}

function whale() {
  const body = blob([[10, 50], [18, 34], [40, 28], [62, 34], [76, 46], [84, 52], [92, 44], [98, 36], [96, 52], [100, 66], [90, 60], [82, 62], [70, 66], [50, 72], [24, 70], [12, 62]], 0.45);
  let s = body;
  s = D(s, circle(26, 50, 2.6));
  s = D(s, stroke([[14, 58], [30, 62], [52, 64]], 1.5, 'round', true), stroke([[20, 64], [34, 66.5], [48, 67.5]], 1.4, 'round', true));
  s = U(s, stroke([[34, 24], [30, 14], [24, 10]], 2.4, 'round', true), stroke([[34, 24], [38, 14], [44, 10]], 2.4, 'round', true));
  return s;
}


function turtle() {
  const shell = ellipse(50, 52, 26, 30);
  let s = U(
    circle(50, 16, 8),
    ellipse(26, 32, 9, 5, -40), ellipse(74, 32, 9, 5, 40), ellipse(26, 74, 9, 5, 40), ellipse(74, 74, 9, 5, -40),
    poly([[47, 80], [53, 80], [50, 90]]),
  );
  s = over(s, shell, 2);
  const hex = ngon(50, 52, 6, 10, 0);
  s = D(s, edge(hex, 1.6));
  for (let i = 0; i < 6; i++) s = D(s, T(stroke([[50, 61], [50, 80]], 1.6), { rot: i * 60 + 30, cx: 50, cy: 52 }));
  s = D(s, circle(46, 14, 1.5), circle(54, 14, 1.5));
  return s;
}

function snail() {
  const body = blob([[8, 84], [20, 76], [60, 74], [82, 70], [90, 60], [96, 64], [94, 78], [86, 86], [60, 88], [14, 90]]);
  const shell = circle(48, 50, 26);
  let s = over(body, shell, 2);
  const sp: Pt[] = [];
  for (let a = 0; a < 720; a += 8) {
    const r = 3 + (a / 720) * 18;
    sp.push([48 + r * Math.cos((a * Math.PI) / 180), 50 + r * Math.sin((a * Math.PI) / 180)]);
  }
  s = D(s, stroke(sp, 2));
  s = U(s, stroke([[88, 64], [86, 48], [84, 42]], 2.2, 'round', true), stroke([[92, 64], [96, 50], [98, 44]], 2.2, 'round', true), circle(84, 41, 2.6), circle(98, 43, 2.6));
  return s;
}

function hedgehog() {
  const spikes: Pt[] = [];
  for (let i = 0; i <= 14; i++) {
    const a = 190 + (i * 150) / 14;
    const r = i % 2 ? 30 : 40;
    spikes.push([52 + r * Math.cos((a * Math.PI) / 180), 66 + r * Math.sin((a * Math.PI) / 180)]);
  }
  const back = poly([[12, 70], ...spikes, [92, 66], [90, 76], [20, 78]]);
  const face = blob([[64, 44], [80, 52], [96, 64], [92, 70], [80, 76], [64, 76], [58, 60]]);
  let s = over(back, face, 1.8);
  s = U(s, circle(96, 66, 3));
  s = D(s, circle(78, 58, 2));
  s = U(s, rect(30, 74, 6, 12, 3), rect(62, 74, 6, 12, 3));
  return s;
}

function koala() {
  const fluff = (cx: number) => U(circle(cx, 36, 16), circle(cx + (cx < 50 ? -8 : 8), 30, 8), circle(cx + (cx < 50 ? -6 : 6), 46, 8));
  const head = ellipse(50, 56, 28, 26);
  let s = over(U(fluff(24), fluff(76)), head, 2);
  s = D(s, circle(24, 38, 7), circle(76, 38, 7));
  s = eyes(s, 50, 12, 3);
  const nose = round(sym([[50, 50], [56, 51], [58, 60], [56, 70], [50, 72]]), 1);
  s = U(D(s, off(nose, 1.6)), nose);
  return s;
}

function dino() {
  const body = blob([
    [6, 86], [18, 70], [30, 56], [44, 50], [56, 46], [64, 36], [66, 22], [70, 12], [80, 8], [90, 12], [92, 18], [84, 20], [76, 24], [74, 40], [76, 56], [72, 70], [66, 76], [66, 92], [58, 92], [56, 78], [44, 78], [44, 92], [36, 92], [36, 76], [24, 76], [12, 84],
  ], 0.4);
  let s = D(body, circle(80, 14, 1.8));
  s = D(s, stroke([[58, 60], [62, 66]], 1.4));
  return s;
}

function tRex() {
  const body = blob([
    [4, 40], [24, 42], [40, 38], [52, 30], [58, 18], [66, 12], [84, 12], [96, 18], [96, 26], [82, 28], [92, 32], [90, 38], [74, 38], [70, 46], [66, 56], [58, 66], [62, 80], [70, 90], [56, 92], [50, 82], [46, 70], [36, 66], [40, 82], [44, 92], [30, 92], [30, 76], [24, 60], [14, 52],
  ], 0.35);
  let s = U(body, stroke([[68, 48], [76, 52], [78, 56]], 2.6, 'round', true));
  s = D(s, circle(74, 18, 1.8));
  s = D(s, stroke([[82, 28], [92, 28]], 1.2));
  return s;
}

function sittingCat() {
  const body = blob([[36, 36], [44, 42], [56, 50], [66, 64], [70, 80], [68, 92], [30, 92], [26, 82], [28, 64], [30, 48]], 0.45);
  const head = U(circle(36, 28, 13), poly([[25, 24], [24, 8], [34, 17]]), poly([[38, 16], [46, 8], [47, 22]]));
  const tail = stroke([[66, 90], [80, 90], [90, 82], [90, 70], [84, 64]], 5, 'round', true);
  let s = U(body, round(head, 1.2), tail);
  s = D(s, stroke([[44, 72], [44, 92]], 1.5));
  return s;
}

function sittingDog() {
  const body = blob([[40, 30], [52, 36], [60, 50], [66, 70], [70, 86], [72, 92], [32, 92], [34, 78], [30, 60], [34, 44]], 0.45);
  const head = blob([[26, 18], [36, 10], [48, 12], [54, 22], [50, 32], [42, 38], [30, 36], [16, 34], [12, 28], [16, 22]], 0.45);
  const ear = blob([[38, 14], [48, 14], [52, 26], [48, 36], [42, 30]], 0.45);
  let s = U(body, head, stroke([[70, 86], [84, 80], [90, 66]], 4.5, 'round', true));
  s = over(s, ear, 1.6);
  s = D(s, circle(32, 22, 1.8));
  s = U(D(s, circle(13, 27, 3.5)), circle(13, 27, 2));
  s = D(s, stroke([[48, 70], [46, 92]], 1.5));
  return s;
}

function cowHead() {
  const head = sym([[50, 24], [62, 25], [68, 34], [66, 54], [64, 68], [50, 72]], 50, 0.4);
  const horns = mirror(stroke([[60, 26], [72, 22], [80, 14], [80, 8]], 5, 'round', true));
  const ears = mirror(ellipse(78, 36, 11, 5, 15));
  const snout = ellipse(50, 74, 20, 14);
  let s = U(over(U(horns, ears), head, 1.8));
  s = over(s, snout, 1.8);
  s = eyes(s, 44, 9, 3);
  s = D(s, ellipse(43, 75, 3, 4), ellipse(57, 75, 3, 4));
  s = D(s, blob([[52, 28], [60, 30], [62, 38], [56, 40], [52, 34]]));
  return s;
}

function bat() {
  const wing: Pt[] = [[50, 40], [60, 34], [76, 28], [92, 30], [100, 40], [92, 42], [88, 50], [80, 48], [74, 56], [66, 52], [56, 60], [50, 62]];
  let s = poly([...wing, ...wing.slice(1, -1).reverse().map(([x, y]): Pt => [100 - x, y])]);
  s = round(s, 0.8);
  s = U(s, ellipse(50, 48, 7, 12), mirror(poly([[46, 40], [44, 30], [50, 36]])));
  s = D(s, circle(47, 42, 1.4), circle(53, 42, 1.4));
  return s;
}

function squirrel() {
  const tail = blob([[56, 86], [72, 84], [84, 72], [90, 54], [86, 38], [78, 28], [80, 18], [72, 8], [60, 8], [52, 16], [56, 24], [66, 26], [72, 36], [72, 52], [66, 66], [58, 74]], 0.45);
  const body = blob([[36, 40], [46, 42], [54, 52], [60, 68], [60, 84], [54, 90], [32, 90], [28, 82], [32, 70], [30, 56]], 0.45);
  const head = U(blob([[24, 24], [32, 18], [40, 20], [45, 28], [43, 38], [36, 42], [26, 42], [18, 38], [15, 33]], 0.45), round(poly([[33, 21], [38, 7], [43, 23]]), 1));
  let s = over(tail, U(body, head), 2);
  s = D(s, circle(30, 29, 2));
  s = D(s, stroke([[38, 58], [30, 64], [34, 70]], 1.5, 'round', true));
  s = D(s, stroke([[46, 76], [50, 90]], 1.5));
  return s;
}

// ---------- Vögel ----------

function bird() {
  const body = blob([[16, 44], [22, 34], [32, 30], [42, 36], [56, 46], [76, 48], [96, 40], [86, 54], [70, 66], [50, 70], [34, 64], [24, 52]], 0.45);
  let s = U(body, poly([[14, 42], [4, 46], [16, 48]]));
  s = D(s, circle(25, 40, 2));
  s = D(s, stroke([[38, 50], [54, 54], [72, 54]], 1.6, 'round', true));
  s = U(s, stroke([[44, 68], [42, 80]], 1.8), stroke([[52, 68], [52, 80]], 1.8), stroke([[38, 82], [58, 82]], 1.8));
  return s;
}

function dove() {
  const body = blob([[20, 40], [28, 34], [38, 38], [50, 46], [64, 50], [86, 52], [98, 46], [92, 58], [74, 66], [52, 66], [36, 60], [26, 50]], 0.45);
  const wing = blob([[44, 46], [48, 26], [58, 10], [72, 4], [70, 18], [80, 14], [76, 30], [70, 44], [60, 52]], 0.4);
  let s = over(U(body, poly([[19, 40], [10, 44], [21, 45]])), wing, 1.6);
  s = D(s, circle(27, 41, 1.8));
  const branch = U(stroke([[10, 48], [4, 58]], 1.4), ellipse(5, 52, 3.5, 1.6, -40), ellipse(10, 56, 3.5, 1.6, 30));
  s = U(s, branch);
  return s;
}

function swallow() {
  const pts: Pt[] = [[50, 26], [56, 34], [72, 30], [100, 20], [80, 36], [62, 46], [58, 60], [70, 96], [52, 70], [50, 72]];
  let s = poly([...pts, ...pts.slice(0, -1).reverse().slice(0, -1).map(([x, y]): Pt => [100 - x, y])]);
  s = U(round(s, 0.6), circle(50, 30, 6.5));
  s = D(s, circle(47.5, 29, 1.4));
  return s;
}

function hen() {
  const body = blob([[26, 30], [36, 24], [42, 36], [50, 46], [66, 44], [82, 30], [94, 30], [90, 50], [80, 70], [60, 80], [40, 78], [26, 66], [22, 48]], 0.45);
  const comb = U(circle(28, 20, 4), circle(34, 18, 4), circle(39, 21, 3.5));
  let s = U(body, comb, poly([[22, 34], [14, 38], [22, 40]]), ellipse(25, 46, 3, 5));
  s = D(s, circle(30, 32, 2));
  s = D(s, stroke([[44, 56], [58, 64], [72, 60]], 1.6, 'round', true));
  s = U(s, stroke([[48, 78], [46, 92]], 2.2), stroke([[60, 78], [62, 92]], 2.2), stroke([[40, 93], [52, 93]], 2), stroke([[56, 93], [68, 93]], 2));
  return s;
}

function chick() {
  const body = circle(52, 62, 26);
  const head = circle(44, 32, 15);
  let s = U(body, head, stroke([[30, 22], [38, 16]], 2), stroke([[38, 18], [40, 12]], 2));
  s = U(s, poly([[30, 32], [20, 35], [30, 38]]));
  s = D(s, circle(40, 30, 2.4));
  s = D(s, stroke(arcPts(52, 56, 16, 20, 110), 1.8));
  s = U(s, stroke([[46, 86], [44, 94]], 2), stroke([[58, 86], [60, 94]], 2));
  return s;
}

function duck() {
  const body = blob([[30, 54], [44, 48], [66, 50], [86, 42], [92, 46], [88, 64], [72, 80], [44, 82], [26, 72], [22, 60]], 0.45);
  const head = circle(30, 34, 14);
  let s = U(body, head, round(poly([[16, 36], [2, 42], [4, 46], [18, 44]]), 1.5), stroke([[30, 44], [34, 56]], 10));
  s = D(s, circle(28, 30, 2.2));
  s = D(s, stroke([[46, 62], [62, 68], [78, 60]], 1.6, 'round', true));
  return s;
}

function swan() {
  const body = blob([[40, 66], [56, 56], [76, 52], [96, 40], [92, 60], [80, 76], [56, 82], [36, 80], [28, 72]], 0.45);
  const neck = stroke([[40, 70], [30, 58], [26, 40], [30, 24], [40, 18], [48, 22], [48, 30]], 6, 'round', true);
  let s = U(body, neck, round(poly([[48, 26], [58, 36], [54, 38], [46, 32]]), 1));
  s = D(s, circle(43, 22, 1.4));
  s = D(s, stroke([[54, 64], [70, 62], [86, 52]], 1.6, 'round', true));
  return s;
}

function flamingo() {
  const body = blob([[30, 34], [46, 28], [66, 30], [84, 38], [74, 46], [56, 50], [40, 48]], 0.45);
  const neck = stroke([[34, 38], [26, 30], [24, 18], [30, 8], [38, 8], [42, 14]], 4, 'round', true);
  let s = U(body, neck, round(poly([[40, 12], [46, 18], [46, 24], [42, 16]]), 0.6));
  s = U(s, stroke([[54, 48], [56, 72], [54, 96]], 2), stroke([[56, 72], [66, 66], [70, 74]], 2));
  s = D(s, circle(35, 10, 1.3));
  s = D(s, stroke([[46, 36], [60, 40], [72, 38]], 1.4, 'round', true));
  return s;
}

function hummingbird() {
  const body = blob([[24, 32], [32, 27], [40, 30], [50, 38], [60, 48], [66, 58], [64, 64], [54, 62], [42, 54], [32, 46], [26, 40]], 0.45);
  const tail = round(poly([[58, 56], [82, 82], [76, 64], [94, 72], [66, 50]]), 0.8);
  const wing = blob([[44, 36], [52, 22], [64, 10], [82, 2], [96, 0], [86, 12], [72, 26], [58, 40]], 0.45);
  let s = over(U(body, tail, stroke([[26, 35], [4, 40]], 1.8)), wing, 1.6);
  s = D(s, circle(31, 33, 1.7));
  return s;
}

function eagle() {
  const half: Pt[] = [[50, 34], [56, 38], [64, 32], [76, 22], [88, 18], [100, 20], [94, 26], [98, 30], [90, 34], [94, 38], [84, 40], [86, 46], [74, 46], [62, 52], [58, 64], [62, 78], [56, 76], [50, 80]];
  let s = poly([...half, ...half.slice(1, -1).reverse().map(([x, y]): Pt => [100 - x, y])]);
  s = U(round(s, 0.6), circle(50, 30, 6), poly([[50, 28], [57, 32], [52, 35]]));
  s = D(s, circle(51, 28, 1.2));
  return s;
}

function rooster() {
  const body = blob([[30, 28], [38, 26], [42, 40], [50, 52], [64, 50], [74, 40], [72, 24], [80, 14], [92, 18], [96, 34], [92, 52], [82, 68], [62, 78], [44, 76], [32, 64], [26, 46]], 0.45);
  const comb = U(circle(30, 18, 4.5), circle(36, 14, 4.5), circle(42, 18, 4));
  let s = U(body, comb, poly([[26, 28], [16, 32], [26, 35]]), ellipse(29, 40, 3, 6));
  s = D(s, circle(33, 26, 2));
  s = D(s, stroke([[78, 22], [86, 36], [88, 50]], 1.4, 'round', true), stroke([[84, 18], [92, 32], [92, 46]], 1.4, 'round', true));
  s = U(s, stroke([[50, 76], [48, 92]], 2.2), stroke([[60, 76], [62, 92]], 2.2), stroke([[42, 93], [54, 93]], 2), stroke([[56, 93], [68, 93]], 2));
  return s;
}

function feather() {
  const vane = blob([[50, 4], [62, 14], [68, 34], [66, 58], [58, 76], [52, 82], [44, 78], [36, 60], [34, 36], [40, 16]], 0.45);
  let s = D(vane, stroke([[50, 10], [51, 84]], 1.4));
  for (let i = 0; i < 6; i++) {
    const y = 22 + i * 9;
    s = D(s, stroke([[51, y + 4], [66, y - 3]], 1.2), stroke([[50, y + 6], [36, y]], 1.2));
  }
  s = U(s, stroke([[51, 80], [52, 98]], 2));
  return s;
}

// ---------- Meer ----------

function fish() {
  const body = ellipse(44, 50, 32, 20);
  const tail = round(poly([[70, 50], [96, 30], [90, 50], [96, 70]]), 1.5);
  let s = over(tail, body, 1.6);
  s = D(s, ring(26, 46, 4, 1.6));
  s = D(s, stroke(arcPts(16, 50, 20, -40, 40), 1.6));
  for (const [x, y] of [[44, 42], [54, 42], [44, 56], [54, 56], [49, 49], [59, 49]] as Pt[]) s = D(s, stroke(arcPts(x, y, 4, -60, 60), 1.3));
  return s;
}

function dolphin() {
  const body = blob([[4, 56], [14, 50], [24, 44], [40, 36], [56, 34], [64, 22], [70, 34], [80, 40], [90, 50], [96, 62], [98, 70], [92, 64], [86, 74], [84, 60], [74, 52], [60, 52], [48, 58], [40, 66], [36, 58], [22, 58], [8, 60]], 0.4);
  let s = D(body, circle(22, 49, 1.8));
  s = D(s, stroke([[6, 57], [14, 56]], 1.2));
  return s;
}

function octopus() {
  const head = sym([[50, 6], [62, 8], [72, 20], [72, 38], [66, 50], [50, 54]], 50, 0.45);
  let s = head;
  const legs = [
    [[40, 48], [30, 62], [18, 66], [10, 60]],
    [[44, 50], [38, 70], [30, 84], [20, 86]],
    [[48, 52], [48, 72], [44, 88], [38, 94]],
  ] as Pt[][];
  for (const l of legs) s = U(s, mirror(stroke(l, 7, 'round', true)));
  s = U(s, mirror(circle(16, 60, 4)));
  s = D(s, circle(42, 32, 4), circle(58, 32, 4));
  s = U(s, circle(42, 32, 1.8), circle(58, 32, 1.8));
  s = D(s, stroke(arcPts(50, 38, 6, 20, 160), 1.5));
  return s;
}

function crab() {
  const body = ellipse(50, 60, 26, 16);
  let s = body;
  s = U(s, mirror(stroke([[30, 52], [18, 40], [16, 28]], 4, 'round', true)));
  const claw = D(circle(16, 22, 9), poly([[16, 22], [10, 8], [24, 10]]));
  s = U(s, mirror(T(claw, { rot: -15, cx: 16, cy: 22 })));
  for (const [a, b] of [[[28, 62], [12, 66]], [[30, 68], [16, 76]], [[34, 72], [24, 86]]] as Pt[][]) s = U(s, mirror(stroke([a, b], 3)));
  s = U(s, mirror(stroke([[44, 46], [42, 36]], 2)), mirror(circle(42, 34, 3)));
  s = D(s, stroke(arcPts(50, 58, 8, 30, 150), 1.5));
  return s;
}

function starfish() {
  let s = round(star(50, 52, 5, 46, 20), 6);
  for (let i = 0; i < 5; i++) {
    for (const r of [12, 20, 28, 35]) {
      const a = ((-90 + i * 72) * Math.PI) / 180;
      s = D(s, circle(50 + r * Math.cos(a), 52 + r * Math.sin(a), r > 30 ? 1.4 : 1.8));
    }
  }
  return s;
}

function seahorse() {
  const body = blob([
    [44, 8], [56, 8], [62, 16], [62, 26], [56, 34], [66, 46], [68, 62], [60, 74], [50, 78], [48, 86], [54, 92], [60, 90], [60, 84], [66, 86], [64, 96], [50, 98], [42, 90], [40, 78], [44, 66], [48, 56], [42, 44], [42, 32], [40, 24], [26, 26], [24, 20], [36, 16],
  ], 0.4);
  let s = U(body, mirror(poly([[0, 0]])), poly([[50, 6], [54, 0], [58, 8]]));
  s = D(s, circle(50, 18, 2));
  for (let i = 0; i < 5; i++) s = D(s, stroke([[46 + i, 42 + i * 7], [58 + i, 40 + i * 7]], 1.2));
  s = U(s, blob([[64, 40], [74, 44], [72, 54], [66, 50]]));
  return s;
}

function shell() {
  const fan = poly([[50, 90], ...arcPts(50, 90, 44, 200, 340), [50, 90]]);
  let s = U(round(fan, 2), rect(38, 84, 24, 10, 3));
  for (let i = 1; i < 8; i++) {
    const a = 200 + i * 17.5;
    s = D(s, stroke([[50 + 8 * Math.cos((a * Math.PI) / 180), 90 + 8 * Math.sin((a * Math.PI) / 180)], [50 + 42 * Math.cos((a * Math.PI) / 180), 90 + 42 * Math.sin((a * Math.PI) / 180)]], 1.6));
  }
  s = D(s, stroke([[40, 88], [60, 88]], 1.4));
  return s;
}

function jellyfish() {
  const bell = U(poly([...arcPts(50, 44, 34, 180, 360)]), stroke([[16, 44], [84, 44]], 4));
  let s = round(bell, 1);
  s = D(s, stroke(arcPts(50, 44, 24, 200, 340), 1.6));
  for (const x of [26, 38, 50, 62, 74]) {
    const pts: Pt[] = [];
    for (let y = 46; y <= 94; y += 4) pts.push([x + Math.sin((y + x) / 6) * 3, y]);
    s = U(s, stroke(pts, 2.4, 'round', true));
  }
  return s;
}

function shark() {
  const body = blob([[2, 54], [14, 46], [34, 42], [48, 40], [56, 22], [62, 18], [64, 38], [80, 42], [92, 34], [100, 22], [98, 44], [100, 64], [90, 54], [78, 58], [60, 62], [56, 72], [48, 62], [26, 62], [10, 60]], 0.3);
  let s = D(body, circle(18, 50, 1.8));
  for (const x of [28, 32, 36]) s = D(s, stroke([[x, 48], [x - 1.5, 56]], 1.2));
  return s;
}

function seaTurtle() {
  const shell = ellipse(50, 50, 22, 28);
  let s = U(
    circle(50, 16, 7.5),
    T(ellipse(24, 34, 18, 6), { rot: -30, cx: 24, cy: 34 }), T(ellipse(76, 34, 18, 6), { rot: 30, cx: 76, cy: 34 }),
    T(ellipse(30, 74, 10, 5), { rot: 30, cx: 30, cy: 74 }), T(ellipse(70, 74, 10, 5), { rot: -30, cx: 70, cy: 74 }),
  );
  s = over(s, shell, 2);
  s = D(s, edge(ellipse(50, 50, 10, 14), 1.4));
  for (let i = 0; i < 8; i++) s = D(s, T(stroke([[50, 64], [50, 78]], 1.4), { rot: i * 45, cx: 50, cy: 50, sx: 1, sy: 1 }));
  s = D(s, circle(46, 14, 1.4), circle(54, 14, 1.4));
  return s;
}


function coral() {
  const branches = U(
    stroke([[50, 96], [50, 60], [40, 40], [36, 20]], 7, 'round', true),
    stroke([[50, 70], [64, 52], [66, 30]], 6, 'round', true),
    stroke([[44, 50], [26, 44], [18, 26]], 5, 'round', true),
    stroke([[60, 58], [78, 52], [86, 36]], 5, 'round', true),
    stroke([[38, 32], [48, 20], [50, 8]], 4, 'round', true),
    stroke([[65, 38], [76, 26]], 4),
  );
  return U(branches, rect(30, 92, 40, 6, 3));
}

// ---------- Insekten ----------

function butterfly() {
  const upper = blob([[50, 46], [56, 30], [68, 14], [86, 10], [96, 22], [90, 40], [74, 50], [54, 52]], 0.45);
  const lower = blob([[52, 54], [70, 56], [84, 66], [84, 82], [70, 90], [58, 80], [52, 64]], 0.45);
  let w = U(upper, lower);
  w = D(w, stroke([[54, 53], [86, 52]], 1.6), circle(80, 24, 5), circle(70, 72, 4));
  let s = U(mirror(D(w, off(ellipse(50, 54, 4.5, 26), 1.6))), ellipse(50, 54, 4, 26));
  s = U(s, mirror(stroke([[50, 30], [56, 18], [62, 12]], 1.4, 'round', true)), mirror(circle(62, 12, 2)));
  return s;
}

function bee() {
  const body = ellipse(50, 60, 22, 28);
  let s = body;
  for (const y of [52, 64, 76]) s = D(s, stroke([[20, y], [80, y]], 4.5));
  s = U(s, D(I(body, rect(0, 0, 100, 47)), poly([[0, 0]])));
  const wings = U(ellipse(30, 32, 16, 10, 30), ellipse(70, 32, 16, 10, -30));
  s = over(hollow(wings, 3), s, 2);
  s = U(s, poly([[46, 87], [54, 87], [50, 96]]));
  s = U(s, mirror(stroke([[46, 34], [40, 22], [36, 18]], 1.6, 'round', true)), mirror(circle(36, 17, 2)));
  s = D(s, circle(43, 42, 2), circle(57, 42, 2));
  return s;
}

function ladybug() {
  const shell = circle(50, 56, 32);
  const head = ellipse(50, 26, 16, 11);
  let s = over(head, shell, 2);
  s = D(s, stroke([[50, 26], [50, 90]], 2));
  for (const [x, y, r] of [[36, 44, 5.5], [64, 44, 5.5], [32, 64, 6], [68, 64, 6], [42, 80, 4.5], [58, 80, 4.5]]) s = D(s, circle(x, y, r));
  s = U(s, mirror(stroke([[44, 18], [38, 8]], 1.6)), mirror(circle(38, 7, 2)));
  for (const [a, b] of [[[20, 44], [8, 38]], [[18, 60], [6, 62]], [[22, 76], [12, 86]]] as Pt[][]) s = U(s, mirror(stroke([a, b], 2)));
  return s;
}

function dragonfly() {
  const body = U(circle(50, 18, 5.5), ellipse(50, 32, 4.5, 8), stroke([[50, 38], [50, 96]], 3.6));
  const wings = U(ellipse(28, 30, 22, 6, -8), ellipse(72, 30, 22, 6, 8), ellipse(30, 44, 20, 5.5, 12), ellipse(70, 44, 20, 5.5, -12));
  let s = over(hollow(wings, 2.4), body, 1.6);
  s = D(s, mirror(stroke([[56, 31], [88, 27]], 1.2)), mirror(stroke([[56, 43], [86, 48]], 1.2)));
  return s;
}

function spider() {
  let s = U(circle(50, 34, 9), ellipse(50, 58, 15, 18));
  for (const pts of [[[44, 30], [28, 18], [22, 4]], [[42, 36], [22, 30], [10, 34]], [[40, 50], [22, 50], [8, 64]], [[40, 60], [26, 70], [18, 90]]] as Pt[][]) s = U(s, mirror(stroke(pts, 2.4, 'round')));
  s = D(s, circle(46, 32, 1.6), circle(54, 32, 1.6));
  return s;
}

function ant() {
  let s = U(circle(22, 46, 9), ellipse(42, 50, 10, 7), ellipse(70, 52, 18, 13));
  for (const pts of [[[38, 54], [30, 70], [24, 76]], [[44, 56], [44, 72], [40, 80]], [[50, 54], [58, 70], [62, 78]]] as Pt[][]) s = U(s, stroke(pts, 2.2));
  s = U(s, stroke([[18, 38], [12, 26], [4, 22]], 1.8), stroke([[24, 38], [26, 26], [20, 18]], 1.8));
  s = D(s, circle(18, 44, 1.6));
  return s;
}

function caterpillar() {
  const pts: Pt[] = [[14, 70], [26, 64], [38, 60], [50, 62], [62, 66], [74, 64], [86, 54]];
  let s: Shape = [];
  pts.forEach(([x, y], i) => {
    const r = i === pts.length - 1 ? 12 : 9;
    if (i < pts.length - 1) s = U(s, stroke([[x, y + 6], [x - 1, y + 14]], 2.6));
    s = over(s, circle(x, y, r), 1.5);
  });
  s = U(s, stroke([[82, 44], [78, 32]], 1.8), stroke([[90, 44], [96, 32]], 1.8), circle(78, 31, 2.4), circle(96, 31, 2.4));
  s = D(s, circle(90, 52, 2));
  s = D(s, stroke(arcPts(88, 56, 5, 30, 150), 1.4));
  return s;
}

function beetle() {
  const shell = ellipse(50, 60, 24, 30);
  const head = U(ellipse(50, 26, 12, 9), mirror(stroke([[44, 22], [36, 10], [40, 4]], 3, 'round', true)));
  let s = over(head, shell, 2);
  s = D(s, stroke([[50, 32], [50, 90]], 2), stroke(arcPts(50, 44, 22, 200, 340), 1.6));
  for (const [a, b] of [[[28, 50], [12, 42]], [[26, 62], [10, 64]], [[30, 76], [16, 88]]] as Pt[][]) s = U(s, mirror(stroke([a, b], 2.4)));
  return s;
}

const A = (...a: [string, string, string, string, () => Shape, number?][]) => a;

export const ANIMALS: Def[] = [
  ...group('motif', 'animals', A(
    ['cat-head', 'Katzenkopf', 'Cat head', 'Katze/cat, Haustier/pet, Gesicht/face', catHead],
    ['cat-sitting', 'Sitzende Katze', 'Sitting cat', 'Katze/cat, Haustier/pet, Silhouette/silhouette', sittingCat],
    ['dog-head', 'Hundekopf', 'Dog head', 'Hund/dog, Haustier/pet, Gesicht/face', dogHead],
    ['dog-sitting', 'Sitzender Hund', 'Sitting dog', 'Hund/dog, Haustier/pet, Silhouette/silhouette', sittingDog],
    ['fox-head', 'Fuchskopf', 'Fox head', 'Fuchs/fox, Wald/forest', foxHead],
    ['owl', 'Eule', 'Owl', 'Eule/owl, Vogel/bird, Wald/forest, Nacht/night', owl],
    ['bear-head', 'Bärenkopf', 'Bear head', 'Bär/bear, Teddy/teddy, Wald/forest', bearHead],
    ['panda', 'Panda', 'Panda', 'Panda/panda, Bär/bear', panda],
    ['rabbit-head', 'Hasenkopf', 'Rabbit head', 'Hase/rabbit, Kaninchen/bunny, Ostern/easter', rabbit],
    ['mouse-head', 'Mauskopf', 'Mouse head', 'Maus/mouse', mouse],
    ['pig-head', 'Schweinekopf', 'Pig head', 'Schwein/pig, Bauernhof/farm, Glück/luck', pig],
    ['cow-head', 'Kuhkopf', 'Cow head', 'Kuh/cow, Bauernhof/farm', cowHead],
    ['lion-head', 'Löwenkopf', 'Lion head', 'Löwe/lion, Zoo/zoo, Afrika/africa', lion],
    ['monkey-head', 'Affenkopf', 'Monkey head', 'Affe/monkey, Zoo/zoo', monkey],
    ['koala', 'Koala', 'Koala', 'Koala/koala, Australien/australia', koala],
    ['penguin', 'Pinguin', 'Penguin', 'Pinguin/penguin, Winter/winter, Antarktis/antarctica', penguin],
    ['frog', 'Frosch', 'Frog', 'Frosch/frog, Teich/pond', frog],
    ['elephant', 'Elefant', 'Elephant', 'Elefant/elephant, Zoo/zoo, Afrika/africa', elephant],
    ['horse-head', 'Pferdekopf', 'Horse head', 'Pferd/horse, Reiten/riding', horseHead],
    ['stag-head', 'Hirschkopf', 'Stag head', 'Hirsch/stag, Geweih/antlers, Wald/forest, Jagd/hunting', stag],
    ['whale', 'Wal', 'Whale', 'Wal/whale, Meer/sea', whale],
    ['turtle', 'Schildkröte', 'Tortoise', 'Schildkröte/tortoise, Reptil/reptile', turtle],
    ['snail', 'Schnecke', 'Snail', 'Schnecke/snail, Garten/garden', snail],
    ['hedgehog', 'Igel', 'Hedgehog', 'Igel/hedgehog, Wald/forest, Herbst/autumn', hedgehog],
    ['squirrel', 'Eichhörnchen', 'Squirrel', 'Eichhörnchen/squirrel, Wald/forest, Herbst/autumn', squirrel],
    ['dinosaur', 'Langhalsdino', 'Long-neck dinosaur', 'Dinosaurier/dinosaur, Kinder/kids', dino],
    ['t-rex', 'T-Rex', 'T. rex', 'Dinosaurier/dinosaur, Kinder/kids', tRex],
    ['bat', 'Fledermaus', 'Bat', 'Fledermaus/bat, Halloween/halloween, Nacht/night', bat],
  )),
  ...group('motif', 'birds', A(
    ['bird', 'Vogel', 'Bird', 'Vogel/bird, Spatz/sparrow', bird],
    ['dove', 'Taube mit Zweig', 'Dove with branch', 'Taube/dove, Frieden/peace, Hochzeit/wedding', dove],
    ['swallow', 'Schwalbe', 'Swallow', 'Schwalbe/swallow, fliegen/flying, Tattoo/tattoo', swallow],
    ['hen', 'Huhn', 'Hen', 'Huhn/hen, Bauernhof/farm, Ostern/easter', hen],
    ['rooster', 'Hahn', 'Rooster', 'Hahn/rooster, Bauernhof/farm', rooster],
    ['chick', 'Küken', 'Chick', 'Küken/chick, Ostern/easter, Frühling/spring', chick],
    ['duck', 'Ente', 'Duck', 'Ente/duck, Teich/pond', duck],
    ['swan', 'Schwan', 'Swan', 'Schwan/swan, See/lake, Hochzeit/wedding', swan],
    ['flamingo', 'Flamingo', 'Flamingo', 'Flamingo/flamingo, Sommer/summer', flamingo],
    ['hummingbird', 'Kolibri', 'Hummingbird', 'Kolibri/hummingbird', hummingbird],
    ['eagle', 'Adler', 'Eagle', 'Adler/eagle, fliegen/flying', eagle],
    ['feather', 'Feder', 'Feather', 'Feder/feather, Boho/boho', feather],
  )),
  ...group('motif', 'sea', A(
    ['fish', 'Fisch', 'Fish', 'Fisch/fish, Angeln/fishing', fish],
    ['dolphin', 'Delfin', 'Dolphin', 'Delfin/dolphin, Meer/sea', dolphin],
    ['shark', 'Hai', 'Shark', 'Hai/shark', shark],
    ['octopus', 'Krake', 'Octopus', 'Krake/octopus, Tintenfisch/squid', octopus],
    ['crab', 'Krebs', 'Crab', 'Krebs/crab, Strand/beach', crab],
    ['starfish', 'Seestern', 'Starfish', 'Seestern/starfish, Strand/beach', starfish],
    ['seahorse', 'Seepferdchen', 'Seahorse', 'Seepferdchen/seahorse', seahorse],
    ['shell', 'Muschel', 'Seashell', 'Muschel/shell, Strand/beach', shell],
    ['jellyfish', 'Qualle', 'Jellyfish', 'Qualle/jellyfish', jellyfish],
    ['sea-turtle', 'Meeresschildkröte', 'Sea turtle', 'Schildkröte/turtle', seaTurtle],
    ['coral', 'Koralle', 'Coral', 'Koralle/coral, Riff/reef', coral],
  )),
  ...group('motif', 'insects', A(
    ['butterfly', 'Schmetterling', 'Butterfly', 'Schmetterling/butterfly, Frühling/spring, Garten/garden', butterfly],
    ['bee', 'Biene', 'Bee', 'Biene/bee, Honig/honey, Garten/garden', bee],
    ['ladybug', 'Marienkäfer', 'Ladybug', 'Marienkäfer/ladybird, Glück/luck', ladybug],
    ['dragonfly', 'Libelle', 'Dragonfly', 'Libelle/dragonfly, Teich/pond', dragonfly],
    ['spider', 'Spinne', 'Spider', 'Spinne/spider, Halloween/halloween', spider],
    ['ant', 'Ameise', 'Ant', 'Ameise/ant', ant],
    ['caterpillar', 'Raupe', 'Caterpillar', 'Raupe/caterpillar, Kinder/kids', caterpillar],
    ['beetle', 'Hirschkäfer', 'Stag beetle', 'Käfer/beetle', beetle],
  )),
];
