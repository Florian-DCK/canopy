# Installer Canopy depuis le code source

Mac (Apple Silicon surtout) et Windows.

## Prérequis
- Node.js >= 22 et git
- Claude Code installé, puis `claude login` (Canopy utilise ta session Claude Code)

## Installation

### macOS
```
cd ~/Documents
git clone https://github.com/Florian-DCK/canopy.git && cd canopy
npm install
```
`npm install` prépare l'app **Canopy** (scripts/mac-app.mjs) : l'Electron du projet prend le nom, l'identifiant et l'icône de Canopy, démarre la version construite (pas de rechargements), et `~/Applications/Canopy.app` est créé. Ensuite : ouvrir **Canopy** (Spotlight, ou `~/Applications`), le glisser dans le Dock. Le setup s'ouvre au premier lancement.

Les autorisations (Micro, Enregistrement de l'écran, Accessibilité) se donnent à **Canopy** dans les Réglages. Lancé avec `npm run dev` depuis un terminal, macOS les demande pour le Terminal à la place.

### Windows
```
git clone https://github.com/Florian-DCK/canopy.git && cd canopy
npm install
node node_modules/electron/install.js   # si Electron n'a pas été téléchargé
npm run dev
```
Le setup propose de créer `Canopy.lnk` sur le Bureau.

## Mises à jour
Un bandeau « Mise à jour disponible » apparaît quand le dépôt a du nouveau : « Mettre à jour » fait `git pull`, `npm install` si besoin, reconstruit et relance (sur Mac). À la main : `git pull && npm install`.

## Corriger Canopy soi-même
Ouvrir une session Canopy sur le dossier `canopy`, demander à Claude. Pour voir le résultat : sur Mac, `npm run build` puis relancer Canopy (ou travailler avec `npm run dev`, qui recharge à chaud). Pousser sur une branche et ouvrir une pull request.

## Mode voix (optionnel)
Service Python local (Whisper, VAD, TTS) installé dans un venv `.venv-pocket`.
- macOS : `bash scripts/setup-voice.sh [dossier]` (défaut `~/Library/Application Support/Canopy/voice` ; Python >= 3.10, sinon `brew install python@3.12`)
- Windows : `powershell -File scripts\setup-voice.ps1 [dossier]` (défaut `~\Documents\voice-bench`)

Le script affiche `STEP n/total ...` puis `DONE` ou `ERROR ...`. Les téléchargements pèsent plusieurs Go.
Moteur de transcription : OpenVINO (GPU Intel) sous Windows, MLX sur Mac Apple Silicon, faster-whisper (CPU) en repli ; on peut forcer avec `CANOPY_STT=openvino|mlx|faster` et changer de modèle avec `CANOPY_STT_MODEL`.
Les voix clonées (`xtts-<nom>.wav` dans `CANOPY_VOICE_DIR`) sont facultatives : sans elles, une voix intégrée de Pocket TTS est utilisée.

## Autorisations macOS
Dans Réglages Système › Confidentialité et sécurité, pour **Canopy** :
- **Micro** : mode voix.
- **Enregistrement de l'écran** : captures que Claude peut regarder (relancer Canopy après).
- **Accessibilité** : le compagnon clique et écrit à ta place.

## Pas encore testé sur Mac
- Le service voix (MLX dans un thread de travail, faster-whisper, Pocket TTS sur CPU) et les scripts de setup.
- Les trois autorisations ci-dessus et les fonctions qui en dépendent (capture, contrôle clavier/souris).
- L'app Canopy préparée par scripts/mac-app.mjs (identité, signature ad hoc, lanceur) et la reconstruction après mise à jour.
