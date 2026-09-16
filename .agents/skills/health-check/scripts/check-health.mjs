import { execSync } from "node:child_process";

try {
  execSync("npm test -- tests/health.test.ts", { stdio: "inherit" });
  execSync("npm run build", { stdio: "inherit" });

  console.log("Health check passed.");
  process.exit(0);
} catch {
  console.error("Health check failed.");
  process.exit(1);
}
