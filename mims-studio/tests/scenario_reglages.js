/* Calques de reglages, favoris, etats memorises, limite de stabilite,
 * options de jeu. Usage : node tests/scenario_reglages.js [dossier captures] */
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
  await ev(() => { tuto.fermer(); app.charger(MODELES_PRETS[4].script(), "cm.mdl"); app.onglet("reglages"); });
  await p.waitForTimeout(1500);                          // limites calculees en arriere-plan

  // 1. calques par objet
  const calques = await ev(() => [...document.querySelectorAll(".calque .entete b")].map(b => b.textContent));
  verif(calques.includes("@corde") && calques.includes("@table") && calques.some(t => /pince/.test(t)),
        `un calque par objet : ${calques.join(" · ")}`);
  const replie = await ev(() => { const t = document.querySelector(".calque .entete"); t.click(); return t.parentNode.classList.contains("ferme"); });
  verif(replie, "un clic sur l'en-tete replie le calque");
  await ev(() => document.querySelector(".calque.ferme .entete").click());

  // 2. zone rouge de stabilite sur la note de la corde
  const rouge = await ev(() => {
    const row = document.querySelector('.reglage[data-param="corde_hz"]');
    const z = row && row.querySelector(".rouge");
    return z && !z.hidden ? [z.style.left, row._limite.valeur] : null;
  });
  verif(rouge, `corde_hz : zone rouge a partir de ${rouge && rouge[0]} (limite estimee ${rouge && rouge[1].toFixed(0)} Hz)`);
  const libre = await ev(() => { app.changerParam("corde_hz", 2000); return app.modele.params.get("corde_hz").valeur; });
  verif(libre === 2000, "valeur libre au-dela de la limite (la zone rouge previent, sans bloquer)");
  await ev(() => app.changerParam("corde_hz", 110));

  // 3. favoris
  await ev(() => document.querySelector('.reglage[data-param="couplage_K"] .etoile').click());
  await p.waitForTimeout(150);
  const fav = await ev(() => [/^~favoris couplage_K$/m.test($("editeur").value), document.querySelector(".calque.favoris .reglage").dataset.param]);
  verif(fav[0] && fav[1] === "couplage_K", "étoile : favori épinglé en haut, ligne ~favoris dans le script");

  // 4. etats memorises
  await p.click("#btn-memoriser");
  await p.waitForTimeout(150);
  const etat = await ev(() => $("editeur").value.split("\n").find(l => l.startsWith("~etat ")));
  verif(etat && /corde_hz=110/.test(etat), `📸 : ${etat && etat.slice(0, 70)}…`);
  await ev(() => app.changerParam("corde_hz", 300));
  await ev(() => document.querySelector("#liste-etats .puce.etat span").click());
  await p.waitForTimeout(150);
  const rappel = await ev(() => [app.modele.params.get("corde_hz").valeur, document.querySelector('.reglage[data-param="corde_hz"] input[type=number]').value]);
  verif(rappel[0] === 110 && +rappel[1] === 110, "rappel de l'état : corde_hz revient à 110 (curseur compris)");
  const relu = await ev(() => parse($("editeur").value).etats.length);
  verif(relu === 1, "l'état est relu depuis le .mdl");
  await p.screenshot({ path: path.join(CAPT, "calques.png") });

  // 5. options de jeu
  await p.click("#btn-options");
  verif(await ev(() => !$("options-jeu").hidden), "⚙ ouvre les options de jeu");
  await p.screenshot({ path: path.join(CAPT, "options.png") });
  await ev(() => son.actif || app.basculeSon());
  await p.waitForTimeout(300);
  const coups = await ev(async () => {
    const vus = [];
    const orig = son.envoyer.bind(son);
    son.envoyer = d => { if (d.type === "frapper" || d.type === "pousser") vus.push(d); orig(d); };
    $("opt-alea").value = 80; $("opt-hasard").checked = true; $("opt-repeter").checked = true; $("opt-bpm").value = 600;
    $("opt-repeter").dispatchEvent(new Event("input"));
    await new Promise(r => setTimeout(r, 1100));
    $("opt-repeter").checked = false; $("opt-repeter").dispatchEvent(new Event("input"));
    son.envoyer = orig;
    return { n: vus.length, forces: new Set(vus.map(v => v.force.toFixed(3))).size, points: new Set(vus.map(v => v.i)).size };
  });
  verif(coups.n >= 8, `répétition à 600 BPM : ${coups.n} coups en 1,1 s`);
  verif(coups.forces > 3 && coups.points > 3, `force aléatoire (${coups.forces} forces différentes) et point au hasard (${coups.points} points)`);
  const fluid = await ev(() => {
    const n = new NoyauSon(44100, () => {});
    n.message({ type: "options", fluidite: 100, coupeBas: 80 });
    return [n.fluidite, n.hpHz];
  });
  verif(fluid[0] === 100 && fluid[1] === 80, "fluidité et coupe-bas transmis au moteur audio");
  const latence = await ev(async () => {
    $("opt-latence").value = "playback"; $("opt-latence").dispatchEvent(new Event("change"));
    await new Promise(r => setTimeout(r, 800));
    return [son.actif, son.ctx && son.ctx.state, son.latence];
  });
  verif(latence[0] && latence[1] === "running" && latence[2] === "playback", `latence haute : le son repart (${latence.join(", ")})`);
  await ev(() => { $("opt-latence").value = "interactive"; $("opt-latence").dispatchEvent(new Event("change")); });
  await p.waitForTimeout(500);

  verif(erreurs.length === 0, `aucune erreur JavaScript (${erreurs.join(" | ")})`);
  console.log(echecs ? `${echecs} ECHEC(S)` : "TOUT EST OK");
  await b.close();
  process.exit(echecs ? 1 : 0);
})();
