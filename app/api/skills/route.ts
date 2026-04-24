import { jsonError, listSkills } from "@/lib/openclaw";

export async function GET() {
  try {
    return Response.json(await listSkills());
  } catch (error) {
    return jsonError(error);
  }
}
