import Image from "next/image";

import { cn } from "@prelude/ui";

export const integrationBrands = [
  "gmail",
  "google-calendar",
  "greenhouse",
  "indeed",
  "linkedin",
  "microsoft-teams",
] as const;

export type IntegrationBrand = (typeof integrationBrands)[number];

const integrationBrandMetadata: Record<
  IntegrationBrand,
  { label: string; src: string }
> = {
  gmail: {
    label: "Gmail",
    src: "/integrations/gmail.svg",
  },
  "google-calendar": {
    label: "Google Calendar",
    src: "/integrations/google-calendar.svg",
  },
  greenhouse: {
    label: "Greenhouse",
    src: "/integrations/greenhouse.svg",
  },
  indeed: {
    label: "Indeed",
    src: "/integrations/indeed.svg",
  },
  linkedin: {
    label: "LinkedIn",
    src: "/integrations/linkedin.svg",
  },
  "microsoft-teams": {
    label: "Microsoft Teams",
    src: "/integrations/microsoft-teams.svg",
  },
};

export function IntegrationLogo({
  brand,
  className,
  muted = false,
}: {
  brand: IntegrationBrand;
  className?: string;
  muted?: boolean;
}) {
  const metadata = integrationBrandMetadata[brand];

  return (
    <span
      className={cn(
        "grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[12px] border border-[#ece8de] bg-white",
        muted && "grayscale opacity-55",
        className,
      )}
    >
      <Image
        alt=""
        aria-hidden={true}
        height={26}
        src={metadata.src}
        title={metadata.label}
        width={26}
      />
    </span>
  );
}
