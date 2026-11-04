"""Service voix local de Canopy (mode voix, planches 25 et 28).

Lancé par Electron (src/main/voice.ts) avec le Python du banc d'essai (venv « pocket »).
Écoute en WebSocket sur 127.0.0.1 ; un seul client, la fenêtre de Canopy.

Client → service
  binaire : micro, float32 mono 16 kHz (blocs de 512 échantillons ; écho déjà retiré par Chromium)
  {"type": "say", "id": "...", "text": "..."}  : à lire (les phrases s'enchaînent dans l'ordre)
  {"type": "stop"}                              : couper la voix (interruption)
  {"type": "listen"}                            : le tour de Claude est fini, on réécoute
  {"type": "voice", "name": "ana"}              : changer de voix
Service → client
  {"type": "ready", "rate": 24000, "voice": "ana"}
  {"type": "speech", "on": true|false}          : tu parles / tu t'arrêtes (anime le logo)
  {"type": "partial", "text": "..."}            : transcription en cours
  {"type": "final", "text": "..."}              : fin de ton tour (≈ 1,4 s de silence)
  {"type": "barge"}                             : tu as repris la parole pendant que Claude parlait
  {"type": "say_start", "id": "..."} puis binaire float32 (rate) puis {"type": "say_end", "id": "..."}
"""
import asyncio
import json
import os
import queue
import re
import sys
import threading
import time

import numpy as np
import torch
import websockets
from pocket_tts import TTSModel
from silero_vad import VADIterator, load_silero_vad

SR = 16000
CHUNK = 512
TOKEN = os.environ.get("CANOPY_VOICE_TOKEN", "")
VOICE_DIR = os.environ.get("CANOPY_VOICE_DIR", "")  # dossier des échantillons clonés (xtts-<nom>.wav)
IDLE = float(os.environ.get("CANOPY_VOICE_IDLE", "900"))  # s’arrête seul après 15 min sans fenêtre connectée
clients = 0
last_seen = time.time()
MIN_SPEECH = float(os.environ.get("CANOPY_VOICE_MIN", "0.45"))  # en dessous : un bruit, pas une phrase
SHORT_GHOSTS = re.compile(r"^\W*(merci( beaucoup)?|au revoir|bonjour|ok|euh+|hm+|ah|oh|\.+)\W*$", re.I)
END_SILENCE = float(os.environ.get("CANOPY_VOICE_END", "1.0"))  # fin du tour : silence minimal (phrase qui se termine)
END_MAX = float(os.environ.get("CANOPY_VOICE_END_MAX", "2.6"))  # silence maximal quand la phrase semble inachevée
# Fin de phrase qui annonce une suite (hésitation, mot de liaison, article…) : on attend plus longtemps.
# Réglages modifiables depuis la page Paramètres de Canopy (message « config »).
CFG = {"threshold": 0.6, "end": END_SILENCE, "end_max": END_MAX}
UNFINISHED = re.compile(
    r"(\b(euh+|heu+|hum+|hm+|bah|ben|et|ou|mais|donc|alors|puis|enfin|du coup|parce que|parce qu|que|qu|qui|dont|de|du|des|le|la|les|l|un|une|au|aux|à|pour|avec|sans|sur|sous|dans|en|par|comme|si|quand|lorsque|c'est|il y a|je|j|tu|on|il|elle|nous|vous|ils|elles|mon|ma|mes|ton|ta|tes|son|sa|ses|ce|cet|cette|ces|très|plus|moins|genre|style|tu vois)|[,;:…\-]|\.\.\.)\W*$",
    re.I,
)


def log(msg: str):
    print(msg, flush=True)


log("LOADING")
vad_model = load_silero_vad()

import openvino_genai as ov  # noqa: E402
from huggingface_hub import hf_hub_download, snapshot_download  # noqa: E402

_pipe = ov.WhisperPipeline(snapshot_download("OpenVINO/whisper-large-v3-int8-ov"), "GPU")


# Phrases que Whisper invente sur un silence ou un bruit (génériques de sous-titres vus à l'entraînement).
GHOSTS = re.compile(
    r"sous-titr\w*[^.!?]*?(radio-canada|communaut\w* d'amara(\.org)?|amara(\.org)?)\s*[.!?]?"
    r"|merci d'avoir regard\w*[^.!?]*[.!?]?"
    r"|abonnez-vous[^.!?]*[.!?]?"
    r"|merci,? (madame|monsieur) (la |le )?pr[ée]sident\w*[.!?]?",
    re.I,
)


def transcribe(seg: np.ndarray) -> str:
    txt = str(_pipe.generate(seg.tolist(), language="<|fr|>", task="transcribe")).strip()
    return GHOSTS.sub("", txt).strip(" .")


transcribe(np.zeros(SR, dtype="float32"))  # échauffement
tts = TTSModel.load_model(language="french")

# Détecteur de fin de tour (Smart Turn v3.2 de Pipecat, BSD-2) : à partir des 8 dernières secondes d'audio, il dit si
# la phrase est finie (intonation, rythme), en ~20 ms sur le processeur. Sans lui, on retombe sur les silences.
try:
    import onnxruntime as ort
    from transformers import WhisperFeatureExtractor

    _turn = ort.InferenceSession(hf_hub_download("pipecat-ai/smart-turn-v3", "smart-turn-v3.2-cpu.onnx"), providers=["CPUExecutionProvider"])
    _feats = WhisperFeatureExtractor(chunk_length=8)

    def turn_done(audio: np.ndarray) -> float:
        a = audio[-8 * SR:]
        a = np.pad(a, (8 * SR - len(a), 0))  # complété au début, comme à l'entraînement
        f = _feats(a, sampling_rate=SR, return_tensors="np", do_normalize=True).input_features.astype(np.float32)
        return float(_turn.run(None, {"input_features": f})[0].reshape(-1)[0])

    turn_done(np.zeros(SR, dtype="float32"))
    log("smart-turn prêt")
except Exception as e:  # noqa: BLE001
    turn_done = None
    log(f"smart-turn indisponible : {e}")
_voices: dict = {}


def voice_state(name: str):
    if name not in _voices:
        path = os.path.join(VOICE_DIR, f"xtts-{name}.wav")
        _voices[name] = tts.get_state_for_audio_prompt(path if os.path.exists(path) else name)
    return _voices[name]


class Session:
    """Un client : écoute (VAD + Whisper par morceaux) et voix (Pocket TTS phrase par phrase)."""

    def __init__(self, ws, loop: asyncio.AbstractEventLoop, voice: str):
        self.ws, self.loop = ws, loop
        self.voice = voice
        self.mic: "queue.Queue[np.ndarray | None]" = queue.Queue()
        self.says: "queue.Queue[tuple[str, str] | None]" = queue.Queue()
        self.busy = threading.Event()  # tour de Claude en cours : on ne guette que l'interruption
        self.cut = threading.Event()  # couper la voix en cours
        self.alive = True

    def send(self, obj):
        data = obj if isinstance(obj, (bytes, bytearray)) else json.dumps(obj, ensure_ascii=False)
        asyncio.run_coroutine_threadsafe(self.ws.send(data), self.loop)

    # ---------- écoute ----------
    def listener(self):
        preroll: list[np.ndarray] = []
        while self.alive:
            if self.busy.is_set():
                preroll = self.watch_barge()
                continue
            self.one_turn(preroll)
            preroll = []

    def next_block(self, timeout=0.1):
        try:
            return self.mic.get(timeout=timeout)
        except queue.Empty:
            return None

    def one_turn(self, preroll: list[np.ndarray]):
        vad = VADIterator(vad_model, sampling_rate=SR, threshold=CFG["threshold"], min_silence_duration_ms=250)
        parts: list[str] = []
        jobs: "queue.Queue[np.ndarray | None]" = queue.Queue()

        working = [False]

        def worker():
            while (seg := jobs.get()) is not None:
                working[0] = True
                txt = transcribe(seg)
                working[0] = False
                if txt:
                    parts.append(txt)
                    self.send({"type": "partial", "text": " ".join(parts)})

        th = threading.Thread(target=worker, daemon=True)
        th.start()
        buf = list(preroll)
        heard_audio: list[np.ndarray] = list(preroll)
        judged = False  # le détecteur a déjà donné son avis pour ce silence
        silent_until = CFG["end_max"]
        talking, silent, total = bool(preroll), 0, 0
        if talking:
            self.send({"type": "speech", "on": True})
        while self.alive and not self.busy.is_set():
            block = self.next_block()
            if block is None:
                continue
            ev = vad(torch.from_numpy(block))
            if talking or total:
                heard_audio.append(block)
            if ev and "start" in ev:
                if not talking:
                    self.send({"type": "speech", "on": True})
                talking, silent, judged = True, 0, False
            if talking:
                buf.append(block)
            if ev and "end" in ev and talking:
                seg = np.concatenate(buf)
                total += len(seg)
                jobs.put(seg)
                buf, talking, silent = [], False, 0
                self.send({"type": "speech", "on": False})
                continue
            if not talking and total:
                silent += 1
                waited = silent * CHUNK / SR + 0.25  # + les 250 ms déjà comptées par la détection de voix
                pending = working[0] or not jobs.empty()
                unfinished = bool(UNFINISHED.search(" ".join(parts)))
                # Détecteur de fin de tour : avis rendu une fois par silence, dès 0,45 s. Phrase finie selon lui (et pas
                # d'hésitation en dernier mot) : on répond vite ; sinon on attend, jusqu'au plafond.
                if turn_done and not judged and waited >= 0.45:
                    judged = True
                    p_done = turn_done(np.concatenate(heard_audio))
                    log(f"fin de tour ? {p_done:.2f} ({waited:.2f} s de silence) : {' '.join(parts)[-60:]}")
                    # Très sûr que c'est fini : on répond vite. Sûr que non : on attend jusqu'au plafond. Entre les deux : l'attente normale.
                    silent_until = 0.6 if p_done >= 0.8 else CFG["end_max"] if p_done < 0.3 else CFG["end"]
                if turn_done and judged:
                    if waited >= CFG["end_max"] or (waited >= silent_until and not pending and not unfinished):
                        break
                elif waited >= CFG["end"]:
                    if waited >= CFG["end_max"] or (not pending and not unfinished):
                        break
        jobs.put(None)
        th.join()
        heard = " ".join(parts).strip()
        # Un bruit (porte, clavier, toux) : trop court pour être une phrase, ou une de ces formules que Whisper
        # invente sur du bruit (« Merci. »). On l'ignore au lieu de réveiller Claude.
        speech = total / SR
        # Un « Merci. » tout seul est le fantôme le plus courant de Whisper sur un bruit ou une musique, quelle que soit la durée.
        if speech < MIN_SPEECH or SHORT_GHOSTS.match(heard):
            if heard:
                log(f"ignoré ({speech:.1f} s) : {heard}")
            heard = ""
            self.send({"type": "partial", "text": ""})
        if not heard:
            self.send({"type": "noise"})  # pas une phrase : si Claude a été coupé par ça, il reprend
        if heard and self.alive and not self.busy.is_set():
            self.busy.set()  # le client renverra « listen » à la fin du tour de Claude
            self.send({"type": "final", "text": heard})

    def watch_barge(self) -> list[np.ndarray]:
        """Pendant le tour de Claude : une vraie reprise de parole (> 0,3 s) l'interrompt."""
        v = VADIterator(vad_model, sampling_rate=SR, threshold=0.8, min_silence_duration_ms=200)
        voiced, pre = 0, []
        while self.alive and self.busy.is_set():
            block = self.next_block()
            if block is None:
                continue
            ev = v(torch.from_numpy(block))
            if ev and "start" in ev:
                voiced, pre = 1, []
            if voiced:
                voiced += 1
                pre.append(block)
                if voiced * CHUNK / SR >= 0.3:
                    self.cut.set()
                    self.busy.clear()
                    self.send({"type": "barge"})
                    return pre
            if ev and "end" in ev:
                voiced = 0
        return []

    # ---------- voix ----------
    def speaker(self):
        while self.alive:
            job = self.says.get()
            if job is None:
                return
            sid, text = job
            if self.cut.is_set():
                continue
            self.send({"type": "say_start", "id": sid})
            for chunk in tts.generate_audio_stream(voice_state(self.voice), text):
                if self.cut.is_set() or not self.alive:
                    break
                self.send(chunk.numpy().astype("float32").tobytes())
            self.send({"type": "say_end", "id": sid})

    def stop_voice(self):
        self.cut.set()
        while not self.says.empty():
            try:
                self.says.get_nowait()
            except queue.Empty:
                break


async def handler(ws):
    path = getattr(getattr(ws, "request", None), "path", "") or getattr(ws, "path", "")
    if TOKEN and f"t={TOKEN}" not in path:
        await ws.close(4001, "jeton invalide")
        return
    global clients, last_seen
    clients += 1
    s = Session(ws, asyncio.get_running_loop(), os.environ.get("CANOPY_VOICE", "ana"))
    voice_state(s.voice)
    threading.Thread(target=s.listener, daemon=True).start()
    threading.Thread(target=s.speaker, daemon=True).start()
    await ws.send(json.dumps({"type": "ready", "rate": tts.sample_rate, "voice": s.voice}))
    try:
        async for msg in ws:
            if isinstance(msg, (bytes, bytearray)):
                s.mic.put(np.frombuffer(msg, dtype="float32").copy())
                continue
            m = json.loads(msg)
            t = m.get("type")
            if t == "say":
                s.cut.clear()
                s.says.put((str(m.get("id", "")), str(m.get("text", ""))))
            elif t == "stop":
                s.stop_voice()
            elif t == "config":
                for k in ("threshold", "end", "end_max"):
                    if isinstance(m.get(k), (int, float)):
                        CFG[k] = float(m[k])
                log(f"réglages : {CFG}")
            elif t == "busy":
                s.busy.set()  # Claude reprend après une fausse interruption : on ne guette que l'interruption
            elif t == "listen":
                s.busy.clear()
                while not s.mic.empty():  # ce que le micro a capté pendant la réponse ne compte pas
                    s.mic.get_nowait()
            elif t == "voice":
                s.voice = str(m.get("name", s.voice))
                await asyncio.to_thread(voice_state, s.voice)
    finally:
        clients -= 1
        last_seen = time.time()
        s.alive = False
        s.says.put(None)


async def main():
    async with websockets.serve(handler, "127.0.0.1", 0, max_size=None) as server:
        port = server.sockets[0].getsockname()[1]
        log(f"READY {port}")
        # Survit aux redémarrages de Canopy (modèles déjà chargés) ; s’éteint seul quand plus personne ne s’en sert.
        while clients or time.time() - last_seen < IDLE:
            await asyncio.sleep(10)
        log("IDLE EXIT")


if __name__ == "__main__":
    t0 = time.perf_counter()
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
