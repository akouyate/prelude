import {
  ArrowLeftIcon,
  CandidateScreenHeader,
  CandidateWordmark,
} from "@prelude/ui";

import type {
  CandidatePrivacyNotice as CandidatePrivacyNoticeContent,
  PrivacyNoticeBullet,
} from "./privacy-notice-copy";

/**
 * The candidate privacy notice, rendered from the structured copy the server
 * resolved (`candidatePrivacyNotice`). Presentational only: it selects no copy
 * and reads no flag, so the language and the recording gating are decided in
 * exactly one place.
 *
 * Mobile-first like the rest of the candidate app — a single measured column on
 * the paper ground, sized for reading rather than for a marketing page.
 */
export function CandidatePrivacyNotice({
  backHref,
  backLabel,
  notice,
}: {
  backHref: string;
  backLabel: string;
  notice: CandidatePrivacyNoticeContent;
}) {
  return (
    <>
      <CandidateScreenHeader
        left={
          <a
            className="inline-flex items-center gap-2 py-1.5 font-title text-[14.5px] font-medium text-ink-700 transition-colors hover:text-spruce-600"
            href={backHref}
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {backLabel}
          </a>
        }
        right={<CandidateWordmark />}
      />
      <div className="flex flex-1 justify-center px-[clamp(1.125rem,6vw,2.75rem)] pb-16 pt-2">
        <article className="w-full max-w-[680px]">
          <h1 className="text-balance font-display text-[clamp(30px,6.4vw,44px)] font-normal leading-[1.08] tracking-[-0.02em] text-ink-950">
            {notice.title}
          </h1>
          <p className="mt-3.5 font-mono text-[10.5px] uppercase tracking-[0.09em] text-ink-600">
            {notice.lastUpdated}
          </p>

          {notice.sections.map((section) => (
            <section className="mt-10" key={section.id}>
              <h2 className="font-display text-[23px] font-normal leading-[1.24] tracking-[-0.014em] text-ink-950">
                {section.heading}
              </h2>
              {section.blocks.map((block, index) =>
                block.kind === "paragraph" ? (
                  <p
                    className="mt-4 text-pretty text-[16px] leading-[1.62] text-ink-700"
                    key={index}
                  >
                    {block.text}
                  </p>
                ) : (
                  <PrivacyNoticeList
                    className="mt-4"
                    items={block.items}
                    key={index}
                  />
                ),
              )}
            </section>
          ))}
        </article>
      </div>
    </>
  );
}

function PrivacyNoticeList({
  className,
  items,
}: {
  className?: string;
  items: PrivacyNoticeBullet[];
}) {
  return (
    <ul
      className={`flex flex-col gap-2.5 text-[16px] leading-[1.62] text-ink-700 ${className ?? ""}`}
    >
      {items.map((item, index) => (
        <li className="flex gap-3" key={index}>
          <span
            aria-hidden="true"
            className="mt-[0.6em] h-[5px] w-[5px] shrink-0 rounded-full bg-spruce-600"
          />
          <div className="flex-1 text-pretty">
            {item.text}
            {item.items ? (
              <PrivacyNoticeList className="mt-2.5" items={item.items} />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
