import { checkDatabaseConnection } from "../../../../packages/db/src/client";
import { runTestJob } from "../jobs/test-job";
import { loadWorkspaceEnv } from "./workspace-env";

loadWorkspaceEnv();

export type BootstrapWorkerResult = {
  databaseReady: boolean;
};

export async function bootstrapWorker() {
  console.info("[worker] Profit Guard worker booting");
  let databaseReady = false;

  if (process.env.DATABASE_URL) {
    try {
      await checkDatabaseConnection();
      databaseReady = true;
      console.info("[worker] Database connection OK");
    } catch (error) {
      if (process.env.REQUIRE_DATABASE === "true") {
        throw error;
      }

      console.warn(
        "[worker] Database connection failed, continuing in degraded mode",
        error,
      );
    }
  } else {
    console.info("[worker] DATABASE_URL not set, skipping database connection check");
  }

  if (process.env.RUN_TEST_JOB === "true") {
    await runTestJob();
  }

  console.info("[worker] Ready");

  return {
    databaseReady,
  } satisfies BootstrapWorkerResult;
}
