import { useState } from 'react';
import { ArrowUpRight, Check, Eye, EyeOff, ImagePlus, MapPin, Pencil, Plus, Sparkles, Star, X } from 'lucide-react';
import { api } from '../api.js';
import { EmptyState, PageIntro } from '../components/UI.jsx';

export const VENUE_CATEGORIES = ['Our partners', 'Desi luxe', 'Dinner to party', 'Bars & night culture', 'Coffee', 'Daytime & alcohol-free'];
const blankVenue = () => ({ category: VENUE_CATEGORIES[0], name: '', tagline: '', description: '', location: '', highlights: '', offer: '', featuredDate: '', websiteUrl: '', moreInfoUrl: '', displayOrder: 0, contentReviewed: false, featured: false, galleryImages: [] });

export default function Venues({ rows = [], act }) {
  const [form, setForm] = useState(blankVenue());
  const [editing, setEditing] = useState(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [galleryFiles, setGalleryFiles] = useState([]);
  const [galleryPreviews, setGalleryPreviews] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const clearForm = () => {
    if (preview) URL.revokeObjectURL(preview);
    galleryPreviews.forEach((url) => URL.revokeObjectURL(url));
    setForm(blankVenue()); setEditing(null); setFile(null); setPreview(''); setError('');
    setGalleryFiles([]); setGalleryPreviews([]);
  };
  const chooseFile = (next) => {
    if (preview) URL.revokeObjectURL(preview);
    setError('');
    if (!next) { setFile(null); setPreview(''); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type) || next.size > 50 * 1024 * 1024) {
      setFile(null); setPreview(''); setError('Choose a JPG, PNG or WebP image up to 50 MB.'); return;
    }
    setFile(next); setPreview(URL.createObjectURL(next));
  };
  const startEdit = (venue) => {
    if (preview) URL.revokeObjectURL(preview);
    galleryPreviews.forEach((url) => URL.revokeObjectURL(url));
    setEditing(venue);
    setForm({ category: venue.category, name: venue.name || '', tagline: venue.tagline || '', description: venue.description || '', location: venue.location || '', highlights: (venue.highlights || []).join('\n'), offer: venue.offer || '', featuredDate: venue.featuredDate || '', websiteUrl: venue.websiteUrl || '', moreInfoUrl: venue.moreInfoUrl || '', displayOrder: venue.displayOrder || 0, contentReviewed: Boolean(venue.contentReviewed), featured: Boolean(venue.featured), galleryImages: venue.galleryImages || [] });
    setFile(null); setPreview(''); setGalleryFiles([]); setGalleryPreviews([]); setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const addGalleryFiles = (files) => {
    const selected = [...files];
    if (form.galleryImages.length + galleryFiles.length + selected.length > 12) { setError('A venue can have up to 12 gallery photos.'); return; }
    const invalid = selected.find((item) => !['image/jpeg', 'image/png', 'image/webp'].includes(item.type) || item.size > 50 * 1024 * 1024);
    if (invalid) { setError('Choose JPG, PNG or WebP gallery photos up to 50 MB each.'); return; }
    setError('');
    setGalleryFiles((current) => [...current, ...selected]);
    setGalleryPreviews((current) => [...current, ...selected.map((item) => URL.createObjectURL(item))]);
  };
  const removeGalleryImage = (index) => set('galleryImages', form.galleryImages.filter((_, itemIndex) => itemIndex !== index));
  const removeGalleryFile = (index) => {
    URL.revokeObjectURL(galleryPreviews[index]);
    setGalleryFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setGalleryPreviews((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim() || !form.description.trim() || !form.location.trim() || (!editing && !file)) { setError('Name, location, full description and a venue image are required.'); return; }
    setBusy(true); setError('');
    try {
      let imageUrl = editing?.imageUrl || '';
      let objectKey = editing?.objectKey || '';
      if (file) {
        const upload = await api.uploadMedia(file, { venueImage: true });
        imageUrl = upload.publicUrl; objectKey = upload.key;
      }
      const uploadedGallery = await Promise.all(galleryFiles.map((galleryFile) => api.uploadMedia(galleryFile, { venueImage: true })));
      const galleryImages = [...form.galleryImages, ...uploadedGallery.map((upload) => upload.publicUrl)];
      const payload = { ...form, galleryImages, name: form.name.trim(), tagline: form.tagline.trim(), description: form.description.trim(), location: form.location.trim(), highlights: form.highlights.split(/\r?\n/).map((item) => item.trim()).filter(Boolean), offer: form.offer.trim(), imageUrl, objectKey };
      if (editing) {
        await api.updateVenue(editing.id, payload);
        await act(() => Promise.resolve(), 'Venue details saved');
      } else {
        await api.createVenue(payload);
        await act(() => Promise.resolve(), form.contentReviewed ? 'Venue saved and published' : 'Venue saved as a draft; confirm content review before publishing');
      }
      clearForm();
    } catch (saveError) { setError(saveError.message || 'Could not save the venue.'); }
    finally { setBusy(false); }
  };

  return <>
    <PageIntro title="Venue guide" detail="Curate the places behind RSVP DXB. Add the story, useful details and approved imagery, then choose what guests see." />
    <section className="panel venue-admin-form">
      <div className="venue-admin-form-heading"><div><span className="eyebrow"><Sparkles size={12} /> {editing ? 'UPDATE A PLACE' : 'BUILD THE GUIDE'}</span><h2>{editing ? `Edit ${editing.name}` : 'Add a venue'}</h2><p>Give every place a polished profile guests can explore.</p></div>{editing ? <button type="button" className="small-action" onClick={clearForm}><X size={14} /> Cancel</button> : null}</div>
      <form onSubmit={submit} className="venue-form-grid">
        <div className="venue-form-section venue-form-wide"><span>01</span><div><strong>The essentials</strong><small>Set the category, name and location guests will recognize.</small></div></div>
        <label className="field"><span>Guide category *</span><select value={form.category} onChange={(event) => set('category', event.target.value)}>{VENUE_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label className="field"><span>Venue name *</span><input required maxLength={180} value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="e.g. Hikari, DIFC" /></label>
        <label className="field"><span>Short descriptor</span><input maxLength={240} value={form.tagline} onChange={(event) => set('tagline', event.target.value)} placeholder="Pan-Asian Restaurant, Lounge & Bar" /></label>
        <label className="field"><span>Location *</span><input required maxLength={500} value={form.location} onChange={(event) => set('location', event.target.value)} placeholder="Level 16, Emirates Financial Towers, DIFC" /></label>
        <div className="venue-form-section venue-form-wide"><span>02</span><div><strong>The experience</strong><small>Tell the full story and call out what makes this place special.</small></div></div>
        <label className="field venue-form-wide"><span>Full description *</span><textarea required rows="5" value={form.description} onChange={(event) => set('description', event.target.value)} placeholder="The full venue story shown on its details page" /></label>
        <label className="field"><span>Highlights (one per line)</span><textarea rows="4" value={form.highlights} onChange={(event) => set('highlights', event.target.value)} placeholder={'Skyline cocktails\nSunday brunch\nPrivate events'} /></label>
        <label className="field"><span>Current offer / good to know</span><textarea rows="4" value={form.offer} onChange={(event) => set('offer', event.target.value)} placeholder="Add the confirmed offer and useful details" /></label>
        <div className="venue-form-section venue-form-wide"><span>03</span><div><strong>Discovery & links</strong><small>Optional date, display position and links for more information.</small></div></div>
        <label className="field"><span>Featured date (optional)</span><input type="date" value={form.featuredDate} onChange={(event) => set('featuredDate', event.target.value)} /></label>
        <label className="field"><span>Display order</span><input type="number" min="0" max="9999" value={form.displayOrder} onChange={(event) => set('displayOrder', Number(event.target.value))} /></label>
        <label className="field"><span>Website URL</span><input type="url" maxLength={500} value={form.websiteUrl} onChange={(event) => set('websiteUrl', event.target.value)} placeholder="https://venue.com" /></label>
        <label className="field"><span>More info URL</span><input type="url" maxLength={500} value={form.moreInfoUrl} onChange={(event) => set('moreInfoUrl', event.target.value)} placeholder="https://guide-or-review.com" /></label>
        <div className="venue-form-section venue-form-wide"><span>04</span><div><strong>Image & publishing review</strong><small>Use approved venue photography and confirm the details before publishing.</small></div></div>
        <label className="field venue-form-wide"><span>Venue image (JPG, PNG or WebP, up to 50 MB) {editing ? '— optional, choose a new image to replace it' : '*'}</span><input className="venue-image-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { chooseFile(event.target.files?.[0] || null); event.target.value = ''; }} /></label>
        {(preview || (editing && !file)) ? <img className="venue-form-preview" src={preview || editing.imageUrl} alt="Venue image preview" /> : null}
        <div className="field venue-form-wide"><span>Venue photo gallery ({form.galleryImages.length + galleryFiles.length}/12)</span><small>These photos appear below the venue story on its customer page. The main venue image is included automatically. Up to 50 MB per photo.</small><input className="venue-image-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { addGalleryFiles(event.target.files || []); event.target.value = ''; }} /><div className="venue-admin-gallery-preview">{form.galleryImages.map((url, index) => <div className="venue-admin-gallery-thumb" key={`${url}-${index}`}><img src={url} alt={`Venue gallery ${index + 1}`} /><button type="button" aria-label="Remove gallery image" onClick={() => removeGalleryImage(index)}><X size={14} /></button></div>)}{galleryPreviews.map((url, index) => <div className="venue-admin-gallery-thumb" key={url}><img src={url} alt={`New gallery photo ${index + 1}`} /><button type="button" aria-label="Remove selected image" onClick={() => removeGalleryFile(index)}><X size={14} /></button></div>)}</div></div>
        <label className="venue-review-check venue-form-wide"><input type="checkbox" checked={form.contentReviewed} onChange={(event) => set('contentReviewed', event.target.checked)} /><span><strong>Publishing review confirmed</strong><small>Venue details and current offers checked; approved image and venue sign-off received. Without this, the venue saves as a hidden draft.</small></span><Check size={17} /></label>
        <div className="venue-form-wide venue-form-actions"><button className="button button-primary" disabled={busy || !form.name.trim() || (!editing && !file)}>{busy ? 'Saving…' : editing ? 'Save venue changes' : <><Plus size={16} /> Save venue</>}</button>{form.contentReviewed ? <span className="venue-review-state"><Sparkles size={14} /> Ready to publish</span> : <span className="venue-review-state">Saved as draft until review is confirmed</span>}</div>
        {error ? <p className="event-image-error venue-form-wide" role="alert">{error}</p> : null}
      </form>
    </section>

    <div className="venue-list-heading"><div><span className="eyebrow">YOUR COLLECTION</span><h2>Venues <span>{rows.length}</span></h2></div><p>Choose which reviewed venues appear on the homepage.</p></div>
    {!rows.length ? <div className="panel"><EmptyState title="No venues added yet" detail="Use the form above to start building your venue guide." /></div> : <div className="venue-admin-grid">{rows.map((venue) => <article className={`venue-admin-card${venue.active ? '' : ' is-hidden'}`} key={venue.id}>
      <div className="venue-admin-card-image"><img src={venue.imageUrl} alt={venue.name} /><span>{venue.category}</span><span className={`venue-admin-status ${venue.active ? 'is-live' : ''}`}>{venue.active ? 'Published' : 'Draft'}</span></div>
      <div className="venue-admin-card-content"><div className="venue-admin-card-title"><div><h3>{venue.name}</h3><p><MapPin size={13} />{venue.location}</p></div><span className="venue-admin-order">{String(venue.displayOrder || 0).padStart(2, '0')}</span></div>
        {venue.tagline ? <p className="venue-admin-tagline">{venue.tagline}</p> : null}
        <div className="venue-admin-flags"><span className={venue.contentReviewed ? 'review-ok' : 'review-needed'}>{venue.contentReviewed ? 'Content reviewed' : 'Review pending'}</span>{venue.featured ? <span className="featured-flag"><Star size={12} fill="currentColor" /> Homepage pick</span> : null}</div>
        <div className="venue-admin-actions"><button className="small-action" onClick={() => startEdit(venue)}><Pencil size={13} /> Edit</button><button className="small-action" disabled={!venue.contentReviewed || !venue.active} onClick={() => act(() => api.setVenueFeatured(venue.id, !venue.featured), venue.featured ? 'Removed from homepage Top Picks' : 'Added to homepage Top Picks')}><Star size={13} />{venue.featured ? 'Unfeature' : 'Feature'}</button><button className="small-action" disabled={!venue.contentReviewed && !venue.active} onClick={() => act(() => api.setVenueActive(venue.id, !venue.active), venue.active ? 'Venue hidden from customer pages' : 'Venue published')} >{venue.active ? <><EyeOff size={13} /> Hide</> : <><Eye size={13} /> Publish</>}</button>{venue.websiteUrl || venue.moreInfoUrl ? <a className="small-action" href={venue.websiteUrl || venue.moreInfoUrl} target="_blank" rel="noreferrer">Preview link <ArrowUpRight size={13} /></a> : null}</div>
      </div>
    </article>)}</div>}
  </>;
}
