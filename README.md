# dataset412 — environnement mi-gen

Outils pour explorer et jouer avec **mi-gen**, la boîte à outils de synthèse
sonore par masses-interactions pour Max/MSP `gen~`
(https://github.com/mi-creative/mi-gen, James Leonard / GIPSA-Lab).

- `mi-gen-lib/` : les librairies `gen~` d'origine (`migen-lib`,
  `migen-integrated`, `migen-proxies`).
- `mims-studio/` : **mi-gen Studio**. On y construit des modèles (cordes,
  membranes, proxies, formes 3D, objets .obj/.stl importés au budget de la
  machine), on les joue en son temps réel, puis on les exporte en `.gendsp`
  pour Max. Ouvre `mims-studio/MIMS_Studio.html` dans un navigateur, rien à
  installer. Détails dans `mims-studio/README.md`.
- `motion-designer/` : **Motion Designer**, un spatialiseur de sons en
  mouvement (Doppler, distance, effets, LFO). On y choisit la sortie audio
  (carte son ou câble virtuel vers un DAW, en stéréo ou en multipiste) et on
  le pilote en MIDI depuis le DAW. Ouvre `motion-designer/Motion_Designer.html`,
  rien à installer. Détails dans `motion-designer/README.md`.
