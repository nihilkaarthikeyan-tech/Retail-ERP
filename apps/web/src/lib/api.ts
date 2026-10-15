// Copyright (c) 2026, Rademics. All rights reserved.
import type { HealthStatus } from "shared";

/** Base URL of the API, as seen from the browser. Fixed at build time. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
  // 503 still carries a HealthStatus body explaining what is down.
  if (!res.ok && res.status !== 503) {
    throw new Error(`API returned HTTP ${res.status}`);
  }
  return (await res.json()) as HealthStatus;
}

/** One field problem reported by the API's validation (zod) layer. */
export interface FieldIssue {
  path: string;
  message: string;
}

/** Thrown by the API client for every non-2xx response. */
export class ApiError extends Error {
  readonly statusCode: number;
  /** Field-level validation problems (HTTP 400 "Validation failed"). */
  readonly errors: FieldIssue[];
  /** Machine-readable code when the API sends one (e.g. PASSWORD_CHANGE_REQUIRED). */
  readonly code: string | undefined;
  /** The parsed response body as sent, for answers that carry extra data (e.g. duplicate matches). */
  readonly body: unknown;

  constructor(statusCode: number, message: string, errors: FieldIssue[] = [], code?: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.errors = errors;
    this.code = code;
    this.body = body;
  }

  /** Validation messages keyed by field path, for showing next to inputs. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const issue of this.errors) {
      if (!(issue.path in out)) out[issue.path] = issue.message;
    }
    return out;
  }
}

export interface RequestOptions {
  /**
   * When false, a 401 does not send the browser to the login page.
   * Used by the login form itself and by the "who am I" check.
   */
  redirectOnUnauthorized?: boolean;
}

/** Pages a logged-out visitor may be on; a 401 there never redirects. */
const PUBLIC_PATHS = ["/login", "/setup"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname.replace(/\/+$/, "") || "/");
}

type UnauthorizedHandler = () => void;

/**
 * What happens on a 401. The AuthProvider installs a handler that uses the
 * Next.js router; this fallback (used only outside it) does a full page load.
 */
let onUnauthorized: UnauthorizedHandler = () => {
  if (typeof window === "undefined") return;
  if (isPublicPath(window.location.pathname)) return;
  window.location.assign(new URL("/login", window.location.origin).toString());
};

/** Replaces what happens on a 401 (tests use this). Returns the previous handler. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler): UnauthorizedHandler {
  const previous = onUnauthorized;
  onUnauthorized = handler;
  return previous;
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorFromBody(status: number, body: unknown): ApiError {
  if (body && typeof body === "object") {
    const b = body as {
      message?: unknown;
      errors?: unknown;
      code?: unknown;
    };
    const message =
      typeof b.message === "string"
        ? b.message
        : Array.isArray(b.message)
          ? b.message.join(", ")
          : `Request failed (HTTP ${status})`;
    const errors = Array.isArray(b.errors)
      ? (b.errors as unknown[]).flatMap((e) => {
          if (e && typeof e === "object" && "message" in e) {
            const issue = e as { path?: unknown; message: unknown };
            return [{ path: String(issue.path ?? ""), message: String(issue.message) }];
          }
          return [];
        })
      : [];
    return new ApiError(status, message, errors, typeof b.code === "string" ? b.code : undefined, body);
  }
  return new ApiError(status, `Request failed (HTTP ${status})`, [], undefined, body);
}

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: "include",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    throw new ApiError(0, `Cannot reach the server (${err instanceof Error ? err.message : String(err)})`);
  }

  if (res.status === 204) return undefined as T;
  const data = parseBody(await res.text());

  if (!res.ok) {
    if (res.status === 401 && options.redirectOnUnauthorized !== false) onUnauthorized();
    throw errorFromBody(res.status, data);
  }
  return data as T;
}

/** Typed JSON client for our API. Always sends the session cookie. */
export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("POST", path, body ?? {}, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("PATCH", path, body ?? {}, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("PUT", path, body ?? {}, options),
  delete: <T>(path: string, options?: RequestOptions) => request<T>("DELETE", path, undefined, options),
};

/** Builds a query string from defined, non-empty values. */
export function query(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Human-readable message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
