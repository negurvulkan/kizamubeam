//! Bildverarbeitung für Rasterbilder: Graustufen, Größe anpassen, Helligkeit/Kontrast/Gamma/Schärfen, Dithering
//! und die Rasterzeilen für den G-Code.
//!
//! Die Rechnungen folgen Schritt für Schritt `src/images.ts` und `imageLines` in `src/gcode.ts`, damit die
//! Desktop-App und die Browser-Fassung dieselben Bilder lasern: gerechnet wird in f64, gespeichert in f32
//! (wie `Float32Array`). Unabhängige Zeilen und Spalten laufen parallel.

use rayon::prelude::*;
use serde::Deserialize;

/// Graustufen eines Bildes: 0 = schwarz, 255 = weiß
pub struct Gray {
    pub w: usize,
    pub h: usize,
    pub v: Vec<f32>,
}

/// Graustufen aus f32-Werten (little endian), wie die Oberfläche sie schickt
pub fn gray_from_bytes(w: usize, h: usize, bytes: &[u8]) -> Result<Gray, String> {
    if w == 0 || h == 0 || bytes.len() != w * h * 4 {
        return Err("Graustufen passen nicht zur Bildgröße".into());
    }
    let v = bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
    Ok(Gray { w, h, v })
}

/// Graustufen auf cols × rows bringen (Flächenmittel beim Verkleinern, bilinear beim Vergrößern).
pub fn resample(src: &[f32], sw: usize, sh: usize, cols: usize, rows: usize) -> Vec<f32> {
    let mut out = vec![0f32; cols * rows];
    let fx = sw as f64 / cols as f64;
    let fy = sh as f64 / rows as f64;
    if fx >= 1.0 && fy >= 1.0 {
        out.par_chunks_mut(cols).enumerate().for_each(|(y, row)| {
            let y0 = y as f64 * fy;
            let y1 = y0 + fy;
            for (x, o) in row.iter_mut().enumerate() {
                let x0 = x as f64 * fx;
                let x1 = x0 + fx;
                let mut sum = 0f64;
                let mut wsum = 0f64;
                let sy_end = (sh as f64).min(y1.ceil()) as usize;
                let sx_end = (sw as f64).min(x1.ceil()) as usize;
                for sy in (y0.floor() as usize)..sy_end {
                    let wy = y1.min(sy as f64 + 1.0) - y0.max(sy as f64);
                    let r = sy * sw;
                    for sx in (x0.floor() as usize)..sx_end {
                        let w = wy * (x1.min(sx as f64 + 1.0) - x0.max(sx as f64));
                        sum += src[r + sx] as f64 * w;
                        wsum += w;
                    }
                }
                *o = if wsum != 0.0 { (sum / wsum) as f32 } else { 255.0 };
            }
        });
        return out;
    }
    out.par_chunks_mut(cols).enumerate().for_each(|(y, row)| {
        let syf = ((y as f64 + 0.5) * fy - 0.5).min(sh as f64 - 1.0).max(0.0);
        let sy0 = syf.floor() as usize;
        let sy1 = (sh - 1).min(sy0 + 1);
        let ty = syf - sy0 as f64;
        for (x, o) in row.iter_mut().enumerate() {
            let sxf = ((x as f64 + 0.5) * fx - 0.5).min(sw as f64 - 1.0).max(0.0);
            let sx0 = sxf.floor() as usize;
            let sx1 = (sw - 1).min(sx0 + 1);
            let tx = sxf - sx0 as f64;
            let p = |r: usize, c: usize| src[r * sw + c] as f64;
            let a = p(sy0, sx0) * (1.0 - tx) + p(sy0, sx1) * tx;
            let b = p(sy1, sx0) * (1.0 - tx) + p(sy1, sx1) * tx;
            *o = (a * (1.0 - ty) + b * ty) as f32;
        }
    });
    out
}

/// Gleitendes Mittel über eine Zeile; `get(i)` liest Punkt i, das Ergebnis landet in `put(i, v)`.
fn box_line(n: usize, r: usize, get: impl Fn(usize) -> f32, mut put: impl FnMut(usize, f32)) {
    let last = n as isize - 1;
    let at = |i: isize| get(i.clamp(0, last) as usize) as f64;
    let r = r as isize;
    let mut acc = 0f64;
    for i in -r..=r {
        acc += at(i);
    }
    let div = (2 * r + 1) as f64;
    for i in 0..n as isize {
        put(i as usize, (acc / div) as f32);
        acc += at((i + r + 1).min(last)) - at((i - r).max(0));
    }
}

/// Kastenunschärfe (horizontal + vertikal), dreimal angewendet ≈ Gauß
pub fn blur(v: &[f32], w: usize, h: usize, r: usize) -> Vec<f32> {
    let mut a = v.to_vec();
    let mut b = vec![0f32; v.len()];
    // Spalten in Blöcken parallel, jeder Block rechnet in einen eigenen Puffer (Spalte für Spalte wie im Original)
    let block = (w / rayon::current_num_threads().max(1)).max(16);
    for _ in 0..3 {
        b.par_chunks_mut(w).zip(a.par_chunks(w)).for_each(|(dst, src)| box_line(w, r, |i| src[i], |i, x| dst[i] = x));
        let starts: Vec<usize> = (0..w).step_by(block).collect();
        let parts: Vec<(usize, usize, Vec<f32>)> = starts
            .par_iter()
            .map(|&c0| {
                let c1 = (c0 + block).min(w);
                let cw = c1 - c0;
                let mut buf = vec![0f32; cw * h];
                for c in c0..c1 {
                    let k = c - c0;
                    box_line(h, r, |i| b[i * w + c], |i, x| buf[i * cw + k] = x);
                }
                (c0, cw, buf)
            })
            .collect();
        for (c0, cw, buf) in parts {
            for y in 0..h {
                a[y * w + c0..y * w + c0 + cw].copy_from_slice(&buf[y * cw..(y + 1) * cw]);
            }
        }
    }
    a
}

/// Anpassungen je Bild (wie `ImageAdjust` in model.ts)
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Adjust {
    pub brightness: f64,
    pub contrast: f64,
    pub gamma: f64,
    pub sharpen: f64,
    pub sharpen_radius: f64,
    pub denoise: f64,
}

/// Math.round aus JavaScript: halbe Werte runden nach oben
pub fn js_round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// Helligkeit, Kontrast, Gamma, Schärfen und Negativ auf Graustufen (in place) anwenden.
pub fn apply_adjust(g: &mut [f32], w: usize, h: usize, adj: &Adjust, negative: bool) {
    if adj.sharpen > 0.0 {
        let r = js_round(adj.sharpen_radius / 2.0).max(1.0) as usize;
        let bl = blur(g, w, h, r);
        let k = adj.sharpen / 100.0;
        let thr = adj.denoise;
        g.par_iter_mut().zip(bl.par_iter()).for_each(|(v, &b)| {
            let d = *v as f64 - b as f64;
            if d.abs() >= thr {
                *v = (*v as f64 + k * d) as f32;
            }
        });
    }
    let c = adj.contrast.clamp(-99.0, 99.0) * 2.55;
    let cf = (259.0 * (c + 255.0)) / (255.0 * (259.0 - c));
    let b = adj.brightness * 2.55;
    let ig = 1.0 / adj.gamma.max(0.05);
    let mut lut = [0f32; 256];
    for (i, l) in lut.iter_mut().enumerate() {
        let mut v = (i as f64 - 128.0) * cf + 128.0 + b;
        v = v.clamp(0.0, 255.0);
        v = 255.0 * (v / 255.0).powf(ig);
        *l = (if negative { 255.0 - v } else { v }) as f32;
    }
    g.par_iter_mut().for_each(|p| {
        let v = *p as f64;
        let c = v.clamp(0.0, 255.0);
        let lo = c.floor();
        let t = c - lo;
        let lo = lo as usize;
        *p = if lo >= 255 { lut[255] } else { (lut[lo] as f64 * (1.0 - t) + lut[lo + 1] as f64 * t) as f32 };
    });
}

const BAYER: [[u8; 8]; 8] = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
];

/// Fehlerverteilung: (dx, dy, Gewicht) und Summe der Gewichte
fn kernel(mode: &str) -> (&'static [(isize, usize, f64)], f64) {
    const FLOYD: [(isize, usize, f64); 4] = [(1, 0, 7.0), (-1, 1, 3.0), (0, 1, 5.0), (1, 1, 1.0)];
    const ATKINSON: [(isize, usize, f64); 6] = [(1, 0, 1.0), (2, 0, 1.0), (-1, 1, 1.0), (0, 1, 1.0), (1, 1, 1.0), (0, 2, 1.0)];
    const JARVIS: [(isize, usize, f64); 12] = [
        (1, 0, 7.0), (2, 0, 5.0), (-2, 1, 3.0), (-1, 1, 5.0), (0, 1, 7.0), (1, 1, 5.0),
        (2, 1, 3.0), (-2, 2, 1.0), (-1, 2, 3.0), (0, 2, 5.0), (1, 2, 3.0), (2, 2, 1.0),
    ];
    const STUCKI: [(isize, usize, f64); 12] = [
        (1, 0, 8.0), (2, 0, 4.0), (-2, 1, 2.0), (-1, 1, 4.0), (0, 1, 8.0), (1, 1, 4.0),
        (2, 1, 2.0), (-2, 2, 1.0), (-1, 2, 2.0), (0, 2, 4.0), (1, 2, 2.0), (2, 2, 1.0),
    ];
    match mode {
        "atkinson" => (&ATKINSON, 8.0),
        "jarvis" => (&JARVIS, 48.0),
        "stucki" => (&STUCKI, 42.0),
        _ => (&FLOYD, 16.0),
    }
}

/// Skizze: Kantenstärke unter dieser Schwelle bleibt weiß (Rauschen), darüber wird sie verstärkt
const SKETCH_FLOOR: f64 = 4.0;
const SKETCH_GAIN: f64 = 2.0;

/// Verfahren mit veränderlicher Leistung (Min. bis Max.); alle anderen brennen mit Max. oder gar nicht
pub fn is_gray_mode(mode: &str) -> bool {
    mode == "grayscale" || mode == "sketch"
}

/// Dithering-Einstellungen
pub struct DitherOptions<'a> {
    pub mode: &'a str,
    pub threshold: f64,
    /// Halbton und Zeitungsdruck: Zellengröße in Ausgabepunkten und Winkel in Grad
    pub cell_px: f64,
    pub angle: f64,
}

/// Wie die Zuweisung an ein `Uint8ClampedArray`: begrenzen, halbe Werte zur geraden Zahl
fn clamp_u8(v: f64) -> u8 {
    if v.is_nan() {
        0
    } else {
        v.clamp(0.0, 255.0).round_ties_even() as u8
    }
}

/// Graustufen in Ausgabewerte umsetzen: 0 = volle Leistung (schwarz), 255 = aus.
/// Bei allen Verfahren außer Graustufen und Skizze sind die Werte nur 0 oder 255.
pub fn dither(g: &[f32], w: usize, h: usize, o: &DitherOptions) -> Vec<u8> {
    let mut out = vec![0u8; w * h];
    match o.mode {
        "grayscale" => out.par_iter_mut().zip(g.par_iter()).for_each(|(d, &v)| *d = clamp_u8(v as f64)),
        "threshold" => out.par_iter_mut().zip(g.par_iter()).for_each(|(d, &v)| *d = if (v as f64) < o.threshold { 0 } else { 255 }),
        "ordered" => out.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
            for (x, d) in row.iter_mut().enumerate() {
                let t = ((BAYER[y & 7][x & 7] as f64 + 0.5) / 64.0) * 255.0;
                *d = if (g[y * w + x] as f64) < t { 0 } else { 255 };
            }
        }),
        "halftone" => {
            // Runde Punkte in einem gedrehten Zellraster (Spot-Funktion (cos u + cos v) / 2)
            let a = (o.angle * std::f64::consts::PI) / 180.0;
            let (ca, sa) = (a.cos(), a.sin());
            let f = (2.0 * std::f64::consts::PI) / o.cell_px.max(2.0);
            out.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
                let yf = y as f64;
                for (x, d) in row.iter_mut().enumerate() {
                    let xf = x as f64;
                    let u = (xf * ca + yf * sa) * f;
                    let v = (-xf * sa + yf * ca) * f;
                    let spot = (u.cos() + v.cos()) * 0.25 + 0.5;
                    *d = if spot > g[y * w + x] as f64 / 255.0 { 0 } else { 255 };
                }
            });
        }
        "newsprint" => {
            // Zeitungsdruck: ein runder Punkt je Zelle eines gedrehten Rasters, seine Fläche entspricht der mittleren
            // Dunkelheit der Zelle. Ab 50 % wachsen die Punkte zusammen und es bleiben helle Punkte in den Zellecken.
            let cell = o.cell_px.max(2.0);
            let bl = blur(g, w, h, js_round(cell / 4.0).max(1.0) as usize);
            let a = (o.angle * std::f64::consts::PI) / 180.0;
            let (ca, sa) = (a.cos(), a.sin());
            out.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
                let yf = y as f64;
                for (x, d) in row.iter_mut().enumerate() {
                    let xf = x as f64;
                    let u = (xf * ca + yf * sa) / cell;
                    let v = (-xf * sa + yf * ca) / cell;
                    let cu = u.floor() + 0.5;
                    let cv = v.floor() + 0.5;
                    // Zellmitte zurück ins Bild, dort die (geglättete) Helligkeit lesen
                    let px = ((cu * ca - cv * sa) * cell).floor().max(0.0).min(w as f64 - 1.0) as usize;
                    let py = ((cu * sa + cv * ca) * cell).floor().max(0.0).min(h as f64 - 1.0) as usize;
                    let dark = (1.0 - bl[py * w + px] as f64 / 255.0).clamp(0.0, 1.0);
                    let (du, dv) = (u - cu, v - cv);
                    let black = if dark <= 0.5 {
                        du * du + dv * dv < dark / std::f64::consts::PI
                    } else {
                        let eu = 0.5 - du.abs();
                        let ev = 0.5 - dv.abs();
                        eu * eu + ev * ev >= (1.0 - dark) / std::f64::consts::PI
                    };
                    *d = if black { 0 } else { 255 };
                }
            });
        }
        "sketch" => {
            // Skizze: Kanten (Sobel auf leicht geglättetem Bild) werden zu dunklen Strichen, gleichmäßige Flächen
            // bleiben weiß. Die Werte sind Graustufen, gelasert wird mit veränderlicher Leistung.
            let b = blur(g, w, h, 1);
            let at = |x: isize, y: isize| b[y.clamp(0, h as isize - 1) as usize * w + x.clamp(0, w as isize - 1) as usize] as f64;
            out.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
                let y = y as isize;
                for (x, d) in row.iter_mut().enumerate() {
                    let x = x as isize;
                    let gx = at(x + 1, y - 1) + 2.0 * at(x + 1, y) + at(x + 1, y + 1) - (at(x - 1, y - 1) + 2.0 * at(x - 1, y) + at(x - 1, y + 1));
                    let gy = at(x - 1, y + 1) + 2.0 * at(x, y + 1) + at(x + 1, y + 1) - (at(x - 1, y - 1) + 2.0 * at(x, y - 1) + at(x + 1, y - 1));
                    let mag = (gx * gx + gy * gy).sqrt() / 4.0;
                    *d = clamp_u8(255.0 - (mag - SKETCH_FLOOR).max(0.0) * SKETCH_GAIN);
                }
            });
        }
        mode => {
            let (k, sum) = kernel(mode);
            let mut e = g.to_vec();
            // Schlangenlinie: jede zweite Zeile rückwärts, vermeidet Richtungsmuster
            for y in 0..h {
                let rev = y & 1 == 1;
                for n in 0..w {
                    let x = if rev { w - 1 - n } else { n };
                    let i = y * w + x;
                    let old = e[i] as f64;
                    let nv = if old < 128.0 { 0.0 } else { 255.0 };
                    out[i] = nv as u8;
                    let err = old - nv;
                    if err == 0.0 {
                        continue;
                    }
                    for &(dx, dy, wt) in k {
                        let xx = if rev { x as isize - dx } else { x as isize + dx };
                        let yy = y + dy;
                        if xx < 0 || xx >= w as isize || yy >= h {
                            continue;
                        }
                        let j = yy * w + xx as usize;
                        e[j] = (e[j] as f64 + err * (wt / sum)) as f32;
                    }
                }
            }
        }
    }
    out
}

/// Bild-Einstellungen eines Layers (Ausschnitt aus `ImageLayer` in model.ts)
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImageLayer {
    pub power: f64,
    pub min_power: f64,
    pub interval: f64,
    pub dither: String,
    pub negative: bool,
    pub cells: f64,
    pub angle: f64,
    pub threshold: f64,
}

/// Vollständige Verarbeitung: Ausgabewerte (0 = brennen … 255 = aus) im Raster cols × rows.
pub fn process(src: &Gray, adj: &Adjust, l: &ImageLayer, cols: usize, rows: usize) -> Vec<u8> {
    let mut g = resample(&src.v, src.w, src.h, cols, rows);
    apply_adjust(&mut g, cols, rows, adj, l.negative);
    let cell_px = 25.4 / l.cells.max(1.0) / l.interval;
    dither(&g, cols, rows, &DitherOptions { mode: &l.dither, threshold: l.threshold, cell_px, angle: l.angle })
}

pub type Mat = [f64; 6];

fn apply(m: &Mat, x: f64, y: f64) -> (f64, f64) {
    (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
}

/// Eine Rasterzeile: y und die Läufe (x0, x1, Leistung 0 … 1) mit x0 < x1
pub struct ScanLine {
    pub y: f64,
    pub runs: Vec<[f64; 3]>,
}

/// Bildzeilen: Ausgabepunkte des verarbeiteten Bildes je Zeile zu Läufen gleicher Leistung zusammenfassen.
/// `m` bildet lokale mm des Bildes (Größe `sw` × `sh`) auf Ausgabekoordinaten ab, `im` ist ihre Umkehrung.
/// Zeilen ohne Lauf werden weggelassen.
#[allow(clippy::too_many_arguments)]
pub fn scan_lines(v: &[u8], cols: usize, rows: usize, sw: f64, sh: f64, m: &Mat, im: &Mat, l: &ImageLayer) -> Vec<ScanLine> {
    let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for (x, y) in [(0.0, 0.0), (sw, 0.0), (sw, sh), (0.0, sh)] {
        let q = apply(m, x, y);
        x0 = x0.min(q.0);
        y0 = y0.min(q.1);
        x1 = x1.max(q.0);
        y1 = y1.max(q.1);
    }
    // Achsparallel: genau ein Abtastpunkt pro Ausgabepunkt; gedreht: Raster im Zeilenabstand
    let aligned = m[1].abs() < 1e-9 && m[2].abs() < 1e-9;
    let step_x = if aligned { (x1 - x0) / cols as f64 } else { l.interval };
    let step_y = if aligned { (y1 - y0) / rows as f64 } else { l.interval };
    let nx = js_round((x1 - x0) / step_x).max(1.0) as usize;
    let ny = js_round((y1 - y0) / step_y).max(1.0) as usize;
    let gray = is_gray_mode(&l.dither);
    let pmax = l.power / 100.0;
    let pmin = l.min_power.min(l.power) / 100.0;
    (0..ny)
        .into_par_iter()
        .map(|j| {
            let y = y0 + (j as f64 + 0.5) * step_y;
            let mut runs: Vec<[f64; 3]> = Vec::new();
            let mut cur: Option<[f64; 3]> = None;
            for k in 0..nx {
                let x = x0 + (k as f64 + 0.5) * step_x;
                let q = apply(im, x, y);
                let c = ((q.0 / sw) * cols as f64).floor();
                let r = ((q.1 / sh) * rows as f64).floor();
                let mut s = 0.0;
                if c >= 0.0 && c < cols as f64 && r >= 0.0 && r < rows as f64 {
                    let val = v[r as usize * cols + c as usize] as f64;
                    s = if gray {
                        if val >= 255.0 {
                            0.0
                        } else {
                            js_round((pmin + (pmax - pmin) * (1.0 - val / 255.0)) * 1000.0) / 1000.0
                        }
                    } else if val < 128.0 {
                        pmax
                    } else {
                        0.0
                    };
                }
                let xa = x0 + k as f64 * step_x;
                let xb = xa + step_x;
                match &mut cur {
                    Some(c) if c[2] == s && (c[1] - xa).abs() < 1e-9 => c[1] = xb,
                    _ => {
                        if let Some(c) = cur.take() {
                            if c[2] > 0.0 {
                                runs.push(c);
                            }
                        }
                        cur = Some([xa, xb, s]);
                    }
                }
            }
            if let Some(c) = cur {
                if c[2] > 0.0 {
                    runs.push(c);
                }
            }
            ScanLine { y, runs }
        })
        .filter(|l| !l.runs.is_empty())
        .collect()
}

/// Rasterzeilen als f64-Folge: je Zeile y, Anzahl der Läufe, dann x0, x1, s je Lauf
pub fn pack_lines(lines: &[ScanLine]) -> Vec<u8> {
    let n: usize = lines.iter().map(|l| 2 + 3 * l.runs.len()).sum();
    let mut out = Vec::with_capacity(n * 8);
    for l in lines {
        out.extend_from_slice(&l.y.to_le_bytes());
        out.extend_from_slice(&(l.runs.len() as f64).to_le_bytes());
        for r in &l.runs {
            for v in r {
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gray_bytes_need_matching_size() {
        let b: Vec<u8> = [0f32, 128.5, 255.0].iter().flat_map(|v| v.to_le_bytes()).collect();
        assert_eq!(gray_from_bytes(3, 1, &b).unwrap().v, vec![0.0, 128.5, 255.0]);
        assert!(gray_from_bytes(2, 2, &b).is_err());
    }
}
