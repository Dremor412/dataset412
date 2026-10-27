/* Fenetres : sortie audio, MIDI / DAW, enregistrement, aide. */
"use strict";

function dialogue(titre, contenu, boutons = [], options = {}) {
  fermerDialogue();
  const fond = h("div.fond-dialogue#dialogue", { onpointerdown: e => { if (e.target === fond) fermerDialogue(); } },
    h("div.dialogue" + (options.large ? ".large" : ""), { role: "dialog", "aria-label": titre },
      h("div.dialogue-tete", h("h2", titre), h("button.mini", { "aria-label": "Fermer", title: "Fermer", onclick: fermerDialogue }, "×")),
      h("div.dialogue-corps", contenu),
      boutons.length ? h("div.dialogue-pied", boutons.map(b => h("button.btn" + (b.principal ? ".principal" : ""), {
        onclick: async () => { const garder = await b.action(); if (!garder) fermerDialogue(); },
      }, b.texte))) : null));
  document.body.append(fond);
  return fond;
}
function fermerDialogue() { const d = $("#dialogue"); if (d) d.remove(); }

const NOMS_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const nomNote = n => NOMS_NOTES[n % 12] + (Math.floor(n / 12) - 2);   // convention Ableton / Cubase : 60 = C3

/* ---------- Sortie audio ---------- */
async function dialogueSortie() {
  await audio.demarrer();
  const ctx = audio.ctx;
  const peutChoisir = typeof ctx.setSinkId === "function" || typeof HTMLMediaElement.prototype.setSinkId === "function";
  const corps = h("div");
  const remplir = async () => {
    const sorties = await audio.listerSorties();
    const sansNoms = sorties.length && sorties.every(d => !d.label);
    const sel = h("select", { "aria-label": "Périphérique de sortie" },
      h("option", { value: "default" }, "Sortie par défaut du système"),
      sorties.filter(d => d.deviceId !== "default" && d.deviceId !== "").map((d, i) =>
        h("option", { value: d.deviceId, selected: d.deviceId === audio.sortie.deviceId }, d.label || "Sortie " + (i + 1))));
    sel.addEventListener("change", async () => {
      if (await audio.choisirSortie(sel.value)) { sauverReglagesAudio(); notifier("Sortie : " + sel.selectedOptions[0].textContent); remplir(); }
    });
    const max = audio.destination().maxChannelCount || 2;
    const mode = h("select", { "aria-label": "Mode de sortie" },
      h("option", { value: "stereo", selected: audio.sortie.mode === "stereo" }, "Stéréo — le mix sur les canaux 1-2"),
      h("option", { value: "multi", selected: audio.sortie.mode === "multi", disabled: max < 4 }, "Multipiste — mix 1-2, puis une paire par source"));
    mode.addEventListener("change", () => { audio.sortie.mode = mode.value; audio.router(); sauverReglagesAudio(); remplir(); });
    const lat = h("select", { "aria-label": "Latence" }, [["interactive", "Faible (jeu en direct)"], ["balanced", "Équilibrée"], ["playback", "Confort (moins de craquements)"]]
      .map(([v, t]) => h("option", { value: v, selected: audio.options.latence === v }, t)));
    const freq = h("select", { "aria-label": "Fréquence d'échantillonnage" }, [[0, "Celle du système"], [44100, "44,1 kHz"], [48000, "48 kHz"], [88200, "88,2 kHz"], [96000, "96 kHz"]]
      .map(([v, t]) => h("option", { value: v, selected: audio.options.frequence === v }, t)));
    const appliquer = h("button.btn", { onclick: async () => {
      audio.options.latence = lat.value; audio.options.frequence = +freq.value;
      sauverReglagesAudio();
      await audio.reconstruire(); notifier("Son redémarré : " + audio.ctx.sampleRate + " Hz"); remplir();
    } }, "Appliquer (redémarre le son)");

    const paires = [h("li", h("b", "1-2"), " mix général (avec les effets master)")];
    if (audio.sortie.mode === "multi") etat.sources.forEach((s, i) => {
      if (i + 1 < (audio.sortie.pairesActives || 1)) paires.push(h("li", h("b", (i * 2 + 3) + "-" + (i * 2 + 4)), " ", (i + 1) + ". " + s.nom, " (spatialisée, sans effets master)"));
    });
    const debordent = audio.sortie.mode === "multi" ? Math.max(0, etat.sources.length - ((audio.sortie.pairesActives || 1) - 1)) : 0;

    corps.replaceChildren(...[
      peutChoisir ? null : h("p.alerte", "Ce navigateur ne permet pas de choisir la sortie : le son part sur la sortie par défaut du système. Utilise Chrome ou Edge, ou change la sortie par défaut dans les réglages du système."),
      h("label.ligne-form", h("span", "Périphérique"), sel),
      sansNoms ? h("p.aide", "Les noms sont masqués par le navigateur tant qu'il n'a pas eu d'autorisation. ",
        h("button.lien", { onclick: async () => { if (await audio.autoriserNoms()) remplir(); else notifier("Autorisation refusée."); } }, "Afficher les noms"),
        " (le navigateur demande l'accès au micro ; rien n'est enregistré).") : null,
      h("label.ligne-form", h("span", "Mode"), mode),
      h("p.aide", `Ce périphérique accepte ${max} ${max > 1 ? "canaux" : "canal"} de sortie. `,
        max < 4 ? "Le mode multipiste demande une sortie d'au moins 4 canaux (BlackHole 16ch, carte son multicanal, Loopback…)." : ""),
      h("ul.liste-canaux", paires),
      debordent ? h("p.alerte", debordent + " source(s) n'ont pas de paire libre : elles restent seulement dans le mix 1-2.") : null,
      h("h3", "Moteur audio"),
      h("label.ligne-form", h("span", "Latence"), lat),
      h("label.ligne-form", h("span", "Fréquence"), freq),
      h("p.aide", "En cours : " + ctx.sampleRate + " Hz, latence de sortie ≈ " + Math.round(((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000) + " ms."),
      appliquer,
      h("h3", "Envoyer le son dans un DAW"),
      h("ol.guide",
        h("li", "Installe un câble audio virtuel : ", h("b", "BlackHole"), " (macOS, gratuit), ", h("b", "VB-Audio Cable / VoiceMeeter"), " (Windows), ", h("b", "PipeWire / JACK"), " (Linux)."),
        h("li", "Choisis ce câble comme périphérique ci-dessus (en multipiste, prends une version à 16 canaux)."),
        h("li", "Dans le DAW (Ableton, Logic, Reaper, FL, Cubase…), prends ce câble comme entrée audio ; arme une piste sur 1-2, ou une piste par paire en multipiste."),
        h("li", "Pour garder l'écoute, sors le DAW sur ta carte son (ou crée un « périphérique à sorties multiples » sur macOS)."))].filter(Boolean));
  };
  dialogue("Sortie audio", corps, [], { large: true });
  await remplir();
}

function sauverReglagesAudio() {
  try { localStorage.setItem("md-audio", JSON.stringify({ sortie: { deviceId: audio.sortie.deviceId, mode: audio.sortie.mode }, options: audio.options })); } catch (e) { /* ignore */ }
}
function chargerReglagesAudio() {
  try {
    const r = JSON.parse(localStorage.getItem("md-audio") || "{}");
    if (r.sortie) Object.assign(audio.sortie, r.sortie);
    if (r.options) Object.assign(audio.options, r.options);
  } catch (e) { /* ignore */ }
}

/* ---------- MIDI / DAW ---------- */
async function dialogueMidi() {
  const ok = await midi.activer();
  const R = midi.reglages;
  const corps = h("div");
  const coche = (cle, texte) => {
    const c = h("input", { type: "checkbox", checked: R[cle] });
    c.addEventListener("change", () => { R[cle] = c.checked; midi.sauver(); midi.brancher(); remplir(); });
    return h("label.ligne-coche", c, h("span", texte));
  };
  const nombre = (cle, min, max, texte, apres) => {
    const n = h("input", { type: "number", min, max, value: R[cle], "aria-label": texte });
    n.addEventListener("change", () => { R[cle] = borne(+n.value | 0, min, max); midi.sauver(); remplir(); });
    return h("label.ligne-form", h("span", texte), h("span.avec-suffixe", n, apres ? h("small", apres) : null));
  };
  const remplir = () => {
    if (!ok) { corps.replaceChildren(h("p.alerte", midi.erreur), guideMidi()); return; }
    const ent = h("select", { "aria-label": "Entrée MIDI" }, h("option", { value: "toutes" }, "Toutes les entrées"),
      midi.entrees().map(p => h("option", { value: p.id, selected: R.entree === p.id }, p.name)));
    ent.addEventListener("change", () => { R.entree = ent.value; midi.sauver(); midi.brancher(); });
    const sor = h("select", { "aria-label": "Sortie MIDI" }, h("option", { value: "" }, "Aucune"),
      midi.sorties().map(p => h("option", { value: p.id, selected: R.sortie === p.id }, p.name)));
    sor.addEventListener("change", () => { R.sortie = sor.value; midi.derniersEnvois.clear(); midi.sauver(); });
    const n = etat.sources.length;
    const table = h("table.table-cc", h("tr", h("th", "Objet"), h("th", "X"), h("th", "Y")),
      etat.sources.map((s, i) => h("tr", h("td", (i + 1) + ". " + s.nom), h("td", "CC " + (R.ccBase + i * 2)), h("td", "CC " + (R.ccBase + i * 2 + 1)))),
      h("tr", h("td", "Auditeur"), h("td", "CC 102"), h("td", "CC 103")),
      h("tr", h("td", "Vitesse du dernier objet bougé"), h("td", { colspan: 2 }, "CC 104")));
    const appris = Object.keys(etat.midi);
    corps.replaceChildren(
      h("div.deux-colonnes",
        h("div",
          h("h3", "Recevoir (DAW ou contrôleur → ici)"),
          h("label.ligne-form", h("span", "Entrée"), ent),
          coche("recevoirNotes", "Les notes jouent les sources"),
          nombre("noteBase", 0, 127, "1re note", nomNote(R.noteBase) + " = source 1, " + nomNote(R.noteBase + 1) + " = source 2…"),
          coche("noteOffArrete", "Relâcher la note arrête la source (sinon une note = marche / arrêt)"),
          coche("transport", "Start / Stop du DAW lance et arrête toutes les sources"),
          coche("enregistrerAvecTransport", "Start / Stop du DAW lance et arrête aussi l'enregistrement"),
          h("p.aide", "Clic droit sur n'importe quel curseur, ou sur une source du champ → « Apprendre un CC »."),
          appris.length ? h("ul.liste-appris", appris.map(k => h("li", h("span", "Canal " + k.split(":")[0] + " · CC " + k.split(":")[1] + " → " + nomChemin(etat.midi[k])),
            h("button.mini", { "aria-label": "Oublier", title: "Oublier", onclick: () => { midi.oublier(etat.midi[k]); remplir(); } }, "×")))) : null),
        h("div",
          h("h3", "Envoyer (ici → DAW)"),
          h("label.ligne-form", h("span", "Sortie"), sor),
          nombre("canal", 1, 16, "Canal"),
          coche("envoyerPositions", "Envoyer les positions en CC (automation)"),
          nombre("ccBase", 0, 127 - Math.max(2, n * 2), "1er CC"),
          coche("envoyerNotes", "Envoyer une note quand une source joue"),
          table)),
      guideMidi());
  };
  dialogue("MIDI et DAW", corps, [], { large: true });
  remplir();
  midi.surPorts = () => { if ($("#dialogue")) remplir(); };
}

function guideMidi() {
  return h("details.guide-repli", h("summary", "Comment relier le DAW en MIDI ?"),
    h("ol.guide",
      h("li", h("b", "macOS : "), "ouvre « Configuration audio et MIDI » → Fenêtre → Studio MIDI → double-clic sur « Gestionnaire IAC » → coche « Le périphérique est en ligne »."),
      h("li", h("b", "Windows : "), "installe ", h("b", "loopMIDI"), " (gratuit) et crée un port."),
      h("li", h("b", "Linux : "), "les ports ALSA / PipeWire apparaissent directement."),
      h("li", "Dans le DAW, active ce port en sortie pour piloter les sources (notes, CC, Start/Stop), et en entrée pour enregistrer les positions comme automation."),
      h("li", "Le Web MIDI marche dans Chrome et Edge. Si l'accès est bloqué en ouvrant le fichier directement, lance plutôt ", h("code", "Motion_Designer.command"), " / ", h("code", ".bat"), ".")));
}

/* ---------- Enregistrement ---------- */
async function dialogueEnregistrement() {
  await audio.demarrer();
  const O = enregistreur.options;
  const bits = h("select", { "aria-label": "Format" }, [[16, "WAV 16 bits"], [24, "WAV 24 bits"], [32, "WAV 32 bits flottant"]]
    .map(([v, t]) => h("option", { value: v, selected: O.bits === v }, t)));
  const stems = h("input", { type: "checkbox", checked: O.stems });
  dialogue("Enregistrer", [
    h("label.ligne-form", h("span", "Format"), bits),
    h("label.ligne-coche", stems, h("span", "Enregistrer aussi chaque source à part (stems, spatialisées, sans les effets master)")),
    h("p.aide", "Fréquence : " + audio.ctx.sampleRate + " Hz (modifiable dans Sortie audio). Le fichier se télécharge avec le bouton Exporter."),
  ], [{ texte: "Démarrer l'enregistrement", principal: true, action: () => { O.bits = +bits.value; O.stems = stems.checked; enregistreur.demarrer(); } }]);
}

/* ---------- Aide ---------- */
function dialogueAide() {
  dialogue("Prise en main", [
    h("ol.guide",
      h("li", "Ajoute jusqu'à 20 fichiers audio (bouton ou glisser-déposer)."),
      h("li", "Dans le champ, attrape une source ou l'auditeur : le son joue tant que tu tiens. Le Doppler, la distance et le panoramique suivent le mouvement."),
      h("li", "Ctrl/Cmd + clic pour grouper des sources et les déplacer ensemble ; clic dans le vide pour vider la sélection."),
      h("li", "▶ sur une piste (ou barre espace sur la source active) pour la faire jouer en continu."),
      h("li", "Clic droit sur un curseur : le connecter à la vitesse ou à la position, ou lui apprendre un CC MIDI. Double-clic : valeur par défaut."),
      h("li", "Sortie audio : choisis la carte son ou un câble virtuel pour envoyer le son dans un DAW. MIDI / DAW : notes, CC et Start/Stop.")),
    h("h3", "Raccourcis"),
    h("table.table-cc",
      [["Espace", "Jouer / arrêter la source active"], ["Ctrl/Cmd + Z", "Annuler"], ["Ctrl/Cmd + Maj + Z, Ctrl + Y", "Rétablir"],
        ["Échap", "Tout arrêter"], ["R", "Démarrer / arrêter l'enregistrement"], ["F", "Plein écran"]]
        .map(([k, t]) => h("tr", h("td", h("kbd", k)), h("td", t)))),
  ]);
}
