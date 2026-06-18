import { Button, Card, Input } from "@prelude/ui";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold text-ink-900">Sign in</h1>
        <form action="/" className="mt-6 space-y-4">
          <Input aria-label="Email" placeholder="you@company.com" type="email" />
          <Button className="w-full" type="submit">
            Continue
          </Button>
        </form>
      </Card>
    </main>
  );
}
