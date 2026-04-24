import { jsonError, listActivity } from "@/lib/openclaw";

export async function GET() {
  try {
    return Response.json(await listActivity());
  } catch (error) {
    return jsonError(error);
  }
}
