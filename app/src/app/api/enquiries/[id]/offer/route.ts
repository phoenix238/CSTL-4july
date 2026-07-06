import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { composeOfferMessage } from "@/lib/booking/offer";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";

/**
 * Offer a client a group of times (nothing booked yet).
 * Body: { clientName, clinic, times: ISO[], sendEmail, email?, emailBody?, clientId? }
 * id "new" — booking a returning client from their profile, where no enquiry
 * exists yet: one is created so the offer is tracked in the inbox and on the
 * client's profile ("which time did they pick?").
 */
export const POST = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { clientName, clinic, times, sendEmail: send, email, emailBody, clientId } = await req.json();
  if (!Array.isArray(times) || times.length === 0) {
    return NextResponse.json({ error: "Pick at least one time to offer" }, { status: 400 });
  }
  const dates = times.map((t: string) => new Date(t)).filter((d: Date) => !Number.isNaN(d.getTime()));
  const body = (emailBody?.trim() as string) || composeOfferMessage(clientName || "", clinic as Clinic, dates);

  if (id === "new" && !clientId) {
    return NextResponse.json({ error: "An offer without an enquiry needs a saved client" }, { status: 400 });
  }

  if (send && email) {
    await sendEmail(email, `Some session times — ${CLINIC_LABEL[clinic as Clinic]}`, body);
  }

  const enquiry =
    id === "new"
      ? await prisma.enquiry.create({
          data: {
            via: "MANUAL",
            name: clientName || "",
            text: `Session times offered to ${clientName || "a client"} from their profile.`,
            status: "offered",
            offeredTimes: dates,
            clientId,
          },
        })
      : await prisma.enquiry.update({
          where: { id },
          data: {
            status: "offered",
            offeredTimes: dates,
            // link to the client so the offer also shows on their profile
            ...(clientId ? { clientId } : {}),
          },
        });

  return NextResponse.json({ ok: true, body, enquiryId: enquiry.id });
});
