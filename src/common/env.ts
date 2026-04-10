import { z } from "zod";

const schema = z
  .object({
    ANTHROPIC_API_KEY: z.string().optional(),
    CLAUDE_ENABLED: z.enum(["true", "false"]).optional().default("false"),
    CLAUDE_MODEL: z.string().optional().default("claude-haiku-4-5-20251001"),
    GPT_ENABLED: z.enum(["true", "false"]).optional().default("false"),
    GPT_MODEL: z.string().optional().default("gpt-4o-mini"),
    NODE_ENV: z.enum(["development", "production", "test"], "NODE_ENV must be one of: development, production, test"),
    OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
    PORT: z.string().optional().default("8080"),
    VERSION: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.CLAUDE_ENABLED === "true" && !data.ANTHROPIC_API_KEY) {
        return false;
      }
      return true;
    },
    {
      message: "ANTHROPIC_API_KEY is required when CLAUDE_ENABLED is true",
      path: ["ANTHROPIC_API_KEY"],
    },
  )
  .refine(
    (data) => {
      if (data.GPT_ENABLED === "true" && !data.OPENAI_API_KEY) {
        return false;
      }
      return true;
    },
    {
      message: "OPENAI_API_KEY is required when GPT_ENABLED is true",
      path: ["OPENAI_API_KEY"],
    },
  );

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables. Check your .env configuration.");
}

export const env = {
  ...parsed.data,
};
