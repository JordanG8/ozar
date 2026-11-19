import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

if (process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED) {
  execFileSync(process.execPath, ["./node_modules/drizzle-kit/bin.cjs", "migrate"], {
    stdio: "inherit",
  });
  if (existsSync(new URL("../data/builtin-words.json", import.meta.url))) {
    execFileSync(process.execPath, ["scripts/seed-builtin.mjs"], { stdio: "inherit" });
  }
} else {
  console.warn("Phase 0: skipping the database migration until Neon is connected.");
}

execFileSync(process.execPath, ["./node_modules/next/dist/bin/next", "build"], {
  stdio: "inherit",
});
