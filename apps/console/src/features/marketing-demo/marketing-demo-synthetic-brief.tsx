type SyntheticCriterion = {
  body: string;
  label: string;
  status: "Evidenced" | "Needs follow-up";
};

type SyntheticSample = {
  criteria: SyntheticCriterion[];
  probes: string[];
  summary: string;
  transcript: Array<{ answer: string; question: string }>;
};

const samples: Record<string, SyntheticSample> = {
  "account-executive": {
    criteria: [
      {
        body: "Named Kestrel HR, a 14-seat annual contract at €48k, and described writing the business case with the finance lead.",
        label: "Deal ownership and specificity",
        status: "Evidenced",
      },
      {
        body: "Disqualifies on the first call when there is no named budget holder and no date attached to the problem.",
        label: "Qualification judgment",
        status: "Evidenced",
      },
      {
        body: "Described a loss to a lower-priced competitor but did not explain what changed in the next sales cycle.",
        label: "Learning from loss",
        status: "Needs follow-up",
      },
      {
        body: "Volunteered that a third of the current pipeline is single-threaded and named the two exposed accounts.",
        label: "Pipeline honesty",
        status: "Evidenced",
      },
    ],
    probes: [
      "You lost Northbeam on price. What would you do differently on the next deal that stalls there?",
      "A third of the pipeline is single-threaded. What are you doing about it this quarter?",
      "The €48k contract: who else had to sign, and how did you reach them?",
    ],
    summary:
      "Named two closed deals with company, product and deal size. Qualification criteria are explicit. The learning from one lost deal needs a follow-up.",
    transcript: [
      {
        answer:
          "Kestrel HR. Fourteen seats, annual, €48k. They came for reporting but bought because onboarding was manual, so I wrote the business case with their finance lead.",
        question:
          "Walk me through the last deal you closed. What was the company, and what did they actually buy?",
      },
      {
        answer:
          "I need a named budget holder, a dated problem, and evidence the current process is expensive enough to change.",
        question:
          "How do you decide, on a first call, whether a deal is worth your time?",
      },
      {
        answer:
          "Northbeam. We lost on price against a cheaper tool and I could not move them. They were a good fit, but the deal stopped there.",
        question:
          "Tell me about a deal you lost. What did you change afterwards?",
      },
      {
        answer:
          "About a third is single-threaded: one champion and nobody else engaged. Foliot and Atlas are the two accounts I trust least.",
        question:
          "What part of your pipeline do you not trust right now, and why?",
      },
    ],
  },
  "product-manager": {
    criteria: [
      {
        body: "Separated the original retention assumption from interview evidence and named the metric that changed the roadmap.",
        label: "Evidence-led discovery",
        status: "Evidenced",
      },
      {
        body: "Compared customer urgency, strategic reach, implementation cost, and reversibility before choosing a sequence.",
        label: "Prioritization judgment",
        status: "Evidenced",
      },
      {
        body: "Explained the final decision clearly but gave little detail on how dissenting engineering concerns changed the solution.",
        label: "Cross-functional learning",
        status: "Needs follow-up",
      },
    ],
    probes: [
      "Which piece of customer evidence was strong enough to change the roadmap?",
      "What would make you reverse that prioritization decision?",
      "Which engineering concern materially changed the solution?",
    ],
    summary:
      "Discovery and prioritization decisions are grounded in evidence and explicit trade-offs. The cross-functional example needs more detail on changed thinking.",
    transcript: [
      {
        answer:
          "We thought teams churned because setup was slow. Interviews showed the real problem was that managers could not see whether setup had worked. Activation data confirmed it, so we changed the roadmap from automation to visibility first.",
        question:
          "Tell me about a product assumption that customer evidence proved wrong.",
      },
      {
        answer:
          "I compare the number of customers affected, strategic fit, cost of delay, and whether the decision is reversible. Then I show the customer what moves now and what evidence would change the sequence.",
        question:
          "How do you choose between an urgent customer request and a strategic roadmap commitment?",
      },
      {
        answer:
          "Engineering disagreed with the proposed workflow because it increased state complexity. We reduced the first release and kept the decision with product.",
        question:
          "Describe a time engineering or design strongly disagreed with your proposed direction.",
      },
    ],
  },
};

export function MarketingDemoSyntheticBrief({
  roleSlug,
}: {
  roleSlug: string;
}) {
  const sample = samples[roleSlug];
  if (!sample) {
    return null;
  }

  return (
    <section className="mt-14" aria-labelledby="synthetic-brief-title">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#0F6B57]">
        Synthetic sample · no candidate data
      </p>
      <h2
        className="mt-4 font-display text-[clamp(40px,7vw,58px)] leading-[1.02]"
        id="synthetic-brief-title"
      >
        A brief your recruiting team can act on.
      </h2>
      <p className="mt-5 max-w-[690px] text-[16px] leading-[1.65] text-[#52605A]">
        {sample.summary}
      </p>

      <div className="mt-8 overflow-hidden rounded-[26px] border border-[#D7D9D5] bg-white">
        {sample.criteria.map((criterion) => (
          <article
            className="border-b border-[#E4E3DE] p-6 last:border-b-0"
            key={criterion.label}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="font-title font-semibold">{criterion.label}</h3>
              <span className="rounded-full bg-[#EDF7F2] px-3 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[#0F6B57]">
                {criterion.status}
              </span>
            </div>
            <p className="mt-3 text-[14.5px] leading-[1.6] text-[#52605A]">
              {criterion.body}
            </p>
          </article>
        ))}
      </div>

      <div className="mt-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#6E7772]">
          Probe on the call
        </p>
        <ul className="mt-4 space-y-3">
          {sample.probes.map((probe) => (
            <li className="flex gap-3 text-[14.5px] leading-[1.55]" key={probe}>
              <span aria-hidden="true" className="text-[#0F6B57]">
                →
              </span>
              {probe}
            </li>
          ))}
        </ul>
      </div>

      <details className="mt-8 rounded-[22px] border border-[#D7D9D5] bg-white">
        <summary className="cursor-pointer px-6 py-5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#52605A]">
          View synthetic transcript
        </summary>
        <div className="border-t border-[#E4E3DE]">
          {sample.transcript.map((turn, index) => (
            <div
              className="border-b border-[#E4E3DE] p-6 last:border-b-0"
              key={turn.question}
            >
              <p className="font-display text-[21px] leading-[1.35]">
                <span className="mr-3 font-mono text-[10px] text-[#9A9F9C]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {turn.question}
              </p>
              <p className="mt-3 pl-9 text-[14.5px] leading-[1.65] text-[#52605A]">
                {turn.answer}
              </p>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
