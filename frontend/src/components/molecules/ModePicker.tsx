import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { useIsDesktop, usePrefersReducedMotion } from "@/hooks/useMediaQuery";
import { fetchChatModes } from "@/services/chatClient";
import { FALLBACK_CHAT_MODES, type ChatMode } from "@/types/chat";
import { IconChevronDown, IconClose } from "@/components/atoms/Icons";

/**
 * Catálogo de modos compartido por toda la app.
 *
 * Se pide una vez y se guarda en memoria del módulo: el composer, el cajón de
 * conversaciones y los ajustes lo necesitan, y no tiene sentido pedirlo tres
 * veces ni montar un store para un dato que no cambia.
 */
let cachedModes: ChatMode[] | null = null;
let inFlight: Promise<ChatMode[]> | null = null;

export function useChatModes(): ChatMode[] {
  const [modes, setModes] = useState<ChatMode[]>(cachedModes ?? FALLBACK_CHAT_MODES);

  useEffect(() => {
    if (cachedModes) return;
    let cancelled = false;

    inFlight ??= fetchChatModes().then((r) => {
      cachedModes = r.modes;
      inFlight = null;
      return r.modes;
    });

    void inFlight.then((next) => {
      if (!cancelled) setModes(next);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return modes;
}

interface ModePickerProps {
  value: string;
  onChange: (mode: string) => void;
  className?: string;
}

/**
 * ModePicker — selector del modo de redacción.
 *
 * Móvil y tablet: un botón que abre una hoja inferior con filas de 56 px (el
 * `hint` de cada modo como subtítulo, que es lo que de verdad explica para qué
 * sirve). Escritorio holgado (≥1150px): una fila de chips.
 *
 * El corte está en 1150 y no en 768 porque en la franja de tablet la columna
 * del chat mide ~420px: los cinco chips no caben, quedan en 28px de alto (por
 * debajo del mínimo táctil) y hay que arrastrarlos de lado para ver el último.
 */
export function ModePicker({ value, onChange, className }: ModePickerProps) {
  const modes = useChatModes();
  const isDesktop = useIsDesktop();
  const reducedMotion = usePrefersReducedMotion();
  const [open, setOpen] = useState(false);

  const current = modes.find((m) => m.id === value) ?? modes[0];

  if (isDesktop) {
    return (
      <div
        className={cn(
          "flex items-center gap-1 overflow-x-auto",
          "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
          className,
        )}
        role="radiogroup"
        aria-label="Modo de redacción"
      >
        {modes.map((mode) => (
          <button
            key={mode.id}
            role="radio"
            aria-checked={mode.id === value}
            title={mode.hint}
            onClick={() => onChange(mode.id)}
            className={cn(
              "flex h-9 shrink-0 items-center rounded-full px-3 font-ui text-xs font-medium",
              "transition-colors duration-200 ease-[var(--ease-out-expo)]",
              mode.id === value
                ? "bg-amber-600 text-paper-50 dark:bg-amber-700"
                : "bg-paper-200 text-muted-light hover:text-reading-light dark:bg-ink-50 dark:text-muted-dark dark:hover:text-reading-dark",
            )}
          >
            {mode.label}
            {mode.deep && <span className="ml-1 opacity-70">≈4 min</span>}
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Modo de redacción: ${current?.label ?? value}`}
        className={cn(
          "flex h-11 min-w-0 shrink items-center gap-1 rounded-full px-3 short:h-10",
          "bg-paper-200 font-ui text-xs font-medium text-reading-light",
          "active:scale-95 transition-transform duration-150",
          "dark:bg-ink-50 dark:text-reading-dark",
          className,
        )}
      >
        <span className="min-w-0 max-w-[9rem] truncate">{current?.label ?? value}</span>
        <IconChevronDown width={14} height={14} className="shrink-0 opacity-60" />
      </button>

      {/* z por encima de BottomNav (z-120): con z-50 la barra inferior tapaba
          la última fila de la hoja y el modo de abajo no se podía elegir. */}
      {open && (
        <div className="fixed inset-0 z-[130] flex flex-col justify-end">
          <button
            aria-label="Cerrar"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink-200/40 backdrop-blur-[2px]"
          />

          <div
            role="dialog"
            aria-label="Modo de redacción"
            className={cn(
              "relative max-h-[80dvh] overflow-y-auto rounded-t-2xl short:max-h-[92dvh]",
              "bg-paper-50 pb-[max(1rem,env(safe-area-inset-bottom))] dark:bg-ink-100",
              // Mismo criterio que BottomSheet: quien pide menos movimiento no
              // recibe el deslizamiento, aparece y ya.
              !reducedMotion && "animate-sheet-up",
            )}
          >
            <div className="sticky top-0 flex items-center justify-between bg-paper-50 px-4 py-3 dark:bg-ink-100">
              <p className="font-ui text-xs font-medium uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
                Qué quieres escribir
              </p>
              <button
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="flex h-11 w-11 items-center justify-center rounded-full text-muted-light dark:text-muted-dark"
              >
                <IconClose width={18} height={18} />
              </button>
            </div>

            <ul className="px-2 pb-2">
              {modes.map((mode) => (
                <li key={mode.id}>
                  <button
                    onClick={() => {
                      onChange(mode.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex min-h-[56px] w-full flex-col justify-center gap-0.5 rounded-xl px-3 py-2 text-left",
                      mode.id === value
                        ? "bg-amber-50 dark:bg-amber-800/20"
                        : "active:bg-paper-200 dark:active:bg-ink-50",
                    )}
                  >
                    <span
                      className={cn(
                        "font-ui text-sm font-medium",
                        mode.id === value
                          ? "text-amber-800 dark:text-amber-300"
                          : "text-reading-light dark:text-reading-dark",
                      )}
                    >
                      {mode.label}
                    </span>
                    <span className="font-ui text-xs text-muted-light dark:text-muted-dark">
                      {mode.hint}
                    </span>
                    {/* La investigación profunda tarda minutos y cuesta más:
                        decirlo aquí evita que se elija por curiosidad. */}
                    {mode.deep && (
                      <span className="mt-0.5 font-ui text-[11px] text-amber-700 dark:text-amber-400">
                        ≈4 min · consulta muchas más publicaciones; puedes
                        cerrar la app y volver
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
