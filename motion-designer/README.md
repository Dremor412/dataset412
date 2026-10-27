# Motion Designer (local)

Spatialiseur de sons en mouvement, dans le navigateur, **entièrement en
local** : on place jusqu'à 20 sons autour d'un auditeur, on les déplace à la
souris, et on entend le Doppler, la distance, l'air et le panoramique suivre
le geste. Le son peut partir **sur la sortie audio de ton choix** (carte son,
interface, câble virtuel vers un DAW), et l'outil se pilote en **MIDI depuis
le DAW**.

Inspiré du « Motion Designer » d'AiSHA Sound, réécrit de zéro, sans
dépendance ni connexion.

## Lancer

- **Le plus simple** : double-clic sur `Motion_Designer.html` (Chrome ou Edge
  conseillés).
- **Pour le MIDI et le choix de sortie** : lance `Motion_Designer.command`
  (macOS / Linux, `chmod +x` une fois) ou `Motion_Designer.bat` (Windows).
  Ça ouvre la page sur `http://localhost:8412`, où le navigateur autorise
  toujours le MIDI et le choix du périphérique. Python 3 est requis, sans
  rien installer d'autre.

| Fonction                       | Chrome / Edge | Firefox            | Safari |
|--------------------------------|---------------|--------------------|--------|
| Spatialisation, effets, WAV    | oui           | oui                | oui    |
| Choisir la sortie audio        | oui           | oui (≥ 116, repli) | non    |
| Sortie multipiste (DAW)        | oui           | non                | non    |
| MIDI (notes, CC, Start/Stop)   | oui           | oui (≥ 108)        | non    |

## Ce que ça fait

- **Sources** (jusqu'à 20 fichiers WAV, MP3, OGG, FLAC, AIFF…, par bouton ou
  glisser-déposer)
  - Région de lecture et marqueur de départ sur la forme d'onde.
  - Modes : une fois, boucle, aller-retour, déclenchement périodique.
  - Volume, enveloppe ADSR, muet / solo, remplacer le fichier.
  - **Effets de piste** : hauteur, filtre, saturation, flanger, chorus, écho,
    réverbération. L'ordre se change en glissant la poignée ⠿, et chaque
    réglage a son **LFO** (sinus, triangle, carré, aléatoire tenu).
- **Champ spatial**
  - On attrape une source ou l'auditeur : le son joue tant qu'on tient.
  - Ctrl/Cmd + clic pour grouper.
  - Réglages : Doppler (0–200 %), lissage du mouvement et du panoramique,
    distance (niveau + perte d'aigus dans l'air), portée audible.
- **Master** : filtre, saturation, écho, réverbération, compresseur, hauteur,
  volume, vu-mètres.
- **Connecteurs** : clic droit sur n'importe quel réglage, puis « Vitesse »
  ou « Position X / Y ». Le réglage suit alors le mouvement.
- **Enregistrer / Exporter** en WAV 16, 24 ou 32 bits flottant. Au choix,
  chaque source aussi en fichier séparé (stems).
- **Presets** en `.motion.json`, avec ou sans l'audio dedans.
- **Annuler / rétablir** (Ctrl/Cmd+Z, Ctrl/Cmd+Maj+Z).

## Brancher sur un DAW

### Par l'audio : bouton « Sortie audio »

1. Installe un câble audio virtuel :
   - **BlackHole** sur macOS ;
   - **VB-Audio Cable** ou **VoiceMeeter** sur Windows ;
   - **PipeWire** ou **JACK** sur Linux.
2. Choisis ce câble comme périphérique de sortie dans Motion Designer.
3. Dans le DAW (Ableton, Logic, Reaper, FL Studio, Cubase, Bitwig…), prends
   ce câble comme entrée audio et arme une piste.

**Mode multipiste** : si la sortie a au moins 4 canaux (BlackHole 16ch,
carte multicanal, Loopback…), le mix part sur 1-2 et chaque source
spatialisée sur sa propre paire (3-4, 5-6…). Dans le DAW, une piste par
paire. La fenêtre affiche la correspondance.

On y règle aussi la latence (faible, équilibrée, confort) et la fréquence
d'échantillonnage (44,1 à 96 kHz).

### Par le MIDI : bouton « MIDI / DAW »

D'abord, crée un port MIDI virtuel :

- **macOS** : Gestionnaire IAC, dans Configuration audio et MIDI.
- **Windows** : loopMIDI.
- **Linux** : les ports ALSA ou PipeWire apparaissent directement.

Ce que l'outil **reçoit** du DAW :

- **Notes** : la 1re note (C1 = 36 par défaut) joue la source 1, la suivante
  la source 2, etc. Relâcher la note arrête la source, ou chaque note fait
  marche / arrêt (au choix).
- **CC** : clic droit sur un curseur, ou sur une source du champ pour sa
  position X / Y, puis « Apprendre un CC ». Bouge ensuite le contrôleur, ou
  envoie un CC depuis le DAW.
- **Start / Stop** du DAW : lance et arrête toutes les sources, et au choix
  l'enregistrement.

Ce que l'outil **envoie** au DAW, pour enregistrer le mouvement comme
automation :

- Les positions en CC : source *n* sur CC `20 + 2(n-1)` (X) et CC
  `21 + 2(n-1)` (Y), l'auditeur sur CC 102 / 103, la vitesse sur CC 104.
  Le canal et le 1er CC se règlent.
- Une note par source quand elle joue.

## Développement

Les sources sont dans `src/` (`index.html`, `style.css`, `js/NN-*.js`).
`node build.js` les assemble dans `Motion_Designer.html`, le fichier qu'on
ouvre. Le test de bout en bout pilote l'interface avec Playwright, avec un faux
port MIDI :

```
node build.js
node tests/scenario.js
```
