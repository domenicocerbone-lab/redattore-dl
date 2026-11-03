// Importato per primo: carica .env prima che gli altri moduli leggano process.env.
try {
  process.loadEnvFile();
} catch {
  // Nessun file .env: si usano le variabili d'ambiente già presenti.
}

export const PRODUZIONE = process.env.NODE_ENV === "production" || process.argv.includes("--produzione");

/** Senza password dell'amministratore e fuori produzione l'accesso è libero, come in sviluppo e in demo. */
export const ACCESSO_LIBERO = !process.env.REDATTORE_PASSWORD_ADMIN && !PRODUZIONE;
