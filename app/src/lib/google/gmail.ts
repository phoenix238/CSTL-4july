import { getGmailApi } from "./client";

/** Set when replying to an enquiry that came in over Gmail — keeps the reply in the client's original thread. */
export interface GmailThread {
  threadId: string;
  /** RFC Message-ID of the message being replied to, e.g. "<abc123@mail.gmail.com>" */
  inReplyTo?: string;
}

/**
 * Send a plain-text email from Phoenix's Gmail.
 *
 * A real display name on "From" (rather than a bare address) is one of the
 * few things under our control that helps with spam classification — most of
 * it comes down to the sender's own account reputation and the recipient's
 * own filters, which no code change here can fix.
 *
 * Pass `thread` to reply inside the client's original Gmail thread (e.g. an
 * enquiry started from the Gmail add-on) instead of sending a fresh email.
 */
export async function sendEmail(to: string, subject: string, body: string, thread?: GmailThread) {
  const gmail = await getGmailApi();
  const profile = await gmail.users.getProfile({ userId: "me" });
  const from = profile.data.emailAddress;
  const replySubject = thread && !/^re:/i.test(subject) ? `Re: ${subject}` : subject;
  const message = [
    `To: ${to}`,
    ...(from ? [`From: =?UTF-8?B?${Buffer.from("Phoenix Tanner").toString("base64")}?= <${from}>`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(replySubject).toString("base64")}?=`,
    ...(thread?.inReplyTo ? [`In-Reply-To: ${thread.inReplyTo}`, `References: ${thread.inReplyTo}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body).toString("base64"),
  ].join("\r\n");
  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: Buffer.from(message).toString("base64url"),
      ...(thread?.threadId ? { threadId: thread.threadId } : {}),
    },
  });
}
