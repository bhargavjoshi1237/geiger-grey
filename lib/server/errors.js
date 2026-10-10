export class ApiError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export function json(data, status = 200) {
  return Response.json(data, { status });
}

// Wraps a route handler: ApiError -> { error: code, message }; anything else -> 500.
export function handle(fn) {
  return async (request, ctx) => {
    try {
      return await fn(request, ctx);
    } catch (error) {
      if (error instanceof ApiError) {
        return json({ error: error.code, message: error.message }, error.status);
      }
      console.error("[lib/server/errors.handle]", error);
      return json({ error: "internal_error", message: "Something went wrong." }, 500);
    }
  };
}
