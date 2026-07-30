import { useEffect } from "react";
import { useUIStore } from "@/store/uiStore";
import { useChatStore } from "@/store/chatStore";
import { useDatabase } from "@/hooks/useDatabase";
import { AppShell } from "@/components/templates/AppShell";

export default function App() {
  const theme = useUIStore((s) => s.theme);
  const { ready, error } = useDatabase();

  // El historial del chat vive en SQLite: hasta que la DB no está lista no se
  // puede leer, así que la hidratación cuelga del mismo gate que el resto.
  useEffect(() => {
    if (ready) useChatStore.getState().hydrate();
  }, [ready]);

  // Sincronizar clase .dark en <html> con el store
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  // Atajo ⌘K / Ctrl+K para abrir búsqueda
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const store = useUIStore.getState();
        store.setSearchOpen(!store.searchOpen);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (error) {
    return (
      <div className="flex h-dvh items-center justify-center bg-paper-100 dark:bg-ink-200">
        <div className="max-w-md p-8 text-center">
          <p className="font-display text-2xl text-red-600 dark:text-red-400">
            Error de base de datos
          </p>
          <p className="mt-2 font-ui text-sm text-muted-light dark:text-muted-dark">
            {error}
          </p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center bg-paper-100 dark:bg-ink-200">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-pulse rounded-full bg-amber-500" />
          <p className="mt-3 font-ui text-xs uppercase tracking-wider text-muted-light dark:text-muted-dark">
            Inicializando workspace…
          </p>
        </div>
      </div>
    );
  }

  return <AppShell />;
}
