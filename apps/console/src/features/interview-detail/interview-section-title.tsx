import { SectionHeading } from "@prelude/ui";

export function InterviewSectionTitle({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <SectionHeading
      className="[&_h2]:text-[17px] [&_p]:leading-5"
      description={description}
      title={title}
    />
  );
}
