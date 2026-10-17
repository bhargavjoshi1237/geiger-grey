import { openAIErrorBody } from "@/lib/grey/openai_frames";

export const runtime = "nodejs";

// Anything under /api/v1 without its own route answers like OpenAI does for an unknown URL.
function notFound(request) {
  const path = request.nextUrl?.pathname ?? new URL(request.url).pathname;
  return Response.json(openAIErrorBody(404, "not_found", `Invalid URL (${request.method} ${path})`), { status: 404 });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
