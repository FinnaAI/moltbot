import { isLoopbackHost, normalizeHostHeader, resolveHostName } from "./net.js";

type OriginCheckResult = { ok: true } | { ok: false; reason: string };

function parseOrigin(
  originRaw?: string,
): { origin: string; host: string; hostname: string } | null {
  const trimmed = (originRaw ?? "").trim();
  if (!trimmed || trimmed === "null") {
    return null;
  }
  try {
    const url = new URL(trimmed);
    return {
      origin: url.origin.toLowerCase(),
      host: url.host.toLowerCase(),
      hostname: url.hostname.toLowerCase(),
    };
  } catch {
    return null;
  }
}

/**
 * Merges config-based and env-based allowed origins into a single list.
 * `OPENCLAW_ALLOWED_ORIGINS` (comma-separated) acts as a persistent
 * fallback that survives config rewrites by the Control UI or doctor.
 */
export function resolveEffectiveAllowedOrigins(
  configOrigins?: string[],
  env: Pick<NodeJS.ProcessEnv, "OPENCLAW_ALLOWED_ORIGINS"> = process.env,
): string[] {
  const envRaw = env.OPENCLAW_ALLOWED_ORIGINS;
  const envOrigins = envRaw
    ? envRaw
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    : [];
  const merged = [...(configOrigins ?? []), ...envOrigins];
  return [...new Set(merged)];
}

export function checkBrowserOrigin(params: {
  requestHost?: string;
  origin?: string;
  allowedOrigins?: string[];
}): OriginCheckResult {
  const parsedOrigin = parseOrigin(params.origin);
  if (!parsedOrigin) {
    return { ok: false, reason: "origin missing or invalid" };
  }

  const allowlist = (params.allowedOrigins ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.includes(parsedOrigin.origin)) {
    return { ok: true };
  }

  const requestHost = normalizeHostHeader(params.requestHost);
  if (requestHost && parsedOrigin.host === requestHost) {
    return { ok: true };
  }

  const requestHostname = resolveHostName(requestHost);
  if (isLoopbackHost(parsedOrigin.hostname) && isLoopbackHost(requestHostname)) {
    return { ok: true };
  }

  return { ok: false, reason: "origin not allowed" };
}
