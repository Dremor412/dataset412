# dataset412 — environnement mi-gen

Outils pour explorer et jouer avec **mi-gen**, la boîte à outils de synthèse
sonore par masses-interactions pour Max/MSP `gen~`
(https://github.com/mi-creative/mi-gen, James Leonard / GIPSA-Lab).

- `mi-gen-lib/` : les librairies `gen~` d'origine (`migen-lib`,
  `migen-integrated`, `migen-proxies`), plus **`migen-plus`** : flexion,
  plaque, objets modaux, choc de Hunt-Crossley, frottement de Stribeck. Voir
  `mi-gen-lib/MIGEN-PLUS.md`.
- `mims-studio/` : **mi-gen Studio**. On y construit des modèles (cordes,
  membranes, proxies, formes 3D, objets .obj/.stl importés au budget de la
  machine), on les joue en son temps réel, puis on les exporte en `.gendsp`
  pour Max. Ouvre `mims-studio/MIMS_Studio.html` dans un navigateur, rien à
  installer. Détails dans `mims-studio/README.md`.
