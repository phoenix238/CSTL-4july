import { prisma, getSettings } from "@/lib/db";
import {
  canRescheduleSelf,
  suggestedGoodwillPence,
  summariseAccount,
  type AccountBooking,
  type AccountSummary,
} from "@/lib/account";
import { getOrCreatePaymentRef, portalUrl } from "@/lib/portal";
import type { Clinic } from "@/lib/booking/rules";

/**
 * Everything the client portal shows, assembled in one place.
 *
 * The page and the API routes both build from this, so what a client is *shown*
 * they can do and what the server will actually *let* them do come from the same
 * computation. A disabled button and a rejected request can't disagree.
 */

/** Resolve a portal token to its client, or null. The portal's whole auth check. */
export async function loadPortalClient(token: string) {
  if (!token || token.length < 8) return null;
  return prisma.client.findFirst({ where: { portalToken: token } });
}

export interface PortalSession {
  id: string;
  startsAtISO: string;
  clinic: Clinic;
  paid: boolean;
  amountPence: number | null;
  goodwillPence: number;
  goodwillReason: string;
  goodwillSettled: boolean;
  goodwillWaived: boolean;
  cancelled: boolean;
}

export interface PortalUpcoming extends PortalSession {
  /** far enough ahead to move it themselves */
  canReschedule: boolean;
  /** goodwill suggested if they cancel right now, in pence (0 outside the window) */
  cancelGoodwillPence: number;
}

export interface PortalView {
  clientName: string;
  firstName: string;
  paymentRef: string;
  preferredClinic: Clinic;
  upcoming: PortalUpcoming | null;
  /** past and cancelled sessions, most recent first */
  history: PortalSession[];
  account: AccountSummary;
  bank: { accountName: string; sortCode: string; accountNumber: string; note: string };
  /** true when any bank detail is filled in — the panel is hidden entirely otherwise */
  hasBankDetails: boolean;
  noticeHours: number;
  lateCancelGoodwillPence: number;
  selfBookEnabled: boolean;
  receiptsEnabled: boolean;
  hasEmail: boolean;
  portalLink: string;
}

function toAccountBooking(b: {
  id: string;
  startsAt: Date;
  clinic: string;
  status: string;
  amountPence: number | null;
  paid: boolean;
  goodwillPence: number;
  goodwillSettled: boolean;
  goodwillWaived: boolean;
  goodwillReason: string;
}): AccountBooking {
  return b;
}

export async function buildPortalView(clientId: string, now = new Date()): Promise<PortalView> {
  const [settings, client, bookings] = await Promise.all([
    getSettings(),
    prisma.client.findUniqueOrThrow({ where: { id: clientId } }),
    prisma.booking.findMany({ where: { clientId }, orderBy: { startsAt: "desc" } }),
  ]);

  // Created on first view rather than up front, so a client who never opens their
  // page never consumes a number in the sequence.
  const paymentRef = await getOrCreatePaymentRef(clientId);

  const account = summariseAccount(bookings.map(toAccountBooking), now);

  // The next confirmed session. Only one is ever offered for self-service: the
  // booking flow already replaces an existing upcoming slot rather than stacking,
  // so "your session" is unambiguous.
  const upcomingRow = [...bookings]
    .reverse()
    .find((b) => b.status === "confirmed" && b.startsAt.getTime() > now.getTime());

  const toSession = (b: (typeof bookings)[number]): PortalSession => ({
    id: b.id,
    startsAtISO: b.startsAt.toISOString(),
    clinic: b.clinic as Clinic,
    paid: b.paid,
    amountPence: b.amountPence,
    goodwillPence: b.goodwillPence,
    goodwillReason: b.goodwillReason,
    goodwillSettled: b.goodwillSettled,
    goodwillWaived: b.goodwillWaived,
    cancelled: b.status === "cancelled",
  });

  const upcoming: PortalUpcoming | null = upcomingRow
    ? {
        ...toSession(upcomingRow),
        canReschedule: canRescheduleSelf(upcomingRow.startsAt, settings.portalNoticeHours, now),
        cancelGoodwillPence: suggestedGoodwillPence(
          upcomingRow.startsAt,
          settings.portalNoticeHours,
          settings.lateCancelGoodwillPence,
          now,
        ),
      }
    : null;

  const history = bookings.filter((b) => b.id !== upcomingRow?.id).map(toSession);

  const bank = {
    accountName: settings.bankAccountName,
    sortCode: settings.bankSortCode,
    accountNumber: settings.bankAccountNumber,
    note: settings.bankPaymentNote,
  };

  return {
    clientName: client.name,
    firstName: client.name.split(" ")[0] || "there",
    paymentRef,
    preferredClinic: (client.clinic as Clinic) ?? "waterloo",
    upcoming,
    history,
    account,
    bank,
    hasBankDetails: Boolean(bank.accountName || bank.sortCode || bank.accountNumber),
    noticeHours: settings.portalNoticeHours,
    lateCancelGoodwillPence: settings.lateCancelGoodwillPence,
    selfBookEnabled: settings.portalSelfBook,
    receiptsEnabled: settings.portalReceipts,
    hasEmail: Boolean(client.email),
    portalLink: portalUrl(settings, client.portalToken),
  };
}
