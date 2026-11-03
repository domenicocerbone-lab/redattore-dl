// Catalogo dei documenti che il Redattore DL sa preparare.
// `campi` sono i dati obbligatori che il Redattore raccoglie prima della bozza,
// `facoltativi` quelli che chiede solo se utili.

export type IconaDocumento =
  | "calendario"
  | "metro"
  | "barre"
  | "occhio"
  | "documento"
  | "attenzione"
  | "persone"
  | "righe"
  | "scudo"
  | "pausa"
  | "play"
  | "bandiera"
  | "foto";

export interface TipoDocumento {
  id: string;
  nome: string;
  /** Etichetta nei chip della home, se diversa dal nome. */
  chip?: string;
  /** Prefisso del titolo in cronologia, es. «Giornale 28/10 · Lotto B». */
  breve: string;
  icona: IconaDocumento;
  /** Documenti che segnalano un problema: icona e pillola in arancio. */
  attenzione?: boolean;
  /** Mostrato solo sotto «Altro». */
  altro?: boolean;
  campi: string[];
  facoltativi: string[];
  segnaposto: string;
}

export const TIPI_DOCUMENTO: TipoDocumento[] = [
  {
    id: "giornale_lavori",
    nome: "Giornale dei lavori",
    breve: "Giornale",
    icona: "calendario",
    campi: [
      "Data",
      "Meteo",
      "Maestranze",
      "Lavorazioni",
      "Forniture",
      "Mezzi",
      "Disposizioni DL",
    ],
    facoltativi: ["Annotazioni"],
    segnaposto:
      "Racconta cosa è successo in cantiere: meteo, imprese presenti, lavorazioni, consegne, misure…",
  },
  {
    id: "libretto_misure",
    nome: "Libretto delle misure",
    breve: "Libretto misure",
    icona: "metro",
    campi: ["Data", "Voce di computo", "Posizione", "Dimensioni", "Unità di misura"],
    facoltativi: ["Deduzioni", "Annotazioni"],
    segnaposto: "Detta o scrivi le misure: «solaio P2, campata A 8,40 per 6,20…»",
  },
  {
    id: "sal",
    nome: "Stato di avanzamento lavori",
    chip: "SAL",
    breve: "SAL",
    icona: "barre",
    campi: [
      "Numero SAL",
      "Data di riferimento",
      "Quantità dal libretto",
      "Prezzi contrattuali",
      "Ribasso d'asta",
      "Oneri della sicurezza",
      "Acconti precedenti",
    ],
    facoltativi: ["Recupero anticipazione"],
    segnaposto: "Indica numero e data del SAL e gli importi dei SAL precedenti…",
  },
  {
    id: "verbale_sopralluogo",
    nome: "Verbale di sopralluogo",
    breve: "Sopralluogo",
    icona: "occhio",
    campi: ["Data e ora", "Luogo", "Presenti", "Oggetto", "Constatazioni", "Prescrizioni"],
    facoltativi: ["Osservazioni dell'esecutore", "Allegati"],
    segnaposto: "Racconta il sopralluogo: chi c'era, cosa hai visto, cosa hai chiesto…",
  },
  {
    id: "ordine_servizio",
    nome: "Ordine di servizio",
    breve: "Ordine di servizio",
    icona: "documento",
    campi: ["Numero", "Data", "Destinatario", "Oggetto", "Disposizioni", "Termine"],
    facoltativi: ["Motivazione", "Riferimenti contrattuali"],
    segnaposto: "Cosa deve fare l'impresa, entro quando e perché…",
  },
  {
    id: "non_conformita",
    nome: "Rapporto di non conformità",
    chip: "Non conformità",
    breve: "NC",
    icona: "attenzione",
    attenzione: true,
    campi: [
      "Lavorazione",
      "Elementi",
      "Requisito di riferimento",
      "Evidenze",
      "Classificazione",
      "Azione correttiva",
    ],
    facoltativi: ["Trattamento immediato", "Foto"],
    segnaposto: "Descrivi la difformità: dove, cosa hai misurato, cosa prevede il progetto…",
  },
  {
    id: "riunione_cantiere",
    nome: "Verbale di riunione di cantiere",
    chip: "Riunione di cantiere",
    breve: "Riunione",
    icona: "persone",
    campi: ["Data", "Presenti", "Ordine del giorno", "Decisioni", "Azioni e scadenze"],
    facoltativi: ["Prossima riunione"],
    segnaposto: "Chi c'era, di cosa avete parlato, cosa avete deciso…",
  },
  {
    id: "report_avanzamento",
    nome: "Report di avanzamento",
    breve: "Report",
    icona: "righe",
    campi: ["Periodo", "Avanzamento per lavorazione", "Criticità", "Programma successivo"],
    facoltativi: ["Ritardi e cause"],
    segnaposto: "Periodo del report, lavorazioni avanzate, criticità…",
  },
  {
    id: "segnalazione_cse",
    nome: "Segnalazione al CSE",
    breve: "Segnalazione CSE",
    icona: "scudo",
    attenzione: true,
    altro: true,
    campi: ["Data", "Situazione riscontrata", "Posizione", "Evidenze"],
    facoltativi: ["Richiesta"],
    segnaposto: "Cosa hai visto, dove, e cosa chiedi al coordinatore…",
  },
  {
    id: "verbale_sospensione",
    nome: "Verbale di sospensione dei lavori",
    breve: "Sospensione",
    icona: "pausa",
    altro: true,
    campi: ["Data", "Motivazione", "Stato dei lavori", "Presenti"],
    facoltativi: ["Mezzi in cantiere", "Cautele disposte"],
    segnaposto: "Da quando si sospende, per quale motivo, a che punto sono i lavori…",
  },
  {
    id: "verbale_ripresa",
    nome: "Verbale di ripresa dei lavori",
    breve: "Ripresa",
    icona: "play",
    altro: true,
    campi: ["Data", "Cessazione della causa", "Nuovo termine", "Presenti"],
    facoltativi: [],
    segnaposto: "Da quando riprendono i lavori e perché la causa è cessata…",
  },
  {
    id: "certificato_ultimazione",
    nome: "Certificato di ultimazione dei lavori",
    breve: "Ultimazione",
    icona: "bandiera",
    altro: true,
    campi: ["Data di ultimazione", "Presenti", "Lavorazioni marginali"],
    facoltativi: ["Termine per le lavorazioni marginali"],
    segnaposto: "Data di ultimazione e lavorazioni marginali ancora da completare…",
  },
  {
    id: "altro",
    nome: "Altro documento",
    breve: "Documento",
    icona: "documento",
    altro: true,
    campi: [],
    facoltativi: [],
    segnaposto: "Descrivi il documento che ti serve…",
  },
];

/** Modalità speciale: niente tipo scelto, il Redattore propone le bozze dalle foto. */
export const MODALITA_FOTO = {
  id: "foto",
  nome: "Bozze dalle foto",
  breve: "Foto",
  icona: "foto" as IconaDocumento,
  segnaposto: "Aggiungi contesto: «in F4 è il bagno 1.3»…",
};

/** Modalità speciale: revisione della scheda del cantiere in chat, dopo la lettura dei documenti. */
export const MODALITA_REVISIONE = {
  id: "revisione_cantiere",
  nome: "Revisione della scheda",
  breve: "Revisione scheda",
  icona: "righe" as IconaDocumento,
  segnaposto: "Rispondi o correggi: «il CSE è il geom. Bianchi»…",
};

export const ID_TIPI = TIPI_DOCUMENTO.map((t) => t.id) as [string, ...string[]];

export function tipoDocumento(id: string | undefined): TipoDocumento | undefined {
  return TIPI_DOCUMENTO.find((t) => t.id === id);
}

export function nomeModalita(id: string): string {
  if (id === MODALITA_FOTO.id) return MODALITA_FOTO.nome;
  if (id === MODALITA_REVISIONE.id) return MODALITA_REVISIONE.nome;
  return tipoDocumento(id)?.nome ?? "Nuovo report";
}
