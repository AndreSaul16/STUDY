import { useState, useRef, useEffect } from "react";
import { cn } from "@/utils/cn";
import { useChat, TOOL_LABELS, type ToolActivity } from "@/hooks/useChat";
import { Button } from "@/components/atoms/Button";
import { Divider } from "@/components/atoms/Divider";
import { Markdown } from "@/components/atoms/Markdown";
import { IconClose, IconArrowDown } from "@/components/atoms/Icons";

interface ChatPanelProps {
  className?: string;
}

/**
 * ChatPanel — interfaz de chat IA con OpenAI + MCP.
 *
 * Muestra:
 *  - Historial de mensajes (usuario + asistente)
 *  - Streaming de tokens en tiempo real
 *  - Input para enviar mensajes
 *  - Botón cancelar durante streaming
 */
export function ChatPanel({ className }: ChatPanelProps) {
  const {
    messages,
    isStreaming,
    streamingContent,
    activity,
    error,
    send,
    cancel,
    newConversation,
  } = useChat();

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll al final cuando hay nuevo contenido
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent, activity]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    send(input.trim());
    setInput("");
    // Reset height del textarea
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* ─── Header ─── */}
      <div className="shrink-0 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-ui text-xs font-medium uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
              Chat IA
            </p>
            <p className="mt-0.5 font-ui text-[10px] text-muted-light dark:text-muted-dark">
              Basado en publicaciones JW
            </p>
          </div>
          {messages.length > 0 && (
            <button
              onClick={newConversation}
              className="rounded-md px-2 py-1 font-ui text-[10px] text-muted-light hover:bg-paper-200 hover:text-reading-light dark:text-muted-dark dark:hover:bg-ink-50 dark:hover:text-reading-dark"
            >
              Nueva
            </button>
          )}
        </div>
      </div>

      <Divider />

      {/* ─── Mensajes ─── */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
        {messages.length === 0 && !isStreaming && !error && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-paper-200 text-muted-light dark:bg-ink-50 dark:text-muted-dark">
              <IconArrowDown width={20} height={20} />
            </div>
            <p className="font-ui text-xs text-muted-light dark:text-muted-dark">
              Pregunta algo sobre las publicaciones JW.
              <br />
              El asistente buscará en la Biblia, Atalaya y otras fuentes.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} role={msg.role} content={msg.content} />
        ))}

        {/* Consultas a fuentes en curso — antes de que llegue el primer token */}
        {isStreaming && !streamingContent && (
          <ToolActivityTrail activity={activity} />
        )}

        {/* Streaming en curso */}
        {isStreaming && streamingContent && (
          <MessageBubble role="assistant" content={streamingContent} streaming />
        )}

        {/* Error */}
        {error && (
          <div className="mt-2 rounded-md bg-red-50 p-3 dark:bg-red-900/20">
            <p className="font-ui text-xs text-red-700 dark:text-red-400">
              {error}
            </p>
          </div>
        )}
      </div>

      <Divider />

      {/* ─── Input ─── */}
      <div className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Escribe tu pregunta…"
            rows={1}
            disabled={isStreaming}
            className={cn(
              "min-h-[44px] max-h-[120px] flex-1 resize-none",
              "rounded-lg bg-paper-50 px-3 py-2.5",
              // 16px exactos: por debajo, iOS hace zoom al enfocar el campo y
              // deja la vista descuadrada al volver.
              "font-ui text-base text-reading-light sm:text-sm",
              "placeholder:text-muted-light/60",
              "ring-1 ring-seam-light focus:outline-none focus:ring-2 focus:ring-amber-500",
              "dark:bg-ink-50 dark:text-reading-dark dark:ring-seam-dark dark:placeholder:text-muted-dark/60 dark:focus:ring-amber-400",
              "disabled:opacity-50",
            )}
          />

          {isStreaming ? (
            <Button variant="outline" size="icon" onClick={cancel}>
              <IconClose width={14} height={14} />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="icon"
              onClick={handleSend}
              disabled={!input.trim()}
            >
              <svg
                width={14}
                height={14}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </Button>
          )}
        </div>
        <p className="mt-1.5 font-ui text-[9px] text-muted-light/60 dark:text-muted-dark/60">
          Enter para enviar · Shift+Enter para nueva línea
        </p>
      </div>
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
 */
function ToolActivityTrail({ activity }: { activity: ToolActivity[] }) {
  const last = activity[activity.length - 1];

  return (
    <div className="mb-3 flex justify-start" aria-live="polite">
      <div className="max-w-[88%] rounded-2xl bg-paper-100 px-4 py-3 dark:bg-ink-50">
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

        {/* Las consultas ya resueltas quedan listadas: dan la sensación de
            avance y explican de dónde saldrá la respuesta. */}
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
                  {step.detail ? ` · ${step.detail}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Message Bubble ──────────────────────────────────────────────

function MessageBubble({
  role,
  content,
  streaming = false,
}: {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}) {
  const isUser = role === "user";

  return (
    <div
      className={cn(
        "mb-3 flex",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "max-w-[88%] rounded-2xl px-4 py-2.5 sm:max-w-[85%]",
          // Un enlace o una palabra larga no deben ensanchar la burbuja.
          "min-w-0 break-words",
          isUser
            ? "bg-amber-600 text-paper-50 dark:bg-amber-500"
            : "bg-paper-100 text-reading-light dark:bg-ink-50 dark:text-reading-dark",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap font-reading text-sm leading-relaxed">
            {content}
          </p>
        ) : (
          <div className="font-reading text-sm leading-relaxed">
            <Markdown>{content}</Markdown>
            {streaming && (
              <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-amber-600 align-middle dark:bg-amber-400" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
