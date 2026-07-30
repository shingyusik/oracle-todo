export type JsonRecord = Record<string, unknown>;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type JsonRoot = Exclude<JsonValue, string>;

export class RavenApiError extends Error {
  readonly name = "RavenApiError";

  constructor(
    readonly code: string,
    message: string,
    readonly fields: Record<string, string[]>,
    readonly requestId: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class RavenTransportError extends Error {
  readonly name = "RavenTransportError";

  constructor(
    readonly kind: "network" | "protocol",
    readonly status?: number,
  ) {
    super(kind === "network"
      ? "Raven API is unreachable."
      : "Raven API returned an invalid response.");
  }
}

export function requestJson(path: string, init?: RequestInit): Promise<unknown>;
export function requestJson<T>(
  path: string,
  init: RequestInit | undefined,
  decode: (value: unknown) => T,
): Promise<T>;
export async function requestJson(
  path: string,
  init: RequestInit = {},
  decode?: (value: unknown) => unknown,
): Promise<unknown> {
  if (!isApiPath(path)) {
    throw new RavenTransportError("protocol");
  }
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers,
    });
  } catch (cause) {
    if ((cause instanceof Error || cause instanceof DOMException) && cause.name === "AbortError") {
      throw cause;
    }
    throw new RavenTransportError("network");
  }

  if (response.status === 204) {
    if (decode) throw new RavenTransportError("protocol", response.status);
    return undefined;
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new RavenTransportError("protocol", response.status);
  }
  if (!text && response.ok) {
    if (decode) throw new RavenTransportError("protocol", response.status);
    return undefined;
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    throw new RavenTransportError("protocol", response.status);
  }
  let body: unknown;
  try {
    if (!text) throw new Error("empty error response");
    body = JSON.parse(text);
  } catch {
    throw new RavenTransportError("protocol", response.status);
  }

  if (!response.ok) {
    throw decodeApiError(body, response.status);
  }
  return decode ? decode(body) : body;
}

export function decodeApiError(body: unknown, status: number): RavenApiError {
  try {
    const value = record(body, "error");
    const fieldsValue = record(value.fields, "error.fields");
    const fields = Object.fromEntries(Object.entries(fieldsValue).map(([key, item]) => {
      if (!/^[a-z0-9_]{1,64}$/.test(key)) throw boundary("error.fields");
      const messages = array(item, `error.fields.${key}`);
      if (messages.length === 0 || messages.length > 16) throw boundary("error.fields");
      return [key, messages.map((message) => {
        const decoded = string(message, `error.fields.${key}`);
        if (decoded.length === 0 || decoded.length > 256) throw boundary("error.fields");
        return decoded;
      })];
    }));
    return new RavenApiError(
      string(value.code, "error.code"),
      string(value.message, "error.message"),
      fields,
      uuid(value.request_id, "error.request_id"),
      status,
    );
  } catch (cause) {
    if (cause instanceof RavenTransportError) {
      throw new RavenTransportError("protocol", status);
    }
    throw cause;
  }
}

export function jsonRequest(method: string, body?: JsonRoot): RequestInit {
  if (body !== undefined && !isJsonRoot(body)) {
    throw new TypeError("JSON body must be an object, array, number, boolean, or null.");
  }
  return {
    method,
    ...(body === undefined ? {} : {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  };
}

export function apiPath(
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, value === null ? "" : String(value));
  }
  const encoded = params.toString();
  return encoded ? `${path}?${encoded}` : path;
}

export function record(value: unknown, field: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw boundary(field);
  }
  return value as JsonRecord;
}

export function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw boundary(field);
  return value;
}

export function string(value: unknown, field: string): string {
  if (typeof value !== "string") throw boundary(field);
  return value;
}

export function nonEmptyString(value: unknown, field: string): string {
  const result = string(value, field);
  if (!result || result.length > 1024) throw boundary(field);
  return result;
}

export function nullableString(value: unknown, field: string): string | null {
  return value === null ? null : string(value, field);
}

export function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw boundary(field);
  return value;
}

export function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)
    || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    throw boundary(field);
  }
  return Object.is(value, -0) ? 0 : value;
}

export function safeInteger(value: unknown, field: string): number {
  const result = finiteNumber(value, field);
  if (!Number.isSafeInteger(result)) throw boundary(field);
  return result;
}

export function timestamp(value: unknown, field: string): string {
  const result = string(value, field);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/
    .exec(result);
  if (!match
    || !validDate(Number(match[1]), Number(match[2]), Number(match[3]))
    || Number(match[4]) > 23
    || Number(match[5]) > 59
    || Number(match[6]) > 59
    || (match[8] !== undefined && Number(match[8]) > 23)
    || (match[9] !== undefined && Number(match[9]) > 59)) {
    throw boundary(field);
  }
  return result;
}

export function nullableTimestamp(value: unknown, field: string): string | null {
  return value === null ? null : timestamp(value, field);
}

export function isoDate(value: unknown, field: string): string {
  const result = string(value, field);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(result);
  if (!match || !validDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
    throw boundary(field);
  }
  return result;
}

export function id(value: unknown, field: string): string {
  const result = nonEmptyString(value, field);
  if (result.length > 128) throw boundary(field);
  return result;
}

export function uuid(value: unknown, field: string): string {
  const result = string(value, field);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    .test(result)) {
    throw boundary(field);
  }
  return result;
}

export function optional<T>(
  value: unknown,
  field: string,
  decoder: (value: unknown, field: string) => T,
): T | null {
  return value === null ? null : decoder(value, field);
}

function isApiPath(path: string): boolean {
  return (path === "/api/v1" || path.startsWith("/api/v1/"))
    && !path.includes("\\")
    && !path.includes("#");
}

function boundary(field: string): RavenTransportError {
  const error = new RavenTransportError("protocol");
  error.message = `Raven API returned invalid ${field}.`;
  return error;
}

function isJsonRoot(value: unknown): value is JsonRoot {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return true;
  if (typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const days = month === 2
    ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return day <= days;
}
