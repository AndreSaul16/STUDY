/**
 * LRUCache — Caché Least-Recently-Used en memoria.
 *
 * Usa el Map nativo de JS que mantiene orden de inserción.
 * Al acceder a una key, se elimina y se reinserta para moverla al final
 * (más reciente). Al exceder capacidad, se evicta el primer entry (más viejo).
 *
 * Thread-safe dentro del modelo single-threaded de JS (no hay concurrencia real).
 * Seguro para async: las promesas en vuelo se gestionan en el engine, no aquí.
 */

export class LRUCache<K, V> {
  private readonly map = new Map<K, V>();
  private readonly capacity: number;
  private _hits = 0;
  private _misses = 0;

  constructor(capacity: number = 128) {
    if (capacity < 1) {
      throw new Error(`LRUCache capacity must be >= 1, got ${capacity}`);
    }
    this.capacity = Math.floor(capacity);
  }

  /** Obtiene un valor y lo marca como recientemente usado. undefined si no existe. */
  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      this._misses++;
      return undefined;
    }
    const value = this.map.get(key)!;
    // Reinsertar para mover al final (más reciente)
    this.map.delete(key);
    this.map.set(key, value);
    this._hits++;
    return value;
  }

  /** Verifica si existe sin tocar el orden LRU. */
  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Peek — lee sin actualizar orden LRU ni contadores. */
  peek(key: K): V | undefined {
    return this.map.get(key);
  }

  /** Inserta o actualiza un valor. Evicta el LRU si excede capacidad. */
  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // Evictar el entry más viejo (primero en iteración)
      const oldest = this.map.keys().next();
      if (!oldest.done && oldest.value !== undefined) {
        this.map.delete(oldest.value as K);
      }
    }
    this.map.set(key, value);
  }

  /** Elimina una key. No-op si no existe. */
  delete(key: K): boolean {
    return this.map.delete(key);
  }

  /** Vacía la caché y resetea contadores. */
  clear(): void {
    this.map.clear();
    this._hits = 0;
    this._misses = 0;
  }

  /** Número de entries actuales. */
  get size(): number {
    return this.map.size;
  }

  /** Capacidad máxima configurada. */
  get maxCapacity(): number {
    return this.capacity;
  }

  /** Hits acumulados. */
  get hits(): number {
    return this._hits;
  }

  /** Misses acumulados. */
  get misses(): number {
    return this._misses;
  }

  /** Ratio de aciertos 0..1. 0 si no hay actividad. */
  get hitRate(): number {
    const total = this._hits + this._misses;
    return total === 0 ? 0 : this._hits / total;
  }

  /** Snapshot de las keys actuales en orden LRU (más viejo → más reciente). */
  keys(): K[] {
    return [...this.map.keys()];
  }
}
