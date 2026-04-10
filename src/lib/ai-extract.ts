import { claudeExtract } from "./claude";
import { gptExtract } from "./gpt";
import { env } from "../common/env";

export interface AIExtractionResult<T> {
  success: boolean;
  data: T | null;
  error?: string;
  method?: "claude" | "gpt";
}

export async function aiExtract<T>(systemPrompt: string, userMessage: string): Promise<AIExtractionResult<T>> {
  if (env.CLAUDE_ENABLED === "true") {
    const result = await claudeExtract<T>(systemPrompt, userMessage);
    if (result.success) {
      return { ...result, method: "claude" };
    }
  }

  if (env.GPT_ENABLED === "true") {
    const result = await gptExtract<T>(systemPrompt, userMessage);
    if (result.success) {
      return { ...result, method: "gpt" };
    }
  }

  return { success: false, data: null, error: "All AI extraction methods failed or are disabled" };
}
