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
        ensureAnyoneCanRespond_(existing);
        ensureSubmitTrigger_(existing);
        return output_({ formId: existingId, responderUrl: existing.getPublishedUrl() });
      }

      const title = "Creator Pass Request — " + String(event.title).slice(0, 150);
      const form = FormApp.create(title);
      form.setTitle(title);
      form.setPublished(true);
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
        // The cover is decorative. A media CDN timeout, unsupported image
        // encoding, or Forms image-processing error must not prevent creating
        // the event's application form.
        let imageItem = null;
        try {
          const image = UrlFetchApp.fetch(event.imageUrl, { muteHttpExceptions: true });
          const responseCode = image.getResponseCode();
          if (responseCode >= 200 && responseCode < 300) {
            imageItem = form.addImageItem().setTitle("Event Details");
            imageItem.setImage(image.getBlob().setName("event-cover"));
          } else {
            console.warn("Skipping creator-pass cover image; image URL returned HTTP " + responseCode + ".");
          }
        } catch (imageError) {
          if (imageItem) {
            try {
              form.deleteItem(imageItem);
            } catch (cleanupError) {
              console.warn("Could not remove the incomplete creator-pass image item.", cleanupError);
            }
          }
          console.warn("Skipping creator-pass cover image; form creation will continue. " + String(imageError && imageError.message || imageError));
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
      ensureAnyoneCanRespond_(form);
      ensureSubmitTrigger_(form);
      return output_({ formId: formId, responderUrl: form.getPublishedUrl() });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return output_({ error: String(error && error.message || "Unable to create the event form.") }, 500);
  }
}

/**
 * Forms access has separate permissions for editors and responders. Add the
 * public responder permission so guests can open and submit the published URL.
 * Requires the Advanced Drive service (Drive API v3) to be enabled in Apps Script.
 */
function ensureAnyoneCanRespond_(form) {
  if (!form.supportsAdvancedResponderPermissions()) {
    throw new Error("This Google Form does not support published responder permissions.");
  }
  if (!form.isPublished()) form.setPublished(true);
  form.setAcceptingResponses(true);

  if (typeof Drive.Permissions.create !== "function") {
    throw new Error("Drive API v3 is required for public Google Forms responder access. Remove the Drive v2 service and add Drive API v3 in Apps Script Services.");
  }

  const formId = form.getId();
  const listOptions = {
    includePermissionsForView: "published",
    fields: "permissions(id,type,role,view)",
  };
  const listPublishedPermissions = function () {
    const result = Drive.Permissions.list(formId, listOptions) || {};
    return result.permissions || [];
  };
  let permissions = listPublishedPermissions();
  const alreadyPublic = permissions.some(function (permission) {
    return permission.type === "anyone" && permission.role === "reader" && permission.view === "published";
  });
  if (!alreadyPublic) {
    const publicResponderPermission = { type: "anyone", view: "published", role: "reader" };
    Drive.Permissions.create(publicResponderPermission, formId);
    permissions = listPublishedPermissions();
  }
  const accessGranted = permissions.some(function (permission) {
    return permission.type === "anyone" && permission.role === "reader" && permission.view === "published";
  });
  if (!accessGranted) {
    throw new Error("Google Drive did not confirm public responder access. Check the Google account or Workspace sharing policy.");
  }
}

/**
 * Run once after enabling the Drive API to repair responder access on forms
 * created before public responder access was added.
 */
function repairExistingCreatorPassFormAccess() {
  const properties = PropertiesService.getScriptProperties().getProperties();
  const formIds = Object.keys(properties)
    .filter(function (key) { return key.indexOf("EVENT_FOR_FORM_") === 0; })
    .map(function (key) { return key.substring("EVENT_FOR_FORM_".length); });
  const failures = [];
  formIds.forEach(function (formId) {
    try {
      const form = FormApp.openById(formId);
      ensureAnyoneCanRespond_(form);
      Logger.log("Public responder access is enabled: " + form.getTitle() + " (" + formId + ")");
    } catch (error) {
      failures.push(formId + ": " + String(error && error.message || error));
      console.error("Could not enable public responder access for form " + formId + ": " + String(error && error.message || error));
    }
  });
  if (failures.length) {
    throw new Error("Responder access repair failed for " + failures.length + " of " + formIds.length + " forms. See the execution log for form IDs and details.");
  }
  Logger.log("Public responder access verified for " + formIds.length + " existing creator pass form(s).");
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
  submitCreatorPassResponse_(form, response);
}

/**
 * Recovery tool: run manually to resend recorded responses if an installable
 * submit trigger failed. The admin endpoint ignores duplicate phone requests.
 */
function syncAllCreatorPassResponses() {
  const properties = PropertiesService.getScriptProperties().getProperties();
  const formIds = Object.keys(properties)
    .filter(function (key) { return key.indexOf("EVENT_FOR_FORM_") === 0; })
    .map(function (key) { return key.substring("EVENT_FOR_FORM_".length); });
  let sent = 0;
  let failed = 0;
  formIds.forEach(function (formId) {
    const form = FormApp.openById(formId);
    ensureSubmitTrigger_(form);
    form.getResponses().forEach(function (response) {
      try {
        submitCreatorPassResponse_(form, response);
        sent += 1;
      } catch (error) {
        failed += 1;
        console.error("Creator-pass sync failed for response " + response.getId() + " on form " + formId + ": " + String(error && error.message || error));
      }
    });
  });
  Logger.log("Creator-pass response sync finished. Sent or already recorded: " + sent + "; failed: " + failed + ".");
}

function submitCreatorPassResponse_(form, response) {
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
    const responseText = String(result.getContentText() || "").slice(0, 300);
    throw new Error("RSVP admin could not save this application (HTTP " + result.getResponseCode() + "): " + responseText + ". The response remains available in Google Forms.");
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
