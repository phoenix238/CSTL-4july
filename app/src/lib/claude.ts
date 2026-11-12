import { z } from "zod";
import { HIGHLIGHT_RUBRIC } from "./cleanLanguage";
import { getSettings } from "./db";
import { getAIModelOption } from "./aiModels";

const MODEL_SONNET = "claude-sonnet-5";
const MODEL_HAIKU = "claude-haiku-4-5-20251001";
const MODEL_GPT_CAPABLE = "gpt-6.1-sol";
const MODEL_GPT_FAST = "gpt-6-luna";
type ModelTier = "fast" | "capable";

class ProviderHttpError extends Error {
  constructor(provider: string, readonly status: number) {
    // Provider error bodies can echo the prompt.
    super(`${provider} request failed (${status})`);
  }
}

async function chatAnthropic(system: string, user: string, maxTokens: number, tier: ModelTier): Promise<string> {
  const model = tier === "fast" ? MODEL_HAIKU : MODEL_SONNET;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      // Sonnet 5 thinks by default: that spends these small max_tokens budgets
      // before any answer is written, and puts a thinking block (not the
      // answer) first in `content`. These are short extraction jobs — no
      // thinking needed. Haiku 4.5 doesn't think unless asked.
      ...(model === MODEL_SONNET ? { thinking: { type: "disabled" } } : {}),
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new ProviderHttpError("Anthropic", res.status);
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    stop_reason?: string;
  };
  if (data.stop_reason === "refusal") throw new Error("Claude declined to process this text");
  return (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

async function chatOpenAI(system: string, user: string, maxTokens: number, tier: ModelTier): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Configure OPENAI_API_KEY to use a GPT model");
  const capable = tier === "capable";
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: capable ? MODEL_GPT_CAPABLE : MODEL_GPT_FAST,
      instructions: system,
      input: user,
      reasoning: { effort: capable ? "low" : "none" },
      // The output limit also covers reasoning tokens.
      max_output_tokens: maxTokens + (capable ? 1024 : 0),
      store: false,
    }),
  });
  if (!res.ok) throw new ProviderHttpError("OpenAI", res.status);
  const data = (await res.json()) as {
    status?: string;
    output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
  };
  const blocks = (data.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? []);
  if (blocks.some((block) => block.type === "refusal")) {
    throw new Error("The GPT model declined to process this text");
  }
  const answer = blocks.filter((block) => block.type === "output_text").map((block) => block.text ?? "").join("");
  if (data.status !== "completed" || !answer.trim()) {
    throw new Error("The GPT model didn't return a complete answer — please try again");
  }
  return answer;
}

async function chat(system: string, user: string, maxTokens: number, autoTier: ModelTier = "capable"): Promise<string> {
  const { aiModel } = await getSettings();
  const model = getAIModelOption(aiModel);
  if (model?.provider !== "openai") {
    return chatAnthropic(system, user, maxTokens, aiModel === "haiku" ? "fast" : "capable");
  }
  const tier = aiModel === "openai-auto" ? autoTier : aiModel === "openai-fast" ? "fast" : "capable";
  try {
    return await chatOpenAI(system, user, maxTokens, tier);
  } catch (error) {
    if (
      process.env.AI_FALLBACK_TO_ANTHROPIC !== "true" ||
      !process.env.ANTHROPIC_API_KEY?.trim() ||
      !(error instanceof ProviderHttpError) ||
      (error.status !== 429 && error.status < 500)
    ) {
      throw error;
    }
    return chatAnthropic(system, user, maxTokens, tier);
  }
}

/** Pull the JSON object/array out of the model's reply. */
function parseJsonFrom(text: string, open: "{" | "["): unknown {
  const close = open === "{" ? "}" : "]";
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start !== -1 && end >= start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // Avoid exposing an excerpt of the model response in the JSON error.
    }
  }
  throw new Error("The AI model didn't return a usable answer — please try again");
}

const enquirySchema = z.object({
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  via: z.enum(["WHATSAPP", "EMAIL", "PASTED"]).catch("PASTED"),
  clinicSuggestion: z.enum(["waterloo", "bethnal"]).nullable(),
  clinicReason: z.string(),
  requestedWhen: z.string(),
});

export type EnquiryAnalysis = z.infer<typeof enquirySchema>;

/**
 * Read a pasted WhatsApp/email enquiry: pull out the sender's name and contact
 * details, suggest a clinic (Waterloo, south/central vs Bethnal Green, east
 * London), and capture when they asked to come in. A suggestion only — the UI
 * always offers a one-tap override.
 */
export async function analyseEnquiry(message: string): Promise<EnquiryAnalysis> {
  const text = await chat(
    `You read new-client enquiries for Phoenix Tanner, a craniosacral therapist with two London clinics:
- Waterloo (south/central: Waterloo, South Bank, Southwark, Kennington, Lambeth)
- Bethnal Green (east: Bethnal Green, Victoria Park, Hackney, Mile End, "out east")

Extract from the message and reply with ONLY a JSON object, no other text:
{
  "name": "sender's name, or empty string if not stated",
  "phone": "phone number as written, or empty string",
  "email": "email address, or empty string",
  "via": "WHATSAPP" when it reads like a WhatsApp/text message (informal, emoji, timestamps), "EMAIL" when it has a subject/signature/quoted thread, otherwise "PASTED",
  "clinicSuggestion": "waterloo" | "bethnal" | null (null when the message gives no location clue),
  "clinicReason": "short human explanation like 'Bethnal Green — the message mentions Victoria Park', or empty string",
  "requestedWhen": "when they asked to come, in their words, e.g. 'Tuesday or Wednesday, after 5' — empty string if not stated"
}`,
    message,
    500,
    "fast",
  );
  const json = parseJsonFrom(text, "{");
  return enquirySchema.parse(json);
}

/**
 * Tighten a raw (often dictated) personal reflection into readable prose for
 * the Doc — first person, Phoenix's own words, not turned into clinical
 * bullets like a session note. Just the rambling, false starts and filler cut.
 */
export async function summariseReflection(raw: string): Promise<string> {
  const text = await chat(
    `You clean up a craniosacral therapist's own private, often-dictated reflection for his personal notes doc. Keep his voice and first person — cut filler, false starts and repetition, tighten rambling into clear prose, but never add ideas or turn it into clinical/bulleted language. Reply with ONLY the cleaned reflection text, no preamble, no quotes around it.`,
    raw,
    600,
    "fast",
  );
  return text.trim();
}

/** Turn a raw (often dictated) session note into short bullet points for the Doc. */
export async function summariseNote(raw: string): Promise<string[]> {
  const text = await chat(
    `You summarise a craniosacral therapist's raw session notes into 3–6 short bullet points for the client's record. Keep their clinical vocabulary (stillpoint, occipital base, sacrum, unwinding, etc.). Each bullet is one short phrase or sentence. Reply with ONLY a JSON array of strings, no other text.`,
    raw,
    400,
  );
  const arr = parseJsonFrom(text, "[");
  return z.array(z.string()).min(1).parse(arr);
}

/**
 * Summarise a live Clean Language session into a few bullets for the client's
 * record. Clean Language works with the client's OWN words and metaphors, so the
 * summary must preserve them verbatim rather than paraphrase into clinical terms.
 */
export async function summariseSession(input: {
  transcript: string;
  pinned: string[];
  myNotes: string;
}): Promise<string[]> {
  const parts = [
    input.transcript.trim() && `TRANSCRIPT:\n${input.transcript.trim()}`,
    input.pinned.length && `THEIR EXACT WORDS (pinned in the moment):\n${input.pinned.map((p) => `- ${p}`).join("\n")}`,
    input.myNotes.trim() && `THERAPIST'S OWN NOTES:\n${input.myNotes.trim()}`,
  ].filter(Boolean);

  const text = await chat(
    `You summarise a Clean Language session for the client's record. Clean Language stays with the client's OWN words and metaphors — never translate them into clinical or therapist language. Write 3–6 short bullets that capture the developing metaphor landscape and anything that shifted, quoting the client's exact phrases where they matter. Reply with ONLY a JSON array of strings, no other text.`,
    parts.join("\n\n"),
    400,
  );
  const arr = parseJsonFrom(text, "[");
  return z.array(z.string()).min(1).parse(arr);
}

/**
 * Live during a session: surface the client's "highlight moments" from each new
 * chunk of transcript, using the Clean Language rubric (HIGHLIGHT_RUBRIC). It
 * judges the words themselves — it does NOT try to identify who is speaking — and
 * is told what's already been surfaced so it only returns genuinely new phrases,
 * quoted verbatim. May return [].
 */
export async function extractHighlights(recent: string, existing: string[]): Promise<string[]> {
  if (!recent.trim()) return [];
  const user = [
    existing.length
      ? `ALREADY SURFACED (do not repeat these or near-duplicates):\n${existing.map((e) => `- ${e}`).join("\n")}`
      : "",
    `NEW TRANSCRIPT:\n${recent}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const text = await chat(
    `${HIGHLIGHT_RUBRIC}\n\nOnly return phrases not already surfaced. Reply with ONLY a JSON array of strings — an empty array [] when this chunk has nothing worth highlighting. No other text.`,
    user,
    250,
    "fast",
  );
  const open = text.indexOf("[");
  if (open === -1) return [];
  try {
    const arr = JSON.parse(text.slice(open, text.lastIndexOf("]") + 1));
    return z
      .array(z.string())
      .parse(arr)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const importedClientSchema = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  dob: z.string(),
  occupation: z.string(),
  doctor: z.string(),
  meds: z.string(),
  conditions: z.string(),
  emergency: z.string(),
  referred: z.string(),
  marketing: z.boolean(),
  notes: z.string(),
});

export type ImportedClient = z.infer<typeof importedClientSchema>;

/** Extract client records from the text of an old client file (txt/csv/pasted). */
export async function extractClientsFromFile(
  filename: string,
  content: string,
): Promise<ImportedClient[]> {
  const text = await chat(
    `You extract client records from a craniosacral therapist's old files (intake forms, session notes, CSV contact lists). A file may hold one client or many.

Reply with ONLY a JSON array. Each element:
{
  "name": "full name",
  "email": "", "phone": "", "dob": "", "occupation": "", "doctor": "", "meds": "", "conditions": "", "emergency": "", "referred": "",
  "marketing": true/false (email-marketing consent; false when unknown),
  "notes": "any session notes / history found, verbatim-ish, or empty string"
}
Use empty strings for anything the file doesn't say. Never invent details.
The filename often contains the client's name (e.g. "Case History — Jane Doe — 2026.docx") — use it when the body doesn't state one.`,
    `File: ${filename}\n\n${content.slice(0, 40_000)}`,
    4000,
  );
  const arr = parseJsonFrom(text, "[");
  return z.array(importedClientSchema).parse(arr);
}
