import { addCron, jsonError, listCrons } from "@/lib/openclaw";

export async function GET() {
  try {
    return Response.json(await listCrons());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return Response.json(await addCron(body));
  } catch (error) {
    return jsonError(error);
  }
}
