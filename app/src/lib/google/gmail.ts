import { getGmailApi, withRetry } from "./client";
import { recordGoogleFailure, recordGoogleSuccess } from "./health";
import { buildMessage, type Attachment } from "./mime";

export type { Attachment } from "./mime";

/** Set when replying to an enquiry that came in over Gmail — keeps the reply in the client's original thread. */
export interface GmailThread {
  threadId: string;
  /** RFC Message-ID of the message being replied to, e.g. "<abc123@mail.gmail.com>" */
  inReplyTo?: string;
}

export interface SendOptions {
  thread?: GmailThread;
  /** e.g. the photo of the door at Bethnal Green, sent inline under the text */
  attachments?: Attachment[];
  /**
   * Copy this address blindly. Used to give Phoenix the client's own
   * confirmation rather than a second email summarising it — one message about
   * a booking, not two.
   */
  bcc?: string;
  /** Where a reply should go, when it isn't `from` — see MessageParts.replyTo. */
  replyTo?: string;
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
 *
 * Every send records whether Google accepted it. That record is what the
 * connection indicator reads, so a green "Google connected" can no longer sit
 * next to an app that hasn't managed to send anything for a week.
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  thread?: GmailThread,
  attachments?: Attachment[],
  options?: { bcc?: string; replyTo?: string },
) {
  try {
    const gmail = await getGmailApi();
    const profile = await gmail.users.getProfile({ userId: "me" });
    const from = profile.data.emailAddress;
    const replySubject = thread && !/^re:/i.test(subject) ? `Re: ${subject}` : subject;
    const message = buildMessage({
      to,
      from: from ?? undefined,
      bcc: options?.bcc,
      replyTo: options?.replyTo,
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
    await recordGoogleSuccess();
  } catch (err) {
    await recordGoogleFailure(err);
    throw err;
  }
}
