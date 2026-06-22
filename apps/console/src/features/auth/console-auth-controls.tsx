"use client";

import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import { useTranslation } from "react-i18next";
import { Button } from "@prelude/ui";

type ConsoleAuthControlsProps = {
  enabled: boolean;
};

export function ConsoleAuthControls({ enabled }: ConsoleAuthControlsProps) {
  const { t } = useTranslation();

  if (!enabled) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <Button className="h-8 px-3" variant="secondary">
            {t("auth.signIn")}
          </Button>
        </SignInButton>
        <SignUpButton mode="modal">
          <Button className="h-8 px-3">{t("auth.signUp")}</Button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </div>
  );
}
