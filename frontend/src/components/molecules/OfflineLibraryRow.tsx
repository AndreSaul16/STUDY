import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { formatBytes } from "@/db/repositories/imagesRepository";
import { IconArrowDown } from "@/components/atoms/Icons";
import {
  cancelDownload,
  fetchOfflineStatus,
  followDownload,
  startBibleDownload,
} from "@/services/offlineClient";
import type { DownloadProgress, OfflineStatus } from "@/services/offlineClient";

/** "1.189" — separador de millares español, sin librerías. */
function miles(n: number): string {
  return n.toLocaleString("es-ES");
}

/** "1 h 12 min" a partir de los segundos que estima el backend. */
function humanEta(seconds: number): string {
  if (seconds <= 0) return "";
  const minutos = Math.round(seconds / 60);
  if (minutos < 60) return `${minutos} min`;
  return `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, "0")} min`;
}

/**
 * OfflineLibraryRow — descargar la Biblia entera de una vez.
 *
 * Hoy cada capítulo se raspa de wol.jw.org la primera vez que se abre, y son
 * varios segundos de espera justo cuando el usuario acaba de pedir un pasaje.
 * Esta fila cambia mil doscientas esperas pequeñas y mal colocadas por una
 * sola espera larga que el usuario decide cuándo pagar.
 *
 * El estado vive en el backend, no aquí: `/api/offline/status` dice cuántos
 * capítulos hay y si hay una descarga viva. Por eso salir de Ajustes y volver
 * reengancha la barra donde estaba en vez de ofrecer empezar otra vez, y no
 * hace falta guardar nada en el navegador.
 */
export function OfflineLibraryRow() {
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [eta, setEta] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refrescar = useCallback(async () => {
    const actual = await fetchOfflineStatus();
    if (actual) setStatus(actual);
    return actual;
  }, []);

  const seguir = useCallback(
    (id: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setJobId(id);

      void followDownload({
        jobId: id,
        signal: controller.signal,
        onEvent: (evento) => {
          if (evento.event === "plan") {
            const estimado = Number(evento.data.estimated_seconds ?? 0);
            setEta(Number.isFinite(estimado) ? estimado : 0);
          } else if (evento.event === "progress") {
            setProgress(evento.data as unknown as DownloadProgress);
          } else if (evento.event === "error") {
            setMessage("La descarga ha fallado.");
          } else if (evento.event === "done") {
            const cancelada = evento.data.cancelled === true;
            const fallidos = Number(evento.data.failed ?? 0);
            setJobId(null);
            setProgress(null);
            setMessage(
              cancelada
                ? "Descarga cancelada. Lo bajado se conserva."
                : fallidos > 0
                  ? `Descarga terminada. ${miles(fallidos)} capítulos no se pudieron bajar; vuelve a intentarlo y solo pedirá esos.`
                  : "La Biblia ya está descargada.",
            );
            void refrescar();
          }
        },
        onGone: () => {
          // El backend se reinició. No se pierde nada: lo descargado está en su
          // caché de disco y relanzar se lo salta.
          setJobId(null);
          setProgress(null);
          setMessage("La descarga se interrumpió. Puedes reanudarla.");
          void refrescar();
        },
        onError: (texto) => {
          setJobId(null);
          setProgress(null);
          setMessage(texto);
          void refrescar();
        },
      });
    },
    [refrescar],
  );

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const actual = await refrescar();
      // Reengancharse a la descarga que ya estaba corriendo antes de abrir
      // esta pantalla: el trabajo es del servidor, no de este componente.
      if (vivo && actual?.job_id) seguir(actual.job_id);
    })();
    return () => {
      vivo = false;
      abortRef.current?.abort();
    };
  }, [refrescar, seguir]);

  if (status === null || !status.cache_available) return null;

  const descargando = jobId !== null;
  const hechos = progress ? progress.done : 0;
  const totalTrabajo = progress?.total ?? status.total;
  const pct = descargando
    ? totalTrabajo > 0
      ? Math.min(100, Math.round((hechos / totalTrabajo) * 100))
      : 0
    : Math.round((status.cached / status.total) * 100);

  const empezar = async () => {
    setMessage(null);
    try {
      const iniciada = await startBibleDownload();
      setEta(iniciada.estimated_seconds);
      seguir(iniciada.job_id);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo empezar la descarga.",
      );
    }
  };

  const parar = async () => {
    if (!jobId) return;
    await cancelDownload(jobId);
  };

  return (
    <div className="flex min-h-[56px] w-full flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 font-ui text-sm text-reading-light dark:text-reading-dark">
          Biblia sin conexión
          <span className="ml-2 font-ui text-xs text-muted-light dark:text-muted-dark">
            {miles(status.cached)} de {miles(status.total)} capítulos
            {status.bytes > 0 && ` · ${formatBytes(status.bytes)}`}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-1">
          <button
            onClick={descargando ? () => void parar() : () => void empezar()}
            className={cn(
              "flex min-h-[44px] items-center rounded-full px-3 font-ui text-xs font-medium",
              descargando
                ? "text-muted-light hover:text-red-700 dark:text-muted-dark"
                : "text-amber-700 dark:text-amber-400",
            )}
          >
            {descargando
              ? "Cancelar"
              : status.complete
                ? "Completa"
                : "Descargar la Biblia"}
          </button>
          <IconArrowDown
            width={15}
            height={15}
            className="text-muted-light dark:text-muted-dark"
          />
        </span>
      </div>

      {/* La barra se pinta también en reposo: ver "quedan 300" es la única
          forma de saber que una descarga a medias se puede retomar. */}
      {(descargando || (!status.complete && status.cached > 0)) && (
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Capítulos descargados"
          className="h-1 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-ink-100"
        >
          <div
            className="h-full rounded-full bg-amber-600 transition-[width] duration-500 dark:bg-amber-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {descargando && (
        <p
          aria-live="polite"
          className="font-ui text-[11px] text-muted-light dark:text-muted-dark"
        >
          {progress?.label ? `${progress.label} · ` : ""}
          {miles(hechos)} de {miles(totalTrabajo)}
          {eta > 0 && ` · ≈${humanEta(eta)}`}
          {progress && progress.failed > 0 && ` · ${progress.failed} fallidos`}
          . Puedes salir de esta pantalla.
        </p>
      )}

      {message && (
        <p
          role="status"
          className="font-ui text-[11px] text-muted-light dark:text-muted-dark"
        >
          {message}
        </p>
      )}
    </div>
  );
}
