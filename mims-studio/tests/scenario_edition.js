/* Nouveautes : tutoriel, edition 3D a la souris, ecoute multiple, legende,
 * stabilite et secours. Usage : node tests/scenario_edition.js [dossier captures] */
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
  await p.waitForTimeout(1200);
  const ev = (f, a) => p.evaluate(f, a);
  const toile = await p.$eval("#vue3d", c => { const r = c.getBoundingClientRect(); return [r.left, r.top]; });
  const ecranDe = async i => { const [x, y] = await ev(k => app.vue.ecran(k), i); return [toile[0] + x, toile[1] + y]; };
  const versEcran = async pt => { const [x, y] = await ev(q => app.vue._projette(...q), pt); return [toile[0] + x, toile[1] + y]; };

  // 1. tutoriel complet avec « Le faire pour moi »
  verif(await ev(() => !$("tuto").hidden), "le tutoriel s'ouvre a la premiere visite");
  await p.click("#tuto-faire");
  for (let k = 1; k < 11; k++) {
    await p.waitForTimeout(150);
    const titre = await ev(() => $("tuto-titre").textContent);
    await p.click("#tuto-faire");
    await p.waitForTimeout(1500);
    const apres = await ev(() => [tuto.etape, $("tuto").hidden]);
    verif(apres[0] > k - 1 || apres[1], `tuto « ${titre} » : fait, etape suivante`);
    if (k === 7) await p.screenshot({ path: path.join(CAPT, "tuto.png") });
  }
  const tutoModele = await ev(() => ({ err: app.modele.erreurs.length, macros: app.modele.macros.size,
    sorties: app.modele.sorties.length, genres: app.modele.interactions.map(i => i.genre).join(",") }));
  verif(tutoModele.err === 0 && tutoModele.macros === 2 && tutoModele.sorties === 2 && /nlPluck/.test(tutoModele.genres) && /nlBow/.test(tutoModele.genres),
        `modele du tutoriel : corde + membrane + lien + pincement + archet + 2 ecoutes (${tutoModele.genres})`);
  await p.click("#tuto-fermer").catch(() => {});

  // 2. edition a la souris sur un modele vide
  await ev(() => { app.charger("# vide\n\n", "test.mdl"); app.modeEdition(true); app.vue.planZ = 4; $("plan-z").value = 4; });
  await p.keyboard.press("c");
  let a = await versEcran([-6, 0, 4]), c = await versEcran([6, 0, 4]);
  await p.mouse.move(...a); await p.mouse.down(); await p.mouse.move(...c, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(200);
  verif(await ev(() => [...app.modele.macros.values()].some(m => m.genre === "string")), "outil corde : glisser trace une corde integree");
  await p.keyboard.press("m");
  await p.mouse.click(...await versEcran([0, -5, 4]));
  await p.waitForTimeout(150);
  const masse = await ev(() => { const m = [...app.modele.masses.values()].find(x => x.genre === "mass"); return m && [m.nom, app.desc.gx[new Map(app.desc.indices).get(m.nom)], app.desc.gy[new Map(app.desc.indices).get(m.nom)]]; });
  verif(masse && Math.abs(masse[1]) < 0.3 && Math.abs(masse[2] + 5) < 0.3, `outil masse : posee au clic, sur la grille (${masse && masse.slice(1).map(v => v.toFixed(2))})`);
  await p.keyboard.press("l");
  const iMasse = await ev(n => new Map(app.desc.indices).get(n), masse[0]);
  const iCorde = await ev(() => app.desc.macros[0].debut + 10);
  await p.mouse.click(...await ecranDe(iMasse)); await p.mouse.click(...await ecranDe(iCorde));
  await p.waitForTimeout(150);
  verif(await ev(() => app.modele.interactions.some(i => i.genre === "springDamper")), "outil relier : deux clics = un ressort (masse -> proxy sur la corde)");
  await p.screenshot({ path: path.join(CAPT, "edition.png") });

  // 3. gizmo : monter la masse de 2 sur Z, puis annuler
  await p.keyboard.press("v");
  await p.mouse.click(...await ecranDe(iMasse));
  await p.waitForTimeout(100);
  const g = await ev(() => { const g = app.vue._gizmo(); return [g.axes[2].ex, g.axes[2].ey, g.ox, g.oy, g.axes[2].parUnite, g.axes[2].ux, g.axes[2].uy]; });
  const zDe = () => ev(n => app.desc.gz[new Map(app.desc.indices).get(n)], masse[0]);
  const z0 = await zDe();
  const depart = [toile[0] + (g[0] + g[2]) / 2, toile[1] + (g[1] + g[3]) / 2];
  await p.mouse.move(...depart); await p.mouse.down();
  await p.mouse.move(depart[0] + g[5] * g[4] * 2, depart[1] + g[6] * g[4] * 2, { steps: 6 }); await p.mouse.up();
  await p.waitForTimeout(150);
  const z1 = await zDe();
  verif(Math.abs(z1 - z0 - 2) < 0.3, `fleche Z du gizmo : la masse monte de ${(z1 - z0).toFixed(2)}`);
  await p.keyboard.press("Control+z");
  await p.waitForTimeout(150);
  verif(Math.abs(await zDe() - z0) < 1e-6, "Ctrl+Z annule le deplacement");

  // 4. contacts au sol suivis quand on deplace un point d'une forme
  await ev(() => { const def = {}; for (const [k, v] of Object.entries(CATALOGUE.donutcoupe[2])) def[k] = v[1]; app.charger(genere("donutcoupe", def)[0], "d.mdl"); app.modeEdition(true); });
  const res = await ev(() => {
    const d = app.desc, i = new Map(d.indices).get("donutcoupe_m40");
    app.vue.choisir(i);
    app.deplacer([i], [0, 0, 3]);
    const l = $("editeur").value.split("\n").find(x => x.startsWith("@donutcoupe_s40 "));
    return [d.gz[i], l];
  });
  verif(new RegExp(`${(-(res[0] + 3)).toFixed(1)}`).test(res[1]), `deplacer un point met a jour son contact au sol : ${res[1]}`);

  // 5. cadre de selection + suppression
  const nAvant = await ev(() => app.modele.masses.size);
  const ctr = await versEcran([0, -6.5, 1]);
  await p.mouse.move(ctr[0] - 60, ctr[1] - 40); await p.mouse.down(); await p.mouse.move(ctr[0] + 60, ctr[1] + 40, { steps: 5 }); await p.mouse.up();
  const nSel = await ev(() => app.vue.multi.size);
  await p.keyboard.press("Delete");
  await p.waitForTimeout(200);
  const nApres = await ev(() => app.modele.masses.size);
  verif(nSel > 0 && nApres < nAvant, `cadre : ${nSel} points choisis, Suppr en retire ${nAvant - nApres} masses`);

  // 6. ecoute multiple
  await ev(() => { app.charger(MODELES_PRETS[4].script(), "cm.mdl"); app.modeEdition(false); });
  const ids = await ev(() => { const d = app.desc; return [d.macros[0].debut + 10, d.macros[0].debut + 30, d.macros[1].debut + 20]; });
  await p.mouse.click(...await ecranDe(ids[0]));
  await p.keyboard.down("Shift");
  await p.mouse.click(...await ecranDe(ids[1])); await p.mouse.click(...await ecranDe(ids[2]));
  await p.keyboard.up("Shift");
  await p.waitForTimeout(100);
  const bouton = await p.$("#insp-actions >> text=/Écouter ces 3 points/");
  verif(!!bouton, "Maj+clic sur 3 points -> « Écouter ces 3 points »");
  const nS = await ev(() => app.modele.sorties.length);
  if (bouton) await bouton.click();
  await p.waitForTimeout(200);
  const pans = await ev(() => app.desc.sorties.map(s => s.pan.toFixed(2)).join(" "));
  verif(await ev(() => app.modele.sorties.length) === nS + 3 && pans === "-1.00 -0.50 0.00 0.50 1.00", `3 sorties ajoutees, toutes reparties : ${pans}`);
  await p.screenshot({ path: path.join(CAPT, "ecoute.png") });
  await ev(() => son.actif || app.basculeSon());
  await p.waitForTimeout(400);
  const pan = await p.$("#liste-sorties .sortie input[type=range]");
  await pan.evaluate(e => { e.value = -0.5; e.dispatchEvent(new Event("input")); });
  verif(await ev(() => /~sortie @out1 pan -0.50/.test($("editeur").value)), "panoramique de out1 -> ligne ~sortie dans le script");
  const unSon = await ev(() => {          // le routage stereo agit bien (hors temps reel)
    const n = new NoyauSon(48000, () => {});
    const desc = compiler(app.modele, { sr: 48000 }); desc.sorties.forEach(s => { s.pan = -1; });
    n.message({ type: "modele", desc }); n.message({ type: "frapper", i: desc.macros[0].debut + 20, force: 0.3 });
    const L = new Float32Array(128), R = new Float32Array(128); let eL = 0, eR = 0;
    for (let k = 0; k < 200; k++) { n.remplir([L, R]); for (let j = 0; j < 128; j++) { eL += L[j] * L[j]; eR += R[j] * R[j]; } }
    return [eL, eR];
  });
  verif(unSon[0] > 0 && unSon[1] < 1e-12, `tout a gauche (pan -1) : energie G ${unSon[0].toFixed(2)}, D ${unSon[1].toExponential(0)}`);

  // 7. legende et roles
  await p.click("#onglets button[data-onglet=reglages]");
  const leg = await ev(() => [$("liste-legende").children.length, [...document.querySelectorAll("#liste-reglages .reglage")].find(r => r.querySelector("label").textContent === "corde_K").querySelector(".role").textContent]);
  verif(leg[0] > 10 && leg[1] && /raideur|amortissement/.test(leg[1]), `legende (${leg[0] / 2} entrees) et role sous les curseurs : « ${leg[1]} »`);
  await p.screenshot({ path: path.join(CAPT, "reglages.png") });

  // 8. stabilite + secours automatique
  await p.waitForTimeout(1800);                     // laisse le temps de memoriser des reglages stables
  await ev(() => app.changerParam("corde_K", 6));
  await p.waitForTimeout(100);
  verif(await ev(() => $("stabilite").classList.contains("alerte")), `K = 6 : alerte « ${await ev(() => $("stabilite").textContent.slice(0, 60))}… »`);
  await ev(() => app.frapper());                     // on joue : l'instabilite se declenche
  await p.waitForTimeout(1500);
  const apresK = await ev(() => [app.modele.params.get("corde_K").valeur, $("statut-texte").textContent]);
  verif(apresK[0] === 0.3, `explosion -> secours automatique : corde_K revient a ${apresK[0]} (« ${apresK[1].slice(0, 70)}… »)`);

  // 9. charge CPU : stable quand le son s'eteint (nombres denormaux)
  const cpu = await ev(() => {
    const s = new Simulateur(compiler(app.modele, { sr: 44100 }));
    s.frapper(s.desc.macros[0].debut + 20, 0.3);
    const t = () => { const t0 = performance.now(); s.pas(22050); return performance.now() - t0; };
    const a = t(); s.pas(44100 * 30); return [a, t()];
  });
  verif(cpu[1] < cpu[0] * 2, `cout du calcul apres 30 s de silence : ${cpu[1].toFixed(0)} ms contre ${cpu[0].toFixed(0)} ms au debut`);

  verif(erreurs.length === 0, `aucune erreur JavaScript (${erreurs.join(" | ")})`);
  console.log(echecs ? `${echecs} ECHEC(S)` : "TOUT EST OK");
  await b.close();
  process.exit(echecs ? 1 : 0);
})();
