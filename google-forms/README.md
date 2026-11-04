# Creator pass Google Forms

When an event is published, the admin server asks Apps Script to create a Google Form in the automation account, add the creator-pass questions and event details, optionally include the event cover image, and save the responder URL on that event. The cover image is optional: if Google Forms or the media URL rejects it, form creation continues without the image. The customer event page opens that event-specific form. Submissions are synced back into the event's existing RSVP review queue. Each event has its own form.

## One-time Google setup

1. Sign in as the Google account that should own future forms (for example, `connect@rsvpdxb.com`), open [Apps Script](https://script.google.com), create a standalone project, and paste `create-event-creator-pass-form.gs` into its editor. No existing template form or template ID is required.
2. In **Project Settings → Script Properties**, add:
   - `CREATOR_FORM_SECRET` = a long random secret (32+ characters). This must match `GOOGLE_FORM_CREATOR_SECRET` on the admin server.
   - `RSVP_CREATOR_PASS_WEBHOOK_URL` = the public admin API URL ending in `/api/integrations/google-forms/creator-pass`.
   - `RSVP_CREATOR_PASS_WEBHOOK_SECRET` = the existing `GOOGLE_FORM_WEBHOOK_SECRET` configured on the admin server.
3. In Apps Script, click **Services +**, add **Drive API v3**, and save. If **Drive** is already listed as a v2 service, remove it and add Drive API again with version **v3**. The script uses v3's `permissions.create` API to grant public responder access; v2's `permissions.insert` call is rejected for this published-form permission flow.
4. Select `authorizeCreatorPassAutomation` in the Apps Script editor, click **Run**, and approve the Google Forms, Drive, trigger, and external request permissions. This authorizes future form creation and response syncs under this Google account. The authorization check creates and trashes a temporary test form.
5. Choose **Deploy → New deployment → Web app**. Set **Execute as** to the deploying account and access to **Anyone** so the server can call it. The shared secret protects the endpoint. Copy the deployed `/exec` URL.
6. Set these variables on the admin server (in production, use the deployment's secret store): `GOOGLE_FORM_CREATOR_SCRIPT_URL` to the `/exec` URL and `GOOGLE_FORM_CREATOR_SECRET` to the same value as `CREATOR_FORM_SECRET`. Keep `GOOGLE_FORM_WEBHOOK_SECRET` configured too. Never commit real secrets.

## Deploy the app changes

1. Run `npm run db:migrate` in both `RSVP_admin_dashboard` and `RSVP-DXB-customer` against the shared database. The migrations add the per-event form URL (and admin creation error) columns.
2. Deploy/restart the admin server with the Apps Script variables set, then deploy the customer site. Publishing a new event creates its form automatically. Existing published events show **Create creator pass form** in the admin event list until their form is created.
3. In Apps Script, select and run `repairExistingCreatorPassFormAccess` to grant public responder access to every form ID mapped in that script project's properties. This repairs existing forms only. Then choose **Deploy → Manage deployments → Edit → New version → Deploy** so future event publishes run the updated `doPost`; each newly published event will get its own form and the script will grant its public responder permission automatically. Keep **Execute as** set to the automation account and access set to **Anyone**. Verify a repaired responder URL in a private/incognito browser window. `syncAllCreatorPassResponses` only retries submissions; it does not repair access.
4. Submit one test application. It should appear under that event's admin RSVP review panel, and the original response remains visible in Google Forms. If a submit trigger previously failed, run `syncAllCreatorPassResponses` from Apps Script to retry the responses already recorded in the mapped forms. Check **Executions** for any response sync errors; the log includes the HTTP status and admin error text.

If Google form creation fails, the event stays published, the dashboard displays the error, and its **Create creator pass form** button can retry safely without making a duplicate form.

### If a guest sees “You need access”

That page means the responder permission is missing or Google Workspace policy blocked public responders. Do not ask guests to request access. Confirm the Apps Script project has **Drive API v3** enabled (not v2), paste the latest `create-event-creator-pass-form.gs` into Apps Script and save, then run `repairExistingCreatorPassFormAccess`. It verifies the `anyone` published-reader permission and reports an error if Google does not grant it. The repair only covers form IDs stored in that script project's `EVENT_FOR_FORM_<formId>` properties; each published event needs its own mapped form. If v3 still rejects the permission, the Google account or Workspace administrator may need to allow external/anyone responder access. Google Forms cannot be made public by changing the RSVP dashboard link alone.

# New account applications and event enquiries

`PublicIntakeForms.gs` creates two Google Forms in the Google account where the script is run:

- **RSVP DXB — New Member Application**: collects a profile, track, and optional event interests. It does not ask for a password. A response creates a pending row in `applications`; selecting events also creates `event_interest` rows in `event_ticket_inquiries`.
- **RSVP DXB — Event Interest & Enquiry**: collects contact details and selected published events. Each event is added to its event's RSVP review panel under **Google Form event enquiries**.

The intake endpoint rejects duplicate submissions by Google response ID. Before creating an application, it checks both `members` and `applications`; an existing account or pending application is not created or changed. Existing members continue to sign in normally. Admin approval creates a new member and emails a one-time password setup link (valid for 30 minutes) to Google Form applicants.

## Connect and publish the forms

1. Deploy the admin code and run `npm run db:migrate` from `RSVP_admin_dashboard` against the shared database. This applies `005_google_form_event_interest.sql`.
2. Create a standalone Apps Script project at [script.google.com](https://script.google.com), add the contents of `PublicIntakeForms.gs`, and save it.
3. In **Project Settings → Script Properties**, add `GOOGLE_FORM_WEBHOOK_SECRET` with the same 32+ character value configured for the admin service in AWS SSM at `/rsvp/prod/admin-env`. Do not paste the secret in chat or commit it to source control.
4. In the Apps Script function selector, choose `createRsvpDxbPublicIntakeForms` and click **Run**. Approve the Google Forms, external request, and email permissions. The execution log prints both edit links and public response links.
5. Add the two public response URLs as repository **Actions variables** named `VITE_RSVP_NEW_MEMBER_FORM_URL` and `VITE_RSVP_EVENT_INTEREST_FORM_URL`, then deploy the customer site. The register page will direct new applicants to the account form; event pages will show **Ask about this event**.
6. When new events are published, run `refreshRsvpDxbPublicIntakeEventChoices` in Apps Script so they appear in both forms.

The deployed webhook secret must be present before the Apps Script trigger can sync. The Forms are created in the Google account that runs the script; this repository cannot create or publish them directly in a user's Google account.
