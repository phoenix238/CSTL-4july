import { z } from "zod";

const MODEL = "anthropic/claude-haiku-4.5";

async function chat(system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter request failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
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
  );
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  return enquirySchema.parse(json);
}

/** Turn a raw (often dictated) session note into short bullet points for the Doc. */
export async function summariseNote(raw: string): Promise<string[]> {
  const text = await chat(
    `You summarise a craniosacral therapist's raw session notes into 3–6 short bullet points for the client's record. Keep their clinical vocabulary (stillpoint, occipital base, sacrum, unwinding, etc.). Each bullet is one short phrase or sentence. Reply with ONLY a JSON array of strings, no other text.`,
    raw,
    400,
  );
  const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
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
  const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  return z.array(z.string()).min(1).parse(arr);
}

const sessionMomentsSchema = z.object({
  highlights: z.array(z.string()).catch([]),
  questions: z.array(z.string()).catch([]),
});

export interface SessionMoments {
  highlights: string[];
  questions: string[];
}

/**
 * Live during a session, from each new chunk of transcript, pull out two things:
 * - highlights: the CLIENT's most significant exact phrases (vivid metaphors,
 *   charged statements, repeated/stressed words, what they want to have happen).
 * - questions: the QUESTIONS the practitioner asked, verbatim — in Clean Language
 *   the exact question matters as much as the answer.
 * It's told what's already been captured so it only returns genuinely new items.
 */
export async function extractSessionMoments(
  recent: string,
  existingHighlights: string[],
  existingQuestions: string[],
): Promise<SessionMoments> {
  if (!recent.trim()) return { highlights: [], questions: [] };
  const user = [
    existingHighlights.length
      ? `HIGHLIGHTS ALREADY SURFACED (don't repeat these or near-duplicates):\n${existingHighlights.map((e) => `- ${e}`).join("\n")}`
      : "",
    existingQuestions.length
      ? `QUESTIONS ALREADY CAPTURED (don't repeat these or near-duplicates):\n${existingQuestions.map((e) => `- ${e}`).join("\n")}`
      : "",
    `NEW TRANSCRIPT (both the practitioner and the client are speaking, unlabelled):\n${recent}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const text = await chat(
    `You follow a live Clean Language coaching session and, from each new chunk of transcript, pull out two things:
- "highlights": the CLIENT's most significant exact phrases — vivid metaphors, emotionally charged statements, words they repeat or stress, and anything about what they want to have happen. Quote them VERBATIM and keep each one short (their actual phrase, not a paraphrase).
- "questions": the QUESTIONS the practitioner asked, quoted verbatim. Clean Language questions almost always start with "And" and end with "?" (e.g. "And what kind of X is that X?"). These matter as much as the answers, so capture them.
Only return items not already listed. Reply with ONLY a JSON object of this shape: {"highlights": [...], "questions": [...]}. Use an empty array for either when this chunk has nothing for it. No other text.`,
    user,
    350,
  );
  const open = text.indexOf("{");
  if (open === -1) return { highlights: [], questions: [] };
  try {
    const obj = JSON.parse(text.slice(open, text.lastIndexOf("}") + 1));
    const parsed = sessionMomentsSchema.parse(obj);
    const clean = (a: string[]) => a.map((s) => s.trim()).filter(Boolean);
    return { highlights: clean(parsed.highlights), questions: clean(parsed.questions) };
  } catch {
    return { highlights: [], questions: [] };
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
  const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  return z.array(importedClientSchema).parse(arr);
}
