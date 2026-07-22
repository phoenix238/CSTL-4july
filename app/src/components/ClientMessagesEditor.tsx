"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, Card, PrimaryButton, SectionLabel, useToast } from "./ui";
import { CLIENT_COPY_DEFAULTS, CLIENT_COPY_KEYS, applyCopy, type ClientCopy } from "@/lib/clientCopy";

type FieldDef = { key: keyof ClientCopy; label: string; multiline?: boolean; placeholders?: string[] };
type Group = { title: string; blurb: string; fields: FieldDef[] };

// The client's journey, in order — every word they might read, grouped by moment.
const GROUPS: Group[] = [
  {
    title: "The offer email",
    blurb: "Sent when you offer a few times. The link lets them book one themselves.",
    fields: [
      { key: "offerEmailSubject", label: "Subject", placeholders: ["clinic"] },
      { key: "offerEmailBody", label: "Message", multiline: true, placeholders: ["name", "clinic", "times", "pickLink"] },
      { key: "offerPickLinkLine", label: "The self-book link line", multiline: true, placeholders: ["link"] },
    ],
  },
  {
    title: "The intake email",
    blurb: "Sent on its own after booking (or copied to paste into WhatsApp).",
    fields: [
      { key: "intakeEmailSubject", label: "Subject" },
      { key: "intakeEmailBody", label: "Message", multiline: true, placeholders: ["name", "link"] },
    ],
  },
  {
    title: "The intake form page",
    blurb: "What a client sees when they open their intake link.",
    fields: [
      { key: "intakePageTitle", label: "Heading" },
      { key: "intakePageIntro", label: "Intro paragraph", multiline: true },
      { key: "intakeEmailHelp", label: "Note under the email field" },
      { key: "intakeThanksTitle", label: "Thank-you heading" },
      { key: "intakeThanksBody", label: "Thank-you message", multiline: true },
    ],
  },
  {
    title: "Your booking page (/book)",
    blurb: "The public page you can link from Instagram or your website.",
    fields: [
      { key: "bookPageTitle", label: "Heading" },
      { key: "bookPageIntro", label: "Intro paragraph", multiline: true },
    ],
  },
  {
    title: "The “you're booked” screen",
    blurb: "Shown right after a client books — on /book and via a self-book link.",
    fields: [
      { key: "confirmTitle", label: "Heading" },
      { key: "confirmBodySent", label: "Message (email went out)", multiline: true, placeholders: ["emailLine"] },
      { key: "confirmBodyPending", label: "Message (email didn't send)", multiline: true },
      { key: "confirmIntakeCardTitle", label: "Intake card heading" },
      { key: "confirmIntakeCardBody", label: "Intake card message", multiline: true },
    ],
  },
  {
    title: "The offer-pick page",
    blurb: "What a client sees on the self-book link before choosing a time.",
    fields: [
      { key: "offerPickTitle", label: "Heading", placeholders: ["name"] },
      { key: "offerPickIntro", label: "Intro", placeholders: ["clinic"] },
    ],
  },
];

// Sample values so the preview reads like a real message.
const SAMPLE: Record<string, string> = {
  name: "Maya",
  clinic: "Bethnal Green",
  times: "  • Tuesday 5 August at 14:00\n  • Thursday 7 August at 10:30",
  link: "https://your-site/offer/ab12cd",
  pickLink: "Or click here to pick one yourself and it'll be booked straight away:\nhttps://your-site/offer/ab12cd\n\n",
  emailLine: " to maya@example.com",
};

export function ClientMessagesEditor({ initial }: { initial: ClientCopy }) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<ClientCopy>(initial);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty = CLIENT_COPY_KEYS.some((k) => draft[k] !== initial[k]);
  const customised = CLIENT_COPY_KEYS.filter((k) => draft[k].trim() !== CLIENT_COPY_DEFAULTS[k].trim()).length;

  const set = (k: keyof ClientCopy, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  async function saveAll() {
    setSaving(true);
    try {
      // Only send fields that differ from the built-in default — a blank/default
      // field stays unstored, so future default tweaks still reach it.
      const clientCopy: Partial<ClientCopy> = {};
      for (const k of CLIENT_COPY_KEYS) {
        if (draft[k].trim() && draft[k].trim() !== CLIENT_COPY_DEFAULTS[k].trim()) clientCopy[k] = draft[k];
      }
      await api("/api/settings", { method: "PATCH", body: JSON.stringify({ clientCopy }) });
      toast("Client messages saved ✓");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Card className="flex flex-col gap-2 px-4 py-3.5">
        <div className="text-[12.5px] leading-relaxed text-muted">
          Every word a client reads, in one place. Open each moment of their journey, check it reads the way you
          want, and edit anything. Placeholders in {"{ }"} fill in automatically.
        </div>
        <div className="text-[11.5px] font-semibold text-clay-text">
          {customised} of {CLIENT_COPY_KEYS.length} messages customised · the rest use the warm defaults
        </div>
      </Card>

      {GROUPS.map((g) => {
        const groupEdited = g.fields.some((f) => draft[f.key].trim() !== CLIENT_COPY_DEFAULTS[f.key].trim());
        const isOpen = openGroup === g.title;
        return (
          <div key={g.title} className="flex flex-col gap-2.5">
            <button
              onClick={() => setOpenGroup(isOpen ? null : g.title)}
              className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-line bg-card px-4 py-3 text-left hover:bg-hoverbg"
            >
              <span className="flex items-center gap-2">
                <span className="text-[13.5px] font-semibold">{g.title}</span>
                {groupEdited && (
                  <span className="rounded-full bg-sage-tint px-2 py-[1px] text-[10.5px] font-semibold text-sage-text">
                    edited
                  </span>
                )}
              </span>
              <span className="text-[11px] font-semibold text-clay-text">{isOpen ? "Hide ▾" : "Show ›"}</span>
            </button>

            {isOpen && (
              <Card className="flex flex-col gap-4 px-4 py-4">
                <p className="text-[12px] leading-relaxed text-muted">{g.blurb}</p>
                {g.fields.map((f) => {
                  const val = draft[f.key];
                  const isDefault = val.trim() === CLIENT_COPY_DEFAULTS[f.key].trim();
                  const preview = val.includes("{") ? applyCopy(val, SAMPLE) : null;
                  return (
                    <div key={f.key} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold text-ink-soft">{f.label}</span>
                        {!isDefault && (
                          <button
                            onClick={() => set(f.key, CLIENT_COPY_DEFAULTS[f.key])}
                            className="cursor-pointer text-[11px] font-semibold text-muted underline hover:text-ink"
                          >
                            Reset to default
                          </button>
                        )}
                      </div>
                      {f.multiline ? (
                        <textarea
                          value={val}
                          onChange={(e) => set(f.key, e.target.value)}
                          className="min-h-[96px] w-full resize-y rounded-lg border border-inputline bg-inputbg px-2.5 py-2 text-[13px] leading-[1.55] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
                        />
                      ) : (
                        <input
                          value={val}
                          onChange={(e) => set(f.key, e.target.value)}
                          className="w-full rounded-lg border border-inputline bg-inputbg px-2.5 py-2 text-[13px] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
                        />
                      )}
                      {f.placeholders?.length ? (
                        <div className="flex flex-wrap gap-1 text-[10.5px] text-muted">
                          {f.placeholders.map((p) => (
                            <code key={p} className="rounded bg-[oklch(0.94_0.01_80)] px-1.5 py-[1px]">{`{${p}}`}</code>
                          ))}
                        </div>
                      ) : null}
                      {preview && (
                        <div className="rounded-lg bg-[oklch(0.97_0.01_85)] px-3 py-2 text-[12px] leading-[1.55] whitespace-pre-line text-[oklch(0.45_0.02_60)]">
                          {preview}
                        </div>
                      )}
                    </div>
                  );
                })}
              </Card>
            )}
          </div>
        );
      })}

      {dirty && (
        <div className="sticky bottom-3 z-10 flex items-center gap-2 rounded-full border border-line bg-card px-3 py-2 shadow-card">
          <PrimaryButton onClick={saveAll} disabled={saving} className="px-4 py-1.5 text-[12.5px]">
            {saving ? "Saving…" : "Save changes"}
          </PrimaryButton>
          <button
            onClick={() => setDraft(initial)}
            className="cursor-pointer text-[12px] font-semibold text-muted underline hover:text-ink"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
