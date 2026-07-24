import { createHash } from "node:crypto";
import net from "node:net";

const MAX_URL_LENGTH = 2_048;
const MAX_QUERY_LENGTH = 512;

const blockedProviderDomains = ["indeed.com", "linkedin.com"];
const sensitiveQueryParameterNames = new Set([
  "access_token",
  "api_key",
  "auth",
  "authorization",
  "code",
  "key",
  "password",
  "secret",
  "session",
  "sig",
  "signature",
  "state",
  "token",
]);
const trackingQueryParameterNames = new Set(["fbclid", "gclid", "mc_cid", "mc_eid"]);

export class RoleIntakeUrlImportError extends Error {
  constructor(
    readonly code:
      | "invalid_url"
      | "no_usable_text"
      | "private_destination"
      | "provider_blocked"
      | "redirect_limit"
      | "remote_unavailable"
      | "response_too_large"
      | "robots_disallowed"
      | "robots_unavailable"
      | "source_not_public"
      | "unsupported_content",
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "RoleIntakeUrlImportError";
  }
}

/**
 * The source URL is normalised before it becomes provenance. Fragments and
 * analytics identifiers add no job context, while auth-like parameters are
 * rejected instead of risking storage of a bearer credential.
 */
export function normalizeRoleIntakeUrl(value: string): URL {
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_URL_LENGTH) {
    throw invalidUrl("Enter a public HTTPS job URL shorter than 2,048 characters.");
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw invalidUrl("Enter a valid public HTTPS job URL.");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw invalidUrl("Prelude accepts public HTTPS job pages without credentials.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    !hostname ||
    net.isIP(hostname) ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new RoleIntakeUrlImportError(
      "private_destination",
      "Prelude can only import public job pages.",
    );
  }
  url.hostname = hostname;
  url.hash = "";

  if (url.search.length > MAX_QUERY_LENGTH) {
    throw invalidUrl("The job URL query is too long. Use the public job-page URL instead.");
  }
  for (const [name] of [...url.searchParams]) {
    const normalizedName = name.trim().toLowerCase();
    if (sensitiveQueryParameterNames.has(normalizedName)) {
      throw invalidUrl("Use a public job URL without authentication parameters.");
    }
    if (normalizedName.startsWith("utm_") || trackingQueryParameterNames.has(normalizedName)) {
      url.searchParams.delete(name);
    }
  }

  assertProviderAllowed(url.hostname);
  return url;
}

export function createRoleIntakeUrlIdentity(url: URL): string {
  return createHash("sha256").update(url.toString()).digest("hex");
}

export function assertProviderAllowed(hostname: string): void {
  if (blockedProviderDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    throw new RoleIntakeUrlImportError(
      "provider_blocked",
      "Prelude cannot import from this provider. Start from a manual brief instead.",
    );
  }
}

/**
 * A conservative implementation of the IANA special-use registries. Returning
 * false for an address is intentional: this importer needs public Internet
 * egress, never access to a private, local, multicast or documentation range.
 */
export function isGloballyRoutableIpAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    return isGloballyRoutableIpv4(address);
  }
  if (family === 6) {
    return isGloballyRoutableIpv6(address);
  }
  return false;
}

function invalidUrl(message: string): RoleIntakeUrlImportError {
  return new RoleIntakeUrlImportError("invalid_url", message);
}

function isGloballyRoutableIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [first = -1, second = -1, third = -1] = parts;
  if (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 2 || second === 88 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0 && third === 113)
  ) {
    return false;
  }
  return true;
}

function isGloballyRoutableIpv6(address: string): boolean {
  const value = ipv6ToBigInt(address);
  if (value === null) {
    return false;
  }
  const mappedIpv4 = value >> 32n === 0xffffn ? bigIntToIpv4(value & 0xffffffffn) : null;
  if (mappedIpv4) {
    return isGloballyRoutableIpv4(mappedIpv4);
  }
  const specialUseRanges: ReadonlyArray<readonly [string, number]> = [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ];
  return !specialUseRanges.some(([network, prefix]) => isIpv6InRange(value, network, prefix));
}

function isIpv6InRange(value: bigint, network: string, prefix: number): boolean {
  const base = ipv6ToBigInt(network);
  if (base === null) {
    return true;
  }
  const shift = BigInt(128 - prefix);
  return (value >> shift) === (base >> shift);
}

function ipv6ToBigInt(address: string): bigint | null {
  const raw = address.toLowerCase().replace(/%.*$/, "");
  const [head, tail] = raw.split("::");
  if (raw.split("::").length > 2) {
    return null;
  }
  const expand = (side: string | undefined): string[] =>
    side ? side.split(":").filter(Boolean).flatMap(expandIpv4Hextet) : [];
  const headParts = expand(head);
  const tailParts = expand(tail);
  const missing = 8 - headParts.length - tailParts.length;
  const parts = raw.includes("::")
    ? [...headParts, ...Array(Math.max(0, missing)).fill("0"), ...tailParts]
    : headParts;
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return null;
  }
  return BigInt(`0x${parts.map((part) => part.padStart(4, "0")).join("")}`);
}

function expandIpv4Hextet(part: string): string[] {
  if (!part.includes(".")) {
    return [part];
  }
  if (!net.isIP(part) || net.isIP(part) !== 4) {
    return [part];
  }
  const values = part.split(".").map(Number);
  return [
    ((values[0]! << 8) | values[1]!).toString(16),
    ((values[2]! << 8) | values[3]!).toString(16),
  ];
}

function bigIntToIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 0xffn)).join(".");
}
