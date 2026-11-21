import { getDb } from "@/lib/server/db";
import { isClaudeConfigured, claudeModel } from "@/lib/server/claude";
import { isTtsConfigured, ttsModel } from "@/lib/server/tts";
import { route } from "@/lib/server/http";

// Reports which services are configured (booleans only, never key values).
export const GET = route(async () => {
  const row = getDb().prepare("SELECT sqlite_version() AS v").get() as { v: string };
  return Response.json({
    ok: true,
    sqlite: row.v,
    claude: { configured: isClaudeConfigured(), model: claudeModel() },
    tts: { configured: isTtsConfigured(), model: ttsModel() },
  });
});
