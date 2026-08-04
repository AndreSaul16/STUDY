import { useEffect } from "react";
import { cn } from "@/utils/cn";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";
import { useAiSettingsStore } from "@/store/aiSettingsStore";
import { useChatStore } from "@/store/chatStore";
import { useUIStore } from "@/store/uiStore";
import { APP_VIEWS } from "@/types/domain";
import { IconClose } from "@/components/atoms/Icons";
import type { ConversationAi } from "@/types/chat";

interface ModelQuickPickerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * ModelQuickPicker — con qué responde ESTA conversación.
 *
 * Deliberadamente FUERA del `ModePicker`: ese responde a otra pregunta ("qué
 * quiero escribir") y es el componente más delicado del responsive. Aquí se
 * responde a "con qué lo escribo".
 *
 * ── Qué cambia y dónde ──
 *
 * Lo que se elige aquí se guarda en la CONVERSACIÓN abierta (su fila de
 * `conversations`), que es lo que permite tener una con GPT y otra con Gemini
 * a la vez. Y se copia además a los ajustes globales, que son la plantilla de
 * las conversaciones nuevas: con un solo chat abierto —el caso normal— el
 * comportamiento es exactamente el de antes, y con varios cada uno conserva lo
 * suyo porque el cambio solo toca la conversación activa. Sin conversación
 * abierta solo quedan los ajustes globales, que es lo único que hay.
 *
 * ── Por qué el proveedor mueve también el global ──
 *
 * El catálogo de modelos de `aiSettingsStore` es UNA lista, la del proveedor
 * activo. Si la conversación fuera por su cuenta, el selector enseñaría los
 * modelos de un proveedor y los chips resaltados serían de otro. Por eso al
 * abrir se alinea el proveedor global con el de la conversación, y elegir
 * proveedor aquí lo cambia en los dos sitios.
 *
 * Solo lista lo que ya está en memoria: nada de refetch al abrir salvo el que
 * dispara ese realineamiento. Si la lista está vacía, el enlace a los ajustes
 * completos es la salida.
 *
 * z-[130] igual que el ModePicker y el cajón de conversaciones: por encima de
 * BottomNav (z-120), que si no tapa la última fila de la hoja.
 */
export function ModelQuickPicker({ open, onClose }: ModelQuickPickerProps) {
  const settings = useAiSettingsStore((s) => s.settings);
  const providers = useAiSettingsStore((s) => s.providers);
  const models = useAiSettingsStore((s) => s.models);
  const setProvider = useAiSettingsStore((s) => s.setProvider);
  const setModel = useAiSettingsStore((s) => s.setModel);
  const setEffort = useAiSettingsStore((s) => s.setEffort);
  const setView = useUIStore((s) => s.setView);
  const reducedMotion = usePrefersReducedMotion();

  const conversationId = useChatStore((s) => s.activeId);
  const sessionAi = useChatStore((s) =>
    s.activeId ? (s.sessions[s.activeId]?.ai ?? null) : null,
  );

  // Cada campo cae al ajuste global cuando la conversación no lo tiene: es el
  // caso de todas las creadas antes de que esto existiera.
  const providerId = sessionAi?.provider || settings.provider;
  const currentModel =
    sessionAi?.model || (settings.byProvider[providerId]?.model ?? "");
  const currentEffort = sessionAi?.effort || settings.effort;

  useEffect(() => {
    if (!open) return;
    const store = useAiSettingsStore.getState();
    if (providerId && providerId !== store.settings.provider) {
      store.setProvider(providerId);
    }
  }, [open, providerId]);

  if (!open) return null;

  const provider = providers.find((p) => p.id === providerId) ?? providers[0];
  // Solo si hay más de un proveedor con key: enseñar un selector de proveedor
  // a quien solo tiene uno configurado es ruido.
  const configured = providers.filter(
    (p) => settings.byProvider[p.id]?.apiKey,
  );

  /** A la conversación abierta; si no hay ninguna, solo al global. */
  const apply = (patch: Partial<ConversationAi>) => {
    if (conversationId) useChatStore.getState().setSessionAi(patch);
  };

  const pickProvider = (id: string) => {
    setProvider(id);
    // El modelo del proveedor anterior no existe en el nuevo: se vuelve al
    // "por defecto" en vez de mandar un id que ese proveedor va a rechazar.
    apply({ provider: id, model: null });
  };

  const pickModel = (id: string) => {
    setModel(id);
    apply({ model: id || null });
  };

  const pickEffort = (id: string) => {
    setEffort(id);
    apply({ effort: id });
  };

  return (
    <div className="fixed inset-0 z-[130] flex flex-col justify-end">
      <button
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 bg-ink-200/40 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-label="Modelo y esfuerzo"
        className={cn(
          "relative max-h-[80dvh] overflow-y-auto rounded-t-2xl short:max-h-[92dvh]",
          "bg-paper-50 pb-[max(1rem,env(safe-area-inset-bottom))] dark:bg-ink-100",
          !reducedMotion && "animate-sheet-up",
        )}
      >
        <div className="sticky top-0 flex items-center justify-between bg-paper-50 px-4 py-3 dark:bg-ink-100">
          <div className="min-w-0">
            <p className="font-ui text-xs font-medium uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
              Con qué respondo
            </p>
            {conversationId && (
              <p className="mt-0.5 font-ui text-[11px] text-muted-light dark:text-muted-dark">
                Se aplica a esta conversación
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-light dark:text-muted-dark"
          >
            <IconClose width={18} height={18} />
          </button>
        </div>

        {configured.length > 1 && (
          <Group label="Proveedor">
            {configured.map((p) => (
              <Chip
                key={p.id}
                active={p.id === providerId}
                onClick={() => pickProvider(p.id)}
              >
                {p.label}
              </Chip>
            ))}
          </Group>
        )}

        {models.length > 0 && (
          <Group label="Modelo">
            <Chip active={!currentModel} onClick={() => pickModel("")}>
              Por defecto
            </Chip>
            {models.slice(0, 8).map((m) => (
              <Chip
                key={m.id}
                active={m.id === currentModel}
                onClick={() => pickModel(m.id)}
                title={m.id}
              >
                {m.id}
              </Chip>
            ))}
          </Group>
        )}

        <Group label="Esfuerzo">
          {(provider?.efforts ?? []).map((effort) => (
            <Chip
              key={effort.id}
              active={effort.id === currentEffort}
              onClick={() => pickEffort(effort.id)}
            >
              {effort.label}
            </Chip>
          ))}
        </Group>

        <div className="px-4 pb-2 pt-1">
          <button
            onClick={() => {
              onClose();
              setView(APP_VIEWS.MORE);
            }}
            className="flex min-h-[44px] items-center font-ui text-xs font-medium text-amber-700 dark:text-amber-400"
          >
            Ajustes completos →
          </button>
        </div>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-2">
      <p className="font-ui text-[11px] uppercase tracking-[0.15em] text-muted-light dark:text-muted-dark">
        {label}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      role="radio"
      aria-checked={active}
      onClick={onClick}
      title={title}
      className={cn(
        // `max-w-full truncate`: los ids de modelo pueden ser larguísimos y en
        // una pantalla de 320px un chip solo partía el nombre en dos líneas.
        "flex min-h-[44px] max-w-full items-center rounded-full px-3",
        "font-ui text-xs font-medium",
        active
          ? "bg-amber-600 text-paper-50 dark:bg-amber-700"
          : "bg-paper-200 text-muted-light hover:text-reading-light dark:bg-ink-50 dark:text-muted-dark dark:hover:text-reading-dark",
      )}
    >
      <span className="truncate">{children}</span>
    </button>
  );
}
