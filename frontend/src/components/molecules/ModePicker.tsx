import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { useIsMobile } from "@/hooks/useMediaQuery";
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
 * Móvil: un botón que abre una hoja inferior con filas de 56 px (el `hint` de
 * cada modo como subtítulo, que es lo que de verdad explica para qué sirve).
 * Escritorio: una fila de chips, que caben sin tapar nada.
 */
export function ModePicker({ value, onChange, className }: ModePickerProps) {
  const modes = useChatModes();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const current = modes.find((m) => m.id === value) ?? modes[0];

  if (!isMobile) {
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
              "shrink-0 rounded-full px-3 py-1.5 font-ui text-xs font-medium",
              "transition-colors duration-200 ease-[var(--ease-out-expo)]",
              mode.id === value
                ? "bg-amber-600 text-paper-50 dark:bg-amber-700"
                : "bg-paper-200 text-muted-light hover:text-reading-light dark:bg-ink-50 dark:text-muted-dark dark:hover:text-reading-dark",
            )}
          >
            {mode.label}
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
          "flex h-11 shrink-0 items-center gap-1 rounded-full px-3",
          "bg-paper-200 font-ui text-xs font-medium text-reading-light",
          "active:scale-95 transition-transform duration-150",
          "dark:bg-ink-50 dark:text-reading-dark",
          className,
        )}
      >
        <span className="max-w-[9rem] truncate">{current?.label ?? value}</span>
        <IconChevronDown width={14} height={14} className="opacity-60" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <button
            aria-label="Cerrar"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink-200/40 backdrop-blur-[2px]"
          />

          <div
            role="dialog"
            aria-label="Modo de redacción"
            className={cn(
              "relative max-h-[80dvh] overflow-y-auto rounded-t-2xl",
              "bg-paper-50 pb-[max(1rem,env(safe-area-inset-bottom))] dark:bg-ink-100",
              // El bloque global de prefers-reduced-motion ya la neutraliza.
              "animate-sheet-up",
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
