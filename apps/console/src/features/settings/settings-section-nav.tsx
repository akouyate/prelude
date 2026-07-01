"use client";

import { useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { LogOut } from "iconoir-react";
import { useTranslation } from "react-i18next";
import { UnderlineTabs } from "@prelude/ui";

import type { SettingsSection } from "./settings-types";

const settingsNavItems: Array<{
  labelKey: string;
  value: SettingsSection;
}> = [
  { labelKey: "settings.nav.profile", value: "profile" },
  { labelKey: "settings.nav.workspace", value: "workspace" },
  { labelKey: "settings.nav.team", value: "team" },
  { labelKey: "settings.nav.interview", value: "interview" },
  { labelKey: "settings.nav.integrations", value: "integrations" },
  { labelKey: "settings.nav.notifications", value: "notifications" },
  { labelKey: "settings.nav.billing", value: "billing" },
];

export function SettingsSectionNav({
  authProvider,
  onSectionChange,
  section,
}: {
  authProvider: "clerk" | "mock";
  onSectionChange: (section: SettingsSection) => void;
  section: SettingsSection;
}) {
  const { t } = useTranslation();

  return (
    <nav className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <UnderlineTabs
        ariaLabel={t("settings.nav.aria")}
        className="min-w-0 flex-1"
        listClassName="gap-[26px]"
        onValueChange={onSectionChange}
        options={settingsNavItems.map((item) => ({
          label: t(item.labelKey),
          value: item.value,
        }))}
        tabClassName="h-[45px] text-[13.5px]"
        value={section}
      />
      {authProvider === "clerk" ? (
        <ClerkSignOutButton label={t("settings.nav.signOut")} />
      ) : (
        <MockSignOutButton label={t("settings.nav.signOut")} />
      )}
    </nav>
  );
}

function ClerkSignOutButton({ label }: { label: string }) {
  const { signOut } = useClerk();

  return (
    <SignOutButton
      label={label}
      onClick={() => {
        void signOut({ redirectUrl: "/login" });
      }}
    />
  );
}

function MockSignOutButton({ label }: { label: string }) {
  const router = useRouter();

  return (
    <SignOutButton
      label={label}
      onClick={() => {
        router.push("/login");
      }}
    />
  );
}

function SignOutButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex h-[37px] w-full cursor-pointer items-center gap-3 rounded-[11px] px-3 text-left text-[13.5px] font-medium text-coral-700 transition hover:bg-coral-50 md:w-auto md:shrink-0"
      onClick={onClick}
      type="button"
    >
      <span className="grid h-5 w-5 place-items-center">
        <LogOut aria-hidden={true} className="h-[17px] w-[17px]" />
      </span>
      <span className="flex-1">{label}</span>
    </button>
  );
}
