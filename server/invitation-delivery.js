import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const htmlEscape = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);

const eventDateLabel = (date) => {
  const value = String(date ?? "").slice(0, 10);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : null;
  return parsed && !Number.isNaN(parsed.getTime())
    ? new Intl.DateTimeFormat("en-AE", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(parsed)
    : value;
};

export const invitationEventDetails = (event) => {
  const date = eventDateLabel(event.date);
  const venue = [event.venue, event.area].filter(Boolean).join(", ");
  return [date, event.time, venue].filter(Boolean).join(" · ") || "Dubai";
};

const providerMessage = async (response, provider) => {
  if (response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  const detail =
    payload?.message || payload?.error?.message || payload?.error || "";
  return String(detail || `${provider} returned HTTP ${response.status}.`).slice(
    0,
    240,
  );
};

export async function sendInvitationEmail({ guestName, email, event, invitationUrl, tableNo }) {
  if (!email) return { status: "skipped", message: "No email address was provided." };
  const region = String(process.env.SES_REGION || process.env.AWS_REGION || "").trim();
  const from = String(process.env.SES_FROM_EMAIL || "").trim() || "RSVP DXB <vinitahirani@rsvpdxb.com>";
  if (!region || !from)
    return {
      status: "not_configured",
      message: "Email delivery is not configured. Set SES_REGION or AWS_REGION.",
    };

  const title = String(event.title || "You're invited");
  const details = invitationEventDetails(event);
  const tableLine = tableNo ? `Your table: ${tableNo}` : "";
  const text = [
    `Dear ${guestName},`,
    "",
    `You are invited to ${title} with RSVP DXB.`,
    details,
    tableLine,
    "",
    `Please respond using your private RSVP link: ${invitationUrl}`,
    "",
    "We look forward to seeing you.",
    "RSVP DXB",
  ].filter((line) => line !== "").join("\n");
  const safeGuest = htmlEscape(guestName);
  const safeTitle = htmlEscape(title);
  const safeDetails = htmlEscape(details);
  const safeTableLine = tableLine ? `<p>${htmlEscape(tableLine)}</p>` : "";
  const safeUrl = htmlEscape(invitationUrl);
  const html = `<!doctype html><html><body style="margin:0;background:#f3e3cb;color:#2e1c10;font-family:Arial,sans-serif"><main style="max-width:560px;margin:32px auto;padding:36px 28px;background:#fbf3e7;border:1px solid #d2b995;border-radius:12px"><p style="color:#86501f;font-size:12px;letter-spacing:2px;text-transform:uppercase">RSVP DXB</p><h1 style="font-size:28px;font-weight:500">You are invited, ${safeGuest}</h1><p>We would love to welcome you to <strong>${safeTitle}</strong>.</p><p>${safeDetails}</p>${safeTableLine}<p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;padding:13px 22px;border-radius:10px;background:#86501f;color:#fff6e9;text-decoration:none">View your invitation</a></p><p style="font-size:12px;color:#705238">We look forward to seeing you.<br />RSVP DXB</p></main></body></html>`;

  try {
    const ses = new SESClient({ region });
    await ses.send(new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Charset: "UTF-8", Data: `You're invited to ${title} | RSVP DXB` },
        Body: {
          Text: { Charset: "UTF-8", Data: text },
          Html: { Charset: "UTF-8", Data: html },
        },
      },
    }));
    return {
      status: "submitted",
      message: "Accepted by Amazon SES; inbox delivery is not confirmed.",
    };
  } catch (error) {
    const detail = String(error?.message || "").trim();
    return {
      status: "failed",
      message: detail.slice(0, 240) || "Could not send through Amazon SES. Check AWS credentials, region, and SES permissions.",
    };
  }
}

export async function sendMembershipApprovalEmail({ name, email }) {
  if (!email) return { status: "skipped", message: "No email address is on this application." };
  const region = String(process.env.SES_REGION || process.env.AWS_REGION || "").trim();
  const from = String(process.env.SES_FROM_EMAIL || "").trim() || "RSVP DXB <vinitahirani@rsvpdxb.com>";
  if (!region || !from)
    return {
      status: "not_configured",
      message: "Member approved, but email delivery is not configured (SES_REGION / AWS_REGION).",
    };

  const safeName = htmlEscape(name || "there");
  const siteUrl = String(process.env.PUBLIC_SITE_URL || "https://rsvpdxb.com").replace(/\/$/, "");
  const signInUrl = `${siteUrl}/signin`;
  const subject = "You're in. Welcome to RSVP DXB.";
  const text = [
    `Hi ${name || "there"},`,
    "",
    "Consider this your invitation. You can now browse events, request tickets and wishlist private dinners.",
    "",
    "The door's open.",
    "",
    "Sign in with the email address and password you used when applying.",
    `Enter the Inner Circle: ${signInUrl}`,
    "",
    "Team RSVP DXB",
  ].join("\n");
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head><body style="margin:0;padding:24px 12px;background:#f3e3cb;color:#2e1c10;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%"><div style="display:none;max-height:0;overflow:hidden;opacity:0">The door's open.</div><main style="max-width:580px;margin:0 auto;background:#fbf3e7;border:1px solid #d2b995;border-radius:16px;overflow:hidden"><header style="padding:26px 30px;background:#211b17"><div style="font-family:Georgia,'Times New Roman',serif;color:#d6b47a;font-size:25px;letter-spacing:2px;font-weight:700">RSVP DXB</div><div style="margin-top:5px;color:#c5b9a9;font-size:10px;letter-spacing:2px;text-transform:uppercase">Private events · Dubai</div></header><div style="height:4px;background:#80512f"></div><section style="padding:34px 30px 30px"><div style="display:inline-block;padding:7px 12px;border-radius:999px;background:#f0dfc2;color:#80512f;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700">Membership approved</div><h1 style="margin:18px 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:32px;line-height:1.2;font-weight:500;color:#261d17">You're in. Welcome to RSVP DXB.</h1><p style="margin:0 0 14px;font-size:16px;line-height:1.7">Hi ${safeName},</p><p style="margin:0;color:#544a42;font-size:15px;line-height:1.75">Consider this your invitation. You can now browse events, request tickets and wishlist private dinners.</p><p style="margin:26px 0 8px"><a href="${htmlEscape(signInUrl)}" style="display:inline-block;padding:14px 23px;border-radius:8px;background:#80512f;color:#fff;text-decoration:none;font-size:15px;font-weight:700">Enter the Inner Circle&nbsp; →</a></p><p style="margin:24px 0 0;color:#544a42;font-size:14px;line-height:1.7"><strong style="color:#2d241d">Team RSVP DXB</strong></p></section><footer style="padding:18px 30px;background:#f7efe4;border-top:1px solid #eee1d0;color:#82776d;font-size:11px;line-height:1.65">You received this message because your RSVP DXB membership application was approved.<br><span style="color:#a0978e">© RSVP DXB · Dubai, UAE</span></footer></main></body></html>`;

  try {
    const ses = new SESClient({ region });
    await ses.send(new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Charset: "UTF-8", Data: subject },
        Body: {
          Text: { Charset: "UTF-8", Data: text },
          Html: { Charset: "UTF-8", Data: html },
        },
      },
    }));
    return { status: "submitted", message: "Welcome email accepted by Amazon SES." };
  } catch (error) {
    return {
      status: "failed",
      message: `Member approved, but the welcome email could not be sent: ${String(error?.message || "Check SES credentials and permissions.").slice(0, 180)}`,
    };
  }
}

export async function sendMemberActivationEmail({ name, email, activationUrl }) {
  if (!email) return { status: "skipped", message: "No email address is available for account setup." };
  const region = String(process.env.SES_REGION || process.env.AWS_REGION || "").trim();
  const from = String(process.env.SES_FROM_EMAIL || "").trim() || "RSVP DXB <vinitahirani@rsvpdxb.com>";
  if (!region) return { status: "not_configured", message: "Member approved, but account setup email is not configured." };
  const safeName = htmlEscape(name || "there");
  const safeUrl = htmlEscape(activationUrl);
  const subject = "Your RSVP DXB application is approved — set up your account";
  const text = `Hi ${name || "there"},\n\nYour RSVP DXB application is approved. Create your password using this one-time link, which expires in 30 minutes:\n\n${activationUrl}\n\nAfter setting your password, sign in with this email address.\n\nTeam RSVP DXB`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3e3cb;color:#2e1c10;font-family:Arial,sans-serif"><main style="max-width:560px;margin:32px auto;padding:36px 28px;background:#fbf3e7;border:1px solid #d2b995;border-radius:12px"><p style="color:#86501f;font-size:12px;letter-spacing:2px;text-transform:uppercase">RSVP DXB</p><h1 style="font-size:28px;font-weight:500">Your application is approved</h1><p>Hello ${safeName},</p><p>Your RSVP DXB application is approved. Set a password to activate your new account. This one-time link expires in 30 minutes.</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;padding:13px 22px;border-radius:10px;background:#86501f;color:#fff6e9;text-decoration:none">Set your password</a></p><p>After setup, sign in with this email address.</p><p style="font-size:12px;color:#705238">Team RSVP DXB</p></main></body></html>`;
  try {
    const ses = new SESClient({ region });
    await ses.send(new SendEmailCommand({ Source: from, Destination: { ToAddresses: [email] }, Message: {
      Subject: { Charset: "UTF-8", Data: subject },
      Body: { Text: { Charset: "UTF-8", Data: text }, Html: { Charset: "UTF-8", Data: html } },
    } }));
    return { status: "submitted", message: "Account setup email accepted by Amazon SES; inbox delivery is not confirmed." };
  } catch (error) {
    return { status: "failed", message: `Member approved, but account setup email failed: ${String(error?.message || "Check SES configuration.").slice(0, 180)}` };
  }
}

export async function sendRsvpDecisionEmail({ name, email, event, track, guestNames = [], deliverables = "", status }) {
  if (!email) return { status: "skipped", message: "No email address is on this RSVP." };
  const region = String(process.env.SES_REGION || process.env.AWS_REGION || "").trim();
  const from = String(process.env.SES_FROM_EMAIL || "").trim() || "RSVP DXB <vinitahirani@rsvpdxb.com>";
  if (!region || !from) return { status: "not_configured", message: "Email delivery is not configured." };

  const eventDetails = invitationEventDetails(event);
  const party = [name, ...guestNames].filter(Boolean).join(", ");
  let subject;
  let title;
  let message;
  if (status === "accepted") {
    subject = `You're on the list · ${event.title} | RSVP DXB`;
    title = "You're on the list!";
    message = `We're delighted to confirm your place at ${event.title}.\n\nDate and time: ${eventDetails}\nYour party: ${party || "You"}${track === "Creators" && deliverables ? `\nCreator reminder: ${deliverables}. Please tag @rsvpdxb and the event handles.` : ""}\n\nPlease show this message at the door. We can't wait to host you.`;
  } else if (status === "declined") {
    subject = `An update about ${event.title} | RSVP DXB`;
    title = "An update about your RSVP";
    message = `Thank you for your interest in ${event.title}. This event had more requests than available places, and we weren't able to include everyone this time. We'd love to keep you in mind for upcoming RSVP DXB events.`;
  } else if (status === "waitlisted") {
    subject = `Your RSVP is waitlisted · ${event.title} | RSVP DXB`;
    title = "You're on the waitlist";
    message = `Thank you for your interest in ${event.title}. Your request is on the waitlist. We'll contact you if a place opens.`;
  } else {
    return { status: "skipped", message: "This RSVP status does not send a decision email." };
  }
  const safeName = htmlEscape(name || "there");
  const safeTitle = htmlEscape(title);
  const safeMessage = htmlEscape(message).replaceAll("\n", "<br />");
  const html = `<!doctype html><html><body style="margin:0;background:#f3e3cb;color:#2e1c10;font-family:Arial,sans-serif"><main style="max-width:560px;margin:32px auto;padding:36px 28px;background:#fbf3e7;border:1px solid #d2b995;border-radius:12px"><p style="color:#86501f;font-size:12px;letter-spacing:2px;text-transform:uppercase">RSVP DXB</p><h1 style="font-size:28px;font-weight:500">${safeTitle}</h1><p>Hello ${safeName},</p><p style="line-height:1.7">${safeMessage}</p><p style="font-size:12px;color:#705238">Warm regards,<br />The RSVP DXB team</p></main></body></html>`;
  try {
    const ses = new SESClient({ region });
    await ses.send(new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [email] },
      Message: { Subject: { Charset: "UTF-8", Data: subject }, Body: { Text: { Charset: "UTF-8", Data: `Hello ${name},\n\n${message}\n\nWarm regards,\nThe RSVP DXB team` }, Html: { Charset: "UTF-8", Data: html } } },
    }));
    return { status: "submitted", message: "Accepted by Amazon SES; inbox delivery is not confirmed." };
  } catch (error) {
    return { status: "failed", message: String(error?.message || "Could not send through Amazon SES.").slice(0, 240) };
  }
}

function creatorPassEmailHtml({ name, event, accepted, waitlisted, entryCode, message, details }) {
  const safeName = htmlEscape(name || "there");
  const safeTitle = htmlEscape(event.title);
  const safeDetails = htmlEscape(details);
  const safeCode = htmlEscape(entryCode);
  const heading = accepted ? "Your pass is confirmed" : waitlisted ? "You're on the waitlist" : "An update about your request";
  const content = accepted
    ? `<p style="margin:0 0 22px;color:#604b3a;font-size:16px;line-height:1.65">Your creator pass for <strong style="color:#2e1c10">${safeTitle}</strong> is confirmed. We look forward to welcoming you.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;border:1px solid #e4ceb0;border-radius:12px;background:#fffaf2"><tr><td style="padding:20px 22px"><p style="margin:0 0 8px;color:#9a6a32;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase">Your event</p><p style="margin:0;color:#2e1c10;font-size:17px;font-weight:bold;line-height:1.45">${safeTitle}</p><p style="margin:8px 0 0;color:#725b45;font-size:14px;line-height:1.6">${safeDetails}</p></td></tr></table><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;border-radius:12px;background:#2e1c10"><tr><td align="center" style="padding:20px 16px"><p style="margin:0 0 8px;color:#e4bc7a;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">Door entry code</p><p style="margin:0;color:#fff8eb;font-family:Arial,sans-serif;font-size:28px;font-weight:bold;letter-spacing:3px">${safeCode}</p></td></tr></table><p style="margin:0;padding:14px 16px;border-left:3px solid #bd8a48;background:#f7ead5;color:#6c533a;font-size:13px;line-height:1.6">Show this code to the door team when you arrive. This is a complimentary creator pass, not a paid ticket.</p>`
    : `<p style="margin:0 0 22px;color:#604b3a;font-size:16px;line-height:1.7">${htmlEscape(message)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e4ceb0;border-radius:12px;background:#fffaf2"><tr><td style="padding:20px 22px"><p style="margin:0 0 8px;color:#9a6a32;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase">Event</p><p style="margin:0;color:#2e1c10;font-size:17px;font-weight:bold">${safeTitle}</p><p style="margin:8px 0 0;color:#725b45;font-size:14px;line-height:1.6">${safeDetails}</p></td></tr></table>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head><body style="margin:0;padding:0;background:#f3e3cb;color:#2e1c10;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${htmlEscape(heading)} · ${safeTitle}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3e3cb"><tr><td align="center" style="padding:28px 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;border:1px solid #ddc5a3;border-radius:18px;background:#fbf3e7;overflow:hidden"><tr><td style="padding:24px 30px;background:#2e1c10"><p style="margin:0;color:#e4bc7a;font-size:12px;font-weight:bold;letter-spacing:3px;text-transform:uppercase">RSVP DXB</p><p style="margin:7px 0 0;color:#f7ead5;font-size:10px;letter-spacing:2px;text-transform:uppercase">Creator pass</p></td></tr><tr><td style="padding:30px"><p style="margin:0 0 9px;color:#9a6a32;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">${accepted ? "You're on the list" : waitlisted ? "A place may open" : "Request update"}</p><h1 style="margin:0 0 16px;color:#2e1c10;font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:normal;line-height:1.2">${htmlEscape(heading)}</h1><p style="margin:0 0 22px;color:#604b3a;font-size:15px;line-height:1.6">Hello ${safeName},</p>${content}<p style="margin:26px 0 0;color:#725b45;font-size:13px;line-height:1.6">Warm regards,<br><strong style="color:#2e1c10">The RSVP DXB team</strong></p></td></tr><tr><td style="padding:15px 30px;border-top:1px solid #e8d7bf;color:#947d63;font-size:11px;line-height:1.5">RSVP DXB · Dubai</td></tr></table></td></tr></table></body></html>`;
}

export async function sendCreatorPassDecisionEmail({ name, email, event, status, entryCode = "" }) {
  if (!email) return { status: "skipped", message: "No email address was provided; contact the guest by phone or WhatsApp manually." };
  if (!["accepted", "waitlisted", "declined"].includes(status))
    return { status: "skipped", message: "This status does not send a creator-pass decision email." };
  const region = String(process.env.SES_REGION || process.env.AWS_REGION || "").trim();
  const from = String(process.env.SES_FROM_EMAIL || "").trim() || "RSVP DXB <vinitahirani@rsvpdxb.com>";
  if (!region || !from) return { status: "not_configured", message: "Decision saved, but email is not configured (SES_REGION / AWS_REGION)." };

  const details = invitationEventDetails(event);
  const accepted = status === "accepted";
  const waitlisted = status === "waitlisted";
  const subject = accepted ? `Your creator pass is confirmed · ${event.title} | RSVP DXB`
    : waitlisted ? `Your creator pass request is waitlisted · ${event.title} | RSVP DXB`
      : `An update about your creator pass · ${event.title} | RSVP DXB`;
  const message = accepted
    ? `Your creator pass for ${event.title} is confirmed.\n\n${details}\n\nYour door entry code: ${entryCode}\nPlease show this code to the door team. This is a complimentary creator pass, not a paid ticket.`
    : waitlisted
      ? `Thank you for requesting a creator pass for ${event.title}. Your request is on the waitlist; the team will contact you if a place opens.`
      : `Thank you for your interest in ${event.title}. Unfortunately, we are unable to offer you a creator pass for this event.`;
  const html = creatorPassEmailHtml({ name, event, accepted, waitlisted, entryCode, message, details });
  try {
    const ses = new SESClient({ region });
    await ses.send(new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [email] },
      Message: { Subject: { Charset: "UTF-8", Data: subject }, Body: { Text: { Charset: "UTF-8", Data: `Hello ${name || "there"},\n\n${message}\n\nWarm regards,\nThe RSVP DXB team` }, Html: { Charset: "UTF-8", Data: html } } },
    }));
    return { status: "submitted", message: "Decision email accepted by Amazon SES; inbox delivery is not confirmed." };
  } catch (error) {
    return { status: "failed", message: String(error?.message || "Could not send through Amazon SES.").slice(0, 240) };
  }
}

const normalizeWhatsAppNumber = (phone) => {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `971${digits.slice(1)}`;
  return /^\d{8,15}$/.test(digits) ? digits : "";
};

export async function sendInvitationWhatsApp({ guestName, phone, event, invitationUrl }) {
  if (!phone) return { status: "skipped", message: "No WhatsApp number was provided." };
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || "").trim();
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
  const apiVersion = String(process.env.WHATSAPP_GRAPH_API_VERSION || "").trim();
  const templateName = String(process.env.WHATSAPP_TEMPLATE_NAME || "").trim();
  const language = String(process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US").trim();
  if (!accessToken || !phoneNumberId || !apiVersion || !templateName)
    return {
      status: "not_configured",
      message: "WhatsApp delivery needs Meta Cloud API credentials and an approved invitation template.",
    };
  if (!/^v\d+\.\d+$/.test(apiVersion))
    return { status: "not_configured", message: "Set WHATSAPP_GRAPH_API_VERSION, for example vXX.0." };
  const recipient = normalizeWhatsAppNumber(phone);
  if (!recipient)
    return {
      status: "failed",
      message: "Enter a valid international number, such as +971 50 123 4567.",
    };

  const templateParameters = [
    guestName,
    event.title || "RSVP DXB event",
    invitationEventDetails(event),
    invitationUrl,
  ].map((text) => ({ type: "text", text: String(text) }));
  try {
    const response = await fetch(
      `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipient,
          type: "template",
          template: {
            name: templateName,
            language: { code: language },
            components: [{ type: "body", parameters: templateParameters }],
          },
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    const error = await providerMessage(response, "WhatsApp Cloud API");
    return error
      ? { status: "failed", message: error }
      : {
          status: "submitted",
          message: "Accepted by WhatsApp; delivery to the recipient is not confirmed.",
        };
  } catch {
    return {
      status: "failed",
      message: "Could not reach WhatsApp Cloud API. Check server network access and try again.",
    };
  }
}
