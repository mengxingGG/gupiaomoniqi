import { getDatabaseDirectory, openDatabase } from "./client.js";
import { migrateDatabase } from "./migrations.js";

const { client } = await openDatabase();

try {
  await migrateDatabase(client);
  console.log(`数据库 schema 已就绪：${getDatabaseDirectory()}`);
} finally {
await client.close();
}
