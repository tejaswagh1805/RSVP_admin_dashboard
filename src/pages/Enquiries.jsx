import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { EmptyState, PageIntro } from '../components/UI.jsx';

export default function Enquiries({ act }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = () => api.enquiries().then(setRows).catch((cause) => setError(cause.message || 'Could not load enquiries.')).finally(() => setLoading(false));
  useEffect(() => { refresh(); }, []);
  const update = async (item, status) => {
    const result = await act(() => api.updateEnquiry(item.id, status), `Enquiry marked ${status}`);
    if (result?.ok) refresh();
  };
  const remove = async (item) => {
    if (!window.confirm('Delete this enquiry?')) return;
    const result = await act(() => api.deleteEnquiry(item.id), 'Enquiry deleted');
    if (result?.ok) refresh();
  };
  return <>
    <PageIntro title="Website enquiries" detail="Hosting, press, media-kit and member content requests received from the website." />
    {error ? <p className="signin-error" role="alert">{error}</p> : null}
    {loading ? <div className="loading-state"><span className="spinner" /> Loading enquiries…</div> : <div className="panel table-panel table-scroll"><table><thead><tr><th>TYPE</th><th>CONTACT</th><th>DETAILS</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td>{item.kind.replace('_', ' ')}</td><td><strong>{item.name}</strong><span className="table-subline">{item.contact}</span><span className="table-subline">{new Date(item.createdAt).toLocaleString()}</span></td><td>{item.details?.eventTitle ? <>{item.details.eventTitle} · {item.details.type}<br /><a href={item.details.link} target="_blank" rel="noreferrer">Open submission</a></> : item.details?.enquiry || item.details?.asset || item.details?.occasion || item.details?.package || 'Website enquiry'}</td><td>{item.status}</td><td><div className="table-actions">{item.status === 'new' ? <button className="small-action publish-action" onClick={() => update(item, 'contacted')}>Mark contacted</button> : null}{item.status !== 'closed' ? <button className="small-action" onClick={() => update(item, 'closed')}>Close</button> : null}<button className="small-action delete-action" onClick={() => remove(item)}><Trash2 size={13} />Delete</button></div></td></tr>)}</tbody></table>{rows.length === 0 ? <EmptyState title="No enquiries yet" detail="Website requests will appear here." /> : null}</div>}
  </>;
}
