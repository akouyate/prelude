"use server";

import { marketingDemoLeadWithdrawalSchema } from "@prelude/contracts";
import { redirect } from "next/navigation";

import { withdrawMarketingDemoLead } from "./marketing-demo-leads";

export async function withdrawMarketingDemoLeadAction(formData: FormData) {
  const parsed = marketingDemoLeadWithdrawalSchema.safeParse({
    token: formData.get("token"),
  });
  if (!parsed.success) {
    redirect("/demo/unsubscribe?status=invalid");
  }

  let status = "withdrawn";
  try {
    await withdrawMarketingDemoLead(parsed.data.token);
  } catch {
    status = "unavailable";
  }
  redirect(`/demo/unsubscribe?status=${status}`);
}
