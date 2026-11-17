import { useState } from 'react';
import { ImagePlus, Eye, EyeOff, Pencil, Save, Trash2, X } from 'lucide-react';
import { api } from '../api.js';
import { EmptyState, PageIntro } from '../components/UI.jsx';

export default function WebsiteMedia({ rows, act }) {
  const [slot, setSlot] = useState('gallery');
  const [mediaType, setMediaType] = useState('image');
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [file, setFile] = useState(null);
  const [captionsFile, setCaptionsFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [editingMediaType, setEditingMediaType] = useState('image');
  const [editCaptionsFile, setEditCaptionsFile] = useState(null);
  const [editForm, setEditForm] = useState({ slot: 'gallery', title: '', caption: '', linkUrl: '' });
  const [rowError, setRowError] = useState('');

  const chooseFile = (next) => {
    if (preview) URL.revokeObjectURL(preview);
    setError('');
    if (!next) { setFile(null); setPreview(''); return; }
    const validImage = ['image/jpeg', 'image/png', 'image/webp'].includes(next.type) && next.size <= 12 * 1024 * 1024;
    const validVideo = slot === 'gallery' && ['video/mp4', 'video/webm'].includes(next.type) && next.size <= 50 * 1024 * 1024;
    if (!validImage && !validVideo) {
      setFile(null); setPreview(''); setError(slot === 'gallery' ? 'Choose a JPG, PNG or WebP image up to 12 MB, or an MP4 or WebM video up to 50 MB.' : 'Choose a JPG, PNG or WebP image up to 12 MB.'); return;
    }
    setMediaType(validVideo ? 'video' : 'image');
    if (!validVideo) setCaptionsFile(null);
    setFile(next); setPreview(URL.createObjectURL(next));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!file || !title.trim()) { setError('Choose a media file and enter a title.'); return; }
    setBusy(true); setError('');
    try {
      const { publicUrl, key } = await api.uploadMedia(file, { siteGallery: slot === 'gallery' && mediaType === 'video' });
      let captionsUrl = '';
      if (mediaType === 'video' && captionsFile) {
        if (!(await captionsFile.text()).trimStart().startsWith('WEBVTT')) throw new Error('The captions file must start with WEBVTT.');
        captionsUrl = (await api.uploadMedia(captionsFile, { siteGallery: true })).publicUrl;
      }
      await api.createSiteMedia({ slot, title: title.trim(), caption: caption.trim(), linkUrl: linkUrl.trim(), imageUrl: publicUrl, mediaType, captionsUrl, objectKey: key });
      await act(() => Promise.resolve(), `${slot === 'gallery' ? `Gallery ${mediaType}` : 'Top Pick'} published to the customer site`);
      setTitle(''); setCaption(''); setLinkUrl(''); setFile(null); setCaptionsFile(null);
      if (preview) URL.revokeObjectURL(preview);
      setPreview('');
    } catch (uploadError) { setError(uploadError.message || 'Could not save website media.'); }
    finally { setBusy(false); }
  };

  const startEdit = (item) => {
    setRowError('');
    setEditingId(item.id);
    setEditingMediaType(item.mediaType || 'image');
    setEditCaptionsFile(null);
    setEditForm({ slot: item.slot, title: item.title || '', caption: item.caption || '', linkUrl: item.linkUrl || '', captionsUrl: item.captionsUrl || '' });
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    setBusy(true); setRowError('');
    try {
      let captionsUrl = editForm.captionsUrl || '';
      if (editCaptionsFile) {
        if (!(await editCaptionsFile.text()).trimStart().startsWith('WEBVTT')) throw new Error('The captions file must start with WEBVTT.');
        captionsUrl = (await api.uploadMedia(editCaptionsFile, { siteGallery: true })).publicUrl;
      }
      await api.updateSiteMedia(editingId, { ...editForm, captionsUrl, title: editForm.title.trim(), caption: editForm.caption.trim(), linkUrl: editForm.linkUrl.trim() });
      await act(() => Promise.resolve(), 'Website media updated');
      setEditingId('');
      setEditCaptionsFile(null);
    } catch (saveError) { setRowError(saveError.message || 'Could not update website media.'); }
    finally { setBusy(false); }
  };

  const deleteItem = async (item) => {
    if (!window.confirm(`Delete “${item.title}” from website media? Its uploaded S3 file will remain stored.`)) return;
    setBusy(true); setRowError('');
    try {
      await api.deleteSiteMedia(item.id);
      await act(() => Promise.resolve(), 'Website media deleted');
      if (editingId === item.id) setEditingId('');
    } catch (deleteError) { setRowError(deleteError.message || 'Could not delete website media.'); }
    finally { setBusy(false); }
  };

  return <>
    <PageIntro title="Website Media" detail="Upload images or videos for the customer homepage Gallery, and images for RSVP Top Picks. New active items appear on the site after saving." />
    <section className="panel" style={{ padding: 22, marginBottom: 24 }}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 14, maxWidth: 760 }}>
        <div className="form-grid">
          <label className="field"><span>Homepage section</span><select value={slot} onChange={(e) => { setSlot(e.target.value); if (e.target.value === 'top_pick' && mediaType === 'video') { setMediaType('image'); chooseFile(null); } }}><option value="gallery">Gallery</option><option value="top_pick">RSVP Top Pick</option></select></label>
          <label className="field"><span>Media title *</span><input maxLength={180} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short title shown with the media" /></label>
        </div>
        <label className="field"><span>Caption</span><textarea rows="2" maxLength={500} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Optional supporting text" /></label>
        {slot === 'top_pick' ? <label className="field"><span>Link (optional)</span><input type="url" maxLength={500} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" /></label> : null}
    <label className="field"><span>{slot === 'gallery' ? 'Image (JPG, PNG or WebP, up to 12 MB) or video (MP4 or WebM, up to 50 MB)' : 'Image (JPG, PNG or WebP, up to 12 MB)'} *</span><input type="file" accept={slot === 'gallery' ? 'image/jpeg,image/png,image/webp,video/mp4,video/webm' : 'image/jpeg,image/png,image/webp'} onChange={(e) => { chooseFile(e.target.files?.[0] || null); e.target.value = ''; }} /></label>
        {mediaType === 'video' ? <label className="field"><span>Captions (optional, WebVTT .vtt up to 1 MB)</span><input type="file" accept=".vtt,text/vtt" onChange={(e) => { const selected = e.target.files?.[0] || null; setCaptionsFile(selected && selected.size <= 1024 * 1024 ? selected : null); if (selected && selected.size > 1024 * 1024) setError('Captions file must be 1 MB or smaller.'); e.target.value = ''; }} /></label> : null}
        {preview ? (mediaType === 'video' ? <video src={preview} controls muted playsInline style={{ maxWidth: 360, maxHeight: 220, borderRadius: 8 }} /> : <img src={preview} alt="Selected upload preview" style={{ maxWidth: 360, maxHeight: 220, objectFit: 'cover', borderRadius: 8 }} />) : null}
        {error ? <p className="event-image-error" role="alert">{error}</p> : null}
        <div><button className="button button-primary" disabled={busy || !file || !title.trim()}>{busy ? 'Uploading…' : <><ImagePlus size={16} /> Upload & publish</>}</button></div>
      </form>
    </section>
    <PageIntro title="Homepage media" detail="Hide an item to remove it from the customer site, edit its details, or delete its listing." />
    {rowError ? <p className="event-image-error" role="alert">{rowError}</p> : null}
    <div className="panel table-panel table-scroll"><table><thead><tr><th>PREVIEW</th><th>SECTION</th><th>TITLE</th><th>CAPTION</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td>{item.mediaType === 'video' ? <video src={item.imageUrl} muted playsInline style={{ width: 84, height: 54, objectFit: 'cover', borderRadius: 5 }} /> : <img src={item.imageUrl} alt="" style={{ width: 84, height: 54, objectFit: 'cover', borderRadius: 5 }} />}</td>{editingId === item.id ? <td colSpan="4"><form onSubmit={saveEdit} style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, 1fr) minmax(150px, 1fr) minmax(150px, 1fr) minmax(140px, 1fr) auto', gap: 8, alignItems: 'end' }}><label className="field"><span>Section</span><select value={editForm.slot} onChange={(e) => setEditForm({ ...editForm, slot: e.target.value })}><option value="gallery">Gallery</option>{item.mediaType !== 'video' ? <option value="top_pick">RSVP Top Pick</option> : null}</select></label><label className="field"><span>Title *</span><input maxLength={180} required value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} /></label><label className="field"><span>Caption</span><input maxLength={500} value={editForm.caption} onChange={(e) => setEditForm({ ...editForm, caption: e.target.value })} /></label>{editForm.slot === 'top_pick' ? <label className="field"><span>Link</span><input type="url" maxLength={500} value={editForm.linkUrl} onChange={(e) => setEditForm({ ...editForm, linkUrl: e.target.value })} /></label> : <div /> }{editingMediaType === 'video' ? <label className='field'><span>Captions (WebVTT .vtt, up to 1 MB)</span><input type='file' accept='.vtt,text/vtt' onChange={(e) => { const selected = e.target.files?.[0] || null; setEditCaptionsFile(selected && selected.size <= 1024 * 1024 ? selected : null); if (selected && selected.size > 1024 * 1024) setRowError('Captions file must be 1 MB or smaller.'); e.target.value = ''; }} /></label> : null}<div style={{ display: 'flex', gap: 5 }}><button className="small-action" disabled={busy || !editForm.title.trim()} aria-label="Save changes"><Save size={13} /> Save</button><button type="button" className="small-action" disabled={busy} onClick={() => setEditingId('')} aria-label="Cancel editing"><X size={13} /> Cancel</button></div></form></td> : <><td>{item.slot === 'gallery' ? 'Gallery' : 'RSVP Top Pick'}{item.mediaType === 'video' ? ' · Video' : ''}</td><td><strong>{item.title}</strong></td><td>{item.caption || '—'}</td><td><span className={`status-tag ${item.active ? 'status-published' : 'status-closed'}`}>{item.active ? 'Active' : 'Hidden'}</span></td><td><div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}><button className="small-action" disabled={busy} onClick={() => act(() => api.setSiteMediaActive(item.id, !item.active), item.active ? 'Media hidden from customer site' : 'Media shown on customer site')}>{item.active ? <><EyeOff size={13} /> Hide</> : <><Eye size={13} /> Show</>}</button><button className="small-action" disabled={busy} onClick={() => startEdit(item)}><Pencil size={13} /> Edit</button><button className="small-action" disabled={busy} onClick={() => deleteItem(item)}><Trash2 size={13} /> Delete</button></div></td></>}</tr>)}</tbody></table>{rows.length === 0 ? <EmptyState title="No homepage media yet" detail="Upload images or videos above to populate the Gallery." /> : null}</div>
  </>;
}
