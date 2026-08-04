import { useCallback } from "react";
import { parseSSEEvent, splitSSEEvents } from "@/utils/sse";

import {
  buildRequestMessages,
  CHAT_STREAM_ENDPOINT,
} from "@/services/chatClient";
import { fetchSnapshot, followJob } from "@/services/researchClient";
import { AI_KEY_HEADER } from "@/services/aiSettingsClient";
import { releaseTurn, stopTurn, trackTurn } from "@/services/chatTurns";
import {
  searchLocalLibrary,
  toWire,
  type LocalSnippetWire,
} from "@/services/localLibrarySearch";
import {
  aiRequestBody,
  localBooksForChat,
  useAiSettingsStore,
} from "@/store/aiSettingsStore";
import { useChatStore } from "@/store/chatStore";
import { useResearchStore } from "@/store/researchStore";
import type {
  ChatMessageMeta,
  ChatSource,
  ChatUiMessage,
  ConversationAi,
  ToolActivity,
} from "@/types/chat";

export type { ToolActivity } from "@/types/chat";

interface UseChatReturn {
  messages: ChatUiMessage[];
  isStreaming: boolean;
  streamingContent: string;
  /** Herramientas consultadas en el turno actual, en orden. */
  activity: ToolActivity[];
  error: string | null;
  send: (content: string) => void;
  cancel: () => void;
  /** Empieza una conversación nueva. Sustituye al antiguo "Limpiar". */
  newConversation: () => void;
  retryLast: () => void;
}

/**
 * Nombre técnico de la herramienta → qué contarle al usuario.
 *
 * Antes de responder, el modelo puede encadenar varias rondas de búsqueda y
 * tardar medio minuto largo. Sin esto el panel se queda en blanco todo ese
 * rato y parece que la app se ha colgado.
 */
export const TOOL_LABELS: Record<string, string> = {
  leer_pasaje_biblico: "Leyendo el pasaje bíblico",
  buscar_en_biblioteca: "Buscando en la Biblioteca en Línea",
  abrir_documento: "Leyendo el artículo",
  obtener_texto_del_dia: "Consultando el texto del día",
  get_verse_with_study: "Consultando notas de estudio",
  getWatchtowerContent: "Leyendo La Atalaya",
  getWatchtowerLinks: "Buscando en La Atalaya",
  getWorkbookContent: "Consultando la guía de actividades",
  getWorkbookLinks: "Buscando en la guía de actividades",
  get_jw_captions: "Revisando subtítulos de vídeo",
  get_bible_verse: "Leyendo el versículo",
  search_bible_books: "Buscando el libro bíblico",
};

/** Extrae el argumento más informativo para acompañar a la etiqueta. */
function describeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;

  if (typeof a.consulta === "string") return a.consulta;
  if (typeof a.query === "string") return a.query;
  if (typeof a.libro === "string") {
    return [a.libro, a.capitulo, a.versiculo && a.versiculo !== "all" ? `:${a.versiculo}` : ""]
      .filter(Boolean)
      .join(" ")
      .replace(" :", ":");
  }
  return "";
}

/** Valida las fuentes que llegan por SSE antes de meterlas en el store. */
function parseSources(raw: unknown): ChatSource[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const s = item as Record<string, unknown>;
    if (typeof s.kind !== "string" || typeof s.label !== "string") return [];
    return [s as unknown as ChatSource];
  });
}

function parseStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

/**
 * El `detail` que manda FastAPI, o el estado HTTP si no viene ninguno.
 *
 * Sin esto el usuario leía "HTTP 503: Service Unavailable" donde el backend
 * había escrito "Configura tu API key en Más → Ajustes de IA para usar el
 * chat": un mensaje accionable cambiado por uno que no dice nada.
 */
async function errorDetail(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    const value = (payload as Record<string, unknown> | null)?.detail;
    if (typeof value === "string" && value.trim()) return value;
  } catch {
    // Cuerpo vacío o que no es JSON: nos quedamos con el estado.
  }
  return `HTTP ${response.status}: ${response.statusText}`;
}

// ─── Con qué responde cada conversación ──────────────────────────

/**
 * Cabeceras y cuerpo de UN turno, con el modelo de SU conversación.
 *
 * Mismas reglas que `aiRequestBody`/`aiRequestHeaders` —la key solo en la
 * cabecera, el proveedor solo si hay key propia, el esfuerzo siempre— pero
 * leyendo el proveedor, el modelo y el esfuerzo de la conversación en vez de
 * los globales. Cada campo cae al ajuste global cuando la conversación no lo
 * tiene, que es el caso de todas las anteriores a esta función.
 *
 * La key se busca aquí, por proveedor, y no se guarda en ningún sitio nuevo:
 * mandar la key de OpenAI con `provider: "google"` porque el global iba por
 * otro lado es exactamente el fallo que esto evita. `research` se toma de
 * `aiRequestBody()` para no repetir su mapeo en dos ficheros.
 */
function turnAiConfig(ai: ConversationAi | null): {
  headers: Record<string, string>;
  body: Record<string, unknown>;
} {
  const { settings } = useAiSettingsStore.getState();
  const { research } = aiRequestBody();

  const provider = ai?.provider || settings.provider;
  const apiKey = settings.byProvider[provider]?.apiKey ?? "";
  const model = ai?.model || settings.byProvider[provider]?.model || "";
  const effort = ai?.effort || settings.effort;

  return {
    headers: apiKey ? { [AI_KEY_HEADER]: apiKey } : {},
    body: {
      // En modo servidor el proveedor lo decide el servidor: mandarlo solo
      // confundiría, igual que en `aiRequestBody`.
      ...(apiKey && provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(research ? { research } : {}),
    },
  };
}

/**
 * Fragmentos de los libros del usuario que vienen a cuento de la pregunta.
 *
 * La biblioteca .jwpub vive en IndexedDB y el agente corre en el servidor, así
 * que la búsqueda se hace aquí y solo viajan los extractos (ver
 * localLibrarySearch.ts). Sin libros marcados esto devuelve `[]` y la petición
 * sale byte a byte igual que antes de que existiera la función.
 *
 * **Un fallo aquí no puede tumbar el turno.** Esto es un extra: una biblioteca
 * corrupta, IndexedDB bloqueado en modo privado o una expresión regular que se
 * atraganta tienen que acabar en una pregunta sin fragmentos, nunca en un chat
 * que no responde. `searchLocalLibrary` ya captura lo suyo; el segundo
 * `try/catch` cubre lo que pueda romperse antes de entrar en ella.
 */
async function localLibraryContext(question: string): Promise<LocalSnippetWire[]> {
  try {
    const symbols = localBooksForChat();
    if (symbols.length === 0 || !question.trim()) return [];
    return toWire(await searchLocalLibrary(question, symbols));
  } catch (error) {
    console.warn("[biblioteca] no se adjuntaron fragmentos locales:", error);
    return [];
  }
}

/**
 * Sigue una investigación profunda hasta el final.
 *
 * El turno de chat ya se cerró: el backend respondió con un `event: job` y
 * colgó. A partir de aquí el trabajo vive en el servidor y esta función se
 * limita a volcar sus eventos al store, reconectando sola si hace falta.
 *
 * Cuando llega el `done`, el informe se guarda como un mensaje normal del
 * asistente: así hereda copiar, compartir, exportar y los chips de fuentes sin
 * una sola línea de código nueva.
 *
 * Se reengancha SIEMPRE desde el evento 1, también al reanudar: el texto del
 * informe no se guarda en ninguna parte hasta que termina, así que pedirle al
 * backend solo "lo que falta" archivaba un informe sin su principio. Repetir
 * los eventos no cuesta nada —están en la memoria del servidor— y reconstruye
 * el plan, las fuentes, los metadatos y el texto enteros.
 */
export async function trackResearchJob(
  jobId: string,
  conversationId: string,
  question: string,
  estimatedSeconds: number,
): Promise<void> {
  // Antes solo se llamaba al arrancar de cero. Al reanudar, `jobId` se quedaba
  // en null: no se pintaba la barra de progreso y el banner de "Reanudar"
  // seguía en pantalla, invitando a duplicar el seguimiento.
  useResearchStore
    .getState()
    .start(jobId, conversationId, question, estimatedSeconds);

  const controller = new AbortController();
  trackTurn(conversationId, controller, jobId);

  let answer = "";
  let meta: ChatMessageMeta | undefined;
  let sources: ChatSource[] = [];
  let docs = 0;

  /** Cierra el turno dejando constancia de por qué. */
  const fail = (message: string): void => {
    useResearchStore.getState().setError(message);
    // También en el chatStore: el banner de error de `ChatScreen` es lo único
    // que sigue en pantalla después de que la barra de progreso desaparezca.
    // Con el id de SU conversación: un informe que tarda minutos puede fallar
    // cuando el usuario ya está leyendo otra pestaña.
    useChatStore.getState().setError(message, conversationId);
    useChatStore.getState().abortTurn(answer, conversationId);
    useResearchStore.getState().finish();
  };

  await followJob({
    jobId,
    signal: controller.signal,
    onGone: () => {
      fail("Esa investigación ya no está en el servidor. Puedes volver a lanzarla.");
    },
    onError: (message) => {
      // Antes esto solo escribía en el researchStore: `isStreaming` se quedaba
      // en true para siempre y el composer no volvía nunca.
      fail(message);
    },
    onEvent: (event) => {
      const store = useResearchStore.getState();
      if (typeof event.id === "number") store.setLastEventId(event.id);

      switch (event.event) {
        case "plan": {
          const items = Array.isArray(event.data.items) ? event.data.items : [];
          store.setPlan(
            items.flatMap((item) => {
              if (!item || typeof item !== "object") return [];
              const i = item as Record<string, unknown>;
              return typeof i.question === "string"
                ? [{ id: Number(i.id) || 0, question: i.question }]
                : [];
            }),
          );
          break;
        }
        case "progress":
          docs = Number(event.data.docs) || docs;
          store.setProgress({
            step: Number(event.data.step) || 0,
            total: Number(event.data.total) || 0,
            label: String(event.data.label ?? ""),
            docs,
            elapsedMs: Number(event.data.elapsed_ms) || 0,
          });
          break;
        case "sources":
          sources = parseSources(event.data.items);
          useChatStore.getState().setPendingSources(sources, conversationId);
          // El backend emite las fuentes justo al terminar el plan: a partir
          // de aquí ya solo queda redactar.
          store.setWriting();
          break;
        case "token":
          answer += String(event.data.text ?? "");
          useChatStore.getState().appendToken(answer, conversationId);
          break;
        case "metadata":
          meta = parseMeta(event.data);
          break;
        case "report":
          docs = Number(event.data.docs) || docs;
          meta = { ...(meta ?? {}), deep: true, docs };
          break;
        case "error": {
          const message = String(event.data.message ?? "La investigación falló.");
          store.setError(message);
          // El `done` llega justo detrás y hace desaparecer la barra de
          // progreso: sin dejarlo también aquí, el usuario no vería nada.
          useChatStore.getState().setError(message, conversationId);
          break;
        }
        case "done":
          // Con el `conversationId` explícito: la investigación tarda minutos
          // y el informe tiene que volver a SU conversación, no a la que esté
          // abierta cuando termine.
          useChatStore
            .getState()
            .finishTurn(
              answer,
              [],
              { ...(meta ?? {}), deep: true, docs },
              conversationId,
            );
          store.finish();
          break;
        default:
          break;
      }
    },
  });

  releaseTurn(conversationId, controller);

  // Cancelado por el usuario: `followJob` vuelve en silencio y hay que cerrar
  // el turno a mano, o el composer se queda bloqueado. Se mira el estado de SU
  // sesión y no el espejo `isStreaming`, que habla de la conversación que el
  // usuario tenga delante y puede no ser esta.
  const session = useChatStore.getState().sessions[conversationId];
  if (controller.signal.aborted && session?.isStreaming) {
    useChatStore.getState().abortTurn(answer, conversationId);
    useResearchStore.getState().finish();
  }
}

/**
 * Reengancha una investigación que quedó a medias (banner de "Reanudar").
 *
 * Pregunta primero por la instantánea: si el trabajo ya no está en el servidor
 * —un redeploy se lleva por delante los que estén vivos— se dice y se descarta,
 * en vez de abrir un SSE que solo va a devolver un 404.
 */
export async function resumeResearchJob(
  jobId: string,
  conversationId: string,
  question: string,
): Promise<void> {
  const snapshot = await fetchSnapshot(jobId);
  if (!snapshot) {
    useResearchStore.getState().dismissResumable();
    useChatStore
      .getState()
      .setError(
        "Esa investigación ya no está en el servidor. Puedes volver a lanzarla.",
        conversationId,
      );
    useChatStore.getState().abortTurn("", conversationId);
    return;
  }

  await trackResearchJob(jobId, conversationId, snapshot.question || question, 240);
}

/** Metadatos del evento `metadata`. Todo opcional: el backend puede ser viejo. */
function parseMeta(raw: Record<string, unknown>): ChatMessageMeta | undefined {
  const text = (key: string): string | undefined =>
    typeof raw[key] === "string" && raw[key] ? (raw[key] as string) : undefined;

  const meta: ChatMessageMeta = {
    provider: text("provider"),
    model: text("model"),
    effort: text("effort"),
    effortApplied: text("effort_applied"),
  };
  return Object.values(meta).some(Boolean) ? meta : undefined;
}

/**
 * useChat — hook para el chat IA con OpenAI + MCP.
 *
 * Usa fetch + ReadableStream para consumir SSE del backend. El estado vive en
 * `chatStore` y el historial se persiste en SQLite: antes estaba en un
 * `useState` local y se perdía al recargar o al desmontar la pestaña.
 */
export function useChat(): UseChatReturn {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamingContent = useChatStore((s) => s.streamingContent);
  const activity = useChatStore((s) => s.activity);
  const error = useChatStore((s) => s.error);

  // Sin abortar nada al desmontar, a propósito. El turno no es de esta
  // instancia: el estado vive en el store y la respuesta se persiste en
  // SQLite. Antes se abortaba, y como el guardia de "componente montado"
  // impedía cerrar el turno, cambiar de pestaña a mitad de una respuesta
  // dejaba `isStreaming` en true para siempre: al volver, el composer estaba
  // bloqueado y la única salida era recargar. Ahora la respuesta sigue,
  // termina y está ahí al volver.

  /**
   * Abre el stream con el historial que ya hay en el store.
   *
   * Está separado de `send` para que reintentar tras un fallo de red no vuelva
   * a insertar el mensaje del usuario (ya está guardado en SQLite).
   */
  const runTurn = useCallback(async (conversationId: string) => {
    // Todo se lee de SU sesión, no de los espejos: si el usuario cambia de
    // pestaña mientras esto arranca, los espejos ya hablan de otra
    // conversación y el turno se iría con el historial y el modelo ajenos.
    const store = useChatStore.getState();
    const session = store.sessions[conversationId];
    const requestMessages = buildRequestMessages(session?.messages ?? store.messages);
    const mode = session?.mode ?? store.mode;
    const ai = turnAiConfig(session?.ai ?? null);

    const controller = new AbortController();
    trackTurn(conversationId, controller);

    let fullContent = "";
    let suggestions: string[] = [];
    let meta: ChatMessageMeta | undefined;
    let deepJob: { jobId: string; estimatedSeconds: number } | null = null;

    try {
      // Antes del `fetch` y no en paralelo: el cuerpo tiene que salir ya con
      // los fragmentos dentro. Es la última pregunta del usuario la que manda,
      // no la conversación entera: buscar con el historial completo devolvería
      // los fragmentos del tema de hace cinco turnos.
      const pregunta =
        [...requestMessages].reverse().find((m) => m.role === "user")?.content ?? "";
      const localLibrary = await localLibraryContext(pregunta);

      const response = await fetch(CHAT_STREAM_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          // La API key del usuario, si la hay. Solo aquí: nunca en el cuerpo
          // ni en la URL. Sin key configurada esto es `{}` y la petición sale
          // exactamente igual que antes de que existiera el modo BYOK.
          ...ai.headers,
        },
        body: JSON.stringify({
          messages: requestMessages,
          mode,
          conversation_id: conversationId,
          ...ai.body,
          // Solo si hay algo: mandar `local_library: []` en todos los turnos
          // ensuciaría el cuerpo de quien no usa la biblioteca y obligaría al
          // backend a distinguir "sin libros" de "sin coincidencias", que para
          // él son lo mismo.
          ...(localLibrary.length > 0 ? { local_library: localLibrary } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await errorDetail(response));
      }

      if (!response.body) {
        throw new Error("Response body is null");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = splitSSEEvents(buffer);
        buffer = rest;

        for (const rawEvent of events) {
          if (!rawEvent.trim()) continue;
          const parsed = parseSSEEvent(rawEvent);
          // Los comentarios de keepalive (": ping") no parsean: se ignoran.
          if (!parsed) continue;

          const chat = useChatStore.getState();

          switch (parsed.event) {
            case "tool_call": {
              const name = String(parsed.data.name ?? "");
              if (!name) break;
              chat.pushActivity(
                { name, detail: describeArgs(parsed.data.arguments) },
                conversationId,
              );
              break;
            }
            case "tool_result": {
              const name = String(parsed.data.name ?? "");
              if (!name) break;
              chat.completeActivity(
                name,
                String(parsed.data.summary ?? ""),
                conversationId,
              );
              break;
            }
            case "sources":
              chat.setPendingSources(
                parseSources(parsed.data.items),
                conversationId,
              );
              break;
            case "suggestions":
              suggestions = parseStringList(parsed.data.items);
              break;
            case "metadata":
              // Qué modelo respondió de verdad y con cuánto esfuerzo. Se pinta
              // en el pie del mensaje y se persiste con él: sin esto, releyendo
              // una conversación de hace un mes no hay forma de saber si la
              // escribió el modelo bueno o el barato.
              meta = parseMeta(parsed.data);
              break;
            case "token":
              fullContent += String(parsed.data.text ?? "");
              chat.appendToken(fullContent, conversationId);
              break;
            case "error":
              chat.setError(
                String(parsed.data.message ?? "Unknown error"),
                conversationId,
              );
              break;
            case "job": {
              // Modo profundo: el backend no responde con tokens sino con el
              // id de un trabajo que tarda minutos. El turno de chat se cierra
              // aquí y el seguimiento sigue por su cuenta.
              const jobId = String(parsed.data.job_id ?? "");
              if (!jobId) break;
              deepJob = {
                jobId,
                estimatedSeconds: Number(parsed.data.estimated_seconds) || 240,
              };
              break;
            }
            case "done":
              // Stream completado
              break;
            default:
              // Evento desconocido de un backend más nuevo: se ignora.
              break;
          }
        }
      }

      if (deepJob) {
        // El turno sigue "abierto" (isStreaming) a propósito: lo que llega
        // ahora es el informe, y el composer debe seguir bloqueado.
        const question =
          [...(useChatStore.getState().sessions[conversationId]?.messages ?? [])]
            .reverse()
            .find((m) => m.role === "user")?.content ?? "";
        void trackResearchJob(
          deepJob.jobId,
          conversationId,
          question,
          deepJob.estimatedSeconds,
        );
        return;
      }

      useChatStore
        .getState()
        .finishTurn(fullContent, suggestions, meta, conversationId);
    } catch (err) {
      if (controller.signal.aborted) {
        // Cancelado por el usuario — el parcial se guarda igualmente.
        useChatStore.getState().abortTurn(fullContent, conversationId);
      } else {
        const message = err instanceof Error ? err.message : "Unknown error";
        const chat = useChatStore.getState();
        chat.setError(message, conversationId);
        chat.abortTurn(fullContent, conversationId);
      }
    } finally {
      // Solo si sigue siendo el nuestro: en modo profundo, `trackResearchJob`
      // ya lo ha sustituido por el suyo antes de llegar aquí.
      releaseTurn(conversationId, controller);
    }
  }, []);

  const send = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      const store = useChatStore.getState();
      if (!trimmed || store.isStreaming) return;

      // El turno del usuario se persiste ANTES de abrir el stream: si la red
      // falla, la pregunta no se pierde y se puede reintentar.
      const conversationId = store.startTurn(trimmed);
      if (!conversationId) return;
      await runTurn(conversationId);
    },
    [runTurn],
  );

  /**
   * "Detener" — solo el turno de la conversación que se está mirando.
   *
   * En modo normal basta con abortar el `fetch`: su `catch` cierra el turno y
   * guarda el parcial. En investigación profunda no, porque el turno de chat ya
   * se cerró y lo que sigue corriendo es un trabajo en el servidor;
   * `stopTurn` lo cancela también allí y aquí se remata el cierre para que el
   * composer vuelva sin esperar a que `followJob` se entere.
   */
  const cancel = useCallback(() => {
    const chat = useChatStore.getState();
    const conversationId = chat.conversationId;
    if (!conversationId) return;

    const turn = stopTurn(conversationId);

    // Red de seguridad: la sesión se cree generando pero no hay ningún turno
    // vivo detrás (un fallo que nadie llegó a cerrar). Antes la única salida
    // era recargar la página, porque el composer se quedaba bloqueado.
    if (!turn) {
      if (chat.isStreaming) chat.abortTurn("", conversationId);
      return;
    }

    if (!turn.jobId) return;
    if (chat.isStreaming) {
      chat.abortTurn(chat.streamingContent, conversationId);
    }
    useResearchStore.getState().finish();
  }, []);

  const newConversation = useCallback(() => {
    useChatStore.getState().newConversation();
  }, []);

  /**
   * Reintenta.
   *
   * Dos situaciones distintas con el mismo botón:
   *  - la última fue del usuario (falló la red): se reabre el stream SIN
   *    volver a insertar la pregunta, que ya está guardada;
   *  - la última fue del asistente ("volver a preguntar"): se manda otra vez
   *    la misma pregunta como turno nuevo, para no perder la respuesta previa.
   */
  const retryLast = useCallback(() => {
    const store = useChatStore.getState();
    if (store.isStreaming || !store.conversationId) return;

    const last = store.messages[store.messages.length - 1];
    if (!last) return;

    if (last.role === "user") {
      store.resumeTurn();
      void runTurn(store.conversationId);
      return;
    }

    const lastUser = [...store.messages].reverse().find((m) => m.role === "user");
    if (lastUser) void send(lastUser.content);
  }, [runTurn, send]);

  return {
    messages,
    isStreaming,
    streamingContent,
    activity,
    error,
    send,
    cancel,
    newConversation,
    retryLast,
  };
}
