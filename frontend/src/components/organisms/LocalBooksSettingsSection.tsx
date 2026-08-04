import { useEffect, useState } from "react";

import { cn } from "@/utils/cn";
import { useAiSettingsStore } from "@/store/aiSettingsStore";
import { useUIStore } from "@/store/uiStore";
import { listPublications, type StoredPublication } from "@/services/libraryCache";
import { LOCAL_SEARCH_LIMITS } from "@/services/localLibrarySearch";
import { APP_VIEWS, RESEARCH_TABS } from "@/types/domain";
import { IconBook, IconCheck, IconSparkle } from "@/components/atoms/Icons";
import { NoticeSheet } from "@/components/molecules/NoticeSheet";

/**
 * LocalBooksSettingsSection — qué libros tuyos puede leer el chat.
 *
 * El agente corre en el servidor y tus .jwpub están en este navegador, así que
 * por defecto no los ve. Marcar uno aquí autoriza que, en cada pregunta, la app
 * busque en él y **mande los fragmentos que encuentre al proveedor de IA**.
 *
 * Esa frase es la sección entera. Igual que en `ResearchSettingsSection`, la
 * advertencia no es un texto de ayuda que se pueda saltar: es lo que el usuario
 * está autorizando, y por eso está siempre a la vista cuando hay algo marcado,
 * no escondida detrás de un icono de información.
 *
 * Con la biblioteca vacía no se pinta una lista en blanco —que solo comunica
 * "aquí no hay nada y no sé por qué"— sino el camino para arreglarlo.
 */
export function LocalBooksSettingsSection() {
  const marcados = useAiSettingsStore((s) => s.settings.localBooks);
  const toggle = useAiSettingsStore((s) => s.toggleLocalBook);

  const setView = useUIStore((s) => s.setView);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const setSheetOpen = useUIStore((s) => s.setMobileSheetOpen);

  const [publicaciones, setPublicaciones] = useState<StoredPublication[] | null>(null);
  const [avisoInvestigacion, setAvisoInvestigacion] = useState(false);

  // Se lee al montar y no en un store global: la biblioteca cambia poco y solo
  // esta pantalla la necesita listada. Un store más para esto sería estado
  // duplicado que habría que invalidar cada vez que se sube un .jwpub.
  useEffect(() => {
    let vigente = true;
    void listPublications().then((todas) => {
      if (vigente) setPublicaciones(todas);
    });
    return () => {
      vigente = false;
    };
  }, []);

  const abrirBiblioteca = () => {
    setActiveTab(RESEARCH_TABS.LIBRARY);
    setSheetOpen(true);
    setView(APP_VIEWS.READ);
  };

  const total = publicaciones?.length ?? 0;
  const activos = marcados.length;

  return (
    <section className="mt-8" aria-labelledby="ajustes-biblioteca">
      <h2
        id="ajustes-biblioteca"
        className="font-ui text-xs font-medium uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400"
      >
        Tus publicaciones
      </h2>

      <div className="mt-3 rounded-xl border border-seam-light px-4 py-3 dark:border-seam-dark">
        <p className="font-ui text-sm text-reading-light dark:text-reading-dark">
          Responder también con mis libros
        </p>
        {/* «del chat» va en la frase, no solo en el aviso: quien no lo pulse
            tiene que enterarse igual de hasta dónde llega esto. */}
        <p className="mt-1 font-ui text-[11px] leading-relaxed text-muted-light dark:text-muted-dark">
          Marca las publicaciones .jwpub que has cargado en este dispositivo.
          Antes de cada respuesta del chat, la app buscará en ellas y le pasará
          a la IA los fragmentos que tengan que ver con tu pregunta.
        </p>

        <button
          onClick={() => setAvisoInvestigacion(true)}
          className={cn(
            "mt-2 flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3",
            "border border-dashed border-seam-light text-left",
            "transition-colors duration-200 ease-[var(--ease-out-expo)]",
            "hover:border-amber-600 dark:border-seam-dark dark:hover:border-amber-600",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500",
          )}
        >
          <IconSparkle
            width={14}
            height={14}
            className="shrink-0 text-amber-700 dark:text-amber-400"
          />
          <span className="min-w-0 flex-1 font-ui text-[11px] text-reading-light dark:text-reading-dark">
            En la investigación profunda todavía no
          </span>
          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-amber-800 dark:bg-amber-800/30 dark:text-amber-300">
            Próximamente
          </span>
        </button>

        {publicaciones === null ? (
          <p className="mt-3 font-ui text-[11px] text-muted-light dark:text-muted-dark">
            Leyendo tu biblioteca…
          </p>
        ) : total === 0 ? (
          <div className="mt-3 rounded-lg bg-paper-100 px-3 py-2.5 dark:bg-ink-50">
            <p className="font-ui text-[11px] leading-relaxed text-muted-light dark:text-muted-dark">
              Todavía no has cargado ninguna publicación en este navegador. Sube
              un archivo .jwpub y aparecerá aquí para poder marcarlo.
            </p>
            <button
              onClick={abrirBiblioteca}
              className={cn(
                "mt-2 flex min-h-[36px] items-center gap-1.5 rounded-lg px-3",
                "font-ui text-xs font-medium",
                "bg-amber-600 text-paper-50 hover:bg-amber-700",
                "transition-colors duration-200 ease-[var(--ease-out-expo)]",
                "active:scale-95 dark:bg-amber-700 dark:hover:bg-amber-600",
              )}
            >
              <IconBook width={13} height={13} />
              Ir a Biblioteca
            </button>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-seam-light dark:divide-seam-dark">
            {publicaciones.map((entrada) => {
              const marcado = marcados.includes(entrada.symbol);
              return (
                <li key={entrada.symbol}>
                  {/* `role="checkbox"` sobre un botón y no un `<input>`: la
                      casilla nativa mide 24 px y en un móvil se falla al
                      pulsarla. Mismo criterio que `SwitchRow`. */}
                  <button
                    role="checkbox"
                    aria-checked={marcado}
                    onClick={() => toggle(entrada.symbol)}
                    className={cn(
                      "flex min-h-[48px] w-full items-center justify-between gap-3 py-2 text-left",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-ui text-sm text-reading-light dark:text-reading-dark">
                        {entrada.publication?.title || entrada.symbol}
                      </span>
                      <span className="block font-ui text-[11px] text-muted-light dark:text-muted-dark">
                        {entrada.symbol}
                        {entrada.publication?.year ? ` · ${entrada.publication.year}` : ""}
                        {` · ${entrada.documents?.length ?? 0} documentos`}
                      </span>
                    </span>

                    <span
                      aria-hidden
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                        "transition-colors duration-200 ease-[var(--ease-out-expo)]",
                        marcado
                          ? "bg-amber-600 text-paper-50 dark:bg-amber-700"
                          : "border border-seam-light dark:border-seam-dark",
                      )}
                    >
                      {marcado && <IconCheck width={14} height={14} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {activos > 0 && (
          <div className="mt-3 rounded-lg bg-paper-100 px-3 py-2.5 dark:bg-ink-50">
            <p className="font-ui text-[11px] font-medium text-reading-light dark:text-reading-dark">
              Qué implica tener {activos === 1 ? "un libro marcado" : `${activos} libros marcados`}
            </p>
            <ul className="mt-1.5 space-y-1 font-ui text-[11px] leading-relaxed text-muted-light dark:text-muted-dark">
              <li>
                · En cada pregunta se buscan tus términos en esos libros y los
                fragmentos encontrados SE ENVÍAN al proveedor de IA que tengas
                configurado, junto con tu mensaje.
              </li>
              <li>
                · Nunca se sube la publicación entera: como máximo{" "}
                {LOCAL_SEARCH_LIMITS.maxSnippets} fragmentos de{" "}
                {LOCAL_SEARCH_LIMITS.maxSnippetChars} caracteres. Si no hay
                coincidencias, no se envía nada.
              </li>
              <li>
                · El libro sigue guardado solo en este navegador. Desmarcarlo
                corta el envío desde la siguiente pregunta.
              </li>
              <li>
                · La IA citará esos fragmentos como cualquier otra publicación y
                los verás como fuentes debajo de la respuesta.
              </li>
            </ul>
          </div>
        )}
      </div>

      {/* El silencio era el problema: la investigación profunda ignoraba estos
          libros sin decir nada, y el usuario los daba por usados. */}
      <NoticeSheet
        open={avisoInvestigacion}
        onClose={() => setAvisoInvestigacion(false)}
        tone="soon"
        title="Tus libros en la investigación profunda"
        icon={IconSparkle}
        lead="La investigación profunda todavía no lee tus publicaciones: hoy las ignora, y hasta ahora lo hacía sin avisar. Solo consulta jw.org y wol.jw.org."
        bullets={[
          "Que el informe busque en tus .jwpub en cada paso del plan, no solo con la primera pregunta.",
          "Que los cite igual que cita cualquier publicación de jw.org.",
          "Que aparezcan en la lista de fuentes del informe, para poder comprobarlos.",
        ]}
        available={{
          title: "Lo que ya funciona",
          body: "En el chat normal está hecho: los libros que marques aquí se buscan en cada pregunta y la IA cita los fragmentos que encuentra. Si lo que quieres es preguntar por tus publicaciones, hazlo desde el chat.",
        }}
        action={{
          label: "Ir al chat",
          onClick: () => setView(APP_VIEWS.CHAT),
        }}
      />
    </section>
  );
}
