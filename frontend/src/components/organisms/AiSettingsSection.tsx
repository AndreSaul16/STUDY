import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { useAiSettingsStore } from "@/store/aiSettingsStore";
import {
  CUSTOM_MODEL_VALUE,
  resolveVoiceProvider,
  shortModelLabel,
  voiceCapableProviders,
  type AiModel,
} from "@/types/aiSettings";
import { IconChevronDown, IconMic } from "@/components/atoms/Icons";
import { SwitchRow } from "@/components/molecules/SwitchRow";
import { NoticeSheet } from "@/components/molecules/NoticeSheet";

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
          {/* Sin key propia atiende el servidor, y eso puede significar que
              responda un proveedor DISTINTO al que acabas de marcar. Decirlo
              importa: si no, eliges Google, te contesta OpenAI y no hay forma
              de saberlo. Antes ni se avisaba y además se mandaba el modelo de
              Gemini a OpenAI, que devolvía un error incomprensible. */}
          {server.has_server_key && !apiKey && (
            <p className="mt-2 font-ui text-[11px] text-muted-light dark:text-muted-dark">
              {settings.provider === server.provider ? (
                <>
                  Ahora mismo se usa la clave del servidor ({server.model}). Pon
                  la tuya para que el gasto sea tuyo y elegir tú el modelo.
                </>
              ) : (
                <>
                  <span className="text-amber-700 dark:text-amber-400">
                    Sin tu clave de {provider?.label ?? settings.provider},
                    responde el servidor con {server.provider} ({server.model}).
                  </span>{" "}
                  Pega tu clave arriba para usar {provider?.label} de verdad y
                  poder elegir su modelo.
                </>
              )}
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

        {/* ── 5. Voz ── */}
        <VoiceSettingsRow />

        {/* ── 6. Estado ── */}
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

/**
 * Ajustes de la pestaña de voz.
 *
 * Vive DENTRO de los ajustes de IA porque es lo mismo: el mismo proveedor y la
 * misma key. Y está separado del selector de proveedor de arriba porque el de
 * voz puede ser otro: hoy solo OpenAI tiene transcripción verificada, así que
 * quien tenga el chat en Gemini debe poder seguir usando la voz sin cambiar
 * todo lo demás.
 *
 * **Solo se ofrecen los proveedores verificados.** La lista sale de
 * `supports_stt`, que el backend rellena únicamente donde ha probado el
 * endpoint de verdad. Si un día no hay ninguno, esto lo dice en vez de enseñar
 * un desplegable vacío.
 */
function VoiceSettingsRow() {
  const settings = useAiSettingsStore((s) => s.settings);
  const providers = useAiSettingsStore((s) => s.providers);
  const setVoiceProvider = useAiSettingsStore((s) => s.setVoiceProvider);
  const setSttModel = useAiSettingsStore((s) => s.setSttModel);
  const setTtsVoice = useAiSettingsStore((s) => s.setTtsVoice);
  const setSpeakBack = useAiSettingsStore((s) => s.setSpeakBack);

  const [avisoVoz, setAvisoVoz] = useState(false);

  const capaces = voiceCapableProviders(providers);
  const activo = resolveVoiceProvider(providers, settings.voiceProvider);
  const sinVoz = providers.filter((p) => !p.supports_stt);
  const nombresSinVoz = sinVoz.map((p) => p.label).join(" y ");

  return (
    <div className="px-4 py-3">
      <p className="font-ui text-sm text-reading-light dark:text-reading-dark">
        Voz (pestaña de práctica)
      </p>

      {capaces.length === 0 ? (
        <p className="mt-2 font-ui text-[11px] text-muted-light dark:text-muted-dark">
          Ningún proveedor tiene transcripción comprobada ahora mismo, así que
          la pestaña de voz no puede ofrecerla. Solo se ofrece lo verificado.
        </p>
      ) : (
        <>
          <div
            role="radiogroup"
            aria-label="Proveedor de voz"
            className="mt-2 flex flex-wrap gap-2"
          >
            {capaces.map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={p.id === activo?.id}
                onClick={() => setVoiceProvider(p.id)}
                className={cn(
                  "flex min-h-[44px] items-center rounded-full px-4 font-ui text-xs font-medium",
                  "transition-colors duration-200 ease-[var(--ease-out-expo)]",
                  p.id === activo?.id
                    ? "bg-amber-600 text-paper-50 dark:bg-amber-700"
                    : "bg-paper-200 text-muted-light hover:text-reading-light dark:bg-ink-50 dark:text-muted-dark dark:hover:text-reading-dark",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {sinVoz.length > 0 && (
            <>
              {/* Deliberadamente NO dice «próximamente»: no lo estamos haciendo
                  nosotros y no sabemos si llegará. Es un hecho del proveedor. */}
              <p className="mt-2 font-ui text-[11px] leading-relaxed text-muted-light dark:text-muted-dark">
                {nombresSinVoz} no {sinVoz.length === 1 ? "aparece" : "aparecen"}{" "}
                porque su API no tiene endpoint de audio. No es que falte por
                hacer: se probó en vivo y responde 404.
              </p>

              {/* Gris, sin acento: no hay nada que esperar ni nada que pulsar
                  para arreglarlo. Un ámbar de «próximamente» aquí mentiría. */}
              <button
                onClick={() => setAvisoVoz(true)}
                className={cn(
                  "mt-2 flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3",
                  "border border-dashed border-seam-light text-left",
                  "transition-colors duration-200 ease-[var(--ease-out-expo)]",
                  "hover:border-muted-light dark:border-seam-dark dark:hover:border-muted-dark",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500",
                )}
              >
                <IconMic
                  width={14}
                  height={14}
                  className="shrink-0 text-muted-light dark:text-muted-dark"
                />
                <span className="min-w-0 flex-1 font-ui text-[11px] text-reading-light dark:text-reading-dark">
                  Qué se comprobó y qué usar mientras
                </span>
                <span className="shrink-0 rounded-full bg-paper-200 px-2 py-0.5 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-reading-light dark:bg-ink-50 dark:text-reading-dark">
                  Sin soporte
                </span>
              </button>
            </>
          )}

          <label
            htmlFor="voz-modelo-stt"
            className="mt-4 block font-ui text-sm text-reading-light dark:text-reading-dark"
          >
            Modelo de transcripción
          </label>
          <div className="relative mt-2 flex items-center">
            <select
              id="voz-modelo-stt"
              value={settings.sttModel}
              onChange={(e) => setSttModel(e.target.value)}
              className={cn(
                "min-h-[44px] w-full appearance-none rounded-xl bg-paper-200 px-3 pr-8",
                "font-ui text-sm text-reading-light outline-none dark:bg-ink-50 dark:text-reading-dark",
              )}
            >
              <option value="">
                Por defecto ({activo?.stt_models[0] ?? "—"})
              </option>
              {(activo?.stt_models ?? []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <IconChevronDown
              width={14}
              height={14}
              className="pointer-events-none absolute right-3 text-muted-light dark:text-muted-dark"
            />
          </div>
          <p className="mt-2 font-ui text-[11px] text-muted-light dark:text-muted-dark">
            whisper-1 es el único que devuelve la duración real del audio, que
            es lo que permite decirte si te has pasado de tiempo.
          </p>

          {activo?.supports_tts && (
            <>
              <SwitchRow
                className="mt-4"
                label="Leerme la crítica en voz alta"
                checked={settings.speakBack}
                onChange={setSpeakBack}
              />

              <label
                htmlFor="voz-timbre"
                className="mt-3 block font-ui text-sm text-reading-light dark:text-reading-dark"
              >
                Voz
              </label>
              <div className="relative mt-2 flex items-center">
                <select
                  id="voz-timbre"
                  value={settings.ttsVoice}
                  onChange={(e) => setTtsVoice(e.target.value)}
                  className={cn(
                    "min-h-[44px] w-full appearance-none rounded-xl bg-paper-200 px-3 pr-8",
                    "font-ui text-sm text-reading-light outline-none dark:bg-ink-50 dark:text-reading-dark",
                  )}
                >
                  <option value="">
                    Por defecto ({activo.tts_voices[0] ?? "—"})
                  </option>
                  {activo.tts_voices.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                <IconChevronDown
                  width={14}
                  height={14}
                  className="pointer-events-none absolute right-3 text-muted-light dark:text-muted-dark"
                />
              </div>
            </>
          )}
        </>
      )}

      <NoticeSheet
        open={avisoVoz}
        onClose={() => setAvisoVoz(false)}
        tone="unavailable"
        title={`Voz en ${nombresSinVoz || "algunos proveedores"}`}
        icon={IconMic}
        // Sin plurales: la lista de proveedores sin voz la decide el backend y
        // puede tener uno o tres. Una frase que dé por hecho «esos» chirría en
        // cuanto queda uno solo.
        lead={`No está a medias por nuestra parte: la API de ${nombresSinVoz} no publica ninguna ruta de audio. Se llamó con una clave válida y la respuesta fue 404, que significa que la ruta no existe.`}
        bullets={[
          "Se probaron en vivo los endpoints de transcripción de voz a texto: 404.",
          "Ofrecer la voz ahí sería enseñar un botón que falla al pulsarlo, y por eso no sale en la lista de arriba.",
          "No depende de nosotros ni de tu clave: se activará solo el día que el proveedor publique esa ruta.",
        ]}
        available={{
          title: "Lo que ya funciona",
          body: capaces.length
            ? `Con ${capaces
                .map((p) => p.label)
                .join(" y ")} la pestaña de voz funciona entera: graba, transcribe y la IA critica el ensayo. El proveedor de voz es independiente del chat, así que puedes dejar el chat donde lo tienes y elegir arriba solo la voz.`
            : "Ahora mismo ningún proveedor ofrece transcripción, así que la pestaña de voz no puede grabar. El resto de la app —chat, lector e investigación— funciona igual.",
        }}
      />
    </div>
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
