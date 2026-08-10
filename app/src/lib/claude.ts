import { z } from "zod";
import { HIGHLIGHT_RUBRIC } from "./cleanLanguage";

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

const caseHistoryExtractSchema = z.object({
  presenting: z.string(),
  historyOfPresenting: z.string(),
  medical: z.string(),
  medications: z.string(),
  previousTreatment: z.string(),
  lifestyle: z.string(),
  birthDevelopment: z.string(),
  injuries: z.string(),
  redFlags: z.string(),
  goals: z.string(),
  plan: z.string(),
  priorSessions: z.array(z.object({ date: z.string(), text: z.string() })),
});

export type CaseHistoryExtract = z.infer<typeof caseHistoryExtractSchema>;

/**
 * Sort an existing, free-text client Doc into the standard case-history
 * sections, so an old record can be rebuilt onto the layout.
 *
 * Strictly a sorting job, not a writing one: the text is moved across as it was
 * written, never summarised, tidied or inferred. Anything the Doc doesn't say
 * comes back empty rather than guessed — this is a clinical record, and an
 * invented "no known conditions" would be worse than a blank section. The
 * original wording is kept in the Doc regardless, under ORIGINAL RECORD.
 */
export async function extractCaseHistory(
  clientName: string,
  docText: string,
): Promise<CaseHistoryExtract> {
  const text = await chat(
    `You reorganise a craniosacral therapist's existing client record into a standard case-history layout.

You are SORTING text, not rewriting it. Copy the client's and therapist's own words across as they were written — keep clinical vocabulary (stillpoint, occipital base, sacrum, unwinding), keep the client's own phrases and metaphors. Do not summarise, do not paraphrase, do not smooth out the wording.

NEVER invent. If the record doesn't cover a section, return an empty string for it. Do not write "none known", "not stated" or similar — an empty string means empty.

Reply with ONLY a JSON object, no other text:
{
  "presenting": "what they came with",
  "historyOfPresenting": "when it started, how it's changed, what helps or aggravates",
  "medical": "diagnoses, conditions, ongoing medical care",
  "medications": "medications and supplements",
  "previousTreatment": "other bodywork/therapies tried, and how they went",
  "lifestyle": "work, posture, sleep, exercise, current stressors",
  "birthDevelopment": "birth and early developmental history",
  "injuries": "injuries, accidents, falls, dental work, surgery",
  "redFlags": "cautions, contraindications, anything to refer on or watch",
  "goals": "what the client wants from the work",
  "plan": "treatment plan, frequency, approach",
  "priorSessions": [{ "date": "the date as written in the record, or empty string", "text": "that session's notes, verbatim" }]
}

"priorSessions" is for dated session notes already written into the record — list them oldest first, verbatim. Return [] when the record has none. Text that is intake/history rather than a session belongs in the sections above, not here.`,
    `Client: ${clientName}\n\nTheir existing record:\n\n${docText.slice(0, 40_000)}`,
    8000,
  );
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  return caseHistoryExtractSchema.parse(json);
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
