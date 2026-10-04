"use strict";
/* ------------------------------------------------------------------ *
 *  Vue 3D sur canvas : orbite, zoom, deplacement, selection, et       *
 *  billes d'entree (posInput) a attraper a la souris.                 *
 *  Dessine le modele compile (desc) : points, proxies, liaisons.      *
 * ------------------------------------------------------------------ */

const COULEURS = {
  fond: "#12151a", grille: "#242a33", axeX: "#7a4040", axeY: "#40603f",
  mobile: "#5aa9e6", macro: "#4f8fc4", fixe: "#e05555", entree: "#f4d03f",
  proxy: "#ffffff", sortie: "#58d68d", selection: "#ffffff", selection2: "#ff9f43",
};
// couleur et pointilles par code d'interaction (CODES_INTER)
const STYLE_LIEN = [
  ["#5f6f80", []], ["#4a5560", [1, 3]], ["#7d8fa3", []], ["#e08b3d", [4, 3]], ["#e08b3d", [4, 3]],
  ["#4fb3a9", []], ["#4fb3a9", []], ["#4fb3a9", []], ["#58d68d", [2, 3]], ["#b07cc6", [6, 3]],
];

class Vue3D {
  constructor(canvas, rappels = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.rappels = rappels;              // surSelection(i, i2), surPlacement(i, z)

    this.yaw = 35 * Math.PI / 180;
    this.pitch = 28 * Math.PI / 180;
    this.zoom = 14.0;
    this.panx = 0.0; this.pany = 0.0;
    this.cible = [0.0, 0.0, 5.0];
    this.persp = 60.0;

    this.desc = null;
    this.pos = new Float64Array(0);      // x y z par point (noeuds puis proxies)
    this.selection = -1;
    this.selection2 = -1;
    this._plancher = new Set();
    this._drag = null;
    this._demandeDessin = false;

    canvas.addEventListener("pointerdown", e => this._pointerDown(e));
    canvas.addEventListener("pointermove", e => this._pointerMove(e));
    canvas.addEventListener("pointerup", e => this._pointerUp(e));
    canvas.addEventListener("pointercancel", () => { this._drag = null; });
    canvas.addEventListener("dblclick", () => this.recadrer());
    canvas.addEventListener("contextmenu", e => e.preventDefault());
    canvas.addEventListener("wheel", e => {
      e.preventDefault();
      const brut = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
      this._zoomPas(-brut / 120);
    }, { passive: false });

    this._taillePrete = false;
    new ResizeObserver(() => this._retaille()).observe(canvas);
    window.addEventListener("resize", () => this._retaille());
    this._retaille();
    requestAnimationFrame(() => this._retaille());
  }

  _retaille() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w < 1 || h < 1) return;
    const nw = Math.round(w * dpr), nh = Math.round(h * dpr);
    const change = this.canvas.width !== nw || this.canvas.height !== nh;
    if (change) { this.canvas.width = nw; this.canvas.height = nh; }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!this._taillePrete) { this._taillePrete = true; this.recadrer(); }
    else if (change) this.redessiner();
  }

  /* ---------------- modele ---------------- */

  charger(desc, garderVue = false) {
    const ancien = this.desc;
    this.desc = desc;
    const T = desc ? desc.nbNoeuds + desc.nbProxies : 0;
    this.pos = new Float64Array(T * 3);
    if (desc) {
      for (let i = 0; i < desc.nbNoeuds; i++) {
        this.pos[3 * i] = desc.gx[i]; this.pos[3 * i + 1] = desc.gy[i]; this.pos[3 * i + 2] = desc.gz[i] + desc.u0[i];
      }
      desc.proxyGeo.forEach((g, k) => this.pos.set(g, 3 * (desc.nbNoeuds + k)));
      this._sorties = new Set(desc.sorties.map(s => s.i));
      this._entreesForce = new Set(desc.entrees.map(e => e.i));
      this._plancher = new Set(desc.plancher || []);
    }
    if (!ancien || !desc || this.selection >= T || ancien.noms[this.selection] !== (desc.noms[this.selection]))
      this.selection = -1;
    if (this.selection2 >= T) this.selection2 = -1;
    if (garderVue) this.redessiner(); else this.recadrer();
  }

  /* hauteurs dynamiques : u = etat du moteur, amp = exageration visuelle */
  majPositions(u, amp, entraines) {
    const d = this.desc;
    if (!d || u.length < d.nbNoeuds) return;
    const tenue = this._drag && this._drag[0] === "bille" ? this._drag[3] : -1;
    for (let i = 0; i < d.nbNoeuds; i++) {
      if (i === tenue) continue;
      const e = d.etat[i];
      let z = d.gz[i] + (e === MOBILE ? (u[i] - d.u0[i]) * amp + d.u0[i]
                         : e === ENTREE && !(entraines && entraines.has(i)) ? u[i] : d.u0[i]);
      if (d.gz[i] >= 0 && z < 0) z = 0;              // rien ne s'affiche sous le plan
      this.pos[3 * i + 2] = z;
    }
    for (let k = 0; k < d.nbProxies; k++) {
      const p = d.proxies[k];
      let z = 0;
      p.noeuds.forEach((n, j) => { z += this.pos[3 * n + 2] * p.poids[j]; });
      this.pos[3 * (d.nbNoeuds + k) + 2] = z;
    }
    this.redessiner();
  }

  bornes() {
    const d = this.desc;
    if (!d || !d.nbNoeuds) return [-10, 10, -10, 10, 0, 10];
    const b = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < d.nbNoeuds; i++) {
      b[0] = Math.min(b[0], d.gx[i]); b[1] = Math.max(b[1], d.gx[i]);
      b[2] = Math.min(b[2], d.gy[i]); b[3] = Math.max(b[3], d.gy[i]);
      b[4] = Math.min(b[4], d.gz[i]); b[5] = Math.max(b[5], d.gz[i]);
    }
    return b;
  }

  recadrer() {
    const [x0, x1, y0, y1, z0, z1] = this.bornes();
    this.cible = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const etendue = Math.max(x1 - x0, y1 - y0, z1 - z0, 4.0);
    const w = Math.max(this.canvas.clientWidth, 300), h = Math.max(this.canvas.clientHeight, 300);
    this.zoom = 0.75 * Math.min(w, h) / etendue;
    this.panx = this.pany = 0.0;
    this.redessiner();
  }

  /* ---------------- projection ---------------- */

  _projette(x, y, z) {
    const ca = Math.cos(this.yaw), sa = Math.sin(this.yaw);
    const cb = Math.cos(this.pitch), sb = Math.sin(this.pitch);
    const dx = x - this.cible[0], dy = y - this.cible[1], dz = z - this.cible[2];
    const X = dx * ca + dy * sa;
    const Y = -dx * sa + dy * ca;
    const Z2 = -Y * sb + dz * cb;
    const prof = Y * cb + dz * sb;
    const s = this.persp / Math.max(this.persp + prof * 0.04, 0.2);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return [w / 2 + this.zoom * s * X + this.panx, h / 2 - this.zoom * s * Z2 + this.pany, prof, s];
  }

  _projetteTout() {
    const T = this.pos.length / 3;
    if (!this._proj || this._proj.length !== T * 4) this._proj = new Float64Array(T * 4);
    const P = this._proj, pos = this.pos;
    const ca = Math.cos(this.yaw), sa = Math.sin(this.yaw);
    const cb = Math.cos(this.pitch), sb = Math.sin(this.pitch);
    const w2 = this.canvas.clientWidth / 2, h2 = this.canvas.clientHeight / 2;
    for (let i = 0; i < T; i++) {
      const dx = pos[3 * i] - this.cible[0], dy = pos[3 * i + 1] - this.cible[1], dz = pos[3 * i + 2] - this.cible[2];
      const X = dx * ca + dy * sa, Y = -dx * sa + dy * ca;
      const Z2 = -Y * sb + dz * cb, prof = Y * cb + dz * sb;
      const s = this.persp / Math.max(this.persp + prof * 0.04, 0.2);
      P[4 * i] = w2 + this.zoom * s * X + this.panx;
      P[4 * i + 1] = h2 - this.zoom * s * Z2 + this.pany;
      P[4 * i + 2] = prof; P[4 * i + 3] = s;
    }
    return P;
  }

  /* ---------------- dessin ---------------- */

  redessiner() {
    if (this._demandeDessin) return;
    this._demandeDessin = true;
    requestAnimationFrame(() => { this._demandeDessin = false; this._dessine(); });
  }

  _dessine() {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    ctx.fillStyle = COULEURS.fond;
    ctx.fillRect(0, 0, w, h);
    this._grille();
    const d = this.desc;
    if (!d) return;
    const P = this._projetteTout();
    const n = d.nbNoeuds, T = n + d.nbProxies;

    // liaisons, regroupees par style (un seul trace par groupe)
    const groupes = new Map();
    for (const l of d.liens) {
      const interne = l.nom === null;
      const cle = interne ? -1 : l.code;
      if (!groupes.has(cle)) groupes.set(cle, []);
      groupes.get(cle).push(l);
    }
    for (const [cle, liste] of groupes) {
      const [coul, tirets] = cle === -1 ? ["#3d4a5a", []] : STYLE_LIEN[cle] || ["#666", []];
      ctx.strokeStyle = coul; ctx.setLineDash(tirets); ctx.lineWidth = cle === -1 ? 1 : 1.5;
      ctx.beginPath();
      for (const l of liste) {
        if (this._plancher.has(l.i1) || this._plancher.has(l.i2)) continue;   // contacts au sol : invisibles
        ctx.moveTo(P[4 * l.i1], P[4 * l.i1 + 1]);
        ctx.lineTo(P[4 * l.i2], P[4 * l.i2 + 1]);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // points, lointains d'abord
    const ordre = new Int32Array(T);
    for (let i = 0; i < T; i++) ordre[i] = i;
    if (T < 4000) ordre.sort((a, b) => P[4 * b + 2] - P[4 * a + 2]);
    const petit = n > 600;
    for (const i of ordre) {
      if (this._plancher.has(i)) continue;
      const px = P[4 * i], py = P[4 * i + 1], s = P[4 * i + 3];
      let r, coul, carre = false;
      if (i >= n) { r = 3.2 * s; coul = COULEURS.proxy; }
      else {
        const e = d.etat[i], dansMacro = d.element[i] !== d.noms[i];
        if (e === ENTREE) { r = 6 * s; coul = COULEURS.entree; }
        else if (e === FIXE) { r = (dansMacro ? 2.4 : 3.4) * s; coul = COULEURS.fixe; carre = true; }
        else { r = (dansMacro || petit ? 2.2 : 3.5) * s; coul = dansMacro ? COULEURS.macro : COULEURS.mobile; }
      }
      r = Math.max(r, 1.5);
      ctx.fillStyle = coul;
      if (carre) ctx.fillRect(px - r, py - r, 2 * r, 2 * r);
      else if (i >= n) { ctx.beginPath(); ctx.moveTo(px, py - r); ctx.lineTo(px + r, py); ctx.lineTo(px, py + r); ctx.lineTo(px - r, py); ctx.fill(); }
      else { ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill(); }
      if (this._sorties.has(i)) {
        ctx.strokeStyle = COULEURS.sortie; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, r + 3.5, 0, TAU); ctx.stroke();
      }
      if (this._entreesForce.has(i)) {
        ctx.strokeStyle = COULEURS.entree; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px, py - r - 9); ctx.lineTo(px, py - r - 2);
        ctx.moveTo(px - 3, py - r - 5); ctx.lineTo(px, py - r - 2); ctx.lineTo(px + 3, py - r - 5); ctx.stroke();
      }
      if (i === this.selection || i === this.selection2) {
        ctx.strokeStyle = i === this.selection ? COULEURS.selection : COULEURS.selection2; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(px, py, r + 5, 0, TAU); ctx.stroke();
      }
    }
  }

  _grille() {
    const ctx = this.ctx, L = 20, pas = 5;
    ctx.strokeStyle = COULEURS.grille; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = -L; i <= L; i += pas)
      for (const [a, b] of [[[i, -L, 0], [i, L, 0]], [[-L, i, 0], [L, i, 0]]]) {
        const [x1, y1] = this._projette(...a), [x2, y2] = this._projette(...b);
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      }
    ctx.stroke();
    for (const [axe, coul] of [[[L, 0, 0], COULEURS.axeX], [[0, L, 0], COULEURS.axeY]]) {
      const [x1, y1] = this._projette(0, 0, 0), [x2, y2] = this._projette(...axe);
      ctx.strokeStyle = coul; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }

  /* ---------------- souris ---------------- */

  _xy(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  _plusProche(ex, ey, filtre, rayon = 12) {
    if (!this.desc) return -1;
    const P = this._projetteTout();
    let best = -1, dmin = rayon;
    for (let i = 0; i < P.length / 4; i++) {
      if ((filtre && !filtre(i)) || (this._plancher && this._plancher.has(i))) continue;
      const dd = Math.hypot(P[4 * i] - ex, P[4 * i + 1] - ey);
      if (dd < dmin) { best = i; dmin = dd; }
    }
    return best;
  }

  _pointerDown(e) {
    const [x, y] = this._xy(e);
    this.canvas.setPointerCapture(e.pointerId);
    const d = this.desc;
    const bille = e.button === 0 && d ? this._plusProche(x, y, i => i < d.nbNoeuds && d.etat[i] === ENTREE, 14) : -1;
    if (bille >= 0) {
      this.selection = bille;
      const s = this._projette(...this.pos.subarray(3 * bille, 3 * bille + 3))[3];
      const echelle = Math.max(this.zoom * s * Math.cos(this.pitch), 1e-3);
      this._drag = ["bille", y, this.pos[3 * bille + 2], bille, echelle];
      if (this.rappels.surSelection) this.rappels.surSelection(bille, this.selection2);
      this.canvas.style.cursor = "ns-resize";
    } else if (e.button === 0) this._drag = ["maybe", x, y, e.shiftKey];
    else this._drag = ["pan", x, y];
    e.preventDefault();
  }

  _pointerMove(e) {
    if (this._drag === null) {
      if (this.desc && e.pointerType === "mouse") {
        const [x, y] = this._xy(e);
        const d = this.desc;
        const sur = this._plusProche(x, y, i => i < d.nbNoeuds && d.etat[i] === ENTREE, 14) >= 0;
        this.canvas.style.cursor = sur ? "ns-resize" : "grab";
      }
      return;
    }
    const [x, y] = this._xy(e);
    const [mode, x0, y0] = this._drag;
    if (mode === "bille") {
      const [, yDepart, zDepart, i, echelle] = this._drag;
      let z = zDepart - (y - yDepart) / echelle;
      if (this.desc.gz[i] >= 0) z = Math.max(z, 0);  // la bille ne traverse pas le plan
      this.pos[3 * i + 2] = z;
      if (this.rappels.surPlacement) this.rappels.surPlacement(i, z);
      this.redessiner();
      return;
    }
    if (mode === "maybe") {
      if (Math.abs(x - x0) + Math.abs(y - y0) < 4) return;
      this._drag = ["orbit", x0, y0];
      return this._pointerMove(e);
    }
    if (mode === "orbit") {
      this.yaw += (x - x0) * 0.008;
      this.pitch = Math.min(Math.max(this.pitch + (y - y0) * 0.008, -1.4), 1.5);
      this.canvas.style.cursor = "grabbing";
    } else { this.panx += x - x0; this.pany += y - y0; }
    this._drag = [mode, x, y];
    this.redessiner();
  }

  _pointerUp(e) {
    if (this._drag && this._drag[0] === "maybe") {
      const [x, y] = this._xy(e);
      const i = this._plusProche(x, y, null, 12);
      if (this._drag[3] && this.selection >= 0 && i >= 0 && i !== this.selection) this.selection2 = i;
      else { this.selection = i; this.selection2 = -1; }
      if (this.rappels.surSelection) this.rappels.surSelection(this.selection, this.selection2);
      this.redessiner();
    }
    this._drag = null;
    this.canvas.style.cursor = "grab";
  }

  _zoomPas(pas) {
    this.zoom = Math.min(Math.max(this.zoom * 1.1 ** pas, 0.5), 400);
    this.redessiner();
  }

  /* position ecran d'un point (pour placer l'inspecteur) */
  ecran(i) {
    if (i < 0 || !this.desc) return null;
    const [px, py] = this._projette(...this.pos.subarray(3 * i, 3 * i + 3));
    return [px, py];
  }
}
