"use client";

import * as React from "react";

export function MarketingDemoLeadForm({ roleSlug }: { roleSlug: string }) {
  const [email, setEmail] = React.useState("");
  const [consent, setConsent] = React.useState(false);
  const [status, setStatus] = React.useState<"idle" | "sending" | "saved">(
    "idle",
  );
  const [error, setError] = React.useState<string | null>(null);

  const submit = React.useCallback(async () => {
    if (!consent || !email.trim() || status === "sending") {
      return;
    }
    setError(null);
    setStatus("sending");
    const response = await fetch("/api/demo-leads", {
      body: JSON.stringify({
        email: email.trim(),
        marketingConsent: true,
        roleSlug,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }).catch(() => null);
    if (!response?.ok) {
      setError("We could not save your email choice. Nothing was submitted.");
      setStatus("idle");
      return;
    }
    setStatus("saved");
  }, [consent, email, roleSlug, status]);

  return (
    <section className="mt-10 rounded-[28px] bg-[#0B2E26] p-7 text-[#F4F3EF]">
      <h2 className="font-display text-[34px] leading-[1.08]">
        Want more HireCall product notes?
      </h2>
      <p className="mt-3 max-w-[600px] text-[14.5px] leading-[1.65] text-[#C7D4CF]">
        Optional: share your email and separately consent to occasional product
        updates. Your interview transcript, answers, and insights are never
        stored with this request.
      </p>
      {status === "saved" ? (
        <p className="mt-5 font-title text-[16px] text-[#A7E2CE]">
          Thanks — your email preference was saved.
        </p>
      ) : (
        <>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <input
              aria-label="Email address"
              className="h-12 flex-1 rounded-full border border-white/20 bg-white/10 px-5 text-white outline-none placeholder:text-white/45 focus:border-white/60"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              type="email"
              value={email}
            />
            <button
              className="h-12 rounded-full bg-[#F4F3EF] px-6 font-title font-medium text-[#0B2E26] disabled:opacity-40"
              disabled={!consent || !email.trim() || status === "sending"}
              onClick={submit}
              type="button"
            >
              {status === "sending" ? "Saving…" : "Keep me updated"}
            </button>
          </div>
          <label className="mt-4 flex items-start gap-3 text-[12.5px] leading-[1.55] text-[#C7D4CF]">
            <input
              checked={consent}
              className="mt-1"
              onChange={(event) => setConsent(event.target.checked)}
              type="checkbox"
            />
            I consent to HireCall storing my email for occasional marketing
            updates. I can unsubscribe at any time. This is separate from the
            interview-processing consent I already gave.
          </label>
          {error ? (
            <p className="mt-3 text-[13px] text-[#F6C3AB]">{error}</p>
          ) : null}
        </>
      )}
    </section>
  );
}
