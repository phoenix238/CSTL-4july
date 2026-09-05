import { prisma } from "@/lib/db";
import { ensureClientFolderAndDoc, renameClientDrive } from "@/lib/google/drive";
import { upsertMarketingRow } from "@/lib/google/sheets";

/**
 * Match a stranger typing into the public booking form to an existing record —
 * on their email address and nothing else.
 *
 * The fuzzy matching in `findExistingClient` below is right when Phoenix is in
 * the loop and can see who it picked. Unsupervised it is dangerous: "Sarah"
 * matches "Sarah Kimani" on the first-name rule, and the booking that follows
 * would take over her record and cancel her upcoming session. Email is the only
 * identifier a visitor supplies that is actually theirs.
 */
export async function findClientByEmail(email: string) {
  const trimmed = email.trim();
  if (!trimmed) return null;
  return prisma.client.findFirst({ where: { email: { equals: trimmed, mode: "insensitive" } } });
}

/**
 * How to greet someone the public booking page has recognised, without telling
 * a stranger anything they didn't already know.
 *
 * The page has to ask "is this you?" before it books into an existing record —
 * otherwise one person accumulates a record per email typo and their history
 * scatters across all of them. But the confirmation is shown to whoever typed
 * the address, and this is a therapy practice: the fact that a named person is
 * a client is exactly the sort of thing that shouldn't be readable by anyone
 * who can guess an email address.
 *
 * So the stored name is only ever echoed back when the visitor has already
 * typed a matching first name — they knew it before we said it. Anyone else
 * gets a prompt that confirms nothing: it names the address they themselves
 * entered, and asks them to use their own if it isn't theirs.
 */
export function describeReturningClient(
  storedName: string,
  typedName: string,
): { knownName?: string; nameMatches: boolean } {
  const first = (s: string) => s.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const nameMatches = !!first(storedName) && first(storedName) === first(typedName);
  return nameMatches ? { knownName: storedName.trim().split(/\s+/)[0], nameMatches } : { nameMatches };
}

/**
 * Single source of truth: before creating a client, look for an existing one
 * by email, phone, or (fuzzy) name — one client, one record.
 *
 * Fuzzy on purpose, for the flows Phoenix drives himself (enquiries, imports),
 * where he sees and can override the match. Never call this from a public route
 * — use `findClientByEmail`.
 */
export async function findExistingClient(name: string, email?: string, phone?: string) {
  if (email) {
    const byEmail = await prisma.client.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (byEmail) return byEmail;
  }
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length >= 10) {
      const byPhone = await prisma.client.findFirst({ where: { phone: { contains: digits.slice(-10) } } });
      if (byPhone) return byPhone;
    }
  }
  const trimmed = name.trim();
  if (trimmed.length > 3) {
    const byName = await prisma.client.findFirst({
      where: { name: { contains: trimmed, mode: "insensitive" } },
    });
    if (byName) return byName;
    // "Sarah K" should still find "Sarah Kimani"
    const first = trimmed.split(/\s+/)[0];
    if (first.length > 3) {
      const byFirst = await prisma.client.findFirst({
        where: { name: { startsWith: first, mode: "insensitive" } },
      });
      if (byFirst) return byFirst;
    }
  }
  return null;
}

/** Create a client record plus its Drive folder, Doc, and marketing-sheet row. */
export async function createClientWithDrive(data: {
  name: string;
  email?: string;
  phone?: string;
  clinic?: string;
  marketing?: boolean;
}) {
  const client = await prisma.client.create({
    data: {
      name: data.name.trim(),
      email: data.email?.trim() ?? "",
      phone: data.phone?.trim() ?? "",
      clinic: data.clinic ?? "bethnal",
      marketing: data.marketing ?? false,
    },
  });
  await ensureClientFolderAndDoc(client.id);
  await upsertMarketingRow(client.name, client.email, client.marketing);
  return prisma.client.findUniqueOrThrow({ where: { id: client.id } });
}

/** Update details; a name change also renames the Drive folder + Doc. */
export async function updateClientDetails(
  id: string,
  data: Partial<{
    name: string;
    email: string;
    phone: string;
    clinic: string;
    marketing: boolean;
    dob: string;
    occupation: string;
    doctor: string;
    meds: string;
    conditions: string;
    emergency: string;
    referred: string;
    intakeDone: boolean;
    consentGiven: boolean;
  }>,
) {
  const before = await prisma.client.findUniqueOrThrow({ where: { id } });
  const client = await prisma.client.update({ where: { id }, data });
  if (data.name && data.name !== before.name) {
    await renameClientDrive(id, data.name);
  }
  if (
    (data.name && data.name !== before.name) ||
    (data.email !== undefined && data.email !== before.email) ||
    (data.marketing !== undefined && data.marketing !== before.marketing)
  ) {
    await upsertMarketingRow(client.name, client.email, client.marketing);
  }
  return client;
}

/**
 * Delete a client entirely: notes cascade, enquiries that referenced them are
 * unlinked (not deleted). Their Drive folder + Doc are left untouched, so
 * nothing in Drive is ever lost.
 *
 * Refuses if the client has ever had a single booking — that history is the
 * record of what actually happened and this action can't undo itself. The
 * database enforces this too (Booking.client is onDelete: Restrict), but
 * checking here first gives a plain error instead of a raw FK-violation.
 * A client with real booking history isn't meant to be deletable at all; this
 * is for cleaning up duplicates and enquiries that never became one.
 */
export async function deleteClient(id: string) {
  const bookingCount = await prisma.booking.count({ where: { clientId: id } });
  if (bookingCount > 0) {
    throw new Error(
      `This client has ${bookingCount} booking${bookingCount === 1 ? "" : "s"} on record and can't be deleted — that history is kept permanently.`,
    );
  }
  await prisma.client.delete({ where: { id } });
}
