"use client";

import type { ReactNode } from "react";
import {
  Bell,
  Building,
  Community,
  CreditCard,
  LogOut,
  Microphone,
  Usb,
  User,
} from "iconoir-react";
import { useTranslation } from "react-i18next";
import { cn } from "@prelude/ui";

import type { SettingsSection } from "./settings-types";

const settingsNavItems: Array<{
  icon: ReactNode;
  labelKey: string;
  value: SettingsSection;
}> = [
  { icon: <User aria-hidden={true} className="h-[17px] w-[17px]" />, labelKey: "settings.nav.profile", value: "profile" },
  { icon: <Building aria-hidden={true} className="h-[17px] w-[17px]" />, labelKey: "settings.nav.workspace", value: "workspace" },
  { icon: <Community aria-hidden={true} className="h-[17px] w-[17px]" />, labelKey: "settings.nav.team", value: "team" },
  { icon: <Microphone aria-hidden={true} className="h-[17px] w-[17px]" />, labelKey: "settings.nav.interview", value: "interview" },
  { icon: <Usb aria-hidden={true} className="h-[17px] w-[17px]" />, labelKey: "settings.nav.integrations", value: "integrations" },
  { icon: <Bell aria-hidden={true} className="h-[17px] w-[17px]" />, labelKey: "settings.nav.notifications", value: "notifications" },
  { icon: <CreditCard aria-hidden={true} className="h-[17px] w-[17px]" />, labelKey: "settings.nav.billing", value: "billing" },
];

export function SettingsSectionNav({
  onSectionChange,
  section,
}: {
  onSectionChange: (section: SettingsSection) => void;
  section: SettingsSection;
}) {
  const { t } = useTranslation();

  return (
    <nav className="sticky top-6 hidden flex-col gap-px lg:flex">
      {settingsNavItems.map((item) => {
        const active = section === item.value;

        return (
          <button
            className={cn(
              "flex h-[37px] w-full cursor-pointer items-center gap-3 rounded-[11px] px-3 text-left text-[13.5px] transition",
              active
                ? "bg-[#eef0e3] font-semibold text-olive-900"
                : "bg-transparent font-medium text-ink-600 hover:bg-white/60 hover:text-ink-950",
            )}
            key={item.value}
            onClick={() => onSectionChange(item.value)}
            type="button"
          >
            <span
              className={cn(
                "grid h-5 w-5 place-items-center",
                active ? "text-olive-800" : "text-ink-400",
              )}
            >
              {item.icon}
            </span>
            <span className="flex-1">{t(item.labelKey)}</span>
          </button>
        );
      })}
      <div className="mx-1 my-2.5 h-px bg-[#ece8de]" />
      <button
        className="flex h-[37px] w-full cursor-pointer items-center gap-3 rounded-[11px] px-3 text-left text-[13.5px] font-medium text-coral-700 transition hover:bg-coral-50"
        type="button"
      >
        <span className="grid h-5 w-5 place-items-center">
          <LogOut aria-hidden={true} className="h-[17px] w-[17px]" />
        </span>
        <span className="flex-1">{t("settings.nav.signOut")}</span>
      </button>
    </nav>
  );
}
