import "dotenv/config";
import express from "express";
import cors from "cors";
import { neon } from "@neondatabase/serverless";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import {
  sendInvitationEmail,
  sendInvitationWhatsApp,
  sendMembershipApprovalEmail,
  sendMemberActivationEmail,
  sendRsvpDecisionEmail,
  sendCreatorPassDecisionEmail,
} from "./invitation-delivery.js";
import {
  clearSessionCookie,
  createSessionToken,
  getSessionToken,
  hashPassword,
  hashSessionToken,
  setSessionCookie,
  verifyPassword,
} from "./auth.js";
import { createTicketPdf } from "./ticket-pdf.js";
import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { sendMemberPasswordResetEmail, sendNewsletterCampaignEmail } from "./newsletter.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const cloudFrontOriginSecret = String(process.env.CLOUDFRONT_ORIGIN_SECRET || "");
if (cloudFrontOriginSecret) {
  app.use((req, res, next) => {
    if (req.get("x-origin-verify") !== cloudFrontOriginSecret)
      return res.status(403).send("Forbidden");
    next();
  });
}
const databaseUrl = String(process.env.DATABASE_URL || "").trim();
const sql =
  databaseUrl && !/USER:PASSWORD|@HOST\/DBNAME/i.test(databaseUrl)
    ? neon(databaseUrl)
    : null;
let databaseStatus = sql ? "checking" : "unconfigured";
let databaseLastError = "";
if (databaseUrl && !sql)
  console.warn(
    "DATABASE_URL still contains the example placeholder; API is using demo data. Update the project-root .env to use Neon.",
  );
const now = () =>
  new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const mobileSessionLifetimeSeconds = 60 * 60 * 24 * 30;
const scrypt = promisify(scryptCallback);
const mediaBucket = String(process.env.S3_MEDIA_BUCKET || "").trim();
const mediaRegion = String(process.env.S3_MEDIA_REGION || process.env.AWS_REGION || "eu-north-1").trim();
const mediaBaseUrl = String(process.env.S3_MEDIA_BASE_URL || (mediaBucket ? `https://${mediaBucket}.s3.${mediaRegion}.amazonaws.com` : "")).replace(/\/$/, "");
const s3Credentials = process.env.S3_AWS_ACCESS_KEY_ID && process.env.S3_AWS_SECRET_ACCESS_KEY
  ? { accessKeyId: process.env.S3_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.S3_AWS_SECRET_ACCESS_KEY }
  : undefined;
// Presigned PutObject URLs are generated without the browser file body. The
// SDK's default CRC32 middleware otherwise signs the checksum of an empty
// body into the URL, which does not match the image uploaded by the browser.
const s3 = mediaBucket ? new S3Client({ region: mediaRegion, requestChecksumCalculation: "WHEN_REQUIRED", ...(s3Credentials ? { credentials: s3Credentials } : {}) }) : null;

async function createCreatorPassGoogleForm(event) {
  const endpoint = String(process.env.GOOGLE_FORM_CREATOR_SCRIPT_URL || "").trim();
  const secret = String(process.env.GOOGLE_FORM_CREATOR_SECRET || "").trim();
  if (!endpoint || secret.length < 32) {
    return { url: "", error: "Google Form auto-creation is not configured. Set GOOGLE_FORM_CREATOR_SCRIPT_URL and GOOGLE_FORM_CREATOR_SECRET on the admin server." };
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, event: {
        id: event.id,
        title: event.title,
        brand: event.brand || "RSVP DXB",
        date: event.date || "",
        time: event.time || "",
        venue: event.venue || "",
        area: event.area || "",
        hashtag: event.hashtag || "",
        creatorPassNote: event.creatorPassNote || event.creator_pass_note || "",
        imageUrl: event.imageData || event.image_data || event.imageGallery?.[0] || event.image_gallery?.[0] || "",
      } }),
      signal: AbortSignal.timeout(25000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !/^https:\/\/docs\.google\.com\/forms\//.test(String(payload.responderUrl || ""))) {
      throw new Error(payload.error || `Google Forms returned ${response.status}.`);
    }
    return { url: payload.responderUrl, error: "" };
  } catch (error) {
    return { url: "", error: String(error?.message || "Could not create the Google Form.").slice(0, 800) };
  }
}

async function ensureCreatorPassGoogleForm(event) {
  if (!event || event.status !== "published") return { url: event?.creatorPassFormUrl || event?.creator_pass_form_url || "", error: "" };
  const currentUrl = String(event.creatorPassFormUrl || event.creator_pass_form_url || "");
  if (currentUrl) return { url: currentUrl, error: "" };
  const result = await createCreatorPassGoogleForm(event);
  if (sql) {
    await sql`UPDATE events SET creator_pass_form_url = ${result.url}, creator_pass_form_error = ${result.error}, updated_at = NOW() WHERE id = ${event.id}`;
  } else {
    const demoEvent = demo.events.find((item) => item.id === event.id);
    if (demoEvent) Object.assign(demoEvent, { creatorPassFormUrl: result.url, creatorPassFormError: result.error });
  }
  return result;
}

const demoSessions = new Map();
const dashboardTrack = {
  influencer: "Creators",
  creator: "Creators",
  media: "Media",
  tastemaker: "Tastemakers",
  brand: "Private Circle",
};
const normalizeTrack = (track) =>
  dashboardTrack[
    String(track || "")
      .trim()
      .toLowerCase()
  ] || String(track || "Creators").trim();
const text = (value, max = 500) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const demoAdmins = sql
  ? []
  : await Promise.all(
      [
        {
          id: "admin-1",
          name: process.env.ADMIN_1_NAME || "Tejas Nair",
          email: (
            process.env.ADMIN_1_EMAIL || "tejas@rsvpdxb.local"
          ).toLowerCase(),
          password: process.env.ADMIN_1_PASSWORD || "demo1234",
          role: "Owner",
        },
      ].map(async (admin) => ({
        ...admin,
        passwordHash: await hashPassword(admin.password),
      })),
    );

app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json({
  limit: "3mb",
  verify(req, _res, buffer) {
    if (req.originalUrl === "/api/payments/stripe/webhook") req.rawBody = Buffer.from(buffer);
  },
}));

async function currentAdmin(req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  if (!sql) {
    const session = demoSessions.get(tokenHash);
    if (!session || session.expiresAt <= Date.now()) {
      demoSessions.delete(tokenHash);
      return null;
    }
    const { password, passwordHash, ...admin } =
      demoAdmins.find((item) => item.id === session.adminId) || {};
    return admin.id ? admin : null;
  }
  const rows =
    await sql`SELECT a.id, a.name, a.email, a.role FROM admin_sessions s JOIN admin_users a ON a.id = s.admin_id WHERE s.token_hash = ${tokenHash} AND s.expires_at > NOW() AND a.active = TRUE LIMIT 1`;
  return rows[0] || null;
}

const demo = {
  applications: [
    {
      id: "app-1",
      name: "Layla Haddad",
      email: "layla@thegulfedit.com",
      track: "Media",
      city: "Dubai",
      detail: "Senior editor, The Gulf Edit — food & travel",
      followers: "—",
      submitted: "2026-09-29",
      status: "pending",
    },
    {
      id: "app-2",
      name: "Omar Rashid",
      email: "omar.creates@gmail.com",
      track: "Creators",
      city: "Dubai",
      detail: "Lifestyle & fashion, IG + TikTok",
      followers: "128k",
      submitted: "2026-09-29",
      status: "pending",
    },
    {
      id: "app-3",
      name: "Chef Marco Vitale",
      email: "marco@casavitale.ae",
      track: "Tastemakers",
      city: "Dubai",
      detail: "Executive chef, Casa Vitale",
      followers: "22k",
      submitted: "2026-09-28",
      status: "pending",
    },
    {
      id: "app-4",
      name: "A. Al Suwaidi",
      email: "office@alsuwaidi-group.ae",
      track: "Private Circle",
      city: "Abu Dhabi",
      detail: "Referred by member #0142 — assistant contact on file",
      followers: "Private",
      submitted: "2026-09-27",
      status: "pending",
    },
    {
      id: "app-5",
      name: "Sofia Mendes",
      email: "sofia@luxereport.co",
      track: "Creators",
      city: "Dubai",
      detail: "Beauty creator — YouTube + IG",
      followers: "41k",
      submitted: "2026-09-26",
      status: "pending",
    },
  ],
  members: [
    {
      id: "m1",
      name: "Tejas Nair",
      track: "Creators",
      rank: "Gold",
      points: 640,
      events: 18,
      city: "Dubai",
    },
    {
      id: "m2",
      name: "Hala Zayed",
      track: "Media",
      rank: "Diamond",
      points: 1180,
      events: 31,
      city: "Dubai",
    },
    {
      id: "m3",
      name: "Rami Fawaz",
      track: "Tastemakers",
      rank: "Silver",
      points: 310,
      events: 9,
      city: "Sharjah",
    },
    {
      id: "m4",
      name: "Private #0142",
      track: "Private Circle",
      rank: "Bronze",
      points: 0,
      events: 6,
      city: "Dubai",
    },
    {
      id: "m5",
      name: "Nadia Khan",
      track: "Creators",
      rank: "Platinum",
      points: 2740,
      events: 58,
      city: "Dubai",
    },
    {
      id: "m6",
      name: "Jon Abela",
      track: "Media",
      rank: "Silver",
      points: 220,
      events: 7,
      city: "Dubai",
    },
  ],
  events: [
    {
      id: "atlantis-chef-table",
      title: "Chef's Table at Ossiano",
      brand: "Atlantis The Royal",
      date: "2026-10-03",
      time: "19:30",
      venue: "Ossiano, Atlantis The Royal",
      area: "Palm Jumeirah",
      category: "Dining",
      tracks: ["Media", "Tastemakers"],
      capacity: 24,
      confirmed: 21,
      status: "published",
    },
    {
      id: "jumeirah-spring-launch",
      title: "Spring Collection Launch",
      brand: "Maison Dalia",
      date: "2026-10-04",
      time: "20:00",
      venue: "Alserkal Avenue, Warehouse 42",
      area: "Al Quoz",
      category: "Fashion",
      tracks: ["Creators", "Media"],
      capacity: 120,
      confirmed: 120,
      status: "published",
    },
    {
      id: "dubai-hills-preview",
      title: "Private Residence Preview",
      brand: "Vantage Developments",
      date: "2026-10-08",
      time: "18:00",
      venue: "Dubai Hills Estate",
      area: "Dubai Hills",
      category: "Property",
      tracks: ["Private Circle"],
      capacity: 16,
      confirmed: 9,
      status: "published",
    },
    {
      id: "marina-sunset-session",
      title: "Sunset Listening Session",
      brand: "Nuvo Audio",
      date: "2026-10-11",
      time: "17:30",
      venue: "Bluewaters Terrace",
      area: "Bluewaters",
      category: "Music",
      tracks: ["Creators", "Tastemakers"],
      capacity: 80,
      confirmed: 54,
      status: "published",
    },
    {
      id: "difc-art-night",
      title: "Collectors Night",
      brand: "Gallery Seventeen",
      date: "2026-10-16",
      time: "19:00",
      venue: "DIFC Gate Village 9",
      area: "DIFC",
      category: "Art",
      tracks: ["Private Circle", "Tastemakers"],
      capacity: 40,
      confirmed: 28,
      status: "published",
    },
    {
      id: "beach-club-opening",
      title: "Season Opening Brunch",
      brand: "Sirene Beach Club",
      date: "2026-10-18",
      time: "13:00",
      venue: "Jumeirah Beach Road",
      area: "Jumeirah",
      category: "Nightlife",
      tracks: ["Creators", "Media", "Tastemakers"],
      capacity: 200,
      confirmed: 142,
      status: "pending",
    },
  ],
  wall: [
    {
      id: "w1",
      brand: "Sirene Beach Club",
      type: "Places Just Opened",
      body: "Six places just opened for Season Opening Brunch this Saturday. First come, first served.",
      posted: "2h ago",
      boosted: true,
      status: "live",
      eventId: "beach-club-opening",
    },
    {
      id: "w2",
      brand: "Maison Dalia",
      type: "New Event",
      body: "Spring Collection Launch — Alserkal Avenue, 4 October. Creators and fashion press only.",
      posted: "5h ago",
      boosted: false,
      status: "live",
      eventId: "jumeirah-spring-launch",
    },
    {
      id: "w3",
      brand: "Nuvo Audio",
      type: "Member Offer",
      body: "20% member discount on the terrace menu all October. Show your digital pass.",
      posted: "Yesterday",
      boosted: false,
      status: "live",
    },
    {
      id: "w4",
      brand: "Atlantis The Royal",
      type: "Recap",
      body: "Thank you to everyone who joined last week's Chef's Table. 41 pieces of content collected.",
      posted: "2 days ago",
      boosted: false,
      status: "live",
    },
    {
      id: "w5",
      brand: "Gallery Seventeen",
      type: "Sponsored",
      body: "Collectors Night at DIFC — a curator-led evening with the artists present.",
      posted: "Pending review",
      boosted: false,
      status: "pending",
      eventId: "difc-art-night",
    },
  ],
  clients: [
    {
      id: "b1",
      name: "Atlantis The Royal",
      package: "Signature",
      credits: 42,
      events: 11,
      status: "active",
    },
    {
      id: "b2",
      name: "Maison Dalia",
      package: "Launch",
      credits: 8,
      events: 3,
      status: "active",
    },
    {
      id: "b3",
      name: "Sirene Beach Club",
      package: "Season",
      credits: 26,
      events: 7,
      status: "active",
    },
    {
      id: "b4",
      name: "Vantage Developments",
      package: "Private",
      credits: 15,
      events: 2,
      status: "trial",
    },
    {
      id: "b5",
      name: "Nuvo Audio",
      package: "Launch",
      credits: 4,
      events: 1,
      status: "active",
    },
  ],
  guests: [
    {
      id: "g1",
      name: "Tejas Nair",
      track: "Creators",
      eventId: "marina-sunset-session",
      plusOnes: 1,
      code: "RSVP-4471",
    },
    {
      id: "g2",
      name: "Hala Zayed",
      track: "Media",
      eventId: "marina-sunset-session",
      plusOnes: 0,
      code: "RSVP-2208",
    },
    {
      id: "g3",
      name: "Rami Fawaz",
      track: "Tastemakers",
      eventId: "marina-sunset-session",
      plusOnes: 1,
      code: "RSVP-9014",
    },
    {
      id: "g4",
      name: "Nadia Khan",
      track: "Creators",
      eventId: "marina-sunset-session",
      plusOnes: 2,
      code: "RSVP-7731",
    },
    {
      id: "g5",
      name: "Jon Abela",
      track: "Media",
      eventId: "marina-sunset-session",
      plusOnes: 0,
      code: "RSVP-5520",
    },
  ],
  guestInvitations: [],
  eventRsvpRequests: [],
  site_media: [],
  people_profiles: [],
  venues: [],
};

const tableFor = {
  applications: "applications",
  members: "members",
  events: "events",
  wall: "wall_posts",
  "site-media": "site_media",
  "people-profiles": "people_profiles",
  venues: "venues",
  clients: "clients",
  guests: "guests",
};
const selectFor = {
  applications:
    'SELECT id, name, email, track, city, detail, followers, profile_url AS "profileUrl", handle, platform, mobile, outlet, application_role AS role, all_profiles AS "allProfiles", source_track AS "sourceTrack", submitted::text AS submitted, status FROM applications ORDER BY submitted DESC',
  members:
    'SELECT id, member_number AS "memberNumber", name, email, track, source_track AS "sourceTrack", rank, points, events, city, profile_url AS "profileUrl", handle, platform, followers, mobile, outlet, member_role AS role, all_profiles AS "allProfiles", status, joined::text AS joined FROM members ORDER BY name',
  events:
    'SELECT id, title, brand, venue, date::text AS date, end_date::text AS \"endDate\", time, end_time AS \"endTime\", gates_open_time AS \"gatesOpenTime\", area, category, tracks, capacity, confirmed, ticket_price AS \"ticketPrice\", ticket_currency AS \"ticketCurrency\", ticket_url AS \"ticketUrl\", reservation_phone AS \"reservationPhone\", creator_pass_note AS \"creatorPassNote\", creator_pass_form_url AS \"creatorPassFormUrl\", creator_pass_form_error AS \"creatorPassFormError\", age_restriction AS \"ageRestriction\", hashtag, application_deadline::text AS \"applicationDeadline\", action_label AS \"actionLabel\", dress_code AS \"dressCode\", about, included, who_is_invited AS \"whoIsInvited\", host_note AS \"hostNote\", COALESCE(image_gallery[1], image_data) AS \"imageData\", image_gallery AS \"imageGallery\", video_url AS \"videoUrl\", track_capacities AS \"trackCapacities\", influencer_deliverables AS \"influencerDeliverables\", map_url AS \"mapUrl\", top_pick AS \"topPick\", (SELECT COUNT(*)::int FROM event_rsvp_requests r WHERE r.event_id = events.id AND r.status = \'pending\') AS \"pendingRsvpCount\", status FROM events ORDER BY date',
  wall_posts:
    'SELECT id, brand, type, body, posted, boosted, status, event_id AS "eventId" FROM wall_posts ORDER BY created_at DESC',
  site_media:
    'SELECT id, slot, title, caption, image_url AS "imageUrl", COALESCE(media_type, \'image\') AS "mediaType", COALESCE(captions_url, \'\') AS "captionsUrl", object_key AS "objectKey", link_url AS "linkUrl", display_order AS "displayOrder", active, created_at AS "createdAt" FROM site_media ORDER BY slot, display_order, created_at DESC',
  people_profiles:
    'SELECT id, category, name, role, subtitle, bio, image_url AS "imageUrl", object_key AS "objectKey", instagram_url AS "instagramUrl", tiktok_url AS "tiktokUrl", youtube_url AS "youtubeUrl", x_url AS "xUrl", display_order AS "displayOrder", active, created_at AS "createdAt" FROM people_profiles ORDER BY category, display_order, created_at DESC',
  venues:
    `SELECT id, slug, category, name, tagline, description, location, highlights, offer, featured_date::text AS "featuredDate", image_url AS "imageUrl", object_key AS "objectKey", gallery_images AS "galleryImages", website_url AS "websiteUrl", more_info_url AS "moreInfoUrl", display_order AS "displayOrder", content_reviewed AS "contentReviewed", featured, active, created_at AS "createdAt" FROM venues ORDER BY CASE category WHEN 'Our partners' THEN 1 WHEN 'Desi luxe' THEN 2 WHEN 'Dinner to party' THEN 3 WHEN 'Bars & night culture' THEN 4 WHEN 'Coffee' THEN 5 ELSE 6 END, display_order, name`,
  clients:
    "SELECT id, name, package, credits, events, status FROM clients ORDER BY name",
  guests:
    `SELECT id, name, track, event_id AS "eventId", plus_ones AS "plusOnes", code, checked_in_at AS "checkedInAt", status FROM guests
     UNION ALL
     SELECT 'ticket-' || r.id AS id, COALESCE(NULLIF(r.guest_name, ''), 'WhatsApp guest') AS name, 'Ticket' AS track, r.event_id AS "eventId", 0 AS "plusOnes", r.ticket_token AS code, r.checked_in_at::text AS "checkedInAt", r.status
     FROM ticket_requests r WHERE r.ticket_token IS NOT NULL AND r.status IN ('approved', 'paid')
     ORDER BY name`,
};
const getRows = async (table) => {
  if (sql) return sql.query(selectFor[table]);
  const rows = structuredClone(demo[table]);
  return ["applications", "members"].includes(table)
    ? rows.map(({ passwordHash: _passwordHash, ...row }) => row)
    : rows;
};

async function sendInfobipWhatsApp(to, textMessage, events = []) {
  const base = String(process.env.INFOBIP_BASE_URL || "").trim().replace(/\/$/, "");
  const apiKey = String(process.env.INFOBIP_API_KEY || "").trim();
  const sender = String(process.env.INFOBIP_WHATSAPP_SENDER || "").trim();
  if (!base || !apiKey || !sender) {
    throw new Error(`Infobip WhatsApp is not configured (base URL: ${Boolean(base)}, API key: ${Boolean(apiKey)}, sender: ${Boolean(sender)}).`);
  }
  const payload = events.length
    ? {
        from: sender,
        to,
        content: {
          body: { text: textMessage },
          action: {
            title: "View events",
            sections: [{ rows: events.slice(0, 10).map((event) => ({
              id: event.id,
              title: event.title.slice(0, 24),
              description: `${event.date} · ${event.ticketPrice} ${event.ticketCurrency}`.slice(0, 72),
            })) }],
          },
        },
      }
    : { from: sender, to, content: { text: textMessage } };
  const response = await fetch(`${base}/whatsapp/1/message/${events.length ? "interactive/list" : "text"}`, {
    method: "POST", headers: { Authorization: `App ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Infobip WhatsApp returned HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`);
  const result = await response.json().catch(() => null);
  const messageStatus = result?.messages?.[0]?.status?.name;
  if (messageStatus && !["PENDING_ACCEPTED", "PENDING_ENROUTE", "DELIVERED"].includes(messageStatus)) {
    throw new Error(`Infobip did not accept WhatsApp message: ${messageStatus} ${result?.messages?.[0]?.status?.description || ""}`.trim());
  }
}

function getInfobipInboundText(item) {
  const message = item?.message || item?.messageData || {};
  const candidates = [
    message.text, message.text?.text, message.text?.body,
    message.interactive?.listReply?.id, message.interactive?.listReply?.title,
    message.interactive?.list_reply?.id, message.interactive?.list_reply?.title,
    message.button?.payload, message.button?.text,
    message.buttonReply?.payload, message.buttonReply?.title,
    message.button_reply?.payload, message.button_reply?.title,
    item?.text, item?.text?.text, item?.text?.body,
    item?.interactive?.listReply?.id, item?.interactive?.listReply?.title,
    item?.interactive?.list_reply?.id, item?.interactive?.list_reply?.title,
  ];
  return String(candidates.find((value) => typeof value === "string" && value.trim()) || "").trim();
}

async function sendInfobipWhatsAppPayment(to, checkoutUrl, event, guestName, amount, currency) {
  const base = String(process.env.INFOBIP_BASE_URL || "").trim().replace(/\/$/, "");
  const apiKey = String(process.env.INFOBIP_API_KEY || "").trim();
  const sender = String(process.env.INFOBIP_WHATSAPP_SENDER || "").trim();
  if (!base || !apiKey || !sender) throw new Error("Infobip WhatsApp is not configured.");

  const details = [
    `Event: ${event.title}`,
    `Date: ${event.date}${event.time ? ` · ${event.time}` : ""}`,
    event.venue ? `Venue: ${event.venue}` : "",
    guestName ? `Guest: ${guestName}` : "",
    `Total: ${Number(amount).toFixed(2)} ${currency}`,
    "\nTap Pay now to complete secure payment. Your PDF ticket will be sent to this chat after payment is confirmed.",
  ].filter(Boolean).join("\n");

  const apiHost = String(process.env.PUBLIC_API_URL || "https://d1f5sjkm09kt76.cloudfront.net").replace(/\/$/, "");
  const eventImage = event.imageData?.startsWith?.("https://") ? event.imageData : event.imageData ? `${apiHost}/api/events/${encodeURIComponent(event.id)}/image` : "";
  const response = await fetch(`${base}/whatsapp/1/message/interactive/url-button`, {
    method: "POST",
    headers: { Authorization: `App ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      from: sender,
      to,
      content: {
        header: eventImage
          ? { type: "IMAGE", mediaUrl: eventImage }
          : { type: "TEXT", text: "RSVP DXB · Ticket checkout" },
        body: { text: details },
        footer: { text: "Secure checkout powered by Stripe" },
        action: { displayText: "Pay now", url: checkoutUrl },
      },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Infobip payment button returned HTTP ${response.status}: ${await response.text()}`);
}

async function sendInfobipTicket(to, pdfUrl, filename, caption) {
  const base = String(process.env.INFOBIP_BASE_URL || "").trim().replace(/\/$/, "");
  const apiKey = String(process.env.INFOBIP_API_KEY || "").trim();
  const sender = String(process.env.INFOBIP_WHATSAPP_SENDER || "").trim();
  if (!base || !apiKey || !sender) throw new Error("Infobip WhatsApp is not configured.");
  const response = await fetch(`${base}/whatsapp/1/message/document`, {
    method: "POST",
    headers: { Authorization: `App ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ from: sender, to, content: { mediaUrl: pdfUrl, caption, filename } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Infobip document send returned HTTP ${response.status}: ${await response.text()}`);
}

async function createStripeCheckout({ requestId, event, amount, currency }) {
  const secret = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!secret) throw new Error("Stripe is not configured.");
  const site = String(process.env.PUBLIC_SITE_URL || "https://d25iiefhi451d5.cloudfront.net").replace(/\/$/, "");
  const cents = Math.round(Number(amount) * 100);
  if (!Number.isFinite(cents) || cents <= 0) throw new Error("Ticket price must be greater than zero to take payment.");
  const form = new URLSearchParams({
    mode: "payment",
    success_url: `${site}/events/${encodeURIComponent(event.id)}?payment=success`,
    cancel_url: `${site}/events/${encodeURIComponent(event.id)}?payment=cancelled`,
    client_reference_id: requestId,
    "metadata[ticket_request_id]": requestId,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": String(currency).toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(cents),
    "line_items[0][price_data][product_data][name]": `RSVP DXB ticket: ${event.title}`,
    "line_items[0][price_data][product_data][description]": `${event.date}${event.venue ? ` · ${event.venue}` : ""}`,
  });
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `Stripe returned HTTP ${response.status}`);
  return data;
}

function verifyStripeSignature(req) {
  const secret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  const header = req.get("stripe-signature") || "";
  if (!secret || !req.rawBody) return false;
  const parts = Object.fromEntries(header.split(",").map((part) => {
    const [key, ...value] = part.split("=");
    return [key, value.join("=")];
  }));
  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300 || !parts.v1) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${req.rawBody}`).digest();
  const received = Buffer.from(parts.v1, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

app.get("/api/health", async (_req, res) => {
  if (!sql) return res.json({ ok: true, database: "unconfigured", message: "DATABASE_URL is not configured; API is using demo data." });
  try {
    await queryDatabase(() => sql`SELECT 1 AS ok`);
    return res.json({ ok: true, database: "connected" });
  } catch {
    return res.status(503).json({ ok: false, database: databaseStatus, databaseError: databaseLastError });
  }
});
function transientDatabaseError(error) {
  const codes = new Set(["UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"]);
  for (let current = error; current; current = current.sourceError?.cause || current.cause) {
    if (codes.has(current.code) || /fetch failed|socket hang up/i.test(current.message || "")) return true;
  }
  return false;
}
async function queryDatabase(query) {
  try {
    const result = await query();
    databaseStatus = "connected";
    databaseLastError = "";
    return result;
  } catch (error) {
    if (!transientDatabaseError(error)) {
      databaseStatus = "error";
      databaseLastError = "Database rejected the request; check credentials and schema.";
      throw error;
    }
    databaseStatus = "unavailable";
    databaseLastError = "Database network connection failed.";
    console.warn("Neon request failed; retrying once after a short delay.");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    try {
      const result = await query();
      databaseStatus = "connected";
      databaseLastError = "";
      return result;
    } catch (retryError) {
      databaseStatus = transientDatabaseError(retryError) ? "unavailable" : "error";
      databaseLastError = transientDatabaseError(retryError)
        ? "Database network connection failed after retry."
        : "Database rejected the request; check credentials and schema.";
      throw retryError;
    }
  }
}
app.get("/api/events/:id/image", async (req, res, next) => {
  try {
    if (!sql) return res.status(404).end();
    const rows = await sql`SELECT COALESCE(image_gallery[1], image_data) AS "imageData" FROM events WHERE id = ${req.params.id} LIMIT 1`;
    const stored = String(rows[0]?.imageData || "");
    if (mediaBaseUrl && stored.startsWith(`${mediaBaseUrl}/media/`)) return res.redirect(302, stored);
    const match = stored.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) return res.status(404).end();
    res.set({ "Content-Type": match[1].toLowerCase(), "Cache-Control": "public, max-age=3600" });
    res.send(Buffer.from(match[2], "base64"));
  } catch (error) { next(error); }
});
app.get("/api/pay/:requestId", async (req, res, next) => {
  try {
    if (!sql) return res.status(404).send("Checkout not found.");
    const secret = String(process.env.STRIPE_SECRET_KEY || "").trim();
    if (!secret) return res.status(503).send("Checkout is temporarily unavailable.");
    const rows = await sql`SELECT stripe_session_id AS "sessionId", status FROM ticket_requests WHERE id = ${req.params.requestId} LIMIT 1`;
    if (!rows[0]?.sessionId || rows[0].status !== "awaiting_payment") return res.status(404).send("This checkout is no longer available.");
    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(rows[0].sessionId)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10000),
    });
    const session = await response.json();
    if (!response.ok || !session.url) return res.status(410).send("This checkout link has expired. Please request a new ticket link in WhatsApp.");
    res.set("Cache-Control", "no-store").redirect(303, session.url);
  } catch (error) { next(error); }
});
app.get("/api/tickets/:token.pdf", async (req, res, next) => {
  try {
    if (!sql) return res.status(404).json({ error: "Ticket not found." });
    const rows = await sql`SELECT r.id, r.ticket_token AS "ticketToken", r.phone, r.guest_name AS "guestName", r.amount, r.currency, e.title AS "eventTitle", e.date::text AS date, e.time, e.venue FROM ticket_requests r JOIN events e ON e.id = r.event_id WHERE r.ticket_token = ${req.params.token} AND r.status IN ('paid', 'approved') LIMIT 1`;
    if (!rows[0]) return res.status(404).json({ error: "Ticket not found." });
    const pdf = createTicketPdf(rows[0]);
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="RSVP-DXB-${rows[0].id}.pdf"`, "Cache-Control": "private, no-store" });
    res.send(pdf);
  } catch (error) { next(error); }
});
app.post("/api/payments/stripe/webhook", async (req, res) => {
  if (!verifyStripeSignature(req)) return res.status(400).send("Invalid Stripe signature.");
  const event = req.body;
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event?.type)) return res.sendStatus(200);
  const session = event.data?.object;
  if (session?.payment_status !== "paid") return res.sendStatus(200);
  try {
    if (!sql) throw new Error("Database is not configured.");
    const requestId = String(session.metadata?.ticket_request_id || session.client_reference_id || "");
    if (!requestId) throw new Error("Stripe session has no ticket request metadata.");
    const token = randomBytes(24).toString("hex");
    const rows = await sql`UPDATE ticket_requests r SET status = 'paid', stripe_session_id = ${session.id}, paid_at = COALESCE(r.paid_at, NOW()), ticket_token = COALESCE(r.ticket_token, ${token}) FROM events e WHERE r.id = ${requestId} AND r.event_id = e.id AND r.status IN ('awaiting_payment', 'paid') AND r.stripe_session_id = ${session.id} AND r.amount = ${Number(session.amount_total || 0) / 100} AND lower(r.currency) = lower(${session.currency || ''}) RETURNING r.id, r.phone, r.guest_name AS "guestName", r.amount, r.currency, r.ticket_token AS "ticketToken", r.ticket_delivered_at AS "ticketDeliveredAt", e.title AS "eventTitle", e.date::text AS date, e.time, e.venue`;
    const ticket = rows[0];
    if (!ticket) throw new Error("No matching ticket request for the paid Stripe Checkout session.");
    if (ticket.ticketDeliveredAt) return res.sendStatus(200);
    const host = String(process.env.PUBLIC_API_URL || "https://d1f5sjkm09kt76.cloudfront.net").replace(/\/$/, "");
    const pdfUrl = `${host}/api/tickets/${ticket.ticketToken}.pdf`;
    await sendInfobipTicket(ticket.phone, pdfUrl, `RSVP-DXB-${ticket.id}.pdf`, `Payment received for ${ticket.eventTitle}. Your ticket is attached.`);
    await sql`UPDATE ticket_requests SET ticket_delivered_at = NOW() WHERE id = ${ticket.id}`;
    res.sendStatus(200);
  } catch (error) {
    console.error("Stripe ticket fulfillment failed:", error?.message || error);
    res.status(500).send("Ticket fulfillment will be retried.");
  }
});
app.post("/api/whatsapp/infobip/webhook", async (req, res, next) => {
  try {
    const secret = String(process.env.INFOBIP_WEBHOOK_SECRET || "").trim();
    if (!secret || req.get("authorization") !== `Bearer ${secret}`)
      return res.status(401).json({ error: "Unauthorized webhook." });
    // Infobip can deliver either a results array or a single message object.
    // Process first so provider retries can recover from transient send/API errors.
    const inbound = Array.isArray(req.body)
      ? req.body
      : Array.isArray(req.body.results)
        ? req.body.results
        : req.body.result
          ? [req.body.result]
          : [req.body];
    for (const item of inbound) {
      if (item.integrationType && !String(item.integrationType).toUpperCase().includes("WHATSAPP")) continue;
      const phone = String(item.from || item.sender || item.contact?.waId || item.contact?.phone || "").replace(/\D/g, "");
      const input = getInfobipInboundText(item);
      if (!phone) {
        console.warn("Infobip inbound message has no sender phone; fields:", Object.keys(item || {}));
        continue;
      }
      if (!input) {
        console.warn("Infobip inbound message has no text; fields:", Object.keys(item || {}));
        await sendInfobipWhatsApp(phone, "Hi! Send *events* to see upcoming events and request a ticket.");
        continue;
      }
      const directEventMatch = input.match(/^rsvpdxb\s+event\s+(.+)$/i);
      const eventListRequest = /^(?:rsvpdxb\s+)?(?:events?|tickets?|request|hi|hello|start)(?:\s+(?:please|list|available|upcoming|today|tonight|this\s+week|christmas|new\s+year|eid|ramadan|.+\s+events?))?$/i.test(input)
        || /^(?:rsvpdxb\s+)?event\s+(?:list|available|upcoming|today|tonight|this\s+week|christmas|new\s+year|eid|ramadan)(?:\s+events?)?$/i.test(input);
      if (eventListRequest) {
        const events = sql
          ? await sql`SELECT id, title, date::text AS date, ticket_price AS "ticketPrice", ticket_currency AS "ticketCurrency" FROM events WHERE status = 'published' AND date >= CURRENT_DATE ORDER BY date LIMIT 10`
          : demo.events.filter((event) => event.status === "published").map((event) => ({ ...event, ticketPrice: event.ticketPrice || 0, ticketCurrency: "AED" })).slice(0, 10);
        if (!events.length) await sendInfobipWhatsApp(phone, "Welcome to RSVP DXB. There are no events open for ticket requests right now.");
        else await sendInfobipWhatsApp(phone, "Welcome to RSVP DXB! Here are the upcoming events. Choose one to request your ticket:", events);
        continue;
      }
      const directEventValue = directEventMatch?.[1].trim() || "";
      const selectedEventId = directEventMatch ? directEventValue : input;
      const selectedEventTitle = directEventMatch
        ? directEventValue
        : input.split(/\r?\n/)[0].replace(/\s+\d{4}-\d{2}-\d{2}.*$/, "").trim();
      const event = sql
        ? (await sql`SELECT id, title, date::text AS date, time, venue, image_data AS "imageData", ticket_price AS "ticketPrice", ticket_currency AS "ticketCurrency", status FROM events WHERE (id = ${selectedEventId} OR lower(title) = lower(${selectedEventTitle})) AND status = 'published' AND date >= CURRENT_DATE LIMIT 1`)[0]
        : demo.events.find((row) => (row.id === selectedEventId || row.title.toLowerCase() === selectedEventTitle.toLowerCase()) && row.status === "published" && row.date >= new Date().toISOString().slice(0, 10));
      if (!event) {
        await sendInfobipWhatsApp(phone, "Sorry, I couldn't match that event. Send *events* to see the current list, then choose an event.");
        continue;
      }
      const id = `ticket-${text(item.messageId, 100) || randomBytes(12).toString("hex")}`;
      const amount = Number(event.ticketPrice || 0);
      const currency = event.ticketCurrency || "AED";
      if (!sql) {
        await sendInfobipWhatsApp(phone, `We received your request for ${event.title}. Payment checkout is available after the RSVP API is connected to Neon and Stripe.`);
        continue;
      }
      await sql`INSERT INTO ticket_requests (id, event_id, phone, guest_name, amount, currency) VALUES (${id}, ${event.id}, ${phone}, ${text(item.contact?.name, 120)}, ${amount}, ${currency}) ON CONFLICT (id) DO NOTHING`;
      const priceNote = amount > 0
        ? ` If approved, we’ll send a secure ${amount.toFixed(2)} ${currency} payment link here. Your ticket is delivered after payment.`
        : " If approved, your ticket will be sent here.";
      await sendInfobipWhatsApp(phone, `Your ticket request for ${event.title} has been received. The RSVP DXB team will review it.${priceNote}`);
    }
    res.sendStatus(200);
  } catch (error) {
    if (!res.headersSent) next(error);
    else console.error("Infobip webhook processing failed:", error?.message || error);
  }
});
app.get("/api/ticket-requests", async (req, res, next) => {
  try {
    if (!(await currentAdmin(req))) return res.status(401).json({ error: "Sign in to view ticket requests." });
    if (!sql) return res.json([]);
    const rows = await sql`SELECT r.id, r.phone, r.guest_name AS "guestName", r.amount, r.currency, r.status, r.paid_at AS "paidAt", r.ticket_delivered_at AS "ticketDeliveredAt", r.checked_in_at AS "checkedInAt", r.created_at AS "createdAt", e.id AS "eventId", e.title AS "eventTitle" FROM ticket_requests r JOIN events e ON e.id = r.event_id ORDER BY r.created_at DESC`;
    res.json(rows);
  } catch (error) { next(error); }
});
app.post("/api/ticket-requests/:id/approve", async (req, res, next) => {
  try {
    if (!(await currentAdmin(req))) return res.status(401).json({ error: "Sign in to approve ticket requests." });
    if (!sql) return res.status(503).json({ error: "Ticket delivery requires the connected database." });
    const host = String(process.env.PUBLIC_API_URL || "https://d1f5sjkm09kt76.cloudfront.net").replace(/\/$/, "");
    const requests = await sql`SELECT r.id, r.phone, r.guest_name AS "guestName", r.amount, r.currency, r.status,
      r.ticket_token AS "ticketToken", r.ticket_delivered_at AS "ticketDeliveredAt", r.stripe_session_id AS "stripeSessionId",
      e.id AS "eventId", e.title AS "eventTitle", e.date::text AS date, e.time, e.venue, e.image_data AS "imageData"
      FROM ticket_requests r JOIN events e ON e.id = r.event_id WHERE r.id = ${req.params.id} LIMIT 1`;
    const request = requests[0];
    if (!request) return res.status(404).json({ error: "Ticket request not found." });

    if (Number(request.amount) > 0) {
      if (request.status === "paid" && request.ticketToken && !request.ticketDeliveredAt) {
        await sendInfobipTicket(request.phone, `${host}/api/tickets/${request.ticketToken}.pdf`, `RSVP-DXB-${request.id}.pdf`, `Payment received for ${request.eventTitle}. Your ticket is attached.`);
        const delivered = await sql`UPDATE ticket_requests SET ticket_delivered_at = NOW() WHERE id = ${request.id} RETURNING ticket_delivered_at AS "ticketDeliveredAt"`;
        return res.json({ status: "paid", ticketDeliveredAt: delivered[0]?.ticketDeliveredAt, message: "Paid ticket PDF sent to WhatsApp." });
      }
      if (request.status === "paid") return res.json({ status: "paid", ticketDeliveredAt: request.ticketDeliveredAt, message: "Ticket was already sent." });
      if (!["pending", "awaiting_payment"].includes(request.status)) return res.status(409).json({ error: `This request is ${request.status} and cannot be approved.` });

      let checkoutUrl = `${host}/api/pay/${encodeURIComponent(request.id)}`;
      if (request.status === "pending") {
        const checkout = await createStripeCheckout({ requestId: request.id, event: request, amount: request.amount, currency: request.currency });
        const saved = await sql`UPDATE ticket_requests SET status = 'awaiting_payment', stripe_session_id = ${checkout.id}
          WHERE id = ${request.id} AND status = 'pending' RETURNING id`;
        if (!saved[0]) return res.status(409).json({ error: "This ticket request was updated by another admin. Refresh the request list." });
      } else if (!request.stripeSessionId) {
        return res.status(409).json({ error: "The payment link is missing. Reopen the request and approve it again." });
      }
      await sendInfobipWhatsAppPayment(request.phone, checkoutUrl, request, request.guestName, request.amount, request.currency);
      return res.json({ status: "awaiting_payment", message: "Approved. A secure payment link was sent on WhatsApp; the ticket PDF is sent after payment." });
    }

    if (!["pending", "approved"].includes(request.status)) return res.status(409).json({ error: `This request is ${request.status} and cannot be approved.` });
    if (!request.ticketToken) {
      const token = randomBytes(24).toString("hex");
      const updated = await sql`UPDATE ticket_requests SET status = 'approved', ticket_token = ${token}
        WHERE id = ${request.id} AND status = 'pending' AND ticket_token IS NULL
        RETURNING ticket_token AS "ticketToken"`;
      request.ticketToken = updated[0]?.ticketToken;
    }
    if (!request.ticketToken) {
      const current = await sql`SELECT ticket_token AS "ticketToken", ticket_delivered_at AS "ticketDeliveredAt" FROM ticket_requests WHERE id = ${request.id} LIMIT 1`;
      request.ticketToken = current[0]?.ticketToken;
      request.ticketDeliveredAt = current[0]?.ticketDeliveredAt;
    }
    if (!request.ticketToken) return res.status(409).json({ error: "Could not issue a ticket token. Refresh and try again." });
    if (request.ticketDeliveredAt) return res.json({ status: request.status, ticketDeliveredAt: request.ticketDeliveredAt, message: "Ticket was already sent." });
    const eventDate = new Intl.DateTimeFormat("en-AE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${String(request.date).slice(0, 10)}T12:00:00Z`));
    const eventWhen = [eventDate, request.time].filter(Boolean).join(" at ");
    const approvedCaption = `Hi ${request.guestName}, you're in. Your ticket for ${request.eventTitle} on ${eventWhen}${request.venue ? `, ${request.venue}` : ""} is approved. We'll share the next steps shortly. Dress accordingly.\n\nTeam RSVP DXB`;
    await sendInfobipTicket(request.phone, `${host}/api/tickets/${request.ticketToken}.pdf`, `RSVP-DXB-${request.id}.pdf`, approvedCaption);
    const delivered = await sql`UPDATE ticket_requests SET status = 'approved', ticket_delivered_at = NOW() WHERE id = ${request.id} RETURNING ticket_delivered_at AS "ticketDeliveredAt"`;
    res.json({ status: "approved", ticketDeliveredAt: delivered[0]?.ticketDeliveredAt, message: "Approved and ticket PDF sent to the guest's WhatsApp." });
  } catch (error) { next(error); }
});
app.get("/api/auth/me", async (req, res, next) => {
  try {
    if (!sql) return res.json({ admin: null, demoMode: true, database: "unconfigured" });
    const admin = await queryDatabase(() => currentAdmin(req));
    res.json({ admin, demoMode: false, database: databaseStatus });
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body.password || "");
    const admin = sql
      ? (
          await queryDatabase(() => sql`SELECT id, name, email, password_hash, role FROM admin_users WHERE lower(email) = ${email} AND active = TRUE LIMIT 1`)
        )[0]
      : demoAdmins.find((item) => item.email === email);
    const passwordHash = admin?.password_hash || admin?.passwordHash;
    if (!admin || !(await verifyPassword(password, passwordHash)))
      return res.status(401).json({ error: "Email or password is incorrect." });
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + sessionLifetime);
    if (sql) {
      await sql`DELETE FROM admin_sessions WHERE expires_at <= NOW()`;
      await sql`INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (${tokenHash}, ${admin.id}, ${expiresAt.toISOString()})`;
    } else
      demoSessions.set(tokenHash, {
        adminId: admin.id,
        expiresAt: expiresAt.getTime(),
      });
    setSessionCookie(res, token, Math.floor(sessionLifetime / 1000));
    const {
      password: _password,
      passwordHash: _passwordHash,
      password_hash: _databasePasswordHash,
      ...safeAdmin
    } = admin;
    res.json({ admin: safeAdmin, demoMode: !sql });
  } catch (error) {
    next(error);
  }
});
app.post("/api/auth/logout", async (req, res, next) => {
  try {
    const token = getSessionToken(req);
    if (token) {
      const tokenHash = hashSessionToken(token);
      if (sql)
        await sql`DELETE FROM admin_sessions WHERE token_hash = ${tokenHash}`;
      else demoSessions.delete(tokenHash);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
app.post("/api/register", async (req, res, next) => {
  try {
    const name = text(req.body.name, 160);
    const email = text(req.body.email, 254).toLowerCase();
    const password = String(req.body.password || "");
    const track = normalizeTrack(req.body.track);
    const city = text(req.body.city, 120) || "Dubai";
    if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res
        .status(400)
        .json({ error: "Enter your name and a valid email address." });
    if (password.length < 12)
      return res
        .status(400)
        .json({ error: "Password must be at least 12 characters." });
    if (!["Media", "Creators", "Tastemakers", "Private Circle"].includes(track))
      return res.status(400).json({ error: "Choose a valid member track." });
    const profileUrl = text(req.body.profileUrl, 500);
    if (profileUrl) {
      try {
        if (!["http:", "https:"].includes(new URL(profileUrl).protocol))
          throw new Error("invalid protocol");
      } catch {
        return res
          .status(400)
          .json({ error: "Profile URL must start with http:// or https://." });
      }
    }
    if (sql) {
      const existing =
        await sql`SELECT email FROM members WHERE lower(email) = ${email} UNION ALL SELECT email FROM applications WHERE lower(email) = ${email} LIMIT 1`;
      if (existing.length)
        return res
          .status(409)
          .json({
            error: "An account or application already uses this email.",
          });
    } else if (
      [...demo.members, ...demo.applications].some(
        (row) => row.email?.toLowerCase() === email,
      )
    ) {
      return res
        .status(409)
        .json({ error: "An account or application already uses this email." });
    }
    const passwordHash = await hashPassword(password);
    const application = {
      id: `application-${crypto.randomUUID()}`,
      name,
      email,
      track,
      city,
      detail: text(req.body.role, 180),
      followers: String(
        Math.max(0, Number.parseInt(req.body.followers, 10) || 0),
      ),
      profileUrl,
      handle: text(req.body.handle, 120),
      platform: text(req.body.platform, 80),
      mobile: text(req.body.mobile, 40),
      outlet: text(req.body.outlet, 160),
      role: text(req.body.role, 160),
      allProfiles: text(req.body.allProfiles, 2000),
      sourceTrack: track,
      submitted: new Date().toISOString().slice(0, 10),
      status: "pending",
    };
    if (sql) {
      await sql`INSERT INTO applications (id, name, email, track, city, detail, followers, profile_url, handle, platform, mobile, outlet, application_role, all_profiles, source_track, password_hash, submitted, status) VALUES (${application.id}, ${name}, ${email}, ${track}, ${city}, ${application.detail}, ${application.followers}, ${application.profileUrl}, ${application.handle}, ${application.platform}, ${application.mobile}, ${application.outlet}, ${application.role}, ${application.allProfiles}, ${track}, ${passwordHash}, CURRENT_DATE, 'pending')`;
    } else {
      application.passwordHash = passwordHash;
      demo.applications.unshift(application);
    }
    res
      .status(201)
      .json({
        ok: true,
        status: "pending",
        message: "Your application was submitted for admin review.",
      });
  } catch (error) {
    next(error);
  }
});
app.post("/api/integrations/google-forms/creator-pass", async (req, res, next) => {
  try {
    const configuredSecret = String(process.env.GOOGLE_FORM_WEBHOOK_SECRET || "");
    const providedSecret = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const expected = Buffer.from(configuredSecret);
    const supplied = Buffer.from(providedSecret);
    if (expected.length < 32 || expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
      return res.status(401).json({ error: "Invalid form integration credentials." });
    if (!sql) return res.status(503).json({ error: "Creator pass intake requires the connected database." });

    const eventId = text(req.body.eventId, 180);
    const name = text(req.body.name, 120);
    const email = text(req.body.email, 254).toLowerCase();
    const phone = text(req.body.phone, 24).replace(/[^+\d]/g, "");
    const instagramHandle = text(req.body.instagramHandle, 100);
    const instagramFollowers = text(req.body.instagramFollowers, 40);
    const creatorAddress = text(req.body.creatorAddress, 500);
    if (name.length < 2 || !/^\+?\d{8,15}$/.test(phone))
      return res.status(400).json({ error: "A name and valid international phone number are required." });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "Enter a valid email address." });
    const events = await sql`SELECT id FROM events WHERE id = ${eventId} AND status = 'published' AND (date IS NULL OR date >= (NOW() AT TIME ZONE 'Asia/Dubai')::date) AND (application_deadline IS NULL OR application_deadline >= (NOW() AT TIME ZONE 'Asia/Dubai')::date) LIMIT 1`;
    if (!events[0]) return res.status(400).json({ error: "This event is not accepting creator pass requests." });
    const recent = await sql`SELECT id FROM event_ticket_inquiries WHERE event_id = ${eventId} AND phone = ${phone} AND request_type = 'creator_pass' AND status IN ('pending', 'accepted', 'waitlisted') LIMIT 1`;
    if (recent[0]) return res.json({ received: true, duplicate: true });
    const id = `google-form-${randomBytes(16).toString("hex")}`;
    await sql`INSERT INTO event_ticket_inquiries (id, event_id, full_name, email, phone, request_type, instagram_handle, instagram_followers, creator_address) VALUES (${id}, ${eventId}, ${name}, ${email}, ${phone}, 'creator_pass', ${instagramHandle}, ${instagramFollowers}, ${creatorAddress})`;
    res.status(201).json({ received: true });
  } catch (error) { next(error); }
});

app.get("/api/integrations/google-forms/creator-pass/events", async (req, res, next) => {
  try {
    const configuredSecret = String(process.env.GOOGLE_FORM_WEBHOOK_SECRET || "");
    const providedSecret = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const expected = Buffer.from(configuredSecret);
    const supplied = Buffer.from(providedSecret);
    if (expected.length < 32 || expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
      return res.status(401).json({ error: "Invalid form integration credentials." });
    if (!sql) return res.status(503).json({ error: "Creator pass intake requires the connected database." });

    const events = await sql`
      SELECT id, title, date::text AS date, venue
      FROM events
      WHERE status = 'published'
        AND creator_pass_note <> ''
        AND (date IS NULL OR date >= (NOW() AT TIME ZONE 'Asia/Dubai')::date)
        AND (application_deadline IS NULL OR application_deadline >= (NOW() AT TIME ZONE 'Asia/Dubai')::date)
      ORDER BY date NULLS LAST, title
    `;
    res.json(events);
  } catch (error) { next(error); }
});

app.get("/api/integrations/google-forms/public-intake/events", async (req, res, next) => {
  try {
    const configuredSecret = String(process.env.GOOGLE_FORM_WEBHOOK_SECRET || "");
    const providedSecret = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const expected = Buffer.from(configuredSecret);
    const supplied = Buffer.from(providedSecret);
    if (expected.length < 32 || expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
      return res.status(401).json({ error: "Invalid form integration credentials." });
    if (!sql) return res.status(503).json({ error: "Event selection requires the connected database." });
    const events = await sql`
      SELECT id, title, date::text AS date, venue
      FROM events
      WHERE status = 'published'
        AND (date IS NULL OR date >= (NOW() AT TIME ZONE 'Asia/Dubai')::date)
        AND (application_deadline IS NULL OR application_deadline >= (NOW() AT TIME ZONE 'Asia/Dubai')::date)
      ORDER BY date NULLS LAST, title
    `;
    res.json(events);
  } catch (error) { next(error); }
});

app.post("/api/integrations/google-forms/public-intake", async (req, res, next) => {
  try {
    const configuredSecret = String(process.env.GOOGLE_FORM_WEBHOOK_SECRET || "");
    const providedSecret = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const expected = Buffer.from(configuredSecret);
    const supplied = Buffer.from(providedSecret);
    if (expected.length < 32 || expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
      return res.status(401).json({ error: "Invalid form integration credentials." });
    if (!sql) return res.status(503).json({ error: "Form submissions require the connected database." });

    const kind = String(req.body.kind || "");
    const name = text(req.body.name, 120);
    const email = text(req.body.email, 254).toLowerCase();
    const phone = text(req.body.phone, 30).replace(/[^+\d]/g, "");
    const formId = text(req.body.formId, 180);
    const responseId = text(req.body.responseId, 180);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !formId || !responseId)
      return res.status(400).json({ error: "A name, valid email, and Google response ID are required." });

    const selectedEvents = Array.isArray(req.body.eventIds)
      ? [...new Set(req.body.eventIds.map((id) => text(id, 180)).filter(Boolean))].slice(0, 20)
      : [text(req.body.eventId, 180)].filter(Boolean);
    const notes = text(req.body.notes, 3000);
    const responseHash = createHash("sha256").update(`${formId}:${responseId}`).digest("hex");

    if (kind === "new_account") {
      const track = normalizeTrack(req.body.track);
      if (!track || !["Media", "Creators", "Tastemakers", "Private Circle"].includes(track))
        return res.status(400).json({ error: "Choose a valid member track." });
      const existing = await sql`
        SELECT email FROM members WHERE lower(email) = ${email}
        UNION ALL SELECT email FROM applications WHERE lower(email) = ${email}
        LIMIT 1
      `;
      if (existing[0]) return res.json({ received: true, duplicate: true, message: "This email already has an account or application. Existing members should sign in." });

      const profile = text(req.body.instagramProfile, 300);
      const profileMatch = profile.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{1,30})\/?$/i);
      const handleMatch = profile.match(/^@?([a-zA-Z0-9._]{1,30})$/);
      const instagramHandle = profileMatch?.[1] || handleMatch?.[1] || "";
      const handle = instagramHandle && !instagramHandle.startsWith(".") && !instagramHandle.endsWith(".") ? `@${instagramHandle}` : "";
      if (!handle) return res.status(400).json({ error: "Enter a valid Instagram profile or username." });
      const followers = text(req.body.instagramFollowers, 20).replace(/\D/g, "").slice(0, 10);
      if (!followers) return res.status(400).json({ error: "Enter your Instagram follower count." });
      const city = text(req.body.city, 100) || "Dubai";
      const outlet = text(req.body.outlet, 180);
      const role = text(req.body.role, 180);
      const detail = [notes, selectedEvents.length ? `Events of interest: ${selectedEvents.join(", ")}` : ""]
        .filter(Boolean).join("\n").slice(0, 1000);
      const applicationId = `gform-${responseHash.slice(0, 48)}`;
      const inserted = await sql`
        INSERT INTO applications (id, name, email, track, city, detail, followers, profile_url, handle,
          platform, mobile, outlet, application_role, all_profiles, source_track, password_hash, submitted, status)
        VALUES (${applicationId}, ${name}, ${email}, ${track}, ${city}, ${detail}, ${followers},
          ${handle ? `https://www.instagram.com/${handle.slice(1)}/` : ""}, ${handle}, 'Instagram', ${phone},
          ${outlet}, ${role}, '', ${track}, NULL, CURRENT_DATE, 'pending')
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `;
      if (!inserted[0]) return res.json({ received: true, duplicate: true });

      if (selectedEvents.length) {
        const selectedEventIds = new Set(selectedEvents);
        const publishedEvents = await sql`
          SELECT id, title FROM events
          WHERE status = 'published'
            AND (date IS NULL OR date >= (NOW() AT TIME ZONE 'Asia/Dubai')::date)
            AND (application_deadline IS NULL OR application_deadline >= (NOW() AT TIME ZONE 'Asia/Dubai')::date)
        `;
        const matchingEvents = publishedEvents.filter((event) => selectedEventIds.has(event.id));
        for (const event of matchingEvents) {
          await sql`
            INSERT INTO event_ticket_inquiries (id, event_id, full_name, email, phone, request_type, request_notes)
            VALUES (${`gform-interest-${createHash("sha256").update(`${responseHash}:${event.id}`).digest("hex").slice(0, 40)}`},
              ${event.id}, ${name}, ${email}, ${phone}, 'event_interest', ${`New member application. ${notes}`.trim()})
            ON CONFLICT (id) DO NOTHING
          `;
        }
      }
      return res.status(201).json({ received: true, applicationId });
    }

    if (kind !== "event_interest") return res.status(400).json({ error: "Unknown Google Form type." });
    if (!selectedEvents.length) return res.status(400).json({ error: "Choose an event." });
    const selectedEventIds = new Set(selectedEvents);
    const publishedEvents = await sql`
      SELECT id FROM events
      WHERE status = 'published'
        AND (date IS NULL OR date >= (NOW() AT TIME ZONE 'Asia/Dubai')::date)
        AND (application_deadline IS NULL OR application_deadline >= (NOW() AT TIME ZONE 'Asia/Dubai')::date)
    `;
    const matchingEvents = publishedEvents.filter((event) => selectedEventIds.has(event.id));
    if (!matchingEvents.length) return res.status(400).json({ error: "The selected event is no longer accepting enquiries." });
    for (const event of matchingEvents) {
      const inquiryId = `gform-interest-${createHash("sha256").update(`${responseHash}:${event.id}`).digest("hex").slice(0, 40)}`;
      await sql`
        INSERT INTO event_ticket_inquiries (id, event_id, full_name, email, phone, request_type, request_notes)
        VALUES (${inquiryId}, ${event.id}, ${name}, ${email}, ${phone}, 'event_interest', ${notes})
        ON CONFLICT (id) DO NOTHING
      `;
    }
    res.status(201).json({ received: true, events: matchingEvents.length });
  } catch (error) { next(error); }
});

app.use("/api", async (req, res, next) => {
  if (req.path === "/health" || req.path.startsWith("/auth/") || req.path.startsWith("/mobile/")) return next();
  try {
    const admin = await currentAdmin(req);
    if (!admin)
      return res
        .status(401)
        .json({ error: "Your admin session has ended. Sign in again." });
    req.admin = admin;
    next();
  } catch (error) {
    next(error);
  }
});

app.get("/api/newsletter", async (_req, res, next) => {
  try {
    if (!sql) return res.status(503).json({ error: "Newsletter campaigns require the connected production database." });
    const [counts, campaigns] = await Promise.all([
      sql`SELECT COUNT(*) FILTER (WHERE active = TRUE AND consented_at IS NOT NULL)::int AS active, COUNT(*) FILTER (WHERE active = FALSE)::int AS inactive FROM newsletter_subscribers`,
      sql`SELECT id, subject, image_url AS "imageUrl", event_id AS "eventId", event_title AS "eventTitle", status, recipient_count AS "recipientCount", sent_count AS "sentCount", failed_count AS "failedCount", created_by AS "createdBy", created_at AS "createdAt", completed_at AS "completedAt" FROM newsletter_campaigns ORDER BY created_at DESC LIMIT 20`,
    ]);
    const siteUrl = String(process.env.NEWSLETTER_PUBLIC_SITE_URL || "https://www.rsvpdxb.com").replace(/\/$/, "");
    res.json({ active: counts[0]?.active || 0, inactive: counts[0]?.inactive || 0, campaigns, siteUrl });
  } catch (error) { next(error); }
});

app.post("/api/newsletter/campaigns", async (req, res, next) => {
  try {
    if (!sql) return res.status(503).json({ error: "Newsletter campaigns require the connected production database." });
    if (req.body.confirmSend !== true) return res.status(400).json({ error: "Confirm that this campaign should be emailed to all active subscribers." });
    const subject = text(req.body.subject, 140);
    const body = String(req.body.body || "").trim().slice(0, 10000);
    const imageUrl = String(req.body.imageUrl || "").trim();
    const eventId = text(req.body.eventId, 200);
    if (subject.length < 4) return res.status(400).json({ error: "Enter a subject with at least 4 characters." });
    if (body.length < 20) return res.status(400).json({ error: "Enter a message with at least 20 characters." });
    if (imageUrl) {
      try {
        const image = new URL(imageUrl);
        const mediaBase = new URL(mediaBaseUrl);
        const mediaPath = `${mediaBase.pathname.replace(/\/$/, "")}/media/`;
        if (image.protocol !== "https:" || image.origin !== mediaBase.origin || !image.pathname.startsWith(mediaPath) || image.username || image.password) throw new Error();
      } catch { return res.status(400).json({ error: "Campaign images must be uploaded to the configured secure media storage." }); }
    }
    let event = null;
    if (eventId) {
      event = (await sql`SELECT id, title, date::text AS date, time, venue FROM events WHERE id = ${eventId} AND status = 'published' LIMIT 1`)[0] || null;
      if (!event) return res.status(400).json({ error: "Choose a currently published event for this campaign." });
    }
    const recipients = await sql`SELECT email, unsubscribe_token AS "unsubscribeToken" FROM newsletter_subscribers WHERE active = TRUE AND consented_at IS NOT NULL AND unsubscribe_token IS NOT NULL ORDER BY email`;
    if (!recipients.length) return res.status(400).json({ error: "There are no opted-in subscribers to send to." });

    const campaignId = `newsletter-${randomBytes(16).toString("hex")}`;
    const siteUrl = String(process.env.NEWSLETTER_PUBLIC_SITE_URL || "https://www.rsvpdxb.com").replace(/\/$/, "");
    const eventUrl = event ? `${siteUrl}/events/${encodeURIComponent(event.id)}` : "";
    await sql`INSERT INTO newsletter_campaigns (id, subject, body, image_url, event_id, event_title, status, recipient_count, created_by) VALUES (${campaignId}, ${subject}, ${body}, ${imageUrl}, ${event?.id || ""}, ${event?.title || ""}, 'queued', ${recipients.length}, ${req.admin.email})`;
    await sql`INSERT INTO newsletter_campaign_deliveries (campaign_id, email) SELECT ${campaignId}, email FROM newsletter_subscribers WHERE active = TRUE AND consented_at IS NOT NULL AND unsubscribe_token IS NOT NULL`;
    await sql`UPDATE newsletter_campaigns SET status = 'sending' WHERE id = ${campaignId}`;

    let cursor = 0;
    const workers = Array.from({ length: Math.min(3, recipients.length) }, async () => {
      while (cursor < recipients.length) {
        const recipient = recipients[cursor++];
        const unsubscribeUrl = `${siteUrl}/unsubscribe?token=${recipient.unsubscribeToken}`;
        try {
          await sendNewsletterCampaignEmail({ email: recipient.email, subject, body, imageUrl, eventUrl, eventTitle: event?.title || "", eventDate: event?.date || "", eventTime: event?.time || "", eventVenue: event?.venue || "", unsubscribeUrl });
          await sql`UPDATE newsletter_campaign_deliveries SET status = 'sent', sent_at = NOW(), error = '' WHERE campaign_id = ${campaignId} AND email = ${recipient.email}`;
          await sql`UPDATE newsletter_campaigns SET sent_count = sent_count + 1 WHERE id = ${campaignId}`;
        } catch (deliveryError) {
          const message = String(deliveryError?.message || "Email send failed.").slice(0, 500);
          await sql`UPDATE newsletter_campaign_deliveries SET status = 'failed', error = ${message} WHERE campaign_id = ${campaignId} AND email = ${recipient.email}`;
          await sql`UPDATE newsletter_campaigns SET failed_count = failed_count + 1 WHERE id = ${campaignId}`;
        }
      }
    });
    await Promise.all(workers);
    const failedCount = recipients.length - (await sql`SELECT COUNT(*)::int AS sent FROM newsletter_campaign_deliveries WHERE campaign_id = ${campaignId} AND status = 'sent'`)[0].sent;
    const status = failedCount === 0 ? "sent" : failedCount === recipients.length ? "failed" : "partial";
    const completed = await sql`UPDATE newsletter_campaigns SET status = ${status}, failed_count = ${failedCount}, completed_at = NOW() WHERE id = ${campaignId} RETURNING id, subject, image_url AS "imageUrl", event_id AS "eventId", event_title AS "eventTitle", status, recipient_count AS "recipientCount", sent_count AS "sentCount", failed_count AS "failedCount", created_at AS "createdAt", completed_at AS "completedAt"`;
    res.status(201).json({ campaign: completed[0] });
  } catch (error) { next(error); }
});

const getMobileToken = (req) => {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+([A-Za-z0-9_-]{32,100})$/i);
  return match?.[1] || null;
};

async function getMobileMember(req) {
  const token = getMobileToken(req);
  if (!token || !sql) return null;
  const tokenHash = hashSessionToken(token);
  const rows = await sql`
    SELECT m.id, m.name, m.email, m.track, m.points, m.rank, m.city, m.mobile,
      m.handle, m.followers, m.member_number AS "memberNumber"
    FROM member_sessions s JOIN members m ON m.id = s.member_id
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > NOW() AND m.status = 'approved'
    LIMIT 1
  `;
  return rows[0] || null;
}

async function verifyMemberPassword(password, storedHash) {
  const stored = String(storedHash || "");
  if (stored.startsWith("scrypt$")) {
    const [, salt, expectedHex] = stored.split("$");
    if (!salt || !/^[a-f0-9]{128}$/i.test(expectedHex || "")) return false;
    const actual = await scrypt(password, salt, 64);
    const expected = Buffer.from(expectedHex, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  return verifyPassword(password, stored);
}

async function hashMemberPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${hash.toString("hex")}`;
}

function mobileMemberResponse(member) {
  return { id: member.id, name: member.name, email: member.email, track: member.track, points: member.points, rank: member.rank, city: member.city, mobile: member.mobile, handle: member.handle, followers: member.followers, memberNumber: member.memberNumber };
}

app.get("/api/mobile/events", async (_req, res, next) => {
  try {
    if (!sql) return res.status(503).json({ error: "Mobile data requires the shared database to be configured." });
    const rows = await sql`
      SELECT id, title, brand, venue, to_char(date, 'YYYY-MM-DD') AS date, time,
        application_deadline::text AS "applicationDeadline", action_label AS "actionLabel",
        area, category, tracks, capacity, confirmed, dress_code AS "dressCode",
        about, included, who_is_invited AS "whoIsInvited", host_note AS "hostNote",
        ticket_url AS "ticketUrl", reservation_phone AS "reservationPhone",
        creator_pass_note AS "creatorPassNote", age_restriction AS "ageRestriction",
        hashtag, track_capacities AS "trackCapacities", influencer_deliverables AS "influencerDeliverables",
        map_url AS "mapUrl", image_gallery AS "imageGallery", image_data AS "imageData", top_pick AS "topPick",
        video_url AS video, status
      FROM events WHERE status IN ('published', 'closed') ORDER BY date, time
    `;
    res.json(rows);
  } catch (error) { next(error); }
});

app.get("/api/mobile/people-profiles", async (_req, res, next) => {
  try {
    if (!sql) return res.status(503).json({ error: "People profiles require the shared database." });
    const rows = await sql`
      SELECT id, category, name, role, subtitle, bio, image_url AS "imageUrl",
        instagram_url AS "instagramUrl", tiktok_url AS "tiktokUrl",
        youtube_url AS "youtubeUrl", x_url AS "xUrl",
        display_order AS "displayOrder"
      FROM people_profiles
      WHERE active = TRUE
      ORDER BY category, display_order, created_at DESC
    `;
    res.json(rows);
  } catch (error) { next(error); }
});

app.get("/api/mobile/venues", async (_req, res, next) => {
  try {
    if (!sql) return res.status(503).json({ error: "Venue picks require the shared database." });
    const rows = await sql`
      SELECT id, slug, category, name, tagline, description, location, highlights, offer,
        featured_date::text AS "featuredDate", image_url AS "imageUrl", gallery_images AS "galleryImages",
        website_url AS "websiteUrl", more_info_url AS "moreInfoUrl",
        display_order AS "displayOrder", featured, active
      FROM venues
      WHERE active = TRUE AND content_reviewed = TRUE
      ORDER BY featured DESC, CASE category
        WHEN 'Our partners' THEN 1 WHEN 'Desi luxe' THEN 2 WHEN 'Dinner to party' THEN 3
        WHEN 'Bars & night culture' THEN 4 WHEN 'Coffee' THEN 5 ELSE 6 END,
        display_order, name
    `;
    res.json(rows);
  } catch (error) { next(error); }
});

app.post("/api/mobile/password-reset", async (req, res, next) => {
  try {
    const email = text(req.body.email, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (!sql) return res.json({ ok: true });
    const member = (await sql`SELECT id, name, email FROM members WHERE lower(email) = ${email} AND status = 'approved' LIMIT 1`)[0];
    if (!member) return res.json({ ok: true });
    const recent = await sql`SELECT 1 FROM member_password_resets WHERE member_id = ${member.id} AND created_at > NOW() - INTERVAL '1 minute' LIMIT 1`;
    if (recent.length) return res.json({ ok: true });

    const token = randomBytes(32).toString("hex");
    const tokenHash = hashSessionToken(token);
    await sql`DELETE FROM member_password_resets WHERE member_id = ${member.id}`;
    await sql`INSERT INTO member_password_resets (token_hash, member_id, expires_at) VALUES (${tokenHash}, ${member.id}, NOW() + INTERVAL '30 minutes')`;
    const siteUrl = String(process.env.PUBLIC_SITE_URL || "https://www.rsvpdxb.com").replace(/\/$/, "");
    const resetUrl = `${siteUrl}/reset-password?token=${token}`;
    try {
      await sendMemberPasswordResetEmail({ email: member.email, name: member.name, resetUrl });
    } catch (deliveryError) {
      await sql`DELETE FROM member_password_resets WHERE token_hash = ${tokenHash}`;
      console.error("Mobile member password reset email could not be sent", deliveryError);
    }
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.post("/api/mobile/sign-in", async (req, res, next) => {
  try {
    if (!sql) return res.status(503).json({ error: "Member sign-in requires the shared database." });
    const email = text(req.body.email, 254).toLowerCase();
    const password = String(req.body.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length > 200) {
      return res.status(400).json({ error: "Email or password is incorrect." });
    }
    const rows = await sql`
      SELECT id, name, email, track, points, rank, city, mobile, handle, followers,
        member_number AS "memberNumber", password_hash AS "passwordHash"
      FROM members WHERE lower(email) = ${email} AND status = 'approved' LIMIT 1
    `;
    const member = rows[0];
    if (!member || !(await verifyMemberPassword(password, member.passwordHash))) {
      const pending = await sql`SELECT id FROM applications WHERE lower(email) = ${email} AND status = 'pending' LIMIT 1`;
      return res.status(401).json({ error: pending.length ? "Your application is still under review. Sign in after approval." : "Email or password is incorrect." });
    }
    const token = createSessionToken();
    await sql`INSERT INTO member_sessions (token_hash, member_id, expires_at) VALUES (${hashSessionToken(token)}, ${member.id}, NOW() + (${mobileSessionLifetimeSeconds} * INTERVAL '1 second'))`;
    const { passwordHash: _passwordHash, ...safeMember } = member;
    res.json({ ...safeMember, accessToken: token });
  } catch (error) { next(error); }
});

app.get("/api/mobile/session", async (req, res, next) => {
  try {
    const member = await getMobileMember(req);
    if (!member) return res.status(401).json({ error: "Sign in required." });
    res.json(mobileMemberResponse(member));
  } catch (error) { next(error); }
});

app.post("/api/mobile/sign-out", async (req, res, next) => {
  try {
    const token = getMobileToken(req);
    if (token && sql) await sql`DELETE FROM member_sessions WHERE token_hash = ${hashSessionToken(token)}`;
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get("/api/mobile/rsvps", async (req, res, next) => {
  try {
    const member = await getMobileMember(req);
    if (!member) return res.status(401).json({ error: "Sign in required." });
    const rows = await sql`SELECT event_id AS "eventId", status AS state FROM event_rsvp_requests WHERE member_id = ${member.id}`;
    res.json(Object.fromEntries(rows.map((row) => [row.eventId, row.state])));
  } catch (error) { next(error); }
});

app.post("/api/mobile/rsvps", async (req, res, next) => {
  try {
    const member = await getMobileMember(req);
    if (!member) return res.status(401).json({ error: "Sign in with an approved member account to RSVP." });
    const eventId = text(req.body.eventId, 180);
    const guestNames = req.body.guestNames;
    if (!Array.isArray(guestNames) || guestNames.length > 2 || guestNames.some((name) => typeof name !== "string" || name.trim().length < 2 || name.trim().length > 120)) {
      return res.status(400).json({ error: "Add each guest's full name, up to two guests." });
    }
    const rows = await sql`SELECT id, title, tracks, status, influencer_deliverables AS deliverables FROM events WHERE id = ${eventId} LIMIT 1`;
    const event = rows[0];
    if (!event || event.status !== "published") return res.status(400).json({ error: "This event is not accepting RSVP requests." });
    if (!event.tracks.includes(member.track)) return res.status(403).json({ error: "This event is not open to your member track." });
    const deliverablesAgreed = Boolean(req.body.deliverablesAgreed);
    if (member.track === "Creators" && event.deliverables.trim() && !deliverablesAgreed) {
      return res.status(400).json({ error: "Please review and agree to the creator deliverables before submitting." });
    }
    const normalizedGuests = guestNames.map((name) => name.trim());
    const inserted = await sql`
      INSERT INTO event_rsvp_requests (id, event_id, member_id, member_email, track, guest_names, deliverables_agreed, status)
      VALUES (${`rsvp-${randomBytes(16).toString("hex")}`}, ${event.id}, ${member.id}, ${member.email}, ${member.track}, ${normalizedGuests}, ${member.track === "Creators" ? deliverablesAgreed : false}, 'pending')
      ON CONFLICT (event_id, member_id) DO UPDATE SET guest_names = EXCLUDED.guest_names,
        deliverables_agreed = EXCLUDED.deliverables_agreed, status = 'pending',
        reviewed_at = NULL, reviewed_by = NULL, created_at = NOW(), updated_at = NOW()
      WHERE event_rsvp_requests.status = 'declined'
      RETURNING status
    `;
    if (!inserted[0]) {
      const existing = await sql`SELECT status FROM event_rsvp_requests WHERE event_id = ${event.id} AND member_id = ${member.id} LIMIT 1`;
      return res.status(409).json({ error: existing[0] ? `You already have an RSVP request for this event (${existing[0].status}).` : "Your RSVP request could not be saved." });
    }
    res.status(201).json({ status: inserted[0].status });
  } catch (error) { next(error); }
});

app.post("/api/mobile/rsvps/cancel", async (req, res, next) => {
  try {
    const member = await getMobileMember(req);
    if (!member) return res.status(401).json({ error: "Sign in required." });
    const id = `mobile-rsvp-${randomBytes(12).toString("hex")}`;
    const result = await sql`
      WITH target AS (
        SELECT id, event_id, status, cardinality(guest_names) + 1 AS party_size
        FROM event_rsvp_requests WHERE member_id = ${member.id} AND event_id = ${text(req.body.eventId, 180)}
      ), capacity AS (
        UPDATE events e SET confirmed = GREATEST(e.confirmed - COALESCE((SELECT party_size FROM target WHERE status = 'accepted'), 0), 0), updated_at = NOW()
        WHERE e.id = (SELECT event_id FROM target) RETURNING e.id
      ), removed AS (
        DELETE FROM event_rsvp_requests r USING target t WHERE r.id = t.id AND EXISTS (SELECT 1 FROM capacity) RETURNING r.id
      ) SELECT id FROM removed
    `;
    if (!result.length) return res.status(404).json({ error: "No RSVP request was found for this event." });
    res.json({ ok: true, id });
  } catch (error) { next(error); }
});

app.post("/api/mobile/profile", async (req, res, next) => {
  try {
    const member = await getMobileMember(req);
    if (!member) return res.status(401).json({ error: "Sign in to update your profile." });
    const name = text(req.body.name, 120);
    const city = text(req.body.city, 100);
    const mobileInput = text(req.body.mobile, 40);
    const digits = mobileInput.replace(/\D/g, "");
    const mobile = `${mobileInput.startsWith("+") ? "+" : ""}${digits}`;
    const instagram = text(req.body.instagram, 100).replace(/^@+/, "");
    const followers = Number(String(req.body.followers || "").replace(/[ ,]/g, ""));
    if (!name || !city || digits.length < 8 || digits.length > 15 || !Number.isSafeInteger(followers) || followers < 0) {
      return res.status(400).json({ error: "Enter your name, city, valid phone number, and follower count." });
    }
    const profileUrl = instagram ? `https://www.instagram.com/${encodeURIComponent(instagram)}/` : "";
    const rows = await sql`
      UPDATE members SET name = ${name}, city = ${city}, mobile = ${mobile}, handle = ${instagram}, profile_url = ${profileUrl}, followers = ${followers}
      WHERE id = ${member.id} AND status = 'approved'
      RETURNING id, name, email, track, points, rank, city, mobile, handle, followers
    `;
    if (!rows[0]) return res.status(404).json({ error: "Member profile was not found." });
    res.json(rows[0]);
  } catch (error) { next(error); }
});

app.post("/api/mobile/password", async (req, res, next) => {
  try {
    const member = await getMobileMember(req);
    if (!member) return res.status(401).json({ error: "Sign in to update your password." });
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");
    if (!currentPassword || newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9\s]/.test(newPassword)) {
      return res.status(400).json({ error: "Use at least 8 characters, including an uppercase letter, a number, and a special character." });
    }
    const rows = await sql`SELECT password_hash AS "passwordHash" FROM members WHERE id = ${member.id} AND status = 'approved' LIMIT 1`;
    if (!rows[0] || !(await verifyMemberPassword(currentPassword, rows[0].passwordHash))) {
      return res.status(400).json({ error: "Your current password is incorrect." });
    }
    const passwordHash = await hashMemberPassword(newPassword);
    await sql`UPDATE members SET password_hash = ${passwordHash} WHERE id = ${member.id} AND status = 'approved'`;
    await sql`DELETE FROM member_sessions WHERE member_id = ${member.id}`;
    res.json({ ok: true, signedOut: true });
  } catch (error) { next(error); }
});

app.post("/api/media/upload-url", async (req, res, next) => {
  try {
    if (!s3 || !mediaBaseUrl) return res.status(503).json({ error: "Media storage is not configured." });
    const filename = text(req.body.filename, 160);
    const contentType = text(req.body.contentType, 100).toLowerCase();
    const size = Number(req.body.size);
    const siteGalleryVideo = req.body.purpose === "site-gallery" && contentType.startsWith("video/");
    const siteGalleryCaptions = req.body.purpose === "site-gallery" && contentType === "text/vtt";
    const venueImage = req.body.purpose === "venue-image" && contentType.startsWith("image/");
    const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "text/vtt": "vtt" };
    if (!extensions[contentType] || (contentType === "text/vtt" && !siteGalleryCaptions)) return res.status(400).json({ error: "Use a JPG, PNG, WebP image or MP4, WebM, MOV video. Gallery captions can be uploaded as WebVTT." });
    const maxBytes = siteGalleryCaptions ? 1024 * 1024 : contentType.startsWith("video/") ? (siteGalleryVideo ? 500 : 100) * 1024 * 1024 : (venueImage ? 50 : 12) * 1024 * 1024;
    if (!Number.isInteger(size) || size <= 0 || size > maxBytes) return res.status(400).json({ error: `File must be smaller than ${contentType.startsWith("video/") ? `${siteGalleryVideo ? "500" : "100"} MB` : `${venueImage ? "50" : "12"} MB`}.` });
    const safeName = filename.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100) || `upload.${extensions[contentType]}`;
    // S3 has a flat keyspace; omit date prefixes so uploads appear directly in media/.
    const key = `media/${crypto.randomUUID()}-${safeName}`;
    const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: mediaBucket, Key: key, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }), { expiresIn: 300 });
    res.json({ uploadUrl, key, publicUrl: `${mediaBaseUrl}/${key}`, contentType, maxBytes });
  } catch (error) { next(error); }
});
app.post("/api/site-media", async (req, res, next) => {
  try {
    const slot = req.body.slot === "top_pick" ? "top_pick" : req.body.slot === "gallery" ? "gallery" : "";
    const title = text(req.body.title, 180);
    const caption = text(req.body.caption, 500);
    const captionsUrl = String(req.body.captionsUrl || "");
    const imageUrl = String(req.body.imageUrl || "");
    const mediaType = req.body.mediaType === "video" ? "video" : "image";
    const objectKey = String(req.body.objectKey || "");
    const linkUrl = text(req.body.linkUrl, 500);
    const validType = mediaType === "video" ? slot === "gallery" && /\.(mp4|webm|mov)$/i.test(objectKey) : true;
    if (!slot || !title || !validType || !mediaBaseUrl || !objectKey.startsWith("media/") || imageUrl !== `${mediaBaseUrl}/${objectKey}`) {
      return res.status(400).json({ error: "Choose a section, title and valid RSVP media upload." });
    }
    if (linkUrl) {
      try { if (!["http:", "https:"].includes(new URL(linkUrl).protocol)) throw new Error(); }
      catch { return res.status(400).json({ error: "Link must use http:// or https://." }); }
    }
    const id = `site-media-${crypto.randomUUID()}`;
    const displayOrder = Math.max(0, Math.min(9999, Number(req.body.displayOrder) || 0));
    if (captionsUrl && (mediaType !== "video" || !captionsUrl.startsWith(`${mediaBaseUrl}/media/`) || !captionsUrl.toLowerCase().endsWith(".vtt"))) return res.status(400).json({ error: "Video captions must be a WebVTT file uploaded to RSVP media storage." });
    const item = { id, slot, title, caption, imageUrl, mediaType, captionsUrl, objectKey, linkUrl, displayOrder, active: true };
    if (sql) await sql`INSERT INTO site_media (id, slot, title, caption, image_url, object_key, link_url, display_order, media_type, captions_url) VALUES (${id}, ${slot}, ${title}, ${caption}, ${imageUrl}, ${objectKey}, ${linkUrl}, ${displayOrder}, ${mediaType}, ${captionsUrl})`;
    else demo.site_media.unshift(item);
    res.status(201).json(item);
  } catch (error) { next(error); }
});
app.patch("/api/site-media/:id", async (req, res, next) => {
  try {
    if ("title" in req.body || "slot" in req.body || "caption" in req.body || "linkUrl" in req.body || "captionsUrl" in req.body) {
      const slot = req.body.slot === "top_pick" ? "top_pick" : req.body.slot === "gallery" ? "gallery" : "";
      const title = text(req.body.title, 180);
      const caption = text(req.body.caption, 500);
      const captionsUrl = String(req.body.captionsUrl || "");
      const linkUrl = text(req.body.linkUrl, 500);
      if (!slot || !title) return res.status(400).json({ error: "Choose a section and enter a title." });
      if (linkUrl) {
        try { if (!["http:", "https:"].includes(new URL(linkUrl).protocol)) throw new Error(); }
        catch { return res.status(400).json({ error: "Link must use http:// or https://." }); }
      }
      if (sql) {
        const existing = await sql`SELECT COALESCE(media_type, 'image') AS "mediaType" FROM site_media WHERE id = ${req.params.id} LIMIT 1`;
        if (!existing[0]) return res.status(404).json({ error: "Website media item not found." });
        if (existing[0].mediaType === "video" && slot === "top_pick") return res.status(400).json({ error: "Videos can only be used in the Gallery." });
        if (captionsUrl && (existing[0].mediaType !== "video" || !captionsUrl.startsWith(`${mediaBaseUrl}/media/`) || !captionsUrl.toLowerCase().endsWith(".vtt"))) return res.status(400).json({ error: "Video captions must be a WebVTT file uploaded to RSVP media storage." });
        const rows = await sql`UPDATE site_media SET slot = ${slot}, title = ${title}, caption = ${caption}, link_url = ${linkUrl}, captions_url = ${captionsUrl} WHERE id = ${req.params.id} RETURNING id, slot, title, caption, image_url AS "imageUrl", COALESCE(media_type, 'image') AS "mediaType", captions_url AS "captionsUrl", object_key AS "objectKey", link_url AS "linkUrl", display_order AS "displayOrder", active`;
        if (!rows[0]) return res.status(404).json({ error: "Website media item not found." });
        return res.json(rows[0]);
      }
      const item = demo.site_media.find((row) => row.id === req.params.id);
      if (!item) return res.status(404).json({ error: "Website media item not found." });
      if (item.mediaType === "video" && slot === "top_pick") return res.status(400).json({ error: "Videos can only be used in the Gallery." });
      Object.assign(item, { slot, title, caption, linkUrl, captionsUrl });
      return res.json(item);
    }
    const active = Boolean(req.body.active);
    if (sql) {
      const rows = await sql`UPDATE site_media SET active = ${active} WHERE id = ${req.params.id} RETURNING id, slot, title, caption, image_url AS "imageUrl", COALESCE(media_type, 'image') AS "mediaType", COALESCE(captions_url, '') AS "captionsUrl", object_key AS "objectKey", link_url AS "linkUrl", display_order AS "displayOrder", active`;
      if (!rows[0]) return res.status(404).json({ error: "Website media item not found." });
      return res.json(rows[0]);
    }
    const item = demo.site_media.find((row) => row.id === req.params.id);
    if (!item) return res.status(404).json({ error: "Website media item not found." });
    item.active = active;
    res.json(item);
  } catch (error) { next(error); }
});
app.delete("/api/site-media/:id", async (req, res, next) => {
  try {
    if (sql) {
      const rows = await sql`DELETE FROM site_media WHERE id = ${req.params.id} RETURNING id`;
      if (!rows[0]) return res.status(404).json({ error: "Website media item not found." });
      return res.json({ id: rows[0].id, deleted: true });
    }
    const index = demo.site_media.findIndex((row) => row.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Website media item not found." });
    const [item] = demo.site_media.splice(index, 1);
    res.json({ id: item.id, deleted: true });
  } catch (error) { next(error); }
});
app.post("/api/people-profiles", async (req, res, next) => {
  try {
    const category = ["artist", "influencer"].includes(req.body.category) ? req.body.category : "";
    const name = text(req.body.name, 140);
    const role = text(req.body.role, 180);
    const subtitle = text(req.body.subtitle, 240);
    const bio = String(req.body.bio ?? "").trim();
    const imageUrl = String(req.body.imageUrl || "");
    const objectKey = String(req.body.objectKey || "");
    const social = {
      instagramUrl: text(req.body.instagramUrl, 500),
      tiktokUrl: text(req.body.tiktokUrl, 500),
      youtubeUrl: text(req.body.youtubeUrl, 500),
      xUrl: text(req.body.xUrl, 500),
    };
    if (!category || !name || !role || !mediaBaseUrl || !objectKey.startsWith("media/") || imageUrl !== `${mediaBaseUrl}/${objectKey}`) {
      return res.status(400).json({ error: "Choose a profile type, name, role and valid uploaded image." });
    }
    for (const value of Object.values(social)) {
      if (!value) continue;
      try { if (!["http:", "https:"].includes(new URL(value).protocol)) throw new Error(); }
      catch { return res.status(400).json({ error: "Social profile links must start with http:// or https://." }); }
    }
    const id = `person-${crypto.randomUUID()}`;
    const item = { id, category, name, role, subtitle, bio, imageUrl, objectKey, ...social, displayOrder: 0, active: true };
    if (sql) await sql`INSERT INTO people_profiles (id, category, name, role, subtitle, bio, image_url, object_key, instagram_url, tiktok_url, youtube_url, x_url) VALUES (${id}, ${category}, ${name}, ${role}, ${subtitle}, ${bio}, ${imageUrl}, ${objectKey}, ${social.instagramUrl}, ${social.tiktokUrl}, ${social.youtubeUrl}, ${social.xUrl})`;
    else demo.people_profiles.unshift(item);
    res.status(201).json(item);
  } catch (error) { next(error); }
});
app.patch("/api/people-profiles/:id", async (req, res, next) => {
  try {
    if (typeof req.body.active !== "boolean") {
      const category = ["artist", "influencer"].includes(req.body.category) ? req.body.category : "";
      const name = text(req.body.name, 140);
      const role = text(req.body.role, 180);
      const subtitle = text(req.body.subtitle, 240);
      const bio = String(req.body.bio ?? "").trim();
      const imageUrl = String(req.body.imageUrl || "");
      const objectKey = String(req.body.objectKey || "");
      const social = {
        instagramUrl: text(req.body.instagramUrl, 500),
        tiktokUrl: text(req.body.tiktokUrl, 500),
        youtubeUrl: text(req.body.youtubeUrl, 500),
        xUrl: text(req.body.xUrl, 500),
      };
      if (!category || !name || !role || !mediaBaseUrl || !objectKey.startsWith("media/") || imageUrl !== `${mediaBaseUrl}/${objectKey}`) {
        return res.status(400).json({ error: "Choose a profile type, name, role and valid uploaded image." });
      }
      for (const value of Object.values(social)) {
        if (!value) continue;
        try { if (!["http:", "https:"].includes(new URL(value).protocol)) throw new Error(); }
        catch { return res.status(400).json({ error: "Social profile links must start with http:// or https://." }); }
      }
      if (sql) {
        const rows = await sql`UPDATE people_profiles SET category = ${category}, name = ${name}, role = ${role}, subtitle = ${subtitle}, bio = ${bio}, image_url = ${imageUrl}, object_key = ${objectKey}, instagram_url = ${social.instagramUrl}, tiktok_url = ${social.tiktokUrl}, youtube_url = ${social.youtubeUrl}, x_url = ${social.xUrl} WHERE id = ${req.params.id} RETURNING id, category, name, role, subtitle, bio, image_url AS "imageUrl", object_key AS "objectKey", instagram_url AS "instagramUrl", tiktok_url AS "tiktokUrl", youtube_url AS "youtubeUrl", x_url AS "xUrl", display_order AS "displayOrder", active`;
        if (!rows[0]) return res.status(404).json({ error: "Profile not found." });
        return res.json(rows[0]);
      }
      const item = demo.people_profiles.find((row) => row.id === req.params.id);
      if (!item) return res.status(404).json({ error: "Profile not found." });
      Object.assign(item, { category, name, role, subtitle, bio, imageUrl, objectKey, ...social });
      return res.json(item);
    }
    const active = req.body.active;
    if (sql) {
      const rows = await sql`UPDATE people_profiles SET active = ${active} WHERE id = ${req.params.id} RETURNING id, active`;
      if (!rows[0]) return res.status(404).json({ error: "Profile not found." });
      return res.json(rows[0]);
    }
    const item = demo.people_profiles.find((row) => row.id === req.params.id);
    if (!item) return res.status(404).json({ error: "Profile not found." });
    item.active = active;
    res.json(item);
  } catch (error) { next(error); }
});
const VENUE_CATEGORIES = ["Our partners", "Desi luxe", "Dinner to party", "Bars & night culture", "Coffee", "Daytime & alcohol-free"];
const venueSlug = (value) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function validWebUrl(value) {
  if (!value) return true;
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}
function venuePayload(body = {}) {
  const category = VENUE_CATEGORIES.includes(body.category) ? body.category : "";
  const name = text(body.name, 180);
  const slug = venueSlug(name);
  const tagline = text(body.tagline, 240);
  const description = String(body.description || "").trim();
  const location = text(body.location, 500);
  const highlights = Array.isArray(body.highlights)
    ? body.highlights.map((value) => text(value, 240)).filter(Boolean).slice(0, 30)
    : String(body.highlights || "").split(/\r?\n/).map((value) => text(value, 240)).filter(Boolean).slice(0, 30);
  const offer = String(body.offer || "").trim();
  const featuredDate = String(body.featuredDate || "").trim();
  const imageUrl = String(body.imageUrl || "");
  const objectKey = String(body.objectKey || "");
  const galleryImages = Array.isArray(body.galleryImages) ? body.galleryImages.map((value) => String(value || "").trim()).filter(Boolean) : [];
  const websiteUrl = text(body.websiteUrl, 500);
  const moreInfoUrl = text(body.moreInfoUrl, 500);
  const displayOrder = Math.max(0, Math.min(9999, Number(body.displayOrder) || 0));
  if (!category || !name || !slug || !location || !description || !mediaBaseUrl || !objectKey.startsWith("media/") || imageUrl !== `${mediaBaseUrl}/${objectKey}`) {
    return { error: "Add a category, name, location, description and a valid uploaded venue image." };
  }
  if (featuredDate && !/^\d{4}-\d{2}-\d{2}$/.test(featuredDate)) return { error: "Featured date must be a valid date." };
  if (galleryImages.length > 12 || galleryImages.some((url) => !mediaBaseUrl || !url.startsWith(`${mediaBaseUrl}/media/`))) return { error: "Choose up to 12 gallery images uploaded to the configured media storage." };
  if (![websiteUrl, moreInfoUrl].every(validWebUrl)) return { error: "Website and More info links must start with http:// or https://." };
  const contentReviewed = Boolean(body.contentReviewed);
  return { value: { category, name, slug, tagline, description, location, highlights, offer, featuredDate: featuredDate || null, imageUrl, objectKey, galleryImages, websiteUrl, moreInfoUrl, displayOrder, contentReviewed, featured: Boolean(body.featured) && contentReviewed } };
}
app.post("/api/venues", async (req, res, next) => {
  try {
    const parsed = venuePayload(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const id = `venue-${crypto.randomUUID()}`;
    const item = { id, ...parsed.value, active: parsed.value.contentReviewed };
    if (sql) {
      const v = parsed.value;
      const rows = await sql`INSERT INTO venues (id, slug, category, name, tagline, description, location, highlights, offer, featured_date, image_url, object_key, gallery_images, website_url, more_info_url, display_order, content_reviewed, featured, active) VALUES (${id}, ${v.slug}, ${v.category}, ${v.name}, ${v.tagline}, ${v.description}, ${v.location}, ${v.highlights}, ${v.offer}, ${v.featuredDate}, ${v.imageUrl}, ${v.objectKey}, ${v.galleryImages}, ${v.websiteUrl}, ${v.moreInfoUrl}, ${v.displayOrder}, ${v.contentReviewed}, ${v.featured}, ${item.active}) RETURNING id, slug, category, name, tagline, description, location, highlights, offer, featured_date::text AS "featuredDate", image_url AS "imageUrl", object_key AS "objectKey", gallery_images AS "galleryImages", website_url AS "websiteUrl", more_info_url AS "moreInfoUrl", display_order AS "displayOrder", content_reviewed AS "contentReviewed", featured, active`;
      return res.status(201).json(rows[0]);
    }
    demo.venues.unshift(item);
    res.status(201).json(item);
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "A venue with that name already exists. Use a distinct name to keep its page URL unique." });
    next(error);
  }
});
app.patch("/api/venues/:id", async (req, res, next) => {
  try {
    const statusOnlyUpdate = Object.keys(req.body).length === 1 && (typeof req.body.active === "boolean" || typeof req.body.featured === "boolean");
    if (statusOnlyUpdate) {
      const active = typeof req.body.active === "boolean" ? req.body.active : undefined;
      const featured = typeof req.body.featured === "boolean" ? req.body.featured : undefined;
      if (sql) {
        const current = (await sql`SELECT content_reviewed AS "contentReviewed", active FROM venues WHERE id = ${req.params.id} LIMIT 1`)[0];
        if (!current) return res.status(404).json({ error: "Venue not found." });
        if ((active === true || featured === true) && !current.contentReviewed) return res.status(400).json({ error: "Confirm the venue details, current offer, approved image and sign-off before publishing." });
        if (featured === true && !current.active) return res.status(400).json({ error: "Publish the venue before featuring it on the homepage." });
        const rows = await sql`UPDATE venues SET active = COALESCE(${active ?? null}, active), featured = COALESCE(${featured ?? null}, featured), updated_at = NOW() WHERE id = ${req.params.id} RETURNING id, active, featured`;
        if (!rows[0]) return res.status(404).json({ error: "Venue not found." });
        return res.json(rows[0]);
      }
      const item = demo.venues.find((venue) => venue.id === req.params.id);
      if (!item) return res.status(404).json({ error: "Venue not found." });
      if ((active === true || featured === true) && !item.contentReviewed) return res.status(400).json({ error: "Confirm the venue details, current offer, approved image and sign-off before publishing." });
      if (featured === true && !item.active) return res.status(400).json({ error: "Publish the venue before featuring it on the homepage." });
      if (active !== undefined) item.active = active;
      if (featured !== undefined) item.featured = featured;
      return res.json(item);
    }
    const parsed = venuePayload(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const v = parsed.value;
    if (sql) {
      const rows = await sql`UPDATE venues SET slug = ${v.slug}, category = ${v.category}, name = ${v.name}, tagline = ${v.tagline}, description = ${v.description}, location = ${v.location}, highlights = ${v.highlights}, offer = ${v.offer}, featured_date = ${v.featuredDate}, image_url = ${v.imageUrl}, object_key = ${v.objectKey}, gallery_images = ${v.galleryImages}, website_url = ${v.websiteUrl}, more_info_url = ${v.moreInfoUrl}, display_order = ${v.displayOrder}, content_reviewed = ${v.contentReviewed}, active = CASE WHEN ${v.contentReviewed} THEN active ELSE FALSE END, featured = CASE WHEN ${v.contentReviewed} THEN ${v.featured} ELSE FALSE END, updated_at = NOW() WHERE id = ${req.params.id} RETURNING id, slug, category, name, tagline, description, location, highlights, offer, featured_date::text AS "featuredDate", image_url AS "imageUrl", object_key AS "objectKey", gallery_images AS "galleryImages", website_url AS "websiteUrl", more_info_url AS "moreInfoUrl", display_order AS "displayOrder", content_reviewed AS "contentReviewed", featured, active`;
      if (!rows[0]) return res.status(404).json({ error: "Venue not found." });
      return res.json(rows[0]);
    }
    const item = demo.venues.find((venue) => venue.id === req.params.id);
    if (!item) return res.status(404).json({ error: "Venue not found." });
    Object.assign(item, v, { active: v.contentReviewed ? item.active : false, featured: v.contentReviewed ? v.featured : false });
    res.json(item);
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "A venue with that name already exists. Use a distinct name to keep its page URL unique." });
    next(error);
  }
});
app.get("/api/dashboard", async (_req, res, next) => {
  try {
    if (sql) {
      const [counts] = await sql`
        SELECT
          (SELECT COUNT(*)::int FROM applications WHERE status = 'pending') AS "pendingApplications",
          (SELECT COUNT(*)::int FROM members) AS members,
          (SELECT COALESCE(SUM(confirmed), 0)::int FROM events WHERE status = 'published') AS "weeklyRsvps",
          (SELECT COUNT(*)::int FROM guests WHERE checked_in_at IS NOT NULL) AS "checkedIn",
          (SELECT COUNT(*)::int FROM guests) AS expected,
          (SELECT COUNT(*)::int FROM events WHERE status = 'pending') AS "pendingEvents",
          (SELECT COUNT(*)::int FROM wall_posts WHERE status = 'pending') AS "pendingPosts",
          (SELECT COUNT(*)::int FROM clients WHERE credits < 10) AS "lowCreditClients"
      `;
      return res.json(counts);
    }
    const [applications, members, events, guests, clients, wall] =
      await Promise.all([
        getRows(tableFor.applications),
        getRows(tableFor.members),
        getRows(tableFor.events),
        getRows(tableFor.guests),
        getRows(tableFor.clients),
        getRows(tableFor.wall),
      ]);
    const live = events.filter((event) => event.status === "published");
    res.json({
      pendingApplications: applications.filter(
        (item) => item.status === "pending",
      ).length,
      members: members.length,
      weeklyRsvps: live.reduce(
        (sum, event) => sum + Number(event.confirmed || 0),
        0,
      ),
      checkedIn: guests.filter((guest) => guest.checkedInAt).length,
      expected: guests.length,
      pendingEvents: events.filter((event) => event.status === "pending")
        .length,
      pendingPosts: wall.filter((post) => post.status === "pending").length,
      lowCreditClients: clients.filter((client) => client.credits < 10).length,
    });
  } catch (error) {
    next(error);
  }
});
for (const [resource, table] of Object.entries(tableFor))
  app.get(
    `/api/${resource === "guests" ? "door/guests" : resource}`,
    async (_req, res, next) => {
      try {
        const rows = await getRows(table);
        if (table !== "guests") return res.json(rows);
        const invitations = sql
          ? await sql`SELECT id, guest_name AS name, 'Invited guest' AS track, event_id AS "eventId", plus_ones AS "plusOnes", checked_in_at AS "checkedInAt", status, TRUE AS "isInvitation" FROM guest_invitations ORDER BY created_at DESC`
          : demo.guestInvitations.map(({ tokenHash: _tokenHash, guestName, ...guest }) => ({ ...guest, name: guestName, track: "Invited guest", isInvitation: true }));
        res.json([...rows, ...invitations]);
      } catch (error) {
        if (table === "venues" && error.message?.toLowerCase().includes("venues") && error.message?.toLowerCase().includes("does not exist")) return res.json([]);
        next(error);
      }
    },
  );

app.get("/api/guest-invitations", async (req, res, next) => {
  try {
    const eventId = text(req.query.eventId, 180);
    if (!eventId) return res.status(400).json({ error: "Choose an event." });
    if (!sql)
      return res.json(
        demo.guestInvitations
          .filter((guest) => guest.eventId === eventId)
          .map(({ tokenHash: _tokenHash, ...guest }) => guest),
      );
    const rows =
      await sql`SELECT id, event_id AS "eventId", guest_name AS "guestName", email, phone, table_no AS "tableNo", status, plus_ones AS "plusOnes", to_char(checked_in_at AT TIME ZONE 'Asia/Dubai', 'YYYY-MM-DD HH24:MI') AS "checkedInAt", created_at AS "createdAt" FROM guest_invitations WHERE event_id = ${eventId} ORDER BY created_at DESC`;
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/event-rsvp-requests", async (req, res, next) => {
  try {
    const eventId = text(req.query.eventId, 180);
    if (!eventId) return res.status(400).json({ error: "Choose an event." });
    if (!sql) return res.json(demo.eventRsvpRequests.filter((item) => item.eventId === eventId));
    const rows = await sql`
      SELECT r.id, r.event_id AS "eventId", e.title AS "eventTitle",
        r.member_id AS "memberId", m.name, r.member_email AS email, r.track,
        COALESCE(m.handle, '') AS handle, COALESCE(m.followers, 0)::int AS followers,
        COALESCE(m.mobile, '') AS phone, COALESCE(m.outlet, '') AS publication,
        r.guest_names AS "guestNames", r.deliverables_agreed AS "deliverablesAgreed",
        r.status, r.created_at AS "createdAt", r.reviewed_at AS "reviewedAt",
        r.reviewed_by AS "reviewedBy"
      FROM event_rsvp_requests r
      JOIN events e ON e.id = r.event_id
      JOIN members m ON m.id = r.member_id
      WHERE r.event_id = ${eventId}
      ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'waitlisted' THEN 1 WHEN 'accepted' THEN 2 ELSE 3 END,
        r.created_at DESC
    `;
    res.json(rows);
  } catch (error) { next(error); }
});

app.get("/api/event-ticket-inquiries", async (req, res, next) => {
  try {
    if (!(await currentAdmin(req))) return res.status(401).json({ error: "Sign in to view ticket inquiries." });
    const eventId = text(req.query.eventId, 180);
    if (!eventId) return res.status(400).json({ error: "Choose an event." });
    if (!sql) return res.json([]);
    const rows = await sql`
      SELECT id, event_id AS "eventId", full_name AS name, email, phone,
        instagram_handle AS "instagramHandle", instagram_followers AS "instagramFollowers", creator_address AS "creatorAddress",
        request_type AS "requestType", request_notes AS "requestNotes", status,
        created_at AS "createdAt"
      FROM event_ticket_inquiries
      WHERE event_id = ${eventId}
      ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'contacted' THEN 1 ELSE 2 END, created_at DESC
    `;
    res.json(rows);
  } catch (error) { next(error); }
});

app.patch("/api/event-ticket-inquiries/:id", async (req, res, next) => {
  try {
    if (!(await currentAdmin(req))) return res.status(401).json({ error: "Sign in to update ticket inquiries." });
    const status = String(req.body.status || "");
    if (!["pending", "contacted", "closed", "accepted", "waitlisted", "declined"].includes(status))
      return res.status(400).json({ error: "Choose pending, contacted, or closed." });
    if (!sql) return res.status(404).json({ error: "Ticket inquiry not found." });
    const entryCode = `CR-${randomBytes(5).toString("hex").toUpperCase()}`;
    const rows = await sql`
      WITH changed AS (
        UPDATE event_ticket_inquiries SET status = ${status}
        WHERE id = ${req.params.id}
        RETURNING id, event_id AS "eventId", full_name AS name, email, phone,
          instagram_handle AS "instagramHandle", instagram_followers AS "instagramFollowers", creator_address AS "creatorAddress",
          request_type AS "requestType", request_notes AS "requestNotes", status, created_at AS "createdAt"
      ), event_details AS (
        SELECT c.*, e.title AS "eventTitle", e.date::text AS date, e.time, e.venue, e.area
        FROM changed c JOIN events e ON e.id = c."eventId"
      ), issued_pass AS (
        INSERT INTO guests (id, name, track, event_id, plus_ones, code, status)
        SELECT 'creator-pass-' || d.id, d.name, 'Creators', d."eventId", 0, ${entryCode}, 'confirmed'
        FROM event_details d WHERE d."requestType" = 'creator_pass' AND d.status = 'accepted'
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, event_id = EXCLUDED.event_id,
          code = guests.code, status = 'confirmed'
        RETURNING code
      ), removed_pass AS (
        DELETE FROM guests g USING event_details d
        WHERE g.id = 'creator-pass-' || d.id AND d."requestType" = 'creator_pass' AND d.status <> 'accepted'
        RETURNING g.id
      )
      SELECT d.*, p.code AS "entryCode"
      FROM event_details d LEFT JOIN issued_pass p ON TRUE
    `;
    if (!rows[0]) return res.status(404).json({ error: "Ticket inquiry not found." });
    const request = rows[0];
    const delivery = request.requestType === "creator_pass"
      ? await sendCreatorPassDecisionEmail({
        name: request.name,
        email: request.email,
        event: { title: request.eventTitle, date: request.date, time: request.time, venue: request.venue, area: request.area },
        status,
        entryCode: request.entryCode || "",
      })
      : { status: "skipped", message: "Ticket inquiry status saved." };
    const phoneDigits = String(request.phone || "").replace(/\D/g, "");
    const whatsappUrl = status === "accepted" && request.requestType === "creator_pass" && request.entryCode && phoneDigits
      ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(`Your creator pass for ${request.eventTitle} is confirmed. Entry code: ${request.entryCode}. Please show this code at the door.`)}`
      : "";
    res.json({ request, delivery, whatsappUrl });
  } catch (error) { next(error); }
});

app.patch("/api/event-rsvp-requests/:id", async (req, res, next) => {
  try {
    const status = String(req.body.status || "");
    if (!["accepted", "waitlisted", "declined"].includes(status))
      return res.status(400).json({ error: "Choose accepted, waitlisted, or declined." });
    if (!sql) {
      const request = demo.eventRsvpRequests.find((item) => item.id === req.params.id);
      if (!request) return res.status(404).json({ error: "RSVP request not found." });
      request.status = status;
      request.reviewedAt = new Date().toISOString();
      request.reviewedBy = req.admin.email;
      return res.json({ request, delivery: { status: "skipped", message: "Email is unavailable in demo mode." } });
    }

    const entryCode = `RSVP-${randomBytes(5).toString("hex").toUpperCase()}`;
    const rows = await sql`
      WITH target AS (
        SELECT r.id, r.event_id, r.member_id, r.member_email, r.track, r.guest_names,
          r.status AS current_status, m.name, e.title, e.date::text AS date, e.time, e.end_time, e.gates_open_time,
          e.venue, e.area, e.capacity, e.track_capacities, e.influencer_deliverables,
          cardinality(r.guest_names) + 1 AS party_size,
          COALESCE((
            SELECT SUM(cardinality(other.guest_names) + 1)
            FROM event_rsvp_requests other
            WHERE other.event_id = r.event_id AND other.track = r.track
              AND other.status = 'accepted' AND other.id <> r.id
          ), 0) AS track_load
        FROM event_rsvp_requests r
        JOIN events e ON e.id = r.event_id
        JOIN members m ON m.id = r.member_id
        WHERE r.id = ${req.params.id}
      ), adjusted_event AS (
        UPDATE events e
        SET confirmed = GREATEST(e.confirmed + CASE
          WHEN ${status} = 'accepted' AND t.current_status <> 'accepted' THEN t.party_size
          WHEN ${status} <> 'accepted' AND t.current_status = 'accepted' THEN -t.party_size
          ELSE 0 END, 0),
          updated_at = NOW()
        FROM target t
        WHERE e.id = t.event_id
          AND (
            ${status} <> 'accepted' OR t.current_status = 'accepted' OR (
              e.confirmed + t.party_size <= e.capacity
              AND t.track_load + t.party_size <= COALESCE((e.track_capacities ->> t.track)::integer, e.capacity)
            )
          )
        RETURNING e.id
      ), changed AS (
        UPDATE event_rsvp_requests r
        SET status = ${status}, reviewed_at = NOW(), reviewed_by = ${req.admin.email}, updated_at = NOW()
        FROM target t, adjusted_event a
        WHERE r.id = t.id AND a.id = t.event_id
        RETURNING r.id, r.event_id AS "eventId", r.member_id AS "memberId",
          r.member_email AS email, r.track, r.guest_names AS "guestNames", r.status,
          t.name, t.title AS "eventTitle", t.date, t.time, t.end_time AS "endTime", t.gates_open_time AS "gatesOpenTime", t.venue, t.area,
          t.influencer_deliverables AS deliverables
      ), synced_guest AS (
        INSERT INTO guests (id, name, track, event_id, plus_ones, code, status)
        SELECT 'rsvp-' || c.id, c.name, c.track, c."eventId", cardinality(c."guestNames"), ${entryCode}, 'confirmed'
        FROM changed c WHERE c.status = 'accepted'
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, track = EXCLUDED.track,
          event_id = EXCLUDED.event_id, plus_ones = EXCLUDED.plus_ones, status = 'confirmed'
        RETURNING id
      ), removed_guest AS (
        DELETE FROM guests g USING changed c
        WHERE g.id = 'rsvp-' || c.id AND c.status <> 'accepted'
        RETURNING g.id
      )
      SELECT c.* FROM changed c
    `;
    if (!rows[0]) {
      const exists = await sql`SELECT id FROM event_rsvp_requests WHERE id = ${req.params.id} LIMIT 1`;
      if (!exists[0]) return res.status(404).json({ error: "RSVP request not found." });
      return res.status(409).json({ error: "There is not enough event or track capacity to accept this party. Add them to the waitlist instead." });
    }

    const request = rows[0];
    const delivery = await sendRsvpDecisionEmail({
      name: request.name,
      email: request.email,
      event: { title: request.eventTitle, date: request.date, time: [request.time, request.endTime ? `until ${request.endTime}` : "", request.gatesOpenTime ? `gates open ${request.gatesOpenTime}` : ""].filter(Boolean).join(" · "), venue: request.venue, area: request.area },
      track: request.track,
      guestNames: request.guestNames || [],
      deliverables: request.deliverables || "",
      status,
    });
    res.json({ request, delivery });
  } catch (error) { next(error); }
});

app.post("/api/guest-invitations", async (req, res, next) => {
  try {
    const eventId = text(req.body.eventId, 180);
    const guestName = text(req.body.guestName, 120);
    const email = text(req.body.email, 254);
    const phone = text(req.body.phone, 40);
    const tableNo = text(req.body.tableNo, 40);
    if (guestName.length < 2)
      return res.status(400).json({ error: "Enter the guest's name." });
    if (!email && !phone)
      return res.status(400).json({ error: "Enter an email address or WhatsApp number." });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "Enter a valid email address." });
    const event = sql
      ? (await sql`SELECT id, title, date::text AS date, time, venue, area FROM events WHERE id = ${eventId} LIMIT 1`)[0]
      : demo.events.find((item) => item.id === eventId);
    if (!event)
      return res.status(404).json({ error: "Choose an existing event." });
    const id = crypto.randomUUID();
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    if (sql)
      await sql`INSERT INTO guest_invitations (id, event_id, token_hash, guest_name, email, phone, table_no) VALUES (${id}, ${eventId}, ${tokenHash}, ${guestName}, ${email}, ${phone}, ${tableNo})`;
    else
      demo.guestInvitations.unshift({
        id,
        eventId,
        guestName,
        email,
        phone,
        tableNo,
        status: "pending",
        plusOnes: 0,
        checkedInAt: null,
        tokenHash,
      });
    const siteOrigin = String(
      process.env.PUBLIC_SITE_URL || "https://rsvpdxb.com",
    )
      .trim()
      .replace(/\/$/, "");
    const invitationUrl = `${siteOrigin}/rsvp/${token}`;
    const [emailDelivery, whatsappDelivery] = await Promise.all([
      sendInvitationEmail({ guestName, email, event, invitationUrl, tableNo }),
      sendInvitationWhatsApp({ guestName, phone, event, invitationUrl }),
    ]);
    res
      .status(201)
      .json({
        id,
        token,
        invitationUrl,
        delivery: { email: emailDelivery, whatsapp: whatsappDelivery },
      });
  } catch (error) {
    next(error);
  }
});

app.post("/api/door/guest-invitations/:id/check-in", async (req, res, next) => {
  try {
    let guest;
    let justCheckedIn = false;
    if (sql) {
      const updated =
        await sql`UPDATE guest_invitations SET checked_in_at = NOW() WHERE id = ${req.params.id} AND status = 'accepted' AND checked_in_at IS NULL RETURNING id, guest_name AS "guestName", plus_ones AS "plusOnes", checked_in_at AS "checkedInAt"`;
      guest = updated[0];
      justCheckedIn = Boolean(guest);
      if (!guest)
        guest = (
          await sql`SELECT guest_name AS "guestName", plus_ones AS "plusOnes", checked_in_at AS "checkedInAt", status FROM guest_invitations WHERE id = ${req.params.id} LIMIT 1`
        )[0];
    } else {
      guest = demo.guestInvitations.find((item) => item.id === req.params.id);
      if (guest?.status === "accepted" && !guest.checkedInAt) {
        guest.checkedInAt = new Date().toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        });
        justCheckedIn = true;
      }
    }
    if (!guest)
      return res.status(404).json({ error: "Guest invitation not found." });
    if (guest.status && guest.status !== "accepted")
      return res
        .status(409)
        .json({ error: "This guest has not accepted the invitation." });
    if (!justCheckedIn && guest.checkedInAt)
      return res
        .status(409)
        .json({ error: `${guest.guestName} is already checked in.` });
    res.json({
      ok: true,
      guestName: guest.guestName,
      plusOnes: Number(guest.plusOnes || 0),
      id: guest.id,
      checkedInAt: guest.checkedInAt,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/door/guest-pass", async (req, res, next) => {
  try {
    const code = String(req.body.code || "").trim();
    const eventId = text(req.body.eventId, 180);
    let token = code;
    try {
      const parsed = new URL(code);
      token =
        parsed.pathname.match(/^\/rsvp\/([A-Za-z0-9_-]{32,100})\/?$/)?.[1] ||
        "";
    } catch {
      token = code.match(/^\/?rsvp\/([A-Za-z0-9_-]{32,100})\/?$/)?.[1] || code;
    }
    if (!/^[A-Za-z0-9_-]{32,100}$/.test(token))
      return res.status(404).json({ error: "Guest pass not found." });
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const guest = sql
      ? (
          await sql`SELECT id, guest_name AS "guestName" FROM guest_invitations WHERE token_hash = ${tokenHash} AND (${eventId} = '' OR event_id = ${eventId}) LIMIT 1`
        )[0]
      : demo.guestInvitations.find((item) => item.tokenHash === tokenHash && (!eventId || item.eventId === eventId));
    if (!guest) return res.status(404).json({ error: "Guest pass not found." });
    const rows = sql
      ? await sql`UPDATE guest_invitations SET checked_in_at = NOW() WHERE id = ${guest.id} AND status = 'accepted' AND checked_in_at IS NULL RETURNING id, guest_name AS "guestName", plus_ones AS "plusOnes", checked_in_at AS "checkedInAt"`
      : (() => {
          if (guest.status !== "accepted") return [];
          if (guest.checkedInAt)
            return [{ already: true, guestName: guest.guestName }];
          guest.checkedInAt = new Date().toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          });
          return [{ id: guest.id, guestName: guest.guestName, plusOnes: guest.plusOnes, checkedInAt: guest.checkedInAt }];
        })();
    if (rows[0]?.already)
      return res
        .status(409)
        .json({ error: `${rows[0].guestName} is already checked in.` });
    if (!rows[0]) {
      const current = sql
        ? (
            await sql`SELECT status, checked_in_at AS "checkedInAt", guest_name AS "guestName" FROM guest_invitations WHERE id = ${guest.id}`
          )[0]
        : guest;
      if (current?.status !== "accepted")
        return res
          .status(409)
          .json({ error: "This guest has not accepted the invitation." });
      if (current?.checkedInAt)
        return res
          .status(409)
          .json({ error: `${current.guestName} is already checked in.` });
      return res
        .status(409)
        .json({
          error: "Guest check-in could not be completed. Please retry.",
        });
    }
    res.json({
      ok: true,
      id: rows[0].id || guest.id,
      guestName: rows[0].guestName,
      plusOnes: Number(rows[0].plusOnes || 0),
      checkedInAt: rows[0].checkedInAt || new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/applications/:id", async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!["approved", "rejected"].includes(status))
      return res.status(400).json({ error: "Choose approved or rejected." });
    if (!sql) {
      const item = demo.applications.find((row) => row.id === req.params.id);
      if (!item)
        return res.status(404).json({ error: "Application not found." });
      item.status = status;
      if (
        status === "approved" &&
        !demo.members.some((member) => member.email === item.email)
      )
        demo.members.unshift({
          id: `m-${item.id}`,
          name: item.name,
          email: item.email,
          track: item.track,
          sourceTrack: item.sourceTrack || item.track,
          rank: "Bronze",
          points: 10,
          events: 0,
          city: item.city,
          profileUrl: item.profileUrl || "",
          handle: item.handle || "",
          platform: item.platform || "",
          followers: Number(item.followers) || 0,
          mobile: item.mobile || "",
          outlet: item.outlet || "",
          role: item.role || "",
          allProfiles: item.allProfiles || "",
          status: "approved",
          joined: item.submitted,
          passwordHash: item.passwordHash,
        });
      const { passwordHash: _passwordHash, ...safeItem } = item;
      return res.json(safeItem);
    }
    const currentRows = await sql`SELECT status FROM applications WHERE id = ${req.params.id} LIMIT 1`;
    const current = currentRows[0];
    if (!current) return res.status(404).json({ error: "Application not found." });
    const rows =
      await sql`UPDATE applications SET status = ${status}, updated_at = NOW() WHERE id = ${req.params.id} RETURNING id, name, email, track, city, detail, followers, profile_url, handle, platform, mobile, outlet, application_role, all_profiles, source_track, password_hash, submitted, status`;
    const item = rows[0];
    if (!item) return res.status(404).json({ error: "Application not found." });
    const newMember = status === "approved" ? await sql`
      INSERT INTO members (name, email, track, source_track, rank, points, events, city, profile_url, handle, platform, followers, mobile, outlet, member_role, all_profiles, status, joined, password_hash)
      VALUES (${item.name}, ${item.email}, ${item.track}, ${item.source_track || item.track}, 'Bronze', 10, 0, ${item.city}, ${item.profile_url || ""}, ${item.handle || ""}, ${item.platform || ""}, ${Number.parseInt(item.followers, 10) || 0}, ${item.mobile || ""}, ${item.outlet || ""}, ${item.application_role || ""}, ${item.all_profiles || ""}, 'approved', ${item.submitted}, ${item.password_hash})
      ON CONFLICT (email) DO NOTHING RETURNING id
    ` : [];
    let approvalEmail = null;
    if (status === "approved" && current.status !== "approved" && newMember[0]) {
      if (item.password_hash) {
        approvalEmail = await sendMembershipApprovalEmail({ name: item.name, email: item.email, track: item.track });
      } else {
        const token = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        await sql`DELETE FROM member_password_resets WHERE member_id = ${newMember[0].id}`;
        await sql`INSERT INTO member_password_resets (token_hash, member_id, expires_at) VALUES (${tokenHash}, ${newMember[0].id}, NOW() + INTERVAL '30 minutes')`;
        const siteUrl = String(process.env.PUBLIC_SITE_URL || "https://www.rsvpdxb.com").replace(/\/$/, "");
        approvalEmail = await sendMemberActivationEmail({ name: item.name, email: item.email, activationUrl: `${siteUrl}/reset-password?token=${token}` });
        if (approvalEmail.status !== "submitted") await sql`DELETE FROM member_password_resets WHERE token_hash = ${tokenHash}`;
      }
    }
    const { password_hash: _passwordHash, ...safeItem } = item;
    res.json({ ...safeItem, ...(approvalEmail ? { approvalEmail } : {}) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/applications/:id", async (req, res, next) => {
  try {
    if (!sql) {
      const index = demo.applications.findIndex((item) => item.id === req.params.id);
      if (index < 0) return res.status(404).json({ error: "Application not found." });
      const [application] = demo.applications.splice(index, 1);
      const before = demo.members.length;
      demo.members = demo.members.filter((member) => member.email?.toLowerCase() !== application.email?.toLowerCase());
      return res.json({ ok: true, applicationDeleted: true, membersDeleted: before - demo.members.length });
    }
    const rows = await sql`
      WITH deleted_application AS (
        DELETE FROM applications WHERE id = ${req.params.id} RETURNING email
      ), deleted_members AS (
        DELETE FROM members AS member USING deleted_application AS application
        WHERE lower(member.email) = lower(application.email) RETURNING member.id
      )
      SELECT TRUE AS ok,
        (SELECT COUNT(*)::int FROM deleted_members) AS "membersDeleted"
      FROM deleted_application
    `;
    if (!rows[0]) return res.status(404).json({ error: "Application not found." });
    res.json({ ...rows[0], applicationDeleted: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/members/:id", async (req, res, next) => {
  try {
    if (!sql) {
      const index = demo.members.findIndex((member) => member.id === req.params.id);
      if (index < 0) return res.status(404).json({ error: "Member not found." });
      const [member] = demo.members.splice(index, 1);
      const before = demo.applications.length;
      demo.applications = demo.applications.filter((application) => application.email?.toLowerCase() !== member.email?.toLowerCase());
      return res.json({ ok: true, memberDeleted: true, applicationsDeleted: before - demo.applications.length });
    }
    const rows = await sql`
      WITH deleted_member AS (
        DELETE FROM members WHERE id = ${req.params.id} RETURNING email
      ), deleted_applications AS (
        DELETE FROM applications AS application USING deleted_member AS member
        WHERE lower(application.email) = lower(member.email) RETURNING application.id
      )
      SELECT TRUE AS ok,
        (SELECT COUNT(*)::int FROM deleted_applications) AS "applicationsDeleted"
      FROM deleted_member
    `;
    if (!rows[0]) return res.status(404).json({ error: "Member not found." });
    res.json({ ...rows[0], memberDeleted: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/events", async (req, res, next) => {
  try {
    const title = text(req.body.title, 180);
    const brand = text(req.body.brand, 180);
    const venue = text(req.body.venue, 240);
    const area = text(req.body.area, 120);
    const date = text(req.body.date, 10);
    const endDate = text(req.body.endDate, 10);
    const time = text(req.body.time, 40);
    const endTime = text(req.body.endTime, 40);
    const gatesOpenTime = text(req.body.gatesOpenTime, 40);
    const ticketUrl = text(req.body.ticketUrl, 1000);
    const reservationPhone = text(req.body.reservationPhone, 80);
    const creatorPassNote = text(req.body.creatorPassNote, 500);
    const ageRestriction = text(req.body.ageRestriction, 80);
    const hashtag = text(req.body.hashtag, 120);
    const applicationDeadline = text(req.body.applicationDeadline, 10);
    const actionLabel = text(req.body.actionLabel, 60);
    const category = text(req.body.category, 80) || "Dining";
    const capacity = Number(req.body.capacity ?? 80);
    const ticketPrice = Number(req.body.ticketPrice || 0);
    const ticketCurrency = text(req.body.ticketCurrency, 3).toUpperCase() || "AED";
    const status = String(req.body.status || "draft");
    const allowedTracks = [
      "Media",
      "Creators",
      "Tastemakers",
      "Private Circle",
    ];
    const tracks = Array.isArray(req.body.tracks)
      ? [
          ...new Set(
            req.body.tracks
              .map((item) => text(item, 40))
              .filter((item) => allowedTracks.includes(item)),
          ),
        ]
      : [];
    const rawTrackCapacities = req.body.trackCapacities && typeof req.body.trackCapacities === "object" ? req.body.trackCapacities : {};
    const trackCapacities = Object.fromEntries(tracks.map((track) => {
      const spots = Number(rawTrackCapacities[track] ?? capacity);
      return [track, Number.isInteger(spots) && spots > 0 ? Math.min(spots, capacity) : capacity];
    }));
    if (capacity > 0 && tracks.some((track) => !Number.isInteger(Number(rawTrackCapacities[track] ?? capacity)) || Number(rawTrackCapacities[track] ?? capacity) < 1))
      return res.status(400).json({ error: "Every invited track needs a positive RSVP capacity." });
    const influencerDeliverables = text(req.body.influencerDeliverables, 5000);
    const mapUrl = text(req.body.mapUrl, 1000);
    const dressCode = text(req.body.dressCode, 180);
    const about = text(req.body.about, 5000);
    const included = Array.isArray(req.body.included)
      ? req.body.included
          .map((item) => text(item, 300))
          .filter(Boolean)
          .slice(0, 30)
      : [];
    const whoIsInvited = text(req.body.whoIsInvited, 1500);
    const hostNote = text(req.body.hostNote, 1500);
    const videoUrl = String(req.body.videoUrl || "");
    const imageDataList = Array.isArray(req.body.imageDataList)
      ? req.body.imageDataList.map((value) => String(value || ""))
      : req.body.imageData ? [String(req.body.imageData)] : [];
    const imageData = imageDataList[0] || "";
    if (!title || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)))
      return res
        .status(400)
        .json({ error: "An event name is required; if supplied, the date must be valid." });
    if (applicationDeadline && !/^\d{4}-\d{2}-\d{2}$/.test(applicationDeadline))
      return res.status(400).json({ error: "Enter a valid application deadline." });
    if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate))
      return res.status(400).json({ error: "Enter a valid event end date." });
    if (endDate && date && endDate < date)
      return res.status(400).json({ error: "The event end date cannot be before its start date." });
    if (applicationDeadline && date && applicationDeadline > date)
      return res.status(400).json({ error: "The application deadline cannot be after the event date." });
    if (!Number.isFinite(ticketPrice) || ticketPrice < 0 || !/^[A-Z]{3}$/.test(ticketCurrency))
      return res.status(400).json({ error: "Enter a valid ticket price and three-letter currency." });
    if (mapUrl && !/^https:\/\//i.test(mapUrl)) return res.status(400).json({ error: "Use a secure HTTPS link for the event map." });
    if (!["draft", "published", "pending", "closed"].includes(status))
      return res.status(400).json({ error: "Invalid event status." });
    if (ticketUrl && !/^https:\/\//i.test(ticketUrl)) return res.status(400).json({ error: "Use a secure HTTPS ticket link." });
    if (
      imageDataList.length > 5 ||
      imageDataList.some((image) => !/^https:\/\//.test(image) || (mediaBaseUrl && !image.startsWith(`${mediaBaseUrl}/media/`)))
    )
      return res
        .status(400)
        .json({ error: "Choose up to 5 uploaded JPG, PNG or WebP images from the configured RSVP media bucket." });
    if (videoUrl && (!mediaBaseUrl || !videoUrl.startsWith(`${mediaBaseUrl}/media/`))) return res.status(400).json({ error: "The event video must be uploaded to configured media storage." });
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > 100000)
      return res.status(400).json({ error: tracks.length ? "Enter a guest capacity above zero." : "Capacity cannot be negative." });
    if (status === "published") {
      const missing = [
        !imageData && "cover image",
      ].filter(Boolean);
      if (missing.length) return res.status(400).json({ error: `Complete required listing fields before publishing: ${missing.join(", ")}.` });
    }
    const id = `event-${crypto.randomUUID()}`;
    const event = {
      id,
      title,
      brand,
      venue,
      area,
      date,
      endDate,
      time,
      endTime,
      gatesOpenTime,
      ticketUrl,
      reservationPhone,
      creatorPassNote,
      ageRestriction,
      hashtag,
      applicationDeadline,
      actionLabel,
      capacity,
      confirmed: 0,
      ticketPrice,
      ticketCurrency,
      category,
      tracks,
      trackCapacities,
      influencerDeliverables,
      mapUrl,
      dressCode,
      about,
      included,
      whoIsInvited,
      hostNote,
      videoUrl,
      imageData,
      imageDataList,
      status,
    };
    if (!sql) demo.events.unshift(event);
    else
      await sql`INSERT INTO events (id, title, brand, venue, date, end_date, time, end_time, gates_open_time, area, capacity, confirmed, ticket_price, ticket_currency, ticket_url, reservation_phone, creator_pass_note, age_restriction, hashtag, application_deadline, action_label, category, tracks, dress_code, about, included, who_is_invited, host_note, image_data, image_gallery, video_url, track_capacities, influencer_deliverables, map_url, status) VALUES (${id}, ${title}, ${brand}, ${venue}, ${date || null}, ${endDate || null}, ${time}, ${endTime}, ${gatesOpenTime}, ${area}, ${capacity}, 0, ${ticketPrice}, ${ticketCurrency}, ${ticketUrl}, ${reservationPhone}, ${creatorPassNote}, ${ageRestriction}, ${hashtag}, ${applicationDeadline || null}, ${actionLabel}, ${category}, ${tracks}, ${dressCode}, ${about}, ${included}, ${whoIsInvited}, ${hostNote}, ${imageData}, ${imageDataList}, ${videoUrl}, ${JSON.stringify(trackCapacities)}::jsonb, ${influencerDeliverables}, ${mapUrl}, ${status})`;
    if (status === "published") {
      const form = await ensureCreatorPassGoogleForm(event);
      Object.assign(event, { creatorPassFormUrl: form.url, creatorPassFormError: form.error });
    }
    res.status(201).json(event);
  } catch (error) {
    next(error);
  }
});
app.post("/api/events/:id/creator-pass-form", async (req, res, next) => {
  try {
    if (!sql) return res.status(503).json({ error: "Google Forms require the connected database." });
    const eventId = text(req.params.id, 180);
    const rows = await sql`SELECT id, title, brand, venue, area, date::text AS date, time, hashtag, creator_pass_note, creator_pass_form_url, image_data, image_gallery, status FROM events WHERE id = ${eventId} LIMIT 1`;
    const event = rows[0];
    if (!event) return res.status(404).json({ error: "Event not found." });
    if (event.status !== "published") return res.status(400).json({ error: "Publish the event before creating its creator pass form." });
    const form = await ensureCreatorPassGoogleForm(event);
    if (form.error) return res.status(502).json({ error: form.error });
    res.json({ creatorPassFormUrl: form.url, creatorPassFormError: "" });
  } catch (error) { next(error); }
});
app.patch("/api/events/:id", async (req, res, next) => {
  try {
    if (Object.keys(req.body).length === 1 && typeof req.body.topPick === "boolean") {
      const topPick = req.body.topPick;
      if (!sql) {
        const item = demo.events.find((row) => row.id === req.params.id);
        if (!item) return res.status(404).json({ error: "Event not found." });
        if (topPick && item.status !== "published") return res.status(400).json({ error: "Publish the event before adding it to RSVP Top Picks." });
        item.topPick = topPick;
        return res.json(item);
      }
      const rows = await sql`UPDATE events SET top_pick = ${topPick}, updated_at = NOW() WHERE id = ${req.params.id} AND (${!topPick} OR status = 'published') RETURNING id, top_pick AS "topPick"`;
      if (!rows[0]) {
        const exists = await sql`SELECT id FROM events WHERE id = ${req.params.id} LIMIT 1`;
        if (!exists[0]) return res.status(404).json({ error: "Event not found." });
        return res.status(400).json({ error: "Publish the event before adding it to RSVP Top Picks." });
      }
      return res.json(rows[0]);
    }
    if (Object.hasOwn(req.body, "title")) {
      const id = text(req.params.id, 180);
      const title = text(req.body.title, 180);
      const brand = text(req.body.brand, 180);
      const venue = text(req.body.venue, 240);
      const area = text(req.body.area, 120);
      const date = text(req.body.date, 10);
      const endDate = text(req.body.endDate, 10);
      const time = text(req.body.time, 40);
      const endTime = text(req.body.endTime, 40);
      const gatesOpenTime = text(req.body.gatesOpenTime, 40);
      const ticketUrl = text(req.body.ticketUrl, 1000);
      const reservationPhone = text(req.body.reservationPhone, 80);
      const creatorPassNote = text(req.body.creatorPassNote, 500);
      const ageRestriction = text(req.body.ageRestriction, 80);
      const hashtag = text(req.body.hashtag, 120);
      const applicationDeadline = text(req.body.applicationDeadline, 10);
      const actionLabel = text(req.body.actionLabel, 60);
      const category = text(req.body.category, 80) || "Other";
      const capacity = Number(req.body.capacity);
      const ticketPrice = Number(req.body.ticketPrice);
      const ticketCurrency = text(req.body.ticketCurrency, 3).toUpperCase() || "AED";
      const tracks = Array.isArray(req.body.tracks)
        ? [...new Set(req.body.tracks.map((item) => text(item, 40)).filter((item) => ["Media", "Creators", "Tastemakers", "Private Circle"].includes(item)))]
        : [];
      const rawTrackCapacities = req.body.trackCapacities && typeof req.body.trackCapacities === "object" ? req.body.trackCapacities : {};
      const trackCapacities = Object.fromEntries(tracks.map((track) => {
        const spots = Number(rawTrackCapacities[track] ?? capacity);
        return [track, Number.isInteger(spots) && spots > 0 ? Math.min(spots, capacity) : capacity];
      }));
      const influencerDeliverables = text(req.body.influencerDeliverables, 5000);
      const mapUrl = text(req.body.mapUrl, 1000);
      const dressCode = text(req.body.dressCode, 180);
      const about = text(req.body.about, 5000);
      const included = Array.isArray(req.body.included) ? req.body.included.map((item) => text(item, 300)).filter(Boolean).slice(0, 30) : [];
      const whoIsInvited = text(req.body.whoIsInvited, 1500);
      const hostNote = text(req.body.hostNote, 1500);
      const videoUrl = text(req.body.videoUrl, 1000);
      const imageDataList = Array.isArray(req.body.imageDataList) ? req.body.imageDataList.map((image) => String(image || "")) : [];
      const imageData = imageDataList[0] || "";
      const status = String(req.body.status || "draft");
      if (!id || !title || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) return res.status(400).json({ error: "An event name is required; if supplied, the date must be valid." });
      if (endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || (date && endDate < date))) return res.status(400).json({ error: "Enter a valid event end date on or after the event date." });
      if (applicationDeadline && (!/^\d{4}-\d{2}-\d{2}$/.test(applicationDeadline) || (date && applicationDeadline > date))) return res.status(400).json({ error: "Enter a valid application deadline on or before the event date." });
      if (!Number.isInteger(capacity) || capacity < 0 || capacity > 100000) return res.status(400).json({ error: "Enter a valid non-negative RSVP capacity." });
      if (capacity > 0 && tracks.some((track) => !Number.isInteger(Number(rawTrackCapacities[track] ?? capacity)) || Number(rawTrackCapacities[track] ?? capacity) < 1)) return res.status(400).json({ error: "Every invited track needs a positive RSVP capacity." });
      if (!Number.isFinite(ticketPrice) || ticketPrice < 0 || !/^[A-Z]{3}$/.test(ticketCurrency)) return res.status(400).json({ error: "Enter a valid ticket price and currency." });
      if (ticketUrl && !/^https:\/\//i.test(ticketUrl)) return res.status(400).json({ error: "Use a secure HTTPS ticket link." });
      if (mapUrl && !/^https:\/\//i.test(mapUrl)) return res.status(400).json({ error: "Use a secure HTTPS map link." });
      if (!["draft", "published", "pending", "closed"].includes(status)) return res.status(400).json({ error: "Invalid event status." });
      if (imageDataList.length > 5 || imageDataList.some((image) => !/^https:\/\//.test(image) || (mediaBaseUrl && !image.startsWith(`${mediaBaseUrl}/media/`)))) return res.status(400).json({ error: "Choose up to 5 HTTPS event images from the configured media storage." });
      if (videoUrl && (!mediaBaseUrl || !videoUrl.startsWith(`${mediaBaseUrl}/media/`))) return res.status(400).json({ error: "The event video must be uploaded to configured media storage." });
      if (!sql) {
        const event = demo.events.find((row) => row.id === id);
        if (!event) return res.status(404).json({ error: "Event not found." });
        Object.assign(event, { title, brand, venue, area, date, endDate, time, endTime, gatesOpenTime, ticketUrl, reservationPhone, creatorPassNote, ageRestriction, hashtag, applicationDeadline, actionLabel, capacity, ticketPrice, ticketCurrency, category, tracks, trackCapacities, influencerDeliverables, mapUrl, dressCode, about, included, whoIsInvited, hostNote, videoUrl, imageData, imageDataList, status });
        return res.json(event);
      }
      const rows = await sql`UPDATE events SET title = ${title}, brand = ${brand}, venue = ${venue}, area = ${area}, date = ${date || null}, end_date = ${endDate || null}, time = ${time}, end_time = ${endTime}, gates_open_time = ${gatesOpenTime}, ticket_url = ${ticketUrl}, reservation_phone = ${reservationPhone}, creator_pass_note = ${creatorPassNote}, age_restriction = ${ageRestriction}, hashtag = ${hashtag}, application_deadline = ${applicationDeadline || null}, action_label = ${actionLabel}, capacity = ${capacity}, ticket_price = ${ticketPrice}, ticket_currency = ${ticketCurrency}, category = ${category}, tracks = ${tracks}, track_capacities = ${JSON.stringify(trackCapacities)}::jsonb, influencer_deliverables = ${influencerDeliverables}, map_url = ${mapUrl}, dress_code = ${dressCode}, about = ${about}, included = ${included}, who_is_invited = ${whoIsInvited}, host_note = ${hostNote}, video_url = ${videoUrl}, image_data = ${imageData}, image_gallery = ${imageDataList}, status = ${status}, updated_at = NOW() WHERE id = ${id} RETURNING *`;
      if (!rows[0]) return res.status(404).json({ error: "Event not found." });
      if (status === "published" && !rows[0].creator_pass_form_url) {
        await ensureCreatorPassGoogleForm({ ...rows[0], id, title, brand, venue, area, date, hashtag, creatorPassNote, imageData, imageDataList, status });
      }
      return res.json(rows[0]);
    }
    const { status } = req.body;
    const hasPriceUpdate = Object.hasOwn(req.body, "ticketPrice") || Object.hasOwn(req.body, "ticketCurrency");
    if (hasPriceUpdate) {
      const ticketPrice = Number(req.body.ticketPrice);
      const ticketCurrency = String(req.body.ticketCurrency || "AED").toUpperCase();
      if (!Number.isFinite(ticketPrice) || ticketPrice < 0 || !/^[A-Z]{3}$/.test(ticketCurrency))
        return res.status(400).json({ error: "Enter a valid non-negative ticket price and 3-letter currency." });
      if (!sql) {
        const item = demo.events.find((row) => row.id === req.params.id);
        if (!item) return res.status(404).json({ error: "Event not found." });
        item.ticketPrice = ticketPrice;
        item.ticketCurrency = ticketCurrency;
        return res.json(item);
      }
      const rows = await sql`UPDATE events SET ticket_price = ${ticketPrice}, ticket_currency = ${ticketCurrency}, updated_at = NOW() WHERE id = ${req.params.id} RETURNING *`;
      if (!rows[0]) return res.status(404).json({ error: "Event not found." });
      return res.json(rows[0]);
    }
    if (!["published", "closed", "pending", "draft"].includes(status))
      return res.status(400).json({ error: "Invalid event status." });
    if (status === "published") {
      const rows = sql
        ? await sql`SELECT id, title, brand, venue, area, date::text AS date, time, hashtag, creator_pass_note, creator_pass_form_url, image_data, image_gallery, status FROM events WHERE id = ${req.params.id} LIMIT 1`
        : [demo.events.find((row) => row.id === req.params.id)];
      const event = rows[0];
      if (!event) return res.status(404).json({ error: "Event not found." });
      const missing = [
        !event.title && "event name",
        !event.image_data && !(event.image_gallery || event.imageDataList || event.imageGallery || []).length && "cover image",
      ].filter(Boolean);
      if (missing.length) return res.status(400).json({ error: `Complete required listing fields before publishing: ${missing.join(", ")}.` });
    }
    if (!sql) {
      const item = demo.events.find((row) => row.id === req.params.id);
      if (!item) return res.status(404).json({ error: "Event not found." });
      item.status = status;
      return res.json(item);
    }
    const rows =
      await sql`UPDATE events SET status = ${status}, updated_at = NOW() WHERE id = ${req.params.id} RETURNING *`;
    if (!rows[0]) return res.status(404).json({ error: "Event not found." });
    const result = rows[0];
    if (status === "published" && !result.creator_pass_form_url) {
      const form = await ensureCreatorPassGoogleForm({ ...result, id: result.id, imageData: result.image_data, imageGallery: result.image_gallery, creatorPassNote: result.creator_pass_note, creatorPassFormUrl: result.creator_pass_form_url });
      result.creator_pass_form_url = form.url;
      result.creator_pass_form_error = form.error;
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/events/:id", async (req, res, next) => {
  try {
    const eventId = text(req.params.id, 180);
    if (!eventId) return res.status(400).json({ error: "Choose an event to delete." });

    if (!sql) {
      const index = demo.events.findIndex((event) => event.id === eventId);
      if (index < 0) return res.status(404).json({ error: "Event not found." });
      const [deleted] = demo.events.splice(index, 1);
      demo.guests.forEach((guest) => { if (guest.eventId === eventId) guest.eventId = null; });
      demo.wall.forEach((post) => { if (post.eventId === eventId) post.eventId = null; });
      demo.guestInvitations = demo.guestInvitations.filter((item) => item.eventId !== eventId);
      demo.eventRsvpRequests = demo.eventRsvpRequests.filter((item) => item.eventId !== eventId);
      return res.json({ ok: true, id: deleted.id, title: deleted.title });
    }

    const paidTicket = (await sql`
      SELECT id FROM ticket_requests
      WHERE event_id = ${eventId} AND (status IN ('paid', 'approved') OR paid_at IS NOT NULL)
      LIMIT 1
    `)[0];
    if (paidTicket) {
      return res.status(409).json({ error: "This event has paid or issued tickets and cannot be deleted. Close RSVPs to remove it from listings while preserving ticket records." });
    }

    const rows = await sql`DELETE FROM events WHERE id = ${eventId} RETURNING id, title`;
    if (!rows[0]) return res.status(404).json({ error: "Event not found." });
    res.json({ ok: true, ...rows[0] });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/wall/:id", async (req, res, next) => {
  try {
    const { action } = req.body;
    if (!["approve", "boost", "remove"].includes(action))
      return res
        .status(400)
        .json({ error: "Choose approve, boost or remove." });
    if (!sql) {
      const index = demo.wall.findIndex((row) => row.id === req.params.id);
      if (index < 0) return res.status(404).json({ error: "Post not found." });
      if (action === "remove") demo.wall.splice(index, 1);
      else if (action === "approve")
        demo.wall[index] = {
          ...demo.wall[index],
          status: "live",
          posted: "Just now",
        };
      else demo.wall[index].boosted = !demo.wall[index].boosted;
      return res.json({ ok: true });
    }
    if (action === "remove")
      await sql`DELETE FROM wall_posts WHERE id = ${req.params.id}`;
    if (action === "approve")
      await sql`UPDATE wall_posts SET status = 'live', posted = 'Just now', updated_at = NOW() WHERE id = ${req.params.id}`;
    if (action === "boost")
      await sql`UPDATE wall_posts SET boosted = NOT boosted, updated_at = NOW() WHERE id = ${req.params.id}`;
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/clients/:id/credits", async (req, res, next) => {
  try {
    const amount = Number(req.body.amount);
    if (!Number.isInteger(amount) || amount <= 0 || amount > 10000)
      return res.status(400).json({ error: "Enter a valid credit amount." });
    if (!sql) {
      const item = demo.clients.find((row) => row.id === req.params.id);
      if (!item) return res.status(404).json({ error: "Client not found." });
      item.credits += amount;
      return res.json(item);
    }
    const rows =
      await sql`UPDATE clients SET credits = credits + ${amount}, updated_at = NOW() WHERE id = ${req.params.id} RETURNING *`;
    if (!rows[0]) return res.status(404).json({ error: "Client not found." });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.post("/api/door/scan", async (req, res, next) => {
  try {
    const code = String(req.body.code || "")
      .trim()
      .toUpperCase();
    if (!code) return res.status(400).json({ error: "Enter an RSVP code." });
    const eventId = text(req.body.eventId, 180);
    if (/^[A-F0-9]{48}$/.test(code) && sql) {
      const checkedIn = await sql`UPDATE ticket_requests SET checked_in_at = NOW() WHERE upper(ticket_token) = ${code} AND status IN ('approved', 'paid') AND checked_in_at IS NULL AND (${eventId} = '' OR event_id = ${eventId}) RETURNING id, guest_name AS "guestName", checked_in_at AS "checkedInAt"`;
      if (checkedIn[0]) {
        const name = checkedIn[0].guestName || "WhatsApp guest";
        return res.json({ tone: "green", title: `Welcome ${name.split(" ")[0]}`, detail: "Ticket validated · entry recorded" });
      }
      const existingTicket = (await sql`SELECT guest_name AS "guestName", checked_in_at AS "checkedInAt", status FROM ticket_requests WHERE upper(ticket_token) = ${code} AND (${eventId} = '' OR event_id = ${eventId}) LIMIT 1`)[0];
      if (existingTicket?.checkedInAt) return res.json({ tone: "amber", title: "Already scanned", detail: `${existingTicket.guestName || "Guest"} has already checked in.` });
      if (existingTicket && !["approved", "paid"].includes(existingTicket.status)) return res.json({ tone: "red", title: "Ticket not valid", detail: "This ticket has not been approved or paid." });
      if (existingTicket) return res.json({ tone: "red", title: "Wrong event", detail: "This ticket belongs to a different event." });
      const ticketForAnotherEvent = eventId ? (await sql`SELECT id FROM ticket_requests WHERE upper(ticket_token) = ${code} LIMIT 1`)[0] : null;
      if (ticketForAnotherEvent) return res.json({ tone: "red", title: "Wrong event", detail: "This ticket belongs to a different event." });
    }
    let guest;
    let justCheckedIn = false;
    if (!sql)
      guest = demo.guests.find((row) => row.code.toUpperCase() === code);
    else {
      const checkedInAt = now();
      const updated =
        await sql`UPDATE guests SET checked_in_at = ${checkedInAt} WHERE upper(code) = ${code} AND checked_in_at IS NULL RETURNING id, name, track, plus_ones AS "plusOnes", checked_in_at AS "checkedInAt"`;
      guest = updated[0];
      justCheckedIn = Boolean(guest);
      if (!guest) {
        const existing =
          await sql`SELECT id, name, track, plus_ones AS "plusOnes", checked_in_at AS "checkedInAt" FROM guests WHERE upper(code) = ${code} LIMIT 1`;
        guest = existing[0];
      }
    }
    if (!guest)
      return res.json({
        tone: "red",
        title: "Not on list",
        detail: `No guest found for ${code}`,
      });
    if (guest.checkedInAt && !justCheckedIn)
      return res.json({
        tone: "amber",
        title: "Already scanned",
        detail: `${guest.name} checked in at ${guest.checkedInAt}`,
      });
    if (!sql) guest.checkedInAt = now();
    res.json({
      tone: "green",
      title: `Welcome ${guest.name.split(" ")[0]}`,
      detail: `Entry for ${Number(guest.plusOnes) + 1} · ${guest.track} · +20 points`,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/door/walk-ins", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name)
      return res.status(400).json({ error: "Guest name is required." });
    const guest = {
      id: `walkin-${crypto.randomUUID()}`,
      name,
      track: "Walk-in",
      eventId: req.body.eventId || null,
      plusOnes: Math.max(0, Number(req.body.plusOnes || 1) - 1),
      code: `WALK-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      checkedInAt: null,
      status: "pending_review",
    };
    if (!sql) demo.guests.unshift(guest);
    else
      await sql`INSERT INTO guests (id, name, track, event_id, plus_ones, code, status) VALUES (${guest.id}, ${name}, 'Walk-in', ${guest.eventId}, ${guest.plusOnes}, ${guest.code}, 'pending_review')`;
    res.status(201).json(guest);
  } catch (error) {
    next(error);
  }
});

app.get("/api/*path", (_req, res) =>
  res.status(404).json({ error: "API route not found." }),
);
app.use((error, _req, res, _next) => {
  console.error(error);
  const missingSchema = error.message?.includes("does not exist");
  const hasCauseCode = (candidate, codes) => {
    for (let current = candidate; current; current = current.cause) {
      if (codes.has(current.code)) return true;
    }
    return false;
  };
  const databaseUnavailable =
    error.message?.includes("fetch failed") ||
    hasCauseCode(
      error,
      new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"]),
    );
  res
    .status(databaseUnavailable ? 503 : 500)
    .json({
      error: missingSchema
        ? "Neon tables are not set up yet. Run npm run db:setup after adding DATABASE_URL."
        : databaseUnavailable
          ? "The database is temporarily unreachable. Check your network or proxy connection, then try again."
          : "Something went wrong while loading this data.",
    });
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.env.NODE_ENV === "production" && !sql)
  throw new Error(
    "DATABASE_URL must be configured before starting the admin portal in production.",
  );
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.get("*path", (_req, res) =>
    res.sendFile(path.join(root, "dist", "index.html")),
  );
}

app.listen(port, "0.0.0.0", () =>
  console.log(
    `RSVP DXB API listening on port ${port}${sql ? " · Neon connected" : " · demo data mode"}`,
  ),
);
