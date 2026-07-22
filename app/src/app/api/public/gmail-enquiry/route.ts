import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { analyseEnquiry } from "@/lib/claude";

/**
 * NOT guarded by the dashboard's Google sign-in — this is called by the Gmail
 * add-on running on Google's servers, which can't do that interactive login.
 * Authorized instead by a shared secret only the add-on knows (set as
 * GMAIL_ADDON_SECRET here and as a Script Property on the add-on side).
 */
export async function POST(req: Request) {
  const secret = req.headers.get("x-addon-secret");
  if (!secret || !process.env.GMAIL_ADDON_SECRET || secret !== process.env.GMAIL_ADDON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { fromName, fromEmail, subject, body, threadId, messageId } = (await req.json()) as {
      fromName?: string;
      fromEmail?: string;
      subject?: string;
      body?: string;
      threadId?: string;
      messageId?: string;
    };
    if (!body?.trim()) {
      return NextResponse.json({ error: "No email body" }, { status: 400 });
    }

    // Claude reads name/phone/email straight out of pasted text — feeding it the
    // sender line makes sure it has the client's real address even when the
    // email body itself never states it.
    const text = `From: ${fromName || ""} <${fromEmail || ""}>\nSubject: ${subject || ""}\n\n${body}`;
    const analysis = await analyseEnquiry(text);

    const enquiry = await prisma.enquiry.create({
      data: {
        text,
        name: analysis.name || fromName || "",
        via: "EMAIL",
        status: "waiting",
        gmailThreadId: threadId || "",
        gmailMessageId: messageId || "",
      },
    });
    revalidateTag("shell");
    return NextResponse.json({ id: enquiry.id });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
