"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, Card, inputClass, OutlineButton, PrimaryButton, useToast } from "./ui";
import { spaceChipStyle } from "./SpacesContext";
import {
  blankSpace,
  EVENT_COLORS,
  spaceIdFrom,
  spacePriceLabel,
  validateSpaces,
  type Space,
  type VenueMode,
} from "@/lib/spaces";

/**
 * "Your spaces" — every place you work from, and everything about each one:
 * its name and price, where it is and how to find the door, its review link,
 * its colour on your calendar, how the venue's own calendar is booked, and
 * the gaps kept around sessions there.
 *
 * The whole list is saved in one go. A space's id is made from its name once,
 * when it's added, and never changes — bookings and clients point at it.
 */
export function SpacesEditor({ initial }: { initial: Space[] }) {
  const router = useRouter();
  const toast = useToast();
  const [spaces, setSpaces] = useState<Space[]>(initial);
  const [saved, setSaved] = useState<Space[]>(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState("");
  // Bumped on Discard so each form's typed-in-progress boxes start over too.
  const [resetKey, setResetKey] = useState(0);

  const savedIds = new Set(saved.map((s) => s.id));
  const dirty = JSON.stringify(spaces) !== JSON.stringify(saved);
  const errors = validateSpaces(spaces);

  const update = (id: string, patch: Partial<Space>) => {
    setSpaces((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    setServerError("");
  };

  function addSpace() {
    const name = newName.trim();
    if (!name) {
      toast("Give the space a name first");
      return;
    }
    const id = spaceIdFrom(name, spaces.map((s) => s.id));
    setSpaces((prev) => [...prev, blankSpace(id, name)]);
    setOpenId(id);
    setNewName("");
    setAdding(false);
  }

  function removeSpace(id: string) {
    setSpaces((prev) => prev.filter((s) => s.id !== id));
    if (openId === id) setOpenId(null);
  }

  function move(id: string, by: -1 | 1) {
    setSpaces((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    if (errors.length) {
      toast("Fix the problems shown first");
      return;
    }
    setSaving(true);
    setServerError("");
    try {
      await api("/api/settings", { method: "PATCH", body: JSON.stringify({ spaces }) });
      setSaved(spaces);
      toast("Your spaces saved ✓");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't save";
      setServerError(msg);
      toast(msg);
    } finally {
      setSaving(false);
    }
  }

  async function copyLocation(s: Space) {
    const text = [s.address, s.mapUrl, s.findIt].map((p) => p.trim()).filter(Boolean).join("\n\n");
    if (!text) {
      toast("Nothing to copy yet — add an address, map pin or directions first");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast(`${s.name} location & directions copied ✓`);
    } catch {
      toast("Couldn't copy — try again");
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Card className="px-4 py-3 text-[12.5px] leading-[1.6] text-muted">
        Each space is somewhere you see clients. Add as many as you work from — clients choose between the open ones
        on your booking page. A space with past sessions can&apos;t be deleted, but you can archive it: its history
        stays, and nobody can book it any more.
      </Card>

      {spaces.map((s, i) => {
        const chip = spaceChipStyle(s);
        const isOpen = openId === s.id;
        const price = spacePriceLabel(s);
        return (
          <div key={s.id} className="flex flex-col gap-2">
            <Card className={`px-4 py-3 ${isOpen ? "border-[1.5px] border-clay/35" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <button
                  onClick={() => setOpenId(isOpen ? null : s.id)}
                  className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 text-left"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      className="h-3 w-3 flex-none rounded-full"
                      style={{ background: EVENT_COLORS[s.eventColor]?.hex }}
                      aria-hidden
                    />
                    <span className="font-serif text-[15.5px] font-medium">{s.name || "Unnamed space"}</span>
                    {price && (
                      <span
                        className="rounded-full px-2 py-[2px] text-[11px] font-semibold"
                        style={{ color: chip.color, background: chip.bg }}
                      >
                        {price}
                      </span>
                    )}
                    {!s.active && (
                      <span className="rounded-full bg-[oklch(0.94_0.01_80)] px-2 py-[2px] text-[10.5px] font-semibold text-muted">
                        Archived
                      </span>
                    )}
                    {!savedIds.has(s.id) && (
                      <span className="rounded-full bg-sage-tint px-2 py-[2px] text-[10.5px] font-semibold text-sage-text">
                        New — not saved yet
                      </span>
                    )}
                  </span>
                  <span className="text-[12px] leading-[1.5] text-[oklch(0.5_0.02_58)]">
                    {s.address || <span className="text-faint">No address yet</span>}
                  </span>
                  <span className="text-[11.5px] text-muted">{VENUE_SUMMARY[s.venueMode]}</span>
                </button>
                <span className="flex flex-none items-center gap-1">
                  <button
                    onClick={() => move(s.id, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${s.name} up`}
                    className="cursor-pointer rounded px-1.5 text-[13px] text-muted hover:text-ink disabled:cursor-default disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => move(s.id, 1)}
                    disabled={i === spaces.length - 1}
                    aria-label={`Move ${s.name} down`}
                    className="cursor-pointer rounded px-1.5 text-[13px] text-muted hover:text-ink disabled:cursor-default disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => setOpenId(isOpen ? null : s.id)}
                    className="cursor-pointer pl-1 text-[11.5px] font-semibold text-clay-text hover:text-clay"
                  >
                    {isOpen ? "Close ▾" : "Edit ›"}
                  </button>
                </span>
              </div>
            </Card>

            {isOpen && (
              <SpaceForm
                key={resetKey}
                space={s}
                isSaved={savedIds.has(s.id)}
                onChange={(patch) => update(s.id, patch)}
                onRemove={() => removeSpace(s.id)}
                onCopy={() => copyLocation(s)}
                onError={toast}
              />
            )}
          </div>
        );
      })}

      {adding ? (
        <Card className="flex flex-col gap-2.5 border-[1.5px] border-clay/35 px-4 py-3.5">
          <Field label="NAME OF THE NEW SPACE" hint="What you and your clients call it, e.g. “The Garden Room”.">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSpace()}
              className={inputClass}
            />
          </Field>
          <div className="flex gap-2">
            <PrimaryButton onClick={addSpace} className="px-4 py-1.5 text-[12.5px]">
              Add
            </PrimaryButton>
            <OutlineButton
              onClick={() => {
                setAdding(false);
                setNewName("");
              }}
              className="px-3.5 py-1.5 text-[12.5px]"
            >
              Cancel
            </OutlineButton>
          </div>
        </Card>
      ) : (
        <OutlineButton onClick={() => setAdding(true)} className="self-start">
          + Add a space
        </OutlineButton>
      )}

      {(errors.length > 0 || serverError) && (
        <div className="rounded-xl border border-[oklch(0.85_0.06_25)] bg-[oklch(0.97_0.02_25)] px-4 py-2.5 text-[12.5px] leading-[1.55] text-[oklch(0.45_0.13_25)]">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
          {serverError && <div>{serverError}</div>}
        </div>
      )}

      {dirty && (
        <div className="sticky bottom-3 z-10 flex items-center gap-2 rounded-full border border-line bg-card px-3 py-2 shadow-card">
          <PrimaryButton onClick={save} disabled={saving || errors.length > 0} className="px-4 py-1.5 text-[12.5px]">
            {saving ? "Saving…" : "Save your spaces"}
          </PrimaryButton>
          <button
            onClick={() => {
              setSpaces(saved);
              setServerError("");
              setResetKey((k) => k + 1);
            }}
            className="cursor-pointer text-[12px] font-semibold text-muted underline hover:text-ink"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}

const VENUE_SUMMARY: Record<VenueMode, string> = {
  none: "A booking here goes on your own calendar only.",
  room: "A booking here also puts one event on the venue's room calendar.",
  dayBlock: "A booking here also keeps one shared block for the day on the venue's calendar.",
};

const VENUE_OPTIONS: { mode: VenueMode; label: string; hint: string }[] = [
  {
    mode: "none",
    label: "Nothing extra — just your own calendar",
    hint: "For a space that's yours, or where nobody else needs to see when you're in.",
  },
  {
    mode: "room",
    label: "One event per session on the venue's room calendar",
    hint: "Each session also appears on the venue's calendar, under the title below — never the client's name.",
  },
  {
    mode: "dayBlock",
    label: "One shared block covering your sessions that day on the venue's calendar",
    hint: "A single block grows and shrinks to span that day's sessions, so the venue sees when the room is yours.",
  },
];

/** A labelled field with an optional hint underneath. */
function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-[1.5] text-muted">{hint}</span>}
    </label>
  );
}

/** One group of fields inside a space's form. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-hairline pt-3.5 first:border-0 first:pt-0">
      <div className="text-[12.5px] font-semibold text-ink-soft">{title}</div>
      {children}
    </div>
  );
}

const textareaClass =
  "min-h-[70px] w-full resize-y rounded-lg border border-inputline bg-inputbg px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]";

/** Pounds typed by a person → pence. "45.5" → 4550; blank or junk → 0. */
const toPence = (v: string) => {
  const n = Number(v.replace(/[£,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};
const toPounds = (pence: number) => (pence ? String(pence / 100) : "");

/** A whole-number minutes/hours box. */
function NumberInput({ value, onChange, suffix }: { value: number; onChange: (n: number) => void; suffix: string }) {
  return (
    <span className="flex items-center gap-2">
      <input
        value={String(value)}
        inputMode="numeric"
        onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value.replace(/\D/g, "")) || 0)))}
        className={`${inputClass} max-w-[90px]`}
      />
      <span className="text-[12px] text-muted">{suffix}</span>
    </span>
  );
}

/** Pounds, kept as typed while editing so "45." doesn't jump about. */
function PoundsInput({ pence, onChange }: { pence: number; onChange: (pence: number) => void }) {
  const [text, setText] = useState(toPounds(pence));
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-[13px] text-muted">£</span>
      <input
        value={text}
        inputMode="decimal"
        onChange={(e) => {
          setText(e.target.value);
          onChange(toPence(e.target.value));
        }}
        className={`${inputClass} max-w-[100px]`}
      />
    </span>
  );
}

function SpaceForm({
  space: s,
  isSaved,
  onChange,
  onRemove,
  onCopy,
  onError,
}: {
  space: Space;
  isSaved: boolean;
  onChange: (patch: Partial<Space>) => void;
  onRemove: () => void;
  onCopy: () => void;
  onError: (msg: string) => void;
}) {
  const priceLabel = spacePriceLabel(s);
  return (
    <Card className="flex flex-col gap-4 border-[1.5px] border-clay/35 px-4 py-4">
      <Group title="Basics">
        <Field label="NAME" hint="What you and your clients call it — shown everywhere: emails, calendar, your Today view.">
          <input value={s.name} onChange={(e) => onChange({ name: e.target.value })} className={inputClass} />
        </Field>
        <Field
          label="NAME ON THE BOOKING PAGE (OPTIONAL)"
          hint={`If clients should see something different when choosing, e.g. “Low cost ${s.name || "clinic"}”. Leave blank to use the name.`}
        >
          <input
            value={s.bookingLabel}
            onChange={(e) => onChange({ bookingLabel: e.target.value })}
            placeholder={s.name}
            className={inputClass}
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">STATUS</span>
          <div className="flex w-fit rounded-full border border-line bg-[oklch(0.955_0.012_82)] p-[3px]">
            {([true, false] as const).map((on) => (
              <button
                key={String(on)}
                onClick={() => onChange({ active: on })}
                className={`cursor-pointer rounded-full px-3.5 py-[6px] text-[12.5px] font-semibold select-none ${
                  s.active === on ? "bg-clay text-cream" : "text-[oklch(0.45_0.02_60)]"
                }`}
              >
                {on ? "Open for booking" : "Archived"}
              </button>
            ))}
          </div>
          <span className="text-[11px] leading-[1.5] text-muted">
            Archiving keeps every past session and client here exactly as it was, but stops new bookings — it
            disappears from your booking page, weekly hours and the space choosers. You can reopen it any time.
          </span>
        </div>
      </Group>

      <Group title="Price">
        <div className="flex w-fit rounded-full border border-line bg-[oklch(0.955_0.012_82)] p-[3px]">
          {(["fixed", "sliding"] as const).map((k) => (
            <button
              key={k}
              onClick={() => onChange({ priceKind: k })}
              className={`cursor-pointer rounded-full px-3.5 py-[6px] text-[12.5px] font-semibold select-none ${
                s.priceKind === k ? "bg-clay text-cream" : "text-[oklch(0.45_0.02_60)]"
              }`}
            >
              {k === "fixed" ? "Fixed price" : "Sliding scale"}
            </button>
          ))}
        </div>
        {s.priceKind === "fixed" ? (
          <Field label="PRICE PER SESSION">
            <PoundsInput key="fixed" pence={s.pricePence} onChange={(p) => onChange({ pricePence: p })} />
          </Field>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="FROM">
              <PoundsInput key="min" pence={s.priceMinPence} onChange={(p) => onChange({ priceMinPence: p })} />
            </Field>
            <Field label="UP TO">
              <PoundsInput key="max" pence={s.priceMaxPence} onChange={(p) => onChange({ priceMaxPence: p })} />
            </Field>
          </div>
        )}
        <Field
          label="YOUR OWN PRICE WORDING (OPTIONAL)"
          hint="Replaces the price wording in emails and on the booking page, e.g. “£80, card or transfer”. Leave blank to use the price above."
        >
          <input
            value={s.priceLabel}
            onChange={(e) => onChange({ priceLabel: e.target.value })}
            className={inputClass}
          />
        </Field>
        <div className="text-[12px] text-muted">
          Clients see: <span className="font-semibold text-ink">{priceLabel || "no price shown"}</span>
        </div>
      </Group>

      <Group title="Finding it">
        <Field label="FULL ADDRESS" hint="As you'd write it on an envelope — also the location on the calendar invite.">
          <input value={s.address} onChange={(e) => onChange({ address: e.target.value })} className={inputClass} />
        </Field>
        <Field label="MAP PIN LINK" hint="A Google Maps pin / share link, what3words, etc. Added to emails for you.">
          <input value={s.mapUrl} onChange={(e) => onChange({ mapUrl: e.target.value })} className={inputClass} />
        </Field>
        <Field label="HOW TO FIND THE DOOR">
          <textarea
            value={s.findIt}
            onChange={(e) => onChange({ findIt: e.target.value })}
            placeholder="Buzzer code, which door, the nearest station, where to wait — whatever helps a client find you."
            className={textareaClass}
          />
        </Field>
        <PhotoField
          spaceName={s.name}
          value={s.photo}
          onChange={(photo) => onChange({ photo })}
          onError={onError}
        />
        <Field label="AREAS NEARBY" hint="Helps the enquiry reader suggest this space, e.g. “east: Hackney, Bethnal Green, Mile End”.">
          <input value={s.nearby} onChange={(e) => onChange({ nearby: e.target.value })} className={inputClass} />
        </Field>
        <button
          onClick={onCopy}
          className="cursor-pointer self-start rounded-full bg-clay-tint px-3.5 py-1.5 text-[12px] font-semibold text-clay-text hover:opacity-90"
        >
          Copy address &amp; directions
        </button>
        <span className="text-[11px] leading-[1.5] text-muted">
          The address, map pin, directions and photo go out together in every confirmation email and on the booking
          page, for whichever space was booked — no need to paste them into your messages.
        </span>
      </Group>

      <Group title="Reviews">
        <Field
          label="GOOGLE REVIEW LINK"
          hint="This space's “leave a review” link — the review request email uses it for clients seen here."
        >
          <input
            value={s.reviewUrl}
            onChange={(e) => onChange({ reviewUrl: e.target.value })}
            placeholder="https://g.page/r/…/review"
            className={inputClass}
          />
        </Field>
      </Group>

      <Group title="Calendar">
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">
            COLOUR ON YOUR CALENDAR
          </span>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(EVENT_COLORS).map(([id, c]) => (
              <button
                key={id}
                onClick={() => onChange({ eventColor: id })}
                title={c.name}
                aria-label={c.name}
                aria-pressed={s.eventColor === id}
                className={`h-7 w-7 cursor-pointer rounded-full border-2 ${
                  s.eventColor === id ? "border-ink" : "border-transparent"
                }`}
                style={{ background: c.hex }}
              />
            ))}
          </div>
          <span className="text-[11px] text-muted">
            {EVENT_COLORS[s.eventColor]?.name} — the colour of sessions here in Google Calendar and in the app.
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">
            HOW THE VENUE&apos;S OWN CALENDAR IS BOOKED
          </span>
          {VENUE_OPTIONS.map((o) => (
            <label key={o.mode} className="flex cursor-pointer items-start gap-2.5">
              <input
                type="radio"
                name={`venue-${s.id}`}
                checked={s.venueMode === o.mode}
                onChange={() => onChange({ venueMode: o.mode })}
                className="mt-[3px]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[12.5px] font-medium text-ink">{o.label}</span>
                <span className="text-[11px] leading-[1.5] text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>

        {s.venueMode !== "none" && (
          <>
            <Field
              label="VENUE CALENDAR ID"
              hint="Find it in Google Calendar › Settings and sharing › Integrate calendar. The venue must have shared it with you so you can make changes to events."
            >
              <input
                value={s.venueCalendarId}
                onChange={(e) => onChange({ venueCalendarId: e.target.value.trim() })}
                placeholder="…@group.calendar.google.com"
                className={inputClass}
              />
            </Field>
            <Field
              label="TITLE ON THE VENUE CALENDAR"
              hint="What everyone with access to the venue's calendar sees, e.g. “R5 - Emily”. Never a client's name."
            >
              <input
                value={s.venueEventTitle}
                onChange={(e) => onChange({ venueEventTitle: e.target.value })}
                className={inputClass}
              />
            </Field>
          </>
        )}

        {s.venueMode === "dayBlock" && (
          <>
            <Field
              label="SAFETY GAP AROUND OTHER PEOPLE'S BOOKINGS"
              hint="When someone else already has the venue booked, this much clearance is kept either side of their booking before you can be booked."
            >
              <NumberInput value={s.venueBufferMinutes} onChange={(n) => onChange({ venueBufferMinutes: n })} suffix="min" />
            </Field>
            <Field
              label="PADDING BEFORE AND AFTER YOUR BLOCK"
              hint="Your block starts this long before your first session and ends this long after your last, so others don't book right up against you."
            >
              <NumberInput value={s.venueEdgeMinutes} onChange={(n) => onChange({ venueEdgeMinutes: n })} suffix="min" />
            </Field>
            <Field
              label="SESSIONS THIS CLOSE SHARE ONE BLOCK"
              hint="Two sessions this close together (or closer) share one block; a wider gap splits them, so a long gap isn't held as room time."
            >
              <NumberInput
                value={s.venueClusterGapMinutes}
                onChange={(n) => onChange({ venueClusterGapMinutes: n })}
                suffix="min"
              />
            </Field>
          </>
        )}
      </Group>

      <Group title="Timing">
        <Field
          label="GAP BETWEEN YOUR OWN SESSIONS HERE"
          hint="Breathing room kept before and after every session here. 0 lets clients book back-to-back."
        >
          <NumberInput value={s.bufferMinutes} onChange={(n) => onChange({ bufferMinutes: n })} suffix="min" />
        </Field>
        <Field
          label="MOST HOURS PER WEEK HERE"
          hint={
            s.venueMode === "dayBlock"
              ? "Counts the room time held on the venue's calendar each Monday–Sunday (padding and gaps included). Once reached, no more times here are offered that week. 0 = no limit."
              : "Once a Monday–Sunday week has this many hours of sessions here, no more times here are offered that week. 0 = no limit."
          }
        >
          <NumberInput value={s.weeklyCapHours} onChange={(n) => onChange({ weeklyCapHours: n })} suffix="hours" />
        </Field>
        <span className="text-[11px] leading-[1.5] text-muted">
          Limits only apply to what clients can book themselves — you can always book over them yourself.
        </span>
      </Group>

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3.5">
        {isSaved ? (
          <span className="text-[11.5px] leading-[1.5] text-muted">
            To stop using this space, set it to <strong>Archived</strong> above — its past sessions stay as they were.
          </span>
        ) : (
          <>
            <OutlineButton onClick={onRemove} className="px-3.5 py-1.5 text-[12.5px]">
              Remove this new space
            </OutlineButton>
            <span className="text-[11.5px] text-muted">It hasn&apos;t been saved yet, so nothing else is affected.</span>
          </>
        )}
      </div>
    </Card>
  );
}

/** Longest edge a stored entrance photo is scaled down to, in pixels. */
const PHOTO_MAX_EDGE = 1400;
/** Refuse anything above this before we even try to read it. */
const PHOTO_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * Downscale a chosen image in the browser and hand back a data: URL.
 *
 * A photo straight off a phone is 3-5 MB, which is too big to sit in a settings
 * row and too big to attach to every confirmation email. Scaling to a long edge
 * of 1400px lands around 200-400 KB — plenty to recognise a front door by, and
 * small enough that the client's inbox doesn't mind.
 */
function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Couldn't process that image"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file doesn't look like an image"));
    };
    img.src = url;
  });
}

/** Pick, preview and remove a space's entrance photo. */
function PhotoField({
  spaceName,
  value,
  onChange,
  onError,
}: {
  spaceName: string;
  value: string;
  onChange: (dataUrl: string) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > PHOTO_MAX_UPLOAD_BYTES) {
      onError("That photo is very large — please pick one under 15 MB");
      return;
    }
    setBusy(true);
    try {
      onChange(await shrinkImage(file));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't read that photo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">
        PHOTO OF THE ENTRANCE
      </span>
      {value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={value}
          alt={`The entrance at ${spaceName}`}
          className="max-h-[170px] w-fit max-w-full rounded-lg border border-line object-cover"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-full border border-line bg-card px-3.5 py-1.5 text-[12px] font-semibold text-ink-soft hover:bg-hoverbg">
          {busy ? "Reading…" : value ? "Replace photo" : "Choose a photo"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              // Let the same file be picked again after a remove.
              e.target.value = "";
            }}
          />
        </label>
        {value && (
          <button
            onClick={() => onChange("")}
            className="cursor-pointer text-[12px] font-semibold text-muted hover:text-[oklch(0.55_0.15_25)]"
          >
            Remove
          </button>
        )}
      </div>
      <span className="text-[11px] text-muted">
        Shown on the booking page and sent with the confirmation email, so they can see the door before they arrive.
      </span>
    </div>
  );
}
