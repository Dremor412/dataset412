/* Scenario complet, pilote comme un utilisateur.
 * Usage : node tests/scenario.js [dossier captures]   (Playwright requis) */
const path = require("path"), fs = require("fs");
const { chromium } = require("playwright");
const CAPT = process.argv[2] || path.join(__dirname, "captures");
fs.mkdirSync(CAPT, { recursive: true });
let echecs = 0;
const verif = (ok, msg) => { console.log(`${ok ? "ok  " : "ECHEC"} ${msg}`); if (!ok) echecs++; };

/* petit fichier WAV de test : un la 440 Hz, 2 s */
function wavTest(fichier, freq) {
  const sr = 44100, n = sr * 2, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(9000 * Math.sin(2 * Math.PI * freq * i / sr)), 44 + i * 2);
  fs.writeFileSync(fichier, b);
  return fichier;
}

(async () => {
  const sons = [wavTest(path.join(CAPT, "la440.wav"), 440), wavTest(path.join(CAPT, "mi660.wav"), 660)];
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  // faux port MIDI (comme un bus IAC / loopMIDI) : on capte ce qui part vers le DAW
  await ctx.addInitScript(() => {
    const envoyes = [];
    const entree = { id: "in1", name: "Bus IAC 1", onmidimessage: null };
    const sortie = { id: "out1", name: "Bus IAC 1", send: d => envoyes.push([...d]) };
    navigator.requestMIDIAccess = async () => ({ inputs: new Map([["in1", entree]]), outputs: new Map([["out1", sortie]]), onstatechange: null });
    window.__midi = { envoyes, entree };
  });
  const p = await ctx.newPage();
  const erreurs = [];
  p.on("pageerror", e => erreurs.push(e.message));
  p.on("console", m => { if (m.type() === "error") erreurs.push(m.text()); });
  await p.goto("file://" + path.join(__dirname, "..", "Motion_Designer.html"));
  await p.waitForTimeout(600);
  const ev = (f, a) => p.evaluate(f, a);

  // 1. le son s'active au premier clic
  await p.mouse.click(760, 300);
  await p.waitForTimeout(400);
  verif(await ev(() => audio.ctx && audio.ctx.state === "running"), "contexte audio actif apres un clic");

  // 2. ajout de deux fichiers
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.click("#btn-ajouter")]);
  await fc.setFiles(sons);
  await p.waitForFunction(() => etat.sources.length === 2);
  verif(await ev(() => etat.sources.every(s => tampons.has(s.id) && moteur.sources.has(s.id))), "2 sources chargees, decodees et branchees");

  // 3. glisser une source : elle joue pendant le geste, le Doppler bouge, puis elle s'arrete
  const box = await p.$eval("#champ", c => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, t: r.width }; });
  const px = (x, y) => [box.x + (x + 1) / 2 * box.t, box.y + (1 - y) / 2 * box.t];
  const s1 = await ev(() => ({ id: etat.sources[0].id, x: etat.sources[0].x, y: etat.sources[0].y }));
  let [x0, y0] = px(s1.x, s1.y);
  await p.mouse.move(x0, y0); await p.mouse.down();
  await p.waitForTimeout(150);
  verif(await ev(id => moteur.sources.get(id).actif, s1.id), "la source joue pendant qu'on la tient");
  let dopplerMin = 1;
  for (let i = 1; i <= 12; i++) {
    await p.mouse.move(x0, y0 - i * 12); await p.waitForTimeout(16);
    dopplerMin = Math.min(dopplerMin, await ev(id => moteur.sources.get(id).doppler, s1.id));
  }
  verif(dopplerMin < 0.995, `Doppler quand la source s'eloigne vite : ${dopplerMin.toFixed(3)}×`);
  await p.mouse.up();
  await p.waitForTimeout(100);
  verif(await ev(id => !moteur.sources.get(id).actif, s1.id), "la source s'arrete au relachement (enveloppe de relache)");
  verif(await ev(id => etat.sources[0].y > 0.6, s1.id), "la position de la source a suivi la souris");
  verif(await ev(() => historique.pile.length >= 2), "le deplacement s'annule (historique)");

  // 4. effets : master reverb + piste filtre avec LFO
  await p.click('#master-fx .fx[data-type="reverb"] .power');
  verif(await ev(() => etat.master.fx.find(f => f.type === "reverb").on && audio.master.modules[3].on), "reverb master activee");
  await p.click(".carte-source .bloc-tete >> nth=1");                      // ouvrir les effets de piste
  await p.click('.carte-source .fx[data-type="filtre"] .power');
  await p.waitForTimeout(100);
  await p.check('.carte-source .fx[data-type="filtre"] .lfo input[type=checkbox] >> nth=0');
  await p.waitForTimeout(300);
  const lfo = await ev(() => [...mod.effectifs.keys()].some(k => k.endsWith(":fx:filtre:freq")));
  verif(lfo, "LFO sur la coupure du filtre de piste");

  // 5. connecteur par clic droit
  await p.click('#master-volume .curseur', { button: "right" });
  await p.click('#menu-ctx button:has-text("Vitesse")');
  verif(await ev(() => etat.liens["m:volume"] === "vitesse"), "volume general connecte a la vitesse");
  verif(await p.isVisible('#connecteurs li:has-text("Volume général")'), "le connecteur apparait dans le panneau");
  await p.screenshot({ path: path.join(CAPT, "1_effets.png") });

  // 6. annuler / retablir
  await p.keyboard.press("Control+z");
  verif(await ev(() => !etat.liens["m:volume"]), "Ctrl+Z annule la connexion");
  await p.keyboard.press("Control+Shift+z");
  verif(await ev(() => etat.liens["m:volume"] === "vitesse"), "Ctrl+Maj+Z la retablit");

  // 7. enregistrement avec stems
  await p.click("#btn-rec");
  await p.check('#dialogue input[type=checkbox]');
  await p.click('#dialogue button:has-text("Démarrer")');
  await p.click("#btn-jouer");
  await p.waitForTimeout(1200);
  await p.click("#btn-rec");
  await p.waitForTimeout(200);
  const rec = await ev(async () => {
    const r = enregistreur.resultat;
    const crete = async blob => {
      const buf = await audio.ctx.decodeAudioData(await blob.arrayBuffer());
      let m = 0; const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
      return m;
    };
    return { n: r.length, noms: r.map(x => x.nom), duree: r[0].duree, cretes: await Promise.all(r.map(x => crete(x.blob))) };
  });
  verif(rec.n === 3, `3 fichiers (mix + 2 stems) : ${rec.noms.join(", ")}`);
  verif(rec.duree > 0.9 && rec.cretes[0] > 0.005 && rec.cretes.every(c => c > 0.0005), `audio enregistre non muet (${rec.duree.toFixed(2)} s, cretes ${rec.cretes.map(c => c.toFixed(2)).join(" / ")})`);
  const telech = [];
  p.on("download", d => telech.push(d.suggestedFilename()));
  await p.click("#btn-export");
  await p.waitForTimeout(1300);
  verif(telech.length === 3 && telech.every(n => n.endsWith(".wav")), "Exporter telecharge les WAV : " + telech.join(", "));
  await p.click("#btn-stop");

  // 8. MIDI : apprentissage d'un CC, notes -> sources, Start/Stop (par le port d'entree)
  await p.click("#btn-midi");
  await p.selectOption('#dialogue select[aria-label="Sortie MIDI"]', "out1");
  await p.screenshot({ path: path.join(CAPT, "3_midi.png") });
  await p.keyboard.press("Escape");
  const envoyer = d => ev(d => window.__midi.entree.onmidimessage({ data: d }), d);
  await p.click('#master-fx .fx[data-type="reverb"] .curseur >> nth=0', { button: "right" });
  await p.click('#menu-ctx button:has-text("Apprendre")');
  await p.waitForTimeout(50);
  await envoyer([0xb0, 74, 10]); await envoyer([0xb0, 74, 127]);
  verif(await ev(() => etat.midi["1:74"] === "m:fx:reverb:mix" && etat.master.fx.find(f => f.type === "reverb").params.mix === 100), "CC 74 appris sur le mix de la reverb");
  const id2 = await ev(() => etat.sources[1].id);
  await envoyer([0x90, 37, 100]);
  await p.waitForTimeout(100);
  verif(await ev(id => moteur.sources.get(id).actif, id2), "note C#1 (37) joue la source 2");
  await envoyer([0x80, 37, 0]);
  verif(await ev(id => !moteur.sources.get(id).actif, id2), "note off l'arrete");
  await envoyer([0xfa]);
  await p.waitForTimeout(100);
  verif(await ev(() => etat.sources.every(s => moteur.sources.get(s.id).actif)), "Start du DAW lance toutes les sources");
  await envoyer([0xfc]);
  verif(await ev(() => !moteur.unActif()), "Stop du DAW les arrete");
  const sorti = await ev(() => window.__midi.envoyes);
  verif(sorti.some(m => m[0] === 0xb0 && m[1] === 20) && sorti.some(m => m[0] === 0xb0 && m[1] === 102), `positions envoyees au DAW en CC (${sorti.filter(m => m[0] === 0xb0).length} messages)`);
  verif(sorti.some(m => m[0] === 0x90 && m[1] === 37) && sorti.some(m => m[0] === 0x80 && m[1] === 37), "notes envoyees au DAW quand une source joue");

  // 9. modes de lecture
  for (const mode of ["oneshot", "pingpong", "periodique"]) {
    await p.selectOption(".carte-source select >> nth=0", mode);
    await ev(() => moteur.jouer(etat.sources[0].id));
    await p.waitForTimeout(150);
    verif(await ev(() => moteur.sources.get(etat.sources[0].id).voix.size > 0), "mode " + mode + " : une voix joue");
    await ev(() => moteur.relacher(etat.sources[0].id, true));
  }

  // 10. preset : sauver (avec audio) puis recharger
  await p.click("#btn-sauver");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click('#dialogue button:has-text("Télécharger")')]);
  const fichierPreset = path.join(CAPT, dl.suggestedFilename());
  await dl.saveAs(fichierPreset);
  await ev(() => { etat.sources = []; moteur.synchroniser(); interfaceUI.rendre(); });
  const [fc2] = await Promise.all([p.waitForEvent("filechooser"), p.click("#btn-charger")]);
  await fc2.setFiles(fichierPreset);
  await p.waitForFunction(() => etat.sources.length === 2);
  verif(await ev(() => etat.sources.every(s => tampons.has(s.id)) && etat.liens["m:volume"] === "vitesse" && etat.midi["1:74"]), "preset recharge : sources, audio, connecteurs et MIDI");

  // 11. fenetres sortie audio et MIDI
  await p.click("#btn-sortie");
  await p.waitForSelector('#dialogue select[aria-label="Périphérique de sortie"]');
  const sorties = await ev(() => $$('#dialogue select[aria-label="Périphérique de sortie"] option').length);
  verif(sorties >= 1, `fenetre Sortie audio (${sorties} choix)`);
  await p.screenshot({ path: path.join(CAPT, "2_sortie.png") });
  await p.keyboard.press("Escape");

  // 12. multipiste : routage par paires si la sortie a assez de canaux
  const multi = await ev(() => {
    const max = audio.ctx.destination.maxChannelCount;
    audio.sortie.mode = "multi"; audio.router();
    const r = { max, paires: audio.sortie.pairesActives, canaux: audio.ctx.destination.channelCount };
    audio.sortie.mode = "stereo"; audio.router();
    return r;
  });
  verif(multi.max < 4 ? multi.paires === 1 : multi.paires >= 2, `multipiste : ${multi.max} canaux dispo -> ${multi.paires} paire(s)`);

  // 13. ecran de telephone
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(300);
  const deborde = await ev(() => document.documentElement.scrollWidth > innerWidth + 1);
  verif(!deborde, "pas de defilement horizontal sur telephone");
  await p.screenshot({ path: path.join(CAPT, "4_telephone.png"), fullPage: true });

  verif(erreurs.length === 0, "aucune erreur JS" + (erreurs.length ? " : " + erreurs.join(" | ") : ""));
  await b.close();
  console.log(echecs ? `\n${echecs} echec(s)` : "\ntout est bon");
  process.exit(echecs ? 1 : 0);
})();
