"use strict";
/* ------------------------------------------------------------------ *
 *  Objets modaux (synthese modale)                                    *
 *                                                                     *
 *  ~modal <groupe> <nbModes> transforme un groupe lineaire (toutes    *
 *  les masses <groupe>_..., ou une structure integree <groupe>) en    *
 *  modes : chaque mode est un resonateur (frequence + extinction),    *
 *  un point de frappe ou d'ecoute est la somme des modes ponderee par *
 *  leur deformee. Equivalent exact du reseau masses-ressorts tant     *
 *  qu'on garde tous les modes ; stable a toutes les frequences ; et   *
 *  bien plus leger : quelques dizaines de modes au lieu de centaines  *
 *  de masses et de ressorts. Dans Max : compute_modal (migen-plus).   *
 * ------------------------------------------------------------------ */

/* valeurs et vecteurs propres d'une matrice symetrique n x n (a plat,
 * ligne par ligne) : Householder + QL implicite (tred2 / tqli).
 * Vecteur propre j = colonne j de z : z[k * n + j]. */
function vecteursPropres(a, n) {
  const z = Float64Array.from(a), d = new Float64Array(n), e = new Float64Array(n);
  for (let i = n - 1; i > 0; i--) {
    const l = i - 1;
    let h = 0, scale = 0;
    if (l > 0) {
      for (let k = 0; k <= l; k++) scale += Math.abs(z[i * n + k]);
      if (scale === 0) e[i] = z[i * n + l];
      else {
        for (let k = 0; k <= l; k++) { z[i * n + k] /= scale; h += z[i * n + k] * z[i * n + k]; }
        let f = z[i * n + l];
        let g = f >= 0 ? -Math.sqrt(h) : Math.sqrt(h);
        e[i] = scale * g; h -= f * g; z[i * n + l] = f - g; f = 0;
        for (let j = 0; j <= l; j++) {
          z[j * n + i] = z[i * n + j] / h;
          g = 0;
          for (let k = 0; k <= j; k++) g += z[j * n + k] * z[i * n + k];
          for (let k = j + 1; k <= l; k++) g += z[k * n + j] * z[i * n + k];
          e[j] = g / h; f += e[j] * z[i * n + j];
        }
        const hh = f / (h + h);
        for (let j = 0; j <= l; j++) {
          f = z[i * n + j]; e[j] = g = e[j] - hh * f;
          for (let k = 0; k <= j; k++) z[j * n + k] -= (f * e[k] + g * z[i * n + k]);
        }
      }
    } else e[i] = z[i * n + l];
    d[i] = h;
  }
  d[0] = 0; e[0] = 0;
  for (let i = 0; i < n; i++) {
    const l = i - 1;
    if (d[i]) {
      for (let j = 0; j <= l; j++) {
        let g = 0;
        for (let k = 0; k <= l; k++) g += z[i * n + k] * z[k * n + j];
        for (let k = 0; k <= l; k++) z[k * n + j] -= g * z[k * n + i];
      }
    }
    d[i] = z[i * n + i]; z[i * n + i] = 1;
    for (let j = 0; j <= l; j++) z[j * n + i] = z[i * n + j] = 0;
  }
  for (let i = 1; i < n; i++) e[i - 1] = e[i];
  e[n - 1] = 0;
  for (let l = 0; l < n; l++) {
    let iter = 0, m;
    do {
      for (m = l; m < n - 1; m++) {
        const dd = Math.abs(d[m]) + Math.abs(d[m + 1]);
        if (Math.abs(e[m]) <= Number.EPSILON * dd) break;
      }
      if (m !== l) {
        if (iter++ === 80) throw new Error("calcul des modes : pas de convergence");
        let g = (d[l + 1] - d[l]) / (2 * e[l]);
        let r = Math.hypot(g, 1);
        g = d[m] - d[l] + e[l] / (g + (g >= 0 ? r : -r));
        let s = 1, c = 1, p = 0, i, sortie = false;
        for (i = m - 1; i >= l; i--) {
          let f = s * e[i];
          const b = c * e[i];
          e[i + 1] = (r = Math.hypot(f, g));
          if (r === 0) { d[i + 1] -= p; e[m] = 0; sortie = true; break; }
          s = f / r; c = g / r; g = d[i + 1] - p; r = (d[i] - g) * s + 2 * c * b;
          d[i + 1] = g + (p = s * r); g = c * r - b;
          for (let k = 0; k < n; k++) {
            f = z[k * n + i + 1];
            z[k * n + i + 1] = s * z[k * n + i] + c * f;
            z[k * n + i] = c * z[k * n + i] - s * f;
          }
        }
        if (sortie) continue;
        d[l] -= p; e[l] = g; e[m] = 0;
      }
    } while (m !== l);
  }
  return { d, z };
}

const CACHE_MODES = new Map();

/* modes d'un groupe : K (raideurs), C (amortissements), m (masses) sur les
 * points mobiles. Renvoie les nb modes les plus graves : pulsation omega
 * (rad / echantillon a 44,1 kHz), extinction sigma, deformees (normalisees
 * en masse) aux points du groupe. */
function analyseModale(K, C, m, n, nb) {
  // cle de cache : petit hachage des matrices
  let h = 2166136261 >>> 0;
  const melange = v => { const s = String(Math.round(v * 1e12)); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; };
  for (let i = 0; i < n * n; i++) if (K[i] !== 0 || C[i] !== 0) { melange(i); melange(K[i]); melange(C[i]); }
  for (let i = 0; i < n; i++) melange(m[i]);
  const cle = `${n}:${nb}:${h}`;
  if (CACHE_MODES.has(cle)) return CACHE_MODES.get(cle);

  const r = Float64Array.from(m, v => 1 / Math.sqrt(v));      // M^-1/2
  const S = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) S[i * n + j] = r[i] * K[i * n + j] * r[j];
  const { d, z } = vecteursPropres(S, n);
  const ordre = [...d.keys()].sort((a, b) => d[a] - d[b]).filter(j => d[j] > 1e-12);
  const omega = [], sigma = [], formes = [];
  for (const j of ordre) {
    const sl = Math.sqrt(d[j]);
    const w = sl < 2 ? 2 * Math.asin(sl / 2) : sl;            // = reseau masses-ressorts tant qu'il est stable
    if (w >= 3.1) break;
    const phi = new Float64Array(n);
    for (let k = 0; k < n; k++) phi[k] = r[k] * z[k * n + j];
    let s = 0;
    for (let a = 0; a < n; a++) { if (phi[a] === 0) continue; for (let b = 0; b < n; b++) s += phi[a] * C[a * n + b] * phi[b]; }
    omega.push(w); sigma.push(Math.max(s / 2, 0)); formes.push(phi);
    if (omega.length >= nb) break;
  }
  // reglages par defaut : t60 du mode grave et "brillance" (sigma ~ lineaire en omega)
  let t60 = 2, brillance = 0;
  if (omega.length) {
    const nM = omega.length, mw = omega.reduce((a, b) => a + b, 0) / nM, ms = sigma.reduce((a, b) => a + b, 0) / nM;
    let num = 0, den = 0;
    for (let k = 0; k < nM; k++) { num += (omega[k] - mw) * (sigma[k] - ms); den += (omega[k] - mw) ** 2; }
    const c = den > 0 ? num / den : 0, a = ms - c * mw;
    const s1 = Math.max(a + c * omega[0], 1e-9);
    t60 = Math.min(Math.max(6.91 / (s1 * 44100), 0.05), 60);
    brillance = Math.min(Math.max(c * omega[0] / s1, 0), 4);
  }
  const res = { omega, sigma, formes, t60, brillance };
  if (CACHE_MODES.size > 20) CACHE_MODES.clear();
  CACHE_MODES.set(cle, res);
  return res;
}

/* coefficients d'un mode, exactement comme compute_modal (migen-plus) */
function coefModes(omega, hauteur, t60, brillance, fz, sr) {
  const A = [], B = [];
  const w1 = (omega[0] || 1) * hauteur * fz;
  for (const o of omega) {
    const w = o * hauteur * fz;
    let r = 0;
    if (w < 3.1) {
      const sig = 6.91 / (Math.max(t60, 0.001) * sr) * (1 + brillance * (w / Math.max(w1, 1e-9) - 1));
      r = Math.exp(-sig);
    }
    A.push(2 * r * Math.cos(w)); B.push(-r * r);
  }
  return { A, B };
}
