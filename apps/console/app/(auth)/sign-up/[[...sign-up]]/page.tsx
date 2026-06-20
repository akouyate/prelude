import { SignUp } from "@clerk/nextjs";
import { BrandMark, Card } from "@prelude/ui";

import { isClerkConfigured } from "../../../../src/server/auth/clerk-config";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(115deg,#f6f3ec_0%,#fbfaf7_48%,#f1f3e6_100%)] px-4 py-10">
      {isClerkConfigured ? (
        <SignUp />
      ) : (
        <Card className="w-full max-w-md p-6">
          <BrandMark />
          <div className="mt-6 text-sm font-medium text-ink-500">
            Authentication
          </div>
          <h1 className="mt-3 text-xl font-semibold text-ink-900">
            Clerk is not configured
          </h1>
          <p className="mt-3 text-sm leading-6 text-ink-600">
            Add your Clerk keys before using the V1 organization sign-up flow.
          </p>
        </Card>
      )}
    </main>
  );
}
