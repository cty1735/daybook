import { defineConfig } from "drizzle-kit";
import { env } from "./src/env.ts";

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/db/schema.ts", "./src/db/auth-schema.ts"],
  out: "./drizzle",
  dbCredentials: {
    url: env.databaseUrl,
  },
  verbose: true,
  strict: false,
});
