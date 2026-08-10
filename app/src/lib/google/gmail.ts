import { getGmailApi, withRetry } from "./client";
import { buildMessage, type Attachment } from "./mime";

export type { Attachment } from "./mime";

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
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  thread?: GmailThread,
  /** e.g. the photo of the door at Bethnal Green, sent inline under the text */
  attachments?: Attachment[],
) {
  const gmail = await getGmailApi();
  const profile = await gmail.users.getProfile({ userId: "me" });
  const from = profile.data.emailAddress;
  const replySubject = thread && !/^re:/i.test(subject) ? `Re: ${subject}` : subject;
  const message = buildMessage({
    to,
    from: from ?? undefined,
    subject: replySubject,
    body,
    inReplyTo: thread?.inReplyTo,
    attachments,
  });
  await withRetry(() =>
    gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: Buffer.from(message).toString("base64url"),
        ...(thread?.threadId ? { threadId: thread.threadId } : {}),
      },
    }),
  );
}
