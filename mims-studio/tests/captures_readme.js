/* Captures d'ecran de la page d'accueil GitHub (docs/images).
 * Usage : node tests/captures_readme.js */
const path = require("path");
const { chromium } = require("playwright");
const SORTIE = path.join(__dirname, "..", "..", "docs", "images");

(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 })).newPage();
  await p.goto("file://" + path.join(__dirname, "..", "MIMS_Studio.html"));
  await p.waitForTimeout(1000);
  const ev = (f, a) => p.evaluate(f, a);
  const capture = nom => p.screenshot({ path: path.join(SORTIE, nom + ".png") });
  await ev(() => tuto.fermer());

  // 1. la cloche, jouee (vue principale)
  await ev(() => { const def = {}; for (const [k, v] of Object.entries(CATALOGUE.cloche[2])) def[k] = v[1]; app.charger(genere("cloche", def)[0], "cloche.mdl"); });
  await p.click("#btn-son");
  await p.waitForTimeout(400);
  await p.keyboard.press("Space");
  await p.waitForTimeout(40);
  await capture("studio");

  // 2. corde pincee : reglages en calques
  await ev(() => app.charger(MODELES_PRETS.find(m => m.id === "corde-pincee").script(), "corde.mdl"));
  await p.click("#onglets button[data-onglet=reglages]");
  await p.waitForTimeout(300);
  await capture("reglages");

  // 3. mode Editer, sur une forme 3D
  await ev(() => { const def = {}; for (const [k, v] of Object.entries(CATALOGUE.donutcoupe[2])) def[k] = v[1]; app.charger(genere("donutcoupe", def)[0], "donut.mdl");
                   app.onglet("construire"); app.modeEdition(true); app.vue.choisir(Math.floor(app.desc.nbNoeuds / 3)); });
  await p.waitForTimeout(300);
  await capture("edition");
  await ev(() => app.modeEdition(false));

  // 4. export Max
  await ev(() => app.charger(MODELES_PRETS.find(m => m.id === "corde-pincee").script(), "corde.mdl"));
  await p.click("#onglets button[data-onglet=export]");
  await p.waitForTimeout(300);
  await capture("export");

  await b.close();
})();
