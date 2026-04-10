const requiredEnvs = [
  "ANTHROPIC_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_DEPLOYMENT_NAME",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_VERSION",
  "CLAUDE_ENABLED",
  "CLAUDE_MODEL",
  "GPT_ENABLED",
  "GPT_MODEL",
  "NODE_ENV",
  "PORT",
  "VERSION",
] as const;

export type RequiredEnvs = (typeof requiredEnvs)[number];

declare global {
  namespace NodeJS {
    interface ProcessEnv extends Record<RequiredEnvs, string | number> {
      readonly ANTHROPIC_API_KEY: string;
      readonly AZURE_OPENAI_API_KEY: string;
      readonly AZURE_OPENAI_DEPLOYMENT_NAME: string;
      readonly AZURE_OPENAI_ENDPOINT: string;
      readonly AZURE_OPENAI_API_VERSION: string;
      readonly CLAUDE_ENABLED: string;
      readonly CLAUDE_MODEL: string;
      readonly GPT_ENABLED: string;
      readonly GPT_MODEL: string;
      readonly NODE_ENV: "development" | "production" | "test";
      readonly PORT: string;
      readonly VERSION: string;
    }
  }
}

export {};
