const requiredEnvs = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_ENABLED",
  "CLAUDE_MODEL",
  "GPT_ENABLED",
  "GPT_MODEL",
  "NODE_ENV",
  "OPENAI_API_KEY",
  "PORT",
  "VERSION",
] as const;

export type RequiredEnvs = (typeof requiredEnvs)[number];

declare global {
  namespace NodeJS {
    interface ProcessEnv extends Record<RequiredEnvs, string | number> {
      readonly ANTHROPIC_API_KEY: string;
      readonly CLAUDE_ENABLED: string;
      readonly CLAUDE_MODEL: string;
      readonly GPT_ENABLED: string;
      readonly GPT_MODEL: string;
      readonly NODE_ENV: "development" | "production" | "test";
      readonly OPENAI_API_KEY: string;
      readonly PORT: string;
      readonly VERSION: string;
    }
  }
}

export {};
