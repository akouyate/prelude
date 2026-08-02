export const roleIntakeUrlBrands = [
  "linkedin",
  "indeed",
  "greenhouse",
] as const;

export type RoleIntakeUrlBrand = (typeof roleIntakeUrlBrands)[number];

const indeedDomains = [
  "indeed.com",
  "indeed.co.uk",
  "indeed.ca",
  "indeed.com.au",
  "indeed.co.nz",
  "indeed.fr",
  "indeed.de",
  "indeed.es",
  "indeed.it",
  "indeed.nl",
  "indeed.be",
  "indeed.ch",
  "indeed.ie",
  "indeed.in",
  "indeed.co.jp",
  "indeed.com.br",
  "indeed.com.mx",
  "indeed.co.za",
] as const;

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
  if (indeedDomains.some((domain) => matchesDomain(hostname, domain))) {
    return "indeed";
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
