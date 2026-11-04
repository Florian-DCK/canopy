// Étape 0 : vérifie abonnement (pas de clé API) + chargement de la config utilisateur.
import { query } from "@anthropic-ai/claude-agent-sdk";

delete process.env.ANTHROPIC_API_KEY;

const q = query({
  prompt: "Réponds en 2 lignes : 1) cite la première règle de la section 'Travail sur le code' de ton CLAUDE.md utilisateur, 2) liste 3 noms de skills disponibles. N'utilise aucun outil.",
  options: {
    cwd: process.cwd(),
    systemPrompt: { type: "preset", preset: "claude_code" },
    settingSources: ["user", "project", "local"],
    maxTurns: 1,
  },
});

for await (const m of q) {
  if (m.type === "system" && m.subtype === "init") {
    console.log("INIT", JSON.stringify({ apiKeySource: m.apiKeySource, model: m.model, skills: m.skills?.length, slash: m.slash_commands?.length, tools: m.tools?.length }));
  } else if (m.type === "assistant") {
    for (const c of m.message.content) if (c.type === "text") console.log("TEXT", c.text);
  } else if (m.type === "result") {
    console.log("RESULT", m.subtype, "cost", m.total_cost_usd);
  }
}
