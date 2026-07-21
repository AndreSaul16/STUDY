import { useEffect, useState, useCallback } from "react";
import { initDatabase, getDatabase, saveDatabase } from "@/db/database";

interface UseDatabaseReturn {
  ready: boolean;
  error: string | null;
  save: () => Promise<void>;
}

/**
 * useDatabase — inicializa SQLite WASM al montar la app.
 *
 * Debe usarse una sola vez en el root (App.tsx).
 * Los componentes hijos acceden a la DB via los repositorios.
 */
export function useDatabase(): UseDatabaseReturn {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        await initDatabase();
        if (!cancelled) {
          setReady(true);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to init database");
        }
      }
    }

    void init();

    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async () => {
    await saveDatabase();
  }, []);

  return { ready, error, save };
}

/** Verifica que la DB está lista (para guards en componentes). */
export function useDatabaseReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        getDatabase();
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setReady(false);
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}
