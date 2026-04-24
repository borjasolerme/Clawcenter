import { getAgents, jsonError, readConfig } from "@/lib/openclaw";

export async function GET() {
  try {
    const [agents, config] = await Promise.all([getAgents(), readConfig()]);
    return Response.json({
      agents,
      state: {
        configPath: process.env.OPENCLAW_CONFIG_PATH || "~/.openclaw/openclaw.json",
        version: config.meta && typeof config.meta === "object" ? config.meta : null,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
