// LEGACY manual connector: it only forwards forms listed in eventForms below.
// It does not provision forms for current or future events. For the all-events
// workflow, deploy create-event-creator-pass-form.gs as the admin's Apps Script
// web app; the admin creates and links one public form for each published event.
const CREATOR_PASS_FORM_CONFIG = {
  webhookUrl: "https://admin.rsvpdxb.com/api/integrations/google-forms/creator-pass",
  // Existing manually-created forms only. New events are not added here.
  eventForms: {
    "client-pataakha-2026": "1VvAsWM2fEU_4NILdJvtKy0D4cPkzTRbG9ODfe7bTwcM",
  },
};

const CREATOR_PASS_EVENT_QUESTION = "Which event are you requesting a creator pass for?";

function connectCreatorPassForms() {
  const config = CREATOR_PASS_FORM_CONFIG;
  const properties = PropertiesService.getScriptProperties();
  const secret = properties.getProperty("CREATOR_PASS_WEBHOOK_SECRET") || "";
  const entries = Object.entries(config.eventForms || {}).filter(([, formId]) => formId && !String(formId).startsWith("REPLACE_"));
  if (!config.webhookUrl || secret.length < 32 || !entries.length) {
    throw new Error("Set CREATOR_PASS_WEBHOOK_SECRET (32+ characters) and add at least one event/form ID to eventForms.");
  }

  const events = fetchCreatorPassEvents_();
  const eventById = Object.fromEntries(events.map((event) => [event.id, event]));
  const formEventIds = {};
  entries.forEach(([eventId, formId]) => {
    const event = eventById[eventId];
    if (!event) throw new Error(`Event ${eventId} is not currently published and accepting creator pass requests.`);
    const form = FormApp.openById(formId);
    const label = [event.title, event.date, event.venue].filter(Boolean).join(" · ");
    const existing = form.getItems(FormApp.ItemType.LIST).find((item) => item.getTitle() === CREATOR_PASS_EVENT_QUESTION);
    const question = existing ? existing.asListItem() : form.addListItem().setTitle(CREATOR_PASS_EVENT_QUESTION);
    // A dedicated form only offers its own event, preventing cross-event submissions.
    question.setRequired(true).setChoiceValues([label]);
    formEventIds[form.getId()] = eventId;
    console.log(`Connected ${event.title}: ${form.getPublishedUrl()}`);
  });

  properties.setProperties({
    CREATOR_PASS_WEBHOOK_URL: config.webhookUrl,
    CREATOR_PASS_FORM_EVENT_IDS: JSON.stringify(formEventIds),
  });
  ScriptApp.getProjectTriggers()
    .filter((trigger) => ["forwardCreatorPassRequest", "syncCreatorPassEventChoices"].includes(trigger.getHandlerFunction()))
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  entries.forEach(([, formId]) => {
    ScriptApp.newTrigger("forwardCreatorPassRequest").forForm(FormApp.openById(formId)).onFormSubmit().create();
  });
  console.log(`Installed creator-pass submit triggers for ${entries.length} event form(s).`);
}

// Kept as a migration alias for the old setup instructions.
function connectExistingCreatorPassForm() {
  connectCreatorPassForms();
}

function fetchCreatorPassEvents_() {
  const properties = PropertiesService.getScriptProperties();
  const url = CREATOR_PASS_FORM_CONFIG.webhookUrl;
  const secret = properties.getProperty("CREATOR_PASS_WEBHOOK_SECRET") || "";
  const response = UrlFetchApp.fetch(`${url}/events`, {
    method: "get",
    headers: { Authorization: `Bearer ${secret}` },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error(`Could not load creator-pass events (${response.getResponseCode()}): ${response.getContentText()}`);
  }
  const events = JSON.parse(response.getContentText());
  if (!Array.isArray(events)) throw new Error("The creator-pass events response was invalid.");
  return events;
}

function forwardCreatorPassRequest(event) {
  const formId = event.source && event.source.getId ? event.source.getId() : "";
  const formEventIds = JSON.parse(PropertiesService.getScriptProperties().getProperty("CREATOR_PASS_FORM_EVENT_IDS") || "{}");
  const eventId = formEventIds[formId];
  if (!eventId) throw new Error(`No event is configured for submitted form ${formId}. Update eventForms and run connectCreatorPassForms.`);
  sendCreatorPassResponse_(event.response, eventId);
}

// Import all existing responses from every configured event form.
function syncExistingCreatorPassResponses() {
  const formEventIds = JSON.parse(PropertiesService.getScriptProperties().getProperty("CREATOR_PASS_FORM_EVENT_IDS") || "{}");
  const formIds = Object.keys(formEventIds);
  if (!formIds.length) throw new Error("Run connectCreatorPassForms first.");
  let synced = 0;
  formIds.forEach((formId) => {
    FormApp.openById(formId).getResponses().forEach((response) => {
      sendCreatorPassResponse_(response, formEventIds[formId]);
      synced += 1;
    });
  });
  console.log(`Processed ${synced} recorded responses across ${formIds.length} form(s). Existing pending duplicates are safely ignored.`);
}

function sendCreatorPassResponse_(formResponse, eventId) {
  const properties = PropertiesService.getScriptProperties();
  const answers = Object.fromEntries(formResponse.getItemResponses().map((itemResponse) => [
    itemResponse.getItem().getTitle(),
    String(itemResponse.getResponse() || "").trim(),
  ]));
  const findAnswer = (labels) => {
    const key = Object.keys(answers).find((title) => labels.some((label) => title.toLowerCase().includes(label)));
    return key ? answers[key] : "";
  };
  const response = UrlFetchApp.fetch(properties.getProperty("CREATOR_PASS_WEBHOOK_URL"), {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${properties.getProperty("CREATOR_PASS_WEBHOOK_SECRET")}` },
    payload: JSON.stringify({
      eventId,
      name: findAnswer(["full name", "your name", "name"]),
      email: findAnswer(["email"]) || String(formResponse.getRespondentEmail() || "").trim(),
      phone: findAnswer(["whatsapp", "phone", "mobile", "contact number"]),
    }),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error(`RSVP DXB request sync failed (${response.getResponseCode()}): ${response.getContentText()}`);
  }
}
