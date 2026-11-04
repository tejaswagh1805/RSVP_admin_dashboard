# RSVP DXB Admin

Admin only dashboard for applications, members, events, guest invitations, wall moderation, brand credits, and event door check-in.

## Stack

- React and Vite frontend
- Node.js and Express API
- Neon Postgres persistence through `@neondatabase/serverless`
- Event media uploads to Amazon S3 using short-lived presigned URLs

## Event media

The admin event form uploads up to five JPG, PNG, or WebP photos (12 MB each, 40 MB total) and one MP4, WebM, or MOV video (100 MB) to the configured S3 media bucket. New uploads use `media/<uuid>-<filename>` keys and appear directly under `media/` in the S3 console; S3 does not create real folders. Neon stores CloudFront HTTPS URLs with event and profile content. The S3 bucket is private for reads; its policy grants the CloudFront distribution access to `media/*`, while the authenticated admin API signs uploads and its IAM identity can only write under that prefix.

For local development, configure `AWS_REGION`, `S3_MEDIA_BUCKET`, and `S3_MEDIA_BASE_URL` in the private `.env`. Prefer `AWS_PROFILE=rsvpdxb` (or your own profile) for local AWS access, and leave `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `S3_AWS_*` blank when using a profile; explicit static keys take precedence and stale keys cause S3 signature errors. Production runs on AWS using an execution role and encrypted settings in Systems Manager Parameter Store. Do not use an S3 URI (`s3://...`) as a browser URL; browsers need an HTTPS URL. The media bucket is `rsvp-dxb-media-294056655876-eu-north-1` in `eu-north-1`.

The server starts with local demonstration data when `DATABASE_URL` is not set. That mode is useful for exploring the dashboard; changes reset when the server restarts. The local demo account is `tejas@rsvpdxb.local` with password `demo1234`.

To use Neon, copy `.env.example` to `.env`, set `DATABASE_URL` and the single admin name, email, and private password, then run the database setup command once. Use a password of at least 12 characters:

```powershell
Copy-Item .env.example .env
npm install
npm run db:setup
npm run dev
```

The development client runs on Vite and proxies `/api` requests to the Express server on port 4000. Production serves the built frontend from Express:

```powershell
npm run build
$env:NODE_ENV = 'production'
npm start
```

Neon setup creates the tables, inserts the prototype demonstration records if those IDs are not already present, and provisions both configured administrators. Admin sessions use an HTTP-only cookie and can be ended from the profile menu; “Switch admin” signs out and returns to the sign-in screen so the second administrator can sign in. Keep `.env` private.

## Guest invitations

Use **Programme → Invitations** to create an event invitation, copy its private RSVP link, review responses, export the guest list, or check in an accepted guest. Set `PUBLIC_SITE_URL` to the customer site's origin so invitation links point to the correct host. The customer React app serves `/rsvp/:token`; admin APIs stay in this authenticated dashboard. `db:setup` creates the `guest_invitations` table in the shared Neon database. Door staff can paste the QR contents / RSVP link into the invitation check-in field or check in an accepted guest from the list.

Creating an invitation submits an email through Amazon SES and a WhatsApp template message through Meta Cloud API when those providers are configured. For SES, set `AWS_REGION`, `SES_FROM_EMAIL`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` in the private `.env` for local development. The AWS identity needs permission to call `ses:SendEmail`; on AWS hosting, use an attached IAM role instead of static keys. Verify the sender identity/domain in SES and move the account out of the SES sandbox to send to unverified guest addresses. For WhatsApp, set the access token, phone-number ID, Graph API version, approved template name, and template language. The approved template must have four body parameters in this order: guest name, event title, event details, and private RSVP link. A matching template body could read: `Hi {{1}}, you're invited to {{2}}. Event details: {{3}}. RSVP here: {{4}}`. Phone numbers may be entered in international format; UAE local numbers beginning with `0` are normalized to `971`.

Provider acceptance does not guarantee inbox delivery or WhatsApp delivery. The invitation result reports each channel separately. If a provider is not configured or rejects a request, the page offers an email draft or WhatsApp link for manual sending. Keep provider secrets in the private `.env` file and never commit them.

## Infobip ticket request chatbot

For every published upcoming event, the customer app opens WhatsApp with `RSVPDXB EVENT <event-id>` prefilled. The guest must press **Send**; that inbound message is what creates the request. Infobip must deliver inbound WhatsApp messages to the admin API webhook at `/api/whatsapp/infobip/webhook`. Set `VITE_RSVP_WHATSAPP_NUMBER` in the customer app's GitHub Actions variables to the WhatsApp number in international digits, and set `INFOBIP_BASE_URL`, `INFOBIP_API_KEY`, `INFOBIP_WHATSAPP_SENDER`, and `INFOBIP_WEBHOOK_SECRET` in `/rsvp/prod/admin-env` in AWS Systems Manager Parameter Store. Configure the Infobip inbound-message webhook to POST to `https://d1f5sjkm09kt76.cloudfront.net/api/whatsapp/infobip/webhook` with `Authorization: Bearer YOUR_INFOBIP_WEBHOOK_SECRET`.

The inbound webhook creates a pending request for the event and confirms receipt to the guest. Admins review these in Events → Review RSVPs (or the WhatsApp ticket requests table). Approving a free request sends its ticket PDF to WhatsApp. Approving a paid request sends a Stripe payment link; the Stripe webhook then issues a token-protected PDF and sends it to the guest after confirmed payment. Set each event's price and currency in the admin event record; use a zero price for free tickets. For paid tickets, set `STRIPE_SECRET_KEY` to a Stripe test key while testing, then configure a Stripe webhook at `https://d1f5sjkm09kt76.cloudfront.net/api/payments/stripe/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`; store `STRIPE_WEBHOOK_SECRET` in the same AWS parameter. Infobip document delivery requires a publicly reachable HTTPS file URL and WhatsApp may restrict business-initiated messages outside its customer service window. Ensure the `ticket_requests` schema is applied with `npm run db:setup`. Deploy the customer and admin repositories for the changes to appear on the live sites; test paid checkout in Stripe test mode before using live credentials.

## AWS deployment

Each repository now has a GitHub Actions workflow at `.github/workflows/deploy-aws.yml`. Once these changes are pushed to each repository's `main`, a push builds and pushes a Lambda container image to ECR, deploys it to its Lambda function, checks the function, then updates the matching CloudFront origin. GitHub uses OIDC roles restricted to the corresponding repository's `main` branch; no AWS access keys are stored in GitHub.

- Admin/API: `https://d1f5sjkm09kt76.cloudfront.net` (distribution `EYHJHOX0AY6EP`).
- Customer site: `https://d25iiefhi451d5.cloudfront.net` (distribution `E3FPVV4872MP1A`).
- Media CDN: `https://d11qncwozli5s0.cloudfront.net`.

Runtime environment settings are stored as encrypted parameters `/rsvp/prod/admin-env` and `/rsvp/prod/customer-env` in `eu-west-1`. After the first successful workflow run for each repo, future pushes to its `main` branch deploy automatically. Until then, the app distributions still use their existing origins.

## Existing members and new registrations

The member application page is available at `/register`. It saves submissions in `applications` as pending review. Passwords are stored as scrypt hashes, never as plaintext. Approving an application creates the member directory row and transfers the password hash. Customer login is not part of this admin dashboard yet.

Import the existing member export after setting up the database:

```powershell
npm run db:import-members -- "C:\Users\Tejas\Downloads\rsvp-applications-2026-10-02.csv"
```

The importer maps `influencer` to Creators, `media` to Media, `tastemaker` to Tastemakers, and `brand` to Private Circle while retaining the original track value. It upserts by email and preserves the CSV profile, platform, follower, contact, tier, points, status, city, and joined fields. To validate a file without writing to Neon, run `node server/import-members.js --dry-run "path-to-file.csv"`.
