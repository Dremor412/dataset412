# MIMS Studio

Remplacement local et stable de l'outil web « MIMS online » (mi-creative) :
visualiseur / éditeur / simulateur de modèles physiques masse-interaction,
en pur Python (tkinter + numpy, rien d'autre à installer).

## Lancer

Double-clique `MIMS_Studio.bat` — ou en console :

    python MIMS_Studio.py

## Version navigateur (macOS sans Python / tkinter)

`MIMS_Studio.html` est un portage complet en un seul fichier HTML :
même parseur, même moteur physique (vérifié identique à 15 chiffres
près), mêmes 13 générateurs, même import OBJ. **Aucune installation** :
envoie juste ce fichier (AirDrop, mail...) et double-clique dessus —
il s'ouvre dans Safari ou Chrome, tout tourne en local dans la page.

Seules différences : « Enregistrer » télécharge le `.mdl` dans le
dossier Téléchargements (un navigateur ne peut pas réécrire un fichier
sur place), et le menu Exemples régénère les formes au lieu de lire le
dossier `mims-formes-3d`. C'est la solution pour les Mac récents
(Sequoia et suivants) dont le `python3` d'Apple n'inclut pas tkinter.

## Ce que ça fait

- **Éditeur de scripts MIMS** (dialecte du site : masses avec positions 3D
  `[x y z]`) avec compilation automatique et **messages d'erreur précis avec
  numéro de ligne** (double-clic sur une erreur = aller à la ligne).
- **Vue 3D** : orbite (glisser gauche), zoom (molette), déplacement
  (glisser droit), recadrage (double-clic), sélection d'une bille (clic).
  Couleurs : bleu = masse, rouge = point fixe, jaune = posInput,
  cercle vert = sortie écoutée, orange pointillé = contact, violet = archet.
- **Simulation physique animée** : bouton *Simuler*, puis *Frapper* pour
  donner une impulsion à la bille sélectionnée. Curseurs *vitesse*
  (pas de calcul par image) et *amplification* (exagération visuelle du
  mouvement). Le moteur est un portage fidèle de celui du site
  (schéma saute-mouton, mêmes formules, y compris contacts et archets
  non linéaires). Garde-fou anti-explosion intégré.
- **Menu Générer** : 13 formes paramétriques (boîte, sphère, tore debout,
  cloche, grosse caisse, donut coupé, colimaçon, orgue de Fibonacci,
  ruban de Möbius, sablier, arbre binaire...).
- **Menu Importer** : convertit un modèle 3D `.obj` (Blender...) en réseau
  masses-ressorts, avec simplification (« masses visées » et « plafond
  ressorts ») qui garantit un objet d'un seul tenant.
- **Menu Exemples** : ouvre directement les `.mdl` du dossier
  `mims-formes-3d` voisin.

## Organisation du code

    MIMS_Studio.py          lanceur
    studio/
      model.py              structures (Masse, Interaction, Modele)
      parser_mdl.py         analyse des scripts .mdl (erreurs par ligne)
      view3d.py             vue 3D tkinter (projection, orbite, rendu)
      simulator.py          physique numpy (portage du moteur du site)
      generators.py         catalogue des formes + import OBJ
      _source_formes.py     compilateur de formes (copie de forme2mims)
      ui_main.py            fenêtre principale, menus, dialogues

## Idées pour la suite (non fait)

- Sortie **audio** temps réel des masses `posOutput` (le site le faisait) —
  demande un module audio (sounddevice) et une simulation à 44,1 kHz.
- Glisser la bille `posInput` à la souris pendant la simulation.
- Édition graphique : ajouter/relier des masses à la souris.
- Export du réseau vers le format MIMS4Max (gen~) de Max/MSP.
