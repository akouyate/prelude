"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createGoogleCalendarAuthorizationUrl,
  disconnectGoogleCalendarAccount,
} from "./connected-account-service";

export async function connectGoogleCalendarAction() {
  const result = await createGoogleCalendarAuthorizationUrl();

  if (result.ok) {
    redirect(result.url);
  }

  redirect(integrationReturnUrl(result.reason));
}

export async function disconnectGoogleCalendarAction() {
  const result = await disconnectGoogleCalendarAccount();
  revalidatePath("/settings");

  redirect(integrationReturnUrl(result.status));
}

function integrationReturnUrl(status: string) {
  return `/settings?view=integrations&provider=google_calendar&status=${encodeURIComponent(
    status,
  )}`;
}
