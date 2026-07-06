"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, Card, Chip, clinicChip, inputClass, PrimaryButton, useToast } from "./ui";

export interface ClientRow {
  id: string;
  name: string;
  email: string;
  clinic: string;
  marketing: boolean;
  last: string;
  next: string;
}

export function ClientsList({ rows }: { rows: ClientRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ name: string; email: string; phone: string; clinic: "waterloo" | "bethnal" }>({
    name: "",
    email: "",
    phone: "",
    clinic: "waterloo",
  });
  const [saving, setSaving] = useState(false);
  const q = search.toLowerCase();
  const filtered = rows.filter(
    (c) => !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
  );

  const createClient = async () => {
    if (!draft.name.trim()) {
      toast("Add a name first");
      return;
    }
    setSaving(true);
    try {
      const client = await api<{ id: string }>("/api/clients", { method: "POST", body: JSON.stringify(draft) });
      toast(`${draft.name} added ✓`);
      router.push(`/clients/${client.id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't add that client");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex max-w-[1080px] flex-col gap-4 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
      <header className="flex items-center justify-between gap-4">
        <h1 className="font-serif text-[26px] leading-[1.1] lg:text-[28px]">Clients</h1>
        <div className="flex items-center gap-3">
          <div className="hidden text-[12.5px] text-muted sm:block">One record each · synced to Drive</div>
          <PrimaryButton
            onClick={() => {
              setDraft({ name: "", email: "", phone: "", clinic: "waterloo" });
              setAdding(!adding);
            }}
            className="px-4 py-2 text-[13px]"
          >
            {adding ? "Cancel" : "+ New client"}
          </PrimaryButton>
        </div>
      </header>

      {adding && (
        <Card className="flex flex-col gap-3 border-[1.5px] border-clay/35 px-4 py-3.5">
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">
                FULL NAME
              </span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className={inputClass}
                autoFocus
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">EMAIL</span>
              <input
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">PHONE</span>
              <input
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                className={inputClass}
              />
            </label>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] font-semibold tracking-[0.08em] text-[oklch(0.58_0.03_55)]">CLINIC</span>
            <div className="flex rounded-full border border-line bg-[oklch(0.955_0.012_82)] p-[3px]">
              {(["waterloo", "bethnal"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setDraft({ ...draft, clinic: c })}
                  className={`cursor-pointer rounded-full px-3.5 py-[6px] text-[12px] font-semibold select-none ${
                    draft.clinic === c ? "bg-clay text-cream" : "text-[oklch(0.45_0.02_60)]"
                  }`}
                >
                  {c === "waterloo" ? "Waterloo" : "Bethnal Green"}
                </button>
              ))}
            </div>
          </div>
          <PrimaryButton onClick={createClient} disabled={saving} className="self-start px-[18px] py-[9px] text-[13px]">
            {saving ? "Adding…" : "Add client"}
          </PrimaryButton>
        </Card>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name or email…"
        className="w-full rounded-full border border-inputline bg-card px-5 py-3 text-[14.5px] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.6)]"
      />
      <Card className="px-4 py-0.5 lg:px-5">
        {filtered.map((c, i) => {
          const chip = clinicChip(c.clinic);
          return (
            <Link
              key={c.id}
              href={`/clients/${c.id}`}
              className={`flex cursor-pointer items-center gap-3.5 py-3.5 ${i < filtered.length - 1 ? "border-b border-hairline" : ""}`}
            >
              <div className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full bg-[oklch(0.93_0.02_60)] font-serif text-sm font-medium text-[oklch(0.45_0.04_55)]">
                {c.name
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 3)}
              </div>
              <div className="w-[200px] flex-none min-w-0">
                <div className="font-serif text-[15.5px] font-medium">{c.name}</div>
                <div className="mt-px overflow-hidden text-[11.5px] text-ellipsis whitespace-nowrap text-muted">
                  {c.email || "no email yet"}
                </div>
              </div>
              <span className="hidden flex-none sm:inline-flex">
                <Chip color={chip.color} bg={chip.bg}>
                  {c.clinic === "waterloo" ? "Waterloo" : "Bethnal Green"}
                </Chip>
              </span>
              <div className="flex-1" />
              <div className="hidden w-[120px] flex-none overflow-hidden text-xs text-ellipsis whitespace-nowrap text-muted md:block">
                Last · {c.last}
              </div>
              <div className="hidden w-[190px] flex-none overflow-hidden text-xs text-ellipsis whitespace-nowrap text-[oklch(0.42_0.06_60)] md:block">
                {c.next}
              </div>
              <div className="hidden w-[95px] flex-none text-xs whitespace-nowrap lg:block">
                <span className={c.marketing ? "text-sage-text" : "text-faint"}>
                  {c.marketing ? "✓ marketing" : "— no mktg"}
                </span>
              </div>
              <div className="text-[15px] text-[oklch(0.62_0.03_55)]">›</div>
            </Link>
          );
        })}
        {filtered.length === 0 && (
          <div className="py-6 text-center text-[13.5px] text-muted">
            {rows.length === 0 ? "No clients yet — book one from Enquiries, or use Import." : `No clients match "${search}"`}
          </div>
        )}
      </Card>
    </div>
  );
}
