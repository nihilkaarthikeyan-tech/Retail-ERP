// Copyright (c) 2026, Rademics. All rights reserved.
import type { HealthStatus } from "shared";
import { formatDate } from "./format";

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
    // Launch check, 27 October 2026: the server writes dates as 2026-04-01; people read 01 Apr 2026.
    super(message.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (d) => formatDate(d)));
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
  /** Extra request headers (e.g. the till computer's token). */
  headers?: Record<string, string>;
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

/** Plain words for failures that carry no useful message of their own (owner, 26 October 2026). */
export const OFFLINE_MESSAGE = "Cannot reach the server. Check your internet connection and try again.";

function plainMessage(status: number, message: string | null): string {
  if (status === 429) return message ?? "Too many tries. Please wait a few minutes and try again.";
  if (status === 502 || status === 503 || status === 504) return "The server is restarting or busy. Please try again in a minute.";
  if (status >= 500 && (!message || /internal server error/i.test(message))) return "Something went wrong on our side. Please try again; if it keeps happening, tell us what you were doing.";
  return message ?? `Request failed (HTTP ${status})`;
}

function errorFromBody(status: number, body: unknown): ApiError {
  if (body && typeof body === "object") {
    const b = body as {
      message?: unknown;
      errors?: unknown;
      code?: unknown;
    };
    const message = plainMessage(status, typeof b.message === "string" ? b.message : Array.isArray(b.message) ? b.message.join(", ") : null);
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
  return new ApiError(status, plainMessage(status, null), [], undefined, body);
}

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
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
  } catch {
    throw new ApiError(0, OFFLINE_MESSAGE);
  }

  if (res.status === 204) return undefined as T;
  const data = parseBody(await res.text());

  if (!res.ok) {
    if (res.status === 401 && options.redirectOnUnauthorized !== false) onUnauthorized();
    throw errorFromBody(res.status, data);
  }
  return data as T;
}

/** Sends a request with the session cookie; a failed answer becomes an ApiError (as for JSON requests). */
async function send(method: "GET" | "POST", path: string, body: FormData | undefined, accept: string, options: RequestOptions): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: "include",
      // No Content-Type for a form: the browser adds it with the multipart boundary.
      headers: { Accept: accept, ...options.headers },
      body,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, OFFLINE_MESSAGE);
  }
  if (!res.ok) {
    if (res.status === 401 && options.redirectOnUnauthorized !== false) onUnauthorized();
    throw errorFromBody(res.status, parseBody(await res.text()));
  }
  return res;
}

/** A file sent by the API (a spreadsheet, an image), with its name when the server gives one. */
export interface ApiFile {
  blob: Blob;
  fileName: string | null;
}

/** The file name in a Content-Disposition header, if the browser may read it. */
function fileNameOf(res: Response): string | null {
  const header = res.headers.get("Content-Disposition");
  const m = header ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header) : null;
  return m ? decodeURIComponent(m[1]) : null;
}

/** Uploads a form with a file (multipart) and returns the parsed JSON answer. */
async function upload<T>(path: string, form: FormData, options: RequestOptions = {}): Promise<T> {
  const res = await send("POST", path, form, "application/json", options);
  if (res.status === 204) return undefined as T;
  return parseBody(await res.text()) as T;
}

/** Fetches a file (spreadsheet or image) with the session cookie. */
async function file(path: string, options: RequestOptions = {}): Promise<ApiFile> {
  const res = await send("GET", path, undefined, "*/*", options);
  return { blob: await res.blob(), fileName: fileNameOf(res) };
}

/** Typed JSON client for our API. Always sends the session cookie. */
export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("POST", path, body ?? {}, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("PATCH", path, body ?? {}, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("PUT", path, body ?? {}, options),
  delete: <T>(path: string, options?: RequestOptions) => request<T>("DELETE", path, undefined, options),
  /** Multipart upload (a spreadsheet to import, a logo). */
  upload,
  /** A file download as a Blob (templates, exports, failed rows, the logo). */
  file,
};

/**
 * Downloads a file from the API and hands it to the browser to save. The
 * server's file name is used when the browser can read it; otherwise `fallbackName`.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const { blob, fileName } = await file(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before the address is released.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
