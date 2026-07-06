import { getGmailApi } from "./client";

/**
 * Send a plain-text email from Phoenix's Gmail.
 *
 * A real display name on "From" (rather than a bare address) is one of the
 * few things under our control that helps with spam classification — most of
 * it comes down to the sender's own account reputation and the recipient's
 * own filters, which no code change here can fix.
 */
export async function sendEmail(to: string, subject: string, body: string) {
  const gmail = await getGmailApi();
  const profile = await gmail.users.getProfile({ userId: "me" });
  const from = profile.data.emailAddress;
  const message = [
    `To: ${to}`,
    ...(from ? [`From: =?UTF-8?B?${Buffer.from("Phoenix Tanner").toString("base64")}?= <${from}>`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
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
    },
  });
}
