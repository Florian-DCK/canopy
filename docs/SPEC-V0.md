# Atelier — Spec V0

> App desktop Windows perso qui pilote Claude Code via l'Agent SDK, avec ton abonnement.
> Maquettes : https://claude.ai/artifact/7KDbHUh4oDPXwm3Kh6fR4W (écrans 1, 1b, 2, 6).
> Statut : **brouillon — attend ton feu vert avant code.**

## 1. Objectif de la V0

Remplacer le terminal pour le travail quotidien sur **plusieurs projets en parallèle** :
voir d'un coup d'œil quel projet fait quoi, répondre aux autorisations, suivre une session et ses diffs.

### Dans la V0
- Cockpit **forêt multi-projets** (écran 1) : une bande par projet actif, une carte par session, sous-agents en pastilles.
- **Vue projet** (écran 1b) : arbre d'orchestration d'un projet.
- **Session** (écran 2) : conversation en streaming, appels d'outils repliables, sous-agents, carte d'autorisation, composer, panneau Diff + jauge de contexte.
- Gestion des **projets** : ajouter un dossier, pastille couleur, retirer.
- Plusieurs sessions simultanées, sur des projets différents.
- DA Claude (écran 6), clair uniquement.

### Hors V0 (plus tard)
| Version | Contenu |
|---|---|
| V1 | Catalogue d'agents + lancement, worktrees, sessions lancées depuis le terminal (lecture seule) |
| V2 | Historique : index + recherche + reprise (`resume`) |
| V3 | Navigateur intégré + annotate |
| V4 | Artefacts, mode sombre |

## 2. Critères de succès (vérifiables)

1. **Abonnement** : sans `ANTHROPIC_API_KEY` dans l'env, une session répond, et le message `system/init` du SDK ne signale pas de clé API. *(à confirmer au spike, étape 0)*
2. **Config chargée** : dans une session, Claude cite une règle de `~/.claude/CLAUDE.md` et liste un skill perso.
3. **Parallélisme** : 3 sessions sur 3 projets tournent en même temps ; le cockpit affiche 3 bandes avec l'état juste (en cours / attend / terminé) en < 1 s après chaque changement.
4. **Autorisations** : un `Bash` demandé par l'agent apparaît en carte argile dans la session **et** dans le cockpit ; « Autoriser », « Toujours pour ce projet » et « Refuser » ont l'effet attendu.
5. **Sous-agents** : une session qui lance un `Task` affiche le sous-agent en branche, avec son état propre.
6. **Diff** : chaque `Edit`/`Write` s'affiche dans le panneau Diff (fichier, +/−).
7. **Contrôle** : « Pause » interrompt la session ; l'app fermée puis rouverte retrouve la liste des projets.

## 3. Architecture

```
Electron
├─ main (Node, TS)
│   ├─ SessionManager     N sessions Agent SDK (query() en mode streaming input)
│   ├─ PermissionBroker   canUseTool → met en attente → répond quand l'UI tranche
│   ├─ ProjectStore       projets en JSON dans userData
│   └─ IPC typé           événements normalisés → renderer
├─ preload               contextBridge, API minimale et typée
└─ renderer (React, TS)
    ├─ store (zustand)   projets, sessions, nœuds d'arbre, demandes en attente
    └─ écrans            Cockpit · Vue projet · Session · Réglages projets
```

**Stack** : Electron + electron-vite + React + TypeScript + zustand. Pas de SQLite en V0 (arrive en V2).

### Une session = un `query()` vivant
```ts
query({
  prompt: inputQueue,                 // AsyncIterable : on pousse les messages du composer
  options: {
    cwd: project.path,
    systemPrompt: { type: "preset", preset: "claude_code" },
    settingSources: ["user", "project", "local"],
    permissionMode: "default",
    canUseTool: broker.ask(sessionId), // promesse résolue par l'UI
    model,                             // optionnel, défaut de l'utilisateur
  },
})
```
- `ANTHROPIC_API_KEY` est **retirée de l'env** du process avant le lancement (sinon facturation API).
- Pas de clé, pas de token copiés : l'auth reste celle de `claude login`.

### Modèle de données (renderer)
- `Project { id, name, path, color, branch? }`
- `Session { id, projectId, sdkSessionId?, title, status: run|wait|done|error, model, startedAt, contextTokens? }`
- `Node { id, sessionId, parentId?, kind: root|subagent, agent, task, status, lastAction }` — les sous-agents sont détectés via les messages rattachés à un `Task` parent.
- `PendingPermission { id, sessionId, tool, inputSummary, createdAt }`
- `FileChange { sessionId, path, added, removed, hunks }`

### Événements main → renderer
`session:status`, `session:message` (texte/outils normalisés), `session:node`, `permission:request`, `permission:resolved`, `file:changed`, `session:usage`.

## 4. Écrans V0

- **Cockpit** : rappel des projets actifs en haut (pastilles), bandes triées « attend ta réponse » d'abord, arbres compacts, bouton « Répondre » sur un nœud en attente, projets inactifs en une ligne.
- **Vue projet** : arbre d'un projet, plusieurs racines si plusieurs sessions, fil d'événements à droite.
- **Session** : liste des sessions du projet, conversation, carte d'autorisation, composer, panneau Diff / Contexte. Onglets Fichiers et Plan = placeholders en V0.
- **Projets** : ajouter un dossier (sélecteur Windows), choisir la couleur, retirer.

## 5. Risques et inconnues

| Risque | Parade |
|---|---|
| L'Agent SDK n'utilise pas l'abonnement comme prévu | Spike étape 0 avant tout le reste ; stop et rediscussion si KO |
| Quota partagé épuisé par le parallélisme | Jauge visible en permanence (V0 : approximative, d'après l'usage renvoyé par le SDK) |
| Format des messages SDK change | Une seule couche de normalisation dans `main`, l'UI ne voit que nos événements |
| Détection des sous-agents imprécise | V0 accepte un arbre à 1 niveau ; affiner en V1 |
| Usage contraire aux CGU | App perso, jamais distribuée avec login claude.ai |

## 6. Plan

| # | Étape | verify |
|---|---|---|
| 0 | **Spike** Node pur : 1 `query()` sans clé API, config chargée | critères 1 et 2 en console |
| 1 | Squelette Electron + electron-vite + React, rail et DA (tokens) | l'app s'ouvre sur un cockpit vide aux couleurs Claude |
| 2 | ProjectStore + écran Projets | ajouter/retirer un projet, persistant après redémarrage |
| 3 | SessionManager + IPC + écran Session (texte en streaming, composer) | conversation fonctionnelle sur 1 projet |
| 4 | PermissionBroker + carte d'autorisation | critère 4 |
| 5 | Appels d'outils repliables + panneau Diff | critère 6 |
| 6 | Sessions multiples + cockpit forêt | critère 3 |
| 7 | Sous-agents (nœuds) + vue projet | critère 5 |
| 8 | Pause, jauges quota/contexte, finitions | critère 7 + passe `/code-review` |

Exécution : moi pour l'archi et les étapes 0, 3, 4 (cœur SDK) ; étapes d'UI isolées déléguables à `dev-executor`.

## 7. Décisions prises

- DA Claude, cockpit forêt + vue projet arbre.
- Electron, from scratch, nom provisoire « Atelier ».
- Dossier : `C:\Users\fdonc\Documents\Atelier` *(choisi par défaut, à changer si besoin)*.
