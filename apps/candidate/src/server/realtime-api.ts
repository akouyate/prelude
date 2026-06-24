// Server-to-server config for the Prelude realtime (Go) API. The candidate
// browser never calls it directly — these route handlers do, on the candidate's
// behalf. REALTIME_API_KEY is the shared secret the Go API verifies on every
// non-public route; when it is unset (local dev) no header is sent and the Go
// API serves with auth disabled, so the same code works in both modes.
export function realtimeAuthHeaders(): Record<string, string> {
  const apiKey = process.env.REALTIME_API_KEY?.trim();
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}
