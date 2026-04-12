import React, { useState, useEffect, useRef } from 'react';
import { startBatch, fetchBatches, fetchCatalogs, fetchSchemas, fetchVolumes, fetchContexts } from '../api';
import { useI18n } from '../i18n';

function BatchProcessing({ navigate }) {
  const { t } = useI18n();
  const [volumePath, setVolumePath] = useState('');
  const [batch, setBatch] = useState(null);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewVideoId, setPreviewVideoId] = useState(null);
  const [contexts, setContexts] = useState([]);
  const [contextId, setContextId] = useState(0);
  const eventSourceRef = useRef(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const [catalogs, setCatalogs] = useState([]);
  const [schemas, setSchemas] = useState([]);
  const [volumes, setVolumes] = useState([]);
  const [selCatalog, setSelCatalog] = useState('');
  const [selSchema, setSelSchema] = useState('');

  useEffect(() => {
    fetchBatches().then(setBatches).catch(() => {});
    fetchContexts().then(setContexts).catch(() => {});
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, []);

  const handleStart = async () => {
    if (!volumePath.trim()) return;
    setError('');
    setLoading(true);

    try {
      const res = await startBatch(volumePath.trim(), contextId);
      setBatch(res);

      // Start SSE for progress
      const es = new EventSource(`/api/batch/${res.batch_id}/progress`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setBatch(data);
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(data.status)) {
          es.close();
          fetchBatches().then(setBatches).catch(() => {});
        }
      };

      es.onerror = () => {
        es.close();
      };
    } catch (e) {
      setError(e.message || 'Erro ao iniciar batch');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>{t('batch.title')}</h1>
        <p>{t('batch.subtitle')}</p>
      </div>

      <div className="card">
        <div className="card-title">{t('batch.start')}</div>
        <div className="form-group">
          <label>{t('batch.volume_path')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={volumePath}
              onChange={(e) => setVolumePath(e.target.value)}
              placeholder="/Volumes/catalog/schema/volume_name"
              style={{ flex: 1 }}
            />
            <button className="btn btn-secondary" onClick={() => {
              setShowBrowser(!showBrowser);
              if (!showBrowser && catalogs.length === 0) fetchCatalogs().then(setCatalogs).catch(() => {});
            }}>
              {t('batch.browse')}
            </button>
          </div>
        </div>

        {/* Unity Catalog Browser */}
        {showBrowser && (
          <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 16, marginBottom: 16, border: '1px solid #e0e0e0' }}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>{t('batch.catalog')}</label>
                <select value={selCatalog} onChange={e => {
                  setSelCatalog(e.target.value);
                  setSelSchema('');
                  setVolumes([]);
                  if (e.target.value) fetchSchemas(e.target.value).then(setSchemas).catch(() => {});
                }} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}>
                  <option value="">{t('batch.select')}</option>
                  {catalogs.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>{t('batch.schema')}</label>
                <select value={selSchema} onChange={e => {
                  setSelSchema(e.target.value);
                  if (e.target.value && selCatalog) fetchVolumes(selCatalog, e.target.value).then(setVolumes).catch(() => {});
                }} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}>
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
                      onClick={() => { setVolumePath(v.path); setShowBrowser(false); }}>
                      {v.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Context selector */}
        {contexts.length > 0 && (
          <div className="form-group">
            <label>{t('batch.context')}</label>
            <select value={contextId} onChange={e => setContextId(Number(e.target.value))}
              style={{ maxWidth: 400 }}>
              <option value={0}>{t('batch.select_context')}</option>
              {contexts.map(c => <option key={c.context_id} value={c.context_id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <p style={{ fontSize: 12, color: '#999', marginBottom: 16 }}>
          {t('batch.skip_info')}
        </p>
        <button
          className="btn btn-primary"
          onClick={handleStart}
          disabled={loading || !volumePath.trim() || (batch && batch.status === 'RUNNING')}
        >
          {loading ? t('batch.starting') : t('batch.start')}
        </button>
        {error && <p style={{ color: 'var(--dbxsc-danger)', marginTop: 8, fontSize: 13 }}>{error}</p>}
      </div>

      {batch && batch.status !== 'STARTING' && (
        <div className="card">
          <div className="card-title">Progresso do Batch #{batch.batch_id}</div>
          <div className="batch-progress">
            <div className="progress-pct">{Math.round(batch.pct || 0)}%</div>
            <div className="progress-bar">
              <div
                className={`progress-bar-fill ${batch.status === 'COMPLETED' ? 'complete' : ''}`}
                style={{ width: `${batch.pct || 0}%` }}
              ></div>
            </div>
            <div className="progress-label">
              {batch.status === 'COMPLETED' ? (
                t('batch.completed')
              ) : batch.status === 'FAILED' ? (
                t('batch.failed')
              ) : (
                <>
                  {batch.completed || 0} de {batch.total || 0} {t('batch.processed')}
                  {batch.current_video && <> | Atual: {batch.current_video}</>}
                  {batch.estimated_remaining_sec > 0 && (
                    <> | Tempo estimado: {formatTime(batch.estimated_remaining_sec)}</>
                  )}
                </>
              )}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', gap: 24, justifyContent: 'center', fontSize: 14, marginBottom: 16 }}>
              <span>Total: <b>{batch.total || 0}</b></span>
              <span style={{ color: 'var(--dbxsc-success)' }}>Concluidos: <b>{batch.completed || 0}</b></span>
              <span style={{ color: 'var(--dbxsc-danger)' }}>Falhas: <b>{batch.failed || 0}</b></span>
              <span style={{ color: '#999' }}>Ignorados: <b>{batch.skipped || 0}</b></span>
            </div>

            {/* Video Preview Player */}
            {previewVideoId && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>
                    Preview: {batch.videos?.find(v => v.video_id === previewVideoId)?.name || 'Video'}
                  </span>
                  <button className="btn btn-sm btn-secondary" onClick={() => setPreviewVideoId(null)}>Fechar</button>
                </div>
                <video
                  controls
                  autoPlay
                  muted
                  src={`/api/videos/${previewVideoId}/stream`}
                  style={{ width: '100%', maxHeight: 360, borderRadius: 12, background: '#000' }}
                />
              </div>
            )}

            {batch.videos && batch.videos.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr><th>Arquivo</th><th>Status</th><th>Acoes</th></tr>
                </thead>
                <tbody>
                  {batch.videos.map((v, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: v.status === 'PROCESSING' ? 600 : 400 }}>{v.name}</td>
                      <td>
                        <span className={`badge badge-${(v.status || 'pending').toLowerCase()}`}>
                          {v.status === 'PROCESSING' ? 'Processando...' : v.status}
                        </span>
                      </td>
                      <td>
                        {v.video_id && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className="btn btn-sm btn-secondary"
                              onClick={() => setPreviewVideoId(previewVideoId === v.video_id ? null : v.video_id)}
                            >
                              {previewVideoId === v.video_id ? 'Fechar' : 'Assistir'}
                            </button>
                            {v.status === 'COMPLETED' && (
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => navigate('review', { videoId: v.video_id })}
                              >
                                Revisar
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {batches.length > 0 && (
        <div className="card">
          <div className="card-title">{t('batch.history')}</div>
          <table className="data-table">
            <thead>
              <tr><th>ID</th><th>Volume</th><th>Status</th><th>Total</th><th>Concluidos</th><th>Falhas</th></tr>
            </thead>
            <tbody>
              {batches.map((b, i) => (
                <tr key={i}>
                  <td>#{b.batch_id}</td>
                  <td style={{ fontSize: 12 }}>{b.volume_path}</td>
                  <td><span className={`badge badge-${(b.status || '').toLowerCase()}`}>{b.status}</span></td>
                  <td>{b.total}</td>
                  <td>{b.completed}</td>
                  <td>{b.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatTime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

export default BatchProcessing;
