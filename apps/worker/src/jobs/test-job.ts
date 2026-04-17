export async function runTestJob() {
  console.info("[worker] Running test job");

  await Promise.resolve();

  console.info("[worker] Test job completed");
}
