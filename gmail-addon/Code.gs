/**
 * CSTL Gmail add-on — one tap on an open email starts (or continues) that
 * client's enquiry in the booking platform: it creates the enquiry there,
 * then opens the platform straight into it, ready to see real availability
 * and book. Any reply the platform sends lands back in this same Gmail
 * thread. See README.md in this folder for setup.
 */

function onGmailMessage(e) {
  const card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle("CSTL Control Tower"));

  const section = CardService.newCardSection();
  section.addWidget(
    CardService.newTextParagraph().setText(
      "Start this client's enquiry in your booking platform — see availability, book, and reply all from there.",
    ),
  );
  section.addWidget(
    CardService.newTextButton()
      .setText("Start CSTL enquiry")
      .setOnClickAction(CardService.newAction().setFunctionName("startEnquiry")),
  );
  card.addSection(section);
  return card.build();
}

function startEnquiry(e) {
  GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
  const message = GmailApp.getMessageById(e.gmail.messageId);

  const props = PropertiesService.getScriptProperties();
  const appUrl = props.getProperty("APP_URL");
  const secret = props.getProperty("ADDON_SECRET");
  if (!appUrl || !secret) {
    return notify("Set APP_URL and ADDON_SECRET in Project Settings › Script Properties first.");
  }

  const payload = {
    fromName: extractName(message.getFrom()),
    fromEmail: extractEmail(message.getFrom()),
    subject: message.getSubject(),
    body: message.getPlainBody(),
    threadId: message.getThread().getId(),
    messageId: extractMessageIdHeader(message),
  };

  const response = UrlFetchApp.fetch(appUrl.replace(/\/$/, "") + "/api/public/gmail-enquiry", {
    method: "post",
    contentType: "application/json",
    headers: { "x-addon-secret": secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    return notify("Couldn't reach the booking platform (" + response.getResponseCode() + ").");
  }

  const result = JSON.parse(response.getContentText());
  const openUrl = appUrl.replace(/\/$/, "") + "/enquiries?open=" + encodeURIComponent(result.id);
  return CardService.newActionResponseBuilder()
    .setOpenLink(CardService.newOpenLink().setUrl(openUrl))
    .build();
}

function notify(text) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(text))
    .build();
}

function extractName(from) {
  return from.replace(/<.*>/, "").replace(/"/g, "").trim();
}

function extractEmail(from) {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from.trim();
}

/** Pulls the RFC "Message-ID" header out of the raw message — needed so a later reply can thread with In-Reply-To/References. */
function extractMessageIdHeader(message) {
  const raw = message.getRawContent();
  const match = raw.match(/^Message-ID:\s*(<[^>]+>)/im);
  return match ? match[1] : "";
}
