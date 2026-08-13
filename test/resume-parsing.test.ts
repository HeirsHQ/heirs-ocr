import { describe, expect, it } from "vitest";

import { PNG_1x1, deps, fakeProvider, mockLlm, request, runPipeline } from "./support";
import { resumeParsing } from "../src/functions/resume-parsing";
import type { ResumeParsingResult } from "../src/functions/resume-parsing";

const resume = (over: Partial<ResumeParsingResult>): ResumeParsingResult => ({
  contact: {
    name: "Ada Obi",
    email: null,
    phone: null,
    location: null,
    address: null,
    state: null,
    country: null,
    zip: null,
    nationality: null,
    links: [],
  },
  summary: null,
  experience: [],
  education: [],
  certifications: [],
  professionalBodies: [],
  languages: [],
  skills: [],
  ...over,
});

describe("RESUME_PARSING — structured résumé", () => {
  it("returns the parsed contact and sections", async () => {
    const llm = mockLlm([
      ["RESUME_PARSING_result", resume({ skills: [{ name: "TypeScript", level: null }], summary: "Engineer" })],
    ]);
    const { result } = await runPipeline(
      resumeParsing,
      request(PNG_1x1, {}, "x.png"),
      deps({ llm, providers: [fakeProvider("Ada Obi — Software Engineer")] }),
    );
    const data = result as ResumeParsingResult;
    expect(data.contact.name).toBe("Ada Obi");
    expect(data.summary).toBe("Engineer");
    expect(data.skills[0]?.name).toBe("TypeScript");
  });
});
