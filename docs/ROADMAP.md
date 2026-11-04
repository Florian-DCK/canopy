# Atelier — feuille de route

Ajouts voulus par l'utilisateur (noté le 2026-11-03). Chaque chantier passe par le design (artefact
« Atelier — DA et écrans ») puis attend un feu vert avant d'être codé.

Déjà livré : cockpit, sessions multiples, démon, refonte de la session (planches 0 à 8), notifications
maison (planche 9), navigateur intégré + Pointer (planches 10 et 11).

---

## 1. Bibliothèque de mémoire

Documents Markdown consultables et corrigeables, que l'utilisateur **et** Claude peuvent ajouter,
modifier, supprimer. Ils servent de contexte aux sessions.

- Deux portées : **projet** (partagée par toutes les sessions du projet) et **session**.
- Éditeur Markdown dans Atelier (lecture rendue + édition), historique des modifications.
- Côté Claude : un outil Atelier (lire / chercher / écrire une note) plutôt que des fichiers épars.
- Questions : où stocker (dans le dépôt du projet, `.atelier/memory/`, ou dans les données
  d'Atelier) ? Comment l'injecter (tout le contenu, un index + lecture à la demande) ? Lien avec la
  mémoire existante de Claude Code (`~/.claude/projects/*/memory`) et le wiki Claude House.

## 2. Bibliothèque d'agents personnalisés

Gérer ses agents spécialisés de A à Z : créer, configurer, éditer, supprimer, **lancer**.

- Référence : opcode (GUI de Claude Code) a une gestion d'agents de ce genre.
- Un agent = prompt système, modèle, outils autorisés, MCP, skills, dossier de travail.
- Lancement direct dans une session (ou en tâche de fond suivie au cockpit).
- **Partage avec un collègue** : base de données en ligne pour synchroniser agents (et à terme
  mémoire, skills…). Questions : quel service (Supabase, Neon…), comptes, droits, conflits
  d'édition, ne jamais synchroniser de secrets.

## 3. Bac à sable (conversations libres)

Demander à Claude des questions, recherches web, petites tâches **sans projet**, tout en restant
retrouvable (historique dédié).

- Si la conversation dérive vers un projet (ex. « mobile kids »), Atelier le **détecte** et propose
  (ou fait) le **transfert** vers ce projet, avec ses outils et son contexte (dossier, CLAUDE.md,
  skills, mémoire du projet).
- Questions : détection (mots-clés, chemins, demande à Claude) ; transfert = nouvelle session
  reprenant un résumé, ou fork de la conversation dans le dossier du projet.

## 4. Visionneuses par type de fichier

Étendre la visionneuse de médias à d'autres types, en priorité **modèles 3D** (glTF/GLB, OBJ, FBX)
avec vignette dans le fil et visionneuse orbitale (lien avec le projet Hilarious Knockout / Blender).
Ensuite : PDF, audio, tableaux (CSV/XLSX), JSON/données.

## 5. Mode compagnon

Une petite fenêtre libre, **au-dessus de tout**, peu intrusive (à la Codex) : suivre une
conversation, lui écrire, voir ses demandes d'autorisation.

- Reçoit automatiquement du **contexte de l'écran** (capture de la fenêtre active, application en
  cours). Questions : à quel rythme, avec quel consentement visible, exclusion des apps sensibles.
- S'appuie sur la fenêtre des notifications (planche 9) : même technique (sans focus, au-dessus du
  plein écran).

## 6. Mode conversationnel

Parler avec Claude (voix) : dictée, réponse lue, éventuellement conversation continue.
Questions : reconnaissance vocale locale ou en ligne, voix de synthèse, interruption.

## 7. Tiling de sessions

Afficher plusieurs sessions côte à côte (grilles 2, 3, 4) pour travailler en parallèle, chacune
avec sa saisie ; glisser une session depuis le cockpit dans une case. Jugé « vraiment pratique ».

## 8. Grand nettoyage de Claude Code

Repartir d'une configuration propre : inventaire de ce qui est installé (plugins, skills, MCP,
hooks, agents, CLAUDE.md, mémoire, permissions), de ce qui pèse dans le contexte, puis tri
(garder / désactiver / supprimer) avec sauvegarde avant. Écran d'audit dans Atelier.

## 9. Gestion des skills, compétences et MCP

Voir, activer/désactiver, installer, configurer, éditer les skills et serveurs MCP (portée
utilisateur / projet), avec leur coût en contexte. Lié aux chantiers 2 et 8.

## 10. Checklists (en cours, 2026-11-04)

Des documents checklist durables (≠ TodoWrite, le brouillon d'un tour), liés à un projet ou à des
sessions, que Claude sait lire, créer, cocher, modifier via un outil, et que l'utilisateur voit :
page « Checklists » (toutes, par projet, clic → session liée), dock dans la session, cartes dans le
fil quand Claude les consulte ou les modifie. Exemple : cette feuille de route.

## Plus tard

- Navigateur : modes Mesurer, Comparer, Étudier, Polices (repris de l'outil annotate).
- Session : « Repartir d'ici » (reprise du SDK jusqu'à un message précis).
