/* Demarrage : etat, barre du haut, boucle d'animation, raccourcis. */
"use strict";

let etat = etatInitial();

const app = {
  dernier: performance.now(),

  init() {
    chargerReglagesAudio();
    midi.charger();
    champ.init();
    interfaceUI.rendre();
    this.brancherBarre();
    fichiers.zoneDepot($("#col-gauche"));
    fichiers.zoneDepot($("#zone-champ"));
    document.addEventListener("keydown", e => this.clavier(e));
    // le navigateur n'autorise le son qu'apres un geste de l'utilisateur
    const deverrouiller = () => audio.demarrer();
    document.addEventListener("pointerdown", deverrouiller, { once: true });
    bus.on("lecture", () => interfaceUI.majLecture());
    bus.on("enregistrement", () => this.majBarre());
    bus.on("historique", () => this.majBarre());
    bus.on("sortie-changee", () => this.majSortie());
    bus.on("audio-pret", () => { this.majSortie(); $("#etat-son").hidden = true; });
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", () => this.majSortie());
    }
    this.majBarre();
    this.majSortie();
    requestAnimationFrame(() => this.image());
    setInterval(() => { if (document.hidden) this.pas(); }, 40);
  },

  brancherBarre() {
    const clic = (sel, f) => $(sel).addEventListener("click", f);
    clic("#btn-annuler", () => historique.annuler());
    clic("#btn-retablir", () => historique.retablir());
    clic("#btn-stop", () => { moteur.toutArreter(); if (enregistreur.actif) enregistreur.arreter(); });
    clic("#btn-jouer", async () => {
      await audio.demarrer();
      if (moteur.unActif()) moteur.toutArreter(); else moteur.jouerTout();
    });
    clic("#btn-rec", () => enregistreur.actif ? enregistreur.arreter() : dialogueEnregistrement());
    clic("#btn-export", () => enregistreur.exporter());
    clic("#btn-sortie", () => dialogueSortie());
    clic("#btn-sortie-2", () => dialogueSortie());
    clic("#btn-midi", () => dialogueMidi());
    clic("#btn-plein", () => this.pleinEcran());
    clic("#btn-aide", () => dialogueAide());
    clic("#btn-ajouter", () => fichiers.choisir(f => fichiers.ajouter(f)));
    clic("#btn-ajouter-2", () => fichiers.choisir(f => fichiers.ajouter(f)));
    clic("#btn-centrer", () => champ.centrer());
    clic("#btn-sauver", () => presets.ouvrirSauvegarde());
    clic("#btn-charger", () => presets.ouvrir());
    clic("#btn-reset-master", () => {
      historique.noter("Réinitialiser le master");
      etat.master = etatInitial().master;
      for (const c in etat.liens) if (c.startsWith("m:")) delete etat.liens[c];
      audio.appliquerMaster();
      interfaceUI.rendre();
    });
  },

  pleinEcran() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => notifier("Plein écran refusé par le navigateur."));
  },

  clavier(e) {
    const t = e.target;
    if (t.matches("input[type=text], input[type=number], input[type=search], textarea, select")) return;
    const cmd = e.ctrlKey || e.metaKey;
    if (cmd && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? historique.retablir() : historique.annuler(); return; }
    if (cmd && e.key.toLowerCase() === "y") { e.preventDefault(); historique.retablir(); return; }
    if (cmd) return;
    if (e.code === "Space") {
      e.preventDefault();
      const id = champ.focus || (etat.sources[0] && etat.sources[0].id);
      if (id) audio.demarrer().then(() => moteur.basculer(id));
    } else if (e.key === "Escape") {
      if ($("#dialogue")) fermerDialogue(); else moteur.toutArreter();
    } else if (e.key.toLowerCase() === "r" && !$("#dialogue")) {
      enregistreur.actif ? enregistreur.arreter() : dialogueEnregistrement();
    } else if (e.key.toLowerCase() === "f" && !$("#dialogue")) {
      this.pleinEcran();
    }
  },

  majBarre() {
    $("#btn-annuler").disabled = !historique.pile.length;
    $("#btn-retablir").disabled = !historique.refaire.length;
    $("#btn-rec").classList.toggle("actif", enregistreur.actif);
    $("#btn-rec").lastChild.textContent = enregistreur.actif ? "STOP REC" : "ENREGISTRER";
    $("#btn-export").disabled = !enregistreur.resultat;
  },

  async majSortie() {
    const el = $("#sortie-nom");
    if (!audio.ctx) { el.textContent = "Sortie par défaut · clique pour choisir"; return; }
    let nom = "Sortie par défaut";
    if (audio.sortie.deviceId && audio.sortie.deviceId !== "default") {
      const l = await audio.listerSorties();
      const d = l.find(x => x.deviceId === audio.sortie.deviceId);
      nom = d && d.label ? d.label : "Périphérique choisi";
    }
    const paires = audio.sortie.pairesActives || 1;
    el.textContent = nom + " · " + (audio.sortie.mode === "multi" ? (paires * 2) + " canaux" : "stéréo") + " · " + audio.ctx.sampleRate / 1000 + " kHz";
  },

  /* une etape de calcul (aussi appelee quand l'onglet est cache) */
  pas() {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0.001, (now - this.dernier) / 1000));
    this.dernier = now;
    champ.tick(dt);
    mod.tick(dt);
    moteur.tick(dt);
    midi.tick();
    return dt;
  },

  image() {
    this.pas();
    champ.dessiner();
    this.majAffichage();
    requestAnimationFrame(() => this.image());
  },

  majAffichage() {
    const t = enregistreur.actif ? enregistreur.duree() : moteur.tempsLecture;
    $("#temps").textContent = formaterTemps(t);
    $("#temps").classList.toggle("rec", enregistreur.actif);
    const actif = moteur.unActif();
    const bj = $("#btn-jouer");
    bj.classList.toggle("actif", actif);
    bj.lastChild.textContent = actif ? "EN LECTURE" : "TOUT JOUER";
    $("#lecture-vitesse").textContent = champ.vitesseGlisse.toFixed(2);
    const id = champ.focus || champ.dernierBouge;
    const m = id && id !== "aud" ? moteur.sources.get(id) : null;
    $("#lecture-doppler").textContent = (m ? m.doppler : 1).toFixed(2) + "×";
    const c = mod.connecteurs;
    const v = $("#val-vitesse"), xy = $("#val-xy");
    if (v) v.textContent = Math.round(c.vitesse * 100) + "%";
    if (xy) xy.textContent = "X " + Math.round(c.x * 100) + "% · Y " + Math.round(c.y * 100) + "%";
    $("#midi-led").classList.toggle("on", performance.now() - midi.activite < 120);
    this.vumetres();
  },

  vumetres() {
    const c = $("#vumetre"), g = c.getContext("2d");
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const [l, r] = audio.cretes();
    [l, r].forEach((db, i) => {
      const y = i * (H / 2) + 2, hh = H / 2 - 4;
      g.fillStyle = "rgba(255,255,255,0.06)"; g.fillRect(0, y, W, hh);
      const n = borne((db + 60) / 60, 0, 1);
      const grad = g.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, "#3fd9b0"); grad.addColorStop(0.75, "#3fd9b0"); grad.addColorStop(0.9, "#f5a524"); grad.addColorStop(1, "#ff4d5e");
      g.fillStyle = grad; g.fillRect(0, y, n * W, hh);
    });
    g.fillStyle = "rgba(0,0,0,0.5)";
    [-36, -24, -12, -6].forEach(db => g.fillRect((db + 60) / 60 * W, 0, 1, H));
  },
};

document.addEventListener("DOMContentLoaded", () => app.init());
