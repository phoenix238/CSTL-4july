import { prisma } from "@/lib/db";
import { ensureClientFolderAndDoc, renameClientDrive } from "@/lib/google/drive";
import { upsertMarketingRow } from "@/lib/google/sheets";
import { cancelBookingEvents } from "@/lib/google/calendar";

/**
 * Single source of truth: before creating a client, look for an existing one
 * by email, phone, or (fuzzy) name — one client, one record.
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
      clinic: data.clinic ?? "waterloo",
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
 * Delete a client entirely: cancel any upcoming bookings (freeing the Google
 * Calendar events) then remove the record — bookings/notes cascade, enquiries
 * that referenced them are unlinked (not deleted). Their Drive folder + Doc
 * are left untouched, so nothing in Drive is ever lost.
 */
export async function deleteClient(id: string) {
  const upcoming = await prisma.booking.findMany({
    where: { clientId: id, status: "confirmed", startsAt: { gte: new Date() } },
  });
  for (const booking of upcoming) {
    await cancelBookingEvents(booking.id);
  }
  await prisma.client.delete({ where: { id } });
}
