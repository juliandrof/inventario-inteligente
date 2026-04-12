import React, { useState, useRef, useEffect } from 'react';
import { uploadVideo, fetchContexts } from '../api';
import { useI18n } from '../i18n';

function VideoUpload({ navigate }) {
  const { t } = useI18n();
  const [contexts, setContexts] = useState([]);
  const [contextId, setContextId] = useState(0);
  const [contextName, setContextName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { fetchContexts().then(setContexts).catch(() => {}); }, []);

  const handleSelectContext = (id) => {
    setContextId(id);
    const ctx = contexts.find(c => c.context_id === id);
    setContextName(ctx ? ctx.name : '');
  };

  const handleFile = async (file) => {
    if (!file) return;
    const allowed = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowed.includes(ext)) { setError(`Invalid format: ${allowed.join(', ')}`); return; }
    setError(''); setUploading(true); setProgress(10);
    try {
      const interval = setInterval(() => setProgress(p => Math.min(p + 5, 90)), 500);
      const res = await uploadVideo(file, contextId);
      clearInterval(interval); setProgress(100); setResult(res);
    } catch (e) { setError(e.message || t('common.error')); } finally { setUploading(false); }
  };

  // Step 3: Success
  if (result) {
    return (
      <div>
        <div className="page-header"><h1>{t('upload.title')}</h1></div>
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16, color: 'var(--dbxsc-success)' }}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="3"/><path d="M14 24l7 7 13-13" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <h3 style={{ marginBottom: 8 }}>{t('upload.success')}</h3>
          <p style={{ color: '#999', marginBottom: 4 }}>{result.filename}</p>
          <p style={{ color: '#999', fontSize: 13, marginBottom: 24 }}>{t('upload.analysis_started')}</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={() => navigate('review', { videoId: result.video_id })}>{t('upload.view_analysis')}</button>
            <button className="btn btn-secondary" onClick={() => { setResult(null); setProgress(0); setContextId(0); setContextName(''); }}>{t('upload.send_another')}</button>
          </div>
        </div>
      </div>
    );
  }

  // Step 1: Select context
  if (!contextId) {
    return (
      <div>
        <div className="page-header"><h1>{t('upload.title')}</h1><p>{t('upload.subtitle')}</p></div>

        <div className="card">
          <div className="card-title" style={{ marginBottom: 4 }}>{t('upload.context')}</div>
          <p style={{ fontSize: 13, color: '#999', marginBottom: 16 }}>{t('upload.context_required')}</p>

          {contexts.length === 0 ? (
            <p style={{ color: '#999' }}>{t('ctx.no_contexts')}</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {contexts.map(ctx => {
                let cats = ctx.categories;
                if (typeof cats === 'string') try { cats = JSON.parse(cats); } catch { cats = []; }
                return (
                  <div key={ctx.context_id}
                    onClick={() => handleSelectContext(ctx.context_id)}
                    style={{
                      padding: 16, borderRadius: 12, border: '2px solid #e0e0e0',
                      cursor: 'pointer', transition: 'all 0.2s',
                      background: 'white',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--dbxsc-primary)'; e.currentTarget.style.transform = 'scale(1.02)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#e0e0e0'; e.currentTarget.style.transform = 'scale(1)'; }}>
                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{ctx.name}</div>
                    {ctx.description && <p style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>{ctx.description}</p>}
                    <div className="category-tags">
                      {cats.map((c, i) => <span key={i} className="category-tag" style={{ fontSize: 11, textTransform: 'capitalize' }}>{c}</span>)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Step 2: Upload video
  return (
    <div>
      <div className="page-header"><h1>{t('upload.title')}</h1><p>{t('upload.subtitle')}</p></div>

      {/* Selected context indicator */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <span style={{ fontSize: 12, color: '#999', marginRight: 8 }}>{t('upload.context')}:</span>
          <span className="badge badge-analyzing" style={{ fontSize: 13 }}>{contextName}</span>
        </div>
        <button className="btn btn-sm btn-secondary" onClick={() => { setContextId(0); setContextName(''); }}>{t('ctx.cancel')}</button>
      </div>

      <div className={`upload-zone ${dragOver ? 'dragover' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => !uploading && inputRef.current?.click()}>
        <input ref={inputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
        {uploading ? (
          <div>
            <div className="upload-icon"><div className="spinner" style={{ width: 48, height: 48, margin: '0 auto' }}></div></div>
            <p style={{ fontWeight: 500, marginBottom: 12 }}>{t('upload.sending')}</p>
            <div className="progress-bar" style={{ maxWidth: 400, margin: '0 auto' }}><div className="progress-bar-fill" style={{ width: `${progress}%` }}></div></div>
            <p className="upload-hint">{progress}%</p>
          </div>
        ) : (
          <div>
            <div className="upload-icon"><svg width="48" height="48" viewBox="0 0 48 48" fill="none"><path d="M24 6v28M24 6l-10 10M24 6l10 10M6 34v6a2 2 0 002 2h32a2 2 0 002-2v-6" stroke="#999" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
            <p style={{ fontWeight: 500 }}>{t('upload.drag')}</p>
            <p className="upload-hint">{t('upload.formats')}</p>
          </div>
        )}
      </div>
      {error && <div className="toast toast-error" style={{ position: 'relative', marginTop: 16 }}>{error}</div>}
    </div>
  );
}
export default VideoUpload;
