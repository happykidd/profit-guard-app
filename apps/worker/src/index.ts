import { isEmailDeliveryReady } from "../../web/app/services/email-delivery.server";
import prisma from "../../../packages/db/src/client";
import { bootstrapWorker } from "./services/bootstrap";
import { getDigestDispatchConfig } from "./services/digest-dispatch";
import { runSyncLoop } from "./services/sync-runner";

const keepAliveIntervalMs = 60_000;

async function shutdown(signal: string) {
  console.info(`[worker] Shutting down on ${signal}`);
  await prisma.$disconnect();
  process.exit(0);
}

async function main() {
  const { databaseReady } = await bootstrapWorker();
  const digestConfig = getDigestDispatchConfig();

  console.info("[worker] Digest delivery readiness", {
    emailProviderReady: isEmailDeliveryReady(),
    schedulerEnabled: digestConfig.schedulerEnabled,
  });

  if (databaseReady) {
    await runSyncLoop();
    return;
  }

  console.info("[worker] Idle loop started (database unavailable)");
  setInterval(() => {
    console.debug("[worker] heartbeat");
  }, keepAliveIntervalMs);
}

main().catch(async (error) => {
  console.error("[worker] Fatal startup error", error);
  await prisma.$disconnect();
  process.exit(1);
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
