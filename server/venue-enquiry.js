import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export async function sendVenueEnquiryNotification({ to, venue, name, email, phone, member, destination, reference }) {
  const region = String(process.env.SES_REGION || process.env.AWS_REGION || "").trim();
  const from = String(process.env.SES_FROM_EMAIL || "").trim() || "RSVP DXB <vinitahirani@rsvpdxb.com>";
  if (!to || !region) return { sent: false };
  const rows = [
    ["Venue", venue], ["Name", name], ["Email", email], ["Phone", phone || "Not provided"],
    ["Account", member ? "RSVP member" : "Guest"], ["Destination", destination], ["Reference", reference],
  ];
  const text = rows.map(([label, value]) => `${label}: ${value}`).join("\n");
  const details = rows.map(([label, value]) => `<tr><td style="padding:8px;border-bottom:1px solid #eadcc7"><b>${escapeHtml(label)}</b></td><td style="padding:8px;border-bottom:1px solid #eadcc7">${escapeHtml(value)}</td></tr>`).join("");
  try {
    const ses = new SESClient({ region });
    await ses.send(new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Charset: "UTF-8", Data: `New venue enquiry: ${venue}` },
        Body: {
          Text: { Charset: "UTF-8", Data: text },
          Html: { Charset: "UTF-8", Data: `<!doctype html><html><body style="font:15px Arial;color:#2e1c10"><h2>New venue enquiry: ${escapeHtml(venue)}</h2><table>${details}</table></body></html>` },
        },
      },
    }));
    return { sent: true };
  } catch (error) {
    console.error("Venue enquiry notification failed:", error);
    return { sent: false };
  }
}
