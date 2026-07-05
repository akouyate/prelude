"use client";

import * as React from "react";
import { Calendar, Mail, RefreshCircle, User } from "iconoir-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  Button,
  Notice,
  Pill,
  Surface,
  TextField,
  type PillProps,
} from "@prelude/ui";
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
      <Surface padding="md">
        <InterviewSectionTitle
          description={t("interviewDetail.inviteCandidateDescription")}
          title={t("interviewDetail.inviteCandidateTitle")}
        />

        <form action={formAction} className="mt-5 space-y-3.5">
          <input name="interviewId" type="hidden" value={interviewId} />
          <div className="rounded-2xl border border-ink-100 bg-[#f9f8f3] px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-ink-400">
              {t("interviewDetail.inviteTargetLabel")}
            </p>
            <p className="mt-1 text-sm font-semibold text-ink-950">
              {roleTitle}
            </p>
          </div>

          <TextField
            disabled={!canInvite || pending}
            label={
              <>
                <User aria-hidden={true} className="h-4 w-4" />
                {t("interviewDetail.inviteCandidateNameLabel")}
              </>
            }
            name="candidateName"
            placeholder={t("interviewDetail.inviteCandidateNamePlaceholder")}
          />

          <TextField
            description={t("interviewDetail.inviteCandidateEmailHint")}
            disabled={!canInvite || pending}
            label={
              <>
                <Mail aria-hidden={true} className="h-4 w-4" />
                {t("interviewDetail.inviteCandidateEmailLabel")}
              </>
            }
            name="candidateEmail"
            placeholder={t("interviewDetail.inviteCandidateEmailPlaceholder")}
            type="email"
          />

          <TextField
            description={t("interviewDetail.inviteExpiresAtHint")}
            disabled={!canInvite || pending}
            label={
              <>
                <Calendar aria-hidden={true} className="h-4 w-4" />
                {t("interviewDetail.inviteExpiresAtLabel")}
              </>
            }
            name="expiresAt"
            type="date"
          />

          {state.error ? (
            <Notice tone="danger">{state.error}</Notice>
          ) : null}
          {state.ok ? (
            <Notice tone="success">
              {t("interviewDetail.inviteCreated")}
            </Notice>
          ) : null}

          <Button
            className="h-[42px] w-full text-[13px] font-semibold"
            disabled={!canInvite || pending}
            type="submit"
          >
            {pending
              ? t("interviewDetail.inviteCreating")
              : t("interviewDetail.inviteCreateButton")}
          </Button>
        </form>

        {!canInvite ? (
          <Notice className="mt-4" tone="danger">
            {t("interviewDetail.invitePausedNotice")}
          </Notice>
        ) : null}
      </Surface>

      <Surface padding="none">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-[18px] py-5">
          <InterviewSectionTitle
            description={t("interviewDetail.invitationsDescription")}
            title={t("interviewDetail.invitationsTitle")}
          />
          <Pill>
            {t("interviewDetail.invitationsCount", {
              count: invitations.length,
            })}
          </Pill>
        </div>

        {invitations.length > 0 ? (
          <div className="divide-y divide-ink-100">
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
      </Surface>
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
          <Pill tone={invitationStatusTone(invitation.status)}>
            {formatInvitationStatus(invitation.status, t)}
          </Pill>
        </div>
        <p className="mt-1 truncate text-[12.5px] text-ink-400">
          {invitation.candidateEmail ??
            t("interviewDetail.invitationManualDelivery")}{" "}
          · {openedLabel}
        </p>
      </div>

      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-400">
          {t("interviewDetail.invitationExpires")}
        </p>
        <p className="mt-1 text-[13px] font-semibold text-ink-600">
          {formatDate(invitation.expiresAt, locale)}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        {invitation.latestCandidateSessionHref ? (
          <a
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-full border border-ink-200 bg-white px-3.5 text-[12.5px] font-semibold text-ink-950 transition hover:border-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
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
            <Button
              className="h-9 px-3.5 text-[12.5px]"
              type="submit"
              variant="secondary"
            >
              <RefreshCircle aria-hidden={true} className="h-4 w-4" />
              {t("interviewDetail.invitationReissue")}
            </Button>
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

function invitationStatusTone(status: string): NonNullable<PillProps["tone"]> {
  if (status === "completed") {
    return "success";
  }

  if (status === "failed" || status === "expired") {
    return "danger";
  }

  if (status === "superseded" || status === "abandoned") {
    return "muted";
  }

  if (
    status === "in_progress" ||
    status === "starting" ||
    status === "reconnecting"
  ) {
    return "gold";
  }

  return "olive";
}
