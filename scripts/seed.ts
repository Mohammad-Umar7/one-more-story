/**
 * npm run seed          restore all demo content (keeps phone subscriptions)
 * npm run reset-demo    only reset My Memory Room history + alerts for another live demo
 */
import { getDb } from "../src/lib/server/db";
import { ensureSeeded, restoreDemo, seedMemoryHistory } from "../src/lib/server/seed";

const historyOnly = process.argv.includes("--history");
getDb();
ensureSeeded();
if (historyOnly) {
  const { signature } = seedMemoryHistory();
  console.log("Memory Room history reset to 1, 0, 1, 2, 1 then 3, 3 for", signature);
} else {
  restoreDemo();
  console.log("Demo family, room, cricket photo, bakery route and history restored.");
}
