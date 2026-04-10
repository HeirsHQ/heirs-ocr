import { OcrFunctionName, OcrRequestPayload, OcrResultData } from "../types/ocr.types";
import { env } from "../common/env";

// Validate environment before registering any strategies
const errors: string[] = [];

if (env.CLAUDE_ENABLED === "true" && !env.ANTHROPIC_API_KEY) {
  errors.push("ANTHROPIC_API_KEY is required when CLAUDE_ENABLED is true");
}

if (
  env.GPT_ENABLED === "true" &&
  (!env.AZURE_OPENAI_API_KEY ||
    !env.AZURE_OPENAI_API_VERSION ||
    !env.AZURE_OPENAI_DEPLOYMENT_NAME ||
    !env.AZURE_OPENAI_ENDPOINT)
) {
  errors.push(
    "AZURE_OPENAI_API_KEY, AZURE_OPENAI_API_VERSION, AZURE_OPENAI_DEPLOYMENT_NAME, and AZURE_OPENAI_ENDPOINT are required when GPT_ENABLED is true",
  );
}

if (env.CLAUDE_ENABLED === "false" && env.GPT_ENABLED === "false") {
  errors.push("At least one AI provider must be enabled (CLAUDE_ENABLED or GPT_ENABLED)");
}

if (errors.length > 0) {
  console.error("❌ Invalid environment configuration:");
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}

export interface OcrStrategy {
  readonly functionName: OcrFunctionName;
  validate(payload: OcrRequestPayload): string[];
  execute(fileBuffer: Buffer, payload: OcrRequestPayload): Promise<OcrResultData>;
}

const strategyRegistry = new Map<OcrFunctionName, OcrStrategy>();

export function registerStrategy(strategy: OcrStrategy): void {
  strategyRegistry.set(strategy.functionName, strategy);
}

export function getStrategy(functionName: OcrFunctionName): OcrStrategy | undefined {
  return strategyRegistry.get(functionName);
}

export function getRegisteredFunctions(): OcrFunctionName[] {
  return Array.from(strategyRegistry.keys());
}

// Auto-register all strategies
import "./signing.strategy";
import "./id-verification.strategy";
import "./document-classification.strategy";
import "./form-data-extraction.strategy";
import "./receipt-parsing.strategy";
import "./text-extraction.strategy";
