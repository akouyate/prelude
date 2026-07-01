"use client";

import * as React from "react";
import { Calendar, Mail, RefreshCircle, User } from "iconoir-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { cn } from "@prelude/ui";
import type { CandidateInvitationSummary } from "../../server/interviews/candidate-invitations";

import {
  createCandidateInvitationAction,
  reissueCandidateInvitationAction,
} from "../../server/interviews/candidate-invitation-actions";
import { CopyCandidateLinkButton } from "./copy-candidate-link-button";
import { InterviewSectionTitle } from "./interview-section-title";

export function CandidateInvitationsPanel({
  interviewId,
  invitations,
  publicationStatus,
  roleTitle,
}: {
  interviewId: string;
  invitations: CandidateInvitationSummary[];
  publicationStatus: string;
  roleTitle: string;
}) {
  const { i18n, t } = useTranslation();
  const [state, formAction, pending] = React.useActionState(
    createCandidateInvitationAction,
    { error: null, ok: false },
  );
  const canInvite = publicationStatus === "published";

  return (
    <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
      <section className="rounded-[20px] border border-[#e7e2d8] bg-white px-[18px] py-5">
        <InterviewSectionTitle
          description={t("interviewDetail.inviteCandidateDescription")}
          title={t("interviewDetail.inviteCandidateTitle")}
        />

        <form action={formAction} className="mt-5 space-y-3.5">
          <input name="interviewId" type="hidden" value={interviewId} />
          <div className="rounded-2xl border border-[#e7e2d8] bg-[#f9f8f3] px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-[#a29b8d]">
              {t("interviewDetail.inviteTargetLabel")}
            </p>
            <p className="mt-1 text-sm font-semibold text-ink-950">
              {roleTitle}
            </p>
          </div>

          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 text-[12.5px] font-semibold text-[#5b574f]">
              <User aria-hidden={true} className="h-4 w-4" />
              {t("interviewDetail.inviteCandidateNameLabel")}
            </span>
            <input
              className="h-11 w-full rounded-2xl border border-[#ddd8cc] bg-white px-4 text-[13.5px] text-ink-950 outline-none transition placeholder:text-[#b2aa9a] focus:border-ink-800 focus:ring-2 focus:ring-[#e5e8d6]"
              disabled={!canInvite || pending}
              name="candidateName"
              placeholder={t("interviewDetail.inviteCandidateNamePlaceholder")}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 text-[12.5px] font-semibold text-[#5b574f]">
              <Mail aria-hidden={true} className="h-4 w-4" />
              {t("interviewDetail.inviteCandidateEmailLabel")}
            </span>
            <input
              className="h-11 w-full rounded-2xl border border-[#ddd8cc] bg-white px-4 text-[13.5px] text-ink-950 outline-none transition placeholder:text-[#b2aa9a] focus:border-ink-800 focus:ring-2 focus:ring-[#e5e8d6]"
              disabled={!canInvite || pending}
              name="candidateEmail"
              placeholder={t("interviewDetail.inviteCandidateEmailPlaceholder")}
              type="email"
            />
            <span className="mt-1.5 block text-[12px] leading-[1.45] text-[#8a8178]">
              {t("interviewDetail.inviteCandidateEmailHint")}
            </span>
          </label>

          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 text-[12.5px] font-semibold text-[#5b574f]">
              <Calendar aria-hidden={true} className="h-4 w-4" />
              {t("interviewDetail.inviteExpiresAtLabel")}
            </span>
            <input
              className="h-11 w-full rounded-2xl border border-[#ddd8cc] bg-white px-4 text-[13.5px] text-ink-950 outline-none transition placeholder:text-[#b2aa9a] focus:border-ink-800 focus:ring-2 focus:ring-[#e5e8d6]"
              disabled={!canInvite || pending}
              name="expiresAt"
              type="date"
            />
            <span className="mt-1.5 block text-[12px] leading-[1.45] text-[#8a8178]">
              {t("interviewDetail.inviteExpiresAtHint")}
            </span>
          </label>

          {state.error ? (
            <p className="rounded-2xl border border-[#efdcd5] bg-[#fdf6f3] px-3 py-2 text-[12.5px] font-medium text-[#9a3417]">
              {state.error}
            </p>
          ) : null}
          {state.ok ? (
            <p className="rounded-2xl border border-[#dfe7ca] bg-[#f7f9ef] px-3 py-2 text-[12.5px] font-medium text-olive-900">
              {t("interviewDetail.inviteCreated")}
            </p>
          ) : null}

          <button
            className="inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[#171715] px-4 text-[13px] font-semibold text-white transition hover:bg-[#2a2925] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300 disabled:pointer-events-none disabled:opacity-50"
            disabled={!canInvite || pending}
            type="submit"
          >
            {pending
              ? t("interviewDetail.inviteCreating")
              : t("interviewDetail.inviteCreateButton")}
          </button>
        </form>

        {!canInvite ? (
          <p className="mt-4 rounded-2xl border border-[#efdcd5] bg-[#fdf6f3] px-3 py-2 text-[12.5px] leading-[1.45] text-[#9a3417]">
            {t("interviewDetail.invitePausedNotice")}
          </p>
        ) : null}
      </section>

      <section className="rounded-[20px] border border-[#e7e2d8] bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#f0ece1] px-[18px] py-5">
          <InterviewSectionTitle
            description={t("interviewDetail.invitationsDescription")}
            title={t("interviewDetail.invitationsTitle")}
          />
          <span className="rounded-full bg-[#eef0e3] px-2.5 py-1 text-xs font-semibold text-olive-900">
            {t("interviewDetail.invitationsCount", {
              count: invitations.length,
            })}
          </span>
        </div>

        {invitations.length > 0 ? (
          <div className="divide-y divide-[#f0ece1]">
            {invitations.map((invitation) => (
              <InvitationRow
                invitation={invitation}
                interviewId={interviewId}
                key={invitation.id}
                locale={i18n.language}
              />
            ))}
          </div>
        ) : (
          <div className="px-6 py-14 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#eef0e3] text-olive-900">
              <Mail aria-hidden={true} className="h-5 w-5" />
            </span>
            <p className="mt-4 text-sm font-semibold text-ink-950">
              {t("interviewDetail.invitationsEmptyTitle")}
            </p>
            <p className="mt-2 text-sm leading-6 text-ink-500">
              {t("interviewDetail.invitationsEmptyDescription")}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function InvitationRow({
  interviewId,
  invitation,
  locale,
}: {
  interviewId: string;
  invitation: CandidateInvitationSummary;
  locale: string;
}) {
  const { t } = useTranslation();
  const canReissue =
    invitation.status === "expired" || invitation.status === "failed";
  const openedLabel = invitation.openedAt
    ? t("interviewDetail.invitationOpenedAt", {
        date: formatDate(invitation.openedAt, locale),
      })
    : t("interviewDetail.invitationNotOpened");

  return (
    <article className="grid gap-4 px-[18px] py-4 md:grid-cols-[minmax(0,1fr)_128px_minmax(0,0.9fr)] md:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="truncate text-[14px] font-semibold text-ink-950">
            {invitation.candidateLabel}
          </p>
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
              invitationStatusClass(invitation.status),
            )}
          >
            {formatInvitationStatus(invitation.status, t)}
          </span>
        </div>
        <p className="mt-1 truncate text-[12.5px] text-[#8a8178]">
          {invitation.candidateEmail ??
            t("interviewDetail.invitationManualDelivery")}{" "}
          · {openedLabel}
        </p>
      </div>

      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#a29b8d]">
          {t("interviewDetail.invitationExpires")}
        </p>
        <p className="mt-1 text-[13px] font-semibold text-[#5b574f]">
          {formatDate(invitation.expiresAt, locale)}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        {invitation.latestCandidateSessionHref ? (
          <a
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-full border border-[#ddd8cc] bg-white px-3.5 text-[12.5px] font-semibold text-ink-950 transition hover:border-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
            href={invitation.latestCandidateSessionHref}
          >
            {t("interviewDetail.invitationOpenSession")}
          </a>
        ) : null}
        <CopyCandidateLinkButton candidatePath={invitation.candidatePath}>
          {t("interviewDetail.invitationCopyLink")}
        </CopyCandidateLinkButton>
        {canReissue ? (
          <form action={reissueCandidateInvitationAction}>
            <input name="interviewId" type="hidden" value={interviewId} />
            <input name="invitationId" type="hidden" value={invitation.id} />
            <button
              className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-[#ddd8cc] bg-white px-3.5 text-[12.5px] font-semibold text-ink-950 transition hover:border-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
              type="submit"
            >
              <RefreshCircle aria-hidden={true} className="h-4 w-4" />
              {t("interviewDetail.invitationReissue")}
            </button>
          </form>
        ) : null}
      </div>
    </article>
  );
}

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatInvitationStatus(status: string, t: TFunction) {
  if (status === "invited") {
    return t("interviewDetail.invitationStatusInvited");
  }

  if (status === "opened") {
    return t("interviewDetail.invitationStatusOpened");
  }

  if (status === "consent_required") {
    return t("interviewDetail.invitationStatusConsentRequired");
  }

  if (status === "ready") {
    return t("interviewDetail.invitationStatusReady");
  }

  if (status === "starting") {
    return t("interviewDetail.invitationStatusStarting");
  }

  if (status === "in_progress" || status === "reconnecting") {
    return t("interviewDetail.invitationStatusInProgress");
  }

  if (status === "completed") {
    return t("interviewDetail.invitationStatusCompleted");
  }

  if (status === "abandoned") {
    return t("interviewDetail.invitationStatusAbandoned");
  }

  if (status === "failed") {
    return t("interviewDetail.invitationStatusFailed");
  }

  if (status === "expired") {
    return t("interviewDetail.invitationStatusExpired");
  }

  if (status === "superseded") {
    return t("interviewDetail.invitationStatusSuperseded");
  }

  return status.replace(/_/g, " ");
}

function invitationStatusClass(status: string) {
  if (status === "completed") {
    return "bg-[#e7f3eb] text-[#1f7a4c]";
  }

  if (status === "failed" || status === "expired") {
    return "bg-coral-50 text-coral-800";
  }

  if (status === "superseded" || status === "abandoned") {
    return "bg-ink-100 text-ink-600";
  }

  if (
    status === "in_progress" ||
    status === "starting" ||
    status === "reconnecting"
  ) {
    return "bg-gold-100 text-gold-800";
  }

  return "bg-[#eef0e3] text-olive-900";
}
