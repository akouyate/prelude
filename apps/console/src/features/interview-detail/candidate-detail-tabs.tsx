"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { UnderlineTabs } from "@prelude/ui";

type CandidateDetailTab = "answers" | "evidence" | "next-call" | "recording";

const candidateDetailTabValues: CandidateDetailTab[] = [
  "recording",
  "evidence",
  "answers",
  "next-call",
];

export function CandidateDetailTabs({
  answers,
  evidence,
  nextCall,
  rail,
  recording,
}: {
  answers: React.ReactNode;
  evidence: React.ReactNode;
  nextCall: React.ReactNode;
  rail: React.ReactNode;
  recording: React.ReactNode;
}) {
  const { t } = useTranslation();
  const candidateDetailTabOptions = React.useMemo(
    () => [
      { label: t("interviewDetail.detailTabRecording"), value: "recording" as const },
      { label: t("interviewDetail.detailTabEvidence"), value: "evidence" as const },
      { label: t("interviewDetail.detailTabAnswers"), value: "answers" as const },
      { label: t("interviewDetail.detailTabNextCall"), value: "next-call" as const },
    ],
    [t],
  );
  const [tab, setTab] = React.useState<CandidateDetailTab>("recording");
  const sectionRefs = React.useRef<
    Partial<Record<CandidateDetailTab, HTMLElement | null>>
  >({});

  const setSectionRef = React.useCallback(
    (value: CandidateDetailTab) => (element: HTMLElement | null) => {
      sectionRefs.current[value] = element;
    },
    [],
  );

  const handleValueChange = React.useCallback((nextTab: CandidateDetailTab) => {
    setTab(nextTab);

    const target = sectionRefs.current[nextTab];
    if (!target) {
      return;
    }

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    target.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    });
  }, []);

  React.useEffect(() => {
    const sections = candidateDetailTabValues
      .map((value) => ({
        element: sectionRefs.current[value],
        value,
      }))
      .filter(
        (section): section is { element: HTMLElement; value: CandidateDetailTab } =>
          section.element !== null && section.element !== undefined,
      );

    if (sections.length === 0) {
      return;
    }

    const updateActiveSection = () => {
      const anchorOffset = 96;
      const documentHeight = document.documentElement.scrollHeight;
      const distanceToBottom =
        documentHeight - (window.scrollY + window.innerHeight);
      const visibleSections = sections
        .map((section) => ({
          ...section,
          rect: section.element.getBoundingClientRect(),
        }))
        .filter(
          (section) =>
            section.rect.bottom > anchorOffset &&
            section.rect.top < window.innerHeight * 0.65,
        )
        .sort((first, second) => {
          if (distanceToBottom < 120) {
            return second.rect.top - first.rect.top;
          }

          return (
            Math.abs(first.rect.top - anchorOffset) -
            Math.abs(second.rect.top - anchorOffset)
          );
        });

      const nextTab = visibleSections.at(0)?.value;

      if (nextTab) {
        setTab(nextTab);
      }
    };

    const observer = new IntersectionObserver(
      () => {
        updateActiveSection();
      },
      {
        rootMargin: "-72px 0px -55% 0px",
        threshold: [0.12, 0.35, 0.6],
      },
    );

    sections.forEach((section) => observer.observe(section.element));

    return () => observer.disconnect();
  }, []);

  return (
    <section className="mt-[22px]">
      <UnderlineTabs
        activeTabClassName="border-[#171715] text-[#171715]"
        ariaLabel={t("interviewDetail.detailTabsAria")}
        className="sticky top-0 z-20 bg-[#F9F8F3]"
        inactiveTabClassName="text-[#8a8178] hover:border-[#171715] hover:text-[#171715]"
        listClassName="h-[46px] gap-0 border-[#e7e2d8]"
        onValueChange={handleValueChange}
        options={candidateDetailTabOptions}
        tabClassName="mr-[22px] h-[46px] px-1 text-sm"
        value={tab}
      />

      <div className="mt-6 grid gap-7 xl:grid-cols-[minmax(0,1fr)_332px] xl:items-start">
        <div className="min-w-0 space-y-10">
          <section ref={setSectionRef("recording")} className="scroll-mt-[72px]">
            {recording}
          </section>
          <section ref={setSectionRef("evidence")} className="scroll-mt-[72px]">
            {evidence}
          </section>
          <section ref={setSectionRef("answers")} className="scroll-mt-[72px]">
            {answers}
          </section>
          <section
            ref={setSectionRef("next-call")}
            className="scroll-mt-[72px]"
          >
            {nextCall}
          </section>
        </div>
        <aside className="space-y-[14px] xl:sticky xl:top-[70px]">{rail}</aside>
      </div>
    </section>
  );
}
