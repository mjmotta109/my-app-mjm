import { Preferences } from "@capacitor/preferences";
import { Capacitor } from "@capacitor/core";

/**
 * Persistencia local.
 *
 * Todo pasa por esta interfaz en vez de llamar a `localStorage` directamente.
 * En Android la implementación cambia sin que el resto de la app se entere.
 *
 * **Por qué es asíncrona:** el almacenamiento nativo de Android lo es. Mantener
 * una API síncrona obligaría a mantener una caché en memoria que se
 * desincroniza, o a escribir en dos sitios a la vez. Es más honesto asumir la
 * asincronía: la app espera a hidratar antes de dibujar (ver `store.tsx`).
 *
 * **Por qué no `localStorage` en Android:** el sistema puede limpiar el
 * almacenamiento de un WebView para liberar espacio, sin avisar. Perder la
 * despensa y el plan del mes por eso sería grave. `Preferences` guarda en
 * `SharedPreferences`, que sobrevive.
 */

export interface Storage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<boolean>;
  remove(key: string): Promise<void>;
}

/** Almacenamiento nativo (Android / iOS) vía Capacitor Preferences. */
class NativeStorage implements Storage {
  constructor(private readonly prefix = "rinde:") {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const { value } = await Preferences.get({ key: this.prefix + key });
      return value === null ? null : (JSON.parse(value) as T);
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<boolean> {
    try {
      await Preferences.set({ key: this.prefix + key, value: JSON.stringify(value) });
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await Preferences.remove({ key: this.prefix + key });
    } catch {
      /* nada que hacer */
    }
  }
}

/**
 * Almacenamiento del navegador.
 *
 * Cada lectura y escritura va en try/catch: en modo incógnito o con el
 * almacenamiento bloqueado, `localStorage` lanza en vez de devolver null.
 */
class LocalStorage implements Storage {
  constructor(private readonly prefix = "rinde:") {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = window.localStorage.getItem(this.prefix + key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<boolean> {
    try {
      window.localStorage.setItem(this.prefix + key, JSON.stringify(value));
      return true;
    } catch {
      // Cuota llena o almacenamiento bloqueado: la app sigue funcionando en
      // memoria durante la sesión, pero hay que poder avisar.
      return false;
    }
  }

  async remove(key: string): Promise<void> {
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
  async get<T>(key: string): Promise<T | null> {
    const raw = this.map.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }
  async set<T>(key: string, value: T): Promise<boolean> {
    this.map.set(key, JSON.stringify(value));
    return true;
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

export const isNative = Capacitor.isNativePlatform();

export const storage: Storage = isNative
  ? new NativeStorage()
  : typeof window !== "undefined" && "localStorage" in window
    ? new LocalStorage()
    : new MemoryStorage();
