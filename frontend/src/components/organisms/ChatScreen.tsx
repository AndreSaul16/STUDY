import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { useChat, TOOL_LABELS, resumeResearchJob } from "@/hooks/useChat";
import { useChatStore } from "@/store/chatStore";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { useChatModes } from "@/components/molecules/ModePicker";
import { ChatComposer } from "@/components/molecules/ChatComposer";
import { ChatMessage } from "@/components/molecules/ChatMessage";
import { takePendingChatContext } from "@/components/molecules/ContextMenu";
import { FollowUpChips } from "@/components/molecules/FollowUpChips";
import { ModelQuickPicker } from "@/components/molecules/ModelQuickPicker";
import { ResearchProgress } from "@/components/molecules/ResearchProgress";
import { ConversationsDrawer } from "@/components/organisms/ConversationsDrawer";
import { useAiSettingsStore } from "@/store/aiSettingsStore";
import { useResearchStore } from "@/store/researchStore";
import { conversationToMarkdown, slugify } from "@/utils/plainText";
import { shortModelLabel } from "@/types/aiSettings";
import { IconArrowDown, IconGrip } from "@/components/atoms/Icons";
import type { ChatUiMessage, ToolActivity } from "@/types/chat";

/**
 * Descarga la conversación como .md.
 *
 * Un fichero y no el portapapeles: una conversación larga con sus fuentes no
 * cabe cómodamente en un pegado, y en Markdown se abre en cualquier sitio.
 */
function exportConversation(title: string, messages: ChatUiMessage[]): void {
  const markdown = conversationToMarkdown(title, messages);
  const url = URL.createObjectURL(
    new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `study-${slugify(title)}-${new Date().toISOString().slice(0, 10)}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

interface ChatScreenProps {
  className?: string;
  /** Dentro del panel de investigación: sin cabecera propia ni cajón. */
  embedded?: boolean;
}

/**
 * ChatScreen — la pantalla del chat. El núcleo de la app.
 *
 * Layout de pulgar: cabecera fina arriba, mensajes en el medio y composer
 * pegado abajo por encima del teclado. El scroll de la lista no arrastra el
 * documento (`overscroll-contain`) y solo se pega al fondo si el usuario ya
 * estaba abajo (ver useStickToBottom).
 */
export function ChatScreen({ className, embedded = false }: ChatScreenProps) {
  const {
    messages,
    isStreaming,
    streamingContent,
    activity,
    error,
    send,
    cancel,
    newConversation,
    retryLast,
  } = useChat();

  const mode = useChatStore((s) => s.mode);
  const setMode = useChatStore((s) => s.setMode);
  const setDrawerOpen = useChatStore((s) => s.setDrawerOpen);
  const conversations = useChatStore((s) => s.conversations);
  const conversationId = useChatStore((s) => s.conversationId);
  const modes = useChatModes();

  const aiSettings = useAiSettingsStore((s) => s.settings);
  const hydrateAi = useAiSettingsStore((s) => s.hydrate);
  const researchActive = useResearchStore((s) => s.jobId !== null);

  const [input, setInput] = useState("");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);

  // El catálogo de proveedores se pide una vez: la cabecera necesita saber qué
  // modelo está activo antes de que el usuario abra Ajustes.
  useEffect(() => {
    void hydrateAi();
    useResearchStore.getState().hydrate();
  }, [hydrateAi]);

  // Publica --kb-inset: sin esto el composer se queda debajo del teclado.
  useVisualViewport();

  const { scrollRef, atBottom, scrollToBottom, onScroll } = useStickToBottom([
    messages.length,
    streamingContent,
    activity.length,
  ]);

  // Texto que viene del lector ("Preguntar a la IA" sobre una selección). Se
  // antepone al composer SIN enviar: el usuario todavía tiene que decir qué
  // quiere que se haga con ese texto.
  useEffect(() => {
    const pending = takePendingChatContext();
    if (!pending) return;
    setInput((current) => pending + current);
    composerRef.current?.querySelector("textarea")?.focus();
  }, []);

  // Repulsar "Chat" en la barra inferior baja al final de la conversación.
  // Evento del DOM y no una prop: la barra vive fuera de este árbol.
  useEffect(() => {
    const onJump = () => scrollToBottom({ behavior: "smooth" });
    window.addEventListener("study:chat-scroll-bottom", onJump);
    return () => window.removeEventListener("study:chat-scroll-bottom", onJump);
  }, [scrollToBottom]);

  const title =
    conversations.find((c) => c.conversationId === conversationId)?.title ??
    "Conversación nueva";

  const currentMode = modes.find((m) => m.id === mode) ?? modes[0];
  const lastMessage = messages[messages.length - 1];
  const followUps =
    !isStreaming && lastMessage?.role === "assistant" ? lastMessage.suggestions : [];

  const handleSend = () => {
    const content = input.trim();
    if (!content) return;
    setInput("");
    void send(content);
    scrollToBottom();
  };

  const pickFollowUp = (suggestion: string) => {
    setInput(suggestion);
    composerRef.current?.querySelector("textarea")?.focus();
  };

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col", className)}>
      {!embedded && (
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-seam-light px-2 pt-[env(safe-area-inset-top)] short:h-11 dark:border-seam-dark">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Conversaciones"
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted-light short:h-10 short:w-10 dark:text-muted-dark"
          >
            <IconGrip width={18} height={18} />
          </button>

          <p className="min-w-0 flex-1 truncate text-center font-ui text-sm font-medium text-reading-light dark:text-reading-dark">
            {title}
          </p>

          {/* Acceso rápido al modelo y al esfuerzo. NO va dentro del
              ModePicker: ese responde a "qué quiero escribir" y es la pieza
              más delicada del responsive. */}
          {/* Por debajo de `sm` se queda solo con el modelo: con el esfuerzo
              también, este botón se comía 120 de los 320px de la cabecera y el
              título de la conversación se quedaba en «Dame u…». */}
          <button
            onClick={() => setModelPickerOpen(true)}
            aria-label="Modelo y esfuerzo"
            aria-haspopup="dialog"
            className="flex h-11 max-w-[5.5rem] shrink-0 items-center rounded-full px-2 font-ui text-[11px] text-muted-light short:h-10 sm:max-w-[7.5rem] dark:text-muted-dark"
          >
            <span className="truncate">
              {shortModelLabel(
                aiSettings.byProvider[aiSettings.provider]?.model ?? "",
              ) || "Modelo"}
            </span>
            <span className="hidden whitespace-nowrap sm:inline">
              {` · ${aiSettings.effort}`}
            </span>
          </button>

          {messages.length > 0 && (
            <button
              onClick={() => exportConversation(title, messages)}
              aria-label="Exportar la conversación a Markdown"
              title="Exportar a .md"
              className="flex h-11 w-11 items-center justify-center rounded-full text-muted-light short:h-10 short:w-10 dark:text-muted-dark"
            >
              <IconArrowDown width={17} height={17} />
            </button>
          )}

          <button
            onClick={newConversation}
            aria-label="Nueva conversación"
            className="flex h-11 w-11 items-center justify-center rounded-full font-ui text-xl leading-none text-muted-light dark:text-muted-dark"
          >
            +
          </button>
        </header>
      )}

      {/* La región de scroll va envuelta para que el botón "Ir al final" se
          ancle a SU borde inferior. Antes era `absolute bottom-32` contra la
          pantalla: con el composer crecido (o en apaisado) el botón caía
          encima del textarea y tapaba lo que se estaba escribiendo. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        // Sin aria-live aquí: anunciaría la conversación entera cada vez que
        // llega un token. Lo que se anuncia es solo la región de streaming.
        aria-label="Conversación"
        className={cn(
          "chat-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain",
          "px-4 py-4 short:py-2",
        )}
      >
        <ResumeResearchBanner />

        {messages.length === 0 && !isStreaming && !error && (
          <EmptyState
            examples={currentMode?.examples ?? []}
            onPick={(example) => {
              setInput(example);
              composerRef.current?.querySelector("textarea")?.focus();
            }}
          />
        )}

        {messages.map((message, i) => (
          <ChatMessage
            key={message.id}
            message={message}
            isLast={i === messages.length - 1 && message.role === "assistant"}
            onRetry={retryLast}
          />
        ))}

        {/* Durante una investigación profunda el rastro de herramientas no
            basta: son minutos y hay un plan que enseñar. */}
        {researchActive && <ResearchProgress />}

        {isStreaming && !streamingContent && !researchActive && (
          <ToolActivityTrail activity={activity} />
        )}

        {isStreaming && streamingContent && (
          <div aria-live="polite" aria-atomic="false">
            <ChatMessage
              streaming
              message={{
                id: "streaming",
                role: "assistant",
                content: streamingContent,
                sources: [],
                tools: [],
                suggestions: [],
                createdAt: Date.now(),
              }}
            />
          </div>
        )}

        {error && (
          <div className="mt-2 max-w-[68ch] rounded-xl bg-red-50 p-4 dark:bg-red-900/20">
            <p className="font-ui text-xs text-red-700 dark:text-red-400">{error}</p>
            <button
              onClick={retryLast}
              className="mt-2 flex h-11 items-center rounded-full bg-red-600 px-4 font-ui text-xs font-medium text-paper-50"
            >
              Reintentar
            </button>
          </div>
        )}
      </div>

      {/* Solo aparece si el usuario se ha ido hacia arriba mientras escribía la
          IA. Antes el scroll era forzado y este botón no hacía falta porque no
          se podía subir. */}
      {!atBottom && (
        <button
          onClick={() => scrollToBottom({ behavior: "smooth" })}
          className={cn(
            "absolute bottom-3 left-1/2 z-10 flex h-11 -translate-x-1/2 items-center gap-1.5 rounded-full px-4",
            "bg-reading-light font-ui text-xs whitespace-nowrap text-paper-50 shadow-lg",
            "dark:bg-paper-50 dark:text-ink-200",
          )}
        >
          <IconArrowDown width={14} height={14} />
          Ir al final
        </button>
      )}
      </div>

      {followUps.length > 0 && (
        <FollowUpChips
          suggestions={followUps}
          onPick={pickFollowUp}
          className="shrink-0 px-4 pb-2"
        />
      )}

      <div ref={composerRef}>
        <ChatComposer
          value={input}
          onChange={setInput}
          onSend={handleSend}
          onCancel={cancel}
          isStreaming={isStreaming}
          mode={mode}
          onModeChange={setMode}
          placeholder={currentMode?.hint}
        />
      </div>

      {!embedded && <ConversationsDrawer />}

      {!embedded && (
        <ModelQuickPicker
          open={modelPickerOpen}
          onClose={() => setModelPickerOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Reanudar una investigación ──────────────────────────────────

/**
 * Banner de "Reanudar" para una investigación que quedó a medias.
 *
 * Los trabajos viven en la memoria del backend: cerrar la app a mitad de un
 * informe de tres minutos, o un redeploy de Railway, dejan el seguimiento
 * colgado. Como cada evento va numerado y el último visto se guarda en
 * `localStorage`, reengancharse cuesta un botón y no repite lo ya leído.
 */
/**
 * Corta por la última palabra entera y deja constancia con puntos suspensivos.
 *
 * Un `slice` a pelo partía la pregunta a media palabra —«…y en los ejempl»— y
 * en una pantalla de 320px eso parece un error de la app, no un recorte.
 */
function recorta(texto: string, max: number): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  if (limpio.length <= max) return limpio;
  const cortado = limpio.slice(0, max);
  const espacio = cortado.lastIndexOf(" ");
  return `${(espacio > max * 0.6 ? cortado.slice(0, espacio) : cortado).trimEnd()}…`;
}

function ResumeResearchBanner() {
  const resumable = useResearchStore((s) => s.resumable);
  const active = useResearchStore((s) => s.jobId !== null);
  const conversationId = useChatStore((s) => s.conversationId);

  if (!resumable || active) return null;

  return (
    <div className="mb-3 max-w-[68ch] rounded-xl border border-amber-600/40 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-900/10">
      <p className="font-ui text-xs text-reading-light dark:text-reading-dark">
        Tienes una investigación a medias
        {resumable.question ? `: «${recorta(resumable.question, 60)}»` : ""}.
      </p>
      <div className="-ml-2 mt-1 flex flex-wrap items-center gap-1">
        <button
          onClick={() => {
            useChatStore.getState().resumeTurn();
            void resumeResearchJob(
              resumable.jobId,
              resumable.conversationId ?? conversationId ?? "",
              resumable.question,
            );
          }}
          className="inline-flex min-h-[44px] items-center rounded-full px-3 font-ui text-xs font-medium text-amber-800 dark:text-amber-300"
        >
          Reanudar
        </button>
        <button
          onClick={() => useResearchStore.getState().dismissResumable()}
          className="inline-flex min-h-[44px] items-center rounded-full px-3 font-ui text-xs font-medium text-muted-light dark:text-muted-dark"
        >
          Descartar
        </button>
      </div>
    </div>
  );
}

// ─── Estado vacío ────────────────────────────────────────────────

function EmptyState({
  examples,
  onPick,
}: {
  examples: string[];
  onPick: (example: string) => void;
}) {
  return (
    <div className="mx-auto max-w-[46ch] py-8 short:py-2">
      <h2 className="font-display text-2xl text-reading-light short:text-xl dark:text-reading-dark">
        ¿Qué preparamos hoy?
      </h2>
      <p className="mt-2 font-ui text-sm text-muted-light short:hidden dark:text-muted-dark">
        Busco en la Biblia y en las publicaciones antes de responder, y te lo
        redacto con tu forma de escribir.
      </p>

      <ul className="mt-6 space-y-2 short:mt-3">
        {examples.slice(0, 3).map((example) => (
          <li key={example}>
            <button
              onClick={() => onPick(example)}
              className={cn(
                "flex min-h-[56px] w-full items-center rounded-xl px-4 py-3 text-left",
                "border border-seam-light font-ui text-sm text-reading-light",
                "transition-colors duration-200 ease-[var(--ease-out-expo)]",
                "hover:border-amber-600 hover:text-amber-800 active:scale-[0.99]",
                "dark:border-seam-dark dark:text-reading-dark dark:hover:border-amber-600 dark:hover:text-amber-300",
              )}
            >
              {example}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Rastro de consultas a fuentes ───────────────────────────────

/**
 * Lo que la IA está haciendo mientras no hay texto que mostrar.
 *
 * El asistente consulta wol.jw.org en varias rondas antes de redactar, y eso
 * puede llevar entre 20 y 60 segundos. Sin este rastro el panel se queda vacío
 * todo ese rato y no se distingue de una app colgada.
 *
 * Cada paso ya resuelto muestra el resumen que manda el backend en el evento
 * `tool_result` ("6 resultados", "Isaías 58"): así se ve que la investigación
 * avanza de verdad, no solo que hay algo girando.
 */
function ToolActivityTrail({ activity }: { activity: ToolActivity[] }) {
  const last = activity[activity.length - 1];

  return (
    <div className="mb-4 max-w-[68ch]" aria-live="polite">
      <div className="rounded-2xl bg-paper-100 px-4 py-3 dark:bg-ink-50">
        <div className="flex items-center gap-2">
          <span className="flex gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-600 dark:bg-amber-500"
                style={{ animationDelay: `${i * 180}ms` }}
              />
            ))}
          </span>
          <span className="font-ui text-xs font-medium text-reading-light dark:text-reading-dark">
            {last ? (TOOL_LABELS[last.name] ?? "Consultando fuentes") : "Buscando en wol.jw.org"}
            {last?.detail ? ` · ${last.detail}` : ""}
          </span>
        </div>

        {activity.length > 1 && (
          <ul className="mt-2 space-y-1 border-t border-seam-light pt-2 dark:border-seam-dark">
            {activity.slice(0, -1).map((step, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 font-ui text-[11px] text-muted-light dark:text-muted-dark"
              >
                <span className="mt-0.5 text-amber-700 dark:text-amber-500">✓</span>
                <span className="min-w-0 break-words">
                  {TOOL_LABELS[step.name] ?? step.name}
                  {step.summary ? ` · ${step.summary}` : step.detail ? ` · ${step.detail}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
