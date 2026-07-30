import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

export function getRealDatabaseDirectory(): string {
  return (
    process.env.REAL_DATABASE_DIR ??
    fileURLToPath(
      new URL("../../../data/real-pgdata/", import.meta.url),
    )
  );
}

export async function openRealDatabase(
  directory = getRealDatabaseDirectory(),
) {
  const client =
    directory === ":memory:" ? new PGlite() : new PGlite(directory);
  await client.waitReady;

  return { client };
}

export type RealDatabaseConnection = Awaited<
  ReturnType<typeof openRealDatabase>
>;
