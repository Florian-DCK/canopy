#!/bin/zsh -l
# Lance Canopy en mode dev sur macOS (équivalent de atelier-dev.vbs) : rechargement à chaud, redémarrage auto d'Electron.
# Appelé par ~/Applications/Canopy.app (créée par le setup). Shell de connexion (-l) : PATH de Homebrew et nvm.
cd "$(dirname "$0")/.." || exit 1
unset ANTHROPIC_API_KEY
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
# Journal : dev.log (dev-2.log si le premier est verrouillé, comme sous Windows ; ici on écrase simplement).
exec npx electron-vite dev -w > dev.log 2>&1
