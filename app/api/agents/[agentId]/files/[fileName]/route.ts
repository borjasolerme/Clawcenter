import { jsonError, readAgentFile, writeAgentFile } from "@/lib/openclaw";

type Context = {
  params: Promise<{
    agentId: string;
    fileName: string;
  }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    const { agentId, fileName } = await context.params;
    return Response.json(await readAgentFile(agentId, decodeURIComponent(fileName)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { agentId, fileName } = await context.params;
    const body = (await request.json()) as { content?: unknown };
    if (typeof body.content !== "string") {
      return Response.json({ error: "content must be a string" }, { status: 400 });
    }
    return Response.json(await writeAgentFile(agentId, decodeURIComponent(fileName), body.content));
  } catch (error) {
    return jsonError(error);
  }
}
