import { jsonError, readSkillFile, writeSkillFile } from "@/lib/openclaw";

type Context = {
  params: Promise<{
    skillId: string;
  }>;
};

export async function GET(request: Request, context: Context) {
  try {
    const { skillId } = await context.params;
    const fileName = new URL(request.url).searchParams.get("file") || "SKILL.md";
    return Response.json(await readSkillFile(skillId, fileName));
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { skillId } = await context.params;
    const body = (await request.json()) as { content?: unknown; fileName?: unknown };
    if (typeof body.content !== "string") {
      return Response.json({ error: "content must be a string" }, { status: 400 });
    }
    const fileName = typeof body.fileName === "string" ? body.fileName : "SKILL.md";
    return Response.json(await writeSkillFile(skillId, fileName, body.content));
  } catch (error) {
    return jsonError(error);
  }
}
