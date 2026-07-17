"use client";

import * as React from "react";
import {
  Calendar,
  Check,
  GoogleCircle,
  Refresh,
  Trash,
  WarningTriangle,
  Xmark,
} from "iconoir-react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useTranslation } from "react-i18next";
import {
  Button,
  IconButton,
  Notice,
  SelectionCard,
  SelectControl,
  SelectField,
  StatusBadge,
  TextField,
  cn,
} from "@prelude/ui";
import type { OrganizationRole } from "@prelude/types";

import {
  ASSIGNABLE_ROLE_OPTIONS,
  canChangeMemberRole,
  canRemoveMember,
} from "../../domain/organization-permissions";
import {
  changeTeamMemberRoleAction,
  inviteTeamMemberAction,
  removeTeamMemberAction,
  revokeTeamInvitationAction,
} from "../../server/organizations/team-actions";
import {
  connectGoogleCalendarAction,
  disconnectGoogleCalendarAction,
} from "../../server/integrations/connected-account-actions";
import {
  updateInterviewPreferencesAction,
  updateNotificationPreferencesAction,
  updateWorkspaceSettingsAction,
} from "../../server/settings/workspace-settings-actions";
import { SettingsLanguageSelect } from "./settings-language-select";
import { SettingsSectionNav } from "./settings-section-nav";
import type { SettingsSection, WorkspaceSettingsData } from "./settings-types";
import {
  AvatarToken,
  SettingsActionRow,
  SettingsField,
  SettingsPanel,
  SettingsPanelHeading,
  SettingsSelectField,
  SettingsToggleRow,
  SettingsUrlField,
} from "./settings-primitives";

const settingsSectionOrder = [
  "profile",
  "workspace",
  "team",
  "interview",
  "integrations",
  "notifications",
  "billing",
] as const satisfies readonly SettingsSection[];

const settingsViewParser = parseAsStringLiteral(settingsSectionOrder)
  .withDefault("profile")
  .withOptions({
    history: "push",
    scroll: false,
  });

export function WorkspaceSettings({ data }: { data: WorkspaceSettingsData }) {
  const { t } = useTranslation();
  const [section, setSection] = useQueryState("view", settingsViewParser);
  const handleSectionChange = React.useCallback(
    (nextSection: SettingsSection) => {
      void setSection(nextSection);
    },
    [setSection],
  );

  return (
    <section>
      <div className="mb-6">
        <p className="text-[13px] font-medium text-ink-500">
          {data.organization.name}
        </p>
        <h1 className="mt-1.5 text-[clamp(26px,3vw,34px)] font-semibold leading-[1.1] tracking-[-0.025em] text-ink-950">
          {t("settings.title")}
        </h1>
      </div>

      <div className="flex flex-col gap-7">
        <SettingsSectionNav
          authProvider={data.authProvider}
          onSectionChange={handleSectionChange}
          section={section}
        />

        <div className="min-w-0">
          <SettingsSectionContent data={data} section={section} />
        </div>
      </div>
    </section>
  );
}

function SettingsSectionContent({
  data,
  section,
}: {
  data: WorkspaceSettingsData;
  section: SettingsSection;
}) {
  if (section === "workspace") {
    return <WorkspaceSection data={data} />;
  }

  if (section === "team") {
    return <TeamSection data={data} />;
  }

  if (section === "interview") {
    return <InterviewDefaultsSection data={data} />;
  }

  if (section === "integrations") {
    return (
      <IntegrationsSection
        connectedAccounts={data.connectedAccounts}
        connectors={data.connectors}
        googleOAuthAvailable={data.integrationAvailability.googleOAuth}
      />
    );
  }

  if (section === "notifications") {
    return <NotificationsSection preferences={data.notificationPreferences} />;
  }

  if (section === "billing") {
    return <BillingSection metrics={data.metrics} />;
  }

  return <ProfileSection data={data} />;
}

function ProfileSection({ data }: { data: WorkspaceSettingsData }) {
  const { t } = useTranslation();
  const accountHint =
    data.authProvider === "clerk"
      ? t("settings.profile.clerkAccountHint")
      : t("settings.profile.mockAccountHint");

  return (
    <div className="flex flex-col gap-[18px]">
      <SettingsPanel>
        <SettingsPanelHeading
          description={t("settings.profile.description")}
          title={t("settings.profile.title")}
        />
        <div className="mt-5 flex items-center gap-[18px] border-b border-[#f1ede4] pb-5">
          <AvatarToken className="h-[66px] w-[66px] rounded-full text-[23px]">
            {initialsFor(data.account.name)}
          </AvatarToken>
          <div>
            <div className="flex flex-wrap gap-2">
              <UnavailableSettingsButton title={accountHint}>
                {t("settings.profile.accountManaged")}
              </UnavailableSettingsButton>
            </div>
            <p className="mt-2 text-xs text-ink-400">{accountHint}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-[18px] sm:grid-cols-2">
          <SettingsField
            label={t("settings.profile.fullName")}
            readOnly
            value={data.account.name}
          />
          <SettingsField
            label={t("settings.profile.jobTitle")}
            readOnly
            value={formatRoleLabel(data.account.role)}
          />
          <SettingsField
            label={t("settings.profile.email")}
            readOnly
            value={data.account.email}
          />
          <SettingsLanguageSelect
            initialLanguage={data.account.preferredLanguage}
          />
        </div>
      </SettingsPanel>
    </div>
  );
}

function WorkspaceSection({ data }: { data: WorkspaceSettingsData }) {
  const { t } = useTranslation();
  const companySizeOptions = [
    { label: t("settings.workspace.companySizeOptions.notSet"), value: "" },
    { label: "1-10", value: "1-10" },
    { label: "11-50", value: "11-50" },
    { label: "51-200", value: "51-200" },
    { label: "201-500", value: "201-500" },
    { label: "501-1000", value: "501-1000" },
    { label: "1000+", value: "1000+" },
  ];

  return (
    <form
      action={updateWorkspaceSettingsAction}
      className="flex flex-col gap-[18px]"
    >
      <SettingsPanel>
        <SettingsPanelHeading
          description={t("settings.workspace.description")}
          title={t("settings.workspace.title")}
        />
        <div className="mt-5 flex items-center gap-[18px] border-b border-[#f1ede4] pb-5">
          <AvatarToken className="h-[62px] w-[62px] rounded-[18px] bg-olive-800 text-xl text-white">
            {initialsFor(data.organization.name)}
          </AvatarToken>
          <div>
            <UnavailableSettingsButton title={t("settings.workspace.logoHint")}>
              {t("settings.workspace.uploadLogo")}
            </UnavailableSettingsButton>
            <p className="mt-2 text-xs text-ink-400">
              {t("settings.workspace.logoHint")}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-[18px] sm:grid-cols-2">
          <SettingsField
            label={t("settings.workspace.name")}
            maxLength={80}
            name="name"
            required
            value={data.organization.name}
          />
          <SettingsUrlField
            label={t("settings.workspace.url")}
            prefix="prelude.ai/"
            value={slugFor(data.organization.name)}
          />
          <SettingsField
            label={t("settings.workspace.hiringFocus")}
            maxLength={80}
            name="hiringFocus"
            placeholder={t("settings.workspace.hiringFocusPlaceholder")}
            value={data.organization.hiringFocus ?? ""}
          />
          <SettingsSelectField
            label={t("settings.workspace.companySize")}
            name="companySize"
            options={companySizeOptions}
            value={data.organization.companySize ?? ""}
          />
        </div>
      </SettingsPanel>

      <SettingsPanel>
        <SettingsPanelHeading
          description={t("settings.workspace.residencyDescription")}
          title={t("settings.workspace.residency")}
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ResidencyChoice
            active
            description={t("settings.workspace.euResidencyDescription")}
            label={t("settings.workspace.euResidency")}
          />
          <ResidencyChoice
            description={t("settings.workspace.usResidencyDescription")}
            label={t("settings.workspace.usResidency")}
          />
        </div>
      </SettingsPanel>
      <SettingsActionRow />
    </form>
  );
}

function useRoleName() {
  const { t } = useTranslation();
  return React.useCallback(
    (role: string) => {
      const key = `settings.team.roles.${role}`;
      const label = t(key);
      return label === key ? formatRoleLabel(role) : label;
    },
    [t],
  );
}

// Shared transition + error state for a single inline team action (revoke /
// change role / remove): run the action, surface its error, expose `pending`.
function useRowAction() {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const run = React.useCallback(
    (action: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
      setError(null);
      startTransition(async () => {
        const result = await action();
        if (!result.ok) {
          setError(result.error);
        }
      });
    },
    [],
  );
  return { error, pending, run };
}

function TeamSection({ data }: { data: WorkspaceSettingsData }) {
  const viewerRole = data.account.role as OrganizationRole;

  return (
    <div className="space-y-5">
      {data.canManageTeam ? <InviteTeammatePanel /> : null}
      {data.canManageTeam && data.pendingInvitations.length > 0 ? (
        <PendingInvitationsPanel invitations={data.pendingInvitations} />
      ) : null}
      <TeamMembersPanel
        canManage={data.canManageTeam}
        members={data.team}
        viewerClerkUserId={data.viewerClerkUserId}
        viewerRole={viewerRole}
      />
    </div>
  );
}

function InviteTeammatePanel() {
  const { t } = useTranslation();
  const roleName = useRoleName();
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<OrganizationRole>("recruiter");
  const [feedback, setFeedback] = React.useState<{
    message: string;
    tone: "error" | "success";
  } | null>(null);
  const [pending, startTransition] = React.useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      const result = await inviteTeamMemberAction({ email, role });
      if (result.ok) {
        setEmail("");
        setFeedback({
          message: t("settings.team.inviteSent", { email }),
          tone: "success",
        });
      } else {
        setFeedback({ message: result.error, tone: "error" });
      }
    });
  }

  return (
    <SettingsPanel>
      <SettingsPanelHeading
        description={t("settings.team.inviteDescription")}
        title={t("settings.team.inviteTitle")}
      />
      <form
        className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={handleSubmit}
      >
        <TextField
          className="flex-1"
          label={t("settings.team.emailLabel")}
          onValueChange={setEmail}
          placeholder={t("settings.team.emailPlaceholder")}
          required
          type="email"
          value={email}
        />
        <SelectField
          className="sm:w-44"
          label={t("settings.team.roleLabel")}
          onValueChange={(nextRole) => {
            if (nextRole) {
              setRole(nextRole as OrganizationRole);
            }
          }}
          options={ASSIGNABLE_ROLE_OPTIONS.map((option) => ({
            label: roleName(option),
            value: option,
          }))}
          value={role}
        />
        <Button
          className="h-11"
          disabled={pending || email.trim().length === 0}
          type="submit"
        >
          {pending ? t("settings.team.sending") : t("settings.team.sendInvite")}
        </Button>
      </form>
      {feedback ? (
        <Notice
          className="mt-3"
          tone={feedback.tone === "error" ? "danger" : "success"}
        >
          {feedback.message}
        </Notice>
      ) : null}
    </SettingsPanel>
  );
}

function PendingInvitationsPanel({
  invitations,
}: {
  invitations: WorkspaceSettingsData["pendingInvitations"];
}) {
  const { t } = useTranslation();

  return (
    <SettingsPanel>
      <SettingsPanelHeading
        description={t("settings.team.pendingDescription", {
          count: invitations.length,
        })}
        title={t("settings.team.pendingTitle")}
      />
      <div className="mt-4">
        {invitations.map((invitation) => (
          <PendingInvitationRow invitation={invitation} key={invitation.id} />
        ))}
      </div>
    </SettingsPanel>
  );
}

function PendingInvitationRow({
  invitation,
}: {
  invitation: WorkspaceSettingsData["pendingInvitations"][number];
}) {
  const { t } = useTranslation();
  const roleName = useRoleName();
  const { error, pending, run } = useRowAction();

  return (
    <div className="flex items-center gap-3 border-t border-[#f1ede4] px-1 py-3.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-900">
          {invitation.email}
        </p>
        <p className="mt-0.5 text-[12px] text-ink-400">
          {roleName(invitation.role)}
        </p>
      </div>
      {error ? <span className="text-[12px] text-red-600">{error}</span> : null}
      <button
        className="shrink-0 rounded-[10px] px-3 py-1.5 text-[12.5px] font-semibold text-ink-500 transition hover:bg-[#f4f2ea] hover:text-ink-900 disabled:opacity-50"
        disabled={pending}
        onClick={() =>
          run(() => revokeTeamInvitationAction({ invitationId: invitation.id }))
        }
        type="button"
      >
        {pending ? t("settings.team.revoking") : t("settings.team.revoke")}
      </button>
    </div>
  );
}

function TeamMembersPanel({
  canManage,
  members,
  viewerClerkUserId,
  viewerRole,
}: {
  canManage: boolean;
  members: WorkspaceSettingsData["team"];
  viewerClerkUserId: string;
  viewerRole: OrganizationRole;
}) {
  const { t } = useTranslation();

  return (
    <SettingsPanel>
      <SettingsPanelHeading
        description={t("settings.team.description", { count: members.length })}
        title={t("settings.team.title")}
      />
      <div className="mt-4">
        {members.map((member) => (
          <TeamMemberRow
            canManage={canManage}
            isSelf={
              viewerClerkUserId.length > 0 &&
              member.clerkUserId === viewerClerkUserId
            }
            key={member.id}
            member={member}
            viewerRole={viewerRole}
          />
        ))}
        {members.length === 0 ? (
          <p className="border-t border-[#f1ede4] px-1 py-4 text-sm text-ink-500">
            {t("settings.team.empty")}
          </p>
        ) : null}
      </div>
    </SettingsPanel>
  );
}

function TeamMemberRow({
  canManage,
  isSelf,
  member,
  viewerRole,
}: {
  canManage: boolean;
  isSelf: boolean;
  member: WorkspaceSettingsData["team"][number];
  viewerRole: OrganizationRole;
}) {
  const { t } = useTranslation();
  const roleName = useRoleName();
  const { error, pending, run } = useRowAction();
  const memberRole = member.role as OrganizationRole;

  const manageable = canManage && !isSelf && memberRole !== "owner";
  const assignableRoles = ASSIGNABLE_ROLE_OPTIONS.filter((option) =>
    canChangeMemberRole(viewerRole, memberRole, option),
  );
  const canEditRole = manageable && assignableRoles.length > 0;
  const canRemove = manageable && canRemoveMember(viewerRole, memberRole);
  const roleOptions = [...new Set([memberRole, ...assignableRoles])];

  function handleRoleChange(newRole: OrganizationRole) {
    if (newRole === memberRole) {
      return;
    }
    run(() =>
      changeTeamMemberRoleAction({ newRole, userId: member.clerkUserId }),
    );
  }

  return (
    <div className="flex items-center gap-3 border-t border-[#f1ede4] px-1 py-3.5 first:border-t-0">
      <AvatarToken className="h-[42px] w-[42px] rounded-full text-sm">
        {initialsFor(member.name)}
      </AvatarToken>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink-950">
          {member.name}
          {isSelf ? (
            <span className="ml-1.5 text-[12px] font-normal text-ink-400">
              {t("settings.team.you")}
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 truncate text-[12.5px] text-ink-500">
          {member.email}
        </p>
        {error ? (
          <p className="mt-1 text-[12px] text-red-600">{error}</p>
        ) : null}
      </div>
      {canEditRole ? (
        <SelectControl
          ariaLabel={t("settings.team.changeRoleAria", { name: member.name })}
          className="h-9 rounded-[10px] pl-3 pr-2.5 text-[12.5px] font-semibold"
          disabled={pending}
          onValueChange={(nextRole) => {
            if (nextRole) {
              handleRoleChange(nextRole as OrganizationRole);
            }
          }}
          options={roleOptions.map((option) => ({
            label: roleName(option),
            value: option,
          }))}
          value={memberRole}
        />
      ) : (
        <StatusBadge
          className="shrink-0"
          tone={memberRole === "owner" ? "dark" : "olive"}
        >
          {roleName(memberRole)}
        </StatusBadge>
      )}
      {canRemove ? (
        <IconButton
          aria-label={t("settings.team.removeAria", { name: member.name })}
          className="h-8 w-8 text-ink-400 hover:bg-[#fbeceb] hover:text-red-600"
          disabled={pending}
          onClick={() =>
            run(() => removeTeamMemberAction({ userId: member.clerkUserId }))
          }
          size="sm"
          variant="ghost"
        >
          <Trash aria-hidden={true} className="h-[18px] w-[18px]" />
        </IconButton>
      ) : null}
    </div>
  );
}

function InterviewDefaultsSection({ data }: { data: WorkspaceSettingsData }) {
  const { t } = useTranslation();
  const [preferences, setPreferences] = React.useState(
    data.interviewPreferences,
  );
  const languageOptions = [
    { label: t("settings.language.english"), value: "en" },
    { label: t("settings.language.french"), value: "fr" },
  ];
  const voiceOptions = [
    { label: t("settings.interview.voices.maya"), value: "maya" },
    { label: t("settings.interview.voices.noah"), value: "noah" },
    { label: t("settings.interview.voices.lea"), value: "lea" },
  ];
  const setPreference = React.useCallback(
    (key: keyof typeof preferences, checked: boolean) => {
      setPreferences((current) => {
        if (
          !checked &&
          ((key === "allowAudio" && !current.allowForm) ||
            (key === "allowForm" && !current.allowAudio))
        ) {
          return current;
        }

        return {
          ...current,
          [key]: checked,
        };
      });
    },
    [],
  );

  return (
    <form
      action={updateInterviewPreferencesAction}
      className="flex flex-col gap-[18px]"
    >
      <SettingsPanel>
        <SettingsPanelHeading
          description={t("settings.interview.description")}
          title={t("settings.interview.title")}
        />
        <div className="mt-5 grid gap-[18px] sm:grid-cols-2">
          <SettingsSelectField
            label={t("settings.interview.defaultLanguage")}
            name="defaultLanguage"
            options={languageOptions}
            value={preferences.defaultLanguage}
          />
          <SettingsSelectField
            label={t("settings.interview.interviewerVoice")}
            name="interviewerVoice"
            options={voiceOptions}
            value={preferences.interviewerVoice}
          />
        </div>
      </SettingsPanel>

      <SettingsPanel className="px-6 py-2">
        <SettingsToggleRow
          checked={preferences.allowAudio}
          description={t("settings.interview.allowAudioDescription")}
          label={t("settings.interview.allowAudio")}
          name="allowAudio"
          onCheckedChange={(checked) => setPreference("allowAudio", checked)}
        />
        <SettingsToggleRow
          checked={preferences.allowForm}
          description={t("settings.interview.allowFormDescription")}
          label={t("settings.interview.allowForm")}
          name="allowForm"
          onCheckedChange={(checked) => setPreference("allowForm", checked)}
        />
        <SettingsToggleRow
          checked={preferences.showReviewGuardrail}
          description={t("settings.interview.showReviewGuardrailDescription")}
          label={t("settings.interview.showReviewGuardrail")}
          name="showReviewGuardrail"
          onCheckedChange={(checked) =>
            setPreference("showReviewGuardrail", checked)
          }
        />
        <SettingsToggleRow
          checked={preferences.autoGenerateTranscript}
          description={t(
            "settings.interview.autoGenerateTranscriptDescription",
          )}
          label={t("settings.interview.autoGenerateTranscript")}
          name="autoGenerateTranscript"
          onCheckedChange={(checked) =>
            setPreference("autoGenerateTranscript", checked)
          }
        />
        <SettingsToggleRow
          checked={preferences.requireRecordingConsent}
          description={t(
            "settings.interview.requireRecordingConsentDescription",
          )}
          label={t("settings.interview.requireRecordingConsent")}
          name="requireRecordingConsent"
          onCheckedChange={(checked) =>
            setPreference("requireRecordingConsent", checked)
          }
        />
      </SettingsPanel>
      <SettingsActionRow />
    </form>
  );
}

function IntegrationsSection({
  connectedAccounts,
  connectors,
  googleOAuthAvailable,
}: {
  connectedAccounts: WorkspaceSettingsData["connectedAccounts"];
  connectors: WorkspaceSettingsData["connectors"];
  googleOAuthAvailable: boolean;
}) {
  const { t } = useTranslation();
  const normalized = new Map(
    connectors.map((connector) => [connector.provider, connector.status]),
  );
  const googleAccount = connectedAccounts.find(
    (account) =>
      account.provider === "google" &&
      account.capabilities.includes("calendar"),
  );
  const integrations = [
    {
      description: t("settings.integrations.jobPosts"),
      logo: <LinkedInLogo />,
      name: "LinkedIn",
      provider: "linkedin",
      type: "status",
    },
    {
      description: t("settings.integrations.jobPosts"),
      logo: <IndeedLogo />,
      name: "Indeed",
      provider: "indeed",
      type: "status",
    },
    {
      description: t("settings.integrations.ats"),
      logo: <GenericIntegrationLogo label="GH" />,
      name: "Greenhouse",
      provider: "greenhouse",
      type: "status",
    },
    {
      description: t("settings.integrations.calendar"),
      logo: (
        <IconIntegrationLogo>
          <GoogleCircle aria-hidden={true} className="h-6 w-6" />
        </IconIntegrationLogo>
      ),
      name: "Google Calendar",
      provider: "google_calendar",
      type: "google_calendar",
    },
    {
      description: t("settings.integrations.gmail"),
      logo: (
        <IconIntegrationLogo muted>
          <GoogleCircle aria-hidden={true} className="h-6 w-6" />
        </IconIntegrationLogo>
      ),
      name: "Gmail",
      provider: "google_gmail",
      type: "status",
    },
    {
      description: t("settings.integrations.microsoft"),
      logo: <GenericIntegrationLogo label="M" muted />,
      name: "Microsoft Teams",
      provider: "microsoft_teams",
      type: "status",
    },
  ];

  return (
    <SettingsPanel>
      <SettingsPanelHeading
        description={t("settings.integrations.description")}
        title={t("settings.integrations.title")}
      />
      <div className="mt-5 flex flex-col gap-2.5">
        {integrations.map((integration) => {
          const connected = normalized.has(integration.provider);
          if (integration.type === "google_calendar") {
            return (
              <GoogleCalendarIntegrationRow
                account={googleAccount ?? null}
                available={googleOAuthAvailable}
                description={integration.description}
                key={integration.provider}
                logo={integration.logo}
                name={integration.name}
              />
            );
          }

          return (
            <div
              className="flex items-center gap-3 rounded-2xl border border-[#f1ede4] bg-white/60 px-4 py-3.5"
              key={integration.provider}
            >
              {integration.logo}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-950">
                  {integration.name}
                </p>
                <p className="mt-0.5 truncate text-[12.5px] text-ink-500">
                  {connected
                    ? `${integration.description} · ${formatStatus(
                        normalized.get(integration.provider) ?? "connected",
                      )}`
                    : integration.description}
                </p>
              </div>
              <StatusBadge
                className="shrink-0"
                tone={connected ? "success" : "neutral"}
              >
                {connected
                  ? t("settings.integrations.connected")
                  : t("settings.integrations.comingSoon")}
              </StatusBadge>
            </div>
          );
        })}
      </div>
    </SettingsPanel>
  );
}

function GoogleCalendarIntegrationRow({
  account,
  available,
  description,
  logo,
  name,
}: {
  account: WorkspaceSettingsData["connectedAccounts"][number] | null;
  available: boolean;
  description: string;
  logo: React.ReactNode;
  name: string;
}) {
  const { t } = useTranslation();
  const status = account?.status ?? "not_connected";
  const connected = status === "connected";
  const reconnect =
    status === "expired" || status === "needs_reconnect" || status === "error";
  const disabled = !available;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[#f1ede4] bg-white/60 px-4 py-3.5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {logo}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-ink-950">
              {name}
            </p>
            <IntegrationStatusBadge available={available} status={status} />
          </div>
          <p className="mt-0.5 text-[12.5px] leading-5 text-ink-500">
            {account?.externalAccountEmail
              ? t("settings.integrations.connectedAs", {
                  email: account.externalAccountEmail,
                })
              : description}
          </p>
        </div>
      </div>

      {connected ? (
        <form action={disconnectGoogleCalendarAction}>
          <Button
            className="w-full sm:w-auto"
            type="submit"
            variant="secondary"
          >
            <Xmark aria-hidden={true} className="h-4 w-4" />
            {t("settings.integrations.disconnect")}
          </Button>
        </form>
      ) : (
        <form action={connectGoogleCalendarAction}>
          <Button
            className="w-full sm:w-auto"
            disabled={disabled}
            title={
              disabled ? t("settings.integrations.googleSetupHint") : undefined
            }
            type="submit"
            variant={reconnect ? "secondary" : "primary"}
          >
            {reconnect ? (
              <Refresh aria-hidden={true} className="h-4 w-4" />
            ) : (
              <Calendar aria-hidden={true} className="h-4 w-4" />
            )}
            {reconnect
              ? t("settings.integrations.reconnect")
              : t("settings.integrations.connect")}
          </Button>
        </form>
      )}
    </div>
  );
}

function IntegrationStatusBadge({
  available,
  status,
}: {
  available: boolean;
  status: WorkspaceSettingsData["connectedAccounts"][number]["status"];
}) {
  const { t } = useTranslation();
  if (!available) {
    return (
      <StatusBadge tone="warning">
        <WarningTriangle aria-hidden={true} className="h-3.5 w-3.5" />
        {t("settings.integrations.setupRequired")}
      </StatusBadge>
    );
  }

  if (status === "connected") {
    return (
      <StatusBadge tone="success">
        <Check aria-hidden={true} className="h-3.5 w-3.5" />
        {t("settings.integrations.connected")}
      </StatusBadge>
    );
  }

  if (status === "needs_reconnect" || status === "expired") {
    return (
      <StatusBadge tone="warning">
        {t("settings.integrations.needsReconnect")}
      </StatusBadge>
    );
  }

  if (status === "error") {
    return (
      <StatusBadge tone="danger">
        {t("settings.integrations.error")}
      </StatusBadge>
    );
  }

  return (
    <StatusBadge tone="neutral">
      {t("settings.integrations.notConnected")}
    </StatusBadge>
  );
}

function NotificationsSection({
  preferences,
}: {
  preferences: WorkspaceSettingsData["notificationPreferences"];
}) {
  const { t } = useTranslation();
  const [values, setValues] = React.useState(preferences);
  const setPreference = React.useCallback(
    (key: keyof typeof values, checked: boolean) => {
      setValues((current) => ({
        ...current,
        [key]: checked,
      }));
    },
    [],
  );

  return (
    <form action={updateNotificationPreferencesAction}>
      <SettingsPanel className="px-6 py-2">
        <div className="py-5">
          <SettingsPanelHeading
            description={t("settings.notifications.description")}
            title={t("settings.notifications.title")}
          />
        </div>
        <SettingsToggleRow
          checked={values.screensReadyForReview}
          description={t("settings.notifications.screensReadyDescription")}
          label={t("settings.notifications.screensReady")}
          name="screensReadyForReview"
          onCheckedChange={(checked) =>
            setPreference("screensReadyForReview", checked)
          }
        />
        <SettingsToggleRow
          checked={values.candidateCompletionConfirmation}
          description={t(
            "settings.notifications.candidateCompletionDescription",
          )}
          label={t("settings.notifications.candidateCompletion")}
          name="candidateCompletionConfirmation"
          onCheckedChange={(checked) =>
            setPreference("candidateCompletionConfirmation", checked)
          }
        />
        <SettingsToggleRow
          checked={values.mentionsAndComments}
          description={t("settings.notifications.mentionsDescription")}
          label={t("settings.notifications.mentions")}
          name="mentionsAndComments"
          onCheckedChange={(checked) =>
            setPreference("mentionsAndComments", checked)
          }
        />
        <SettingsToggleRow
          checked={values.weeklyDigest}
          description={t("settings.notifications.weeklyDigestDescription")}
          label={t("settings.notifications.weeklyDigest")}
          name="weeklyDigest"
          onCheckedChange={(checked) => setPreference("weeklyDigest", checked)}
        />
        <SettingsToggleRow
          checked={values.productUpdates}
          description={t("settings.notifications.productUpdatesDescription")}
          label={t("settings.notifications.productUpdates")}
          name="productUpdates"
          onCheckedChange={(checked) =>
            setPreference("productUpdates", checked)
          }
        />
      </SettingsPanel>
      <div className="mt-[18px]">
        <SettingsActionRow />
      </div>
    </form>
  );
}

function BillingSection({
  metrics,
}: {
  metrics: WorkspaceSettingsData["metrics"];
}) {
  const { t } = useTranslation();
  const interviewsUsed = metrics.published + metrics.needsReview;

  return (
    <section className="overflow-hidden rounded-[22px] bg-ink-900 p-6 text-white">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mint-200">
            {t("settings.billing.currentPlan")}
          </p>
          <h2 className="mt-2.5 text-2xl font-semibold tracking-[-0.015em]">
            {t("settings.billing.planName")}
          </h2>
          <p className="mt-2 text-[13.5px] text-white/65">
            {t("settings.billing.planDescription")}
          </p>
        </div>
        <UnavailableSettingsButton
          className="bg-white text-ink-900"
          title={t("settings.billing.clerkManaged")}
        >
          {t("settings.billing.managePlan")}
        </UnavailableSettingsButton>
      </div>
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <UsageMeter
          label={t("settings.billing.interviewsThisMonth")}
          max={250}
          value={interviewsUsed}
        />
        <UsageMeter
          label={t("settings.billing.activeRoles")}
          max={25}
          value={metrics.activeRoles}
        />
      </div>
    </section>
  );
}

function UnavailableSettingsButton({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <Button
      className={className}
      disabled
      title={title}
      type="button"
      variant="secondary"
    >
      {children}
    </Button>
  );
}

function ResidencyChoice({
  active = false,
  description,
  label,
}: {
  active?: boolean;
  description: string;
  label: string;
}) {
  return (
    <SelectionCard
      className="rounded-[15px]"
      description={description}
      indicatorShape="circle"
      selected={active}
      title={label}
    />
  );
}

function UsageMeter({
  label,
  max,
  value,
}: {
  label: string;
  max: number;
  value: number;
}) {
  const percentage = Math.min((value / max) * 100, 100);

  return (
    <div>
      <div className="flex justify-between text-[12.5px] text-white/70">
        <span>{label}</span>
        <span>
          {value} / {max}
        </span>
      </div>
      <div className="mt-2 h-[7px] overflow-hidden rounded-full bg-white/15">
        <span
          className="block h-full rounded-full bg-mint-200"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function LinkedInLogo() {
  return (
    <span className="grid h-[42px] w-[42px] shrink-0 place-items-center overflow-hidden rounded-[11px] bg-[#0A66C2] text-sm font-bold text-white">
      in
    </span>
  );
}

function IndeedLogo() {
  return (
    <span className="grid h-[42px] w-[42px] shrink-0 place-items-center overflow-hidden rounded-[11px] bg-[#003A9B] text-lg font-bold text-white">
      i
    </span>
  );
}

function GenericIntegrationLogo({
  label,
  muted = false,
}: {
  label: string;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        "grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[11px] text-sm font-bold",
        muted
          ? "border border-ink-100 bg-white text-ink-500"
          : "bg-meadow-600 text-white",
      )}
    >
      {label}
    </span>
  );
}

function IconIntegrationLogo({
  children,
  muted = false,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        "grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[11px]",
        muted
          ? "border border-ink-100 bg-white text-ink-500"
          : "bg-white text-ink-900",
      )}
    >
      {children}
    </span>
  );
}

function initialsFor(value: string) {
  const initials = value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "P";
}

function slugFor(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatRoleLabel(role: string) {
  const normalized = role.replace(/_/g, " ");

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}
