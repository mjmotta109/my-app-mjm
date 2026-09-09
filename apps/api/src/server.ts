import { openDb } from "./db.js";
import { SqliteRepository } from "./repository.js";
import { buildApp } from "./app.js";

/**
 * Arranque del servidor.
 *
 * `RINDE_ADMIN_TOKEN` no tiene valor por defecto a propósito: sin él las rutas
 * de administración de precios quedan deshabilitadas, en vez de quedar
 * abiertas con una clave conocida.
 */
const port = Number(process.env["PORT"] ?? 3000);
const host = process.env["HOST"] ?? "0.0.0.0";
const dbFile = process.env["RINDE_DB"] ?? "./data/rinde.db";
const adminToken = process.env["RINDE_ADMIN_TOKEN"];

const db = openDb(dbFile);
const app = buildApp({
  repository: new SqliteRepository(db),
  logger: true,
  ...(adminToken ? { adminToken } : {}),
});

try {
  await app.listen({ port, host });
  app.log.info(`Rinde API escuchando en http://${host}:${port} · base de datos: ${dbFile}`);
  if (!adminToken) {
    app.log.warn("RINDE_ADMIN_TOKEN no está configurado: /admin/* está deshabilitado.");
  }
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(() => {
      db.close();
      process.exit(0);
    });
  });
}
