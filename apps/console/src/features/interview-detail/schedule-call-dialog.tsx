"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Calendar,
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
  useToastOnce,
} from "@prelude/ui";

import {
  connectGoogleCalendarForCandidateAction,
  scheduleCandidateCallAction,
  type ScheduleCandidateCallActionState,
} from "../../server/interviews/candidate-call-scheduling-actions";
import {
  formatScheduledDate,
  resolveScheduleCallPrefill,
  toBrowserIsoInstant,
  type ScheduleCallFormPrefill,
  type ScheduledCallSummary,
} from "./scheduled-call-presentation";

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

/*
 * One flow, two voices. Booking a call and moving one are the same form and
 * the same submission, but they cannot borrow each other's words — "Send the
 * invitation" is not what a move does. The mode is decided once, from the
 * prefill, instead of being re-asked at every sentence the dialog says.
 */
const callCopyByMode = {
  reschedule: {
    description: "schedule.dialogDescriptionReschedule",
    pending: "schedule.moving",
    ready: "schedule.readyToMove",
    // A move re-notifies the same people rather than inviting them for the
    // first time; saying "invitation" would misdescribe the mail Google is
    // about to send.
    recipient: "schedule.confirmUpdateTo",
    review: "schedule.reviewChange",
    submit: "schedule.moveCall",
    title: "schedule.dialogTitleReschedule",
  },
  schedule: {
    description: "schedule.dialogDescription",
    pending: "schedule.scheduling",
    ready: "schedule.readyToSend",
    recipient: "schedule.confirmInvitationTo",
    review: "schedule.reviewInvitation",
    submit: "schedule.createAndSend",
    title: "schedule.dialogTitle",
  },
} as const;

function callCopy(isReschedule: boolean) {
  return callCopyByMode[isReschedule ? "reschedule" : "schedule"];
}

export function ScheduleCallDialog({
  canSchedule,
  renderTrigger,
  ...content
}: {
  candidateEmail: string | null;
  candidateLabel: string;
  canSchedule: boolean;
  connectionStatus: CalendarConnectionStatus;
  detailPath: string;
  // Lets the floating decision bar own the call-to-action button while the
  // dialog keeps its scheduling state.
  renderTrigger?: (control: {
    disabled: boolean;
    open: () => void;
  }) => React.ReactNode;
  roleTitle: string;
  // Read by the caller to pick the trigger (call-to-action vs compact chip);
  // the dialog itself keeps one flow whether it books or rebooks.
  scheduledCall: ScheduledCallSummary | null;
  sessionId: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      {renderTrigger ? (
        renderTrigger({ disabled: !canSchedule, open: () => setOpen(true) })
      ) : (
        <Button
          className="mt-3 h-11 w-full justify-center rounded-xl"
          disabled={!canSchedule}
          onClick={() => setOpen(true)}
          type="button"
        >
          <Calendar aria-hidden={true} className="h-4 w-4" />
          Schedule call
        </Button>
      )}
      <Dialog.Root onOpenChange={setOpen} open={open}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-ink-950/25 backdrop-blur-[2px]" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[22px] border border-[#e7e2d8] bg-[#f9f8f3] shadow-2xl outline-none">
            <ScheduleCallDialogBody
              {...content}
              onClose={() => setOpen(false)}
            />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

/*
 * Everything inside the popup — and, deliberately, the only place the booked
 * call is read.
 *
 * The prefill used to be resolved in the component above, whose body re-runs
 * on every prop push. That dialog is mounted for the life of the page (in the
 * banner once a call is booked, in the decision bar's call-to-action before
 * then) and every `revalidatePath` on this route pushes fresh props — the
 * review-note autosave fires one on a 700ms debounce, while the recruiter is
 * still typing. A closed dialog was recomputing its starting values through
 * all of that.
 *
 * Down here the portal has already unmounted on close, so reading the record
 * once per mount is reading it once per opening: the only moment at which
 * starting values can mean anything.
 */
function ScheduleCallDialogBody({
  candidateEmail,
  candidateLabel,
  connectionStatus,
  detailPath,
  onClose,
  roleTitle,
  scheduledCall,
  sessionId,
}: {
  candidateEmail: string | null;
  candidateLabel: string;
  connectionStatus: CalendarConnectionStatus;
  detailPath: string;
  onClose: () => void;
  roleTitle: string;
  scheduledCall: ScheduledCallSummary | null;
  sessionId: string;
}) {
  const { t } = useTranslation();
  // One record in, one set of starting values out — for the copy at the top of
  // the dialog as much as for the fields inside it.
  const [prefill] = React.useState(() =>
    resolveScheduleCallPrefill({ candidateEmail, scheduledCall }),
  );
  const copy = callCopy(prefill.isReschedule);

  return (
    <>
      <div className="flex items-start justify-between gap-5 border-b border-[#e7e2d8] px-6 py-5">
        <div>
          <Dialog.Title className="text-lg font-semibold text-ink-950">
            {t(copy.title)}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm leading-6 text-ink-600">
            {t(copy.description, { name: candidateLabel })}
          </Dialog.Description>
        </div>
        <button
          aria-label={t("schedule.closeDialog")}
          className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-ink-500 transition hover:bg-white hover:text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
          onClick={onClose}
          type="button"
        >
          <Xmark aria-hidden={true} className="h-5 w-5" />
        </button>
      </div>
      {connectionStatus === "connected" ? (
        <ScheduleCallForm
          candidateLabel={candidateLabel}
          detailPath={detailPath}
          onScheduled={onClose}
          prefill={prefill}
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
    </>
  );
}

function ScheduleCallForm({
  candidateLabel,
  detailPath,
  onScheduled,
  prefill,
  roleTitle,
  sessionId,
}: {
  candidateLabel: string;
  detailPath: string;
  onScheduled: () => void;
  prefill: ScheduleCallFormPrefill;
  roleTitle: string;
  sessionId: string;
}) {
  const { i18n, t } = useTranslation();
  const { toastOnce } = useToastOnce();
  const copy = callCopy(prefill.isReschedule);
  const [state, formAction, pending] = React.useActionState(
    scheduleCandidateCallAction,
    initialScheduleCandidateCallState,
  );
  /*
   * Every field starts from the booked call, because the server reads a
   * submission as the event's COMPLETE state: an unchecked switch or an empty
   * guest box is a REMOVAL to it, and it refuses removals. A form that opened
   * blank would turn "move this by an hour" into `reschedule_unsupported` for
   * something the recruiter never touched.
   *
   * These are initial values, read once per mount — which is once per opening,
   * since the dialog's portal unmounts on close.
   */
  const [dateTime, setDateTime] = React.useState(prefill.dateTime);
  const [timeZone, setTimeZone] = React.useState(prefill.timeZone ?? "UTC");
  const [candidateAddress, setCandidateAddress] = React.useState(
    prefill.candidateEmail,
  );
  const [inviteCandidate, setInviteCandidate] = React.useState(
    prefill.inviteCandidate,
  );
  const [addConference, setAddConference] = React.useState(
    prefill.addConference,
  );
  const [confirming, setConfirming] = React.useState(false);
  const [durationMinutes, setDurationMinutes] = React.useState(
    prefill.durationMinutes,
  );
  const [guestEmails, setGuestEmails] = React.useState(prefill.guestEmails);

  React.useEffect(() => {
    // A booked call carries its own zone, and a move must not quietly rewrite
    // it to wherever the recruiter happens to be sitting today. Only a call
    // that does not exist yet asks the browser.
    if (prefill.timeZone) {
      return;
    }

    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, [prefill.timeZone]);

  /*
   * "The invitation went out" is a moment, not a state: it deserves a toast,
   * not a screen. The durable facts — when the call is, whether the candidate
   * was invited, the Calendar and Meet links — are rendered by the banner
   * under the page header, which `revalidatePath` has already refreshed by the
   * time this fires. So the dialog announces and closes onto that banner.
   *
   * `t` is held in a ref for the reason the voice player states: the effect's
   * only real trigger is a new settle, and letting a locale switch change `t`
   * would re-run it for a reason that is not a new outcome. `toastOnce` keys
   * on the settle object itself — a new submit produces a genuinely new one.
   */
  const tRef = React.useRef(t);
  tRef.current = t;
  const onScheduledRef = React.useRef(onScheduled);
  onScheduledRef.current = onScheduled;
  const settled = state.scheduled;

  React.useEffect(() => {
    if (!settled) {
      return;
    }

    toastOnce(settled, {
      dismissLabel: tRef.current("toast.dismiss"),
      message: tRef.current(
        settled.invitationSent
          ? "toast.callScheduledInvitationSent"
          : "toast.callScheduled",
      ),
      tone: "success",
    });
    onScheduledRef.current();
  }, [settled, toastOnce]);

  const startsAt = toBrowserIsoInstant(dateTime);
  // The service's own messages are written for a log. These two refusals need
  // to say what the product cannot do and where to go instead, so the console
  // owns their wording — and their translation.
  const refusal =
    state.code === "reschedule_unsupported"
      ? t("schedule.errorRescheduleUnsupported")
      : state.code === "not_calendar_owner"
        ? t("schedule.errorNotCalendarOwner")
        : state.error;

  function requestConfirmation(event: React.FormEvent<HTMLFormElement>) {
    if (!confirming) {
      event.preventDefault();
      setConfirming(true);
    }
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
          label={t("schedule.dateTimeLabel")}
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
          label={t("schedule.durationLabel")}
          name="durationMinutes"
          onValueChange={(value) => setDurationMinutes(value ?? "30")}
          options={[
            ...[15, 30, 45, 60].map((minutes) => ({
              label: t("schedule.durationOption", { count: minutes }),
              value: String(minutes),
            })),
          ]}
          value={durationMinutes}
        />
      </div>

      {/*
        Uncontrolled: nothing in this component reads the location back — the
        form posts it under its own name — so holding it in React state only
        bought a re-render per keystroke.
      */}
      <TextField
        defaultValue={prefill.location}
        description={t("schedule.timeZoneHint", { zone: timeZone })}
        disabled={pending}
        label={t("schedule.locationLabel")}
        name="location"
        placeholder={t("schedule.locationPlaceholder")}
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
                Google Calendar sends this invite. HireCall insights stay
                private.
              </p>
            </div>
          </div>
          <Switch
            aria-label={t("schedule.inviteCandidateLabel")}
            checked={inviteCandidate}
            disabled={pending || !candidateAddress.trim()}
            onCheckedChange={setInviteCandidate}
          />
        </div>
        <TextField
          disabled={pending}
          label={t("schedule.candidateEmailLabel")}
          name="candidateEmail"
          onChange={(event) => {
            const value = (event.target as HTMLInputElement).value;
            setCandidateAddress(value);
            if (!value.trim()) {
              setInviteCandidate(false);
            }
          }}
          placeholder={t("schedule.candidateEmailPlaceholder")}
          type="email"
          value={candidateAddress}
        />
        <TextField
          description={t("schedule.guestsHint")}
          disabled={pending}
          label={t("schedule.guestsLabel")}
          name="guestEmails"
          onChange={(event) =>
            setGuestEmails((event.target as HTMLInputElement).value)
          }
          placeholder={t("schedule.guestsPlaceholder")}
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
          aria-label={t("schedule.addMeetLabel")}
          checked={addConference}
          disabled={pending}
          onCheckedChange={setAddConference}
        />
      </div>

      {refusal ? (
        <Notice role="alert" tone="danger">
          {refusal}
        </Notice>
      ) : null}
      {state.code === "reconnect_required" ? (
        <ReconnectCalendarButton detailPath={detailPath} />
      ) : null}
      {confirming ? (
        <Notice tone="warning">
          <span className="font-semibold">{t(copy.ready)}</span>{" "}
          {dateTime
            ? t("schedule.confirmSlot", {
                minutes: durationMinutes,
                // The same hardened formatter the banner uses: `timeZone` here
                // is the booked call's own, which this reader's `Intl` is not
                // guaranteed to know, and an unguarded `RangeError` in a render
                // body would take the candidate review down. It answers `null`
                // where this sentence needs a string, so the slot simply drops
                // out of the copy rather than printing "null".
                slot:
                  formatScheduledDate(dateTime, timeZone, i18n.language) ?? "",
              })
            : t("schedule.confirmNoSlot")}{" "}
          {inviteCandidate && candidateAddress.trim()
            ? t(copy.recipient, { email: candidateAddress.trim() })
            : t("schedule.confirmNoInvitation")}{" "}
          {guestEmails.trim() ? t("schedule.confirmGuestsToo") : ""}
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
            ? t(copy.pending)
            : confirming
              ? t(copy.submit)
              : t(copy.review)}
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
  const { t } = useTranslation();
  return (
    <div className="space-y-5 px-6 py-6">
      <Notice tone="warning">
        {isConnecting
          ? t("schedule.connectPending")
          : isReconnect
            ? t("schedule.connectExpired")
            : t("schedule.connectMissing")}
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
  const { t } = useTranslation();
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
        ? t("schedule.openingGoogle")
        : isReconnect
          ? t("schedule.reconnectCalendar")
          : t("schedule.connectCalendar")}
    </Button>
  );
}

// The one rendering of "where the call lives" in the product. It moved out of
// the decision bar with the rest of the result card, but it stayed here so the
// banner links out through the same markup the scheduling flow always used.
//
// `action` joins the same wrapping row rather than sitting in a row of its own:
// changing the call belongs beside opening it, and a nested flex container
// would double the gap and break the wrap on a narrow screen.
export function ScheduledCallLinks({
  action,
  scheduledCall,
}: {
  action?: React.ReactNode;
  scheduledCall: ScheduledCallSummary;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap gap-2.5">
      {scheduledCall.eventUrl ? (
        <a
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-[#d6e2c5] bg-white px-3 text-[12px] font-semibold text-olive-900 transition hover:border-olive-700"
          href={scheduledCall.eventUrl}
          rel="noreferrer"
          target="_blank"
        >
          {t("schedule.openCalendar")}
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
          {t("schedule.joinMeet")}
          <NavArrowRight aria-hidden={true} className="h-3.5 w-3.5" />
        </a>
      ) : null}
      {action}
    </div>
  );
}

function minimumDateTimeValue() {
  const now = new Date(Date.now() + 5 * 60_000);
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}
