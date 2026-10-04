# mi-gen Studio

Atelier de création pour **mi-gen** (synthèse sonore par masses-interactions
pour Max/MSP `gen~`) : on construit, on joue et on entend dans le navigateur,
puis on exporte vers Max.

**Un seul fichier, rien à installer** : ouvre `MIMS_Studio.html` dans Chrome,
Edge, Firefox ou Safari. Tout tourne en local.

## Ce que ça fait

- **Construire**
  - Des modèles prêts à jouer : corde pincée, corde frottée (archet), corde au
    marteau, membrane, corde couplée à une membrane, oscillateurs.
  - 13 formes 3D paramétriques.
  - Des briques à ajouter en un clic : corde, corde raide, chaîne, membrane
    (structures intégrées mi-gen), oscillateur, masse, point fixe.
  - Clique un point dans la vue 3D : l'inspecteur propose **Frapper**,
    **Pincer**, **Frotter**, **Coup de force**, **Écouter**, **Supprimer**.
    Maj+clic sur un 2e point : **Relier**. Sur une corde ou une membrane, le
    point devient un **proxy** mi-gen, et un curseur permet ensuite de le
    déplacer.
- **Importer un objet 3D** (`.obj`, `.stl` texte ou binaire)
  - Les sommets en double sont soudés et le maillage est simplifié pour
    **tenir dans le budget de ta machine**.
  - Les morceaux séparés sont reliés entre eux, et un squelette connexe est
    gardé quand on plafonne les ressorts.
  - Au choix : axe vertical, taille et points de fixation (base, sommet ou
    aucun). Un aperçu en direct donne le nombre de masses, de ressorts et la
    charge CPU.
- **Jouer**
  - **Son temps réel** : un pas de calcul par échantillon, comme `gen~`. Le
    calcul tourne dans un AudioWorklet, avec un volume automatique.
  - **Bille jaune** à attraper à la souris (contact, pincement).
  - **Archet** entraîné avec un curseur de vitesse.
  - **Frapper** avec la barre espace.
  - **Réglages** : chaque `@param` devient un curseur qui agit pendant que ça
    joue, sans coupure, et sa valeur est recopiée dans le script.
- **Budget matériel** : au démarrage, le studio mesure le coût réel d'une masse
  et d'une liaison sur ta machine. La jauge en bas indique la charge du son
  (mesurée dans le fil audio quand le son tourne). Au-delà de 100 %, le son
  décroche.
- **Export Max**
  - Le `.gendsp` est prêt pour `[gen~]`. Il est produit par le **générateur
    officiel MIMS4Max**, inclus dans la page.
  - Le `.mdl` exporté s'ouvre aussi dans MIMS4Max.
  - Les fichiers `.mdl` de mi-gen s'ouvrent ici tels quels.

## Format des fichiers

C'est la syntaxe **MIMS4Max**. Un même fichier s'ouvre ici et dans Max :

    @corde string 60 1. corde_K corde_Z corde_Zo 0. 0.     # structure intégrée
    @in1 posInput 0.
    @pince nlPluck [@corde pince_pos] @in1 0.5 0.1 0.001    # proxy sur la corde
    @out1 posOutput [@corde 0.8]
    @peau closedMesh 16 16 1. K Z Zo 0. 0.
    @choc contact [@peau 0.4 0.35] @in2 0.1 0.002 -3        # proxy sur la membrane

La géométrie 3D est **purement visuelle**. Elle est rangée dans des lignes `~`,
que MIMS4Max ignore :

    ~pos @in1 -5.5 0 0                 # position d'une masse / entrée
    ~place @corde -12 0 0 12 0 0       # extrémités d'une corde, coins d'une membrane

La physique est exactement celle de mi-gen. La position d'un point est un
déplacement, et on le dessine à la hauteur `~pos + déplacement`. Pour qu'une
bille posée 3 unités au-dessus d'un objet le touche en descendant, son contact
a un seuil de `-3`. Les générateurs le calculent tout seuls.

**Accroche et sol.** Les formes 3D et les objets importés sont accrochés par
leurs **deux extrémités** : les deux points les plus éloignés en suivant la
structure (les deux bouts du donut coupé, le début et la fin de la spirale,
deux points opposés d'un anneau). La cloche pend par sa couronne et l'arbre
tient par son pied. Ils sont aussi posés sur un **sol** : un point fixe
`@..._sol ground 0.` et un contact par masse, avec pour seuil la hauteur de la
masse. Aucune masse ne passe ainsi sous le plan z = 0, ni à la frappe ni sous
la bille. Ce sont de vrais éléments mi-gen, donc le comportement est le même
dans Max. Les contacts avec le sol ne sont pas dessinés, et la vue n'affiche
rien sous le plan, même avec l'amplification. Raideur et amortissement du
sol : `@..._solK` et `@..._solZ`.

L'ancien format du studio, avec les positions `[x y z]` dans la ligne de
masse, est encore lu. À l'export vers Max, il est converti et les seuils de
contact sont recalculés.

## Organisation

    MIMS_Studio.html        le studio (fichier généré : ne pas éditer)
    build.js                assemble src/ -> MIMS_Studio.html   (node build.js)
    src/
      index.html, style.css
      js/01-modele.js       analyse des scripts (syntaxe MIMS4Max + ~pos/~place)
      js/10-simulateur.js   moteur mi-gen : compilation, structures intégrées, proxies
      js/20-son.js          son temps réel (AudioWorklet)
      js/25-budget.js       mesure de la machine, charge CPU, tailles maximales
      js/30-formes.js       13 formes 3D paramétriques
      js/35-import3d.js     import .obj / .stl, simplification au budget
      js/36-modeles.js      modèles prêts à jouer, briques, actions de l'inspecteur
      js/40-vue3d.js        vue 3D (canvas)
      js/60-export.js       conversion MIMS4Max + appel du générateur officiel
      js/70-app.js          interface
      vendor/mims4max/      générateur officiel MIMS4Max (mi-gen, GPL v3), non modifié
    tests/
      scenario_ui.js        pilote toute l'interface dans Chromium (Playwright)
      exemples_officiels.js compare l'export aux sorties de MIMS4Max sur les exemples mi-gen
      fichiers/             objets 3D et ancien format pour les tests

Tests (Node + Playwright) :

    node build.js
    node tests/scenario_ui.js
    node tests/exemples_officiels.js <chemin vers un clone de mi-gen>

## Version Python (ancienne)

`MIMS_Studio.py` et `studio/` sont la version 0.1 (tkinter + numpy). Elle
contient la correction des points de fixation, mais pas les nouveautés
ci-dessus. La version à utiliser est le HTML.

## Licence

`src/vendor/mims4max` provient de mi-gen (James Leonard), sous licence GNU GPL
v3. Le fichier `MIMS_Studio.html`, qui l'inclut, est donc à diffuser selon les
termes de la GPL v3.
