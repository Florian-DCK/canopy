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
  {"type": "say_start", "id": "..."} puis binaire float32 (rate) puis {"type": "say_end", "id": "..."}"""
import asyncio
import json
import os
import platform
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
LIVE_EVERY = float(os.environ.get("CANOPY_VOICE_LIVE", "0.9"))  # s entre deux relectures en direct (0 : désactivé)
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

# ---------- Reconnaître ta voix (empreinte vocale) ----------
# Modèle d'empreinte (sherpa-onnx, sans PyTorch) : chaque phrase entendue est comparée à ton empreinte, apprise
# une fois (six phrases) puis affinée au fil des conversations. « only_me » : on ignore ce qui ne te ressemble pas
# (vidéos, autres voix). Désactivé sans le modèle ou sans empreinte.
HOME = os.environ.get("CANOPY_VOICE_HOME", os.path.dirname(VOICE_DIR) if VOICE_DIR else "")
SPK_MODEL = os.environ.get("CANOPY_VOICE_SPK_MODEL", os.path.join(HOME, "models", "wespeaker_en_voxceleb_resnet34_LM.onnx"))
PROFILE = os.path.join(HOME, "speaker-profile.npy")
CFG.update({"only_me": False, "me_min": 0.45})
USE_VOXLOCK = os.environ.get("CANOPY_VOICE_VOXLOCK_ON") == "1"  # gain mesuré trop faible pour 0,3 à 2,3 s d’attente : coupé par défaut
ADAPT = os.environ.get("CANOPY_VOICE_ADAPT") == "1"  # empreinte qui s’affine seule : coupée par défaut (dérive vers une vidéo)
speaker_ex = None
try:
    if os.path.exists(SPK_MODEL):
        import sherpa_onnx  # noqa: E402

        speaker_ex = sherpa_onnx.SpeakerEmbeddingExtractor(sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=SPK_MODEL, num_threads=2))
except Exception as e:  # le reste du service marche sans
    log(f"empreinte vocale indisponible : {e}")
profile = np.load(PROFILE) if speaker_ex and os.path.exists(PROFILE) else None


def embed(seg):
    """Empreinte normalisée d'un morceau de voix (None si trop court ou modèle absent)."""
    if speaker_ex is None or len(seg) < SR * 0.4:
        return None
    st = speaker_ex.create_stream()
    st.accept_waveform(SR, seg.astype(np.float32))
    st.input_finished()
    e = np.array(speaker_ex.compute(st), dtype=np.float32)
    n = np.linalg.norm(e)
    return e / n if n else None


def me_score(seg):
    """Ressemblance avec ton empreinte (cosinus : élevé pour toi, proche de 0 pour une autre voix), ou None."""
    if profile is None:
        return None
    e = embed(seg)
    return None if e is None else float(np.dot(e, profile))


def me_threshold(seconds):
    # Phrase très courte (« oui », « stop ») : empreinte moins sûre, seuil un peu plus bas.
    return CFG["me_min"] - (0.08 if seconds < 1.0 else 0.0)


VOXLOCK_DIR = os.environ.get("CANOPY_VOICE_VOXLOCK", os.path.join(HOME, "models", "sherpa-onnx-voxlock-int8"))
SAMPLE = os.path.join(HOME, "speaker-sample.wav")
voxlock = None


def load_voxlock():
    """VoxLock garde ta voix et retire les autres (même simultanées). Lent (~0,6 s par seconde de parole) :
    il ne sert que pour une phrase mélangée. Reconstruit après chaque apprentissage (il lit ton enregistrement)."""
    global voxlock
    voxlock = None
    enroll, chunk = os.path.join(VOXLOCK_DIR, "enroll.onnx"), os.path.join(VOXLOCK_DIR, "chunk_int8.onnx")
    if speaker_ex is None or not (os.path.exists(enroll) and os.path.exists(chunk) and os.path.exists(SAMPLE)):
        return
    try:
        cfg = sherpa_onnx.OfflineSpeechDenoiserConfig(
            model=sherpa_onnx.OfflineSpeechDenoiserModelConfig(
                voxlock=sherpa_onnx.OfflineSpeechDenoiserVoxLockModelConfig(enroll_model=enroll, chunk_model=chunk, voice_sample=SAMPLE),
                num_threads=4,
            )
        )
        voxlock = sherpa_onnx.OfflineSpeechDenoiser(cfg)
        log("VoxLock prêt (séparation de ta voix)")
    except Exception as e:
        log(f"VoxLock indisponible : {e}")


def isolate(seg):
    """Ta voix seule, extraite du mélange (ou None)."""
    if voxlock is None:
        return None
    out = voxlock.run(seg.astype(np.float32), SR)
    return np.array(out.samples, dtype=np.float32)


def save_sample(audio):
    import wave

    pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
    with wave.open(SAMPLE, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def save_profile(p):
    global profile
    profile = (p / np.linalg.norm(p)).astype(np.float32)
    np.save(PROFILE, profile)

from huggingface_hub import hf_hub_download, snapshot_download  # noqa: E402


def pick_stt() -> str:
    """Moteur STT : CANOPY_STT (openvino | mlx | faster), sinon selon la plateforme et ce qui est installé."""
    forced = os.environ.get("CANOPY_STT", "").strip().lower()
    if forced in ("openvino", "mlx", "faster"):
        return forced
    import importlib.util as iu

    if sys.platform != "darwin" and iu.find_spec("openvino_genai"):
        return "openvino"
    if sys.platform == "darwin" and platform.machine() == "arm64" and iu.find_spec("mlx_whisper"):
        return "mlx"
    return "faster"


STT = pick_stt()
STT_MODEL = os.environ.get("CANOPY_STT_MODEL", "")
log(f"STT : {STT}")
if STT == "openvino":
    import openvino_genai as ov  # noqa: E402

    _pipe = ov.WhisperPipeline(snapshot_download("OpenVINO/whisper-large-v3-int8-ov"), "GPU")
elif STT == "mlx":
    import mlx_whisper  # noqa: E402

    _mlx_repo = STT_MODEL or "mlx-community/whisper-large-v3-turbo"
else:
    from faster_whisper import WhisperModel  # noqa: E402

    _fw = WhisperModel(STT_MODEL or "small", device="cpu", compute_type="int8")


# Phrases que Whisper invente sur un silence ou un bruit (génériques de sous-titres vus à l'entraînement).
GHOSTS = re.compile(
    r"sous-titr\w*[^.!?]*?(radio-canada|communaut\w* d'amara(\.org)?|amara(\.org)?)\s*[.!?]?"
    # « Sous-titrage ST' 501 », « Sous-titrage Société Radio-Canada »… : signature de fansub inventée sur une musique.
    r"|sous-titrage\s+(st\W*\s*\d+|soci[ée]t[ée][^.!?]*)\s*[.!?]?"
    r"|merci d'avoir regard\w*[^.!?]*[.!?]?"
    r"|abonnez-vous[^.!?]*[.!?]?"
    r"|merci,? (madame|monsieur) (la |le )?pr[ée]sident\w*[.!?]?",
    re.I,
)


STT_LOCK = threading.Lock()  # un seul modèle (et un seul GPU) pour le mode voix et les deux pistes du mode notes


def _stt(seg: np.ndarray, lang: "str | None") -> "tuple[str, str | None]":
    """Whisper sous verrou. lang=None : langue détectée automatiquement. Renvoie (texte brut, langue détectée ou None)."""
    detected = None
    with STT_LOCK:
        if STT == "openvino":
            kw = {"language": f"<|{lang}|>"} if lang else {}
            txt = str(_pipe.generate(seg.tolist(), task="transcribe", **kw)).strip()
            detected = lang
        elif STT == "mlx":
            r = mlx_whisper.transcribe(seg, path_or_hf_repo=_mlx_repo, language=lang)
            txt, detected = r["text"].strip(), r.get("language") or lang
        else:
            parts, info = _fw.transcribe(seg, language=lang)
            txt, detected = " ".join(x.text.strip() for x in parts).strip(), getattr(info, "language", None) or lang
    return txt, detected


def transcribe(seg: np.ndarray, lang: "str | None" = "fr") -> str:
    txt, _ = _stt(seg, lang)
    return GHOSTS.sub("", txt).strip(" .")


def transcribe_auto(seg: np.ndarray) -> "tuple[str, str | None]":
    """Langue détectée automatiquement (mode notes) : (texte, langue ou None si le moteur ne la donne pas)."""
    txt, lang = _stt(seg, None)
    return GHOSTS.sub("", txt).strip(" ."), lang


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

# Voix OpenAI (« openai-cedar »…) : gpt-4o-mini-tts en streaming PCM 24 kHz, accéléré par ffmpeg (atempo, sans
# changer la hauteur) si présent. Clé : OPENAI_API_KEY de l'environnement, sinon du .env.local à la racine de Canopy.
OPENAI_PREFIX = "openai-"
OPENAI_SPEED = float(os.environ.get("CANOPY_OPENAI_SPEED", "1.08"))
OPENAI_SLOTS = threading.Semaphore(3)  # phrases générées d'avance en même temps
POCKET_LOCK = threading.Lock()
OPENAI_TONE = (
    "Français de France, sans accent étranger. Débit rapide et fluide, phrases enchaînées. Ton complice et décontracté, "
    "comme un collègue proche qui fait un point rapide, assuré."
)


def openai_key() -> str:
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key:
        env = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env.local")
        try:
            with open(env, encoding="utf-8") as f:
                for line in f:
                    k, _, v = line.strip().partition("=")
                    if k.strip() == "OPENAI_API_KEY":
                        key = v.strip().strip("\"'")
        except OSError:
            pass
    return key


def openai_stream(voice: str, text: str):
    """Blocs float32 au débit de tts.sample_rate, au fil de la génération."""
    import shutil
    import subprocess
    import urllib.request

    req = urllib.request.Request(
        "https://api.openai.com/v1/audio/speech",
        data=json.dumps({"model": "gpt-4o-mini-tts", "voice": voice, "input": text, "instructions": OPENAI_TONE, "response_format": "pcm"}).encode(),
        headers={"Authorization": f"Bearer {openai_key()}", "Content-Type": "application/json"},
    )
    resp = urllib.request.urlopen(req, timeout=30)
    ffmpeg = shutil.which("ffmpeg") if abs(OPENAI_SPEED - 1) > 0.01 else None
    if ffmpeg:
        p = subprocess.Popen(
            [ffmpeg, "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "pipe:0", "-filter:a", f"atempo={OPENAI_SPEED}", "-f", "s16le", "pipe:1"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )

        def feed():
            try:
                while block := resp.read(4800):
                    p.stdin.write(block)
                    p.stdin.flush()
                p.stdin.close()
            except Exception:  # noqa: BLE001  (interruption : ffmpeg déjà arrêté)
                pass

        threading.Thread(target=feed, daemon=True).start()
        src = iter(lambda: p.stdout.read1(4800), b"")
    else:
        src = iter(lambda: resp.read(4800), b"")
    rest = b""
    try:
        for block in src:
            block = rest + block
            n = len(block) // 2 * 2
            block, rest = block[:n], block[n:]
            if not n:
                continue
            a = np.frombuffer(block, dtype="<i2").astype("float32") / 32768
            if tts.sample_rate != 24000:
                a = np.interp(np.arange(0, len(a), 24000 / tts.sample_rate), np.arange(len(a)), a).astype("float32")
            yield a
    finally:
        if ffmpeg:
            p.kill()
        resp.close()


def voice_state(name: str):
    """(nom réellement utilisé, état). Échantillon absent de VOICE_DIR → voix intégrée de pocket_tts, sans planter."""
    if name.startswith(OPENAI_PREFIX):
        return (name, None)
    if name not in _voices:
        path = os.path.join(VOICE_DIR, f"xtts-{name}.wav")
        if os.path.exists(path):
            _voices[name] = (name, tts.get_state_for_audio_prompt(path))
        else:
            try:  # nom d'une voix intégrée (ex. « alba »)
                _voices[name] = (name, tts.get_state_for_audio_prompt(name))
            except Exception:  # noqa: BLE001
                from pocket_tts.default_parameters import get_default_voice_for_language

                d = get_default_voice_for_language("french")
                log(f"voix « {name} » introuvable, voix intégrée « {d} »")
                _voices[name] = (d, tts.get_state_for_audio_prompt(d))
    return _voices[name]


def drain(q: "queue.Queue[np.ndarray | None]"):
    """Blocs d'une phrase générée d'avance, jusqu'à None (pas iter(q.get, None) : == sur un tableau numpy)."""
    while (a := q.get()) is not None:
        yield a


class Session:
    """Un client : écoute (VAD + Whisper par morceaux) et voix (Pocket TTS phrase par phrase)."""

    def __init__(self, ws, loop: asyncio.AbstractEventLoop, voice: str):
        self.ws, self.loop = ws, loop
        self.voice = voice
        self.mic: "queue.Queue[np.ndarray | None]" = queue.Queue()
        self.says: "queue.Queue[tuple[str, str, queue.Queue | None] | None]" = queue.Queue()
        self.epoch = 0  # change à chaque coupure : les phrases générées d'avance pour avant sont abandonnées
        self.busy = threading.Event()  # tour de Claude en cours : on ne guette que l'interruption
        self.cut = threading.Event()  # couper la voix en cours
        self.alive = True
        self.enroll = None  # apprentissage de ta voix en cours : liste des empreintes des phrases lues
        self.enroll_audio = []  # et leur audio (enregistrement de référence pour VoxLock)

    def send(self, obj):
        data = obj if isinstance(obj, (bytes, bytearray)) else json.dumps(obj, ensure_ascii=False)
        asyncio.run_coroutine_threadsafe(self.ws.send(data), self.loop)

    # ---------- écoute ----------
    def listener(self):
        preroll: list[np.ndarray] = []
        while self.alive:
            if self.enroll is not None:
                self.enroll_step()
                continue
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

        # Transcription en direct : pendant que tu parles, le morceau en cours est relu environ chaque seconde et
        # s'affiche à la suite des morceaux finis. Le vrai résultat du morceau le remplace dès que tu marques une pause.
        done_live = threading.Event()
        nseg = 0

        def live():
            while not done_live.wait(LIVE_EVERY):
                if not talking or not announced or working[0] or not jobs.empty() or STT_LOCK.locked():
                    continue
                cur, seg_no = list(buf), nseg
                if len(cur) * CHUNK < SR * 0.5:
                    continue
                txt = transcribe(np.concatenate(cur)[-SR * 15 :])
                if txt and talking and seg_no == nseg and not done_live.is_set():
                    self.send({"type": "partial", "text": " ".join(parts + [txt])})

        th = threading.Thread(target=worker, daemon=True)
        th.start()
        if LIVE_EVERY > 0:
            threading.Thread(target=live, daemon=True).start()
        buf = list(preroll)
        heard_audio: list[np.ndarray] = list(preroll)
        judged = False  # le détecteur a déjà donné son avis pour ce silence
        silent_until = CFG["end_max"]
        talking, silent, total = bool(preroll), 0, 0
        announced = checked = False  # « je t'écoute » envoyé pour ce morceau ; ta voix déjà vérifiée
        # Le préroll (reprise de parole pendant la réponse) a déjà été vérifié : il s'annonce tout de suite.
        if talking:
            self.send({"type": "speech", "on": True})
            announced = True
        while self.alive and not self.busy.is_set() and self.enroll is None:
            block = self.next_block()
            if block is None:
                continue
            ev = vad(torch.from_numpy(block))
            if talking or total:
                heard_audio.append(block)
            strict = CFG["only_me"] and profile is not None
            if ev and "start" in ev:
                # « Seulement ma voix » : on n'affiche « je t'écoute » qu'une fois ta voix reconnue (voir plus bas).
                if not talking and not strict:
                    self.send({"type": "speech", "on": True})
                    announced = True
                talking, silent, judged = True, 0, False
            if talking:
                buf.append(block)
                # Après 0,6 s de parole : est-ce toi ? Oui → l'écoute s'affiche ; non → rien ne bouge à l'écran.
                if strict and not announced and not checked and len(buf) * CHUNK >= SR * 0.6:
                    checked = True
                    sc = me_score(np.concatenate(buf))
                    if sc is None or sc >= me_threshold(0.6):
                        self.send({"type": "speech", "on": True})
                        announced = True
            if ev and "end" in ev and talking:
                seg = np.concatenate(buf)
                buf, talking, silent = [], False, 0
                nseg += 1
                if announced:
                    self.send({"type": "speech", "on": False})
                announced = checked = False
                # « Seulement ma voix » : un morceau qui ne te ressemble pas (vidéo, autre personne) est écarté
                # avant même d'être transcrit.
                if CFG["only_me"] and profile is not None:
                    sc = me_score(seg)
                    # Entre deux (ta voix mêlée à une autre) : VoxLock extrait ta voix, et on rejuge sur le résultat.
                    if USE_VOXLOCK and sc is not None and voxlock is not None and 0.35 <= sc < 0.75 and len(seg) >= SR * 0.8:
                        t0 = time.perf_counter()
                        clean = isolate(seg)
                        sc2 = me_score(clean) if clean is not None else None
                        log(f"voxlock : {sc:.2f} → {sc2 if sc2 is None else round(sc2, 2)} en {time.perf_counter() - t0:.1f} s")
                        if sc2 is not None and sc2 > sc:
                            seg, sc = clean, sc2
                    if sc is not None and sc < me_threshold(len(seg) / SR):
                        log(f"pas ta voix ({sc:.2f}, {len(seg) / SR:.1f} s) : ignoré")
                        self.send({"type": "not_me", "score": round(sc, 2)})
                        continue
                    if sc is not None:
                        log(f"ta voix ({sc:.2f}, {len(seg) / SR:.1f} s)")  # pour régler l'exigence
                    if sc is not None and len(seg) >= SR * 1.5:
                        self.adapt(seg, sc)
                    # Morceau long : une vidéo a pu parler avant ou après toi sans pause. On le découpe en tranches
                    # d'une seconde et on ne garde que celles qui te ressemblent (voix simultanées : inséparables).
                    if len(seg) >= SR * 2.5:
                        win = SR
                        keep = []
                        for i in range(0, len(seg), win):
                            part = seg[i : i + win]
                            if len(part) < SR * 0.5:
                                keep.append(part)  # bout final trop court pour juger : gardé
                                continue
                            ps = me_score(part)
                            if ps is None or ps >= me_threshold(1.0) - 0.05:
                                keep.append(part)
                        if keep and sum(len(k) for k in keep) < len(seg):
                            log(f"tranches écartées : {(len(seg) - sum(len(k) for k in keep)) / SR:.1f} s sur {len(seg) / SR:.1f} s")
                            seg = np.concatenate(keep)
                total += len(seg)
                jobs.put(seg)
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
        done_live.set()
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

    def enroll_step(self):
        """Apprentissage : chaque phrase lue (au moins 1 s) donne une empreinte ; rien n'est transcrit ni envoyé à Claude."""
        vad = VADIterator(vad_model, sampling_rate=SR, threshold=0.5, min_silence_duration_ms=1000)  # une phrase lue entière, pauses comprises
        buf, talking = [], False
        while self.alive and self.enroll is not None:
            block = self.next_block()
            if block is None:
                continue
            ev = vad(torch.from_numpy(block))
            if ev and "start" in ev:
                talking, buf = True, []
                self.send({"type": "speech", "on": True})
            if talking:
                buf.append(block)
            if ev and "end" in ev and talking:
                talking = False
                self.send({"type": "speech", "on": False})
                seg = np.concatenate(buf)
                e = embed(seg) if len(seg) >= SR * 1.0 else None
                if e is None or self.enroll is None:
                    self.send({"type": "enroll_sample", "ok": False, "n": len(self.enroll or []), "reason": "trop court"})
                    continue
                self.enroll.append(e)
                self.enroll_audio.append(seg)
                # Cohérence avec les phrases déjà lues : une autre voix ou un gros bruit se voit tout de suite.
                others = self.enroll[:-1]
                same = float(np.mean([np.dot(e, o) for o in others])) if others else 1.0
                self.send({"type": "enroll_sample", "ok": True, "n": len(self.enroll), "seconds": round(len(seg) / SR, 1), "same": round(same, 2)})

    def finish_enroll(self):
        samples = self.enroll or []
        self.enroll = None
        if len(samples) < 3:
            self.send({"type": "enroll_done", "ok": False, "error": "Il faut au moins trois phrases."})
            return
        save_profile(np.mean(samples, axis=0))
        # Enregistrement de référence pour VoxLock : les trois phrases de voix normale et calme, ~10 s.
        audio = np.concatenate(self.enroll_audio[:3])[: SR * 12]
        save_sample(audio)
        self.enroll_audio = []
        load_voxlock()
        log(f"empreinte vocale enregistrée ({len(samples)} phrases)")
        self.send({"type": "enroll_done", "ok": True, "n": len(samples)})

    def adapt(self, seg, sc):
        """Phrase nettement à toi : l'empreinte s'en rapproche un peu (micro, pièce, voix du jour)."""
        # Coupé : une vidéo qui passe le seuil tirait l'empreinte vers sa voix, et chaque phrase acceptée
        # accentuait la dérive (cercle vicieux constaté). À reprendre avec une empreinte de référence fixe.
        if not ADAPT or profile is None or sc < max(0.75, CFG["me_min"] + 0.2):
            return
        e = embed(seg)
        if e is not None:
            save_profile(0.97 * profile + 0.03 * e)

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
                # Avec « seulement ma voix », une vidéo ne coupe plus Claude : il faut 0,6 s qui te ressemblent.
                strict = CFG["only_me"] and profile is not None
                if voiced * CHUNK / SR >= (0.6 if strict else 0.3):
                    if strict:
                        sc = me_score(np.concatenate(pre))
                        if sc is not None and sc < me_threshold(0.6):
                            log(f"interruption ignorée, pas ta voix ({sc:.2f})")
                            voiced, pre = 0, []
                            continue
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
            sid, text, ahead = job
            if self.cut.is_set():
                continue
            self.send({"type": "say_start", "id": sid})
            for chunk in drain(ahead) if ahead else self.synth(text, self.voice):
                if self.cut.is_set() or not self.alive:
                    break
                self.send(chunk.astype("float32").tobytes())
            self.send({"type": "say_end", "id": sid})

    def enqueue(self, sid: str, text: str):
        """Phrase à dire. Voix OpenAI : sa génération démarre tout de suite, en parallèle de la phrase en cours de
        lecture, pour qu'il n'y ait pas de blanc entre deux phrases (le speaker lit ensuite dans l'ordre)."""
        if not self.voice.startswith(OPENAI_PREFIX):
            self.says.put((sid, text, None))
            return
        ahead: "queue.Queue[np.ndarray | None]" = queue.Queue()
        epoch, voice = self.epoch, self.voice

        def fetch():
            try:
                with OPENAI_SLOTS:
                    for a in self.synth(text, voice):
                        if self.epoch != epoch or not self.alive:
                            break
                        ahead.put(a)
            finally:
                ahead.put(None)

        threading.Thread(target=fetch, daemon=True).start()
        self.says.put((sid, text, ahead))

    def synth(self, text: str, voice: str):
        """Voix OpenAI si choisie (Pocket TTS en secours si elle échoue avant le premier son), sinon Pocket TTS."""
        if voice.startswith(OPENAI_PREFIX):
            started = False
            try:
                for a in openai_stream(voice[len(OPENAI_PREFIX):], text):
                    started = True
                    yield a
                return
            except Exception as e:  # noqa: BLE001
                log(f"voix OpenAI indisponible : {type(e).__name__}: {str(e)[:200]}")
                if started:
                    return
            from pocket_tts.default_parameters import get_default_voice_for_language

            state = voice_state(get_default_voice_for_language("french"))[1]
        else:
            state = voice_state(voice)[1]
        with POCKET_LOCK:  # les phrases générées d'avance peuvent retomber ici en même temps
            for chunk in tts.generate_audio_stream(state, text):
                yield chunk.numpy()

    def stop_voice(self):
        self.epoch += 1  # les générations d'avance en cours s'arrêtent
        self.cut.set()
        while not self.says.empty():
            try:
                self.says.get_nowait()
            except queue.Empty:
                break


NOTES_MAX = 15.0  # s : un monologue est coupé à cette durée pour que la transcription continue de défiler
NOTES_MIN = 0.6  # s : en dessous, un bruit ou un mot perdu
NOTES_ME = float(os.environ.get("CANOPY_NOTES_ME", "0.6"))  # seuil « c’est toi » en prise de notes (score cosinus)


class NotesSession:
    """Mode notes : une piste audio (micro ou son du PC), VAD + Whisper en langue automatique, segments horodatés."""

    def __init__(self, ws, loop: asyncio.AbstractEventLoop, track: str, lang: str = "auto"):
        self.ws, self.loop, self.track = ws, loop, track
        self.mic: "queue.Queue[np.ndarray | None]" = queue.Queue()
        self.jobs: "queue.Queue[tuple[np.ndarray, float, float] | None]" = queue.Queue()
        self.paused = threading.Event()
        self.alive = True
        # Langue de la réunion (fr, en, nl) ; « auto » : détection par Whisper, peu fiable sur les phrases courtes.
        self.lang = lang

    def send(self, obj):
        asyncio.run_coroutine_threadsafe(self.ws.send(json.dumps(obj, ensure_ascii=False)), self.loop)

    def start(self):
        threading.Thread(target=self.listener, daemon=True).start()
        threading.Thread(target=self.worker, daemon=True).start()

    def stop(self):
        self.alive = False
        self.mic.put(None)
        self.jobs.put(None)

    def listener(self):
        # Un modèle par piste : partagé entre deux fils (micro et son du PC), Silero mélange ses états et plante.
        vad = VADIterator(load_silero_vad(), sampling_rate=SR, threshold=0.5, min_silence_duration_ms=500)
        preroll: list[np.ndarray] = []  # quelques blocs avant le début détecté (le VAD annonce le début avec retard)
        buf: list[np.ndarray] = []
        talking, was_paused, announced = False, False, False
        t0 = 0.0

        def cut(end_ms: float):
            nonlocal buf, t0
            if buf:
                self.jobs.put((np.concatenate(buf), t0, end_ms))
            buf = []
            t0 = end_ms  # la suite d'une coupe forcée repart d'ici

        while self.alive:
            try:
                block = self.mic.get(timeout=0.2)
            except queue.Empty:
                continue
            if block is None:
                break
            if self.paused.is_set():
                # Pause : le son est ignoré et le morceau en cours est envoyé tel quel.
                if not was_paused:
                    was_paused = True
                    if talking:
                        cut(time.time() * 1000)
                    if announced:
                        self.send({"type": "speech", "on": False})
                    talking = announced = False
                    preroll = []
                    vad.reset_states()
                continue
            was_paused = False
            now = time.time() * 1000
            if len(block) != CHUNK:
                continue
            ev = vad(torch.from_numpy(block))
            if ev and "start" in ev and not talking:
                talking, announced = True, True
                buf = list(preroll)
                t0 = now - (len(buf) + 1) * CHUNK / SR * 1000  # préroll déduit
                self.send({"type": "speech", "on": True})
            if talking:
                buf.append(block)
                if (len(buf) * CHUNK / SR) >= NOTES_MAX:
                    cut(now)
            if ev and "end" in ev and talking:
                talking = announced = False
                cut(now)
                self.send({"type": "speech", "on": False})
            if not talking:
                preroll.append(block)
                preroll = preroll[-3:]
        # Socket fermé : ce qui restait est abandonné.

    def worker(self):
        while self.alive:
            job = self.jobs.get()
            if job is None:
                return
            seg, t0, t1 = job
            dur = len(seg) / SR
            if dur < NOTES_MIN:
                continue
            try:
                if self.lang == "auto":
                    txt, lang = transcribe_auto(seg)
                else:
                    txt, lang = GHOSTS.sub("", _stt(seg, self.lang)[0]).strip(" ."), self.lang
                if not txt or SHORT_GHOSTS.match(txt):
                    continue
                # Bribes (« you », « um », « Bye », « Thank you ») : un ou deux mots sur un bruit bref, rarement utiles.
                if dur < 1.5 and len(txt.split()) <= 2:
                    continue
                sc = None
                if self.track == "pc":
                    who = "remote"
                else:
                    sc = me_score(seg) if profile is not None else None
                    # Plus exigeant que le mode voix (0,45) : en réunion, une autre voix proche de la tienne ne doit
                    # pas passer pour toi. Score journalisé pour régler le seuil.
                    who = "mic" if sc is None else ("me" if sc >= NOTES_ME + (0.05 if dur < 2.0 else 0.0) else "room")
                log(f"notes {self.track} : {dur:.1f} s, {len(txt)} car., {who}" + (f", score {sc:.2f}" if sc is not None else ""))
                self.send({"type": "seg", "who": who, "text": txt, "lang": lang, "t0": int(t0), "t1": int(t1)})
            except Exception as e:  # noqa: BLE001
                log(f"notes {self.track} : erreur {e}")


NOTES_DIR = os.path.join(VOICE_DIR or HOME or ".", "notes-audio")  # son des prises de notes, pour la deuxième passe
NOTE_ID = re.compile(r"[A-Za-z0-9-]{1,64}")
NOTE_TRACKS = ("mic", "pc")


def note_files(note: str, track: str) -> "tuple[str, str]":
    base = os.path.join(NOTES_DIR, f"{note}-{track}")
    return base + ".f32", base + ".idx.json"


def purge_note(note: str):
    for tr in NOTE_TRACKS:
        for f in note_files(note, tr):
            try:
                os.remove(f)
            except OSError:
                pass


def purge_old_notes(days: int = 7):
    """Ménage au démarrage : un son jamais traité (prise de notes abandonnée) ne reste pas indéfiniment."""
    try:
        for f in os.listdir(NOTES_DIR):
            p = os.path.join(NOTES_DIR, f)
            if time.time() - os.path.getmtime(p) > days * 86400:
                os.remove(p)
                log(f"notes : {f} supprimé (plus de {days} jours)")
    except OSError:
        pass


class NoteRecorder:
    """Garde le son d'une piste : float32 brut (16 kHz) + index [décalage en échantillons, heure murale ms] à chaque reprise."""

    def __init__(self, note: str, track: str):
        os.makedirs(NOTES_DIR, exist_ok=True)
        self.audio_path, self.idx_path = note_files(note, track)
        self.f = open(self.audio_path, "wb")
        self.idx: list = []
        self.samples = 0
        self.last = 0.0  # ms, heure murale de la dernière trame reçue
        self.gap = True  # prochaine trame = nouveau repère (début, ou après une pause)

    def write(self, frame: np.ndarray):
        now = time.time() * 1000
        if self.gap or now - self.last > 1000:
            self.idx.append([self.samples, int(now - len(frame) / SR * 1000)])
            self._save_idx()
            self.gap = False
        self.last = now
        self.f.write(frame.astype("<f4", copy=False).tobytes())
        self.samples += len(frame)

    def _save_idx(self):
        with open(self.idx_path, "w", encoding="utf-8") as f:
            json.dump(self.idx, f)

    def close(self):
        try:
            self.f.close()
            self._save_idx()
        except OSError:
            pass
        log(f"notes : son enregistré {self.samples / SR:.0f} s ({os.path.basename(self.audio_path)})")


async def notes_handler(ws, track: str, note: str = "", lang: str = "auto"):
    global clients, last_seen
    clients += 1
    n = NotesSession(ws, asyncio.get_running_loop(), track, lang)
    n.start()
    rec = NoteRecorder(note, track) if note and track in NOTE_TRACKS else None
    await ws.send(json.dumps({"type": "ready"}))
    try:
        async for msg in ws:
            if isinstance(msg, (bytes, bytearray)):
                if not n.paused.is_set():
                    frame = np.frombuffer(msg, dtype="float32").copy()
                    if rec:
                        rec.write(frame)
                    n.mic.put(frame)
                continue
            m = json.loads(msg)
            if m.get("type") == "lang" and m.get("value") in ("fr", "en", "nl", "auto"):
                n.lang = m["value"]
                continue
            if m.get("type") == "pause":
                if m.get("on"):
                    n.paused.set()
                    if rec:
                        rec.gap = True
                    n.mic.put(np.zeros(0, dtype="float32"))  # réveille l'écoute : elle voit la pause et vide le morceau
                else:
                    n.paused.clear()
    finally:
        clients -= 1
        last_seen = time.time()
        n.stop()
        if rec:
            rec.close()


# ---------- Deuxième passe : tout le son d'une note, retranscrit par gros morceaux + voix regroupées ----------
FINAL_CHUNK = 25.0  # s : taille maximale d'un morceau (assez long pour que la langue détectée soit fiable)
FINAL_JOIN = 1.5  # s : au-delà de ce silence, deux paroles ne sont pas fusionnées
SPK_ASSIGN = 0.55  # cosinus : rattaché à une voix existante
SPK_MERGE = 0.62  # cosinus : deux voix aussi proches sont fusionnées


def cluster_voices(embs: "list[np.ndarray]") -> "list[int]":
    """Regroupement glouton de vecteurs normalisés : index de voix pour chacun (centroïdes mis à jour, fusion finale)."""
    sums: list = []
    labels: list = []

    def cent(v):
        return v / (np.linalg.norm(v) or 1.0)

    for e in embs:
        best, bs = -1, SPK_ASSIGN
        for i, v in enumerate(sums):
            if v is not None and float(np.dot(e, cent(v))) >= bs:
                best, bs = i, float(np.dot(e, cent(v)))
        if best < 0:
            sums.append(e.copy())
            labels.append(len(sums) - 1)
        else:
            sums[best] = sums[best] + e
            labels.append(best)
    while True:  # fusion des voix trop proches
        live = [i for i, v in enumerate(sums) if v is not None]
        pair, bs = None, SPK_MERGE
        for a in range(len(live)):
            for b in range(a + 1, len(live)):
                sc = float(np.dot(cent(sums[live[a]]), cent(sums[live[b]])))
                if sc >= bs:
                    pair, bs = (live[a], live[b]), sc
        if pair is None:
            return labels
        a, b = pair
        sums[a] = sums[a] + sums[b]
        sums[b] = None
        labels = [a if x == b else x for x in labels]


class FinalSession:
    def __init__(self, ws, loop: asyncio.AbstractEventLoop, note: str, lang: str):
        self.ws, self.loop, self.note = ws, loop, note
        self.lang = None if lang == "auto" else lang
        self.cancelled = False

    def send(self, obj):
        asyncio.run_coroutine_threadsafe(self.ws.send(json.dumps(obj, ensure_ascii=False)), self.loop).result(timeout=30)

    def run(self):
        try:
            self._run()
        except Exception as e:  # noqa: BLE001
            log(f"notes finale : erreur {e!r}")
            try:
                self.send({"type": "error", "message": "La deuxième passe a échoué."})
            except Exception:  # noqa: BLE001
                pass

    def _chunks(self, audio: np.ndarray, idx: list) -> "list[tuple[int, int]]":
        from silero_vad import get_speech_timestamps

        regions = get_speech_timestamps(
            torch.from_numpy(audio), load_silero_vad(), sampling_rate=SR, min_silence_duration_ms=400,
            speech_pad_ms=150, max_speech_duration_s=FINAL_CHUNK,
        )
        pauses = [o for o, _ in idx[1:]]
        chunks: list = []
        for r in regions:
            s, e = r["start"], r["end"]
            if chunks:
                cs, ce = chunks[-1]
                paused = any(ce < o <= s for o in pauses)
                if not paused and s - ce <= FINAL_JOIN * SR and e - cs <= FINAL_CHUNK * SR:
                    chunks[-1] = (cs, e)
                    continue
            chunks.append((s, e))
        return chunks

    @staticmethod
    def _wall(idx: list, sample: int) -> float:
        o, w = idx[0]
        for oo, ww in idx:
            if oo > sample:
                break
            o, w = oo, ww
        return w + (sample - o) / SR * 1000

    def _run(self):
        t_start = time.time()
        tracks: dict = {}
        for tr in NOTE_TRACKS:
            ap, ip = note_files(self.note, tr)
            if os.path.exists(ap) and os.path.getsize(ap) >= 4 * CHUNK and os.path.exists(ip):
                with open(ip, encoding="utf-8") as f:
                    idx = json.load(f)
                if idx:
                    tracks[tr] = (np.fromfile(ap, dtype="<f4").astype(np.float32), idx)
        if not tracks:
            self.send({"type": "error", "message": "Pas d’enregistrement pour cette note."})
            return
        # 1. Paroles repérées sur toute la piste, fusionnées en morceaux
        plan = {tr: self._chunks(a, idx) for tr, (a, idx) in tracks.items()}
        total = sum(e - s for ch in plan.values() for s, e in ch) / SR
        log(f"notes finale : {self.note} : " + ", ".join(f"{tr} {len(a) / SR:.0f} s → {len(plan[tr])} morceaux" for tr, (a, _) in tracks.items()) + f", {total:.0f} s de parole")
        # 2. Transcription
        items: dict = {tr: [] for tr in tracks}
        done = 0.0
        for tr, (audio, idx) in tracks.items():
            for s, e in plan[tr]:
                if self.cancelled:
                    return
                dur = (e - s) / SR
                txt, lang = _stt(audio[s:e], self.lang)
                txt = GHOSTS.sub("", txt).strip(" .")
                if txt and not SHORT_GHOSTS.match(txt) and not (dur < 1.5 and len(txt.split()) <= 2):
                    items[tr].append({"s": s, "e": e, "dur": dur, "text": txt, "lang": lang or self.lang,
                                      "t0": int(self._wall(idx, s)), "t1": int(max(self._wall(idx, e), self._wall(idx, s)))})
                done += dur
                self.send({"type": "progress", "value": min(1.0, done / total) if total else 1.0})
        log(f"notes finale : transcription {sum(len(v) for v in items.values())} morceaux gardés en {time.time() - t_start:.0f} s")
        # 3. Écho : le micro a repris le son de la visio
        if "mic" in items and "pc" in items:
            words = lambda t: set(re.findall(r"\w+", t.lower()))  # noqa: E731
            pcs = [(c["t0"], c["t1"], words(c["text"])) for c in items["pc"]]
            keep = []
            for c in items["mic"]:
                w, echo = words(c["text"]), False
                for t0, t1, pw in pcs:
                    if c["t0"] <= t1 + 2000 and c["t1"] >= t0 - 2000 and w and pw:
                        small = min(len(w), len(pw))
                        if len(w & pw) >= max(min(3, small), 0.5 * small):
                            echo = True
                            break
                if not echo:
                    keep.append(c)
            log(f"notes finale : écho retiré {len(items['mic']) - len(keep)} morceaux")
            items["mic"] = keep
        # 4. Voix
        speakers = self._voices(items, tracks)
        segs = [{"track": tr, "who": c["who"], "speaker": c["speaker"], "t0": c["t0"], "t1": c["t1"], "text": c["text"], "lang": c["lang"]}
                for tr, cs in items.items() for c in cs]
        segs.sort(key=lambda x: x["t0"])
        for sg in segs:
            if sg["lang"] is None:
                del sg["lang"]  # langue inconnue (Whisper OpenVINO ne la donne pas en mode auto)
        log(f"notes finale : {len(segs)} segments, {len(speakers)} voix, {time.time() - t_start:.0f} s")
        self.send({"type": "done", "segments": segs, "speakers": speakers})
        purge_note(self.note)

    def _voices(self, items: dict, tracks: dict) -> list:
        stats: dict = {}  # id → [piste, durée, phrase la plus longue, durée de celle-ci]
        for tr, cs in items.items():
            audio = tracks[tr][0]
            prefix, who = ("p", "room") if tr == "mic" else ("v", "remote")
            for c in cs:
                c["emb"] = embed(audio[c["s"]:c["e"]]) if speaker_ex is not None and c["dur"] >= 1.0 else None
                c["spk"] = None
            if speaker_ex is None:  # pas de modèle d'empreinte : une seule voix par piste
                for c in cs:
                    c["who"], c["speaker"] = ("mic" if tr == "mic" else "remote"), prefix + "1"
            else:
                known = tr == "mic" and profile is not None
                to_cluster = []
                for c in cs:
                    if known and c["emb"] is not None and float(np.dot(c["emb"], profile)) >= NOTES_ME + (0.05 if c["dur"] < 2.0 else 0.0):
                        c["spk"] = "me"
                    elif c["emb"] is not None:
                        to_cluster.append(c)
                labels = cluster_voices([c["emb"] for c in to_cluster])
                time_by: dict = {}
                for c, lb in zip(to_cluster, labels):
                    time_by[lb] = time_by.get(lb, 0.0) + c["dur"]
                rank = {lb: i + 1 for i, lb in enumerate(sorted(time_by, key=lambda k: -time_by[k]))}  # 1 = celui qui parle le plus
                for c, lb in zip(to_cluster, labels):
                    c["spk"] = f"{prefix}{rank[lb]}"
                prev = None
                for c in cs:  # morceau trop court pour une empreinte : même voix que le précédent
                    if c["spk"] is None:
                        c["spk"] = prev
                    prev = c["spk"]
                nxt = None
                for c in reversed(cs):
                    if c["spk"] is None:
                        c["spk"] = nxt
                    nxt = c["spk"]
                for c in cs:
                    c["spk"] = c["spk"] or f"{prefix}1"
                    c["speaker"] = c["spk"]
                    c["who"] = "me" if c["spk"] == "me" else (who if known or tr == "pc" else "mic")
            for c in cs:
                st = stats.setdefault(c["speaker"], [tr, 0.0, "", 0.0])
                st[1] += c["dur"]
                if c["dur"] > st[3]:
                    st[2], st[3] = c["text"], c["dur"]
        total = sum(v[1] for v in stats.values()) or 1.0
        order = sorted(stats, key=lambda k: (k != "me", -stats[k][1]))
        return [{"id": k, "track": stats[k][0], "share": round(stats[k][1] / total, 3), "sample": stats[k][2][:140]} for k in order]


async def final_handler(ws, note: str, lang: str):
    global clients, last_seen
    clients += 1
    fs = FinalSession(ws, asyncio.get_running_loop(), note, lang)
    work = asyncio.ensure_future(asyncio.to_thread(fs.run))

    async def watch():
        async for msg in ws:
            if not isinstance(msg, (bytes, bytearray)) and json.loads(msg).get("type") == "discard":
                fs.cancelled = True
                return

    watcher = asyncio.ensure_future(watch())
    try:
        await asyncio.wait({work, watcher}, return_when=asyncio.FIRST_COMPLETED)
        if fs.cancelled:
            await work
            purge_note(note)
            log(f"notes finale : {note} abandonnée, son supprimé")
    finally:
        watcher.cancel()
        clients -= 1
        last_seen = time.time()


async def handler(ws):
    path = getattr(getattr(ws, "request", None), "path", "") or getattr(ws, "path", "")
    if TOKEN and f"t={TOKEN}" not in path:
        await ws.close(4001, "jeton invalide")
        return
    from urllib.parse import parse_qs, urlparse

    q = parse_qs(urlparse(path).query)
    note = q.get("note", [""])[0]
    note = note if NOTE_ID.fullmatch(note) else ""
    lang = q.get("lang", ["auto"])[0]
    lang = lang if lang in ("fr", "en", "nl", "auto") else "auto"
    if q.get("mode", [""])[0] == "notes":
        await notes_handler(ws, q.get("track", ["mic"])[0], note, lang)
        return
    if q.get("mode", [""])[0] == "final":
        if not note:
            await ws.send(json.dumps({"type": "error", "message": "Note inconnue."}))
            return
        await final_handler(ws, note, lang)
        return
    global clients, last_seen
    clients += 1
    s = Session(ws, asyncio.get_running_loop(), os.environ.get("CANOPY_VOICE", "ana"))
    s.voice = voice_state(s.voice)[0]
    threading.Thread(target=s.listener, daemon=True).start()
    threading.Thread(target=s.speaker, daemon=True).start()
    await ws.send(json.dumps({"type": "ready", "rate": tts.sample_rate, "voice": s.voice, "speaker": speaker_ex is not None, "profile": profile is not None}))
    try:
        async for msg in ws:
            if isinstance(msg, (bytes, bytearray)):
                s.mic.put(np.frombuffer(msg, dtype="float32").copy())
                continue
            m = json.loads(msg)
            t = m.get("type")
            if t == "say":
                s.cut.clear()
                s.enqueue(str(m.get("id", "")), str(m.get("text", "")))
            elif t == "stop":
                s.stop_voice()
            elif t == "config":
                for k in ("threshold", "end", "end_max", "me_min"):
                    if isinstance(m.get(k), (int, float)):
                        CFG[k] = float(m[k])
                if isinstance(m.get("only_me"), bool):
                    CFG["only_me"] = m["only_me"]
                log(f"réglages : {CFG}")
            elif t == "busy":
                s.busy.set()  # Claude reprend après une fausse interruption : on ne guette que l'interruption
            elif t == "listen":
                s.busy.clear()
                while not s.mic.empty():  # ce que le micro a capté pendant la réponse ne compte pas
                    s.mic.get_nowait()
            elif t == "enroll":
                a = m.get("action")
                if a == "start":
                    s.enroll_audio = []
                    s.enroll = []
                elif a == "cancel":
                    s.enroll = None
                elif a == "save":
                    s.finish_enroll()
            elif t == "voice":
                s.voice = (await asyncio.to_thread(voice_state, str(m.get("name", s.voice))))[0]
    finally:
        clients -= 1
        last_seen = time.time()
        s.alive = False
        s.says.put(None)


load_voxlock()
purge_old_notes()


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
