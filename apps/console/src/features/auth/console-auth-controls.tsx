"use client";

import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import { Button } from "@prelude/ui";

type ConsoleAuthControlsProps = {
  enabled: boolean;
};

export function ConsoleAuthControls({ enabled }: ConsoleAuthControlsProps) {
  if (!enabled) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <Button className="h-8 px-3" variant="secondary">
            Sign in
          </Button>
        </SignInButton>
        <SignUpButton mode="modal">
          <Button className="h-8 px-3">Sign up</Button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </div>
  );
}
