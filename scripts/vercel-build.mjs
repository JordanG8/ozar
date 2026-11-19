import { execFileSync } from "node:child_process";

if (process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED) {
  execFileSync(process.execPath, ["./node_modules/drizzle-kit/bin.cjs", "migrate"], {
    stdio: "inherit",
  });
} else {
  console.warn("Phase 0: skipping the database migration until Neon is connected.");
}

execFileSync(process.execPath, ["./node_modules/next/dist/bin/next", "build"], {
  stdio: "inherit",
});
