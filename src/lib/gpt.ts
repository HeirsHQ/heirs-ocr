import OpenAI from "openai";

import { env } from "../common/env";

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

export interface GPTExtractionResult<T> {
  success: boolean;
  data: T | null;
  error?: string;
}

export async function gptExtract<T>(systemPrompt: string, userMessage: string): Promise<GPTExtractionResult<T>> {
  if (env.GPT_ENABLED === "false") {
    return { success: false, data: null, error: "GPT is disabled" };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: env.GPT_MODEL ?? "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return { success: false, data: null, error: "No content in GPT response" };
    }

    let jsonString = content.trim();
    const jsonMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      jsonString = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonString) as T;
    return { success: true, data: parsed };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[GPT] Extraction failed: ${message}`);
    return { success: false, data: null, error: message };
  }
}
