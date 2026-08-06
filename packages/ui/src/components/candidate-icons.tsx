import * as React from "react";

/*
 * The candidate experience uses its own hairline icon set rather than the
 * console's iconoir glyphs: the screens are typographic and the icons have to
 * sit at the same optical weight as EB Garamond and Geist Mono. Every glyph is
 * a 24x24 stroked path drawn to the candidate design spec.
 */

export type CandidateIconProps = Omit<
  React.SVGProps<SVGSVGElement>,
  "viewBox" | "fill" | "children"
> & {
  strokeWidth?: number;
};

function CandidateIcon({
  children,
  strokeWidth = 1.7,
  ...props
}: CandidateIconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ShieldCheckIcon(props: CandidateIconProps) {
  return (
    <CandidateIcon {...props}>
      <path d="M12 3l7 3v5c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </CandidateIcon>
  );
}

export function MicIcon(props: CandidateIconProps) {
  return (
    <CandidateIcon {...props}>
      <rect height="11" rx="3" width="6" x="9" y="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </CandidateIcon>
  );
}

export function ClockIcon(props: CandidateIconProps) {
  return (
    <CandidateIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </CandidateIcon>
  );
}

export function TranscriptIcon(props: CandidateIconProps) {
  return (
    <CandidateIcon {...props}>
      <path d="M4 7h16M4 12h16M4 17h10" />
    </CandidateIcon>
  );
}

export function CheckIcon({ strokeWidth = 2, ...props }: CandidateIconProps) {
  return (
    <CandidateIcon strokeWidth={strokeWidth} {...props}>
      <path d="M5 12.5l4 4 10-10" />
    </CandidateIcon>
  );
}

export function ArrowLeftIcon({
  strokeWidth = 1.9,
  ...props
}: CandidateIconProps) {
  return (
    <CandidateIcon strokeWidth={strokeWidth} {...props}>
      <path d="M19 12H6" />
      <path d="m12 6-6 6 6 6" />
    </CandidateIcon>
  );
}

export function MailIcon(props: CandidateIconProps) {
  return (
    <CandidateIcon {...props}>
      <rect height="14" rx="3" width="18" x="3" y="5" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </CandidateIcon>
  );
}

export function PencilIcon({
  strokeWidth = 1.8,
  ...props
}: CandidateIconProps) {
  return (
    <CandidateIcon strokeWidth={strokeWidth} {...props}>
      <path d="M4 20h4l10-10-4-4L4 16z" />
      <path d="m14.5 5.5 4 4" />
    </CandidateIcon>
  );
}

export function HangUpIcon({ strokeWidth = 1.9, ...props }: CandidateIconProps) {
  return (
    <CandidateIcon strokeWidth={strokeWidth} {...props}>
      <path d="M3 6.5c5.5-3 12-3 18 0v3.2c0 .9-.6 1.6-1.5 1.7l-2.8.4c-.8.1-1.6-.4-1.8-1.2l-.5-2c-2.7-.9-5.5-.9-8.2 0l-.5 2c-.2.8-1 1.3-1.8 1.2l-2.8-.4C2.6 11.3 2 10.6 2 9.7z" />
      <path d="M18 6L6 18" />
    </CandidateIcon>
  );
}

export function SkipForwardIcon({
  strokeWidth = 1.9,
  ...props
}: CandidateIconProps) {
  return (
    <CandidateIcon strokeWidth={strokeWidth} {...props}>
      <path d="m5 5 9 7-9 7z" />
      <path d="M19 5v14" />
    </CandidateIcon>
  );
}

export function RestartIcon({
  strokeWidth = 1.9,
  ...props
}: CandidateIconProps) {
  return (
    <CandidateIcon strokeWidth={strokeWidth} {...props}>
      <path d="M20 11a8 8 0 1 0-2.3 6.2" />
      <path d="M20 5v6h-6" />
    </CandidateIcon>
  );
}

export function AlertIcon({ strokeWidth = 1.8, ...props }: CandidateIconProps) {
  return (
    <CandidateIcon strokeWidth={strokeWidth} {...props}>
      <path d="M12 3l9 16H3z" />
      <path d="M12 10v4" />
      <path d="M12 17.5v.01" />
    </CandidateIcon>
  );
}
