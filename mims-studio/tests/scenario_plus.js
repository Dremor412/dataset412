/* migen-plus dans le studio : briques physiques, objets modaux, nouvelles
 * excitations, export. Usage : node tests/scenario_plus.js [dossier captures] */
const path = require("path"), fs = require("fs");
const { chromium } = require("playwright");
const CAPT = process.argv[2] || path.join(__dirname, "captures");
fs.mkdirSync(CAPT, { recursive: true });
let echecs = 0;
const verif = (ok, msg) => { console.log(`${ok ? "ok  " : "ECHEC"} ${msg}`); if (!ok) echecs++; };

(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 880 } })).newPage();
  const erreurs = [];
  p.on("pageerror", e => erreurs.push(e.message));
  p.on("console", m => { if (m.type() === "error") erreurs.push(m.text()); });
  await p.goto("file://" + path.join(__dirname, "..", "MIMS_Studio.html"));
  await p.waitForTimeout(1000);
  const ev = (f, a) => p.evaluate(f, a);
  await ev(() => tuto.fermer());

  // 1. briques physiques, ajoutees comme depuis le formulaire
  for (const [cle, valeurs] of [["cordeReelle", null], ["barre", null], ["plaque", null]]) {
    const r = await ev(cle => {
      app.charger("# vide\n\n", "t.mdl");
      const br = BRIQUES[cle], v = {};
      for (const [k, [, def]] of Object.entries(br.champs)) v[k] = def;
      app.ajouterLignes(br.lignes(app.modele, v, app.vue));
      const n = new NoyauSon(44100, () => {});
      n.message({ type: "modele", desc: compiler(app.modele, { sr: 44100 }) });
      const d = n.sim.desc;
      let i = -1;                                      // un point mobile ou modal au milieu
      const vib = new Set(d.vibrants || []);
      for (let k = 0; k < d.nbNoeuds; k++) if ((d.etat[k] === MOBILE && !(d.virtuel || []).includes(k)) || vib.has(k)) { i = k; if (k > d.nbNoeuds / 3) break; }
      n.message({ type: "frapper", i, force: 0.3 });
      const L = new Float32Array(128), R = new Float32Array(128); let e = 0, fini = true;
      for (let k = 0; k < 300; k++) { n.remplir([L, R]); for (const x of L) { e += x * x; if (!isFinite(x)) fini = false; } }
      return { err: app.modele.erreurs.length, modal: app.modele.modaux.length, rms: Math.sqrt(e / 38400), fini,
               statut: $("statut-texte").textContent, stab: margeStabilite(app.desc).rapport };
    }, cle);
    verif(r.err === 0 && r.fini && r.rms > 1e-3 && r.stab < 1,
          `${cle} : compile, sonne (rms ${r.rms.toFixed(3)}), stable (${Math.round(r.stab * 100)} %)${r.modal ? ", en modal" : ""} — « ${r.statut.slice(0, 60)} »`);
  }
  await p.screenshot({ path: path.join(CAPT, "plaque.png") });

  // 2. une forme 3D passee en modal depuis l'inspecteur
  await ev(() => { const def = {}; for (const [k, v] of Object.entries(CATALOGUE.cloche[2])) def[k] = v[1]; app.charger(genere("cloche", def)[0], "cloche.mdl"); });
  const avant = await ev(() => budget.charge(comptesDesc(app.desc)));
  await ev(() => app.vue.choisir(new Map(app.desc.indices).get("cloche_m40")));
  const bouton = await p.$("#insp-actions >> text=/en modal/");
  verif(!!bouton, "inspecteur : bouton « @cloche en modal » sur un point de la cloche");
  if (bouton) await bouton.click();
  await p.waitForTimeout(300);
  const apres = await ev(() => ({ c: budget.charge(comptesDesc(app.desc)), md: app.desc.modaux[0] && app.desc.modaux[0].nb,
    params: ["cloche_hauteur", "cloche_t60", "cloche_brillance"].every(n => app.modele.params.has(n)), statut: $("statut-texte").textContent }));
  verif(apres.md === 40 && apres.params && apres.c < avant / 2,
        `cloche en modal : 40 modes, CPU estimée ${Math.round(avant * 100)} % → ${Math.round(apres.c * 100)} % (« ${apres.statut.slice(0, 70)}… »)`);
  await p.click("#btn-son");
  await p.waitForTimeout(300);
  await p.keyboard.press("Space");
  await p.waitForTimeout(60);                      // la cloche generee s'eteint en ~0,16 s
  const bouge = await ev(() => { const d = app.desc, md = d.modaux[0]; return Math.abs(app.vue.pos[3 * md.mobiles[5] + 2] - d.gz[md.mobiles[5]]); });
  verif(bouge > 1e-4, `la cloche modale vibre dans la vue (déplacement affiché ${bouge.toExponential(1)})`);
  await p.screenshot({ path: path.join(CAPT, "cloche_modale.png") });
  await ev(() => app.changerParam("cloche_hauteur", 1.5));
  await p.waitForTimeout(200);
  verif(await ev(() => Math.abs(app.desc.A[app.desc.modaux[0].debut] - 2 * Math.exp(-6.91 / (app.modele.params.get("cloche_t60").valeur * 44100)) * Math.cos(app.desc.modaux[0].omega[0] * 1.5)) < 1e-9),
        "curseur cloche_hauteur : les modes montent (coefficients recalculés)");
  // retour aux masses
  await ev(() => app.vue.choisir(new Map(app.desc.indices).get("cloche_m40")));
  const retour = await p.$("#insp-actions >> text=/en masses/");
  if (retour) await retour.click();
  await p.waitForTimeout(200);
  verif(await ev(() => app.modele.modaux.length === 0 && !(app.desc.modaux || []).length), "« en masses » : retour au calcul masse par masse");

  // 3. nouvelles excitations sur la corde reelle, et export Max
  const exp = await ev(() => {
    app.charger("# vide\n\n", "t.mdl");
    const br = BRIQUES.cordeReelle, v = {};
    for (const [k, [, def]] of Object.entries(br.champs)) v[k] = def;
    app.ajouterLignes(br.lignes(app.modele, v, app.vue));
    const i = app.desc.macros[0].debut + 12;
    app.ajouterLignes(lignesExcitation(app.modele, app.desc, i, "maillet"));
    app.ajouterLignes(lignesExcitation(app.modele, app.desc, app.desc.macros[0].debut + 30, "stribeck"));
    app.ecouterPoints([app.desc.macros[0].debut + 40]);
    const r = app._export();
    return { err: app.modele.erreurs.length, genres: app.modele.interactions.map(x => x.genre).join(","),
             code: /require\("migen-plus"\)/.test(r.code) && /compute_bend_string\(corde/.test(r.code) && /compute_contact_hc/.test(r.code) && /compute_friction/.test(r.code),
             gendsp: (() => { try { return !!JSON.parse(r.gendsp).patcher; } catch (e) { return false; } })(),
             archet: app._entreesArchet().size, avert: r.avertissements.join(" | ") };
  });
  verif(exp.err === 0 && /contactHC/.test(exp.genres) && /friction/.test(exp.genres), `maillet (+) et frotter (+) ajoutés : ${exp.genres}`);
  verif(exp.archet === 1, "le frottement de Stribeck est entraîné par le curseur archet");
  verif(exp.code && exp.gendsp, `export Max : code gen~ avec migen-plus et .gendsp valide (${exp.avert.slice(0, 80)}…)`);

  // 4. legende et roles des parametres physiques
  await p.click("#onglets button[data-onglet=reglages]");
  const roles = await ev(() => [...document.querySelectorAll("#liste-reglages .reglage")].map(r => `${r.dataset.param}: ${(r.querySelector(".role") || {}).textContent || ""}`).join(" | "));
  verif(/corde_L: longueur/.test(roles) && /corde_T: tension/.test(roles) && /maillet_alpha: alpha — dureté/.test(roles), `rôles : ${roles.slice(0, 160)}…`);
  await p.screenshot({ path: path.join(CAPT, "reglages_plus.png") });

  verif(erreurs.length === 0, `aucune erreur JavaScript (${erreurs.join(" | ")})`);
  console.log(echecs ? `${echecs} ECHEC(S)` : "TOUT EST OK");
  await b.close();
  process.exit(echecs ? 1 : 0);
})();
