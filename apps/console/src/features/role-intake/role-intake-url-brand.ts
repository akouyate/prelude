// The subset of supported sources HireCall has a brand asset for; the full list
// is named in the `roleIntake.source.urlSupportedSources` copy. Which links are
// actually refused is decided server-side by the intake policy, so nothing here
// grants or denies support — showing a logo only claims one.
export const roleIntakeUrlBrands = ["linkedin", "greenhouse"] as const;

export type RoleIntakeUrlBrand = (typeof roleIntakeUrlBrands)[number];

export function detectRoleIntakeUrlBrand(
  source: string,
): RoleIntakeUrlBrand | null {
  const hostname = parseHostname(source);
  if (!hostname) {
    return null;
  }

  if (matchesDomain(hostname, "linkedin.com")) {
    return "linkedin";
  }
  if (matchesDomain(hostname, "greenhouse.io")) {
    return "greenhouse";
  }
  return null;
}

function parseHostname(source: string): string | null {
  const value = source.trim().toLowerCase();
  if (!value) {
    return null;
  }

  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return null;
  }
}

function matchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}
