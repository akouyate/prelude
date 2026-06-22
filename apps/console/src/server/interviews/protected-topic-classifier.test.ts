import { describe, expect, it } from "vitest";

import {
  createDeterministicProtectedTopicClassifier,
  createOpenAIProtectedTopicClassifier,
  createProtectedTopicClassifierFromEnv,
  defaultProtectedTopicModel,
  protectedTopicClassifierPromptVersion,
} from "./protected-topic-classifier";

describe("protected topic classifier provider selection", () => {
  it("disables the classifier when explicitly turned off", async () => {
    const classifier = createProtectedTopicClassifierFromEnv({
      PROTECTED_TOPIC_CLASSIFIER: "off",
      OPENAI_API_KEY: "sk-test",
    });

    expect(classifier.provider).toBe("disabled");

    const results = await classifier.classify(["What is your age?"]);

    expect(results).toEqual([{ flagged: false, category: "none", reason: "" }]);
  });

  it("uses the deterministic provider when explicitly configured", () => {
    const classifier = createProtectedTopicClassifierFromEnv({
      PROTECTED_TOPIC_CLASSIFIER: "deterministic",
      OPENAI_API_KEY: "sk-test",
    });

    expect(classifier.provider).toBe("deterministic");
  });

  it("uses the deterministic provider in test mode", () => {
    const classifier = createProtectedTopicClassifierFromEnv({
      NODE_ENV: "test",
      OPENAI_API_KEY: "sk-test",
    });

    expect(classifier.provider).toBe("deterministic");
  });

  it("falls back to deterministic for unknown non-openai values (never unavailable)", () => {
    const classifier = createProtectedTopicClassifierFromEnv({
      PROTECTED_TOPIC_CLASSIFIER: "anthropic",
      NODE_ENV: "production",
      OPENAI_API_KEY: "sk-test",
    });

    expect(classifier.provider).toBe("deterministic");
  });

  it("falls back to deterministic when no API key is present, even in production", () => {
    const classifier = createProtectedTopicClassifierFromEnv({
      PROTECTED_TOPIC_CLASSIFIER: "openai",
      NODE_ENV: "production",
    });

    expect(classifier.provider).toBe("deterministic");
  });

  it("uses the OpenAI provider when configured with a key", () => {
    const classifier = createProtectedTopicClassifierFromEnv({
      PROTECTED_TOPIC_CLASSIFIER: "openai",
      OPENAI_API_KEY: "sk-test",
      NODE_ENV: "production",
    });

    expect(classifier.provider).toBe("openai_responses");
    expect(classifier.modelName).toBe(defaultProtectedTopicModel);
  });
});

describe("deterministic protected topic classifier", () => {
  it("reflects textViolatesPolicy: flags an age question", async () => {
    const classifier = createDeterministicProtectedTopicClassifier();
    const [result] = await classifier.classify(["What is your age?"]);

    expect(result?.flagged).toBe(true);
    // The deterministic layer cannot identify a precise category, so it uses
    // the neutral "protected_topic" fallback (not the misleading
    // "automated_decision").
    expect(result?.category).toBe("protected_topic");
  });

  it("passes a clean job-related question", async () => {
    const classifier = createDeterministicProtectedTopicClassifier();
    const [result] = await classifier.classify([
      "Describe how you debugged a production incident.",
    ]);

    expect(result).toEqual({ flagged: false, category: "none", reason: "" });
  });

  it("returns [] for an empty batch", async () => {
    const classifier = createDeterministicProtectedTopicClassifier();

    expect(await classifier.classify([])).toEqual([]);
  });
});

describe("openai protected topic classifier", () => {
  it("returns [] for an empty batch without making a request", async () => {
    let called = false;
    const classifier = createOpenAIProtectedTopicClassifier({
      apiKey: "sk-test",
      model: "gpt-test",
      timeoutMs: 1000,
      fetcher: async () => {
        called = true;
        return {
          json: async () => ({}),
          ok: true,
          status: 200,
          text: async () => "",
        };
      },
    });

    expect(await classifier.classify([])).toEqual([]);
    expect(called).toBe(false);
  });

  it("parses canned results JSON and honors a flagged verdict", async () => {
    const calls: Array<{ body: string; headers: Record<string, string> }> = [];
    const classifier = createOpenAIProtectedTopicClassifier({
      apiKey: "sk-test",
      model: "gpt-test",
      timeoutMs: 1000,
      fetcher: async (_url, init) => {
        calls.push({ body: init.body, headers: init.headers });
        return {
          json: async () => ({
            output_text: JSON.stringify({
              results: [
                { index: 0, flagged: false, category: "none", reason: "" },
                {
                  index: 1,
                  flagged: true,
                  category: "age",
                  reason: "asks indirectly about candidate age",
                },
              ],
            }),
          }),
          ok: true,
          status: 200,
          text: async () => "",
        };
      },
    });

    const results = await classifier.classify([
      "Describe a project you are proud of.",
      "Which decade did you finish school in?",
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ flagged: false, category: "none", reason: "" });
    expect(results[1]?.flagged).toBe(true);
    expect(results[1]?.category).toBe("age");
    expect(results[1]?.reason).toContain("age");

    expect(calls[0]?.headers.Authorization).toBe("Bearer sk-test");
    const requestBody = JSON.parse(calls[0]?.body ?? "{}");
    expect(requestBody).toMatchObject({ model: "gpt-test", store: false });
    expect(requestBody.text.format.strict).toBe(true);
  });

  it("coerces a flagged verdict with category 'none' to the neutral fallback", async () => {
    const classifier = createOpenAIProtectedTopicClassifier({
      apiKey: "sk-test",
      model: "gpt-test",
      timeoutMs: 1000,
      fetcher: async () => ({
        json: async () => ({
          output_text: JSON.stringify({
            results: [
              { index: 0, flagged: true, category: "none", reason: "coded age proxy" },
            ],
          }),
        }),
        ok: true,
        status: 200,
        text: async () => "",
      }),
    });

    const [result] = await classifier.classify(["Which decade did you finish school in?"]);

    expect(result?.flagged).toBe(true);
    expect(result?.category).toBe("protected_topic");
    expect(result?.reason).toBe("coded age proxy");
  });

  it("hard-truncates an overlong model reason server-side", async () => {
    const longReason = "x".repeat(500);
    const classifier = createOpenAIProtectedTopicClassifier({
      apiKey: "sk-test",
      model: "gpt-test",
      timeoutMs: 1000,
      fetcher: async () => ({
        json: async () => ({
          output_text: JSON.stringify({
            results: [
              { index: 0, flagged: true, category: "age", reason: longReason },
            ],
          }),
        }),
        ok: true,
        status: 200,
        text: async () => "",
      }),
    });

    const [result] = await classifier.classify(["Which decade did you finish school in?"]);

    expect(result?.flagged).toBe(true);
    expect(result?.reason.length).toBe(200);
  });

  it("fails open when the results length does not match the input length", async () => {
    const classifier = createOpenAIProtectedTopicClassifier({
      apiKey: "sk-test",
      model: "gpt-test",
      timeoutMs: 1000,
      fetcher: async () => ({
        json: async () => ({
          output_text: JSON.stringify({
            results: [{ index: 0, flagged: true, category: "age", reason: "x" }],
          }),
        }),
        ok: true,
        status: 200,
        text: async () => "",
      }),
    });

    const results = await classifier.classify(["one", "two"]);

    expect(results).toEqual([
      { flagged: false, category: "none", reason: "" },
      { flagged: false, category: "none", reason: "" },
    ]);
  });

  it("fails open on an HTTP error", async () => {
    const classifier = createOpenAIProtectedTopicClassifier({
      apiKey: "sk-test",
      model: "gpt-test",
      timeoutMs: 1000,
      fetcher: async () => ({
        json: async () => ({}),
        ok: false,
        status: 500,
        text: async () => "server error",
      }),
    });

    const results = await classifier.classify(["What is your age?"]);

    expect(results).toEqual([{ flagged: false, category: "none", reason: "" }]);
  });

  it("fails open on malformed (non-JSON) output", async () => {
    const classifier = createOpenAIProtectedTopicClassifier({
      apiKey: "sk-test",
      model: "gpt-test",
      timeoutMs: 1000,
      fetcher: async () => ({
        json: async () => ({ output_text: "not json at all" }),
        ok: true,
        status: 200,
        text: async () => "",
      }),
    });

    const results = await classifier.classify(["What is your age?"]);

    expect(results).toEqual([{ flagged: false, category: "none", reason: "" }]);
  });

  it("fails open on an aborted / timed-out request", async () => {
    const classifier = createOpenAIProtectedTopicClassifier({
      apiKey: "sk-test",
      model: "gpt-test",
      timeoutMs: 5,
      fetcher: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    });

    const results = await classifier.classify(["What is your age?"]);

    expect(results).toEqual([{ flagged: false, category: "none", reason: "" }]);
  });

  it("exposes a prompt version and default model", () => {
    expect(protectedTopicClassifierPromptVersion).toBe("protected-topic-v1");
    expect(defaultProtectedTopicModel).toBe("gpt-4.1-mini");
  });
});
