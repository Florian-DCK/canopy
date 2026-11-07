// Notes de réunion (étape 2a, planche 54) : deux pistes, micro (toi + la pièce) et son du PC (la visio),
// transcrites en direct par le service vocal, puis résumées par Claude à la fin.

/** Qui parle : toi (empreinte de ta voix), quelqu'un dans la pièce, quelqu'un en visio, ou micro sans empreinte. */
export type NoteWho = 'me' | 'room' | 'remote' | 'mic'

export type NoteSeg = {
  id: string
  track: 'mic' | 'pc'
  who: NoteWho
  /** Heure murale, ms. */
  t0: number
  t1: number
  text: string
  /** Langue détectée (fr, en, nl…), si connue. */
  lang?: string
  /** Deuxième passe : voix regroupées (« me », « p1 », « p2 » pour la pièce, « v1 », « v2 » pour la visio). */
  speaker?: string
}

/** Une voix repérée par la deuxième passe, que l'utilisateur peut nommer. */
export type NoteSpeaker = { id: string; track: 'mic' | 'pc'; /** Nom donné par l'utilisateur. */ name?: string; /** Part de la parole, 0 à 1. */ share: number; /** Une phrase typique, pour reconnaître la voix. */ sample: string }

export type NoteState = 'recording' | 'paused' | 'refining' | 'summarizing' | 'done' | 'error'

export type MeetingNoteMeta = {
  id: string
  title: string
  /** Réunion de l'agenda, si la prise de notes en vient. */
  meetingId?: string
  projectId?: string | null
  startedAt: number
  endedAt?: number
  state: NoteState
  error?: string
  /** Nombre de segments transcrits. */
  count: number
}

export type MeetingNote = MeetingNoteMeta & {
  segments: NoteSeg[]
  /** Transcript en direct, gardé quand la deuxième passe a remplacé `segments`. */
  draft?: NoteSeg[]
  /** Voix repérées par la deuxième passe. */
  speakers?: NoteSpeaker[]
  /** Avancement de la deuxième passe, 0 à 1. */
  progress?: number
  /** Compte rendu Markdown : ## En bref, ## Décisions, ## Actions, ## Questions ouvertes. */
  summary?: string
}

/** Ce que le démon reçoit pour écrire le compte rendu. */
export type NotesSummaryInput = {
  title: string
  projectName?: string
  projectPath?: string
  /** Brief de la réunion, s'il existe (contexte). */
  brief?: string
  /** Transcript, une ligne par segment : « HH:MM:SS · Toi|Dans la pièce|En visio · texte ». */
  transcript: string
  startedAt: number
  endedAt: number
  now: number
}

/** Protocole du service vocal en mode notes : ws://127.0.0.1:<port>/?t=<jeton>&mode=notes&track=mic|pc
 * Le client envoie des trames Float32 mono 16 kHz (comme le mode voix). Le service répond :
 *  {"type":"ready"}
 *  {"type":"speech","on":true|false}             : quelqu'un parle sur cette piste
 *  {"type":"seg","who":"me"|"room"|"remote"|"mic","text":"…","lang":"fr","t0":<ms>,"t1":<ms>}
 * Le client envoie aussi {"type":"pause","on":true|false} (pause : le son reçu est ignoré) et
 * {"type":"lang","value":"fr"|"en"|"nl"|"auto"}. Avec &note=<id> dans l'adresse, le service garde le son de la piste
 * (fichiers dans son dossier de travail) pour la deuxième passe.
 *
 * Deuxième passe : ws://127.0.0.1:<port>/?t=<jeton>&mode=final&note=<id>[&lang=auto]
 *  service → {"type":"progress","value":0..1}
 *          → {"type":"done","segments":[{track,who,speaker,t0,t1,text,lang}],"speakers":[{id,track,share,sample}]}
 *          → {"type":"error","message":"…"}
 * Le son est supprimé une fois le résultat envoyé (ou si le client envoie {"type":"discard"}). */
export const NOTES_PROTOCOL = 1
