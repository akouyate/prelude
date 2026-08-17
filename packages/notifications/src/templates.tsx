import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "react-email";

import type { NotificationLocale } from "./locale";

export function CandidateInterviewCompletedEmail({
  companyName,
  roleTitle,
}: {
  companyName: string;
  roleTitle: string;
}) {
  return (
    <EmailFrame preview={`Your ${roleTitle} interview is complete`}>
      <Heading style={heading}>Your interview is complete</Heading>
      <Text style={paragraph}>
        Thank you for completing the {roleTitle} interview with {companyName}.
      </Text>
      <Text style={paragraph}>
        A recruiter will review the conversation and follow up about next steps.
        HireCall does not make hiring decisions.
      </Text>
    </EmailFrame>
  );
}

// `locale` is accepted so the recipient's resolved locale reaches this
// render call end-to-end; the body still renders the current EN copy — the
// notifications-i18n ticket is the one that does the translation work.
export function RecruiterBriefReadyEmail({
  candidateLabel,
  detailUrl,
  roleTitle,
}: {
  candidateLabel: string;
  detailUrl: string;
  locale: NotificationLocale;
  roleTitle: string;
}) {
  return (
    <EmailFrame preview={`A ${roleTitle} screen is ready for review`}>
      <Heading style={heading}>Screen ready for review</Heading>
      <Text style={paragraph}>
        {candidateLabel} completed the first screen for {roleTitle}. The
        recruiter brief is now ready to review.
      </Text>
      <EmailButton href={detailUrl}>Open candidate</EmailButton>
      <Text style={muted}>
        HireCall supports human review only. Review the evidence before taking
        any next step.
      </Text>
    </EmailFrame>
  );
}

// `locale` is accepted so the recipient's resolved locale reaches this
// render call end-to-end; the body still renders the current EN copy — the
// notifications-i18n ticket is the one that does the translation work.
export function RecruiterBriefNeedsAttentionEmail({
  candidateLabel,
  detailUrl,
  roleTitle,
}: {
  candidateLabel: string;
  detailUrl: string;
  locale: NotificationLocale;
  roleTitle: string;
}) {
  return (
    <EmailFrame preview={`A ${roleTitle} screen needs attention`}>
      <Heading style={heading}>Screen needs attention</Heading>
      <Text style={paragraph}>
        HireCall could not prepare the recruiter brief for {candidateLabel}'s
        {roleTitle} screen. Review the candidate record and retry the brief if
        appropriate.
      </Text>
      <EmailButton href={detailUrl}>Review candidate</EmailButton>
      <Text style={muted}>
        This is an operational prompt for human review, not a hiring
        recommendation.
      </Text>
    </EmailFrame>
  );
}

/**
 * Amendment 16 of the prepaid-credit plan. A chargeback freezes the disputed
 * credits the moment Stripe reports it, and the workspace has to hear it from us
 * — not from a recruiter whose candidate cannot start an interview.
 *
 * Deliberately factual and non-accusatory: at `charge.dispute.created` nobody
 * knows yet whether the dispute is a fraud signal, a bank error or a
 * misremembered line on a statement, and the freeze is reversed in full if it is
 * won.
 *
 * `locale` is accepted so the recipient's resolved locale reaches this
 * render call end-to-end; the body still renders the current EN copy — the
 * notifications-i18n ticket is the one that does the translation work.
 */
export function CreditDisputeFrozenEmail({
  billingUrl,
  frozenCredits,
}: {
  billingUrl: string;
  frozenCredits: number;
  locale: NotificationLocale;
}) {
  return (
    <EmailFrame preview={`${frozenCredits} interview credits are temporarily blocked`}>
      <Heading style={heading}>Your interview credits are on hold</Heading>
      <Text style={paragraph}>
        A bank dispute was opened on one of your credit purchases, so{" "}
        {frozenCredits} interview {frozenCredits === 1 ? "credit is" : "credits are"}{" "}
        temporarily blocked while it is resolved. Interviews already under way are
        not interrupted.
      </Text>
      <Text style={paragraph}>
        If this was not intentional, withdrawing the dispute with your bank is the
        fastest way to unblock them — reply to this email and we will help.
      </Text>
      <EmailButton href={billingUrl}>Open billing settings</EmailButton>
      <Text style={muted}>
        Credits are released in full if the dispute is resolved in your favour.
      </Text>
    </EmailFrame>
  );
}

function EmailFrame({
  children,
  preview,
}: {
  children: React.ReactNode;
  preview: string;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brand}>HireCall</Section>
          {children}
        </Container>
      </Body>
    </Html>
  );
}

function EmailButton({
  children,
  href,
}: {
  children: React.ReactNode;
  href: string;
}) {
  return (
    <Button href={href} style={button}>
      {children}
    </Button>
  );
}

const body = {
  backgroundColor: "#f9f8f3",
  color: "#171715",
  fontFamily: "Arial, Helvetica, sans-serif",
  margin: "0",
  padding: "32px 16px",
};

const container = {
  backgroundColor: "#ffffff",
  border: "1px solid #e7e2d8",
  borderRadius: "18px",
  margin: "0 auto",
  maxWidth: "560px",
  padding: "32px",
};

const brand = {
  color: "#5c7606",
  fontSize: "14px",
  fontWeight: "700",
  letterSpacing: "1.4px",
  marginBottom: "28px",
  textTransform: "uppercase" as const,
};

const heading = {
  color: "#171715",
  fontSize: "28px",
  fontWeight: "600",
  letterSpacing: "0",
  lineHeight: "1.2",
  margin: "0 0 18px",
};

const paragraph = {
  color: "#4f4a42",
  fontSize: "16px",
  lineHeight: "1.6",
  margin: "0 0 16px",
};

const muted = {
  color: "#777166",
  fontSize: "13px",
  lineHeight: "1.55",
  margin: "24px 0 0",
};

const button = {
  backgroundColor: "#171715",
  borderRadius: "999px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "14px",
  fontWeight: "600",
  margin: "8px 0 0",
  padding: "12px 18px",
  textDecoration: "none",
};
