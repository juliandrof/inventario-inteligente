import React, { useState, useEffect, useRef } from 'react';
import { startBatch, fetchBatches } from '../api';

function BatchProcessing({ navigate }) {
  const [volumePath, setVolumePath] = useState('/Volumes/jsf_dbxsc_demo/main/test_videos');
  const [batch, setBatch] = useState(null);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewVideoId, setPreviewVideoId] = useState(null);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    fetchBatches().then(setBatches).catch(() => {});
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, []);

  const handleStart = async () => {
    if (!volumePath.trim()) return;
    setError('');
    setLoading(true);

    try {
      const res = await startBatch(volumePath.trim());
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
        <h1>Processamento em Batch</h1>
        <p>Analise todos os videos de um volume do Databricks</p>
      </div>

      <div className="card">
        <div className="card-title">Iniciar Processamento</div>
        <div className="form-group">
          <label>Caminho do Volume</label>
          <input
            type="text"
            value={volumePath}
            onChange={(e) => setVolumePath(e.target.value)}
            placeholder="/Volumes/catalog/schema/volume_name"
          />
        </div>
        <p style={{ fontSize: 12, color: '#999', marginBottom: 16 }}>
          Videos ja processados anteriormente serao ignorados automaticamente.
        </p>
        <button
          className="btn btn-primary"
          onClick={handleStart}
          disabled={loading || (batch && batch.status === 'RUNNING')}
        >
          {loading ? 'Iniciando...' : 'Iniciar Processamento'}
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
                'Processamento concluido!'
              ) : batch.status === 'FAILED' ? (
                'Falha no processamento'
              ) : (
                <>
                  {batch.completed || 0} de {batch.total || 0} videos processados
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
          <div className="card-title">Historico de Batches</div>
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
