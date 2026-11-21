import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({ region: process.env.SES_REGION || process.env.AWS_REGION || "eu-north-1" });

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

const formatEventDate = (value) => {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(date);
};

export async function sendNewsletterCampaignEmail({
  email, subject, body, imageUrl = "", eventUrl = "", eventTitle = "",
  eventDate = "", eventTime = "", eventVenue = "", unsubscribeUrl,
}) {
  const from = String(process.env.SES_FROM_EMAIL || "").trim() || "RSVP DXB <vinitahirani@rsvpdxb.com>";
  const paragraphs = body.split(/\n{2,}/).map((paragraph) =>
    `<p style="margin:0 0 18px;color:#514133;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.75">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`,
  ).join("");
  const image = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(subject)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:12px">`
    : "";
  const linkedImage = image && eventUrl
    ? `<a href="${escapeHtml(eventUrl)}" target="_blank" style="display:block;text-decoration:none">${image}</a>`
    : image;
  const dateLine = [formatEventDate(eventDate), eventTime].filter(Boolean).join(" · ");
  const venueLine = String(eventVenue || "").trim();
  const eventDetails = eventUrl ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 0;background:#f6ead7;border:1px solid #e5cfad;border-radius:12px"><tr><td style="padding:22px 24px"><p style="margin:0 0 8px;color:#8b531f;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase">Event details</p><p style="margin:0;color:#2e1c10;font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:1.3">${escapeHtml(eventTitle)}</p>${dateLine ? `<p style="margin:10px 0 0;color:#705238;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5">${escapeHtml(dateLine)}</p>` : ""}${venueLine ? `<p style="margin:5px 0 0;color:#705238;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5">${escapeHtml(venueLine)}</p>` : ""}</td></tr></table>` : "";
  const eventCta = eventUrl ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:24px auto 4px"><tr><td align="center" bgcolor="#85501f" style="border-radius:8px"><a href="${escapeHtml(eventUrl)}" target="_blank" style="display:inline-block;padding:16px 30px;border:1px solid #85501f;border-radius:8px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:1.2;text-decoration:none">View event &amp; RSVP&nbsp; &#8594;</a></td></tr></table>` : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:28px 12px;background-color:#ffffff;color:#2e1c10"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#ffffff"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:680px;background-color:#fffaf1;border:1px solid #dfc6a1;border-radius:16px;overflow:hidden"><tr><td style="padding:22px 34px;background-color:#382416"><p style="margin:0;color:#e8c78d;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:3px">RSVP DXB</p><p style="margin:7px 0 0;color:#f7efe2;font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:1.2px">THE GUEST LIST · DUBAI</p></td></tr><tr><td style="padding:34px 34px 38px"><p style="margin:0 0 12px;color:#9a622d;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">${eventUrl ? "A special invitation" : "The latest from RSVP DXB"}</p><h1 style="margin:0 0 26px;color:#2e1c10;font-family:Georgia,'Times New Roman',serif;font-size:36px;font-weight:normal;line-height:1.18">${escapeHtml(subject)}</h1>${linkedImage ? `<div style="margin:0 0 26px">${linkedImage}</div>` : ""}${paragraphs}${eventDetails}${eventCta}<hr style="height:1px;margin:34px 0 18px;border:0;background-color:#e4d2b8"><p style="margin:0;color:#78634d;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7">You are receiving this email because you opted in to RSVP DXB updates.<br><a href="${escapeHtml(unsubscribeUrl)}" style="color:#85501f;text-decoration:underline">Unsubscribe from future emails</a></p></td></tr></table><p style="margin:16px 0 0;color:#8e7961;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;text-align:center">RSVP DXB · Dubai, United Arab Emirates</p></td></tr></table></body></html>`;
  const text = `${subject}\n\n${eventTitle ? `${eventTitle}\n${[formatEventDate(eventDate), eventTime, eventVenue].filter(Boolean).join(" · ")}\n\n` : ""}${imageUrl ? `Campaign image: ${imageUrl}\n\n` : ""}${body}${eventUrl ? `\n\nView event & RSVP: ${eventUrl}` : ""}\n\nYou are receiving this email because you opted in to RSVP DXB updates.\nUnsubscribe: ${unsubscribeUrl}`;

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
}

export async function sendMemberPasswordResetEmail({ email, name, resetUrl }) {
  const from = String(process.env.RSVP_PASSWORD_RESET_FROM || process.env.SES_FROM_EMAIL || "").trim() || "RSVP DXB <noreply@rsvpdxb.com>";
  const subject = "Reset your RSVP DXB password";
  const safeName = escapeHtml(name || "there");
  const safeUrl = escapeHtml(resetUrl);
  const text = `Hello ${name || "there"},\n\nWe received a request to reset your RSVP DXB member password. Open this secure link within 30 minutes to choose a new password. It can be used once:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.\n\nThe RSVP DXB team`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f4ead9;color:#2e1c10;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">Your secure RSVP DXB account link is ready.&nbsp; &zwnj;&nbsp; &zwnj;&nbsp; &zwnj;</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4ead9"><tr><td align="center" style="padding:28px 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;background:#fffaf1;border:1px solid #e5d3b8;border-radius:16px;overflow:hidden"><tr><td style="padding:24px 32px;background:#2e1c10"><div style="font-family:Georgia,'Times New Roman',serif;color:#e8c78d;font-size:24px;letter-spacing:3px">RSVP DXB</div><div style="margin-top:6px;color:#ddc9aa;font-size:10px;letter-spacing:2px;text-transform:uppercase">Private events &nbsp;·&nbsp; Dubai</div></td></tr><tr><td style="height:4px;background:#a66a2d;font-size:0;line-height:0">&nbsp;</td></tr><tr><td style="padding:34px 32px 32px"><p style="margin:0 0 10px;color:#96602b;font-size:10px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">Member account security</p><h1 style="margin:0 0 22px;color:#2e1c10;font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:normal;line-height:1.2">Reset your password</h1><p style="margin:0 0 16px;color:#34271d;font-size:16px;line-height:1.65">Hello ${safeName},</p><p style="margin:0;color:#55483b;font-size:15px;line-height:1.8">We received a request to reset the password for your RSVP DXB member account. This secure link expires in 30 minutes and can be used once. If you did not request this, you can ignore this email.</p><table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 8px"><tr><td align="center" bgcolor="#85501f" style="border-radius:8px"><a href="${safeUrl}" style="display:inline-block;padding:14px 23px;border:1px solid #85501f;border-radius:8px;color:#fffaf1;font-size:14px;font-weight:bold;line-height:1.2;text-decoration:none">Choose a new password &nbsp; &#8594;</a></td></tr></table><p style="margin:20px 0 0;padding:14px 16px;border-left:3px solid #a66a2d;background:#f8f1e6;color:#725b45;font-size:13px;line-height:1.7">For your security, never share this link. RSVP DXB will never ask you to send us your password.</p></td></tr><tr><td style="padding:17px 32px;background:#f8f1e6;border-top:1px solid #eadcc7;color:#8a7965;font-size:11px;line-height:1.6">If you didn’t request a password reset, no action is needed.<br><span style="color:#a89986">RSVP DXB &nbsp;·&nbsp; Dubai, United Arab Emirates</span></td></tr></table></td></tr></table></body></html>`;
  await ses.send(new SendEmailCommand({
    Source: from,
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Charset: "UTF-8", Data: subject },
      Body: { Text: { Charset: "UTF-8", Data: text }, Html: { Charset: "UTF-8", Data: html } },
    },
  }));
}
