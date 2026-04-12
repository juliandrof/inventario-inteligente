import React, { useState, useEffect, useRef } from 'react';
import { uploadVideo, startBatch, startStream, stopStream, fetchBatches, fetchContexts, fetchCatalogs, fetchSchemas, fetchVolumes } from '../api';
import { useI18n } from '../i18n';

function ProcessVideos({ navigate }) {
  const { t } = useI18n();

  // Wizard state
  const [step, setStep] = useState('context'); // context | method | upload | batch | stream | success | progress | streaming
  const [contexts, setContexts] = useState([]);
  const [contextId, setContextId] = useState(0);
  const [contextName, setContextName] = useState('');

  // Stream state
  const [streamUrl, setStreamUrl] = useState('');
  const [streamWindow, setStreamWindow] = useState(60);
  const [streamData, setStreamData] = useState(null);
  const streamEsRef = useRef(null);

  // Upload state
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  // Batch state
  const [volumePath, setVolumePath] = useState('');
  const [batch, setBatch] = useState(null);
  const [loading, setLoading] = useState(false);
  const [previewVideoId, setPreviewVideoId] = useState(null);
  const eventSourceRef = useRef(null);

  // Catalog browser
  const [showBrowser, setShowBrowser] = useState(false);
  const [catalogs, setCatalogs] = useState([]);
  const [schemas, setSchemas] = useState([]);
  const [volumes, setVolumes] = useState([]);
  const [selCatalog, setSelCatalog] = useState('');
  const [selSchema, setSelSchema] = useState('');

  useEffect(() => { fetchContexts().then(setContexts).catch(() => {}); }, []);
  useEffect(() => { return () => { if (eventSourceRef.current) eventSourceRef.current.close(); if (streamEsRef.current) streamEsRef.current.close(); }; }, []);

  const selectContext = (id) => {
    setContextId(id);
    const ctx = contexts.find(c => c.context_id === id);
    setContextName(ctx ? ctx.name : '');
    setStep('method');
  };

  const resetWizard = () => {
    setStep('context'); setContextId(0); setContextName(''); setResult(null); setBatch(null);
    setVolumePath(''); setStreamUrl(''); setStreamData(null); setError(''); setProgress(0); setPreviewVideoId(null);
  };

  // Stream handler
  const handleStartStream = async () => {
    if (!streamUrl.trim()) return;
    setError(''); setLoading(true);
    try {
      const res = await startStream(streamUrl.trim(), contextId, streamWindow);
      setStreamData(res); setStep('streaming');
      const es = new EventSource(`/api/stream/${res.stream_id}/progress`);
      streamEsRef.current = es;
      es.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setStreamData(data);
        if (['COMPLETED', 'FAILED', 'STOPPED'].includes(data.status)) es.close();
      };
      es.onerror = () => es.close();
    } catch (e) { setError(e.message || t('common.error')); } finally { setLoading(false); }
  };

  const handleStopStream = async () => {
    if (streamData) { await stopStream(streamData.stream_id); }
  };

  // Upload handlers
  const handleFile = async (file) => {
    if (!file) return;
    const allowed = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowed.includes(ext)) { setError(`Invalid format: ${allowed.join(', ')}`); return; }
    setError(''); setUploading(true); setProgress(10);
    try {
      const interval = setInterval(() => setProgress(p => Math.min(p + 5, 90)), 500);
      const res = await uploadVideo(file, contextId);
      clearInterval(interval); setProgress(100); setResult(res); setStep('success');
    } catch (e) { setError(e.message || t('common.error')); } finally { setUploading(false); }
  };

  // Batch handlers
  const handleStartBatch = async () => {
    if (!volumePath.trim()) return;
    setError(''); setLoading(true);
    try {
      const res = await startBatch(volumePath.trim(), contextId);
      setBatch(res); setStep('progress');
      const es = new EventSource(`/api/batch/${res.batch_id}/progress`);
      eventSourceRef.current = es;
      es.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setBatch(data);
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(data.status)) es.close();
      };
      es.onerror = () => es.close();
    } catch (e) { setError(e.message || t('common.error')); } finally { setLoading(false); }
  };

  // ==================== STEP 1: SELECT CONTEXT ====================
  if (step === 'context') {
    return (
      <div>
        <div className="page-header"><h1>{t('process.title')}</h1><p>{t('process.subtitle')}</p></div>
        <div className="card">
          <div className="card-title">{t('process.step1')}</div>
          <p style={{ fontSize: 13, color: '#999', marginBottom: 16 }}>{t('upload.context_required')}</p>
          {contexts.length === 0 ? <p style={{ color: '#999' }}>{t('ctx.no_contexts')}</p> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {contexts.map(ctx => {
                let cats = ctx.categories;
                if (typeof cats === 'string') try { cats = JSON.parse(cats); } catch { cats = []; }
                return (
                  <div key={ctx.context_id} onClick={() => selectContext(ctx.context_id)}
                    style={{ padding: 16, borderRadius: 12, border: '2px solid #e0e0e0', cursor: 'pointer', transition: 'all 0.2s', background: 'white' }}
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

  // ==================== STEP 2: CHOOSE METHOD ====================
  if (step === 'method') {
    return (
      <div>
        <div className="page-header"><h1>{t('process.title')}</h1><p>{t('process.subtitle')}</p></div>

        {/* Context badge */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <span style={{ fontSize: 12, color: '#999', marginRight: 8 }}>{t('process.context')}:</span>
            <span className="badge badge-analyzing" style={{ fontSize: 13 }}>{contextName}</span>
          </div>
          <button className="btn btn-sm btn-secondary" onClick={resetWizard}>{t('process.change_context')}</button>
        </div>

        <div className="card">
          <div className="card-title">{t('process.step2')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginTop: 12 }}>
            {/* Upload option */}
            {[
              { key: 'upload', icon: <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><path d="M24 6v28M24 6l-10 10M24 6l10 10M6 34v6a2 2 0 002 2h32a2 2 0 002-2v-6" stroke="var(--dbxsc-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>, titleKey: 'process.upload_title', descKey: 'process.upload_desc' },
              { key: 'batch', icon: <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" fill="var(--dbxsc-primary)" opacity="0.7"/><rect x="28" y="4" width="16" height="16" rx="3" fill="var(--dbxsc-primary)" opacity="0.5"/><rect x="4" y="28" width="16" height="16" rx="3" fill="var(--dbxsc-primary)" opacity="0.5"/><rect x="28" y="28" width="16" height="16" rx="3" fill="var(--dbxsc-primary)" opacity="0.3"/></svg>, titleKey: 'process.batch_title', descKey: 'process.batch_desc' },
              { key: 'stream', icon: <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="6" fill="var(--dbxsc-primary)"/><path d="M14 14a14 14 0 0120 0" stroke="var(--dbxsc-primary)" strokeWidth="2.5" strokeLinecap="round" opacity="0.4"/><path d="M10 10a20 20 0 0128 0" stroke="var(--dbxsc-primary)" strokeWidth="2.5" strokeLinecap="round" opacity="0.25"/><path d="M34 34a14 14 0 01-20 0" stroke="var(--dbxsc-primary)" strokeWidth="2.5" strokeLinecap="round" opacity="0.4"/><path d="M38 38a20 20 0 01-28 0" stroke="var(--dbxsc-primary)" strokeWidth="2.5" strokeLinecap="round" opacity="0.25"/></svg>, titleKey: 'process.stream_title', descKey: 'process.stream_desc' },
            ].map(opt => (
              <div key={opt.key} onClick={() => setStep(opt.key)}
                style={{ padding: 24, borderRadius: 12, border: '2px solid #e0e0e0', cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--dbxsc-primary)'; e.currentTarget.style.transform = 'scale(1.02)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#e0e0e0'; e.currentTarget.style.transform = 'scale(1)'; }}>
                <div style={{ marginBottom: 12 }}>{opt.icon}</div>
                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>{t(opt.titleKey)}</div>
                <p style={{ fontSize: 13, color: '#999' }}>{t(opt.descKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Context header (shared by upload, batch, progress steps)
  const contextHeader = (
    <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <div>
        <span style={{ fontSize: 12, color: '#999', marginRight: 8 }}>{t('process.context')}:</span>
        <span className="badge badge-analyzing" style={{ fontSize: 13 }}>{contextName}</span>
      </div>
      <button className="btn btn-sm btn-secondary" onClick={() => setStep('method')}>{t('review.back')}</button>
    </div>
  );

  // ==================== UPLOAD ====================
  if (step === 'upload') {
    return (
      <div>
        <div className="page-header"><h1>{t('process.title')}</h1></div>
        {contextHeader}
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

  // ==================== SUCCESS (upload) ====================
  if (step === 'success' && result) {
    return (
      <div>
        <div className="page-header"><h1>{t('process.title')}</h1></div>
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16, color: 'var(--dbxsc-success)' }}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="3"/><path d="M14 24l7 7 13-13" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <h3 style={{ marginBottom: 8 }}>{t('upload.success')}</h3>
          <p style={{ color: '#999', marginBottom: 4 }}>{result.filename}</p>
          <p style={{ color: '#999', fontSize: 13, marginBottom: 24 }}>{t('upload.analysis_started')}</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={() => navigate('review', { videoId: result.video_id })}>{t('upload.view_analysis')}</button>
            <button className="btn btn-secondary" onClick={resetWizard}>{t('process.new')}</button>
          </div>
        </div>
      </div>
    );
  }

  // ==================== BATCH (volume select) ====================
  if (step === 'batch') {
    return (
      <div>
        <div className="page-header"><h1>{t('process.title')}</h1></div>
        {contextHeader}
        <div className="card">
          <div className="card-title">{t('batch.volume_path')}</div>
          <div className="form-group">
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="text" value={volumePath} onChange={e => setVolumePath(e.target.value)}
                placeholder="/Volumes/catalog/schema/volume_name" style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={() => {
                setShowBrowser(!showBrowser);
                if (!showBrowser && catalogs.length === 0) fetchCatalogs().then(setCatalogs).catch(() => {});
              }}>{t('batch.browse')}</button>
            </div>
          </div>

          {showBrowser && (
            <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 16, marginBottom: 16, border: '1px solid #e0e0e0' }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>{t('batch.catalog')}</label>
                  <select value={selCatalog} onChange={e => { setSelCatalog(e.target.value); setSelSchema(''); setVolumes([]); if (e.target.value) fetchSchemas(e.target.value).then(setSchemas).catch(() => {}); }}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}>
                    <option value="">{t('batch.select')}</option>
                    {catalogs.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>{t('batch.schema')}</label>
                  <select value={selSchema} onChange={e => { setSelSchema(e.target.value); if (e.target.value && selCatalog) fetchVolumes(selCatalog, e.target.value).then(setVolumes).catch(() => {}); }}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}>
                    <option value="">{t('batch.select')}</option>
                    {schemas.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              {volumes.length > 0 && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Volumes</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {volumes.map(v => (
                      <button key={v.name} className={`btn btn-sm ${volumePath === v.path ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => { setVolumePath(v.path); setShowBrowser(false); }}>{v.name}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <p style={{ fontSize: 12, color: '#999', marginBottom: 16 }}>{t('batch.skip_info')}</p>
          <button className="btn btn-primary" onClick={handleStartBatch} disabled={loading || !volumePath.trim()}>
            {loading ? t('batch.starting') : t('batch.start')}
          </button>
          {error && <p style={{ color: 'var(--dbxsc-danger)', marginTop: 8, fontSize: 13 }}>{error}</p>}
        </div>
      </div>
    );
  }

  // ==================== BATCH PROGRESS ====================
  if (step === 'progress' && batch) {
    return (
      <div>
        <div className="page-header"><h1>{t('process.title')}</h1></div>
        <div className="card">
          <div className="card-title">
            Batch #{batch.batch_id}
            <span className="badge badge-analyzing" style={{ marginLeft: 8, fontSize: 11 }}>{contextName}</span>
          </div>
          <div className="batch-progress">
            <div className="progress-pct">{Math.round(batch.pct || 0)}%</div>
            <div className="progress-bar">
              <div className={`progress-bar-fill ${batch.status === 'COMPLETED' ? 'complete' : ''}`} style={{ width: `${batch.pct || 0}%` }}></div>
            </div>
            <div className="progress-label">
              {batch.status === 'COMPLETED' ? t('batch.completed') : batch.status === 'FAILED' ? t('batch.failed') : (
                <>{batch.completed || 0} / {batch.total || 0} {t('batch.processed')}
                  {batch.current_video && <> | {batch.current_video}</>}
                  {batch.estimated_remaining_sec > 0 && <> | ~{fmtTime(batch.estimated_remaining_sec)}</>}
                </>
              )}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', gap: 24, justifyContent: 'center', fontSize: 14, marginBottom: 16 }}>
              <span>{t('batch.total')}: <b>{batch.total || 0}</b></span>
              <span style={{ color: 'var(--dbxsc-success)' }}>{t('batch.done')}: <b>{batch.completed || 0}</b></span>
              <span style={{ color: 'var(--dbxsc-danger)' }}>{t('batch.failures')}: <b>{batch.failed || 0}</b></span>
              <span style={{ color: '#999' }}>{t('batch.skipped')}: <b>{batch.skipped || 0}</b></span>
            </div>

            {previewVideoId && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>Preview: {batch.videos?.find(v => v.video_id === previewVideoId)?.name || 'Video'}</span>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPreviewVideoId(null)}>{t('batch.close')}</button>
                </div>
                <video controls autoPlay muted src={`/api/videos/${previewVideoId}/stream`} style={{ width: '100%', maxHeight: 360, borderRadius: 12, background: '#000' }} />
              </div>
            )}

            {batch.videos && batch.videos.length > 0 && (
              <table className="data-table">
                <thead><tr><th>{t('videos.file')}</th><th>{t('videos.status')}</th><th>{t('videos.actions')}</th></tr></thead>
                <tbody>
                  {batch.videos.map((v, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: v.status === 'PROCESSING' ? 600 : 400 }}>{v.name}</td>
                      <td><span className={`badge badge-${(v.status || 'pending').toLowerCase()}`}>{v.status === 'PROCESSING' ? t('batch.processing') : v.status}</span></td>
                      <td>{v.video_id && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-sm btn-secondary" onClick={() => setPreviewVideoId(previewVideoId === v.video_id ? null : v.video_id)}>
                            {previewVideoId === v.video_id ? t('batch.close') : t('batch.watch')}
                          </button>
                          {v.status === 'COMPLETED' && <button className="btn btn-sm btn-primary" onClick={() => navigate('review', { videoId: v.video_id })}>{t('batch.review_btn')}</button>}
                        </div>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {batch.status === 'COMPLETED' && (
              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <button className="btn btn-primary" onClick={resetWizard}>{t('process.new')}</button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ==================== STREAM (URL input) ====================
  if (step === 'stream') {
    return (
      <div>
        <div className="page-header"><h1>{t('process.title')}</h1></div>
        {contextHeader}
        <div className="card">
          <div className="card-title">{t('process.stream_title')}</div>
          <p style={{ fontSize: 13, color: '#999', marginBottom: 16 }}>{t('process.stream_info')}</p>

          <div className="form-group">
            <label>{t('process.stream_url')}</label>
            <input type="text" value={streamUrl} onChange={e => setStreamUrl(e.target.value)}
              placeholder="rtsp://camera-ip:554/stream1" style={{ fontFamily: 'monospace' }} />
          </div>

          <div className="form-group" style={{ maxWidth: 250 }}>
            <label>{t('process.stream_window_label')}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="number" min="10" max="600" value={streamWindow} onChange={e => setStreamWindow(Number(e.target.value))}
                style={{ width: 80 }} />
              <span style={{ fontSize: 13, color: '#999' }}>{t('process.stream_window_unit')}</span>
            </div>
          </div>

          <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
            <div style={{ fontWeight: 500, marginBottom: 6 }}>{t('process.stream_protocols')}</div>
            <div style={{ color: '#666', lineHeight: 1.8 }}>
              <code style={{ background: '#e8e8e8', padding: '2px 6px', borderRadius: 4 }}>rtsp://</code> — {t('process.stream_rtsp')}<br/>
              <code style={{ background: '#e8e8e8', padding: '2px 6px', borderRadius: 4 }}>rtmp://</code> — {t('process.stream_rtmp')}<br/>
              <code style={{ background: '#e8e8e8', padding: '2px 6px', borderRadius: 4 }}>http(s)://</code> — {t('process.stream_http')}<br/>
              <code style={{ background: '#e8e8e8', padding: '2px 6px', borderRadius: 4 }}>/Volumes/...</code> — {t('process.stream_mock')}
            </div>
            <div style={{ marginTop: 8, padding: '8px 10px', background: '#e8f5e9', borderRadius: 6, color: '#2e7d32' }}>
              <strong>{t('process.stream_test_label')}</strong><br/>
              <code style={{ fontSize: 12 }}>/Volumes/jsf_dbxsc_demo/main/test_videos/motorista_fadiga_severa.mp4</code>
            </div>
          </div>

          <button className="btn btn-primary" onClick={handleStartStream} disabled={loading || !streamUrl.trim()}>
            {loading ? t('batch.starting') : t('process.stream_start')}
          </button>
          {error && <p style={{ color: 'var(--dbxsc-danger)', marginTop: 8, fontSize: 13 }}>{error}</p>}
        </div>
      </div>
    );
  }

  // ==================== STREAMING PROGRESS ====================
  if (step === 'streaming' && streamData) {
    const isLive = streamData.status === 'RUNNING';
    return (
      <div>
        <div className="page-header"><h1>{t('process.title')}</h1></div>
        <div className="card">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isLive && <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#e74c3c', display: 'inline-block', animation: 'pulse 1.5s infinite' }}></span>}
            {t('process.stream_title')}
            <span className="badge badge-analyzing" style={{ fontSize: 11, marginLeft: 8 }}>{contextName}</span>
            <span className={`badge ${isLive ? 'badge-scanning' : streamData.status === 'COMPLETED' ? 'badge-completed' : 'badge-failed'}`} style={{ marginLeft: 4 }}>
              {streamData.status}
            </span>
          </div>

          <div className="stat-cards" style={{ marginTop: 12 }}>
            <div className="stat-card info"><div className="stat-value">{streamData.windows_processed}</div><div className="stat-label">{t('process.stream_windows')}</div></div>
            <div className="stat-card"><div className="stat-value">{streamData.total_detections}</div><div className="stat-label">{t('videos.detections')}</div></div>
          </div>

          {streamData.error && <p style={{ color: 'var(--dbxsc-danger)', marginTop: 8, fontSize: 13 }}>{streamData.error}</p>}

          {/* Windows table */}
          {streamData.videos && streamData.videos.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="card-title">{t('process.stream_windows_detail')}</div>
              <table className="data-table">
                <thead><tr><th>{t('process.stream_window')}</th><th>{t('videos.detections')}</th><th>{t('videos.score')}</th><th>{t('videos.actions')}</th></tr></thead>
                <tbody>
                  {streamData.videos.map((v, i) => (
                    <tr key={i}>
                      <td>#{v.window}</td>
                      <td>{v.detections}</td>
                      <td>{v.overall != null ? <span className={`score-gauge ${v.overall >= 7 ? 'score-critical' : v.overall >= 4 ? 'score-high' : v.overall > 0 ? 'score-medium' : 'score-low'}`}>{v.overall.toFixed(1)}</span> : '-'}</td>
                      <td>{v.detections > 0 && <button className="btn btn-sm btn-primary" onClick={() => navigate('review', { videoId: v.video_id })}>{t('batch.review_btn')}</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'center' }}>
            {isLive && <button className="btn btn-danger" onClick={handleStopStream}>{t('process.stream_stop')}</button>}
            {!isLive && <button className="btn btn-primary" onClick={resetWizard}>{t('process.new')}</button>}
          </div>
        </div>
        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
      </div>
    );
  }

  return null;
}

function fmtTime(s) { return s < 60 ? `${Math.round(s)}s` : `${Math.floor(s/60)}m ${Math.round(s%60)}s`; }
export default ProcessVideos;
