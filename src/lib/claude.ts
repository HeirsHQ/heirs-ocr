import Anthropic from "@anthropic-ai/sdk";

import { env } from "../common/env";

const client = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

export interface ClaudeExtractionResult<T> {
  success: boolean;
  data: T | null;
  error?: string;
}

export async function claudeExtract<T>(systemPrompt: string, userMessage: string): Promise<ClaudeExtractionResult<T>> {
  if (env.CLAUDE_ENABLED === "false") {
    return { success: false, data: null, error: "Claude is disabled" };
  }

  try {
    const response = await client.messages.create({
      model: env.CLAUDE_MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { success: false, data: null, error: "No text content in Claude response" };
    }

    let jsonString = textBlock.text.trim();
    const jsonMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      jsonString = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonString) as T;
    return { success: true, data: parsed };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Claude] Extraction failed: ${message}`);
    return { success: false, data: null, error: message };
  }
}
