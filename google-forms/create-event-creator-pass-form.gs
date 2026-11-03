/**
 * Deploy this project as a web app under the RSVP DXB automation account.
 * The admin server calls doPost when an event publishes. Each form is created
 * directly in that account, so no external template sharing is required.
 */
function doPost(e) {
  try {
    const body = JSON.parse(e && e.postData && e.postData.contents || "{}");
    const expectedSecret = PropertiesService.getScriptProperties().getProperty("CREATOR_FORM_SECRET") || "";
    if (!expectedSecret || body.secret !== expectedSecret) return output_({ error: "Unauthorized." }, 401);
    const event = body.event || {};
    if (!event.id || !event.title) return output_({ error: "An event ID and title are required." }, 400);

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const properties = PropertiesService.getScriptProperties();
      const existingId = properties.getProperty("FORM_FOR_EVENT_" + event.id);
      if (existingId) {
        const existing = FormApp.openById(existingId);
        ensureSubmitTrigger_(existing);
        return output_({ formId: existingId, responderUrl: existing.getPublishedUrl() });
      }

      const title = "Creator Pass Request — " + String(event.title).slice(0, 150);
      const form = FormApp.create(title);
      form.setTitle(title);
      form.setAcceptingResponses(true);
      const eventDetails = [
        event.brand || "RSVP DXB",
        [event.date, event.time, event.venue, event.area].filter(Boolean).join(" · "),
        event.hashtag || "",
        event.creatorPassNote || "",
      ].filter(Boolean).join("\n");
      form.setDescription("Apply for a creator pass for " + event.title + ".\n\n" + eventDetails);

      form.addTextItem()
        .setTitle("Email")
        .setRequired(true);

      if (event.imageUrl) {
        const image = UrlFetchApp.fetch(event.imageUrl, { muteHttpExceptions: true });
        if (image.getResponseCode() >= 200 && image.getResponseCode() < 300) {
          form.addImageItem()
            .setTitle("Event Details")
            .setImage(image.getBlob().setName("event-cover"));
        }
      }

      form.addTextItem().setTitle("Name").setRequired(true);
      form.addTextItem().setTitle("Mobile Number").setHelpText("Include your country code, for example +971.").setRequired(true);
      form.addTextItem().setTitle("Insta handle").setRequired(true);
      form.addTextItem().setTitle("Following on Ig").setRequired(true);
      form.addParagraphTextItem().setTitle("Address for Zoefur").setRequired(true);

      const formId = form.getId();
      properties.setProperty("FORM_FOR_EVENT_" + event.id, formId);
      properties.setProperty("EVENT_FOR_FORM_" + formId, String(event.id));
      ensureSubmitTrigger_(form);
      return output_({ formId: formId, responderUrl: form.getPublishedUrl() });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return output_({ error: String(error && error.message || "Unable to create the event form.") }, 500);
  }
}

function ensureSubmitTrigger_(form) {
  const exists = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === "onCreatorPassSubmit" && trigger.getTriggerSourceId() === form.getId();
  });
  if (!exists) ScriptApp.newTrigger("onCreatorPassSubmit").forForm(form).onFormSubmit().create();
}

function onCreatorPassSubmit(e) {
  const form = e && e.source;
  const response = e && e.response;
  if (!form || !response) throw new Error("Missing Google Form submission data.");
  const properties = PropertiesService.getScriptProperties();
  const eventId = properties.getProperty("EVENT_FOR_FORM_" + form.getId());
  const webhookUrl = properties.getProperty("RSVP_CREATOR_PASS_WEBHOOK_URL");
  const webhookSecret = properties.getProperty("RSVP_CREATOR_PASS_WEBHOOK_SECRET");
  if (!eventId || !webhookUrl || !webhookSecret) throw new Error("Configure the RSVP creator-pass webhook properties.");
  const answers = {};
  response.getItemResponses().forEach(function (itemResponse) {
    answers[String(itemResponse.getItem().getTitle() || "").toLowerCase()] = String(itemResponse.getResponse() || "");
  });
  const answerFor = function (startsWith) {
    const key = Object.keys(answers).find(function (title) { return title.indexOf(startsWith) === 0; });
    return key ? answers[key] : "";
  };
  const payload = {
    eventId: eventId,
    name: answerFor("name"),
    email: response.getRespondentEmail() || answerFor("email"),
    phone: answerFor("mobile") || answerFor("phone") || answerFor("whatsapp"),
    instagramHandle: answerFor("insta"),
    instagramFollowers: answerFor("following") || answerFor("followers"),
    creatorAddress: answerFor("address"),
  };
  const result = UrlFetchApp.fetch(webhookUrl, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + webhookSecret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (result.getResponseCode() < 200 || result.getResponseCode() >= 300) {
    throw new Error("RSVP admin could not save this application (HTTP " + result.getResponseCode() + "). The response remains available in Google Forms.");
  }
}

function authorizeCreatorPassAutomation() {
  const testForm = FormApp.create("RSVP DXB creator pass authorization check");
  let trigger;
  try {
    DriveApp.getFileById(testForm.getId()).getName();
    UrlFetchApp.fetch("https://www.google.com", { muteHttpExceptions: true });
    trigger = ScriptApp.newTrigger("onCreatorPassSubmit").forForm(testForm).onFormSubmit().create();
  } finally {
    if (trigger) {
      try {
        ScriptApp.deleteTrigger(trigger);
      } catch (cleanupError) {
        console.warn("Could not remove the temporary authorization trigger. Remove it from the Triggers page if it remains.", cleanupError);
      }
    }
    try {
      DriveApp.getFileById(testForm.getId()).setTrashed(true);
    } catch (cleanupError) {
      console.warn("Could not trash the temporary authorization form. Remove it from Google Drive if it remains.", cleanupError);
    }
  }
}

function output_(payload, status) {
  // Apps Script web apps do not expose a configurable HTTP status on TextOutput;
  // the admin server validates the JSON result and responder URL.
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
