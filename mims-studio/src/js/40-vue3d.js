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
    this.selection = -1;                 // point principal (dernier clique)
    this.selection2 = -1;                // 2e point quand exactement deux sont choisis
    this.multi = new Set();              // tous les points selectionnes
    this.edition = false;                // mode Editer
    this.outil = "selection";            // selection | mass | osc | ground | relier | corde | membrane
    this.planZ = 4;                      // hauteur du plan de travail
    this.pas = 0.5;                      // magnetisme (0 = libre)
    this._apercu = null;                 // trace en cours (corde, membrane, cadre)
    this._relierDepuis = -1;
    this._plancher = new Set();
    this._vibrants = new Set();
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
      this._plancher = new Set([...(desc.plancher || []), ...(desc.virtuel || [])]);   // non dessines
      this._vibrants = new Set(desc.vibrants || []);
    }
    // garde la selection si les points existent toujours (memes noms)
    const garde = i => ancien && desc && i < T && ancien.noms[i] === desc.noms[i];
    this.multi = new Set([...this.multi].filter(garde));
    if (!garde(this.selection)) this.selection = this.multi.size ? [...this.multi].pop() : -1;
    this._majSelection2();
    if (!garde(this._relierDepuis)) this._relierDepuis = -1;
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
    // objets modaux : chaque point = somme des modes ponderee par sa deformee
    for (const md of d.modaux || []) {
      for (let r = 0; r < md.membres.length; r++) {
        const i = md.membres[r];
        if (i === tenue) continue;
        let s = 0;
        for (let k = 0; k < md.nb; k++) s += md.lignes[r * md.nb + k] * u[md.debut + k];
        let z = d.gz[i] + s * amp;
        if (d.gz[i] >= 0 && z < 0) z = 0;
        this.pos[3 * i + 2] = z;
      }
    }
    for (let k = 0; k < d.nbProxies; k++) {
      const p = d.proxies[k];
      let z = 0;
      if (p.modal) z = d.proxyGeo[k][2] + u[d.nbNoeuds + k] * amp;
      else p.noeuds.forEach((n, j) => { z += this.pos[3 * n + 2] * p.poids[j]; });
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
    if (d.aretesModales && d.aretesModales.length) groupes.set(-1, d.aretesModales.map(([a, b]) => ({ i1: a, i2: b, nom: null })));
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
        const e = this._vibrants.has(i) ? MOBILE : d.etat[i], dansMacro = d.element[i] !== d.noms[i];
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
      if (this.multi.has(i) || i === this._relierDepuis) {
        ctx.strokeStyle = i === this.selection ? COULEURS.selection : COULEURS.selection2; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(px, py, r + 5, 0, TAU); ctx.stroke();
      }
    }
    if (this.edition) this._dessineEdition();
  }

  _grille() {
    const ctx = this.ctx, L = 20, pas = 5;
    if (this.edition && Math.abs(this.planZ) > 1e-6) {          // plan de travail
      ctx.strokeStyle = "#1f3a4d"; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath();
      for (let i = -L; i <= L; i += pas / 2)
        for (const [a, b] of [[[i, -L, this.planZ], [i, L, this.planZ]], [[-L, i, this.planZ], [L, i, this.planZ]]]) {
          const [x1, y1] = this._projette(...a), [x2, y2] = this._projette(...b);
          ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        }
      ctx.stroke();
    }
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

  /* ---------------- selection ---------------- */

  _majSelection2() {
    this.selection2 = -1;
    if (this.multi.size === 2) for (const i of this.multi) if (i !== this.selection) this.selection2 = i;
  }

  choisir(i, ajouter = false) {
    if (i < 0) { if (!ajouter) { this.multi.clear(); this.selection = -1; } }
    else if (ajouter && this.multi.has(i)) {
      this.multi.delete(i);
      if (this.selection === i) this.selection = this.multi.size ? [...this.multi].pop() : -1;
    } else {
      if (!ajouter) this.multi.clear();
      this.multi.add(i); this.selection = i;
    }
    this._majSelection2();
    if (this.rappels.surSelection) this.rappels.surSelection();
    this.redessiner();
  }

  /* points deplacables : pas les proxies ni le sol ; un point de structure
   * integree entraine toute la structure */
  _aDeplacer(indices) {
    const d = this.desc, res = new Set();
    for (const i of indices) {
      if (i >= d.nbNoeuds || this._plancher.has(i)) continue;
      if (d.element[i] !== d.noms[i]) {
        const mc = d.macros.find(m => m.nom === d.element[i]);
        for (let k = 0; k < mc.nx * mc.ny; k++) res.add(mc.debut + k);
      } else res.add(i);
    }
    return [...res];
  }

  /* ---------------- geometrie ecran <-> monde ---------------- */

  /* point du plan horizontal z = h sous le pointeur (Newton sur la projection) */
  surPlan(sx, sy, h) {
    let x = this.cible[0], y = this.cible[1];
    for (let it = 0; it < 8; it++) {
      const [px, py] = this._projette(x, y, h);
      const e = 1e-3;
      const [ax, ay] = this._projette(x + e, y, h), [bx, by] = this._projette(x, y + e, h);
      const j11 = (ax - px) / e, j21 = (ay - py) / e, j12 = (bx - px) / e, j22 = (by - py) / e;
      const det = j11 * j22 - j12 * j21;
      if (Math.abs(det) < 1e-9) break;
      const rx = sx - px, ry = sy - py;
      x += (j22 * rx - j12 * ry) / det;
      y += (-j21 * rx + j11 * ry) / det;
    }
    const s = v => this.pas > 0 ? Math.round(v / this.pas) * this.pas : v;
    return [s(x), s(y), h];
  }

  _centre(indices) {
    const c = [0, 0, 0];
    for (const i of indices) for (let k = 0; k < 3; k++) c[k] += this.pos[3 * i + k];
    return c.map(v => v / Math.max(indices.length, 1));
  }

  /* poignees de deplacement : origine, extremites des fleches X Y Z */
  _gizmo() {
    if (!this.edition || this.outil !== "selection" || !this.desc) return null;
    const ids = this._aDeplacer(this.multi);
    if (!ids.length) return null;
    const c = this._centre(ids);
    const [ox, oy] = this._projette(...c);
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(e => {
      const [px, py] = this._projette(c[0] + e[0], c[1] + e[1], c[2] + e[2]);
      const parUnite = Math.hypot(px - ox, py - oy) || 1e-3;
      const L = 70 / parUnite;
      const [ex, ey] = this._projette(c[0] + e[0] * L, c[1] + e[1] * L, c[2] + e[2] * L);
      return { ex, ey, ux: (px - ox) / parUnite, uy: (py - oy) / parUnite, parUnite, vx: px - ox, vy: py - oy };
    });
    return { c, ox, oy, axes, ids };
  }

  _toucheGizmo(x, y) {
    const g = this._gizmo();
    if (!g) return null;
    if (Math.abs(x - g.ox) < 9 && Math.abs(y - g.oy) < 9) return { g, axe: -1 };
    for (let k = 0; k < 3; k++) {
      const a = g.axes[k], dx = a.ex - g.ox, dy = a.ey - g.oy, L2 = dx * dx + dy * dy || 1;
      const t = Math.min(Math.max(((x - g.ox) * dx + (y - g.oy) * dy) / L2, 0), 1);
      if (t > 0.15 && Math.hypot(x - g.ox - t * dx, y - g.oy - t * dy) < 7) return { g, axe: k };
    }
    return null;
  }

  _dessineEdition() {
    const ctx = this.ctx;
    const g = this._gizmo();
    if (g) {
      const coul = ["#e05555", "#58d68d", "#5aa9e6"], noms = ["X", "Y", "Z"];
      g.axes.forEach((a, k) => {
        ctx.strokeStyle = coul[k]; ctx.fillStyle = coul[k]; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(g.ox, g.oy); ctx.lineTo(a.ex, a.ey); ctx.stroke();
        const ang = Math.atan2(a.ey - g.oy, a.ex - g.ox);
        ctx.beginPath(); ctx.moveTo(a.ex + 8 * Math.cos(ang), a.ey + 8 * Math.sin(ang));
        ctx.lineTo(a.ex + 6 * Math.cos(ang + 2.3), a.ey + 6 * Math.sin(ang + 2.3));
        ctx.lineTo(a.ex + 6 * Math.cos(ang - 2.3), a.ey + 6 * Math.sin(ang - 2.3)); ctx.fill();
        ctx.font = "bold 11px sans-serif"; ctx.fillText(noms[k], a.ex + 10 * Math.cos(ang) - 4, a.ey + 10 * Math.sin(ang) + 4);
      });
      ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillRect(g.ox - 6, g.oy - 6, 12, 12);
    }
    const ap = this._apercu;
    if (ap) {
      ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      if (ap.type === "cadre") ctx.rect(ap.x0, ap.y0, ap.x1 - ap.x0, ap.y1 - ap.y0);
      else if (ap.type === "corde" || ap.type === "lien") {
        const [ax, ay] = this._projette(...ap.p0), [bx, by] = this._projette(...ap.p1);
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      } else if (ap.type === "membrane") {
        const c = [[ap.p0[0], ap.p0[1]], [ap.p1[0], ap.p0[1]], [ap.p1[0], ap.p1[1]], [ap.p0[0], ap.p1[1]]]
          .map(([x, y]) => this._projette(x, y, ap.p0[2]));
        ctx.moveTo(c[0][0], c[0][1]); for (const q of c.slice(1)) ctx.lineTo(q[0], q[1]); ctx.closePath();
      } else if (ap.type === "point") {
        const [px, py] = this._projette(...ap.p0);
        ctx.setLineDash([]); ctx.arc(px, py, 6, 0, TAU);
        const [qx, qy] = this._projette(ap.p0[0], ap.p0[1], 0);
        ctx.moveTo(px, py); ctx.lineTo(qx, qy);
      }
      ctx.stroke(); ctx.setLineDash([]);
      if (ap.texte) {
        ctx.fillStyle = "#ffd166"; ctx.font = "12px sans-serif";
        ctx.fillText(ap.texte, ap.tx + 12, ap.ty - 10);
      }
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
      if ((filtre && !filtre(i)) || this._plancher.has(i)) continue;
      const dd = Math.hypot(P[4 * i] - ex, P[4 * i + 1] - ey);
      if (dd < dmin) { best = i; dmin = dd; }
    }
    return best;
  }

  _pointerDown(e) {
    const [x, y] = this._xy(e);
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    const d = this.desc;
    // orbite / deplacement de la vue : clic droit (Maj = deplacer), milieu = deplacer
    if (e.button === 1 || (e.button === 2 && (e.shiftKey || !this.edition))) { this._drag = ["pan", x, y]; return; }
    if (e.button === 2 || (e.button === 0 && e.altKey)) { this._drag = ["orbit", x, y]; return; }
    if (e.button !== 0) return;

    if (!this.edition) {                                   // mode Jouer
      const bille = d ? this._plusProche(x, y, i => i < d.nbNoeuds && d.etat[i] === ENTREE, 14) : -1;
      if (bille >= 0) {
        this.choisir(bille);
        const s = this._projette(...this.pos.subarray(3 * bille, 3 * bille + 3))[3];
        const echelle = Math.max(this.zoom * s * Math.cos(this.pitch), 1e-3);
        this._drag = ["bille", y, this.pos[3 * bille + 2], bille, echelle];
        this.canvas.style.cursor = "ns-resize";
      } else this._drag = ["maybe", x, y, e.shiftKey];
      return;
    }

    // mode Editer
    if (this.outil === "selection") {
      const t = this._toucheGizmo(x, y);
      if (t) { this._debutDeplacement(t.g.ids, t.axe, x, y, t.g); return; }
      const i = this._plusProche(x, y, null, 10);
      if (i >= 0) {
        if (!this.multi.has(i) || e.shiftKey) this.choisir(i, e.shiftKey);
        const g = this._gizmo();
        if (g) this._drag = ["attente-plan", x, y, g];
        return;
      }
      this._drag = ["cadre", x, y, e.shiftKey];
      return;
    }
    if (this.outil === "relier") {
      const i = this._plusProche(x, y, null, 12);
      if (i < 0) { this._relierDepuis = -1; this.redessiner(); return; }
      if (this._relierDepuis < 0 || this._relierDepuis === i) { this._relierDepuis = i; this.redessiner(); return; }
      const a = this._relierDepuis;
      this._relierDepuis = e.shiftKey ? i : -1;
      if (this.rappels.surRelier) this.rappels.surRelier(a, i);
      return;
    }
    const p0 = this.surPlan(x, y, this.planZ);
    if (this.outil === "corde" || this.outil === "membrane") { this._drag = ["trace", x, y, p0]; return; }
    if (this.rappels.surCreation) this.rappels.surCreation(this.outil, p0, null);   // poser un point
  }

  _debutDeplacement(ids, axe, x, y, g) {
    this._posDepart = this.pos.slice();
    this._drag = ["deplace", x, y, ids, axe, g, [0, 0, 0]];
  }

  _pointerMove(e) {
    const [x, y] = this._xy(e);
    if (this._drag === null) {
      if (!this.desc || e.pointerType !== "mouse") return;
      const d = this.desc;
      if (this.edition && ["mass", "osc", "ground", "corde", "membrane"].includes(this.outil)) {
        const p = this.surPlan(x, y, this.planZ);
        this._apercu = { type: "point", p0: p, texte: `${p[0].toFixed(1)}, ${p[1].toFixed(1)}, z ${p[2].toFixed(1)}`, tx: x, ty: y };
        this.canvas.style.cursor = "crosshair";
        this.redessiner();
      } else if (this.edition && this.outil === "relier" && this._relierDepuis >= 0) {
        const i = this._plusProche(x, y, null, 12);
        const a = this.pos.subarray(3 * this._relierDepuis, 3 * this._relierDepuis + 3);
        const b = i >= 0 ? this.pos.subarray(3 * i, 3 * i + 3) : this.surPlan(x, y, a[2]);
        this._apercu = { type: "lien", p0: [...a], p1: [...b] };
        this.redessiner();
      } else if (this.edition && this.outil === "selection") {
        this.canvas.style.cursor = this._toucheGizmo(x, y) ? "move" : this._plusProche(x, y, null, 10) >= 0 ? "pointer" : "default";
      } else {
        const sur = this._plusProche(x, y, i => i < d.nbNoeuds && d.etat[i] === ENTREE, 14) >= 0;
        this.canvas.style.cursor = sur ? "ns-resize" : "grab";
      }
      return;
    }
    const [mode, x0, y0] = this._drag;
    if (mode === "bille") {
      const [, yDepart, zDepart, i, echelle] = this._drag;
      let z = zDepart - (y - yDepart) / echelle;
      if (this.desc.gz[i] >= 0) z = Math.max(z, 0);      // la bille ne traverse pas le plan
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
    if (mode === "attente-plan") {                        // glisser un point = deplacement dans le plan XY
      if (Math.abs(x - x0) + Math.abs(y - y0) < 4) return;
      const g = this._drag[3];
      this._debutDeplacement(g.ids, -1, x0, y0, g);
      return this._pointerMove(e);
    }
    if (mode === "deplace") {
      const [, xs, ys, ids, axe, g] = this._drag;
      const mx = x - xs, my = y - ys;
      let dv = [0, 0, 0];
      if (axe >= 0) {
        const a = g.axes[axe];
        dv[axe] = (mx * a.ux + my * a.uy) / a.parUnite;
      } else {                                             // plan XY : systeme 2x2
        const A = g.axes[0], B = g.axes[1], det = A.vx * B.vy - B.vx * A.vy;
        if (Math.abs(det) > 1e-6) { dv[0] = (mx * B.vy - B.vx * my) / det; dv[1] = (A.vx * my - mx * A.vy) / det; }
      }
      if (this.pas > 0) dv = dv.map(v => Math.round(v / this.pas) * this.pas);
      this._drag[6] = dv;
      for (const i of ids) for (let k = 0; k < 3; k++) this.pos[3 * i + k] = this._posDepart[3 * i + k] + dv[k];
      this._apercu = { type: "texte", texte: `Δ ${dv.map(v => v.toFixed(2)).join("  ")}`, tx: x, ty: y };
      this.redessiner();
      return;
    }
    if (mode === "cadre") {
      this._apercu = { type: "cadre", x0: Math.min(x0, x), y0: Math.min(y0, y), x1: Math.max(x0, x), y1: Math.max(y0, y) };
      this.redessiner();
      return;
    }
    if (mode === "trace") {
      const p0 = this._drag[3], p1 = this.surPlan(x, y, this.planZ);
      const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      this._apercu = this.outil === "corde"
        ? { type: "corde", p0, p1, texte: `corde ${L.toFixed(1)} (≈ ${Math.min(Math.max(Math.round(L * 2.5), 8), 200)} masses)`, tx: x, ty: y }
        : { type: "membrane", p0, p1, texte: `membrane ${Math.abs(p1[0] - p0[0]).toFixed(1)} × ${Math.abs(p1[1] - p0[1]).toFixed(1)}`, tx: x, ty: y };
      this.redessiner();
      return;
    }
    if (mode === "orbit") {
      this.yaw += (x - x0) * 0.008;
      this.pitch = Math.min(Math.max(this.pitch + (y - y0) * 0.008, -1.4), 1.5);
      this.canvas.style.cursor = "grabbing";
    } else { this.panx += x - x0; this.pany += y - y0; }
    this._drag[1] = x; this._drag[2] = y;
    this.redessiner();
  }

  _pointerUp(e) {
    const dr = this._drag;
    this._drag = null;
    this.canvas.style.cursor = this.edition ? "default" : "grab";
    if (!dr) return;
    const [x, y] = this._xy(e);
    if (dr[0] === "maybe") this.choisir(this._plusProche(x, y, null, 12), dr[3]);
    else if (dr[0] === "attente-plan") { /* simple clic sur un point deja choisi */ }
    else if (dr[0] === "cadre") {
      const ap = this._apercu;
      this._apercu = null;
      if (!ap || ap.type !== "cadre") { this.choisir(-1, dr[3]); return; }
      const P = this._projetteTout();
      if (!dr[3]) this.multi.clear();
      for (let i = 0; i < P.length / 4; i++)
        if (!this._plancher.has(i) && P[4 * i] >= ap.x0 && P[4 * i] <= ap.x1 && P[4 * i + 1] >= ap.y0 && P[4 * i + 1] <= ap.y1) {
          this.multi.add(i); this.selection = i;
        }
      if (!this.multi.size) this.selection = -1;
      this._majSelection2();
      if (this.rappels.surSelection) this.rappels.surSelection();
      this.redessiner();
    } else if (dr[0] === "deplace") {
      this._apercu = null;
      const dv = dr[6];
      if (dv.some(v => v !== 0) && this.rappels.surDeplacement) this.rappels.surDeplacement([...this.multi], dv);
      else { this.pos.set(this._posDepart); this.redessiner(); }
    } else if (dr[0] === "trace") {
      const p0 = dr[3], p1 = this.surPlan(x, y, this.planZ);
      this._apercu = null;
      if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 0.9 && this.rappels.surCreation) this.rappels.surCreation(this.outil, p0, p1);
      this.redessiner();
    }
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
