const API = '/api';

export async function request(path, options = {}) {
  const send = async () => {
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        credentials: 'same-origin',
        ...options,
      });
    } catch (cause) {
      const error = new Error('Could not connect to the RSVP admin server. Check your connection and retry; your form is still open.');
      error.cause = cause;
      throw error;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'The request could not be completed.');
      error.status = response.status;
      throw error;
    }
    return data;
  };
  try { return await send(); }
  catch (error) {
    if (path === '/auth/me' && error.status === 503) {
      await new Promise((resolve) => window.setTimeout(resolve, 1400));
      return send();
    }
    throw error;
  }
}

async function prepareImageForUpload(file) {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    if (file.size <= 300 * 1024 && Math.max(bitmap.width, bitmap.height) <= 1600) {
      bitmap.close();
      return file;
    }
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    let optimized = null;
    for (const quality of [0.82, 0.72, 0.62, 0.52]) {
      optimized = await new Promise((resolve, reject) => canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Image optimization failed.'));
      }, 'image/webp', quality));
      if (optimized.size <= 300 * 1024) break;
    }
    if (!optimized || (optimized.size >= file.size && Math.max(bitmap.width, bitmap.height) <= 1600)) return file;
    const stem = file.name.replace(/\.[^.]+$/, '') || 'image';
    return new File([optimized], `${stem}.webp`, { type: 'image/webp', lastModified: file.lastModified });
  } catch {
    return file;
  }
}

async function uploadMedia(file, options = {}) {
  const prepared = await prepareImageForUpload(file);
  const target = await api.mediaUploadUrl(prepared, options);
  const response = await fetch(target.uploadUrl, { method: 'PUT', headers: { 'Content-Type': prepared.type }, body: prepared });
  if (!response.ok) {
    const details = (await response.text().catch(() => '')).trim().slice(0, 300);
    throw new Error(`Media upload to storage failed (HTTP ${response.status})${details ? `: ${details}` : '.'}`);
  }
  return { ...target, file: prepared };
}

export const api = {
  me: () => request('/auth/me'),
  newsletter: () => request('/newsletter'),
  sendNewsletterCampaign: (campaign) => request('/newsletter/campaigns', { method: 'POST', body: JSON.stringify(campaign) }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  register: (member) => request('/register', { method: 'POST', body: JSON.stringify(member) }),
  dashboard: () => request('/dashboard'),
  list: (resource) => request(`/${resource}`),
  ticketRequests: () => request('/ticket-requests'),
  deleteMember: (id) => request(`/members/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  deleteApplication: (id) => request(`/applications/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  decideApplication: (id, status) => request(`/applications/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  createEvent: (event) => request('/events', { method: 'POST', body: JSON.stringify(event) }),
  updateEventDetails: (id, event) => request(`/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(event) }),
  mediaUploadUrl: (file, options = {}) => request('/media/upload-url', { method: 'POST', body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size, eventId: options.eventId || '', purpose: options.venueImage ? 'venue-image' : options.siteGallery ? 'site-gallery' : 'event' }) }),
  uploadMedia,
  createSiteMedia: (item) => request('/site-media', { method: 'POST', body: JSON.stringify(item) }),
  updateSiteMedia: (id, item) => request(`/site-media/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(item) }),
  deleteSiteMedia: (id) => request(`/site-media/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  setSiteMediaActive: (id, active) => request(`/site-media/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  createVenue: (venue) => request('/venues', { method: 'POST', body: JSON.stringify(venue) }),
  updateVenue: (id, venue) => request(`/venues/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(venue) }),
  setVenueActive: (id, active) => request(`/venues/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  setVenueFeatured: (id, featured) => request(`/venues/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ featured }) }),
  createPeopleProfile: (profile) => request('/people-profiles', { method: 'POST', body: JSON.stringify(profile) }),
  updatePeopleProfile: (id, profile) => request(`/people-profiles/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(profile) }),
  setPeopleProfileActive: (id, active) => request(`/people-profiles/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  updateEvent: (id, update) => request(`/events/${id}`, { method: 'PATCH', body: JSON.stringify(typeof update === 'string' ? { status: update } : update) }),
  setEventTopPick: (id, topPick) => request(`/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ topPick }) }),
  setEventLatest: (id, latestEvent) => request(`/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ latestEvent }) }),
  createCreatorPassForm: (id) => request(`/events/${encodeURIComponent(id)}/creator-pass-form`, { method: 'POST' }),
  deleteEvent: (id) => request(`/events/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  approveTicketRequest: (id) => request(`/ticket-requests/${encodeURIComponent(id)}/approve`, { method: 'POST' }),
  moderatePost: (id, action) => request(`/wall/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) }),
  addCredits: (id, amount) => request(`/clients/${id}/credits`, { method: 'POST', body: JSON.stringify({ amount }) }),
  scan: (code, eventId) => request('/door/scan', { method: 'POST', body: JSON.stringify({ code, eventId }) }),
  walkIn: (guest) => request('/door/walk-ins', { method: 'POST', body: JSON.stringify(guest) }),
  guestInvitations: (eventId) => request(`/guest-invitations?eventId=${encodeURIComponent(eventId)}`),
  eventRsvpRequests: (eventId) => request(`/event-rsvp-requests?eventId=${encodeURIComponent(eventId)}`),
  eventTicketInquiries: (eventId) => request(`/event-ticket-inquiries?eventId=${encodeURIComponent(eventId)}`),
  updateEventTicketInquiry: (id, status) => request(`/event-ticket-inquiries/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  decideEventRsvp: (id, status) => request(`/event-rsvp-requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  createGuestInvitation: (guest) => request('/guest-invitations', { method: 'POST', body: JSON.stringify(guest) }),
  checkInGuestInvitation: (id) => request(`/door/guest-invitations/${encodeURIComponent(id)}/check-in`, { method: 'POST' }),
  scanGuestPass: (code, eventId) => request('/door/guest-pass', { method: 'POST', body: JSON.stringify({ code, eventId }) }),
};
