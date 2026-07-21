import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { bookSession } from "@/lib/booking/book";

export const POST = guarded(async (req: Request) => {
  const { enquiryId, ...bookingReq } = await req.json();
  const result = await bookSession(bookingReq);
  if (enquiryId) {
    await prisma.enquiry.update({
      where: { id: enquiryId },
      data: { status: "booked", clientId: result.clientId },
    });
    revalidateTag("shell");
  }
  return NextResponse.json(result);
});
