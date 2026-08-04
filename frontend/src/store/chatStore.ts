/**
 * chatStore — varias conversaciones abiertas a la vez, cada una con su modelo.
 *
 * SIN el middleware `persist` a propósito: la fuente de verdad del historial es
 * el SQLite local (conversationsRepository), no localStorage. Lo único que se
 * guarda aparte son preferencias —el último modo usado y qué pestañas estaban
 * abiertas—, que son datos de navegación y no de trabajo.
 *
 * ── Por qué un mapa de sesiones y no un solo chat ──
 *
 * Hasta ahora el store guardaba `messages`, `isStreaming`, `mode`… en singular:
 * había UNA conversación viva y abrir otra descartaba la anterior a mitad de
 * respuesta. Ahora el estado real es `sessions` (una entrada por conversación
 * abierta) más `activeId`, y una conversación puede seguir recibiendo tokens
 * mientras se lee otra.
 *
 * ── Por qué siguen existiendo `messages`, `isStreaming`, `mode`… ──
 *
 * Son ESPEJOS de la sesión activa, recalculados en cada escritura por
 * `project()`. No es duplicación por comodidad: media app lee esos campos
 * (`BottomNav`, `MoreScreen`, `ChatMessage`, `useChat`) y varios de esos
 * ficheros no se pueden tocar en este cambio. Con los espejos, el chat de
 * siempre se comporta exactamente igual —con una sola conversación abierta el
 * comportamiento es indistinguible del anterior— y lo nuevo se construye encima
 * en vez de reescribir cada pantalla. La regla para que no se desincronicen es
 * estricta: **nada escribe los espejos a mano**, todo pasa por `project()`.
 *
 * ── Tope de conversaciones abiertas ──
 *
 * Cinco. Cada una abierta son sus mensajes en memoria y, posiblemente, un
 * stream vivo; y en una tira de pestañas de 390px más de cinco no se
 * distinguen. Al superarlo se cierra la vista hace más tiempo, **nunca una que
 * esté generando**: cerrarla tiraría tokens que el usuario está pagando. Si
 * todas están generando se pasa del tope antes que perder trabajo.
 */

import { create } from "zustand";
import {
  appendMessage,
  autoTitle,
  createConversation,
  deleteConversation as deleteConversationRow,
  getConversation,
  listConversations,
  loadMessages,
  newMessageId,
  pruneEmptyConversations,
  renameConversation,
  searchConversations,
  setConversationAi,
  setConversationMode,
  togglePinned,
  UNTITLED_CONVERSATION,
  type ChatMessageRow,
  type ConversationRow,
} from "@/db/repositories/conversationsRepository";
import { stopTurn } from "@/services/chatTurns";
import { useAiSettingsStore } from "@/store/aiSettingsStore";
import {
  DEFAULT_CHAT_MODE,
  type ChatMessageMeta,
  type ChatSource,
  type ChatUiMessage,
  type ConversationAi,
  type ToolActivity,
} from "@/types/chat";

const MODE_STORAGE_KEY = "study-chat-mode";
const OPEN_TABS_STORAGE_KEY = "study-chat-open";

/** Ver el encabezado del fichero para el porqué de este número. */
export const MAX_OPEN_CHATS = 5;

/**
 * Referencias vacías fijas para los espejos.
 *
 * Un `?? []` recién creado en cada `project()` haría que todo componente
 * suscrito a `messages` o a `activity` se repintara en cada token aunque no
 * hubiera conversación activa: zustand compara por identidad.
 */
const NO_MESSAGES: ChatUiMessage[] = [];
const NO_ACTIVITY: ToolActivity[] = [];
const NO_SOURCES: ChatSource[] = [];

function readStoredMode(): string {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) || DEFAULT_CHAT_MODE;
  } catch {
    return DEFAULT_CHAT_MODE;
  }
}

function writeStoredMode(mode: string): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Modo privado de Safari: la preferencia no se guarda, pero la app sigue.
  }
}

interface StoredTabs {
  ids: string[];
  activeId: string | null;
}

/**
 * Las pestañas que estaban abiertas la última vez.
 *
 * Se guardan solo los IDs: los mensajes se releen del SQLite al restaurar. Lo
 * que NO se guarda es que alguna estuviera generando, porque al recargar no lo
 * está: el `fetch` muere con la página y el texto a medias no se había
 * persistido en ninguna parte. La pregunta del usuario sí está guardada, así
 * que la conversación se reabre con ella a la vista y el composer libre para
 * repetirla. (La investigación profunda es la excepción y ya tiene su propio
 * camino: el trabajo sigue en el servidor y el banner de "Reanudar" lo
 * reengancha.)
 */
function readOpenTabs(): StoredTabs {
  try {
    const raw = localStorage.getItem(OPEN_TABS_STORAGE_KEY);
    if (!raw) return { ids: [], activeId: null };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ids: [], activeId: null };

    const stored = parsed as Record<string, unknown>;
    const ids = Array.isArray(stored.ids)
      ? stored.ids.filter((id): id is string => typeof id === "string")
      : [];
    return {
      ids: ids.slice(0, MAX_OPEN_CHATS),
      activeId: typeof stored.activeId === "string" ? stored.activeId : null,
    };
  } catch {
    return { ids: [], activeId: null };
  }
}

function writeOpenTabs(ids: string[], activeId: string | null): void {
  try {
    localStorage.setItem(OPEN_TABS_STORAGE_KEY, JSON.stringify({ ids, activeId }));
  } catch {
    // Igual que el modo: se pierde la restauración, no la conversación.
  }
}

/** Una conversación abierta: su historial, su turno y con qué responde. */
export interface ChatSession {
  conversationId: string;
  /**
   * Copia del título. No se lee de `conversations` porque esa lista se filtra
   * al buscar en el cajón: una pestaña abierta se quedaría sin nombre mientras
   * el usuario escribe en la caja de búsqueda.
   */
  title: string;
  messages: ChatUiMessage[];
  mode: string;
  ai: ConversationAi;
  isStreaming: boolean;
  streamingContent: string;
  activity: ToolActivity[];
  pendingSources: ChatSource[];
  error: string | null;
  /** Cuándo se miró por última vez. Decide a quién se desaloja. */
  touchedAt: number;
}

interface SessionsShape {
  sessions: Record<string, ChatSession>;
  openIds: string[];
  activeId: string | null;
}

interface ChatState extends SessionsShape {
  conversations: ConversationRow[];
  drawerOpen: boolean;
  hydrated: boolean;

  // ─── Espejos de la sesión activa ───────────────────────────────
  // Los escribe SOLO `project()`. Ver el encabezado del fichero.
  conversationId: string | null;
  messages: ChatUiMessage[];
  mode: string;
  isStreaming: boolean;
  streamingContent: string;
  activity: ToolActivity[];
  pendingSources: ChatSource[];
  error: string | null;

  // ─── Ciclo de vida ─────────────────────────────────────────────
  hydrate: () => void;
  newConversation: (mode?: string) => void;
  openConversation: (conversationId: string) => void;
  /** Cierra la pestaña sin borrar nada: la conversación sigue en el historial. */
  closeConversation: (conversationId: string) => void;
  removeConversation: (conversationId: string) => void;
  renameCurrent: (title: string) => void;
  /** Renombra cualquier conversación, esté abierta o no. */
  rename: (conversationId: string, title: string) => void;
  togglePin: (conversationId: string) => void;
  refreshConversations: (query?: string) => void;
  setMode: (mode: string) => void;
  setDrawerOpen: (open: boolean) => void;
  /** Cambia proveedor/modelo/esfuerzo de una conversación y lo persiste. */
  setSessionAi: (patch: Partial<ConversationAi>, conversationId?: string) => void;

  // ─── Turno en curso ────────────────────────────────────────────
  // Todas aceptan `conversationId`: sin él, el turno de la conversación B
  // escribiría sus tokens en la A cuando el usuario cambia de pestaña. Es
  // opcional y cae en la activa para que el camino de siempre no cambie.
  setError: (error: string | null, conversationId?: string) => void;
  startTurn: (userContent: string) => string | null;
  resumeTurn: (conversationId?: string) => void;
  pushActivity: (activity: ToolActivity, conversationId?: string) => void;
  completeActivity: (
    name: string,
    summary: string,
    conversationId?: string,
  ) => void;
  appendToken: (text: string, conversationId?: string) => void;
  setPendingSources: (sources: ChatSource[], conversationId?: string) => void;
  /**
   * Cierra el turno y guarda la respuesta.
   *
   * `targetConversationId` existe por la investigación profunda: tarda minutos
   * y el usuario puede abrir otra conversación mientras tanto. Sin él, el
   * informe se guardaba en la que estuviera abierta al terminar.
   *
   * La respuesta se guarda SIEMPRE en la base y, si su conversación sigue
   * abierta, también en su sesión —esté a la vista o no—. Antes solo se pintaba
   * si daba la casualidad de que era la conversación activa; ahora al volver a
   * la pestaña la respuesta ya está ahí, sin recargar nada.
   */
  finishTurn: (
    content: string,
    suggestions: string[],
    meta?: ChatMessageMeta,
    targetConversationId?: string,
  ) => void;
  abortTurn: (partial: string, targetConversationId?: string) => void;
}

/** Mensaje de UI recién creado. */
function emptyMessage(
  role: "user" | "assistant",
  content: string,
  mode: string,
): ChatUiMessage {
  return {
    id: newMessageId(),
    role,
    content,
    mode,
    sources: [],
    tools: [],
    suggestions: [],
    createdAt: Date.now(),
  };
}

/** Fila de SQLite → mensaje de UI. */
function toUiMessage(row: ChatMessageRow): ChatUiMessage {
  return {
    id: row.messageId,
    role: row.role,
    content: row.content,
    mode: row.mode ?? undefined,
    sources: row.sources,
    tools: row.tools,
    suggestions: row.suggestions,
    meta: row.meta,
    createdAt: row.createdAt * 1000,
  };
}

/** Abre en memoria una conversación que ya está en la base. */
function sessionFromRow(row: ConversationRow, fallbackMode: string): ChatSession {
  return {
    conversationId: row.conversationId,
    title: row.title,
    messages: loadMessages(row.conversationId).map(toUiMessage),
    mode: row.mode || fallbackMode,
    ai: row.ai,
    isStreaming: false,
    streamingContent: "",
    activity: [],
    pendingSources: [],
    error: null,
    touchedAt: Date.now(),
  };
}

/**
 * Recalcula los espejos a partir de la sesión activa.
 *
 * Toda escritura que toque `sessions`, `openIds` o `activeId` pasa por aquí; es
 * lo que impide que el espejo y la sesión cuenten cosas distintas.
 */
function project(state: ChatState, next: Partial<SessionsShape>): Partial<ChatState> {
  const sessions = next.sessions ?? state.sessions;
  const openIds = next.openIds ?? state.openIds;
  const activeId = next.activeId !== undefined ? next.activeId : state.activeId;
  const active = activeId ? sessions[activeId] : undefined;

  // Solo cuando cambia el juego de pestañas: `project` corre en cada token y
  // escribir en localStorage a esa cadencia bloquearía el hilo principal.
  if (openIds !== state.openIds || activeId !== state.activeId) {
    writeOpenTabs(openIds, activeId);
  }

  return {
    sessions,
    openIds,
    activeId,
    conversationId: active?.conversationId ?? null,
    messages: active?.messages ?? NO_MESSAGES,
    // Sin conversación abierta se conserva la preferencia global: es lo que
    // enseña el selector de modo de Ajustes, que no depende de ningún chat.
    mode: active?.mode ?? state.mode,
    isStreaming: active?.isStreaming ?? false,
    streamingContent: active?.streamingContent ?? "",
    activity: active?.activity ?? NO_ACTIVITY,
    pendingSources: active?.pendingSources ?? NO_SOURCES,
    error: active?.error ?? null,
  };
}

/**
 * Desaloja las conversaciones que sobran del tope.
 *
 * Nunca la activa ni una que esté generando. Si no queda ninguna candidata se
 * devuelve el mapa tal cual: pasarse temporalmente del tope es mucho menos
 * grave que cortar una respuesta a medias.
 */
function evict(
  sessions: Record<string, ChatSession>,
  openIds: string[],
  keepId: string | null,
): { sessions: Record<string, ChatSession>; openIds: string[] } {
  let nextSessions = sessions;
  let nextOpenIds = openIds;

  while (nextOpenIds.length > MAX_OPEN_CHATS) {
    const candidate = nextOpenIds
      .filter((id) => id !== keepId && !nextSessions[id]?.isStreaming)
      .sort(
        (a, b) =>
          (nextSessions[a]?.touchedAt ?? 0) - (nextSessions[b]?.touchedAt ?? 0),
      )[0];
    if (!candidate) break;

    const { [candidate]: _closed, ...rest } = nextSessions;
    nextSessions = rest;
    nextOpenIds = nextOpenIds.filter((id) => id !== candidate);
  }

  return { sessions: nextSessions, openIds: nextOpenIds };
}

/**
 * El proveedor, el modelo y el esfuerzo con los que nace una conversación.
 *
 * Se copian los ajustes globales del momento en vez de dejarlo a null: así la
 * conversación recuerda con qué se abrió aunque el usuario cambie después su
 * modelo por defecto. La API key no se copia —ni aquí ni en ningún sitio—: se
 * busca al enviar, por proveedor, en `aiSettingsStore`.
 */
function globalAiSnapshot(): ConversationAi {
  const { settings } = useAiSettingsStore.getState();
  return {
    provider: settings.provider || null,
    model: settings.byProvider[settings.provider]?.model || null,
    effort: settings.effort || null,
  };
}

export const useChatStore = create<ChatState>()((set, get) => {
  /** Parchea UNA sesión y reproyecta. Si ya no está abierta, no hace nada. */
  const patchSession = (
    conversationId: string,
    patch: Partial<ChatSession>,
    extra?: Partial<ChatState>,
  ): void => {
    const state = get();
    const current = state.sessions[conversationId];
    if (!current) return;
    set({
      ...project(state, {
        sessions: { ...state.sessions, [conversationId]: { ...current, ...patch } },
      }),
      ...extra,
    });
  };

  /** A qué conversación va lo que se está escribiendo: la dicha, o la activa. */
  const target = (conversationId?: string): string | null =>
    conversationId ?? get().activeId;

  return {
    sessions: {},
    openIds: [],
    activeId: null,
    conversations: [],
    drawerOpen: false,
    hydrated: false,

    conversationId: null,
    messages: NO_MESSAGES,
    mode: readStoredMode(),
    isStreaming: false,
    streamingContent: "",
    activity: NO_ACTIVITY,
    pendingSources: NO_SOURCES,
    error: null,

    hydrate: () => {
      if (get().hydrated) return;
      try {
        const stored = readOpenTabs();
        // Las conversaciones que se abrieron y nunca se usaron solo ensucian,
        // salvo las que estaban abiertas: esas se van a restaurar ahora mismo.
        pruneEmptyConversations(stored.ids);

        const conversations = listConversations();
        const byId = new Map(conversations.map((c) => [c.conversationId, c]));

        // Las guardadas que sigan existiendo. Si no hay ninguna (primera vez,
        // o se borraron), se abre la MÁS RECIENTE —no la primera de la lista,
        // que ordena por fijadas y hacía que fijar una conversación vieja
        // abriera esa al arrancar en vez de la que se estaba usando—.
        let ids = stored.ids.filter((id) => byId.has(id));
        if (ids.length === 0) {
          const last = conversations.reduce<ConversationRow | null>(
            (best, c) => (best === null || c.updatedAt > best.updatedAt ? c : best),
            null,
          );
          ids = last ? [last.conversationId] : [];
        }

        const fallbackMode = readStoredMode();
        const sessions: Record<string, ChatSession> = {};
        for (const id of ids) {
          const row = byId.get(id);
          if (row) sessions[id] = sessionFromRow(row, fallbackMode);
        }

        const activeId =
          stored.activeId && sessions[stored.activeId]
            ? stored.activeId
            : (ids[0] ?? null);

        set({
          ...project(get(), { sessions, openIds: ids, activeId }),
          conversations,
          hydrated: true,
        });
      } catch {
        // La DB aún no está lista: se reintenta cuando useDatabaseReady lo diga.
        set({ hydrated: false });
      }
    },

    newConversation: (mode) => {
      const state = get();
      const nextMode = mode ?? state.mode;
      const active = state.activeId ? state.sessions[state.activeId] : undefined;

      // Si la conversación abierta está en blanco, se reutiliza. "Nueva
      // conversación" se dispara desde tres sitios (la cabecera, el cajón y
      // repulsar Chat en la barra inferior) y sin esto un par de pulsaciones
      // distraídas llenaban la tira de pestañas vacías idénticas.
      if (active && active.messages.length === 0 && !active.isStreaming) {
        if (active.mode !== nextMode) setConversationMode(active.conversationId, nextMode);
        patchSession(
          active.conversationId,
          { mode: nextMode, error: null, touchedAt: Date.now() },
          { drawerOpen: false },
        );
        return;
      }

      const ai = globalAiSnapshot();
      const conversationId = createConversation(nextMode, ai);
      const session: ChatSession = {
        conversationId,
        title: UNTITLED_CONVERSATION,
        messages: [],
        mode: nextMode,
        ai,
        isStreaming: false,
        streamingContent: "",
        activity: [],
        pendingSources: [],
        error: null,
        touchedAt: Date.now(),
      };

      const { sessions, openIds } = evict(
        { ...state.sessions, [conversationId]: session },
        [...state.openIds, conversationId],
        conversationId,
      );

      set({
        ...project(state, { sessions, openIds, activeId: conversationId }),
        drawerOpen: false,
        conversations: listConversations(),
      });
    },

    openConversation: (conversationId) => {
      const state = get();

      // Ya abierta: solo se pone al frente. Volver a leerla de la base tiraría
      // el turno vivo y el texto a medias, que es justo lo que este cambio
      // venía a arreglar.
      const open = state.sessions[conversationId];
      if (open) {
        set({
          ...project(state, {
            sessions: {
              ...state.sessions,
              [conversationId]: { ...open, touchedAt: Date.now() },
            },
            activeId: conversationId,
          }),
          drawerOpen: false,
        });
        return;
      }

      const row = getConversation(conversationId);
      if (!row) return;

      const session = sessionFromRow(row, state.mode);
      const { sessions, openIds } = evict(
        { ...state.sessions, [conversationId]: session },
        [...state.openIds, conversationId],
        conversationId,
      );

      set({
        ...project(state, { sessions, openIds, activeId: conversationId }),
        drawerOpen: false,
      });
    },

    closeConversation: (conversationId) => {
      const state = get();
      if (!state.sessions[conversationId]) return;

      // Cerrar una pestaña que está generando corta su turno. El parcial no se
      // pierde: abortar el `fetch` hace que su `catch` lo guarde como cualquier
      // "Detener". Por eso el botón de cerrar pide confirmación cuando hay un
      // turno vivo, en vez de bloquearse: una pestaña atascada tiene que poder
      // cerrarse siempre.
      stopTurn(conversationId);

      const { [conversationId]: _closed, ...sessions } = state.sessions;
      const openIds = state.openIds.filter((id) => id !== conversationId);
      const activeId =
        state.activeId === conversationId
          ? (openIds[Math.max(0, state.openIds.indexOf(conversationId) - 1)] ??
            openIds[0] ??
            null)
          : state.activeId;

      set(project(state, { sessions, openIds, activeId }));
    },

    removeConversation: (conversationId) => {
      stopTurn(conversationId);
      deleteConversationRow(conversationId);

      const state = get();
      const { [conversationId]: _deleted, ...sessions } = state.sessions;
      const openIds = state.openIds.filter((id) => id !== conversationId);
      const activeId =
        state.activeId === conversationId ? (openIds[0] ?? null) : state.activeId;

      set({
        ...project(state, { sessions, openIds, activeId }),
        conversations: listConversations(),
      });
    },

    renameCurrent: (title) => {
      const { activeId } = get();
      if (!activeId) return;
      get().rename(activeId, title);
    },

    rename: (conversationId, title) => {
      const clean = title.trim();
      if (!clean) return;
      renameConversation(conversationId, clean);
      const state = get();
      const session = state.sessions[conversationId];
      set({
        ...(session
          ? project(state, {
              sessions: {
                ...state.sessions,
                [conversationId]: { ...session, title: clean },
              },
            })
          : {}),
        conversations: listConversations(),
      });
    },

    togglePin: (conversationId) => {
      togglePinned(conversationId);
      set({ conversations: listConversations() });
    },

    refreshConversations: (query) => {
      set({
        conversations: query?.trim()
          ? searchConversations(query)
          : listConversations(),
      });
    },

    setMode: (mode) => {
      writeStoredMode(mode);
      const state = get();
      const active = state.activeId ? state.sessions[state.activeId] : undefined;
      if (!active) {
        // Sin conversación abierta esto es solo la preferencia por defecto (el
        // selector de Ajustes). El espejo `mode` la conserva.
        set({ mode });
        return;
      }
      // El modo de una conversación ya empezada solo se reetiqueta en la base
      // si aún está vacía; si no, el historial quedaría marcado con un modo que
      // no se usó.
      if (active.messages.length === 0) {
        setConversationMode(active.conversationId, mode);
      }
      patchSession(active.conversationId, { mode });
    },

    setDrawerOpen: (drawerOpen) => set({ drawerOpen }),

    setSessionAi: (patch, conversationId) => {
      const id = target(conversationId);
      const state = get();
      const session = id ? state.sessions[id] : undefined;
      if (!id || !session) return;

      const ai: ConversationAi = { ...session.ai, ...patch };
      setConversationAi(id, ai);
      patchSession(id, { ai });
    },

    setError: (error, conversationId) => {
      const id = target(conversationId);
      if (id) patchSession(id, { error });
    },

    startTurn: (userContent) => {
      let conversationId = get().activeId;
      if (!conversationId || !get().sessions[conversationId]) {
        get().newConversation();
        conversationId = get().activeId;
      }
      const session = conversationId ? get().sessions[conversationId] : undefined;
      if (!conversationId || !session) return null;

      const userMessage = emptyMessage("user", userContent, session.mode);
      appendMessage({
        messageId: userMessage.id,
        conversationId,
        role: "user",
        content: userContent,
        mode: session.mode,
        sources: [],
        tools: [],
        suggestions: [],
      });

      // Primer mensaje → la conversación deja de llamarse "Conversación nueva".
      let title = session.title;
      if (title === UNTITLED_CONVERSATION) {
        title = autoTitle(userContent);
        renameConversation(conversationId, title);
      }

      patchSession(
        conversationId,
        {
          title,
          messages: [...session.messages, userMessage],
          isStreaming: true,
          streamingContent: "",
          activity: [],
          pendingSources: [],
          error: null,
          touchedAt: Date.now(),
        },
        { conversations: listConversations() },
      );

      return conversationId;
    },

    /** Reabre el turno sin volver a insertar la pregunta (reintento tras fallo). */
    resumeTurn: (conversationId) => {
      const id = target(conversationId);
      if (!id) return;
      patchSession(id, {
        isStreaming: true,
        streamingContent: "",
        activity: [],
        pendingSources: [],
        error: null,
      });
    },

    pushActivity: (activity, conversationId) => {
      const id = target(conversationId);
      const session = id ? get().sessions[id] : undefined;
      if (!id || !session) return;
      patchSession(id, { activity: [...session.activity, activity] });
    },

    completeActivity: (name, summary, conversationId) => {
      const id = target(conversationId);
      const session = id ? get().sessions[id] : undefined;
      if (!id || !session) return;

      // Cierra la ÚLTIMA actividad abierta con ese nombre: el modelo puede
      // pedir la misma herramienta varias veces en el mismo turno.
      const next = [...session.activity];
      for (let i = next.length - 1; i >= 0; i -= 1) {
        const item = next[i];
        if (item && item.name === name && !item.done) {
          next[i] = { ...item, done: true, summary };
          break;
        }
      }
      patchSession(id, { activity: next });
    },

    appendToken: (text, conversationId) => {
      const id = target(conversationId);
      if (id) patchSession(id, { streamingContent: text });
    },

    setPendingSources: (pendingSources, conversationId) => {
      const id = target(conversationId);
      if (id) patchSession(id, { pendingSources });
    },

    finishTurn: (content, suggestions, meta, targetConversationId) => {
      const id = target(targetConversationId);
      const session = id ? get().sessions[id] : undefined;

      if (!id || !content) {
        if (id) {
          patchSession(id, {
            isStreaming: false,
            streamingContent: "",
            activity: [],
          });
        }
        return;
      }

      // La conversación puede estar cerrada (una investigación de tres minutos
      // sobrevive a que se cierre su pestaña): entonces el modo se lee de la
      // base, porque el mensaje se guarda igualmente. Y puede estar BORRADA, si
      // el usuario la eliminó mientras se generaba: ahí no se guarda nada, o
      // quedaría un mensaje huérfano apuntando a una conversación que ya no
      // existe (sql.js no aplica el ON DELETE CASCADE).
      const row = session ? null : getConversation(id);
      if (!session && !row) return;
      const mode = session?.mode ?? row?.mode ?? get().mode;
      const message: ChatUiMessage = {
        ...emptyMessage("assistant", content, mode),
        sources: session?.pendingSources ?? [],
        tools: session?.activity ?? [],
        suggestions,
        meta,
      };

      appendMessage({
        messageId: message.id,
        conversationId: id,
        role: "assistant",
        content,
        mode,
        sources: message.sources,
        tools: message.tools,
        suggestions,
        meta,
      });

      if (session) {
        patchSession(
          id,
          {
            messages: [...session.messages, message],
            isStreaming: false,
            streamingContent: "",
            activity: [],
            pendingSources: [],
          },
          { conversations: listConversations() },
        );
        return;
      }
      set({ conversations: listConversations() });
    },

    abortTurn: (partial, targetConversationId) => {
      // El parcial también se persiste: es trabajo del usuario, no basura.
      if (partial) {
        get().finishTurn(
          `${partial} [cancelado]`,
          [],
          undefined,
          targetConversationId,
        );
        return;
      }
      const id = target(targetConversationId);
      if (id) {
        patchSession(id, {
          isStreaming: false,
          streamingContent: "",
          activity: [],
        });
      }
    },
  };
});
