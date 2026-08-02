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
  size = "default",
}: {
  brand: IntegrationBrand;
  className?: string;
  muted?: boolean;
  size?: "compact" | "default";
}) {
  const metadata = integrationBrandMetadata[brand];
  const imageSize = size === "compact" ? 20 : 26;

  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center border border-[#ece8de] bg-white",
        size === "compact"
          ? "h-9 w-9 rounded-[11px]"
          : "h-[42px] w-[42px] rounded-[12px]",
        muted && "grayscale opacity-55",
        className,
      )}
    >
      <Image
        alt=""
        aria-hidden={true}
        height={imageSize}
        src={metadata.src}
        title={metadata.label}
        width={imageSize}
      />
    </span>
  );
}
