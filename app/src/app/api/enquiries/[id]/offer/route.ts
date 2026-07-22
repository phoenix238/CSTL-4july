import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { guarded } from "@/lib/api";
import { prisma, getSettings } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { composeOfferMessage } from "@/lib/booking/offer";
import { getOrCreateOfferToken, offerUrl } from "@/lib/intake";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";

/** Offer a client a group of times (nothing booked yet). Body: { clientName, clinic, times: ISO[], sendEmail, email?, emailBody? } */
export const POST = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { clientName, clinic, times, sendEmail: send, email, emailBody, clientId } = await req.json();
  if (!Array.isArray(times) || times.length === 0) {
    return NextResponse.json({ error: "Pick at least one time to offer" }, { status: 400 });
  }
  const dates = times.map((t: string) => new Date(t)).filter((d: Date) => !Number.isNaN(d.getTime()));

  await prisma.enquiry.update({
    where: { id },
    data: {
      status: "offered",
      clinic,
      offeredTimes: dates,
      // link to the client so the offer also shows on their profile
      ...(clientId ? { clientId } : {}),
    },
  });

  let body = (emailBody?.trim() as string) || composeOfferMessage(clientName || "", clinic as Clinic, dates);
  if (send && email) {
    if (!clientId) {
      return NextResponse.json({ error: "Link this enquiry to a client before sending an offer email." }, { status: 400 });
    }
    const settings = await getSettings();
    const link = offerUrl(settings, await getOrCreateOfferToken(id));
    body = emailBody?.trim() ? `${emailBody.trim()}\n\n${link}` : composeOfferMessage(clientName || "", clinic as Clinic, dates, link);
    await sendEmail(email, `Some session times — ${CLINIC_LABEL[clinic as Clinic]}`, body);
  }
  revalidateTag("shell");

  return NextResponse.json({ ok: true, body });
});
