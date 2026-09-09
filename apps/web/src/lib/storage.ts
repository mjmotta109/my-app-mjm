/**
 * Persistencia local.
 *
 * Todo pasa por la interfaz `Storage` en vez de llamar a `localStorage`
 * directamente. Cuando Rinde se empaquete para Android (§34), cambiar a
 * almacenamiento nativo es implementar esta interfaz — nada más se toca.
 *
 * Cada lectura y escritura va en try/catch: en modo incógnito o con el
 * almacenamiento bloqueado, `localStorage` lanza en vez de devolver null.
 */

export interface Storage {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): boolean;
  remove(key: string): void;
}

export class LocalStorage implements Storage {
  constructor(private readonly prefix = "rinde:") {}

  get<T>(key: string): T | null {
    try {
      const raw = window.localStorage.getItem(this.prefix + key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T): boolean {
    try {
      window.localStorage.setItem(this.prefix + key, JSON.stringify(value));
      return true;
    } catch {
      // Cuota llena o almacenamiento bloqueado: la app sigue funcionando en
      // memoria durante la sesión, pero hay que poder avisar.
      return false;
    }
  }

  remove(key: string): void {
    try {
      window.localStorage.removeItem(this.prefix + key);
    } catch {
      /* nada que hacer */
    }
  }
}

/** Respaldo en memoria para entornos sin almacenamiento (tests, SSR). */
export class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get<T>(key: string): T | null {
    const raw = this.map.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }
  set<T>(key: string, value: T): boolean {
    this.map.set(key, JSON.stringify(value));
    return true;
  }
  remove(key: string): void {
    this.map.delete(key);
  }
}

export const storage: Storage =
  typeof window !== "undefined" && "localStorage" in window ? new LocalStorage() : new MemoryStorage();
