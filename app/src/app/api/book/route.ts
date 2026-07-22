import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { bookSession } from "@/lib/booking/book";

export const POST = guarded(async (req: Request) => {
  const { enquiryId, ...bookingReq } = await req.json();
  let gmailThread: { gmailThreadId?: string; gmailMessageId?: string } = {};
  if (enquiryId) {
    const enquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
      select: { gmailThreadId: true, gmailMessageId: true },
    });
    if (enquiry?.gmailThreadId) {
      gmailThread = { gmailThreadId: enquiry.gmailThreadId, gmailMessageId: enquiry.gmailMessageId };
    }
  }
  const result = await bookSession({ ...bookingReq, ...gmailThread });
  if (enquiryId) {
    await prisma.enquiry.update({
      where: { id: enquiryId },
      data: { status: "booked", clientId: result.clientId },
    });
    revalidateTag("shell");
  }
  return NextResponse.json(result);
});
