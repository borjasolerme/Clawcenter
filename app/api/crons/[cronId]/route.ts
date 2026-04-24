import { editCron, jsonError, removeCron } from "@/lib/openclaw";

type Context = {
  params: Promise<{
    cronId: string;
  }>;
};

export async function PUT(request: Request, context: Context) {
  try {
    const { cronId } = await context.params;
    const body = await request.json();
    return Response.json(await editCron(decodeURIComponent(cronId), body));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { cronId } = await context.params;
    return Response.json(await removeCron(decodeURIComponent(cronId)));
  } catch (error) {
    return jsonError(error);
  }
}
