"use client";

import * as React from "react";

export function MarketingDemoUrlCleaner() {
  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("handoff")) {
      return;
    }
    url.searchParams.delete("handoff");
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);

  return null;
}
