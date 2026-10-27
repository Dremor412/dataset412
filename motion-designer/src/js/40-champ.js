/* Champ spatial : on y deplace l'auditeur et les sources a la souris
 * (ou au doigt). Les positions affichees et entendues suivent la cible
 * avec un lissage ; on mesure aussi la vitesse de chaque objet. */
"use strict";

const champ = {
  canvas: null, g: null, taille: 0,
  lisse: new Map(),        // id -> {x, y, vx, vy}
  aud: { x: 0, y: 0, vx: 0, vy: 0 },
  selection: new Set(),
  focus: null,             // source "en main" (barre espace)
  saisie: null,            // glisser en cours
  dernierBouge: null,      // "aud" ou id de source
  vitesseGlisse: 0,

  init() {
    this.canvas = $("#champ");
    this.g = this.canvas.getContext("2d");
    new ResizeObserver(() => this.redimensionner()).observe(this.canvas.parentElement);
    this.canvas.addEventListener("pointerdown", e => this.appui(e));
    this.canvas.addEventListener("pointermove", e => this.bouger(e));
    this.canvas.addEventListener("pointerup", e => this.relache(e));
    this.canvas.addEventListener("pointercancel", e => this.relache(e));
    this.canvas.addEventListener("contextmenu", e => this.menu(e));
    this.redimensionner();
  },

  redimensionner() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const t = Math.max(120, Math.min(r.width, r.height));
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = this.canvas.style.height = t + "px";
    this.canvas.width = this.canvas.height = Math.round(t * dpr);
    this.taille = t; this.dpr = dpr;
  },

  /* coordonnees champ [-1,1] (y = +1 en haut, "loin") <-> pixels */
  versPx(x, y) { const t = this.taille; return [(x + 1) / 2 * t, (1 - y) / 2 * t]; },
  depuisPx(px, py) { const t = this.taille; return [borne(px / t * 2 - 1, -1, 1), borne(1 - py / t * 2, -1, 1)]; },
  point(e) { const r = this.canvas.getBoundingClientRect(); return this.depuisPx(e.clientX - r.left, e.clientY - r.top); },

  positionLissee(id) { return this.lisse.get(id); },
  auditeurLisse() { return this.aud; },
  vitesseRelative(id) {
    const p = this.lisse.get(id); if (!p) return 0;
    return Math.hypot(p.vx - this.aud.vx, p.vy - this.aud.vy);
  },

  objetSous(x, y) {
    const rayon = 22 / this.taille * 2;
    for (let i = etat.sources.length - 1; i >= 0; i--) {
      const s = etat.sources[i];
      if (Math.hypot(s.x - x, s.y - y) < rayon) return s.id;
    }
    if (Math.hypot(etat.auditeur.x - x, etat.auditeur.y - y) < rayon) return "aud";
    return null;
  },

  appui(e) {
    if (e.button !== 0) return;
    audio.demarrer();
    const [x, y] = this.point(e);
    const id = this.objetSous(x, y);
    if (!id) { if (!e.ctrlKey && !e.metaKey) { this.selection.clear(); interfaceUI.majSelection(); } return; }
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    if (id !== "aud") {
      if (e.ctrlKey || e.metaKey) {
        if (this.selection.has(id)) this.selection.delete(id); else this.selection.add(id);
        interfaceUI.majSelection();
        if (!this.selection.has(id)) return;
      } else if (!this.selection.has(id)) { this.selection.clear(); this.selection.add(id); }
      this.focus = id;
      interfaceUI.majSelection();
    }
    const groupe = id === "aud" ? ["aud"] : [...this.selection];
    const depart = groupe.map(g => g === "aud" ? { id: g, x: etat.auditeur.x, y: etat.auditeur.y } : { id: g, x: this.src(g).x, y: this.src(g).y });
    this.saisie = { id, groupe: depart, x0: x, y0: y, pid: e.pointerId, joue: [] };
    // glisser pour jouer : l'auditeur fait jouer toutes les sources, une source se joue elle-meme
    const aJouer = id === "aud" ? etat.sources.map(s => s.id) : groupe;
    aJouer.forEach(i => moteur.tenir(i));
    this.saisie.joue = aJouer;
    historique.debutGeste();
  },

  bouger(e) {
    const s = this.saisie;
    if (!s || e.pointerId !== s.pid) {
      const [x, y] = this.point(e);
      this.canvas.style.cursor = this.objetSous(x, y) ? "grab" : "default";
      return;
    }
    const [x, y] = this.point(e);
    const dx = x - s.x0, dy = y - s.y0;
    s.groupe.forEach(o => {
      const nx = borne(o.x + dx, -1, 1), ny = borne(o.y + dy, -1, 1);
      if (o.id === "aud") { etat.auditeur.x = nx; etat.auditeur.y = ny; }
      else { const src = this.src(o.id); src.x = +nx.toFixed(4); src.y = +ny.toFixed(4); }
    });
    this.dernierBouge = s.id;
    this.canvas.style.cursor = "grabbing";
    interfaceUI.majPositions();
  },

  relache(e) {
    const s = this.saisie;
    if (!s || e.pointerId !== s.pid) return;
    s.joue.forEach(i => moteur.lacher(i));
    this.saisie = null;
    this.canvas.style.cursor = "default";
    historique.finGeste("Déplacement");
  },

  menu(e) {
    e.preventDefault();
    const [x, y] = this.point(e);
    const id = this.objetSous(x, y);
    if (!id) return;
    const base = id === "aud" ? "a" : "s:" + id;
    const nom = id === "aud" ? "l'auditeur" : "la source " + (etat.sources.findIndex(s => s.id === id) + 1);
    menuContextuel(e.clientX, e.clientY, [
      { titre: "MIDI — " + nom },
      { texte: "Apprendre un CC pour X", action: () => midi.apprendre(base + ":x") },
      { texte: "Apprendre un CC pour Y", action: () => midi.apprendre(base + ":y") },
      { texte: "Oublier les CC", action: () => { midi.oublier(base + ":x"); midi.oublier(base + ":y"); } },
    ]);
  },

  src(id) { return etat.sources.find(s => s.id === id); },

  centrer() {
    historique.noter("Centrer");
    etat.auditeur.x = 0; etat.auditeur.y = 0;
  },

  /* lissage des positions et calcul des vitesses (unites de champ / s) */
  tick(dt) {
    const k = mod.val("c:lissageMouv", etat.champ.lissageMouv) / 100;
    const tau = 0.002 + k * k * 0.6;
    const a = 1 - Math.exp(-dt / tau);
    const suivre = (p, cible) => {
      const nx = p.x + (cible.x - p.x) * a, ny = p.y + (cible.y - p.y) * a;
      const vx = (nx - p.x) / dt, vy = (ny - p.y) / dt;
      p.vx += (vx - p.vx) * Math.min(1, dt * 15); p.vy += (vy - p.vy) * Math.min(1, dt * 15);
      p.x = nx; p.y = ny;
    };
    const ids = new Set();
    etat.sources.forEach(s => {
      ids.add(s.id);
      let p = this.lisse.get(s.id);
      if (!p) { p = { x: s.x, y: s.y, vx: 0, vy: 0 }; this.lisse.set(s.id, p); }
      suivre(p, s);
    });
    [...this.lisse.keys()].forEach(id => ids.has(id) || this.lisse.delete(id));
    suivre(this.aud, etat.auditeur);
    const o = this.dernierBouge === "aud" ? this.aud : this.lisse.get(this.dernierBouge);
    this.vitesseGlisse = o ? Math.hypot(o.vx, o.vy) : 0;
  },

  dessiner() {
    const g = this.g, t = this.taille, dpr = this.dpr;
    if (!t) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, t, t);
    const css = getComputedStyle(document.documentElement);
    const ligne = css.getPropertyValue("--ligne").trim(), accent = css.getPropertyValue("--accent").trim();
    const texte = css.getPropertyValue("--texte-doux").trim();
    // grille
    g.strokeStyle = ligne; g.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      const p = Math.round(i * t / 10) + 0.5;
      g.globalAlpha = i === 5 ? 0.9 : 0.35;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, t); g.moveTo(0, p); g.lineTo(t, p); g.stroke();
    }
    g.globalAlpha = 1;
    // portee audible autour de l'auditeur
    const [ax, ay] = this.versPx(this.aud.x, this.aud.y);
    const portee = mod.val("c:portee", etat.champ.portee) / 100 * 1.6 * t / 2;
    if (etat.champ.distance) {
      const grad = g.createRadialGradient(ax, ay, 0, ax, ay, portee);
      grad.addColorStop(0, "rgba(63,217,176,0.10)"); grad.addColorStop(1, "rgba(63,217,176,0)");
      g.fillStyle = grad; g.beginPath(); g.arc(ax, ay, portee, 0, 7); g.fill();
      g.strokeStyle = ligne; g.setLineDash([3, 5]);
      [0.5, 1].forEach(f => { g.beginPath(); g.arc(ax, ay, portee * f, 0, 7); g.stroke(); });
      g.setLineDash([]);
    }
    // sources
    g.font = "11px var(--police), system-ui, sans-serif"; g.textAlign = "center";
    etat.sources.forEach((s, i) => {
      const p = this.lisse.get(s.id) || s;
      const [x, y] = this.versPx(p.x, p.y);
      const m = moteur.sources.get(s.id);
      const joue = m && m.actif, sel = this.selection.has(s.id);
      g.strokeStyle = s.couleur; g.globalAlpha = 0.25; g.setLineDash([2, 4]);
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(x, y); g.stroke(); g.setLineDash([]);
      g.globalAlpha = s.mute ? 0.35 : 1;
      if (joue) {
        const pulse = 18 + 6 * (0.5 + 0.5 * Math.sin(performance.now() / 160));
        g.fillStyle = s.couleur; g.globalAlpha *= 0.22;
        g.beginPath(); g.arc(x, y, pulse + 6, 0, 7); g.fill();
        g.globalAlpha = s.mute ? 0.35 : 1;
      }
      g.fillStyle = "rgba(10,14,17,0.92)"; g.strokeStyle = s.couleur; g.lineWidth = sel ? 3 : 2;
      g.beginPath(); g.arc(x, y, 17, 0, 7); g.fill(); g.stroke();
      g.fillStyle = s.couleur; g.font = "bold 12px system-ui, sans-serif";
      g.fillText(String(i + 1), x, y + 4);
      g.fillStyle = texte; g.font = "10px system-ui, sans-serif";
      g.fillText(s.nom.length > 18 ? s.nom.slice(0, 17) + "…" : s.nom, x, y + 32);
      g.globalAlpha = 1; g.lineWidth = 1;
    });
    // auditeur
    g.strokeStyle = "#e9f1f0"; g.fillStyle = "rgba(10,14,17,0.9)"; g.lineWidth = 1.5;
    g.beginPath(); g.arc(ax, ay, 18, 0, 7); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(ax - 24, ay); g.lineTo(ax + 24, ay); g.moveTo(ax, ay - 24); g.lineTo(ax, ay + 24);
    g.globalAlpha = 0.5; g.stroke(); g.globalAlpha = 1;
    g.fillStyle = "#ffffff"; g.beginPath(); g.arc(ax, ay, 6, 0, 7); g.fill();
    g.fillStyle = accent; g.beginPath(); g.moveTo(ax, ay - 30); g.lineTo(ax - 5, ay - 22); g.lineTo(ax + 5, ay - 22); g.fill();
    g.fillStyle = "#e9f1f0"; g.font = "bold 10px system-ui, sans-serif";
    g.fillText("AUDITEUR", ax, ay + 36);
  },
};
