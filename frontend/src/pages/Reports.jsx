import React, { useState, useEffect } from 'react';
import { fetchVideos, fetchDetections } from '../api';

function Reports({ navigate }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [detections, setDetections] = useState([]);

  useEffect(() => {
    fetchVideos().then(v => {
      setVideos(v || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const reviewed = videos.filter(v => v.status === 'COMPLETED');
  const filtered = reviewed.filter(v => {
    const matchSearch = !search || v.filename?.toLowerCase().includes(search.toLowerCase());
    if (filter === 'ALL') return matchSearch;
    if (filter === 'WITH_DETECTIONS') return matchSearch && (v.total_detections || 0) > 0;
    if (filter === 'CLEAN') return matchSearch && (v.total_detections || 0) === 0;
    if (filter === 'HIGH_RISK') return matchSearch && (v.overall_risk || 0) >= 7;
    return matchSearch;
  });

  const handleSelect = async (video) => {
    setSelectedVideo(video);
    try {
      const dets = await fetchDetections(video.video_id);
      setDetections(dets || []);
    } catch { setDetections([]); }
  };

  if (loading) return <div className="loading"><div className="spinner"></div>Carregando relatorio...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Relatorio de Videos</h1>
        <p>{reviewed.length} videos processados</p>
      </div>

      {/* Search and filters */}
      <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Pesquisar por nome do video..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: '10px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
        />
        {['ALL', 'WITH_DETECTIONS', 'CLEAN', 'HIGH_RISK'].map(f => (
          <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(f)}>
            {f === 'ALL' ? 'Todos' : f === 'WITH_DETECTIONS' ? 'Com Deteccoes' : f === 'CLEAN' ? 'Limpos' : 'Alto Risco'}
          </button>
        ))}
      </div>

      {selectedVideo ? (
        <div>
          {/* Video detail view */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: 18 }}>{selectedVideo.filename}</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm btn-primary" onClick={() => navigate('review', { videoId: selectedVideo.video_id })}>
                Retornar para Analise
              </button>
              <button className="btn btn-sm btn-secondary" onClick={() => { setSelectedVideo(null); setDetections([]); }}>
                Voltar ao Relatorio
              </button>
            </div>
          </div>

          {/* Video player */}
          <div className="card">
            <video controls src={`/api/videos/${selectedVideo.video_id}/stream`}
              style={{ width: '100%', maxHeight: 400, borderRadius: 8, background: '#000' }} />
          </div>

          {/* Scores summary */}
          {selectedVideo.scores_json && (
            <div className="stat-cards">
              {(() => {
                try {
                  const scores = JSON.parse(selectedVideo.scores_json);
                  return Object.entries(scores).map(([cat, score]) => (
                    <div key={cat} className={`stat-card ${score >= 7 ? 'danger' : score >= 4 ? 'warning' : 'success'}`}>
                      <div className="stat-value">{score}</div>
                      <div className="stat-label" style={{ textTransform: 'capitalize' }}>{cat}</div>
                    </div>
                  ));
                } catch { return null; }
              })()}
              <div className={`stat-card ${(selectedVideo.overall_risk || 0) >= 7 ? 'danger' : ''}`}>
                <div className="stat-value">{typeof selectedVideo.overall_risk === 'number' ? selectedVideo.overall_risk.toFixed(1) : selectedVideo.overall_risk || 0}</div>
                <div className="stat-label">Risco Geral</div>
              </div>
            </div>
          )}

          {/* Detections list */}
          <div className="card">
            <div className="card-title">Deteccoes ({detections.length})</div>
            {detections.length === 0 ? (
              <p style={{ color: '#999' }}>Nenhuma deteccao neste video</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr><th>Momento</th><th>Categoria</th><th>Score</th><th>Status</th><th>Descricao IA</th><th>Notas</th></tr>
                </thead>
                <tbody>
                  {detections.map((d, i) => (
                    <tr key={i}>
                      <td>{formatTime(d.timestamp_sec)}</td>
                      <td style={{ textTransform: 'capitalize' }}>{d.category}</td>
                      <td><span className={`score-gauge ${getScoreClass(d.score)}`}>{d.score}</span></td>
                      <td><span className={`badge badge-${(d.review_status || 'pending').toLowerCase()}`}>{d.review_status}</span></td>
                      <td style={{ fontSize: 12, maxWidth: 300 }}>{d.ai_description}</td>
                      <td style={{ fontSize: 12, fontStyle: 'italic' }}>{d.reviewer_notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : (
        /* Video list */
        filtered.length === 0 ? (
          <div className="empty-state">
            <h3>Nenhum video encontrado</h3>
            <p>{search ? 'Tente outro termo de busca' : 'Nenhum video processado ainda'}</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="data-table">
              <thead>
                <tr><th>Arquivo</th><th>Duracao</th><th>Risco</th><th>Deteccoes</th><th>Scores</th><th>Data</th><th>Acoes</th></tr>
              </thead>
              <tbody>
                {filtered.map((v, i) => (
                  <tr key={i} className="clickable" onClick={() => handleSelect(v)}>
                    <td style={{ fontWeight: 500 }}>{v.filename}</td>
                    <td>{v.duration_seconds ? `${Math.round(v.duration_seconds)}s` : '-'}</td>
                    <td>
                      {v.overall_risk ? (
                        <span className={`score-gauge ${getScoreClass(v.overall_risk)}`}>
                          {typeof v.overall_risk === 'number' ? v.overall_risk.toFixed(1) : v.overall_risk}
                        </span>
                      ) : '-'}
                    </td>
                    <td>{v.total_detections || 0}</td>
                    <td style={{ fontSize: 11 }}>
                      {(() => {
                        try {
                          const s = JSON.parse(v.scores_json);
                          return Object.entries(s).map(([k, val]) => `${k}:${val}`).join(' | ');
                        } catch { return '-'; }
                      })()}
                    </td>
                    <td style={{ fontSize: 12, color: '#999' }}>{formatDate(v.upload_timestamp)}</td>
                    <td>
                      <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); navigate('review', { videoId: v.video_id }); }}>
                        Reanalisar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

function getScoreClass(score) {
  if (score <= 3) return 'score-low';
  if (score <= 6) return 'score-medium';
  if (score <= 8) return 'score-high';
  return 'score-critical';
}
function formatTime(sec) {
  if (!sec && sec !== 0) return '-';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function formatDate(ts) {
  if (!ts) return '-';
  try { return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return ts; }
}

export default Reports;
