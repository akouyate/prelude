import { processNextRoleIntake, reconcileRoleIntakes } from "./role-intake-service";

const idleDelayMs = Number(process.env.ROLE_INTAKE_WORKER_IDLE_DELAY_MS ?? "1500");
const reconciliationIntervalMs = 60_000;
let stopping = false;

process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

async function run(): Promise<void> {
  let nextReconciliationAt = 0;
  while (!stopping) {
    const now = Date.now();
    if (now >= nextReconciliationAt) {
      await reconcileRoleIntakes();
      nextReconciliationAt = now + reconciliationIntervalMs;
    }

    const result = await processNextRoleIntake();
    if (result.kind === "idle") {
      await sleep(Number.isFinite(idleDelayMs) && idleDelayMs > 0 ? idleDelayMs : 1500);
    }
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

run().catch((error: unknown) => {
  console.error("Role intake worker stopped unexpectedly.", error);
  process.exitCode = 1;
});
