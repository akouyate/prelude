"use client";

import * as React from "react";
import {
  Calendar,
  CheckCircle,
  Mail,
  NavArrowRight,
  RefreshCircle,
  VideoCamera,
  Xmark,
} from "iconoir-react";
import {
  Button,
  Dialog,
  Notice,
  SelectField,
  Switch,
  TextField,
} from "@prelude/ui";

import {
  connectGoogleCalendarForCandidateAction,
  scheduleCandidateCallAction,
  type ScheduleCandidateCallActionState,
} from "../../server/interviews/candidate-call-scheduling-actions";

type CalendarConnectionStatus =
  | "connected"
  | "connecting"
  | "error"
  | "expired"
  | "needs_reconnect"
  | "not_connected"
  | "revoked";

const initialScheduleCandidateCallState: ScheduleCandidateCallActionState = {
  code: null,
  error: null,
  scheduled: null,
};

export function ScheduleCallDialog({
  candidateEmail,
  candidateLabel,
  canSchedule,
  connectionStatus,
  detailPath,
  roleTitle,
  scheduledCall,
  sessionId,
}: {
  candidateEmail: string | null;
  candidateLabel: string;
  canSchedule: boolean;
  connectionStatus: CalendarConnectionStatus;
  detailPath: string;
  roleTitle: string;
  scheduledCall: {
    conferenceJoinUrl: string | null;
    conferencePending: boolean;
    eventUrl: string | null;
    invitationSent: boolean;
    startsAt: string;
    status: "provider_error" | "scheduled";
    timeZone: string;
  } | null;
  sessionId: string;
}) {
  const [open, setOpen] = React.useState(false);

  if (scheduledCall?.status === "scheduled") {
    return <ScheduledCallAction scheduledCall={scheduledCall} />;
  }

  return (
    <>
      <Button
        className="mt-3 h-11 w-full justify-center rounded-xl"
        disabled={!canSchedule}
        onClick={() => setOpen(true)}
        type="button"
      >
        <Calendar aria-hidden={true} className="h-4 w-4" />
        Schedule call
      </Button>
      <Dialog.Root onOpenChange={setOpen} open={open}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-ink-950/25 backdrop-blur-[2px]" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[22px] border border-[#e7e2d8] bg-[#f9f8f3] shadow-2xl outline-none">
            <div className="flex items-start justify-between gap-5 border-b border-[#e7e2d8] px-6 py-5">
              <div>
                <Dialog.Title className="text-lg font-semibold text-ink-950">
                  Schedule a follow-up call
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-6 text-ink-600">
                  Arrange the next conversation with {candidateLabel}.
                </Dialog.Description>
              </div>
              <button
                aria-label="Close scheduling dialog"
                className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-ink-500 transition hover:bg-white hover:text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
                onClick={() => setOpen(false)}
                type="button"
              >
                <Xmark aria-hidden={true} className="h-5 w-5" />
              </button>
            </div>
            {connectionStatus === "connected" ? (
              <ScheduleCallForm
                candidateEmail={candidateEmail}
                candidateLabel={candidateLabel}
                detailPath={detailPath}
                roleTitle={roleTitle}
                sessionId={sessionId}
              />
            ) : (
              <CalendarConnectionRequired
                detailPath={detailPath}
                isConnecting={connectionStatus === "connecting"}
                isReconnect={
                  connectionStatus === "needs_reconnect" ||
                  connectionStatus === "expired" ||
                  connectionStatus === "revoked" ||
                  connectionStatus === "error"
                }
              />
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function ScheduleCallForm({
  candidateEmail,
  candidateLabel,
  detailPath,
  roleTitle,
  sessionId,
}: {
  candidateEmail: string | null;
  candidateLabel: string;
  detailPath: string;
  roleTitle: string;
  sessionId: string;
}) {
  const [state, formAction, pending] = React.useActionState(
    scheduleCandidateCallAction,
    initialScheduleCandidateCallState,
  );
  const [dateTime, setDateTime] = React.useState("");
  const [timeZone, setTimeZone] = React.useState("UTC");
  const [candidateAddress, setCandidateAddress] = React.useState(
    candidateEmail ?? "",
  );
  const [inviteCandidate, setInviteCandidate] = React.useState(
    Boolean(candidateEmail),
  );
  const [addConference, setAddConference] = React.useState(true);
  const [confirming, setConfirming] = React.useState(false);
  const [durationMinutes, setDurationMinutes] = React.useState("30");
  const [guestEmails, setGuestEmails] = React.useState("");

  React.useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, []);

  const startsAt = toBrowserIsoDate(dateTime);

  function requestConfirmation(event: React.FormEvent<HTMLFormElement>) {
    if (!confirming) {
      event.preventDefault();
      setConfirming(true);
    }
  }

  if (state.scheduled) {
    return <ScheduledCallResult scheduledCall={state.scheduled} />;
  }

  return (
    <form
      action={formAction}
      className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5"
      onSubmit={requestConfirmation}
    >
      <input name="candidateSessionId" type="hidden" value={sessionId} />
      <input name="detailPath" type="hidden" value={detailPath} />
      <input name="startsAt" type="hidden" value={startsAt} />
      <input name="timeZone" type="hidden" value={timeZone} />
      <input
        name="inviteCandidate"
        type="hidden"
        value={inviteCandidate ? "on" : "off"}
      />
      <input
        name="addConference"
        type="hidden"
        value={addConference ? "on" : "off"}
      />

      <div className="rounded-[15px] border border-[#e7e2d8] bg-white px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#a29b8d]">
          Follow-up for
        </p>
        <p className="mt-1 text-sm font-semibold text-ink-950">
          {candidateLabel} · {roleTitle}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_0.72fr]">
        <TextField
          disabled={pending}
          label="Date and time"
          min={minimumDateTimeValue()}
          onChange={(event) =>
            setDateTime((event.target as HTMLInputElement).value)
          }
          required={true}
          type="datetime-local"
          value={dateTime}
        />
        <SelectField
          disabled={pending}
          label="Duration"
          name="durationMinutes"
          onValueChange={(value) => setDurationMinutes(value ?? "30")}
          options={[
            { label: "15 minutes", value: "15" },
            { label: "30 minutes", value: "30" },
            { label: "45 minutes", value: "45" },
            { label: "60 minutes", value: "60" },
          ]}
          value={durationMinutes}
        />
      </div>

      <TextField
        description={`Time zone: ${timeZone}`}
        disabled={pending}
        label="Location (optional)"
        name="location"
        placeholder="Office, phone number, or a short note"
      />

      <div className="space-y-3 rounded-[15px] border border-[#e7e2d8] bg-white p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#eef0e3] text-olive-900">
              <Mail aria-hidden={true} className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink-950">
                Send candidate invitation
              </p>
              <p className="mt-0.5 text-[12.5px] leading-5 text-ink-500">
                Google Calendar sends this invite. Prelude insights stay
                private.
              </p>
            </div>
          </div>
          <Switch
            aria-label="Send candidate invitation"
            checked={inviteCandidate}
            disabled={pending || !candidateAddress.trim()}
            onCheckedChange={setInviteCandidate}
          />
        </div>
        <TextField
          disabled={pending}
          label="Candidate email"
          name="candidateEmail"
          onChange={(event) => {
            const value = (event.target as HTMLInputElement).value;
            setCandidateAddress(value);
            if (!value.trim()) {
              setInviteCandidate(false);
            }
          }}
          placeholder="candidate@example.com"
          type="email"
          value={candidateAddress}
        />
        <TextField
          description="Separate addresses with commas. Guests receive the same calendar invitation."
          disabled={pending}
          label="Additional guests (optional)"
          name="guestEmails"
          onChange={(event) =>
            setGuestEmails((event.target as HTMLInputElement).value)
          }
          placeholder="recruiter@example.com, manager@example.com"
          type="text"
          value={guestEmails}
        />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-[15px] border border-[#e7e2d8] bg-white p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#eef0e3] text-olive-900">
            <VideoCamera aria-hidden={true} className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-950">
              Add Google Meet
            </p>
            <p className="mt-0.5 text-[12.5px] leading-5 text-ink-500">
              Create a meeting link in the Google Calendar event.
            </p>
          </div>
        </div>
        <Switch
          aria-label="Add Google Meet"
          checked={addConference}
          disabled={pending}
          onCheckedChange={setAddConference}
        />
      </div>

      {state.error ? (
        <Notice role="alert" tone="danger">
          {state.error}
        </Notice>
      ) : null}
      {state.code === "reconnect_required" ? (
        <ReconnectCalendarButton detailPath={detailPath} />
      ) : null}
      {confirming ? (
        <Notice tone="warning">
          <span className="font-semibold">Ready to send the calendar event.</span>{" "}
          {dateTime
            ? `${formatLocalPreview(dateTime, timeZone)} for ${durationMinutes} minutes.`
            : "Choose a date and time before confirming."}{" "}
          {inviteCandidate && candidateAddress.trim()
            ? `An invitation will be sent to ${candidateAddress.trim()}.`
            : "No candidate invitation will be sent."}{" "}
          {guestEmails.trim() ? "Additional guests will also receive it." : ""}
        </Notice>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3 border-t border-[#e7e2d8] pt-5">
        {confirming ? (
          <Button
            className="h-11 rounded-full px-5"
            disabled={pending}
            onClick={() => setConfirming(false)}
            type="button"
            variant="secondary"
          >
            Back to details
          </Button>
        ) : null}
        <Button
          className="h-11 rounded-full px-5"
          disabled={pending}
          type="submit"
        >
          <Calendar aria-hidden={true} className="h-4 w-4" />
          {pending
            ? "Scheduling…"
            : confirming
              ? "Create and send invitation"
              : "Review invitation"}
        </Button>
      </div>
    </form>
  );
}

function CalendarConnectionRequired({
  detailPath,
  isConnecting,
  isReconnect,
}: {
  detailPath: string;
  isConnecting: boolean;
  isReconnect: boolean;
}) {
  return (
    <div className="space-y-5 px-6 py-6">
      <Notice tone="warning">
        {isConnecting
          ? "Google Calendar is being connected. Complete the authorization, then return here to schedule the call."
          : isReconnect
          ? "Your Google Calendar connection needs to be renewed before a call can be scheduled."
          : "Connect Google Calendar to schedule this follow-up from Prelude."}
      </Notice>
      {!isConnecting ? <ReconnectCalendarButton detailPath={detailPath} isReconnect={isReconnect} /> : null}
    </div>
  );
}

function ReconnectCalendarButton({
  detailPath,
  isReconnect = true,
}: {
  detailPath: string;
  isReconnect?: boolean;
}) {
  const [pending, startTransition] = React.useTransition();

  return (
    <Button
      className="h-11 w-full justify-center rounded-full"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const formData = new FormData();
          formData.set("detailPath", detailPath);
          await connectGoogleCalendarForCandidateAction(formData);
        });
      }}
      type="button"
      variant={isReconnect ? "secondary" : "primary"}
    >
      <RefreshCircle aria-hidden={true} className="h-4 w-4" />
      {pending
        ? "Opening Google…"
        : isReconnect
          ? "Reconnect Google Calendar"
          : "Connect Google Calendar"}
    </Button>
  );
}

function ScheduledCallAction({
  scheduledCall,
}: {
  scheduledCall: NonNullable<
    React.ComponentProps<typeof ScheduleCallDialog>["scheduledCall"]
  >;
}) {
  return (
    <div className="mt-3 rounded-xl border border-[#d6e2c5] bg-[#f4f8ec] p-3">
      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#38551a]">
        <CheckCircle aria-hidden={true} className="h-4 w-4" />
        Next call scheduled
      </div>
      <p className="mt-1.5 text-[12px] leading-5 text-[#5a6846]">
        {formatScheduledDate(scheduledCall.startsAt, scheduledCall.timeZone)}
        {scheduledCall.invitationSent
          ? " · Invitation sent"
          : " · Private event"}
      </p>
      {scheduledCall.conferencePending ? (
        <p className="mt-1 text-[12px] leading-5 text-[#5a6846]">
          Google Meet link is still being prepared in Calendar.
        </p>
      ) : null}
      <ScheduledCallLinks scheduledCall={scheduledCall} />
    </div>
  );
}

function ScheduledCallResult({
  scheduledCall,
}: {
  scheduledCall: NonNullable<
    React.ComponentProps<typeof ScheduleCallDialog>["scheduledCall"]
  >;
}) {
  return (
    <div className="space-y-5 px-6 py-6">
      <div className="grid h-11 w-11 place-items-center rounded-full bg-[#eef0e3] text-olive-900">
        <CheckCircle aria-hidden={true} className="h-5 w-5" />
      </div>
      <div>
        <Dialog.Title className="text-lg font-semibold text-ink-950">
          Call scheduled
        </Dialog.Title>
        <p className="mt-1 text-sm leading-6 text-ink-600">
          {formatScheduledDate(scheduledCall.startsAt, scheduledCall.timeZone)}
          {scheduledCall.invitationSent
            ? ". Google Calendar sent the invitation."
            : ". No candidate invitation was sent."}
          {scheduledCall.conferencePending
            ? " Google Meet is still being prepared."
            : ""}
        </p>
      </div>
      <ScheduledCallLinks scheduledCall={scheduledCall} />
    </div>
  );
}

function ScheduledCallLinks({
  scheduledCall,
}: {
  scheduledCall: NonNullable<
    React.ComponentProps<typeof ScheduleCallDialog>["scheduledCall"]
  >;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {scheduledCall.eventUrl ? (
        <a
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-[#d6e2c5] bg-white px-3 text-[12px] font-semibold text-olive-900 transition hover:border-olive-700"
          href={scheduledCall.eventUrl}
          rel="noreferrer"
          target="_blank"
        >
          Open Calendar
          <NavArrowRight aria-hidden={true} className="h-3.5 w-3.5" />
        </a>
      ) : null}
      {scheduledCall.conferenceJoinUrl ? (
        <a
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-[#d6e2c5] bg-white px-3 text-[12px] font-semibold text-olive-900 transition hover:border-olive-700"
          href={scheduledCall.conferenceJoinUrl}
          rel="noreferrer"
          target="_blank"
        >
          Join Meet
          <NavArrowRight aria-hidden={true} className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </div>
  );
}

function minimumDateTimeValue() {
  const now = new Date(Date.now() + 5 * 60_000);
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

function toBrowserIsoDate(value: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function formatScheduledDate(startsAt: string, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(startsAt));
}

function formatLocalPreview(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}
