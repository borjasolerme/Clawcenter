import { jsonError, updateHeartbeat } from "@/lib/openclaw";

type Context = {
  params: Promise<{
    agentId: string;
  }>;
};

export async function PUT(request: Request, context: Context) {
  try {
    const { agentId } = await context.params;
    const body = await request.json();
    return Response.json(await updateHeartbeat(agentId, body.heartbeat ?? null));
  } catch (error) {
    return jsonError(error);
  }
}
