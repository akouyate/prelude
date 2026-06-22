"use client";

import * as React from "react";
import { CheckCircle, Plus, ThreePointsCircle } from "iconoir-react";
import { useTranslation } from "react-i18next";
import { Badge, Button, StatusBadge, cn } from "@prelude/ui";

import { SettingsLanguageSelect } from "./settings-language-select";
import { SettingsSectionNav } from "./settings-section-nav";
import type { SettingsSection, WorkspaceSettingsData } from "./settings-types";
import {
  AvatarToken,
  SettingsActionRow,
  SettingsField,
  SettingsPanel,
  SettingsPanelHeading,
  SettingsSelectLike,
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
    return <TeamSection ownerName={data.account.name} />;
  }

  if (section === "interview") {
    return <InterviewDefaultsSection data={data} />;
  }

  if (section === "integrations") {
    return <IntegrationsSection connectors={data.connectors} />;
  }

  if (section === "notifications") {
    return <NotificationsSection />;
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
              <Button variant="secondary">
                {t("settings.profile.changePhoto")}
              </Button>
              <Button variant="ghost">{t("settings.profile.remove")}</Button>
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
      <SettingsActionRow />
    </div>
  );
}

function WorkspaceSection({ data }: { data: WorkspaceSettingsData }) {
  return (
    <div className="flex flex-col gap-[18px]">
      <SettingsPanel>
        <SettingsPanelHeading
          description="General details for your organization on Prelude."
          title="Workspace"
        />
        <div className="mt-5 flex items-center gap-[18px] border-b border-[#f1ede4] pb-5">
          <AvatarToken className="h-[62px] w-[62px] rounded-[18px] bg-olive-800 text-xl text-white">
            {initialsFor(data.organization.name)}
          </AvatarToken>
          <div>
            <Button variant="secondary">Upload logo</Button>
            <p className="mt-2 text-xs text-ink-400">
              Square SVG or PNG works best.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-[18px] sm:grid-cols-2">
          <SettingsField
            label="Workspace name"
            readOnly
            value={data.organization.name}
          />
          <SettingsUrlField
            label="Workspace URL"
            prefix="prelude.ai/"
            value={slugFor(data.organization.name)}
          />
          <SettingsField
            label="Hiring focus"
            readOnly
            value={data.organization.hiringFocus ?? "Not set"}
          />
          <SettingsSelectLike
            label="Company size"
            value={data.organization.companySize ?? "Not set"}
          />
        </div>
      </SettingsPanel>

      <SettingsPanel>
        <SettingsPanelHeading
          description="Where candidate data and recordings are stored."
          title="Data residency"
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ResidencyChoice
            active
            description="Frankfurt · GDPR-compliant"
            label="European Union"
          />
          <ResidencyChoice
            description="Virginia · SOC 2 Type II"
            label="United States"
          />
        </div>
      </SettingsPanel>
    </div>
  );
}

function TeamSection({ ownerName }: { ownerName: string }) {
  const team = [
    { email: "adrien@prelude.local", name: ownerName, role: "Owner" },
    { email: "talent@prelude.local", name: "Talent Partner", role: "Admin" },
    { email: "recruiting@prelude.local", name: "Recruiter Seat", role: "Recruiter" },
    { email: "hiring@prelude.local", name: "Hiring Manager", role: "Viewer" },
  ];

  return (
    <SettingsPanel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SettingsPanelHeading
          description={`${team.length} people have access to this workspace.`}
          title="Team & roles"
        />
        <Button className="h-[42px]">
          <Plus aria-hidden={true} className="h-4 w-4" />
          Invite member
        </Button>
      </div>
      <div className="mt-5">
        {team.map((member) => (
          <div
            className="flex items-center gap-3 border-t border-[#f1ede4] px-1 py-3.5 first:border-t-0"
            key={member.email}
          >
            <AvatarToken className="h-[42px] w-[42px] rounded-full text-sm">
              {initialsFor(member.name)}
            </AvatarToken>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink-950">
                {member.name}
              </p>
              <p className="mt-0.5 truncate text-[12.5px] text-ink-500">
                {member.email}
              </p>
            </div>
            <StatusBadge
              className="shrink-0"
              tone={member.role === "Owner" ? "dark" : "olive"}
            >
              {member.role}
            </StatusBadge>
            <button
              aria-label={`Open actions for ${member.name}`}
              className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-[10px] text-ink-400 transition hover:bg-[#f4f2ea] hover:text-ink-950"
              type="button"
            >
              <ThreePointsCircle aria-hidden={true} className="h-5 w-5" />
            </button>
          </div>
        ))}
      </div>
    </SettingsPanel>
  );
}

function InterviewDefaultsSection({ data }: { data: WorkspaceSettingsData }) {
  return (
    <div className="flex flex-col gap-[18px]">
      <SettingsPanel>
        <SettingsPanelHeading
          description="Applied to every new screening interview. Editable per role."
          title="Interview defaults"
        />
        <div className="mt-5 grid gap-[18px] sm:grid-cols-2">
          <SettingsSelectLike label="Default language" value="English (US)" />
          <SettingsSelectLike
            label="Interviewer voice"
            value="Maya - warm, measured"
          />
        </div>
        <div className="mt-5">
          <p className="text-[12.5px] font-semibold text-ink-700">
            Target duration
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {["10 min", "15 min", "20 min", "30 min"].map((duration) => {
              const active = duration === "15 min";

              return (
                <button
                  className={cn(
                    "h-11 cursor-pointer rounded-[13px] border text-[13.5px] font-semibold transition",
                    active
                      ? "border-ink-900 bg-ink-900 text-white"
                      : "border-[#e2ddd2] bg-white text-ink-700 hover:border-[#c8c1b2]",
                  )}
                  key={duration}
                  type="button"
                >
                  {duration}
                </button>
              );
            })}
          </div>
        </div>
      </SettingsPanel>

      <SettingsPanel className="px-6 py-2">
        <SettingsToggleRow
          defaultChecked
          description="Display the evidence-not-decisions note above every review queue."
          label="Show review guardrail"
        />
        <SettingsToggleRow
          defaultChecked
          description="Produce a full text transcript as soon as a session ends."
          label="Auto-generate transcript"
        />
        <SettingsToggleRow
          defaultChecked
          description="Candidates must accept before any audio is captured."
          label="Require recording consent"
        />
        <SettingsToggleRow
          defaultChecked={data.organization.defaultInterviewMode === "video"}
          description="Allow video answers when the role needs stronger communication signals."
          label="Enable video by default"
        />
      </SettingsPanel>
    </div>
  );
}

function IntegrationsSection({
  connectors,
}: {
  connectors: WorkspaceSettingsData["connectors"];
}) {
  const normalized = new Map(
    connectors.map((connector) => [connector.provider, connector.status]),
  );
  const integrations = [
    {
      description: "Import active job posts",
      logo: <LinkedInLogo />,
      name: "LinkedIn",
      provider: "linkedin",
    },
    {
      description: "Import active job posts",
      logo: <IndeedLogo />,
      name: "Indeed",
      provider: "indeed",
    },
    {
      description: "ATS · push qualified candidates",
      logo: <GenericIntegrationLogo label="GH" />,
      name: "Greenhouse",
      provider: "greenhouse",
    },
    {
      description: "Schedule follow-up calls",
      logo: <GenericIntegrationLogo label="G" muted />,
      name: "Google Calendar",
      provider: "google_calendar",
    },
  ];

  return (
    <SettingsPanel>
      <SettingsPanelHeading
        description="Sources for candidates and tools that sync with Prelude."
        title="Integrations"
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
                {connected ? "Connected" : "Connect"}
              </Badge>
            </div>
          );
        })}
      </div>
    </SettingsPanel>
  );
}

function NotificationsSection() {
  return (
    <SettingsPanel className="px-6 py-2">
      <div className="py-5">
        <SettingsPanelHeading
          description="Choose what Prelude emails you about."
          title="Notifications"
        />
      </div>
      <SettingsToggleRow
        defaultChecked
        description="When a candidate finishes and signals are ready."
        label="Screens ready for review"
      />
      <SettingsToggleRow
        defaultChecked
        description="A live interview wrapped up successfully."
        label="Interview completed"
      />
      <SettingsToggleRow
        defaultChecked
        description="When a teammate mentions you on a candidate."
        label="Mentions & comments"
      />
      <SettingsToggleRow
        description="A Monday summary of pipeline activity."
        label="Weekly digest"
      />
      <SettingsToggleRow
        description="Occasional news about new Prelude features."
        label="Product updates"
      />
    </SettingsPanel>
  );
}

function BillingSection({
  metrics,
}: {
  metrics: WorkspaceSettingsData["metrics"];
}) {
  const interviewsUsed = Math.max(metrics.published + metrics.needsReview, 1);

  return (
    <div className="flex flex-col gap-[18px]">
      <section className="overflow-hidden rounded-[22px] bg-ink-900 p-6 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mint-200">
              Current plan
            </p>
            <h2 className="mt-2.5 text-2xl font-semibold tracking-[-0.015em]">
              Scale
            </h2>
            <p className="mt-2 text-[13.5px] text-white/65">
              EUR 499 / month · renews 1 July 2026
            </p>
          </div>
          <Button className="bg-white text-ink-950 hover:bg-[#f6f3ec]">
            Manage plan
          </Button>
        </div>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <UsageMeter label="Interviews this month" max={250} value={interviewsUsed} />
          <UsageMeter label="Seats used" max={8} value={4} />
        </div>
      </section>

      <SettingsPanel>
        <h3 className="text-base font-semibold text-ink-950">
          Payment method
        </h3>
        <div className="mt-4 flex items-center gap-3 rounded-[15px] border border-[#f1ede4] bg-white/60 px-4 py-3.5">
          <span className="grid h-8 w-12 shrink-0 place-items-center rounded-lg bg-ink-900 text-white">
            <CheckCircle aria-hidden={true} className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-950">
              Visa ending 4291
            </p>
            <p className="mt-0.5 text-[12.5px] text-ink-500">
              Expires 09 / 27
            </p>
          </div>
          <Button variant="secondary">Update</Button>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[13.5px] text-ink-500">Billing history</span>
          <button
            className="cursor-pointer text-[13px] font-semibold text-olive-900"
            type="button"
          >
            View invoices
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
  return role.replace(/_/g, " ");
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}
