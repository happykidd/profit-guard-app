import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
export const workspaceEnvPath = resolve(currentDir, "../../../../.env");

let loaded = false;

export function loadWorkspaceEnv() {
  if (!loaded) {
    dotenv.config({ path: workspaceEnvPath });
    loaded = true;
  }

  return workspaceEnvPath;
}
