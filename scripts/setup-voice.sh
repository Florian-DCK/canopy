#!/usr/bin/env bash
# Installe le service voix de Canopy (macOS). Sortie lue par l'écran de setup : STEP n/total texte, puis DONE ou ERROR message.
# Usage : setup-voice.sh [dossier cible]   (défaut : ~/Library/Application Support/Canopy/voice)
set -euo pipefail
TOTAL=4
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-$HOME/Library/Application Support/Canopy/voice}"
fail() { echo "ERROR $*"; exit 1; }
trap 'fail "échec ligne $LINENO"' ERR

echo "STEP 1/$TOTAL Recherche de Python 3.10 ou plus"
PY=""
for c in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then PY="$c"; break; fi
done
[ -n "$PY" ] || fail "Python 3.10+ introuvable : brew install python@3.12"

echo "STEP 2/$TOTAL Création de l'environnement dans $TARGET"
mkdir -p "$TARGET"
[ -x "$TARGET/.venv-pocket/bin/python" ] || "$PY" -m venv "$TARGET/.venv-pocket"
VPY="$TARGET/.venv-pocket/bin/python"

echo "STEP 3/$TOTAL Installation des paquets (quelques minutes)"
"$VPY" -m pip install --quiet --upgrade pip
"$VPY" -m pip install --quiet -r "$HERE/../voice/requirements-mac.txt"

echo "STEP 4/$TOTAL Téléchargement des modèles"
"$VPY" - <<'PY'
import os, platform, sys
from huggingface_hub import hf_hub_download
from silero_vad import load_silero_vad
from pocket_tts import TTSModel
load_silero_vad()
hf_hub_download("pipecat-ai/smart-turn-v3", "smart-turn-v3.2-cpu.onnx")
TTSModel.load_model(language="french")
stt = os.environ.get("CANOPY_STT", "")
if not stt:
    stt = "mlx" if platform.machine() == "arm64" else "faster"
if stt == "mlx":
    import numpy as np, mlx_whisper
    mlx_whisper.transcribe(np.zeros(16000, dtype="float32"), path_or_hf_repo=os.environ.get("CANOPY_STT_MODEL") or "mlx-community/whisper-large-v3-turbo", language="fr")
else:
    from faster_whisper import WhisperModel
    WhisperModel(os.environ.get("CANOPY_STT_MODEL") or "small", device="cpu", compute_type="int8")
PY
echo "DONE"
