"use client";

import * as React from "react";
import Script from "next/script";
import type { MarketingDemoPublicRole } from "@prelude/contracts";

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          callback: (token: string) => void;
          "expired-callback": () => void;
          sitekey: string;
          theme: "light";
        },
      ) => string;
      reset: (widgetId: string) => void;
    };
  }
}

type RoleResponse = {
  launchNonce: string;
  launchNonceExpiresAt: string;
  roles: MarketingDemoPublicRole[];
};

export function MarketingDemoLauncher({
  returnTarget,
  turnstileSiteKey,
}: {
  returnTarget: string;
  turnstileSiteKey: string;
}) {
  const [catalog, setCatalog] = React.useState<RoleResponse | null>(null);
  const [selectedRole, setSelectedRole] = React.useState<string | null>(null);
  const [botProof, setBotProof] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const challengeRef = React.useRef<HTMLDivElement | null>(null);
  const challengeWidgetRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/demo-roles", {
      cache: "no-store",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("unavailable");
        }
        return (await response.json()) as RoleResponse;
      })
      .then((response) => {
        if (!cancelled) {
          setCatalog(response);
          setSelectedRole(response.roles[0]?.slug ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("The live demo is unavailable right now. Please try later.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const renderChallenge = React.useCallback(() => {
    if (
      !turnstileSiteKey ||
      !challengeRef.current ||
      !window.turnstile ||
      challengeWidgetRef.current
    ) {
      return;
    }
    challengeWidgetRef.current = window.turnstile.render(challengeRef.current, {
      callback: setBotProof,
      "expired-callback": () => setBotProof(""),
      sitekey: turnstileSiteKey,
      theme: "light",
    });
  }, [turnstileSiteKey]);

  const startDemo = React.useCallback(async () => {
    if (!catalog || !selectedRole || !botProof || isSubmitting) {
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/demo-sessions", {
        body: JSON.stringify({
          botProof,
          launchNonce: catalog.launchNonce,
          returnTarget,
          roleSlug: selectedRole,
        }),
        cache: "no-store",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        previewUrl?: unknown;
      } | null;
      if (!response.ok || typeof payload?.previewUrl !== "string") {
        throw new Error("unavailable");
      }
      window.location.assign(payload.previewUrl);
    } catch {
      setError(
        "We could not start the demo. The link or capacity may have expired; refresh to request a new one.",
      );
      setIsSubmitting(false);
      setBotProof("");
      if (challengeWidgetRef.current && window.turnstile) {
        window.turnstile.reset(challengeWidgetRef.current);
      }
    }
  }, [botProof, catalog, isSubmitting, returnTarget, selectedRole]);

  return (
    <main className="min-h-screen bg-[#F4F3EF] px-6 py-10 text-[#151A17] sm:px-10">
      {turnstileSiteKey ? (
        <Script
          onLoad={renderChallenge}
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
        />
      ) : null}
      <div className="mx-auto max-w-[1040px]">
        <a className="font-title text-[18px] font-semibold" href="/about">
          HireCall
        </a>
        <section className="pb-12 pt-20 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[#0F6B57]">
            Live candidate experience
          </p>
          <h1 className="mx-auto mt-5 max-w-[780px] text-balance font-display text-[clamp(46px,8vw,78px)] font-normal leading-[0.98] tracking-[-0.03em]">
            Take the interview before asking candidates to.
          </h1>
          <p className="mx-auto mt-6 max-w-[620px] text-[18px] leading-[1.65] text-[#52605A]">
            Pick a predefined role and answer a real HireCall voice interview.
            No account, application, or email is required.
          </p>
        </section>

        <section aria-label="Demo roles" className="grid gap-4 md:grid-cols-2">
          {(catalog?.roles ?? []).map((role) => (
            <button
              aria-pressed={selectedRole === role.slug}
              className={`rounded-[28px] border p-6 text-left transition ${
                selectedRole === role.slug
                  ? "border-[#0F6B57] bg-white shadow-[0_18px_50px_rgba(20,54,45,0.1)]"
                  : "border-[#D7D9D5] bg-[#ECEBE6] hover:border-[#8B938E]"
              }`}
              key={`${role.slug}:${role.version}`}
              onClick={() => setSelectedRole(role.slug)}
              type="button"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#0F6B57]">
                {role.badge ?? "Demo role"}
              </span>
              <span className="mt-4 block font-display text-[34px] leading-[1.05]">
                {role.title}
              </span>
              <span className="mt-3 block text-[15px] leading-[1.6] text-[#52605A]">
                {role.summary}
              </span>
            </button>
          ))}
        </section>

        <section className="mx-auto mt-8 max-w-[620px] rounded-[28px] border border-[#D7D9D5] bg-white p-6 text-center">
          <div className="min-h-[70px]" ref={challengeRef} />
          {!turnstileSiteKey ? (
            <p className="text-[13px] text-[#8A4B36]">
              Demo bot verification is not configured for this deployment.
            </p>
          ) : null}
          {error ? (
            <p className="mt-3 text-[14px] text-[#8A4B36]">{error}</p>
          ) : null}
          <button
            className="mt-4 h-[54px] w-full rounded-full bg-[#0B4B3E] px-6 font-title text-[16px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!catalog || !selectedRole || !botProof || isSubmitting}
            onClick={startDemo}
            type="button"
          >
            {isSubmitting
              ? "Preparing your private room…"
              : "Start the interview"}
          </button>
          <p className="mt-4 text-[12.5px] leading-[1.55] text-[#6E7772]">
            Audio is never recorded. A temporary transcript is processed for the
            demo and deleted after its one-use result handoff or automatic
            expiry. You&apos;ll review the full notice before microphone access.
          </p>
        </section>
      </div>
    </main>
  );
}
