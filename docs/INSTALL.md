# Installer Canopy depuis le code source

Mac (Apple Silicon surtout) et Windows.

## Prérequis
- Node.js >= 22 et git
- Claude Code installé, puis `claude login` (Canopy utilise ta session Claude Code)

## Installation
```
git clone <dépôt> && cd Atelier
npm install
node node_modules/electron/install.js   # piège : le binaire Electron n'est parfois pas téléchargé par npm install
npm run dev
```

## Lancer Canopy ensuite

Au premier lancement, le setup propose (dernière étape) de créer un raccourci : `~/Applications/Canopy.app` sur Mac (à glisser dans le Dock), `Canopy.lnk` sur le Bureau sous Windows. Il lance `npm run dev` sans terminal. Aussi disponible dans Paramètres › Installation. Un raccourci existant n'est jamais remplacé.

## Mode voix (optionnel)
Service Python local (Whisper, VAD, TTS) installé dans un venv `.venv-pocket`.
- macOS : `bash scripts/setup-voice.sh [dossier]` (défaut `~/Library/Application Support/Canopy/voice` ; Python >= 3.10, sinon `brew install python@3.12`)
- Windows : `powershell -File scripts\setup-voice.ps1 [dossier]` (défaut `~\Documents\voice-bench`)

Le script affiche `STEP n/total ...` puis `DONE` ou `ERROR ...`. Les téléchargements pèsent plusieurs Go.
Moteur de transcription : OpenVINO (GPU Intel) sous Windows, MLX sur Mac Apple Silicon, faster-whisper (CPU) en repli ; on peut forcer avec `CANOPY_STT=openvino|mlx|faster` et changer de modèle avec `CANOPY_STT_MODEL`.
Les voix clonées (`xtts-<nom>.wav` dans `CANOPY_VOICE_DIR`) sont facultatives : sans elles, une voix intégrée de Pocket TTS est utilisée.

## Autorisations macOS
À accorder dans Réglages Système > Confidentialité et sécurité :
- **Micro** : mode voix (dictée et conversation).
- **Enregistrement de l'écran** : captures d'écran que Claude peut regarder.
- **Accessibilité** : piloter le clavier et la souris (outils de contrôle de l'ordinateur).

## Pas encore testé sur Mac
- Le service voix (MLX dans un thread de travail, faster-whisper, Pocket TTS sur CPU) et les scripts de setup.
- Les trois autorisations ci-dessus et les fonctions qui en dépendent (capture, contrôle clavier/souris).
- Le lanceur de développement et l'empaquetage (conçus pour Windows).
