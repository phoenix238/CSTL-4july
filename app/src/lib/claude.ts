import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const MODEL = "claude-sonnet-5";

const anthropic = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const enquirySchema = z.object({
  name: z.string(),
  phone: z.string(),
  email: z.string(),
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
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 500,
    system: `You read new-client enquiries for Phoenix Tanner, a craniosacral therapist with two London clinics:
- Waterloo (south/central: Waterloo, South Bank, Southwark, Kennington, Lambeth)
- Bethnal Green (east: Bethnal Green, Victoria Park, Hackney, Mile End, "out east")

Extract from the message and reply with ONLY a JSON object, no other text:
{
  "name": "sender's name, or empty string if not stated",
  "phone": "phone number as written, or empty string",
  "email": "email address, or empty string",
  "clinicSuggestion": "waterloo" | "bethnal" | null (null when the message gives no location clue),
  "clinicReason": "short human explanation like 'Bethnal Green — the message mentions Victoria Park', or empty string",
  "requestedWhen": "when they asked to come, in their words, e.g. 'Tuesday or Wednesday, after 5' — empty string if not stated"
}`,
    messages: [{ role: "user", content: message }],
  });
  const text = res.content.find((b) => b.type === "text")?.text ?? "{}";
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  return enquirySchema.parse(json);
}

/** Turn a raw (often dictated) session note into short bullet points for the Doc. */
export async function summariseNote(raw: string): Promise<string[]> {
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 400,
    system: `You summarise a craniosacral therapist's raw session notes into 3–6 short bullet points for the client's record. Keep her clinical vocabulary (stillpoint, occipital base, sacrum, unwinding, etc.). Each bullet is one short phrase or sentence. Reply with ONLY a JSON array of strings, no other text.`,
    messages: [{ role: "user", content: raw }],
  });
  const text = res.content.find((b) => b.type === "text")?.text ?? "[]";
  const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  return z.array(z.string()).min(1).parse(arr);
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
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: `You extract client records from a craniosacral therapist's old files (intake forms, session notes, CSV contact lists). A file may hold one client or many.

Reply with ONLY a JSON array. Each element:
{
  "name": "full name",
  "email": "", "phone": "", "dob": "", "occupation": "", "doctor": "", "meds": "", "conditions": "", "emergency": "", "referred": "",
  "marketing": true/false (email-marketing consent; false when unknown),
  "notes": "any session notes / history found, verbatim-ish, or empty string"
}
Use empty strings for anything the file doesn't say. Never invent details.`,
    messages: [{ role: "user", content: `File: ${filename}\n\n${content.slice(0, 40_000)}` }],
  });
  const text = res.content.find((b) => b.type === "text")?.text ?? "[]";
  const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  return z.array(importedClientSchema).parse(arr);
}
