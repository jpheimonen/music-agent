import { z } from "zod";
import { apiError } from "@music/contracts";

export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiFailure(
      "The local server could not be reached.",
      "network",
      true,
    );
  }
  if (!response.ok) {
    const body = apiError.safeParse(await response.json().catch(() => null));
    if (body.success)
      throw new ApiFailure(
        body.data.error.message,
        body.data.error.code,
        body.data.error.retryable,
      );
    throw new ApiFailure(
      `The server returned ${response.status}.`,
      "http_error",
      response.status >= 500,
    );
  }
  return schema.parse(await response.json());
}

export const json = (value: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(value),
});
