// Tiny helpers shared by every route handler.

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type IdParams = { params: Promise<{ id: string }> };

export async function readJson<T>(req: Request): Promise<T> {
  try {
    const text = await req.text();
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
}

export function str(value: unknown, field: string, max = 500): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `Missing ${field}`);
  return value.trim().slice(0, max);
}

export function optStr(value: unknown, max = 500): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/** Wraps a handler so thrown HttpErrors become JSON responses and nothing leaks. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response> | Response) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
      console.error("[api]", (err as Error)?.message ?? err);
      return Response.json({ error: "Something went wrong on our side." }, { status: 500 });
    }
  };
}
