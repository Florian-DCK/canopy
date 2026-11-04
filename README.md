# Atelier

Interface desktop perso (Windows) pour Claude Code. Elle pilote le **Claude Agent SDK** avec ton abonnement (`claude login`), jamais avec une clé API.

Spec : [docs/SPEC-V0.md](docs/SPEC-V0.md) · Maquettes : https://claude.ai/artifact/7KDbHUh4oDPXwm3Kh6fR4W

## Lancer

```bash
npm install
node node_modules/electron/install.js   # si npm n'a pas lancé le script d'install d'Electron
npm run dev                             # développement (rechargement à chaud)
npm run build && npm start              # version buildée
```

Prérequis : Node 20+, Claude Code installé et connecté (`claude login`). `ANTHROPIC_API_KEY` est retirée de l'environnement des sessions.

## Architecture : démon + fenêtre
- `src/daemon/` : **démon** Node indépendant (sessions Agent SDK, autorisations, médias, usage, sessions externes). Lancé par Electron s'il ne tourne pas, **il survit à la fermeture de la fenêtre** et aux redémarrages d'Electron. HTTP sur 127.0.0.1 + jeton (`daemon.json` dans userData), flux SSE numéroté avec rattrapage. Sessions ouvertes reprises après un redémarrage du démon (`open-sessions.json`). Journal : `daemon.log`.
- `src/main/` : Electron = client (fenêtre, notifications, dialogues, serveur `atelier-media://`).
- **Mode dev** (raccourci bureau « Atelier » → `scripts/atelier-dev.vbs` → `npm run dev` = `electron-vite dev -w`) : interface rechargée à chaud, Electron relancé seul quand `src/main` change, sessions intactes. Si `src/daemon` change : bandeau « Moteur modifié → Redémarrer le moteur » (grisé tant qu'une session travaille).

## V0 — ce qui marche
- **Cockpit forêt** : une bande par projet actif, une carte par session, sous-agents (ou étapes du plan TodoWrite) en branches ; ce qui attend ta réponse remonte en premier.
- **Vue projet** : toutes les sessions d'un projet + fil des actions.
- **Session** : streaming, outils repliables, sous-agents dépliables, cartes d'autorisation (une fois / toujours / refuser), Pause, mode d'autorisation, panneau Diff et jauge de contexte.
- **Projets** : ajouter un dossier, retirer.
- **Historique** : toutes les sessions Claude Code de tes projets (y compris lancées depuis le terminal), recherche par titre, filtre par projet, **reprise** (transcript rejoué puis `resume`). Aussi en bas de chaque vue projet.
- **Sessions hors Atelier** (terminal, VS Code…) : détectées toutes les 8 s via leurs transcripts (actives < 5 min), rattachées au projet dont le dossier les contient (sous-dossiers compris) ; dossier inconnu → bande en pointillés + « Ajouter ce projet ». Ouverture en **lecture seule** (Actualiser / Reprendre ici).
- **Jauge d'usage** : anneaux dans la barre du haut (5 h dehors, semaine dedans ; argile seulement si la limite est projetée avant le reset), clic = détail avec courbe de la fenêtre 5 h et projection « à ce rythme » (relevés gardés dans `usage-samples.json`). Sonde = session Claude Code au repos interrogée via l'API **expérimentale** `usage_EXPERIMENTAL_…` du SDK (données de `/usage`), toutes les 60 s et après chaque réponse. Si le SDK la retire, la jauge affiche « — ».
- **Médias** : images lues par l'agent (`Read`, copie figée), captures d'outils (Playwright…), images/vidéos citées dans les réponses (si le fichier existe) → vignettes dans le fil, regroupées en **séries** (`check-43`, `check-44`…) ; onglet Médias ; visionneuse (zoom, vidéo, comparer côte à côte / curseur, ← →, Échap) ; « Joindre → session » / « Capture → session » renvoie l'image à Claude ; dernière vue sur la carte du cockpit. Servis par le protocole interne `atelier-media://` (cache + miniatures dans `media-cache/`).
- **Mode sombre** : bouton en bas du rail (Système → Sombre → Clair), mémorisé ; pilote `nativeTheme`, donc la barre de titre Windows suit.
- **Filtre des sessions programmatiques** : les `claude -p` lancés par des hooks/scripts sont masqués de l'historique et du cockpit ; les sessions créées par Atelier sont mémorisées pour rester visibles.
- **Notifications Windows** quand une session attend ta réponse, finit ou échoue alors que la fenêtre n'a pas le focus ; clic = ouvre la session.
- **Modèle par session** (Défaut / Opus / Sonnet / Haiku), modifiable en cours de route.

## Tests e2e
```bash
npm run build
node scripts/e2e.mjs <dossier-projet-test> <dossier-sortie>          # autorisation Write + diff
node scripts/e2e-subagent.mjs <dossier-projet-test> <dossier-sortie> # arbre de sous-agents
node scripts/e2e-resume.mjs <dossier-projet-test> <dossier-sortie>   # historique + reprise avec Sonnet
node scripts/e2e-media.mjs <dossier-avec-check-1..3.png+preview.mp4> <sortie> # médias, séries, visionneuse, pièce jointe
```
Ils lancent de vraies sessions (consomment un peu de quota).

## Structure
- `src/main/` — Electron : `sessions.ts` (SDK, autorisations, normalisation des messages), `projects.ts`
- `src/preload/` — pont IPC typé
- `src/renderer/` — React + zustand : `views/` (Cockpit, ProjectView, SessionView, ProjectsView), `derive.ts` (arbres)
- `src/shared/types.ts` — contrat main ↔ UI
