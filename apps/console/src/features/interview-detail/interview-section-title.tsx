export function InterviewSectionTitle({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div>
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink-950">
        {title}
      </h2>
      <p className="mt-[5px] text-[13.5px] text-[#777166]">{description}</p>
    </div>
  );
}
