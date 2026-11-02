// Avvia il Redattore collegato al Claude finto: interfaccia completa, risposte di esempio.
process.env.ANTHROPIC_BASE_URL = `http://localhost:${process.env.PORTA_FINTO ?? 4010}`;
process.env.ANTHROPIC_API_KEY = "finta";
process.env.REDATTORE_DATI ??= "data-demo";

await import("./claude-finto");
await import("../server/index");
export {};
