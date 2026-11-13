import { useCallback, useEffect, useState } from 'react';
import { Mail, Send, Users, AlertCircle, CheckCircle2, ImagePlus, X } from 'lucide-react';
import { api } from '../api.js';
import { PageIntro, EmptyState } from '../components/UI.jsx';

const initialForm = { subject: '', body: '' };

function normalizeAudience(payload) {
  const active = Number(payload?.active);
  const inactive = Number(payload?.inactive);
  const validCounts = Number.isFinite(active) && active >= 0 && Number.isFinite(inactive) && inactive >= 0;
  const validCampaigns = Array.isArray(payload?.campaigns);
  return {
    audience: {
      active: validCounts ? active : 0,
      inactive: validCounts ? inactive : 0,
      campaigns: validCampaigns ? payload.campaigns : [],
    },
    siteUrl: payload?.siteUrl,
    valid: validCounts && validCampaigns,
  };
}

export default function Newsletter() {
  const [audience, setAudience] = useState({ active: 0, inactive: 0, campaigns: [] });
  const [form, setForm] = useState(initialForm);
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [segment, setSegment] = useState('all');
  const [siteUrl, setSiteUrl] = useState('https://www.rsvpdxb.com');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const result = normalizeAudience(await api.newsletter());
      setAudience(result.audience);
      if (typeof result.siteUrl === 'string' && result.siteUrl) setSiteUrl(result.siteUrl.replace(/\/$/, ''));
      if (!result.valid) setError('Newsletter data is incomplete. Check that the admin API and database migrations are up to date.');
    }
    catch (loadError) { setError(loadError.message || 'Could not load newsletter details.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem('rsvpdxb-event-invite') || 'null');
      if (!draft) return;
      if (draft.eventId) setEventId(String(draft.eventId));
      if (draft.subject || draft.body) setForm({ subject: String(draft.subject || ''), body: String(draft.body || '') });
      if (['all', 'media', 'influencer', 'hni'].includes(draft.segment)) setSegment(draft.segment);
      localStorage.removeItem('rsvpdxb-event-invite');
    } catch { /* Ignore an incomplete local draft. */ }
  }, []);

  useEffect(() => {
    let active = true;
    api.list('events').then((rows) => {
      if (active) setEvents(Array.isArray(rows) ? rows.filter((event) => event.status === 'published') : []);
    }).catch(() => { if (active) setEvents([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => () => { if (imagePreview) URL.revokeObjectURL(imagePreview); }, [imagePreview]);

  const selectedEvent = events.find((event) => event.id === eventId);
  const eventUrl = selectedEvent ? `${siteUrl}/events/${encodeURIComponent(selectedEvent.id)}` : '';

  function chooseImage(file) {
    setError('');
    if (!file) { setImageFile(null); setImagePreview(''); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
      setError('Choose a JPG, PNG or WebP image up to 12 MB.');
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function sendCampaign(event) {
    event.preventDefault();
    if (!audience.active) return;
      const groupName = { all: 'all opted-in subscribers', media: 'opted-in Media members', influencer: 'opted-in Influencer members', hni: 'opted-in HNI members' }[segment];
      const accepted = window.confirm(`Send “${form.subject.trim()}” to ${groupName} now? This will send real emails.`);
    if (!accepted) return;
    setBusy(true); setError(''); setNotice('Sending campaign… Keep this page open until the send completes.');
    try {
      let imageUrl = '';
      if (imageFile) {
        const upload = await api.uploadMedia(imageFile);
        imageUrl = upload.publicUrl;
      }
      const { campaign = {} } = await api.sendNewsletterCampaign({ ...form, imageUrl, eventId, segment, confirmSend: true });
      setNotice(`Campaign finished: ${campaign.sentCount} sent, ${campaign.failedCount} failed.`);
      setForm(initialForm);
      setEventId('');
      setSegment('all');
      setImageFile(null); setImagePreview('');
      await refresh();
    } catch (sendError) {
      setError(sendError.message || 'The campaign could not be sent.');
      setNotice('');
      await refresh();
    } finally { setBusy(false); }
  }

  async function sendTestEmail() {
    if (form.subject.trim().length < 4 || form.body.trim().length < 20) {
      setError('Add a subject and at least 20 characters of email copy before sending a test.');
      return;
    }
    setTesting(true); setError(''); setNotice('Sending a test email to your admin address…');
    try {
      let imageUrl = '';
      if (imageFile) imageUrl = (await api.uploadMedia(imageFile)).publicUrl;
      const result = await api.sendNewsletterCampaign({ ...form, imageUrl, eventId, segment, testOnly: true });
      setNotice(`Test email sent to ${result.recipient}.`);
    } catch (testError) {
      setError(testError.message || 'The test email could not be sent.');
      setNotice('');
    } finally { setTesting(false); }
  }

  return <>
    <PageIntro title="Newsletter" detail="Write and send an email campaign to subscribers who explicitly opted in. Each campaign includes an unsubscribe link." />
    <div className="stats-grid">
      <article className="stat-card"><div className="stat-top"><span>OPTED-IN SUBSCRIBERS</span><span className="stat-icon"><Users size={15} /></span></div><div className="stat-value">{loading ? '—' : Number(audience.active || 0).toLocaleString()}</div><div className="stat-note">Eligible for campaign email</div></article>
      <article className="stat-card"><div className="stat-top"><span>INACTIVE / NO CONSENT</span><span className="stat-icon"><Mail size={15} /></span></div><div className="stat-value">{loading ? '—' : Number(audience.inactive || 0).toLocaleString()}</div><div className="stat-note">Excluded from campaigns</div></article>
    </div>
    {!loading && audience.active === 0 ? <div className="newsletter-consent-help" role="status"><AlertCircle size={16} /><p><strong>No opted-in subscribers yet.</strong> {audience.inactive === 1 ? 'The existing address was collected without recorded marketing consent, so it is excluded.' : 'Existing addresses collected without recorded marketing consent are excluded.'} Ask subscribers to sign up again through the website newsletter form and tick the consent checkbox.</p></div> : null}

    <section className="panel newsletter-compose">
      <div className="newsletter-heading"><div><span className="eyebrow"><Send size={12} /> NEW CAMPAIGN</span><h2>Compose an update</h2><p>Sending starts when you confirm. The site sends to opted-in addresses individually through Amazon SES.</p></div></div>
      <form onSubmit={sendCampaign}>
        <label className="field"><span>Subject *</span><input required minLength="4" maxLength="140" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="What’s new at RSVP DXB?" /></label>
        <label className="field"><span>Send to</span><select value={segment} onChange={(event) => setSegment(event.target.value)}><option value="all">All opted-in subscribers</option><option value="media">Media members</option><option value="influencer">Influencers</option><option value="hni">HNI members</option></select><small>Members without active newsletter consent or who unsubscribed are excluded.</small></label>
        <label className="field newsletter-event-field"><span>Link this campaign to an event (optional)</span><select value={eventId} onChange={(event) => setEventId(event.target.value)}><option value="">No event link</option>{events.map((item) => <option key={item.id} value={item.id}>{item.title}{item.date ? ` · ${item.date}` : ''}</option>)}</select><small>Choosing an event makes the campaign poster clickable and adds a prominent event and RSVP button to the email.</small></label>
        {selectedEvent ? <div className="newsletter-event-preview"><CheckCircle2 size={15} /><span>Email links will open <strong>{selectedEvent.title}</strong>.</span><a href={eventUrl} target="_blank" rel="noreferrer">Preview event ↗</a></div> : null}
        <label className="field"><span>Email message *</span><textarea required minLength="20" maxLength="10000" rows="9" value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder={'Write your update here.\n\nSeparate paragraphs with a blank line.'} /></label>
        <div className="field newsletter-image-field"><span>Campaign image (optional)</span><label className="newsletter-image-picker"><ImagePlus size={16} /><span>{imageFile ? imageFile.name : 'Add a JPG, PNG or WebP image'}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { chooseImage(event.target.files?.[0] || null); event.target.value = ''; }} /></label><small>Up to 12 MB. The image appears below the subject in the email. Use a wide, high-resolution image and include key details in the message text too.</small>{imagePreview ? <div className="newsletter-image-preview"><img src={imagePreview} alt="Newsletter campaign preview" /><button type="button" aria-label="Remove campaign image" onClick={() => chooseImage(null)}><X size={15} /></button></div> : null}</div>
        <p className="newsletter-send-note"><AlertCircle size={14} /> Only subscribers with recorded consent are included. Every campaign includes an unsubscribe link.</p>
        {error ? <p className="newsletter-error" role="alert">{error}</p> : null}
        {notice ? <p className="newsletter-notice" role="status"><CheckCircle2 size={15} />{notice}</p> : null}
        <div className="flex flex-wrap gap-2"><button className="button button-secondary" type="button" onClick={sendTestEmail} disabled={testing || busy || loading}>{testing ? 'Sending test…' : 'Send test to me'} <Mail size={15} /></button><button className="button button-primary newsletter-send-button" type="submit" disabled={busy || loading || !Number(audience.active)}>{busy ? 'Sending…' : segment === 'all' ? `Send campaign to ${Number(audience.active).toLocaleString()} opted-in subscribers` : `Send campaign to opted-in ${{ media: 'Media', influencer: 'Influencer', hni: 'HNI' }[segment]} members`} <Send size={15} /></button></div>
      </form>
    </section>

    <section className="newsletter-history">
      <div className="newsletter-section-heading"><h2>Recent campaigns</h2><span>Last 20</span></div>
      <div className="panel table-panel table-scroll"><table><thead><tr><th>SUBJECT</th><th>STATUS</th><th>RECIPIENTS</th><th>SENT</th><th>FAILED</th><th>DATE</th></tr></thead><tbody>
        {(Array.isArray(audience.campaigns) ? audience.campaigns : []).map((campaign) => <tr key={campaign.id}><td><strong>{campaign.subject}</strong>{campaign.eventTitle ? <small className="newsletter-history-event">Event: {campaign.eventTitle}</small> : null}</td><td><span className={`status-tag status-${campaign.status === 'sent' ? 'approved' : campaign.status === 'failed' || campaign.status === 'partial' ? 'rejected' : 'pending'}`}>{campaign.status}</span></td><td>{campaign.recipientCount}</td><td>{campaign.sentCount}</td><td>{campaign.failedCount}</td><td>{new Date(campaign.createdAt).toLocaleString()}</td></tr>)}
      </tbody></table>{!loading && (!Array.isArray(audience.campaigns) || audience.campaigns.length === 0) ? <EmptyState title="No campaigns sent yet" detail="Your sent newsletter campaigns will appear here." /> : null}</div>
    </section>
  </>;
}
