import { jsonError, readOrgChart, writeOrgChart } from "@/lib/openclaw";

export async function GET() {
  try {
    return Response.json(await readOrgChart());
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    return Response.json(await writeOrgChart(body));
  } catch (error) {
    return jsonError(error);
  }
}
