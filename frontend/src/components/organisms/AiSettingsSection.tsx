import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { useAiSettingsStore } from "@/store/aiSettingsStore";
import {
  CUSTOM_MODEL_VALUE,
  shortModelLabel,
  type AiModel,
} from "@/types/aiSettings";
import { IconChevronDown } from "@/components/atoms/Icons";

/**
 * AiSettingsSection — proveedor, API key, modelo y esfuerzo.
 *
 * Escalera de cuatro peldaños: cada uno desbloquea el siguiente. Sin key no
 * hay lista de modelos que enseñar, y un desplegable vacío es peor que un
 * desplegable ausente.
 *
 * Reutiliza las clases del bloque `Settings` de `MoreScreen` a propósito: el
 * responsive está cerrado y esta sección no introduce ni un layout nuevo.
 */
export function AiSettingsSection() {
  const settings = useAiSettingsStore((s) => s.settings);
  const providers = useAiSettingsStore((s) => s.providers);
  const server = useAiSettingsStore((s) => s.server);
  const models = useAiSettingsStore((s) => s.models);
  const modelsLoading = useAiSettingsStore((s) => s.modelsLoading);
  const modelsError = useAiSettingsStore((s) => s.modelsError);
  const modelsNotice = useAiSettingsStore((s) => s.modelsNotice);
  const keyStatus = useAiSettingsStore((s) => s.keyStatus);
  const hydrate = useAiSettingsStore((s) => s.hydrate);
  const setProvider = useAiSettingsStore((s) => s.setProvider);
  const setApiKey = useAiSettingsStore((s) => s.setApiKey);
  const setModel = useAiSettingsStore((s) => s.setModel);
  const setEffort = useAiSettingsStore((s) => s.setEffort);
  const refreshModels = useAiSettingsStore((s) => s.refreshModels);
  const clearKey = useAiSettingsStore((s) => s.clearKey);

  const [revealed, setRevealed] = useState(false);
  const [custom, setCustom] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const provider = providers.find((p) => p.id === settings.provider) ?? providers[0];
  const stored = settings.byProvider[settings.provider];
  const apiKey = stored?.apiKey ?? "";
  const model = stored?.model ?? "";

  const recommended = models.filter((m) => m.recommended);
  const others = models.filter((m) => !m.recommended);
  const modelInList = models.some((m) => m.id === model);

  return (
    <section className="mt-8" aria-labelledby="ajustes-ia">
      <h2
        id="ajustes-ia"
        className="font-ui text-xs font-medium uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400"
      >
        Inteligencia artificial
      </h2>

      <div className="mt-3 divide-y divide-seam-light rounded-xl border border-seam-light dark:divide-seam-dark dark:border-seam-dark">
        {/* ── 1. Proveedor ── */}
        <div className="px-4 py-3">
          <p className="font-ui text-sm text-reading-light dark:text-reading-dark">
            Proveedor
          </p>
          <div
            role="radiogroup"
            aria-label="Proveedor de IA"
            className="mt-2 flex flex-wrap gap-2"
          >
            {providers.map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={p.id === settings.provider}
                onClick={() => setProvider(p.id)}
                className={cn(
                  "flex min-h-[44px] items-center rounded-full px-4 font-ui text-xs font-medium",
                  "transition-colors duration-200 ease-[var(--ease-out-expo)]",
                  p.id === settings.provider
                    ? "bg-amber-600 text-paper-50 dark:bg-amber-700"
                    : "bg-paper-200 text-muted-light hover:text-reading-light dark:bg-ink-50 dark:text-muted-dark dark:hover:text-reading-dark",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {server.has_server_key && !apiKey && (
            <p className="mt-2 font-ui text-[11px] text-muted-light dark:text-muted-dark">
              Ahora mismo se usa la clave del servidor ({server.model}). Pon la
              tuya para que el gasto sea tuyo y elegir tú el modelo.
            </p>
          )}
        </div>

        {/* ── 2. API key ── */}
        <div className="px-4 py-3">
          <label
            htmlFor="ai-api-key"
            className="font-ui text-sm text-reading-light dark:text-reading-dark"
          >
            Tu API key de {provider?.label ?? "el proveedor"}
          </label>

          <div className="mt-2 flex items-center gap-2">
            <input
              id="ai-api-key"
              type={revealed ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider?.key_hint ?? ""}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className={cn(
                "min-h-[44px] min-w-0 flex-1 rounded-xl bg-paper-200 px-3",
                "font-ui text-base text-reading-light outline-none",
                "placeholder:text-muted-light/60 sm:text-sm dark:bg-ink-50 dark:text-reading-dark",
              )}
            />
            <button
              onClick={() => setRevealed((r) => !r)}
              aria-label={revealed ? "Ocultar la key" : "Mostrar la key"}
              aria-pressed={revealed}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-ui text-xs text-muted-light dark:text-muted-dark"
            >
              {revealed ? "Ocultar" : "Ver"}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={() => void refreshModels("chat")}
              disabled={modelsLoading}
              className={cn(
                "flex min-h-[44px] items-center rounded-full px-4 font-ui text-xs font-medium",
                "bg-amber-600 text-paper-50 disabled:opacity-60 dark:bg-amber-700",
              )}
            >
              {modelsLoading ? "Comprobando…" : "Comprobar y cargar modelos"}
            </button>

            {apiKey && (
              <button
                onClick={clearKey}
                className="flex min-h-[44px] items-center rounded-full px-3 font-ui text-xs font-medium text-muted-light hover:text-red-700 dark:text-muted-dark"
              >
                Borrar mi key
              </button>
            )}

            {provider?.key_url && (
              <a
                href={provider.key_url}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-[44px] items-center font-ui text-xs text-amber-700 underline dark:text-amber-400"
              >
                Consíguela aquí
              </a>
            )}
          </div>

          <p role="status" className="mt-2 font-ui text-[11px]">
            {keyStatus === "ok" && (
              <span className="text-amber-700 dark:text-amber-400">
                Key válida · {models.length} modelos disponibles
              </span>
            )}
            {keyStatus === "invalid" && (
              <span className="text-red-700 dark:text-red-400">{modelsError}</span>
            )}
            {keyStatus !== "ok" && keyStatus !== "invalid" && modelsError && (
              <span className="text-red-700 dark:text-red-400">{modelsError}</span>
            )}
            {keyStatus !== "invalid" && !modelsError && modelsNotice && (
              <span className="text-muted-light dark:text-muted-dark">
                {modelsNotice}
              </span>
            )}
          </p>

          <p className="mt-2 font-ui text-[11px] text-muted-light dark:text-muted-dark">
            Tu key se guarda solo en este dispositivo (no en el servidor) y no
            viaja en las copias de seguridad de tu base local.
          </p>
        </div>

        {/* ── 3. Modelo ── */}
        <div className="px-4 py-3">
          <label
            htmlFor="ai-model"
            className="font-ui text-sm text-reading-light dark:text-reading-dark"
          >
            Modelo
          </label>

          <div className="relative mt-2 flex items-center">
            <select
              id="ai-model"
              value={custom || (model && !modelInList) ? CUSTOM_MODEL_VALUE : model}
              onChange={(e) => {
                if (e.target.value === CUSTOM_MODEL_VALUE) {
                  setCustom(true);
                  return;
                }
                setCustom(false);
                setModel(e.target.value);
              }}
              className={cn(
                "min-h-[44px] w-full appearance-none rounded-xl bg-paper-200 px-3 pr-8",
                "font-ui text-sm text-reading-light outline-none dark:bg-ink-50 dark:text-reading-dark",
              )}
            >
              <option value="">
                {models.length === 0
                  ? "Comprueba tu key para ver los modelos"
                  : "Por defecto del proveedor"}
              </option>
              {recommended.length > 0 && (
                <ModelGroup label="Recomendados" models={recommended} />
              )}
              {others.length > 0 && <ModelGroup label="Otros" models={others} />}
              {/* Escapatoria: la lista es heurística y un modelo nuevo puede
                  no aparecer. Sin esto, el usuario se queda fuera. */}
              <option value={CUSTOM_MODEL_VALUE}>Escribir otro…</option>
            </select>
            <IconChevronDown
              width={14}
              height={14}
              className="pointer-events-none absolute right-3 text-muted-light dark:text-muted-dark"
            />
          </div>

          {(custom || (model && !modelInList)) && (
            <input
              aria-label="Nombre del modelo"
              value={model}
              onChange={(e) => setModel(e.target.value.trim())}
              placeholder={provider?.default_model ?? ""}
              autoCapitalize="off"
              spellCheck={false}
              className={cn(
                "mt-2 min-h-[44px] w-full rounded-xl bg-paper-200 px-3",
                "font-ui text-base text-reading-light outline-none sm:text-sm",
                "dark:bg-ink-50 dark:text-reading-dark",
              )}
            />
          )}
        </div>

        {/* ── 4. Esfuerzo ── */}
        <div className="px-4 py-3">
          <p className="font-ui text-sm text-reading-light dark:text-reading-dark">
            Esfuerzo de razonamiento
          </p>
          <div
            role="radiogroup"
            aria-label="Esfuerzo de razonamiento"
            className="mt-2 flex flex-wrap gap-2"
          >
            {(provider?.efforts ?? []).map((effort) => (
              <button
                key={effort.id}
                role="radio"
                aria-checked={effort.id === settings.effort}
                onClick={() => setEffort(effort.id)}
                className={cn(
                  "flex min-h-[44px] items-center rounded-full px-3 font-ui text-xs font-medium",
                  effort.id === settings.effort
                    ? "bg-amber-600 text-paper-50 dark:bg-amber-700"
                    : "bg-paper-200 text-muted-light hover:text-reading-light dark:bg-ink-50 dark:text-muted-dark dark:hover:text-reading-dark",
                )}
              >
                {effort.label}
              </button>
            ))}
          </div>
          <p className="mt-2 font-ui text-[11px] text-muted-light dark:text-muted-dark">
            Más esfuerzo = mejores respuestas, más lentas y más caras.
            {settings.provider === "google" &&
              " En Gemini, «Sin razonar» se aplica como «mínimo»: no se puede apagar del todo."}
          </p>
        </div>

        {/* ── 5. Estado ── */}
        <p className="px-4 py-3 font-ui text-xs text-muted-light dark:text-muted-dark">
          {[
            provider?.label ?? settings.provider,
            shortModelLabel(model) || `por defecto (${server.model})`,
            provider?.efforts.find((e) => e.id === settings.effort)?.label ??
              settings.effort,
            apiKey ? "key propia" : "clave del servidor",
          ].join(" · ")}
        </p>
      </div>
    </section>
  );
}

function ModelGroup({ label, models }: { label: string; models: AiModel[] }) {
  return (
    <optgroup label={label}>
      {models.map((m) => (
        <option key={m.id} value={m.id} title={m.description || undefined}>
          {m.label === m.id ? m.id : `${m.label} · ${m.id}`}
        </option>
      ))}
    </optgroup>
  );
}
