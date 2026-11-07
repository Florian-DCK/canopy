// Agenda (planches 51 à 55) : réunions Google Agenda, tâches Teamleader Focus, briefs préparés par Claude.
// Le processus principal tient les connexions (secrets dans le Coffre) et l'état ; le démon écrit les briefs.

export type AgendaAttendee = { email: string; name?: string; self?: boolean; external: boolean }

/** Comment la réunion a été reliée à un projet. */
export type AgendaLink = 'auto' | 'chosen' | 'doubt' | 'none'

export type BriefState = 'none' | 'ondemand' | 'pending' | 'working' | 'ready' | 'error'

export type AgendaMeeting = {
  /** Identifiant Google de l'occurrence. */
  id: string
  /** Série d'une réunion récurrente (pour retenir le projet choisi). */
  recurringId?: string
  title: string
  start: number
  end: number
  allDay?: boolean
  description?: string
  location?: string
  /** Lien Meet ou Teams trouvé dans l'événement. */
  joinUrl?: string
  attendees: AgendaAttendee[]
  /** Au moins un participant hors de ton domaine. */
  external: boolean
  projectId: string | null
  link: AgendaLink
  /** Projets possibles quand le lien est incertain (link = 'doubt'). */
  candidates?: string[]
  brief: { state: BriefState; updatedAt?: number; error?: string }
}

export type FocusTask = {
  id: string
  title: string
  /** AAAA-MM-JJ */
  due?: string
  projectName?: string
  projectId?: string | null
  done: boolean
  url?: string
}

export type SourceStatus = { configured: boolean; connected: boolean; account?: string; error?: string }

export type AgendaState = {
  google: SourceStatus
  teamleader: SourceStatus
  /** Dernière lecture réussie des sources. */
  updatedAt: number
  /** Aujourd'hui et les 7 jours suivants, triées par début. */
  meetings: AgendaMeeting[]
  /** Tâches ouvertes qui te sont assignées. */
  tasks: FocusTask[]
}

export type BriefVersion = { at: number; markdown: string }

export type AgendaBrief = {
  meetingId: string
  /** Version courante (la dernière). */
  markdown: string
  versions: BriefVersion[]
  /** Fichier Markdown du brief (données de Canopy), que les sessions du projet peuvent compléter. */
  path: string
}

export type AgendaPrefs = {
  /** Réunions qui ont un brief préparé d'office ; les autres l'ont à la demande. */
  briefFor: 'external' | 'all' | 'none'
  /** Mise à jour 30 min avant, s'il y a du nouveau. */
  refreshBefore: boolean
  /** Notification 10 min avant. */
  notifyBefore: boolean
  /** Lire les mails échangés avec les participants (30 derniers jours). */
  useMail: boolean
}

export const AGENDA_PREFS_DEFAULT: AgendaPrefs = { briefFor: 'external', refreshBefore: true, notifyBefore: true, useMail: true }

/** Ce que le démon reçoit pour écrire un brief. */
export type BriefInput = {
  meeting: AgendaMeeting
  projectName?: string
  projectPath?: string
  mails: { subject: string; from: string; date: number; snippet: string }[]
  tasks: FocusTask[]
  /** Sessions récentes du projet. */
  sessions: { title: string; at: number }[]
  /** Brief précédent : la mise à jour complète la partie « Depuis ce matin ». */
  previous?: string
  /** Fichier où le brief sera gardé (à citer, pas à écrire : Canopy s'en charge). */
  path: string
  now: number
}
