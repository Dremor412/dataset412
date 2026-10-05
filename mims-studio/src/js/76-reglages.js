"use strict";
/* ------------------------------------------------------------------ *
 *  Reglages : legende des parametres (role de chaque curseur),        *
 *  marge de stabilite, et secours quand le modele explose.            *
 * ------------------------------------------------------------------ */

const LEGENDE = {
  note: ["note", "hauteur de la corde en Hz : plus bas = corde virtuellement plus longue (sans ajouter de masses)"],
  M: ["masse", "inertie d'un point : plus lourd = plus grave et plus lent"],
  K: ["raideur", "force de rappel d'un ressort : plus raide = plus aigu (fréquence ≈ √(K/M))"],
  Z: ["amortissement", "frottement interne d'une liaison : plus grand = son plus court et plus mat"],
  Zo: ["frein au repos", "frottement de chaque masse vers sa position de repos (« l'air ») : fait décroître tout le son"],
  K2: ["flexion", "raideur de flexion d'une corde raide : harmoniques étirées, son plus métallique"],
  Knl: ["force du pincement", "raideur du pincement : plus grand = attaque plus franche"],
  Pscale: ["échelle du pincement", "distance à franchir avant que la corde ne « décroche »"],
  Znl: ["pression d'archet", "force de frottement de l'archet"],
  Vscale: ["vitesse d'accroche", "vitesse de glissement où l'archet accroche le plus : petit = archet plus « collant »"],
  KnlP: ["raideur quadratique", "partie non linéaire (au carré) du ressort"],
  KnlQ: ["raideur cubique", "partie non linéaire (au cube) : le son change avec la force de frappe"],
  Klim: ["raideur maximale", "borne la raideur non linéaire (évite les explosions)"],
  thresh: ["seuil", "écart avant le contact : 0 = au contact, négatif = il y a de l'espace"],
  gravity: ["gravité", "force constante vers le bas"],
  smooth: ["archet lisse", "1 = courbe d'archet lisse, 0 = anguleuse"],
  nbMass: ["nombre de masses", "plus de masses = plus d'harmoniques, mais plus de calcul"],
  nbX: ["masses en x", "taille de la membrane"], nbY: ["masses en y", "taille de la membrane"],
  position: ["position", "point visé sur une corde ou une membrane : 0 = un bout, 1 = l'autre"],
};
const ORDRE_LEGENDE = ["note", "M", "K", "Z", "Zo", "K2", "Knl", "Pscale", "Znl", "Vscale", "thresh", "position", "nbMass"];

app._construitReglagesBase = app._construitReglages;

Object.assign(app, {

  /* role(s) de chaque param, d'apres l'endroit ou il sert dans le script */
  _rolesParams() {
    const mdl = this.modele, roles = new Map();
    const note = (token, role, ou) => {
      if (!token) return;
      for (const n of String(token).match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) {
        if (!mdl.params.has(n)) continue;
        if (/_hz$/.test(n) && role === "K") role = "note";      // corde accordee : la note donne K
        if (!roles.has(n)) roles.set(n, []);
        const r = roles.get(n);
        if (!r.some(x => x.role === role && x.ou === ou)) r.push({ role, ou });
      }
    };
    const args = (genre, liste, ou) => {
      const noms = [...ARGS[genre][0], ...ARGS[genre][1]];
      liste.forEach((t, k) => note(t, noms[k], ou));
    };
    for (const m of mdl.masses.values()) if (ARGS[m.genre]) args(m.genre, m.args, "@" + m.nom);
    for (const mc of mdl.macros.values()) args(mc.genre, mc.args, "@" + mc.nom);
    for (const it of mdl.interactions) {
      args(it.genre, it.args, `${it.genre} @${it.nom}`);
      // une position sur une structure appartient a l'interaction qui l'utilise
      for (const r of [it.m1, it.m2]) if (r.macro !== undefined) { note(r.a, "position", `${it.genre} @${it.nom}`); note(r.b, "position", `${it.genre} @${it.nom}`); }
    }
    for (const s of [...mdl.sorties, ...mdl.entrees])
      if (s.cible.macro !== undefined) { note(s.cible.a, "position", `@${s.nom}`); note(s.cible.b, "position", `@${s.nom}`); }
    return roles;
  },

  _construitReglages() {
    this._construitReglagesBase();
    const roles = this._rolesParams();
    // role sous chaque curseur
    document.querySelectorAll("#liste-reglages .reglage").forEach(row => {
      const nom = row.querySelector("label").textContent, r = roles.get(nom);
      if (!r) return;
      const div = document.createElement("div");
      div.className = "role";
      const parRole = new Map();
      for (const x of r) { if (!parRole.has(x.role)) parRole.set(x.role, []); parRole.get(x.role).push(x.ou); }
      div.textContent = [...parRole].map(([role, ou]) =>
        `${role} — ${(LEGENDE[role] || [role])[0]} · ${ou.slice(0, 3).join(", ")}${ou.length > 3 ? "…" : ""}`).join(" ; ");
      row.querySelector("label").title = [...parRole.keys()].map(k => LEGENDE[k] ? `${k} : ${LEGENDE[k][1]}` : k).join("\n");
      row.appendChild(div);
    });
    // legende : les roles presents dans ce modele d'abord
    const presents = new Set([...roles.values()].flat().map(x => x.role));
    const dl = $("liste-legende");
    dl.innerHTML = "";
    for (const k of [...ORDRE_LEGENDE.filter(k => presents.has(k)), ...ORDRE_LEGENDE.filter(k => !presents.has(k))]) {
      const dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = k; dd.textContent = `${LEGENDE[k][0]} : ${LEGENDE[k][1]}`;
      if (!presents.has(k)) { dt.style.opacity = dd.style.opacity = 0.5; }
      dl.append(dt, dd);
    }
    this._majStabilite();
  },

  /* ---------------- stabilite ---------------- */

  _majStabilite() {
    if (!this.modele) return;
    let m;
    try { m = margeStabilite(compiler(this.modele, { reglages: this.reglagesAudio })); } catch (e) { return; }
    const el = $("stabilite");
    const pc = Math.round(m.rapport * 100);
    el.classList.toggle("alerte", m.rapport >= 1);
    el.textContent = m.rapport >= 1
      ? `⚠ Instable (${pc} %) : avec ces réglages le calcul va exploser. Baisse une raideur K ou augmente une masse M. 🛟 Secours revient aux derniers réglages stables.`
      : `Stabilité du calcul : ${pc} % de la limite${m.rapport > 0.8 ? " — attention, proche de la limite" : ""}.`;
    this._instable = m.rapport >= 1;
  },

  /* ---------------- secours ---------------- */

  _brancheSecours() {
    $("btn-secours").addEventListener("click", () => this.secours(false));
  },

  _valeursParams() {
    const v = new Map();
    for (const [n, p] of this.modele.params) v.set(n, p.genre === "param" ? p.valeur : (this.reglagesAudio.get(n) ?? 0.5));
    return v;
  },

  /* appele quand le calcul tourne sans probleme : memorise des reglages "surs" */
  _noteStable() {
    if (!this.modele || this._instable) return;
    if (performance.now() - (this._dernierChangement || 0) < 1500) return;
    this._stables = this._valeursParams();
  },

  /* le modele a explose (auto) ou on clique Secours : retour aux derniers
   * reglages stables, puis remise au repos */
  secours(auto) {
    if (!this.modele) return;
    const actuels = this._valeursParams(), sur = this._stables;
    const changes = [];
    if (sur) for (const [n, v] of sur) if (this.modele.params.has(n) && actuels.get(n) !== v) changes.push([n, v]);
    for (const [n, v] of changes) {
      const p = this.modele.params.get(n);
      if (p.genre === "audioParam") { this.reglagesAudio.set(n, v); continue; }
      p.brut = String(v); p.valeur = v;
      $("editeur").value = $("editeur").value.replace(new RegExp(`^(\\s*@${n}\\s+param\\s+)(\\S+)`, "m"), `$1${v}`);
    }
    this.desc = compiler(this.modele, { reglages: this.reglagesAudio });
    this.vue.charger(this.desc, true);
    if (son.actif) { this._envoieModeleSon(false); son.envoyer({ type: "reset" }); }
    if (this.anime) this.sim = new Simulateur(this.desc);
    this._appliqueArchet();
    this._construitReglages();
    this._dernierChangement = performance.now();
    this.statut(changes.length
      ? `${auto ? "💥 Le modèle a explosé : " : ""}retour aux derniers réglages stables (${changes.map(([n, v]) => `${n} = ${v}`).join(", ")})`
      : auto ? "💥 Le modèle a explosé et a été remis au repos. Baisse une raideur K, monte une masse M ou un amortissement Z."
             : "modèle remis au repos");
  },
});
