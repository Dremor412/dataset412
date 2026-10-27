# migen-plus : repenser mi-gen sans l'alourdir

`migen-plus.genexpr` est une librairie **en plus** de mi-gen. Elle ne remplace
rien. Elle garde le même format de données (`Data m(3)` = position, position
précédente, force) : ses fonctions se mélangent donc librement avec celles de
`migen-lib`, `migen-integrated` et `migen-proxies` dans le même codebox gen~.

L'idée de départ reste celle de mi-gen : des masses, des interactions, un pas
de calcul par échantillon. Je n'ai gardé que ce qui change vraiment le son pour
un coût raisonnable dans Max.

## Ce qui est ajouté, et pourquoi

### 1. Corde / barre avec vraie flexion — `compute_bend_string`

Dans mi-gen, la « corde raide » (`stiffString`) relie chaque masse à sa
deuxième voisine par un ressort. C'est encore une *tension* (un opérateur
d'ordre 2) : les harmoniques restent presque justes. Une vraie corde de piano,
une barre ou une cloche ont une **raideur de flexion** (ordre 4) : les partiels
montent de plus en plus au-dessus des multiples entiers. C'est ce qui donne le
timbre métallique ou cristallin.

- **Flexion** : énergie `Kb/2 · Σ courbure²`, avec courbure = `u(i-1) − 2u(i) + u(i+1)`
  (nulle aux bouts). C'est la forme qui conserve l'énergie : le calcul reste
  stable tant que `K + 4·Kb < M`.
- **Modulation de tension** (`tmod`, modèle de Kirchhoff-Carrier) : la tension
  augmente avec l'allongement moyen. Jouée fort, la note monte puis redescend
  en s'éteignant, comme une vraie corde ou un tom. C'est une seule somme par
  échantillon.
- **Bouts libres** (`libre = 1`) : une barre de xylophone ou de glockenspiel.
- Vérifié contre la théorie : les fréquences des modes 1, 2, 5 et 9 tombent
  exactement sur `2·asin(√λ/2)`, avec `λ = 4K·s² + 16Kb·s⁴`.

### 2. Plaque — `compute_plate`

Une membrane avec épaisseur : tension (`K`), flexion (`Kb`, laplacien de la
courbure) et modulation de tension (`tmod`, effet de gong). Bords libres,
fixes, ou tenue au centre (gong suspendu).

### 3. Objet modal — `compute_modal` (le gain le plus important)

C'est la technique des moteurs de son 3D récents (synthèse modale des objets
rigides, comme dans les jeux ou le cinéma). Un objet **linéaire** (corde,
cloche, objet 3D importé…) vibre comme une somme de **modes**. Chaque mode
oscille seul à sa fréquence et s'éteint à son rythme. Le studio calcule ces
modes **une fois** (diagonalisation de la matrice de raideur). Dans Max, on ne
calcule plus que les modes :

- **léger** : la cloche (144 masses, 449 liaisons) devient 40 modes. Le code
  gen~ fait 248 lignes au lieu de 1 293, et le calcul est environ 6 fois plus
  rapide (mesuré sur le code exporté, traduit en JS).
- **stable à toutes les fréquences** : chaque mode est un résonateur exact
  (`A = 2r·cos ω`, `B = −r²`). Une barre trop raide pour des masses (elles
  exploseraient) est parfaitement stable en modal.
- **fidèle** : avec tous ses modes, il reproduit le réseau masses-ressorts à
  0,5 % près (cet écart résiduel vient de l'amortissement minimal par défaut).
  Avec 40 modes, le spectre sous le dernier mode gardé est corrélé à 98,5 %
  avec l'original. Seuls les aigus au-delà sont coupés.
- **réglable en jouant** : `hauteur` (toutes les fréquences), `t60` (durée du
  mode grave), `brillance` (les aigus s'éteignent plus vite).
- **interactions inchangées** : on frappe, pince, frotte ou écoute un point de
  l'objet modal comme avant. Les proxies modaux (`set_proxy_pos_modal`,
  `_corde`, `_grille`) projettent sur les modes, et un point peut glisser le
  long d'une corde ou d'une plaque modale.

Limite : un objet modal est linéaire. La modulation de tension et les contacts
avec le sol de chaque masse sont abandonnés. Les interactions non linéaires
*avec* l'objet (chocs, pincements, archet) restent possibles : c'est
l'architecture classique « modes + interactions non linéaires » (comme
Modalys).

### 4. Choc de Hunt-Crossley — `compute_contact_hc`

`F = d^α · (K + Z·v)` pendant le contact, jamais négative. Deux gains
physiques :

- **pas de clic au contact** : avec le `contact` de mi-gen, le terme
  d'amortissement fait sauter la force dès le premier échantillon de contact.
  Ici, la force part de zéro.
- **dureté réaliste** : `α = 1,5` pour une bille (Hertz), `α = 2-3` pour le
  feutre d'un marteau de piano. Plus on frappe fort, plus le choc est bref,
  donc brillant.

### 5. Frottement de Stribeck — `compute_friction`

`F = Fn · μ(v) · tanh(v/ve)`, avec `μ(v) = μd + (μs − μd)·e^(−|v|/vs)`. On règle
une **pression** (`Fn`), un frottement statique et un frottement dynamique :
l'accroche-glisse d'un archet ou d'un doigt mouillé sur un verre, avec des
paramètres qui ont un sens physique.

## Paramètres physiques plutôt qu'abstraits

Dans le studio, les briques **Corde réelle** et **Barre (xylophone)** se
règlent par le matériau (densité, module d'Young), la longueur, le diamètre
ou l'épaisseur et la tension. `K`, `Kb` et l'amortissement en découlent par
des expressions gen~, donc ces paramètres restent réglables en direct dans
Max :

- corde : `c = √(T/μ)`, `μ = ρ·π·d²/4`, `K = (c·N/(L·44100))²`,
  `Kb = E·d²/(16ρ) · (N/L)⁴ / 44100²` ;
- barre : `Kb = E·h²/(12ρ) · (N/L)⁴ / 44100²`, toujours en modal (une barre
  réelle est bien trop raide pour des masses) ;
- durée : `Zo = 13,82 / (t60 · 44100)`.

## Dans Max

1. Copier `migen-plus.genexpr` à côté de `migen-lib.genexpr` (dossier `code`
   du package mi-gen).
2. Exporter depuis le studio (onglet Max) : le `.gendsp` contient déjà
   `require("migen-plus");` et le bon code.
3. Pour un objet modal, les fréquences et les déformées utiles sont écrites
   dans le bloc d'initialisation du code : il n'y a pas de fichier à charger.

**À vérifier dans Max.** Je n'ai pas Max sous la main. Le code a été validé
autrement : `mims-studio/tests/genexpr.js` traduit le genexpr en JavaScript.
Avec lui, le code gen~ exporté, exécuté avec les vraies librairies `.genexpr`
(mi-gen et migen-plus), donne **exactement** la même sortie que le studio
(écart ≤ 1e-12) sur 11 modèles, dont 4 modaux. Cela prouve la logique, pas la
syntaxe exacte de gen~ : signale-moi la moindre erreur de compilation dans Max.

## Ce que j'ai écarté, et pourquoi

- **XPBD, intégration implicite** (moteurs physiques des jeux) : stables, mais
  ils ajoutent un amortissement numérique et faussent les fréquences. C'est
  bien pour l'image, mauvais pour le son. L'objet modal apporte la stabilité
  sans ce défaut.
- **Éléments finis 3D (tétraèdres), déplacements en 3D** : beaucoup plus
  lourds dans gen~ (3 fois plus d'inconnues), pour un gain sonore modeste dans
  le cadre « un point = une hauteur » de mi-gen.
- **Modes non linéaires** (gong ou cymbale en modal) : possibles en couplant
  les modes entre eux, mais le coût grimpe vite. Le gong reste en plaque
  « masses » avec `tmod`.

## Pistes pour la suite

- **Correction statique** des modes tronqués : garder la raideur au point de
  frappe malgré les aigus coupés.
- **Frottement élasto-plastique** (LuGre) : un archet encore plus réaliste à
  très faible vitesse.
- **Rayonnement** : filtrer chaque mode selon sa direction d'émission, comme
  le « transfert acoustique » des moteurs de son 3D.
- **Matériaux prédéfinis pour l'amortissement** (bois, métal, verre) : un
  amortissement de Rayleigh par matériau.
