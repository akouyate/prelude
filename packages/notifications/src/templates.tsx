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
        Prelude does not make hiring decisions.
      </Text>
    </EmailFrame>
  );
}

export function RecruiterBriefReadyEmail({
  candidateLabel,
  detailUrl,
  roleTitle,
}: {
  candidateLabel: string;
  detailUrl: string;
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
        Prelude supports human review only. Review the evidence before taking
        any next step.
      </Text>
    </EmailFrame>
  );
}

export function RecruiterBriefNeedsAttentionEmail({
  candidateLabel,
  detailUrl,
  roleTitle,
}: {
  candidateLabel: string;
  detailUrl: string;
  roleTitle: string;
}) {
  return (
    <EmailFrame preview={`A ${roleTitle} screen needs attention`}>
      <Heading style={heading}>Screen needs attention</Heading>
      <Text style={paragraph}>
        Prelude could not prepare the recruiter brief for {candidateLabel}'s
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
          <Section style={brand}>Prelude.ai</Section>
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
