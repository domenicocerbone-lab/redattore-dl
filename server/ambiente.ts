// Importato per primo: carica .env prima che gli altri moduli leggano process.env.
try {
  process.loadEnvFile();
} catch {
  // Nessun file .env: si usano le variabili d'ambiente già presenti.
}

export const PRODUZIONE = process.env.NODE_ENV === "production" || process.argv.includes("--produzione");
