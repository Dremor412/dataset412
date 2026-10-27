/* Projet : annuler / refaire, chargement des fichiers audio, presets. */
"use strict";

const historique = {
  pile: [], refaire: [], geste: null,
  instantane() { return JSON.stringify(etat); },
  pousser(avant) {
    this.pile.push(avant);
    if (this.pile.length > 200) this.pile.shift();
    this.refaire = [];
    bus.emettre("historique");
  },
  noter() { this.geste = null; this.pousser(this.instantane()); },
  debutGeste() { if (!this.geste) this.geste = this.instantane(); },
  finGeste() {
    if (this.geste && this.geste !== this.instantane()) this.pousser(this.geste);
    this.geste = null;
  },
  annuler() {
    if (!this.pile.length) return;
    this.refaire.push(this.instantane());
    this.restaurer(this.pile.pop());
  },
  retablir() {
    if (!this.refaire.length) return;
    this.pile.push(this.instantane());
    this.restaurer(this.refaire.pop());
  },
  restaurer(json) {
    etat = JSON.parse(json);
    moteur.synchroniser();
    audio.router();
    interfaceUI.rendre();
    bus.emettre("historique");
  },
};

const fichiers = {
  choisir(cb, multiple = true) {
    const e = h("input", { type: "file", accept: "audio/*,.wav,.mp3,.ogg,.flac,.aif,.aiff,.m4a", multiple });
    e.addEventListener("change", () => { if (e.files.length) cb([...e.files]); });
    e.click();
  },

  async lire(f) {
    const octets = await f.arrayBuffer();
    return decoderAudio(octets);
  },

  async ajouter(liste) {
    const place = MAX_SOURCES - etat.sources.length;
    if (place <= 0) { notifier("Maximum " + MAX_SOURCES + " sources."); return; }
    liste = liste.filter(f => /^audio\//.test(f.type) || /\.(wav|mp3|ogg|flac|aiff?|m4a|opus|webm)$/i.test(f.name));
    if (liste.length > place) notifier("Seulement " + place + " fichier(s) ajouté(s) : maximum " + MAX_SOURCES + " sources.");
    const avant = historique.instantane();
    let ajoutes = 0;
    for (const f of liste.slice(0, place)) {
      try {
        const t = await this.lire(f);
        const s = nouvelleSource(f.name, etat.sources.length);
        s.duree = t.buf.duration;
        if (etat.sources.length) s.ouvert = false;
        tampons.set(s.id, t);
        etat.sources.push(s);
        ajoutes++;
      } catch (e) {
        notifier("Impossible de lire « " + f.name + " » (format non pris en charge ?)", 4000);
      }
    }
    if (!ajoutes) return;
    historique.pousser(avant);
    moteur.synchroniser();
    interfaceUI.rendre();
  },

  async remplacer(id, f) {
    try {
      const t = await this.lire(f);
      const s = etat.sources.find(x => x.id === id);
      historique.noter("Remplacer l'audio");
      tampons.set(id, t);
      s.nom = f.name; s.duree = t.buf.duration; s.region = [0, 1]; s.depart = 0;
      moteur.relacher(id, true);
      interfaceUI.rendrePistes();
    } catch (e) { notifier("Impossible de lire « " + f.name + " ».", 4000); }
  },

  /* glisser-deposer de fichiers sur une zone */
  zoneDepot(el) {
    el.addEventListener("dragover", e => {
      if (![...e.dataTransfer.types].includes("Files")) return;
      e.preventDefault(); el.classList.add("survol");
    });
    el.addEventListener("dragleave", e => { if (!el.contains(e.relatedTarget)) el.classList.remove("survol"); });
    el.addEventListener("drop", e => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault(); el.classList.remove("survol");
      this.ajouter([...e.dataTransfer.files]);
    });
  },
};

const presets = {
  ouvrirSauvegarde() {
    const nom = h("input", { type: "text", value: "mon-mouvement", "aria-label": "Nom du preset" });
    const avecAudio = h("input", { type: "checkbox", checked: true });
    dialogue("Enregistrer un preset", [
      h("label.ligne-form", h("span", "Nom"), nom),
      h("label.ligne-coche", avecAudio, h("span", "Inclure les fichiers audio (le preset se rouvre tel quel, mais pèse plus lourd)")),
      h("p.aide", "Le preset est téléchargé sur ton ordinateur. Rien n'est envoyé sur internet."),
    ], [{ texte: "Télécharger le preset", principal: true, action: () => this.sauver(nom.value || "preset", avecAudio.checked) }]);
  },

  sauver(nom, avecAudio) {
    const donnees = { format: "motion-designer-local", version: 1, etat: copie(etat), audio: {} };
    if (avecAudio) etat.sources.forEach(s => {
      const t = tampons.get(s.id);
      if (t) donnees.audio[s.id] = enBase64(t.octets);
    });
    telecharger(nom.replace(/[^\w\- ]+/g, "_") + ".motion.json", JSON.stringify(donnees), "application/json");
  },

  ouvrir() {
    const e = h("input", { type: "file", accept: ".json,application/json" });
    e.addEventListener("change", () => e.files[0] && this.charger(e.files[0]));
    e.click();
  },

  async charger(f) {
    try {
      const d = JSON.parse(await f.text());
      if (d.format !== "motion-designer-local" || !d.etat) throw new Error("ce n'est pas un preset Motion Designer");
      for (const id in d.audio || {}) tampons.set(id, await decoderAudio(depuisBase64(d.audio[id])));
      historique.noter("Charger un preset");
      moteur.toutArreter(true);
      etat = Object.assign(etatInitial(), d.etat);
      moteur.synchroniser();
      audio.router();
      interfaceUI.rendre();
      const manquants = etat.sources.filter(s => !tampons.has(s.id)).length;
      notifier(manquants ? `Preset chargé — ${manquants} piste(s) sans audio : utilise ⤓ pour leur redonner un fichier.` : "Preset chargé.", 4500);
    } catch (e) {
      notifier("Preset illisible : " + e.message, 4000);
    }
  },
};
