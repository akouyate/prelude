import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The route is a scheduled endpoint that PERMANENTLY DELETES candidate data, so
 * the assertions here are about the bearer gate and what the scheduler is
 * handed. The erasure semantics themselves are pinned in
 * `src/server/interviews/candidate-erasure.test.ts`.
 */
const erasureMock = vi.hoisted(() => ({
  candidateDataRetentionMonths: 12,
  sweepExpiredCandidateData: vi.fn(),
}));

vi.mock("../../../../src/server/interviews/candidate-erasure", () => erasureMock);

import { POST } from "./route";

const SECRET = "retention_secret_value";

/** The route reads only `headers` and `nextUrl`, so that is all the fake carries. */
function sweepRequest({
  authorization = `Bearer ${SECRET}`,
  query = "",
}: { authorization?: string | null; query?: string } = {}) {
  const headers = new Headers();
  if (authorization !== null) headers.set("authorization", authorization);
  return {
    headers,
    nextUrl: new URL(`https://console.test/api/internal/retention-sweep${query}`),
  } as unknown as Parameters<typeof POST>[0];
}

const report = {
  cutoff: "2025-08-19T09:00:00.000Z",
  erased: 3,
  failed: 0,
  hasMore: false,
  scanned: 3,
};

describe("POST /api/internal/retention-sweep", () => {
  beforeEach(() => {
    erasureMock.sweepExpiredCandidateData.mockReset();
    erasureMock.sweepExpiredCandidateData.mockResolvedValue(report);
    vi.stubEnv("RETENTION_SWEEP_SECRET", SECRET);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("answers 503 while the secret is unset — never 'everything matches'", async () => {
    vi.stubEnv("RETENTION_SWEEP_SECRET", "");

    const response = await POST(sweepRequest());

    expect(response.status).toBe(503);
    expect(erasureMock.sweepExpiredCandidateData).not.toHaveBeenCalled();
  });

  it("answers 401 without a bearer", async () => {
    const response = await POST(sweepRequest({ authorization: null }));

    expect(response.status).toBe(401);
    expect(erasureMock.sweepExpiredCandidateData).not.toHaveBeenCalled();
  });

  it("answers 401 for the wrong secret", async () => {
    const response = await POST(sweepRequest({ authorization: "Bearer nope" }));

    expect(response.status).toBe(401);
    expect(erasureMock.sweepExpiredCandidateData).not.toHaveBeenCalled();
  });

  it("sweeps and reports what it erased", async () => {
    const response = await POST(sweepRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({ erased: 3, retentionMonths: 12, scanned: 3 }),
    );
    expect(erasureMock.sweepExpiredCandidateData).toHaveBeenCalledWith({
      limit: 200,
    });
  });

  it("honours an explicit limit", async () => {
    await POST(sweepRequest({ query: "?limit=25" }));

    expect(erasureMock.sweepExpiredCandidateData).toHaveBeenCalledWith({
      limit: 25,
    });
  });

  it("refuses an unparseable limit rather than silently clamping it", async () => {
    const response = await POST(sweepRequest({ query: "?limit=100000" }));

    expect(response.status).toBe(400);
    expect(erasureMock.sweepExpiredCandidateData).not.toHaveBeenCalled();
  });

  it("reports a sweep that could not run at all as 500 JSON", async () => {
    erasureMock.sweepExpiredCandidateData.mockRejectedValueOnce(
      new Error("database unreachable"),
    );

    const response = await POST(sweepRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ error: "sweep_failed" }),
    );
  });

  it("still answers 200 when individual sessions failed — the batch is a report", async () => {
    erasureMock.sweepExpiredCandidateData.mockResolvedValueOnce({
      ...report,
      erased: 2,
      failed: 1,
    });

    const response = await POST(sweepRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ erased: 2, failed: 1 }),
    );
  });
});
