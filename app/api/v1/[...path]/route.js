import { json } from "@/lib/server/errors";

export const runtime = "nodejs";

const notImplemented = () =>
  json({ error: "not_implemented", message: "Grey serving endpoints arrive with the retrieval backend." }, 501);

export const GET = notImplemented;
export const POST = notImplemented;
export const PUT = notImplemented;
export const PATCH = notImplemented;
export const DELETE = notImplemented;
