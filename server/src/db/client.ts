import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema.js";

export function getDatabaseDirectory(): string {
  return (
    process.env.DATABASE_DIR ??
    fileURLToPath(new URL("../../data/pgdata/", import.meta.url))
  );
}

export async function openDatabase() {
  const client = new PGlite(getDatabaseDirectory());
  await client.waitReady;
  const db = drizzle({
    client,
    schema,
  });

  return {
    client,
    db,
  };
}

export type DatabaseConnection = Awaited<ReturnType<typeof openDatabase>>;
