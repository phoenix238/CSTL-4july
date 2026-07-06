"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { NotesComposer } from "./NotesComposer";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";
import { calcAge } from "@/lib/time";
import { api, Card, Chip, clinicChip, inputClass, PrimaryButton, SectionLabel, TintButton, useToast } from "./ui";

export interface ProfileClient {
  id: string;
  name: string;
  email: string;
  phone: string;
  clinic: string;
  marketing: boolean;
  intakeDone: boolean;
  intakeEmailSentAt: string | null;
  reviewEmailSentAt: string | null;
  dob: string;
  occupation: string;
  doctor: string;
  meds: string;
  conditions: string;
  emergency: string;
  referred: string;
  docId: string;
}

export interface ProfileNote {
  id: string;
  date: string;
  clinic: string;
  bullets: string[];
  raw: string;
}

const EDIT_FIELDS: Array<[keyof ProfileClient & string, string]> = [
  ["name", "FULL NAME"],
  ["email", "EMAIL"],
  ["phone", "PHONE"],
  ["dob", "DATE OF BIRTH"],
  ["occupation", "OCCUPATION"],
  ["doctor", "DOCTOR"],
  ["meds", "MEDICATIONS"],
  ["conditions", "HEALTH CONDITIONS"],
  ["emergency", "EMERGENCY CONTACT"],
  ["referred", "REFERRED BY"],
];

export function ClientProfile({
  client,
  notes,
  nextSession,
  nextBookingId,
  activeOffer,
}: {
  client: ProfileClient;
  notes: ProfileNote[];
  nextSession: string | null;
  nextBookingId?: string | null;
  activeOffer?: { id: string; times: Array<{ iso: string; label: string }> } | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [noteOpen, setNoteOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ raw: string; bullets: string[] }>({ raw: "", bullets: [] });
  const [savingNote, setSavingNote] = useState(false);
  const [togglingIntake, setTogglingIntake] = useState(false);
  const [changingClinic, setChangingClinic] = useState(false);
  const [sendingIntake, setSendingIntake] = useState(false);
  const [sendingReview, setSendingReview] = useState(false);

  async function cancelNextSession() {
    if (!nextBookingId) return;
    if (!window.confirm(`Cancel ${client.name}'s upcoming session? Both calendar events are deleted.`)) return;
    setCancelling(true);
    try {
      await api(`/api/bookings/${nextBookingId}`, { method: "DELETE" });
      toast("Booking cancelled");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't cancel that booking");
    } finally {
      setCancelling(false);
    }
  }

  async function deleteThisClient() {
    if (
      !window.confirm(
        `Delete ${client.name} completely? This removes their record, bookings and session notes from the app (any upcoming session is cancelled first). Their Drive folder and Doc are kept. This can't be undone.`,
      )
    )
      return;
    setDeleting(true);
    try {
      await api(`/api/clients/${client.id}`, { method: "DELETE" });
      toast(`${client.name} deleted`);
      router.push("/clients");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't delete this client");
      setDeleting(false);
    }
  }

  async function toggleIntakeDone() {
    setTogglingIntake(true);
    try {
      await api(`/api/clients/${client.id}`, {
        method: "PATCH",
        body: JSON.stringify({ intakeDone: !client.intakeDone }),
      });
      toast(client.intakeDone ? "Marked intake pending" : "Intake marked complete ✓");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't update intake status");
    } finally {
      setTogglingIntake(false);
    }
  }

  async function setClinic(clinic: Clinic) {
    if (clinic === client.clinic) return;
    setChangingClinic(true);
    try {
      await api(`/api/clients/${client.id}`, { method: "PATCH", body: JSON.stringify({ clinic }) });
      toast(`Moved to ${CLINIC_LABEL[clinic]} ✓`);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't change clinic");
    } finally {
      setChangingClinic(false);
    }
  }

  const startEditNote = (note: ProfileNote) => {
    setNoteDraft({ raw: note.raw, bullets: [...note.bullets] });
    setEditingNoteId(note.id);
  };

  const saveNoteEdit = async () => {
    if (!editingNoteId) return;
    setSavingNote(true);
    try {
      await api(`/api/clients/${client.id}/notes/${editingNoteId}`, {
        method: "PATCH",
        body: JSON.stringify(noteDraft),
      });
      toast("Note updated ✓");
      setEditingNoteId(null);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save that note");
    } finally {
      setSavingNote(false);
    }
  };

  const coreFields = ["dob", "occupation", "doctor", "meds", "conditions", "emergency", "referred"] as const;
  const incomplete = coreFields.some((k) => !client[k]);

  const age = calcAge(client.dob);

  const details: Array<[string, string]> = [
    ["DATE OF BIRTH", age !== null ? `${client.dob} — age ${age}` : client.dob],
    ["OCCUPATION", client.occupation],
    ["DOCTOR", client.doctor],
    ["MEDICATIONS", client.meds],
    ["HEALTH CONDITIONS", client.conditions],
    ["EMERGENCY CONTACT", client.emergency],
    ["REFERRED BY", client.referred],
    ["EMAIL MARKETING", client.marketing ? "Yes — on the sheet" : "No"],
  ];

  const startEdit = () => {
    setDraft(Object.fromEntries(EDIT_FIELDS.map(([k]) => [k, (client[k] as string) || ""])));
    setEditing(true);
  };

  const saveDetails = async () => {
    setSaving(true);
    try {
      await api(`/api/clients/${client.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...draft, syncToDoc: true }),
      });
      toast(`Updated ${draft.name || client.name}'s details ✓ — also added to their Doc`);
      setEditing(false);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex max-w-[1080px] flex-col gap-4 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
      <Link href="/clients" className="w-fit text-[12.5px] font-semibold text-muted hover:text-clay-text">
        ‹ All clients
      </Link>

      <Card className="flex flex-wrap items-center gap-4 px-5 py-5 lg:gap-[18px]">
        <div className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-clay font-serif text-[22px] font-medium text-cream">
          {client.name
            .split(" ")
            .map((w) => w[0])
            .join("")
            .slice(0, 3)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-serif text-[22px] font-medium lg:text-2xl">{client.name}</div>
          <div className="mt-[3px] text-[13px] text-muted">
            {[client.email, client.phone].filter(Boolean).join(" · ") || "No contact details yet"}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-[7px]">
            <div className="flex overflow-hidden rounded-full border border-line bg-[oklch(0.955_0.012_82)] p-[2px]">
              {(["waterloo", "bethnal"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setClinic(c)}
                  disabled={changingClinic}
                  className={`cursor-pointer rounded-full px-2.5 py-[3px] text-[11.5px] font-medium whitespace-nowrap select-none disabled:cursor-default ${
                    client.clinic === c ? "" : "text-[oklch(0.5_0.02_58)]"
                  }`}
                  style={client.clinic === c ? { color: clinicChip(c).color, background: clinicChip(c).bg } : undefined}
                >
                  {c === "waterloo" ? "Waterloo" : "Bethnal Green"}
                </button>
              ))}
            </div>
            <button onClick={toggleIntakeDone} disabled={togglingIntake} className="cursor-pointer disabled:cursor-default">
              {client.intakeDone ? (
                <Chip color="oklch(0.42 0.08 148)" bg="oklch(0.94 0.03 148)">
                  Intake ✓
                </Chip>
              ) : (
                <Chip color="oklch(0.5 0.09 75)" bg="oklch(0.95 0.035 85)">
                  Intake pending — click to mark complete
                </Chip>
              )}
            </button>
            {client.marketing ? (
              <Chip color="oklch(0.42 0.08 148)" bg="oklch(0.94 0.03 148)">
                Email marketing ✓
              </Chip>
            ) : (
              <Chip color="oklch(0.5 0.02 58)" bg="oklch(0.94 0.01 80)">
                No marketing
              </Chip>
            )}
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-2">
          <PrimaryButton onClick={() => router.push(`/enquiries?client=${client.id}`)} className="px-[18px] py-[9px] text-[13px]">
            Book next session
          </PrimaryButton>
          {client.docId ? (
            <a
              href={`https://docs.google.com/document/d/${client.docId}/edit`}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-clay-tint px-[18px] py-[9px] text-center text-[13px] font-semibold text-clay-text"
            >
              Open Google Doc
            </a>
          ) : (
            <span className="rounded-full bg-inputbg px-[18px] py-[9px] text-center text-[13px] font-semibold text-faint">
              Doc pending
            </span>
          )}
          <button
            onClick={deleteThisClient}
            disabled={deleting}
            className="cursor-pointer rounded-full px-[18px] py-[9px] text-center text-[12px] font-semibold text-faint hover:text-[oklch(0.55_0.15_25)] disabled:cursor-default"
          >
            {deleting ? "Deleting…" : "Delete client"}
          </button>
        </div>
      </Card>

      {activeOffer && (
        <Card className="flex flex-col gap-2.5 border-[1.5px] border-clay/40 bg-clay-tint/40 px-5 py-4">
          <SectionLabel>ACTIVE OFFER — WHICH TIME DID THEY PICK?</SectionLabel>
          <div className="text-[12.5px] text-muted">
            You offered {client.name.split(" ")[0]} these times. Tap the one they chose to confirm the booking.
          </div>
          <div className="flex flex-wrap gap-2">
            {activeOffer.times.map((t) => (
              <button
                key={t.iso}
                onClick={() => router.push(`/enquiries?open=${activeOffer.id}&pick=${encodeURIComponent(t.iso)}`)}
                className="cursor-pointer rounded-full bg-clay px-3.5 py-2 text-[12.5px] font-semibold text-cream hover:bg-clay-deep"
              >
                {t.label}
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-col items-start gap-5 lg:flex-row">
        <section className="flex w-full min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex items-center justify-between px-0.5">
            <SectionLabel>SESSION NOTES</SectionLabel>
            <TintButton onClick={() => setNoteOpen(!noteOpen)} className="px-3.5 py-1.5 text-xs">
              {noteOpen ? "Close" : "+ Add note"}
            </TintButton>
          </div>

          {noteOpen && (
            <NotesComposer
              clientId={client.id}
              clinic={client.clinic}
              onSaved={() => {
                setNoteOpen(false);
                router.refresh();
                toast(`Saved to ${client.name}'s Doc in Drive ✓`);
              }}
            />
          )}

          {notes.map((n) => {
            const nChip = clinicChip(n.clinic);
            const isEditing = editingNoteId === n.id;
            return (
              <Card key={n.id} className="px-[18px] py-[15px]">
                <div className="flex items-center gap-2.5">
                  <div className="font-serif text-[15px] font-medium">{n.date}</div>
                  <Chip color={nChip.color} bg={nChip.bg}>
                    {n.clinic === "waterloo" ? "Waterloo" : "Bethnal Green"}
                  </Chip>
                  <div className="flex-1" />
                  {!isEditing && (
                    <button
                      onClick={() => (editingNoteId ? setEditingNoteId(null) : startEditNote(n))}
                      className="cursor-pointer text-[11.5px] font-semibold text-muted hover:text-clay-text"
                    >
                      Fix a word
                    </button>
                  )}
                  <button
                    onClick={() => setExpanded({ ...expanded, [n.id]: !expanded[n.id] })}
                    className="cursor-pointer text-[11.5px] font-semibold text-muted hover:text-clay-text"
                  >
                    {expanded[n.id] ? "Hide raw note" : "Show raw note"}
                  </button>
                </div>

                {isEditing ? (
                  <div className="mt-2.5 flex flex-col gap-2">
                    {noteDraft.bullets.map((b, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-clay">•</span>
                        <input
                          value={b}
                          onChange={(e) => {
                            const bullets = [...noteDraft.bullets];
                            bullets[i] = e.target.value;
                            setNoteDraft({ ...noteDraft, bullets });
                          }}
                          className={inputClass}
                        />
                        <button
                          onClick={() =>
                            setNoteDraft({ ...noteDraft, bullets: noteDraft.bullets.filter((_, j) => j !== i) })
                          }
                          className="cursor-pointer text-[12px] font-semibold text-faint hover:text-[oklch(0.55_0.15_25)]"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setNoteDraft({ ...noteDraft, bullets: [...noteDraft.bullets, ""] })}
                      className="cursor-pointer self-start text-[11.5px] font-semibold text-clay-text hover:text-clay"
                    >
                      + Add bullet
                    </button>
                    <label className="mt-1 flex flex-col gap-1">
                      <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">
                        RAW NOTE
                      </span>
                      <textarea
                        value={noteDraft.raw}
                        onChange={(e) => setNoteDraft({ ...noteDraft, raw: e.target.value })}
                        className={`${inputClass} min-h-[90px] resize-y leading-[1.55]`}
                      />
                    </label>
                    <div className="mt-1 flex gap-2">
                      <PrimaryButton onClick={saveNoteEdit} disabled={savingNote} className="py-2 text-[12.5px]">
                        {savingNote ? "Saving…" : "Save fix"}
                      </PrimaryButton>
                      <button
                        onClick={() => setEditingNoteId(null)}
                        className="cursor-pointer rounded-full px-4 py-2 text-[12.5px] font-semibold text-faint hover:text-ink-soft"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-col gap-1">
                    {n.bullets.map((b, i) => (
                      <div key={i} className="flex gap-2 text-[13.5px] leading-[1.55]">
                        <span className="text-clay">•</span>
                        <span>{b}</span>
                      </div>
                    ))}
                  </div>
                )}
                {!isEditing && expanded[n.id] && (
                  <div className="mt-2.5 rounded-[10px] bg-inputbg px-3.5 py-2.5 text-[12.5px] leading-[1.6] text-[oklch(0.45_0.02_60)]">
                    {n.raw}
                  </div>
                )}
              </Card>
            );
          })}
          {notes.length === 0 && !noteOpen && (
            <div className="rounded-2xl border border-dashed border-[oklch(0.87_0.02_78)] bg-inputbg p-[22px] text-center text-[13px] text-muted">
              No sessions yet.
            </div>
          )}
        </section>

        <aside className="flex w-full flex-none flex-col gap-2.5 lg:w-[300px]">
          <SectionLabel>NEXT SESSION</SectionLabel>
          <div className="flex flex-col gap-1.5 rounded-2xl border border-[oklch(0.87_0.05_48_/_0.5)] bg-[oklch(0.94_0.03_48_/_0.55)] px-4 py-[13px]">
            <button
              onClick={() => router.push(`/enquiries?client=${client.id}`)}
              className="flex cursor-pointer items-center justify-between gap-2.5 text-left text-[13.5px] text-[oklch(0.4_0.07_45)]"
            >
              <span>{nextSession ?? 'Nothing booked — use "Book next session".'}</span>
              <span className="flex-none text-[11px] font-semibold whitespace-nowrap text-[oklch(0.5_0.09_45)]">
                Change ›
              </span>
            </button>
            {nextBookingId && (
              <button
                onClick={cancelNextSession}
                disabled={cancelling}
                className="cursor-pointer self-start text-[11.5px] font-semibold text-[oklch(0.55_0.12_25)] hover:text-[oklch(0.45_0.15_25)] disabled:cursor-default"
              >
                {cancelling ? "Cancelling…" : "Cancel this session"}
              </button>
            )}
          </div>

          <div className="flex items-center justify-between px-0.5 pt-2">
            <SectionLabel>FROM THE INTAKE FORM</SectionLabel>
            <button
              onClick={() => (editing ? setEditing(false) : startEdit())}
              className="cursor-pointer text-[11.5px] font-semibold text-clay-text hover:text-clay"
            >
              {editing ? "Cancel" : "Edit details"}
            </button>
          </div>

          {!editing && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={async () => {
                  try {
                    const { url } = await api<{ url: string }>(`/api/clients/${client.id}/intake-link`);
                    await navigator.clipboard?.writeText(url);
                    toast("Intake link copied ✓");
                  } catch (err) {
                    toast(err instanceof Error ? err.message : "Couldn't get the link");
                  }
                }}
                className="cursor-pointer rounded-full border border-line bg-card px-3.5 py-1.5 text-[12px] font-semibold text-ink-soft hover:bg-hoverbg"
              >
                Copy intake link
              </button>
              <button
                onClick={async () => {
                  setSendingIntake(true);
                  try {
                    await api(`/api/clients/${client.id}/intake-email`, { method: "POST" });
                    toast(`Intake form sent to ${client.name.split(" ")[0]} ✓`);
                    router.refresh();
                  } catch (err) {
                    toast(err instanceof Error ? err.message : "Couldn't send");
                  } finally {
                    setSendingIntake(false);
                  }
                }}
                disabled={sendingIntake}
                className="cursor-pointer rounded-full bg-clay-tint px-3.5 py-1.5 text-[12px] font-semibold text-clay-text disabled:cursor-default disabled:opacity-60"
              >
                {sendingIntake ? "Sending…" : "Send intake form"}
              </button>
              <button
                onClick={async () => {
                  setSendingReview(true);
                  try {
                    await api(`/api/clients/${client.id}/review-email`, { method: "POST" });
                    toast(`Review request sent to ${client.name.split(" ")[0]} ✓`);
                    router.refresh();
                  } catch (err) {
                    toast(err instanceof Error ? err.message : "Couldn't send");
                  } finally {
                    setSendingReview(false);
                  }
                }}
                disabled={sendingReview}
                className="cursor-pointer rounded-full border border-line bg-card px-3.5 py-1.5 text-[12px] font-semibold text-ink-soft hover:bg-hoverbg disabled:cursor-default disabled:opacity-60"
              >
                {sendingReview ? "Sending…" : "Send review request"}
              </button>
            </div>
          )}

          {!editing && (
            <div className="flex flex-col gap-0.5 px-0.5 text-[11px] text-muted">
              <span>
                Intake form:{" "}
                {client.intakeEmailSentAt ? `sent ${client.intakeEmailSentAt}` : "not sent yet"}
              </span>
              <span>
                Review request:{" "}
                {client.reviewEmailSentAt ? `sent ${client.reviewEmailSentAt}` : "not sent yet"}
              </span>
            </div>
          )}

          {incomplete && !editing && (
            <div className="rounded-xl border border-[oklch(0.85_0.06_78_/_0.6)] bg-[oklch(0.95_0.035_85_/_0.6)] px-3.5 py-2.5 text-xs leading-normal text-amber-text">
              Some details are still missing — add them when you have them.
            </div>
          )}

          {!editing ? (
            <Card className="px-4 py-1.5">
              {details.map(([label, value], i) => (
                <div key={label} className={`py-[11px] ${i < details.length - 1 ? "border-b border-hairline" : ""}`}>
                  <div className="text-[10.5px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">
                    {label}
                  </div>
                  <div className="mt-[3px] text-[13px] leading-normal">{value || "Not yet recorded"}</div>
                </div>
              ))}
            </Card>
          ) : (
            <Card className="flex flex-col gap-[11px] border-[1.5px] border-clay/35 px-4 py-3.5">
              {EDIT_FIELDS.map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">
                    {label}
                  </span>
                  <input
                    value={draft[key] ?? ""}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                    className={inputClass}
                  />
                </label>
              ))}
              <PrimaryButton onClick={saveDetails} disabled={saving} className="py-2.5 text-[13px]">
                {saving ? "Saving…" : "Save details"}
              </PrimaryButton>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
