import React, { useState, useEffect } from 'react';
import { fetchReviewVideos, fetchReviewFrames, fetchFilters } from '../api';
import { TYPE_COLORS } from './Dashboard';

function Review({ pageParams }) {
  const [filters, setFilters] = useState({ ufs: [], stores: [] });
  const [selUF, setSelUF] = useState(pageParams?.uf || '');
  const [selStore, setSelStore] = useState(pageParams?.store_id || '');
  const [selDate, setSelDate] = useState('');
  const [videos, setVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [reviewData, setReviewData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState('');

  useEffect(() => { fetchFilters().then(setFilters).catch(() => {}); }, []);

  useEffect(() => {
    const f = {};
    if (selUF) f.uf = selUF;
    if (selStore) f.store_id = selStore;
    if (selDate) f.video_date = selDate;
    fetchReviewVideos(f).then(setVideos).catch(() => {});
  }, [selUF, selStore, selDate]);

  async function loadReview(videoId) {
    setSelectedVideo(videoId);
    setLoading(true);
    try {
      const data = await fetchReviewFrames(videoId);
      setReviewData(data);
    } catch (e) {
      setReviewData(null);
    }
    setLoading(false);
  }

  const filteredFrames = reviewData?.frames?.filter(f => {
    if (!filterType) return true;
    return f.detections.some(d => d.fixture_type === filterType);
  }) || [];

  const allTypes = reviewData ? [...new Set(reviewData.frames?.flatMap(f => f.detections.map(d => d.fixture_type)) || [])] : [];

  return (
    <div className="page">
      <div className="page-header">
        <h1>Revisao de Analise</h1>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="review-filters">
          <select className="filter-select" value={selUF} onChange={e => { setSelUF(e.target.value); setSelStore(''); }}>
            <option value="">Todas UFs</option>
            {filters.ufs.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <select className="filter-select" value={selStore} onChange={e => setSelStore(e.target.value)}>
            <option value="">Todas Lojas</option>
            {filters.stores.filter(s => !selUF || s.uf === selUF).map(s => (
              <option key={s.store_id} value={s.store_id}>{s.store_id}{s.name ? ` - ${s.name}` : ''}</option>
            ))}
          </select>
          <input type="date" className="filter-select" value={selDate} onChange={e => setSelDate(e.target.value)} />
        </div>
      </div>

      {/* Video Selection */}
      {!selectedVideo && (
        <div className="card">
          <h3>Selecione um video para revisar</h3>
          <table className="data-table">
            <thead>
              <tr><th>Arquivo</th><th>Loja</th><th>UF</th><th>Data</th><th>Frames</th><th>Deteccoes</th><th>Expositores</th><th></th></tr>
            </thead>
            <tbody>
              {videos.map(v => (
                <tr key={v.video_id} className="clickable" onClick={() => loadReview(v.video_id)}>
                  <td className="filename">{v.filename}</td>
                  <td>{v.store_id}{v.store_name ? ` - ${v.store_name}` : ''}</td>
                  <td><span className="uf-badge">{v.uf}</span></td>
                  <td>{v.video_date}</td>
                  <td>{v.frames_with_detections || 0}</td>
                  <td>{v.total_detections || 0}</td>
                  <td><strong>{v.fixture_count || 0}</strong></td>
                  <td><button className="btn btn-sm btn-primary" onClick={e => { e.stopPropagation(); loadReview(v.video_id); }}>Revisar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {videos.length === 0 && <div className="empty-state">Nenhum video concluido encontrado</div>}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="card"><div className="empty-state">Carregando frames analisados...</div></div>
      )}

      {/* Review Panel */}
      {selectedVideo && reviewData && !loading && (
        <>
          {/* Header */}
          <div className="card review-header-card">
            <div className="review-header">
              <div>
                <h3>{reviewData.video.filename}</h3>
                <div className="review-meta">
                  <span className="uf-badge">{reviewData.video.uf}</span>
                  <span>Loja {reviewData.video.store_id}</span>
                  <span>{reviewData.video.video_date}</span>
                  <span>{reviewData.total_frames} frames analisados</span>
                  <span>{reviewData.total_detections} deteccoes totais</span>
                </div>
              </div>
              <button className="btn btn-secondary" onClick={() => { setSelectedVideo(null); setReviewData(null); setFilterType(''); }}>
                Voltar
              </button>
            </div>

            {/* Fixture Summary */}
            {reviewData.fixture_summary?.length > 0 && (
              <div className="review-summary">
                <h4>Resultado Final (apos deduplicacao)</h4>
                <div className="review-summary-chips">
                  {reviewData.fixture_summary.map(s => (
                    <div key={s.fixture_type} className="summary-chip" style={{ borderColor: TYPE_COLORS[s.fixture_type] || '#666' }}>
                      <span className="chip-dot" style={{ background: TYPE_COLORS[s.fixture_type] || '#666' }} />
                      <strong>{s.total_count}x</strong> {s.fixture_type}
                      <span className="chip-occ">({Math.round(s.avg_occupancy_pct || 0)}% occ.)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Frame type filter */}
            {allTypes.length > 0 && (
              <div className="review-type-filter">
                <span>Filtrar por tipo:</span>
                <button className={`filter-chip ${!filterType ? 'active' : ''}`} onClick={() => setFilterType('')}>Todos</button>
                {allTypes.map(t => (
                  <button key={t} className={`filter-chip ${filterType === t ? 'active' : ''}`}
                    style={filterType === t ? { background: TYPE_COLORS[t] || '#666', color: 'white' } : {}}
                    onClick={() => setFilterType(filterType === t ? '' : t)}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Frame Grid */}
          <div className="review-frame-grid">
            {filteredFrames.map((frame, idx) => (
              <FrameCard key={frame.frame_index} frame={frame} index={idx} />
            ))}
          </div>

          {filteredFrames.length === 0 && (
            <div className="card"><div className="empty-state">Nenhum frame com deteccoes{filterType ? ` do tipo ${filterType}` : ''}</div></div>
          )}
        </>
      )}
    </div>
  );
}


function FrameCard({ frame, index }) {
  const [expanded, setExpanded] = useState(false);
  const detCount = frame.detections.length;
  const types = [...new Set(frame.detections.map(d => d.fixture_type))];

  return (
    <div className="review-frame-card">
      {/* Frame Thumbnail */}
      <div className="frame-thumb-container" onClick={() => setExpanded(!expanded)}>
        {frame.thumbnail_path ? (
          <img src={`/api/thumbnails/${frame.thumbnail_path}`} alt={`Frame ${frame.frame_index}`} className="frame-thumb" loading="lazy" />
        ) : (
          <div className="frame-thumb-placeholder">Frame {frame.frame_index}</div>
        )}
        <div className="frame-overlay">
          <span className="frame-time">{formatTime(frame.timestamp_sec)}</span>
          <span className="frame-count">{detCount} expositor{detCount !== 1 ? 'es' : ''}</span>
        </div>
      </div>

      {/* Detection Tags */}
      <div className="frame-tags">
        {frame.detections.map((det, i) => (
          <span key={i} className="det-tag" style={{ background: TYPE_COLORS[det.fixture_type] || '#666' }}>
            {det.display_name || det.fixture_type}
          </span>
        ))}
      </div>

      {/* Detection Details */}
      <div className={`frame-details ${expanded ? 'expanded' : ''}`}>
        {frame.detections.map((det, i) => (
          <div key={i} className="det-detail">
            <div className="det-detail-header">
              <span className="det-type-dot" style={{ background: TYPE_COLORS[det.fixture_type] || '#666' }} />
              <strong>{det.display_name || det.fixture_type}</strong>
              <span className="det-conf">{Math.round(det.confidence * 100)}%</span>
              <OccBadge level={det.occupancy_level} pct={det.occupancy_pct} />
            </div>
            {det.ai_description && (
              <p className="det-description">{det.ai_description}</p>
            )}
            <div className="det-meta">
              <span>Posicao: ({Math.round(det.position.x)}%, {Math.round(det.position.y)}%)</span>
            </div>
          </div>
        ))}
      </div>

      {/* Expand toggle */}
      {detCount > 0 && (
        <button className="frame-expand-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Recolher' : 'Ver detalhes'}
        </button>
      )}
    </div>
  );
}


function OccBadge({ level, pct }) {
  const colors = { VAZIO: '#EF4444', PARCIAL: '#F59E0B', CHEIO: '#10B981' };
  return (
    <span className="occ-badge" style={{ background: colors[level] || '#999' }}>
      {level} {Math.round(pct || 0)}%
    </span>
  );
}


function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}


export default Review;
