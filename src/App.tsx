import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { Salute } from "../shared/api";
import type { RifDocumento } from "../shared/schema";
import { Accesso } from "./components/Accesso";
import { Home } from "./components/Home";
import { Sidebar } from "./components/Sidebar";
import { VistaConversazione } from "./components/VistaConversazione";
import { api } from "./lib/api";
import { caricaSessione, cantieriConsentiti, suSessioneScaduta } from "./lib/sessione";

const Admin = lazy(() => import("./components/admin/Admin"));
const PaginaDocumenti = lazy(() => import("./components/documenti/PaginaDocumenti"));
const PaginaProfilo = lazy(() => import("./components/profilo/PaginaProfilo"));
const PaginaCantiere = lazy(() => import("./components/cantiere/PaginaCantiere"));

const CHIAVE_CANTIERE = "redattore-dl.cantiere";

type Vista =
  | { tipo: "home" }
  | { tipo: "admin" }
  | { tipo: "documenti" }
  | { tipo: "profilo" }
  | { tipo: "cantiere"; id: string }
  | { tipo: "conversazione"; id: string; documento: RifDocumento | null };

/** #/c/<conversazione>[/d/<documento>/<versione>], #/documenti, #/profilo, #/admin. */
function leggiRotta(): Vista {
  const h = window.location.hash;
  if (h.startsWith("#/admin")) return { tipo: "admin" };
  if (h.startsWith("#/documenti")) return { tipo: "documenti" };
  if (h.startsWith("#/profilo")) return { tipo: "profilo" };
  const cantiere = /^#\/cantieri\/([\w-]+)/.exec(h);
  if (cantiere) return { tipo: "cantiere", id: cantiere[1] };
  const m = /^#\/c\/([\w-]+)(?:\/d\/([\w-]+)\/(\d+))?/.exec(h);
  if (m) return { tipo: "conversazione", id: m[1], documento: m[2] ? { id: m[2], versione: Number(m[3]) } : null };
  return { tipo: "home" };
}

function cantiereSalvato(): string {
  const consentiti = cantieriConsentiti();
  try {
    const id = localStorage.getItem(CHIAVE_CANTIERE);
    if (id && consentiti.some((c) => c.id === id)) return id;
  } catch {
    // Archiviazione non disponibile: si usa il primo cantiere.
  }
  return consentiti[0]?.id ?? "";
}

/** Prima la sessione: senza, si mostra solo la schermata di accesso. */
export function App() {
  const [stato, setStato] = useState<"carico" | "fuori" | "dentro">("carico");

  const verifica = useCallback(() => {
    caricaSessione().then(
      (s) => setStato(s ? "dentro" : "fuori"),
      () => setStato("fuori"),
    );
  }, []);
  useEffect(verifica, [verifica]);
  useEffect(() => suSessioneScaduta(() => setStato("fuori")), []);

  if (stato === "carico") return null;
  if (stato === "fuori") return <Accesso onEntrato={verifica} />;
  return <Redattore />;
}

function Redattore() {
  const [vista, setVista] = useState(leggiRotta);
  const [cantiereId, setCantiereId] = useState(cantiereSalvato);
  const [barra, setBarra] = useState<"auto" | "completa" | "compatta">("auto");
  const [pannelloAperto, setPannelloAperto] = useState(false);
  const [menuMobile, setMenuMobile] = useState(false);
  const [salute, setSalute] = useState<Salute | null>(null);

  useEffect(() => {
    const aggiorna = () => {
      setVista(leggiRotta());
      setMenuMobile(false);
    };
    window.addEventListener("hashchange", aggiorna);
    return () => window.removeEventListener("hashchange", aggiorna);
  }, []);

  useEffect(() => {
    api.salute().then(setSalute, () => undefined);
  }, []);

  // Con la bozza aperta la barra si compatta, come nel design; il DL può riaprirla.
  useEffect(() => setBarra("auto"), [pannelloAperto]);
  const compatta = barra === "compatta" || (barra === "auto" && pannelloAperto);
  const onPannello = useCallback((aperto: boolean) => setPannelloAperto(aperto), []);

  const vai = (id: string | null) => {
    window.location.hash = id ? `#/c/${id}` : "#/";
    setVista(id ? { tipo: "conversazione", id, documento: null } : { tipo: "home" });
    setMenuMobile(false);
  };
  const idAttivo = vista.tipo === "conversazione" ? vista.id : null;

  if (vista.tipo === "admin") {
    return (
      <Suspense fallback={null}>
        <Admin onEsci={() => vai(null)} onApri={vai} />
      </Suspense>
    );
  }

  const cambiaCantiere = (id: string) => {
    setCantiereId(id);
    try {
      localStorage.setItem(CHIAVE_CANTIERE, id);
    } catch {
      // Ricordarlo è solo una comodità.
    }
  };

  return (
    <div className="app">
      <Sidebar
        compatta={compatta}
        apertaSuMobile={menuMobile}
        idAttivo={idAttivo}
        sezione={vista.tipo}
        cantiereId={cantiereId}
        onCompatta={(c) => setBarra(c ? "compatta" : "completa")}
        onChiudiMobile={() => setMenuMobile(false)}
        onNuovo={() => vai(null)}
        onApri={vai}
        onCantiere={(id) => {
          cambiaCantiere(id);
          vai(null);
        }}
      />
      <div className="app__contenuto">
        {salute && !salute.chiaveApi && (
          <div className="avviso" role="alert">
            Manca la chiave dell'API Claude: imposta <code>ANTHROPIC_API_KEY</code> (nel file <code>.env</code> in
            locale, tra le variabili del servizio online) e riavvia il server.
          </div>
        )}
        {vista.tipo === "documenti" || vista.tipo === "profilo" || vista.tipo === "cantiere" ? (
          <Suspense fallback={null}>
            {vista.tipo === "documenti" ? (
              <PaginaDocumenti onApriMenu={() => setMenuMobile(true)} />
            ) : vista.tipo === "cantiere" ? (
              <PaginaCantiere
                id={vista.id}
                onApriMenu={() => setMenuMobile(true)}
                onUsa={(id) => {
                  cambiaCantiere(id);
                  vai(null);
                }}
              />
            ) : (
              <PaginaProfilo onApriMenu={() => setMenuMobile(true)} />
            )}
          </Suspense>
        ) : vista.tipo === "conversazione" ? (
          <VistaConversazione
            id={vista.id}
            documentoIniziale={vista.documento}
            onApriMenu={() => setMenuMobile(true)}
            onNuovo={() => vai(null)}
            onPannello={onPannello}
          />
        ) : (
          <Home
            cantiereId={cantiereId}
            onCantiere={cambiaCantiere}
            onApriMenu={() => setMenuMobile(true)}
            onAperta={vai}
          />
        )}
      </div>
    </div>
  );
}
