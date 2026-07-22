import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma, getSettings } from "@/lib/db";
import { resolveWeeklyHours } from "@/lib/booking/availability";
import { resolveClientCopy } from "@/lib/clientCopy";

/** The editable settings the UI needs (email preview etc.) — no Google secrets. */
export const GET = guarded(async () => {
  const s = await getSettings();
  return NextResponse.json({
    accessNote: s.accessNote,
    emailTemplateWaterloo: s.emailTemplateWaterloo,
    emailTemplateBethnal: s.emailTemplateBethnal,
    paymentDetails: s.paymentDetails,
    waterlooAddress: s.waterlooAddress,
    bethnalAddress: s.bethnalAddress,
    waterlooArrivalNote: s.waterlooArrivalNote,
    bethnalArrivalNote: s.bethnalArrivalNote,
    weeklyHours: resolveWeeklyHours(s.weeklyHours),
    bookingSlotMinutes: s.bookingSlotMinutes,
    bookingMinNoticeMins: s.bookingMinNoticeMins,
    bookingHorizonDays: s.bookingHorizonDays,
    bookingBufferMinutes: s.bookingBufferMinutes,
    chalkFarmBufferMinutes: s.chalkFarmBufferMinutes,
    bookingNotifyEmail: s.bookingNotifyEmail,
    clientCopy: resolveClientCopy(s.clientCopy),
    // Which calendars are wired up — for the calendar page's event composer.
    calendars: { personal: true, room: !!s.roomCalendarId, chalkFarm: !!s.chalkFarmCalendarId },
  });
});

export const PATCH = guarded(async (req: Request) => {
  const data = await req.json();
  const settings = await prisma.appSettings.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });
  return NextResponse.json(settings);
});
