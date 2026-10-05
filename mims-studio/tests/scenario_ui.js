/* Scenario complet de l'interface, pilote comme un utilisateur.
 * Usage : node tests/scenario_ui.js [dossier captures]   (Playwright requis) */
const path = require("path"), fs = require("fs");
const { chromium } = require("playwright");
const CAPT = process.argv[2] || path.join(__dirname, "captures");
fs.mkdirSync(CAPT, { recursive: true });
const FICH = path.join(__dirname, "fichiers");
let echecs = 0;
const verif = (ok, msg) => { console.log(`${ok ? "ok  " : "ECHEC"} ${msg}`); if (!ok) echecs++; };

(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 880 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const erreurs = [];
  p.on("pageerror", e => erreurs.push(e.message));
  p.on("console", m => { if (m.type() === "error") erreurs.push(m.text()); });
  await p.goto("file://" + path.join(__dirname, "..", "MIMS_Studio.html"));
  await p.waitForTimeout(1500);
  const ev = (f, a) => p.evaluate(f, a);
  await ev(() => tuto.fermer());                     // le tutoriel s'ouvre a la 1re visite

  // 1. budget machine
  const bud = await ev(() => ({ m: budget.coutMasse * 1e9, l: budget.coutLien * 1e9, mes: budget.mesure, max: budget.maxMasses(3) }));
  verif(bud.mes && bud.m > 0 && bud.l > 0, `budget mesure : ${bud.m.toFixed(1)} ns/masse, ${bud.l.toFixed(1)} ns/liaison, ~${bud.max} masses tiennent`);

  // 2. chaque modele pret a jouer, avec le son
  await p.click("#btn-son");
  await p.waitForTimeout(400);
  verif(await ev(() => son.mode === "worklet"), "son en AudioWorklet");
  const cartes = await p.$$("#liste-modeles .carte");
  for (let k = 0; k < cartes.length; k++) {
    await cartes[k].click();
    await p.waitForTimeout(200);
    const avant = await ev(() => Array.from(app.vue.pos).join());
    await p.keyboard.press("Space");
    await p.waitForTimeout(500);
    const r = await ev(() => ({ nom: app.fichierNom, err: app.modele.erreurs.length, statut: $("statut-texte").textContent, jauge: $("jauge-texte").textContent }));
    const apres = await ev(() => Array.from(app.vue.pos).join());
    verif(r.err === 0 && avant !== apres, `${r.nom} : compile, joue, la vue bouge · ${r.jauge}`);
    if (k === 0 || k === 3) await p.screenshot({ path: path.join(CAPT, `modele_${k}.png`) });
  }

  // 3. pincement : la bille traverse la corde -> du son (calcul hors temps reel)
  const pince = await ev(() => {
    const mdl = parse(MODELES_PRETS[0].script());
    const n = new NoyauSon(48000, () => {});
    n.message({ type: "modele", desc: compiler(mdl, { sr: 48000 }) });
    const i = n.sim.noms.indexOf("in1");
    const L = new Float32Array(128), R = new Float32Array(128);
    let e = 0;
    for (let b = 0; b < 400; b++) {
      if (b === 10) n.message({ type: "placer", i, u: -1 });
      n.remplir([L, R]);
      if (b > 40) for (const v of L) e += v * v;
    }
    return Math.sqrt(e / (360 * 128));
  });
  verif(pince > 0.01, `pincer la corde en traversant avec la bille : niveau rms ${pince.toFixed(3)}`);

  // 4. archet : son entretenu
  const archet = await ev(() => {
    const mdl = parse(MODELES_PRETS[1].script());
    const n = new NoyauSon(48000, () => {});
    n.message({ type: "modele", desc: compiler(mdl, { sr: 48000 }) });
    n.message({ type: "entrainer", i: n.sim.noms.indexOf("in1"), v: 0.004 });
    const L = new Float32Array(128), R = new Float32Array(128);
    const rms = [];
    for (let b = 0; b < 1500; b++) {
      n.remplir([L, R]);
      let e = 0; for (const v of L) e += v * v; rms.push(Math.sqrt(e / 128));
    }
    const moy = a => a.reduce((s, v) => s + v, 0) / a.length;
    return [moy(rms.slice(300, 600)), moy(rms.slice(1200))];
  });
  verif(archet[0] > 0.01 && archet[1] > 0.5 * archet[0], `archet : son entretenu (rms ${archet[0].toFixed(3)} puis ${archet[1].toFixed(3)})`);

  // 5. reglage a chaud : l'etat est garde
  const chaud = await ev(() => {
    const mdl = parse(MODELES_PRETS[0].script());
    const a = new Simulateur(compiler(mdl)); a.frapper(20, 0.3); a.pas(500);
    mdl.params.get("corde_hz").brut = "150";
    const b2 = new Simulateur(compiler(mdl));
    return b2.adopter(a) && b2.u[20] === a.u[20] && b2.u[20] !== 0;
  });
  verif(chaud, "changer un parametre garde l'etat de la simulation (pas de coupure)");
  await p.click("#liste-modeles .carte >> nth=0");
  await p.click("#onglets button[data-onglet=reglages]");
  const sld = await p.$(".reglage[data-param=pince_pos] input[type=range]");
  const ligneAvant = await ev(() => $("editeur").value.split("\n").find(l => /^@pince_pos/.test(l)));
  await sld.evaluate(e => { e.value = 600; e.dispatchEvent(new Event("input")); });
  await p.waitForTimeout(200);
  const ligneApres = await ev(() => $("editeur").value.split("\n").find(l => /^@pince_pos/.test(l)));
  verif(ligneAvant !== ligneApres, `curseur -> script : "${ligneAvant}" devient "${ligneApres}"`);
  await p.screenshot({ path: path.join(CAPT, "reglages.png") });

  // 6. inspecteur : ecouter / relier / pincer sur une membrane
  await p.click("#onglets button[data-onglet=construire]");
  await p.click("#liste-modeles .carte >> nth=3");
  await p.waitForTimeout(300);
  const clique = async (i, shift = false) => {
    const [x, y] = await ev(k => app.vue.ecran(k), i);
    const r = await p.$eval("#vue3d", c => { const b = c.getBoundingClientRect(); return [b.left, b.top]; });
    if (shift) await p.keyboard.down("Shift");
    await p.mouse.click(r[0] + x, r[1] + y);
    if (shift) await p.keyboard.up("Shift");
    await p.waitForTimeout(150);
  };
  const noeud = await ev(() => app.desc.macros[0].debut + 4 * 16 + 5);
  await clique(noeud);
  const insp = await ev(() => [!$("inspecteur").hidden, $("insp-titre").textContent]);
  verif(insp[0], `clic sur la membrane -> inspecteur : ${insp[1]}`);
  await p.screenshot({ path: path.join(CAPT, "inspecteur.png") });
  const nbSorties = await ev(() => app.modele.sorties.length);
  await p.click("#insp-actions >> text=Écouter");
  await p.waitForTimeout(200);
  verif(await ev(() => app.modele.sorties.length) === nbSorties + 1, "Écouter ajoute une sortie sur un proxy de la membrane");
  await clique(noeud);
  await clique(await ev(() => app.desc.macros[0].debut + 11 * 16 + 11), true);
  const relier = await p.$("#insp-actions >> text=/Relier/");
  verif(!!relier, "Maj+clic sur un 2e point propose Relier");
  if (relier) await relier.click();
  await p.waitForTimeout(200);
  verif(await ev(() => app.modele.interactions.some(i => i.nom.startsWith("lien"))), "Relier ajoute un ressort entre deux proxies");
  await clique(noeud);
  await p.click("#insp-actions >> text=Pincer");
  await p.waitForTimeout(200);
  verif(await ev(() => app.modele.interactions.some(i => i.genre === "nlPluck") && app.modele.erreurs.length === 0), "Pincer ajoute une entree + nlPluck");

  // 7. briques
  await p.click("#liste-briques .puce >> nth=0");
  await p.click("#dlg-form-go");
  await p.waitForTimeout(200);
  verif(await ev(() => app.modele.macros.size === 2), "+ Corde ajoute une corde integree");

  // 8. import 3D
  for (const [f, attendu] of [["tore_hd.obj", null], ["sphere.stl", null], ["deux_morceaux.obj", "relié"]]) {
    await p.setInputFiles("#fichier-3d", path.join(FICH, f));
    await p.waitForTimeout(600);
    const ap = await ev(() => [$("imp-origine").textContent, $("imp-apercu").textContent]);
    console.log(`     ${f} : ${ap[0]}\n     ${ap[1]}`);
    if (f === "tore_hd.obj") await p.screenshot({ path: path.join(CAPT, "import.png") });
    await p.click("#imp-go");
    await p.waitForTimeout(400);
    const r = await ev(() => ({ c: comptesModele(app.modele), ch: budget.charge(comptesModele(app.modele)), err: app.modele.erreurs.length }));
    verif(r.err === 0 && r.ch < 0.7, `${f} importe : ${r.c.masses} masses, ${r.c.liaisons} liaisons, charge estimee ${Math.round(r.ch * 100)} %`);
    if (attendu) verif(ap[1].includes(attendu), `${f} : morceaux relies`);
    await p.keyboard.press("Space");
    await p.waitForTimeout(400);
    if (f === "tore_hd.obj") await p.screenshot({ path: path.join(CAPT, "tore_importe.png") });
  }

  // 9. ancien format du studio
  await p.setInputFiles("#fichier-mdl", path.join(FICH, "cloche_ancien_format.mdl"));
  await p.waitForTimeout(400);
  const anc = await ev(() => {
    const s = new Simulateur(app.desc); s.pas(20000);
    return { legacy: app.modele.legacy, err: app.modele.erreurs.length, derive: s.amplitude() };
  });
  verif(anc.legacy && anc.err === 0 && anc.derive < 1e-9, `ancien format : lu, aucune derive au repos (${anc.derive})`);
  await p.click("#onglets button[data-onglet=export]");
  await p.waitForTimeout(300);
  const exp = await ev(() => app._dernierExport && app._dernierExport.texte.split("\n").find(l => /contact/.test(l) && l.startsWith("@")));
  verif(exp && /-5\.0?\b/.test(exp), `ancien format -> Max : seuil du contact recalcule : ${exp}`);

  // 10. export .gendsp
  await p.click("#onglets button[data-onglet=construire]");
  await p.click("#liste-modeles .carte >> nth=4");
  await p.click("#onglets button[data-onglet=export]");
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(CAPT, "export.png") });
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-gendsp")]);
  const fichier = path.join(CAPT, dl.suggestedFilename());
  await dl.saveAs(fichier);
  let gendspOk = false;
  try { const j = JSON.parse(fs.readFileSync(fichier, "utf8")); gendspOk = !!j.patcher.boxes.find(x => x.box.maxclass === "codebox"); } catch (e) { console.log(e.message); }
  verif(gendspOk, `${dl.suggestedFilename()} telecharge : JSON valide avec un codebox gen~`);
  const code = await ev(() => $("export-code").value);
  verif(/compute_string/.test(code) && /compute_corner_mesh/.test(code) && /set_proxy_pos_mesh/.test(code),
        "code gen~ : corde + membrane integrees + proxy de membrane");

  verif(erreurs.length === 0, `aucune erreur JavaScript (${erreurs.join(" | ")})`);
  console.log(echecs ? `${echecs} ECHEC(S)` : "TOUT EST OK");
  await b.close();
  process.exit(echecs ? 1 : 0);
})();
