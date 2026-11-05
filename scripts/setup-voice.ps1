# Installe le service voix de Canopy (Windows). Sortie lue par l'écran de setup : STEP n/total texte, puis DONE ou ERROR message.
# Usage : setup-voice.ps1 [dossier cible]   (défaut : $HOME\Documents\voice-bench)
param([string]$Target = (Join-Path $HOME 'Documents\voice-bench'))
$ErrorActionPreference = 'Stop'
$Total = 4
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
try {
  Write-Output "STEP 1/$Total Recherche de Python 3.10 ou plus"
  $py = $null
  foreach ($c in @('py', 'python')) {
    if (Get-Command $c -ErrorAction SilentlyContinue) {
      & $c -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" 2>$null
      if ($LASTEXITCODE -eq 0) { $py = $c; break }
    }
  }
  if (-not $py) { throw "Python 3.10+ introuvable (winget install Python.Python.3.12)" }

  Write-Output "STEP 2/$Total Création de l'environnement dans $Target"
  New-Item -ItemType Directory -Force -Path $Target | Out-Null
  $vpy = Join-Path $Target '.venv-pocket\Scripts\python.exe'
  if (-not (Test-Path $vpy)) { & $py -m venv (Join-Path $Target '.venv-pocket'); if ($LASTEXITCODE) { throw "venv a échoué" } }

  Write-Output "STEP 3/$Total Installation des paquets (plusieurs Go, patience)"
  & $vpy -m pip install --quiet --upgrade pip
  & $vpy -m pip install --quiet -r (Join-Path $Here '..\voice\requirements-windows.txt')
  if ($LASTEXITCODE) { throw "pip install a échoué" }

  Write-Output "STEP 4/$Total Téléchargement des modèles"
  $code = @'
from huggingface_hub import hf_hub_download, snapshot_download
from silero_vad import load_silero_vad
from pocket_tts import TTSModel
load_silero_vad()
hf_hub_download("pipecat-ai/smart-turn-v3", "smart-turn-v3.2-cpu.onnx")
TTSModel.load_model(language="french")
snapshot_download("OpenVINO/whisper-large-v3-int8-ov")
'@
  & $vpy -c $code
  if ($LASTEXITCODE) { throw "téléchargement des modèles échoué" }
  Write-Output "DONE"
} catch {
  Write-Output "ERROR $($_.Exception.Message)"
  exit 1
}
