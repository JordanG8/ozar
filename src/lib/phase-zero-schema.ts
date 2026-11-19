import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const deploymentProbe = pgTable("deployment_probe", {
  id: text("id").primaryKey(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
});
