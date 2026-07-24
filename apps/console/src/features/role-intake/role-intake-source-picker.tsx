import Link from "next/link";
import { Attachment, EditPencil, Link as LinkIcon } from "iconoir-react";

import { cn } from "@prelude/ui";

export function RoleIntakeSourcePicker({
  importEnabled,
}: {
  importEnabled: boolean;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-6 py-20 sm:px-10">
      <section className="w-full">
        <p className="text-sm font-medium text-ink-500">New role</p>
        <h1 className="mt-3 max-w-xl font-display text-4xl font-medium tracking-normal text-ink-950 sm:text-5xl">
          Where should Prelude start?
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-ink-600">
          Add a role brief yourself, or securely extract one from a PDF or DOCX.
        </p>

        <div className="mt-10 grid max-w-3xl gap-4 sm:grid-cols-2">
          <SourceLink
            description="Enter the role details yourself."
            href="/roles/new?source=manual"
            icon={<EditPencil className="h-6 w-6" />}
            title="Start manually"
          />
          {importEnabled ? (
            <>
              <SourceLink
                description="Import one public job page, then review every field."
                href="/roles/new?source=url"
                icon={<LinkIcon className="h-6 w-6" />}
                title="Import a public URL"
              />
              <SourceLink
                description="Securely extract a PDF or DOCX, then review every field."
                href="/roles/new?source=upload"
                icon={<Attachment className="h-6 w-6" />}
                title="Import a role brief"
              />
            </>
          ) : (
            <div
              aria-disabled="true"
              className="relative flex min-h-56 cursor-not-allowed flex-col rounded-3xl border border-ink-200 bg-white/45 p-6 opacity-70"
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl border border-ink-200 bg-[#f7f6f1] text-ink-700">
                <Attachment aria-hidden="true" className="h-6 w-6" />
              </span>
              <h2 className="mt-auto text-xl font-semibold text-ink-900">Import a role source</h2>
              <p className="mt-2 text-sm leading-6 text-ink-600">
                Public URL and PDF/DOCX import will be available when role intake is configured.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function SourceLink({
  description,
  href,
  icon,
  title,
}: {
  description: string;
  href: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <Link
      className={cn(
        "group relative flex min-h-56 cursor-pointer flex-col rounded-3xl border border-ink-200 bg-white/82 p-6 transition",
        "hover:border-ink-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300",
      )}
      href={href}
    >
      <span className="grid h-12 w-12 place-items-center rounded-2xl border border-ink-200 bg-[#f7f6f1] text-ink-900 transition group-hover:border-olive-200 group-hover:bg-[#f2f4e9]">
        {icon}
      </span>
      <h2 className="mt-auto text-xl font-semibold text-ink-900">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-ink-600">{description}</p>
    </Link>
  );
}
