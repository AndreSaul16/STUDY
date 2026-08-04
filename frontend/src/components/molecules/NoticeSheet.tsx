import { useCallback, useEffect, useId, useRef } from "react";
import { cn } from "@/utils/cn";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";
import { IconBook, IconClose } from "@/components/atoms/Icons";

/**
 * NoticeSheet — hoja que explica por qué algo todavía no se puede usar.
 *
 * Existe porque al desplegar hay tres realidades distintas y confundirlas es
 * mentir al usuario:
 *
 *  - `soon`: lo vamos a hacer nosotros. Es una promesa.
 *  - `action`: funciona, pero falta un paso que solo puede dar él. Es una
 *    instrucción.
 *  - `unavailable`: el tercero no lo ofrece y no está en nuestra mano. Es un
 *    hecho.
 *
 * Los tres se veían iguales cuando eran cuatro textos copiados: el mismo gris,
 * la misma frase. Así el usuario no sabe si esperar, si actuar o si olvidarse.
 * Por eso el tono no es solo la palabra —cambia el color, la etiqueta y el
 * título de la lista— y por eso `available` no es opcional por casualidad: un
 * aviso que solo dice «todavía no» y se cierra es un callejón sin salida, así
 * que cada uso tiene que decir qué SÍ se puede hacer hoy.
 *
 * z-[140]: por encima de BottomSheet (110) y de BottomNav (120), porque se
 * abre desde dentro del panel de investigación.
 */

export type NoticeTone = "soon" | "action" | "unavailable";

interface ToneStyle {
  /** Etiqueta corta: lo primero que se lee y lo que fija la expectativa. */
  eyebrow: string;
  /** Píldora de la etiqueta. El color es la señal a un golpe de vista. */
  chip: string;
  /** Icono del tema, teñido con el color del tono. */
  icon: string;
  /** Encabezado de la lista: cambia con el tono porque no dice lo mismo. */
  listTitle: string;
}

const TONES: Record<NoticeTone, ToneStyle> = {
  // Ámbar, el acento de la app: lo nuestro, lo que está en camino.
  soon: {
    eyebrow: "Próximamente",
    chip: "bg-amber-50 text-amber-800 dark:bg-amber-800/30 dark:text-amber-300",
    icon: "text-amber-700 dark:text-amber-400",
    listTitle: "Qué podrás hacer",
  },
  // Azul: el único tono que pide algo. Se distingue del ámbar a propósito,
  // para que no se lea como «ya llegará».
  action: {
    eyebrow: "Lo activas tú",
    chip: "bg-sky-100 text-sky-900 dark:bg-sky-400/20 dark:text-sky-200",
    icon: "text-sky-800 dark:text-sky-300",
    listTitle: "Cómo activarlo",
  },
  // Sin color: no hay nada que esperar ni que hacer. Es un dato.
  //
  // «Sin soporte» y no «No lo ofrece el proveedor», que era lo primero que
  // decía: a 320px la píldora partía en dos líneas y empujaba el título. Lo de
  // quién es la culpa lo explica la frase de debajo, que tiene sitio.
  unavailable: {
    eyebrow: "Sin soporte",
    chip: "bg-paper-200 text-reading-light dark:bg-ink-50 dark:text-reading-dark",
    icon: "text-muted-light dark:text-muted-dark",
    listTitle: "Lo que se comprobó",
  },
};

interface NoticeSheetProps {
  open: boolean;
  onClose: () => void;
  tone: NoticeTone;
  /** De qué función se habla. Da nombre al diálogo. */
  title: string;
  /** Icono del tema, no del tono: ubica de qué se habla. */
  icon: typeof IconBook;
  /** Una frase: qué es y en qué estado está de verdad. */
  lead: React.ReactNode;
  /** Lo que podrás hacer, lo que hay que hacer o lo que se comprobó. */
  bullets?: React.ReactNode[];
  /**
   * Lo que YA funciona hoy. Obligatorio: es lo que evita el callejón sin
   * salida y lo que convierte el aviso en algo útil.
   */
  available: { title: string; body: React.ReactNode };
  /** Atajo a eso que ya funciona, cuando está a un toque de distancia. */
  action?: { label: string; onClick: () => void };
}

/** Lo que puede recibir el foco dentro de la hoja, en orden de tabulación. */
function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  );
}

export function NoticeSheet({
  open,
  onClose,
  tone,
  title,
  icon: Icon,
  lead,
  bullets,
  available,
  action,
}: NoticeSheetProps) {
  const reducedMotion = usePrefersReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const style = TONES[tone];

  // Bloquear el scroll del fondo, igual que BottomSheet.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // El foco entra al abrir y VUELVE al botón que abrió la hoja al cerrarse.
  // Sin la devolución, quien navega con teclado acaba al principio del
  // documento y tiene que rehacer todo el camino.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, [open]);

  // Tab circula dentro de la hoja: detrás hay una pantalla entera de botones
  // que no deberían poder pulsarse mientras esto está encima.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const items = focusables(panelRef.current);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;

      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[140] flex flex-col justify-end sm:items-center sm:justify-center">
      <button
        aria-label="Cerrar aviso"
        onClick={onClose}
        // -1: el fondo no debe entrar en la tabulación, ya está el botón de
        // cerrar del encabezado. Sigue siendo pulsable con el dedo.
        tabIndex={-1}
        className="absolute inset-0 bg-ink-200/40 backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          "relative max-h-[88dvh] w-full overflow-y-auto outline-none",
          "rounded-t-2xl sm:max-w-md sm:rounded-2xl",
          "bg-paper-50 pb-[max(1rem,env(safe-area-inset-bottom))] dark:bg-ink-100",
          "sm:pb-4 sm:shadow-lift",
          !reducedMotion && "animate-sheet-up",
        )}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 bg-paper-50 px-4 pt-3 dark:bg-ink-100">
          <span
            className={cn(
              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              "bg-paper-200 dark:bg-ink-50",
              style.icon,
            )}
          >
            <Icon width={17} height={17} />
          </span>

          <div className="min-w-0 flex-1">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5",
                "font-ui text-[10px] font-medium uppercase tracking-[0.15em]",
                style.chip,
              )}
            >
              {style.eyebrow}
            </span>
            <h2
              id={titleId}
              className="mt-1.5 font-display text-xl leading-tight text-reading-light dark:text-reading-dark"
            >
              {title}
            </h2>
          </div>

          <button
            onClick={onClose}
            aria-label="Cerrar"
            className={cn(
              "-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
              "text-muted-light hover:bg-paper-200",
              "dark:text-muted-dark dark:hover:bg-ink-50",
            )}
          >
            <IconClose width={16} height={16} />
          </button>
        </div>

        <div className="px-4 pb-2 pt-2">
          <p className="font-ui text-[13px] leading-relaxed text-reading-light dark:text-reading-dark">
            {lead}
          </p>

          {bullets && bullets.length > 0 && (
            <>
              <p className="mt-4 font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-muted-light dark:text-muted-dark">
                {style.listTitle}
              </p>
              <ul className="mt-1.5 space-y-1.5 font-ui text-[12px] leading-relaxed text-muted-light dark:text-muted-dark">
                {bullets.map((bullet, i) => (
                  <li key={i}>· {bullet}</li>
                ))}
              </ul>
            </>
          )}

          <div className="mt-4 rounded-lg bg-paper-100 px-3 py-2.5 dark:bg-ink-50">
            <p className="font-ui text-[11px] font-medium text-reading-light dark:text-reading-dark">
              {available.title}
            </p>
            <p className="mt-1 font-ui text-[12px] leading-relaxed text-muted-light dark:text-muted-dark">
              {available.body}
            </p>

            {action && (
              <button
                onClick={() => {
                  action.onClick();
                  onClose();
                }}
                className={cn(
                  "mt-2.5 flex min-h-[44px] items-center rounded-lg px-4",
                  "font-ui text-xs font-medium",
                  "bg-amber-600 text-paper-50 hover:bg-amber-700",
                  "transition-colors duration-200 ease-[var(--ease-out-expo)]",
                  "active:scale-95 dark:bg-amber-700 dark:hover:bg-amber-600",
                )}
              >
                {action.label}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
