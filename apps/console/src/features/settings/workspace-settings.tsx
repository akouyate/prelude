"use client";

import * as React from "react";
import { CheckCircle, NavArrowDown, Trash } from "iconoir-react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Input, StatusBadge, cn } from "@prelude/ui";
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

const sectionLabelKeys: Record<SettingsSection, string> = {
  profile: "settings.nav.profile",
  workspace: "settings.nav.workspace",
  team: "settings.nav.team",
  interview: "settings.nav.interview",
  integrations: "settings.nav.integrations",
  notifications: "settings.nav.notifications",
  billing: "settings.nav.billing",
};
const settingsSectionOrder: SettingsSection[] = [
  "profile",
  "workspace",
  "team",
  "interview",
  "integrations",
  "notifications",
  "billing",
];

export function WorkspaceSettings({ data }: { data: WorkspaceSettingsData }) {
  const { t } = useTranslation();
  const [section, setSection] = React.useState<SettingsSection>("profile");

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

      <div className="grid gap-7 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        <SettingsSectionNav
          authProvider={data.authProvider}
          onSectionChange={setSection}
          section={section}
        />
        <SettingsMobileNav
          onSectionChange={setSection}
          section={section}
        />

        <div className="min-w-0">
          <SettingsSectionContent data={data} section={section} />
        </div>
      </div>
    </section>
  );
}

function SettingsMobileNav({
  onSectionChange,
  section,
}: {
  onSectionChange: (section: SettingsSection) => void;
  section: SettingsSection;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 lg:hidden">
      {settingsSectionOrder.map((value) => (
        <button
          className={cn(
            "h-9 shrink-0 cursor-pointer rounded-full px-3 text-xs font-semibold transition",
            section === value
              ? "bg-ink-900 text-white"
              : "border border-ink-100 bg-white/70 text-ink-600",
          )}
          key={value}
          onClick={() => onSectionChange(value)}
          type="button"
        >
          {t(sectionLabelKeys[value])}
        </button>
      ))}
    </div>
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
    return <IntegrationsSection connectors={data.connectors} />;
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
              <Button type="button" variant="secondary">
                {t("settings.profile.changePhoto")}
              </Button>
              <Button type="button" variant="ghost">
                {t("settings.profile.remove")}
              </Button>
            </div>
            <p className="mt-2 text-xs text-ink-400">
              {t("settings.profile.avatarHint")}
            </p>
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
    <form action={updateWorkspaceSettingsAction} className="flex flex-col gap-[18px]">
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
            <Button type="button" variant="secondary">
              {t("settings.workspace.uploadLogo")}
            </Button>
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

function TeamSection({ data }: { data: WorkspaceSettingsData }) {
  const viewerRole = data.account.role as OrganizationRole;

  return (
    <div className="space-y-5">
      {data.canManageTeam ? (
        <InviteTeammatePanel isMockWorkspace={data.authProvider === "mock"} />
      ) : null}
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

function InviteTeammatePanel({ isMockWorkspace }: { isMockWorkspace: boolean }) {
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
      {isMockWorkspace ? (
        <p className="mt-4 rounded-[13px] border border-[#e7e2d6] bg-[#f7f6f1] px-4 py-3 text-[13px] leading-5 text-ink-500">
          {t("settings.team.mockNotice")}
        </p>
      ) : (
        <form
          className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={handleSubmit}
        >
          <label className="flex flex-1 flex-col gap-2">
            <span className="text-[12.5px] font-semibold text-ink-700">
              {t("settings.team.emailLabel")}
            </span>
            <Input
              className="h-11 rounded-[13px] border-[#e2ddd2] bg-white px-3.5 focus:border-ink-900 focus:ring-[#e5e8d6]"
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t("settings.team.emailPlaceholder")}
              required
              type="email"
              value={email}
            />
          </label>
          <label className="flex flex-col gap-2 sm:w-44">
            <span className="text-[12.5px] font-semibold text-ink-700">
              {t("settings.team.roleLabel")}
            </span>
            <div className="relative">
              <select
                className="h-11 w-full cursor-pointer appearance-none rounded-[13px] border border-[#e2ddd2] bg-white px-3.5 pr-10 text-left text-sm text-ink-950 transition hover:border-[#c8c1b2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
                onChange={(event) =>
                  setRole(event.target.value as OrganizationRole)
                }
                value={role}
              >
                {ASSIGNABLE_ROLE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {roleName(option)}
                  </option>
                ))}
              </select>
              <NavArrowDown
                aria-hidden={true}
                className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
              />
            </div>
          </label>
          <Button
            className="h-11"
            disabled={pending || email.trim().length === 0}
            type="submit"
          >
            {pending ? t("settings.team.sending") : t("settings.team.sendInvite")}
          </Button>
        </form>
      )}
      {feedback ? (
        <p
          className={cn(
            "mt-3 text-[13px]",
            feedback.tone === "error" ? "text-red-600" : "text-olive-700",
          )}
        >
          {feedback.message}
        </p>
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
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function handleRevoke() {
    setError(null);
    startTransition(async () => {
      const result = await revokeTeamInvitationAction({
        invitationId: invitation.id,
      });
      if (!result.ok) {
        setError(result.error);
      }
    });
  }

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
      {error ? (
        <span className="text-[12px] text-red-600">{error}</span>
      ) : null}
      <button
        className="shrink-0 rounded-[10px] px-3 py-1.5 text-[12.5px] font-semibold text-ink-500 transition hover:bg-[#f4f2ea] hover:text-ink-900 disabled:opacity-50"
        disabled={pending}
        onClick={handleRevoke}
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
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const memberRole = member.role as OrganizationRole;

  const manageable = canManage && !isSelf && memberRole !== "owner";
  const assignableRoles = ASSIGNABLE_ROLE_OPTIONS.filter((option) =>
    canChangeMemberRole(viewerRole, memberRole, option),
  );
  const canEditRole = manageable && assignableRoles.length > 0;
  const canRemove = manageable && canRemoveMember(viewerRole, memberRole);
  const roleOptions = assignableRoles.includes(memberRole)
    ? assignableRoles
    : [memberRole, ...assignableRoles];

  function handleRoleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const newRole = event.target.value as OrganizationRole;
    if (newRole === memberRole) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await changeTeamMemberRoleAction({
        newRole,
        userId: member.clerkUserId,
      });
      if (!result.ok) {
        setError(result.error);
      }
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const result = await removeTeamMemberAction({
        userId: member.clerkUserId,
      });
      if (!result.ok) {
        setError(result.error);
      }
    });
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
        <div className="relative shrink-0">
          <select
            aria-label={t("settings.team.changeRoleAria", { name: member.name })}
            className="h-9 cursor-pointer appearance-none rounded-[10px] border border-[#e2ddd2] bg-white pl-3 pr-8 text-[12.5px] font-semibold text-ink-900 transition hover:border-[#c8c1b2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300 disabled:opacity-50"
            disabled={pending}
            onChange={handleRoleChange}
            value={memberRole}
          >
            {roleOptions.map((option) => (
              <option key={option} value={option}>
                {roleName(option)}
              </option>
            ))}
          </select>
          <NavArrowDown
            aria-hidden={true}
            className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
          />
        </div>
      ) : (
        <StatusBadge
          className="shrink-0"
          tone={memberRole === "owner" ? "dark" : "olive"}
        >
          {roleName(memberRole)}
        </StatusBadge>
      )}
      {canRemove ? (
        <button
          aria-label={t("settings.team.removeAria", { name: member.name })}
          className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-[10px] text-ink-400 transition hover:bg-[#fbeceb] hover:text-red-600 disabled:opacity-50"
          disabled={pending}
          onClick={handleRemove}
          type="button"
        >
          <Trash aria-hidden={true} className="h-[18px] w-[18px]" />
        </button>
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
          description={t("settings.interview.autoGenerateTranscriptDescription")}
          label={t("settings.interview.autoGenerateTranscript")}
          name="autoGenerateTranscript"
          onCheckedChange={(checked) =>
            setPreference("autoGenerateTranscript", checked)
          }
        />
        <SettingsToggleRow
          checked={preferences.requireRecordingConsent}
          description={t("settings.interview.requireRecordingConsentDescription")}
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
  connectors,
}: {
  connectors: WorkspaceSettingsData["connectors"];
}) {
  const { t } = useTranslation();
  const normalized = new Map(
    connectors.map((connector) => [connector.provider, connector.status]),
  );
  const integrations = [
    {
      description: t("settings.integrations.jobPosts"),
      logo: <LinkedInLogo />,
      name: "LinkedIn",
      provider: "linkedin",
    },
    {
      description: t("settings.integrations.jobPosts"),
      logo: <IndeedLogo />,
      name: "Indeed",
      provider: "indeed",
    },
    {
      description: t("settings.integrations.ats"),
      logo: <GenericIntegrationLogo label="GH" />,
      name: "Greenhouse",
      provider: "greenhouse",
    },
    {
      description: t("settings.integrations.calendar"),
      logo: <GenericIntegrationLogo label="G" muted />,
      name: "Google Calendar",
      provider: "google_calendar",
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
              <Badge
                className={cn(
                  "shrink-0",
                  connected
                    ? "bg-meadow-50 text-meadow-800"
                    : "border border-ink-200 bg-white text-ink-900",
                )}
              >
                {connected
                  ? t("settings.integrations.connected")
                  : t("settings.integrations.comingSoon")}
              </Badge>
            </div>
          );
        })}
      </div>
    </SettingsPanel>
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
        checked={values.interviewCompleted}
        description={t("settings.notifications.interviewCompletedDescription")}
        label={t("settings.notifications.interviewCompleted")}
        name="interviewCompleted"
        onCheckedChange={(checked) =>
          setPreference("interviewCompleted", checked)
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
        onCheckedChange={(checked) => setPreference("productUpdates", checked)}
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
    <div className="flex flex-col gap-[18px]">
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
          <Button
            className="bg-white text-ink-950 hover:bg-[#f6f3ec]"
            type="button"
          >
            {t("settings.billing.managePlan")}
          </Button>
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

      <SettingsPanel>
        <h3 className="text-base font-semibold text-ink-950">
          {t("settings.billing.billingSetup")}
        </h3>
        <div className="mt-4 flex items-center gap-3 rounded-[15px] border border-[#f1ede4] bg-white/60 px-4 py-3.5">
          <span className="grid h-8 w-12 shrink-0 place-items-center rounded-lg bg-ink-900 text-white">
            <CheckCircle aria-hidden={true} className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-950">
              {t("settings.billing.notConnected")}
            </p>
            <p className="mt-0.5 text-[12.5px] text-ink-500">
              {t("settings.billing.notConnectedDescription")}
            </p>
          </div>
          <Button type="button" variant="secondary">
            {t("settings.billing.configure")}
          </Button>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[13.5px] text-ink-500">
            {t("settings.billing.billingHistory")}
          </span>
          <button
            className="cursor-pointer text-[13px] font-semibold text-olive-900"
            type="button"
          >
            {t("settings.billing.viewInvoices")}
          </button>
        </div>
      </SettingsPanel>
    </div>
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
    <button
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-[15px] border p-4 text-left transition",
        active
          ? "border-olive-700 bg-[#f7faef]"
          : "border-[#e2ddd2] bg-white hover:border-[#c8c1b2]",
      )}
      type="button"
    >
      <span
        className={cn(
          "mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full",
          active ? "bg-olive-700 text-white" : "border border-[#ddd8cc]",
        )}
      >
        {active ? <CheckCircle aria-hidden={true} className="h-3 w-3" /> : null}
      </span>
      <span>
        <span className="block text-sm font-semibold text-ink-950">
          {label}
        </span>
        <span className="mt-1 block text-xs text-ink-500">
          {description}
        </span>
      </span>
    </button>
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
