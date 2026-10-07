// Who the practice is, as placeholders any client message can use.
//
// Every letter used to have "Phoenix" typed into it, which meant a second
// practitioner had to find and rewrite the name in a dozen places — and any
// one they missed went out under the wrong name. Now a message says
// {yourName} and it's filled in from Settings › Your details, once.

export interface IdentitySettings {
  practitionerName?: string;
  practitionerFullName?: string;
  practiceName?: string;
}

/** The identity placeholders and what they're filled with. */
export function practitionerIdentity(s: IdentitySettings): Record<string, string> {
  const yourName = s.practitionerName?.trim() || "Phoenix";
  const yourFullName = s.practitionerFullName?.trim() || yourName;
  const practiceName = s.practiceName?.trim() || yourFullName;
  return { yourName, yourFullName, practiceName };
}

/** The identity placeholder names, for the Settings editor's chips. */
export const IDENTITY_PLACEHOLDERS = ["yourName", "yourFullName", "practiceName"] as const;

/** Fill {yourName} {yourFullName} {practiceName}; leave every other placeholder alone. */
export function fillIdentity(text: string, identity: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(identity)) out = out.split(`{${k}}`).join(v);
  return out;
}
