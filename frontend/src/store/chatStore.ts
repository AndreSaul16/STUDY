/**
 * chatStore — estado del chat.
 *
 * SIN el middleware `persist` a propósito: la fuente de verdad del historial
 * es el SQLite local (conversationsRepository), no localStorage. Lo único que
 * se guarda aparte es el último modo usado, que es una preferencia y no un
 * dato de trabajo.
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
  setConversationMode,
  togglePinned,
  UNTITLED_CONVERSATION,
  type ConversationRow,
} from "@/db/repositories/conversationsRepository";
import {
  DEFAULT_CHAT_MODE,
  type ChatSource,
  type ChatUiMessage,
  type ToolActivity,
} from "@/types/chat";

const MODE_STORAGE_KEY = "study-chat-mode";

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

interface ChatState {
  conversationId: string | null;
  conversations: ConversationRow[];
  messages: ChatUiMessage[];
  mode: string;
  isStreaming: boolean;
  streamingContent: string;
  activity: ToolActivity[];
  pendingSources: ChatSource[];
  error: string | null;
  drawerOpen: boolean;
  hydrated: boolean;

  // ─── Ciclo de vida ─────────────────────────────────────────────
  hydrate: () => void;
  newConversation: (mode?: string) => void;
  openConversation: (conversationId: string) => void;
  removeConversation: (conversationId: string) => void;
  renameCurrent: (title: string) => void;
  togglePin: (conversationId: string) => void;
  refreshConversations: (query?: string) => void;
  setMode: (mode: string) => void;
  setDrawerOpen: (open: boolean) => void;

  // ─── Turno en curso ────────────────────────────────────────────
  setError: (error: string | null) => void;
  startTurn: (userContent: string) => string | null;
  resumeTurn: () => void;
  pushActivity: (activity: ToolActivity) => void;
  completeActivity: (name: string, summary: string) => void;
  appendToken: (text: string) => void;
  setPendingSources: (sources: ChatSource[]) => void;
  finishTurn: (content: string, suggestions: string[]) => void;
  abortTurn: (partial: string) => void;
  setSuggestionsForLast: (suggestions: string[]) => void;
}

/** Mensaje de UI a partir de una fila de SQLite. */
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

export const useChatStore = create<ChatState>()((set, get) => ({
  conversationId: null,
  conversations: [],
  messages: [],
  mode: readStoredMode(),
  isStreaming: false,
  streamingContent: "",
  activity: [],
  pendingSources: [],
  error: null,
  drawerOpen: false,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    try {
      // Las conversaciones que se abrieron y nunca se usaron solo ensucian.
      pruneEmptyConversations();
      const conversations = listConversations();
      const last = conversations[0] ?? null;

      set({
        conversations,
        hydrated: true,
        ...(last
          ? {
              conversationId: last.conversationId,
              mode: last.mode || readStoredMode(),
              messages: loadMessages(last.conversationId).map((row) => ({
                id: row.messageId,
                role: row.role,
                content: row.content,
                mode: row.mode ?? undefined,
                sources: row.sources,
                tools: row.tools,
                suggestions: row.suggestions,
                createdAt: row.createdAt * 1000,
              })),
            }
          : {}),
      });
    } catch {
      // La DB aún no está lista: se reintenta cuando useDatabaseReady lo diga.
      set({ hydrated: false });
    }
  },

  newConversation: (mode) => {
    const nextMode = mode ?? get().mode;
    const conversationId = createConversation(nextMode);
    set({
      conversationId,
      messages: [],
      mode: nextMode,
      streamingContent: "",
      activity: [],
      pendingSources: [],
      error: null,
      drawerOpen: false,
      conversations: listConversations(),
    });
  },

  openConversation: (conversationId) => {
    const conversation = getConversation(conversationId);
    if (!conversation) return;

    set({
      conversationId,
      mode: conversation.mode || get().mode,
      messages: loadMessages(conversationId).map((row) => ({
        id: row.messageId,
        role: row.role,
        content: row.content,
        mode: row.mode ?? undefined,
        sources: row.sources,
        tools: row.tools,
        suggestions: row.suggestions,
        createdAt: row.createdAt * 1000,
      })),
      streamingContent: "",
      activity: [],
      pendingSources: [],
      error: null,
      drawerOpen: false,
    });
  },

  removeConversation: (conversationId) => {
    deleteConversationRow(conversationId);
    const conversations = listConversations();
    const wasCurrent = get().conversationId === conversationId;

    set({
      conversations,
      ...(wasCurrent
        ? { conversationId: null, messages: [], pendingSources: [], activity: [] }
        : {}),
    });
  },

  renameCurrent: (title) => {
    const { conversationId } = get();
    if (!conversationId) return;
    renameConversation(conversationId, title);
    set({ conversations: listConversations() });
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
    const { conversationId, messages } = get();
    // El modo de una conversación ya empezada solo se reetiqueta si aún está
    // vacía; si no, el historial quedaría marcado con un modo que no se usó.
    if (conversationId && messages.length === 0) {
      setConversationMode(conversationId, mode);
    }
    set({ mode });
  },

  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),

  setError: (error) => set({ error }),

  startTurn: (userContent) => {
    let { conversationId } = get();
    if (!conversationId) {
      conversationId = createConversation(get().mode);
    }

    const userMessage = emptyMessage("user", userContent, get().mode);
    appendMessage({
      messageId: userMessage.id,
      conversationId,
      role: "user",
      content: userContent,
      mode: get().mode,
      sources: [],
      tools: [],
      suggestions: [],
    });

    // Primer mensaje → la conversación deja de llamarse "Conversación nueva".
    const conversation = getConversation(conversationId);
    if (conversation && conversation.title === UNTITLED_CONVERSATION) {
      renameConversation(conversationId, autoTitle(userContent));
    }

    set({
      conversationId,
      messages: [...get().messages, userMessage],
      isStreaming: true,
      streamingContent: "",
      activity: [],
      pendingSources: [],
      error: null,
      conversations: listConversations(),
    });

    return conversationId;
  },

  /** Reabre el turno sin volver a insertar la pregunta (reintento tras fallo). */
  resumeTurn: () =>
    set({
      isStreaming: true,
      streamingContent: "",
      activity: [],
      pendingSources: [],
      error: null,
    }),

  pushActivity: (activity) =>
    set((s) => ({ activity: [...s.activity, activity] })),

  completeActivity: (name, summary) =>
    set((s) => {
      // Cierra la ÚLTIMA actividad abierta con ese nombre: el modelo puede
      // pedir la misma herramienta varias veces en el mismo turno.
      const next = [...s.activity];
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (next[i].name === name && !next[i].done) {
          next[i] = { ...next[i], done: true, summary };
          break;
        }
      }
      return { activity: next };
    }),

  appendToken: (text) => set({ streamingContent: text }),

  setPendingSources: (pendingSources) => set({ pendingSources }),

  finishTurn: (content, suggestions) => {
    const { conversationId, mode, activity, pendingSources } = get();
    if (!conversationId || !content) {
      set({ isStreaming: false, streamingContent: "", activity: [] });
      return;
    }

    const message: ChatUiMessage = {
      ...emptyMessage("assistant", content, mode),
      sources: pendingSources,
      tools: activity,
      suggestions,
    };

    appendMessage({
      messageId: message.id,
      conversationId,
      role: "assistant",
      content,
      mode,
      sources: pendingSources,
      tools: activity,
      suggestions,
    });

    set({
      messages: [...get().messages, message],
      isStreaming: false,
      streamingContent: "",
      activity: [],
      pendingSources: [],
      conversations: listConversations(),
    });
  },

  abortTurn: (partial) => {
    // El parcial también se persiste: es trabajo del usuario, no basura.
    if (partial) {
      get().finishTurn(`${partial} [cancelado]`, []);
      return;
    }
    set({ isStreaming: false, streamingContent: "", activity: [] });
  },

  setSuggestionsForLast: (suggestions) =>
    set((s) => {
      if (s.messages.length === 0) return {};
      const next = [...s.messages];
      const last = next[next.length - 1];
      if (last.role !== "assistant") return {};
      next[next.length - 1] = { ...last, suggestions };
      return { messages: next };
    }),
}));
