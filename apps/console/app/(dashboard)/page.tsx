import { Button, Card, EmptyState, EnterpriseShell, PageHeader } from "@prelude/ui";
import { Plus } from "lucide-react";

const metrics = [
  { label: "Active jobs", value: "3" },
  { label: "Candidates to review", value: "18" },
  { label: "Average review time", value: "54s" }
];

export default function DashboardPage() {
  return (
    <EnterpriseShell>
      <PageHeader
        title="Recruiter dashboard"
        description="Create short pre-interviews, share a candidate link, and review clear briefs before deciding who to call."
        actions={
          <Button>
            <Plus aria-hidden="true" className="h-4 w-4" />
            New job
          </Button>
        }
      />

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        {metrics.map((metric) => (
          <Card key={metric.label} className="p-5">
            <p className="text-sm text-ink-600">{metric.label}</p>
            <p className="mt-2 text-3xl font-semibold text-ink-900">
              {metric.value}
            </p>
          </Card>
        ))}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <Card className="p-5">
          <h2 className="text-lg font-semibold text-ink-900">Recent candidates</h2>
          <div className="mt-4 divide-y divide-ink-200">
            {["Camille Martin", "Noah Bernard", "Lea Dubois"].map((name) => (
              <div key={name} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-ink-900">{name}</p>
                  <p className="text-sm text-ink-600">Support Manager pre-interview</p>
                </div>
                <span className="rounded-sm bg-meadow-100 px-2 py-1 text-xs font-medium text-meadow-700">
                  To review
                </span>
              </div>
            ))}
          </div>
        </Card>

        <EmptyState
          title="Interview builder placeholder"
          description="The next iteration can turn a job description into three questions and three to five review criteria."
        />
      </section>
    </EnterpriseShell>
  );
}
