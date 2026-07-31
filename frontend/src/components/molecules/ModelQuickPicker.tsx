import { cn } from "@/utils/cn";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";
import { useAiSettingsStore } from "@/store/aiSettingsStore";
import { useUIStore } from "@/store/uiStore";
import { APP_VIEWS } from "@/types/domain";
import { IconClose } from "@/components/atoms/Icons";

interface ModelQuickPickerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * ModelQuickPicker — cambiar modelo y esfuerzo sin salir del chat.
 *
 * Deliberadamente FUERA del `ModePicker`: ese responde a otra pregunta ("qué
 * quiero escribir") y es el componente más delicado del responsive. Aquí se
 * responde a "con qué lo escribo".
 *
 * Solo lista lo que ya está en memoria: nada de refetch al abrir. Si la lista
 * está vacía, el enlace a los ajustes completos es la salida.
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

  if (!open) return null;

  const provider = providers.find((p) => p.id === settings.provider) ?? providers[0];
  const currentModel = settings.byProvider[settings.provider]?.model ?? "";
  // Solo si hay más de un proveedor con key: enseñar un selector de proveedor
  // a quien solo tiene uno configurado es ruido.
  const configured = providers.filter(
    (p) => settings.byProvider[p.id]?.apiKey,
  );

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
          <p className="font-ui text-xs font-medium uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
            Con qué respondo
          </p>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted-light dark:text-muted-dark"
          >
            <IconClose width={18} height={18} />
          </button>
        </div>

        {configured.length > 1 && (
          <Group label="Proveedor">
            {configured.map((p) => (
              <Chip
                key={p.id}
                active={p.id === settings.provider}
                onClick={() => setProvider(p.id)}
              >
                {p.label}
              </Chip>
            ))}
          </Group>
        )}

        {models.length > 0 && (
          <Group label="Modelo">
            <Chip active={!currentModel} onClick={() => setModel("")}>
              Por defecto
            </Chip>
            {models.slice(0, 8).map((m) => (
              <Chip
                key={m.id}
                active={m.id === currentModel}
                onClick={() => setModel(m.id)}
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
              active={effort.id === settings.effort}
              onClick={() => setEffort(effort.id)}
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
