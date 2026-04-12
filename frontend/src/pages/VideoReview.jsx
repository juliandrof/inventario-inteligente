import React, { useState, useEffect, useRef } from 'react';
import { fetchVideo, fetchDetections, fetchPendingVideos, fetchContexts, confirmDetection, rejectDetection } from '../api';
import { useI18n } from '../i18n';

function VideoReview({ navigate, pageParams }) {
  const { t } = useI18n();
  const [videoId, setVideoId] = useState(pageParams.videoId || null);
  const [video, setVideo] = useState(null);
  const [detections, setDetections] = useState([]);
  const [pendingVideos, setPendingVideos] = useState([]);
  const [contexts, setContexts] = useState([]);
  const [contextFilter, setContextFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeDetection, setActiveDetection] = useState(null);
  const [notes, setNotes] = useState({});
  const videoRef = useRef(null);

  useEffect(() => {
    if (pageParams.videoId) setVideoId(pageParams.videoId);
  }, [pageParams.videoId]);

  useEffect(() => {
    let interval = null;
    setLoading(true);
    if (videoId) {
      const load = () => {
        Promise.all([
          fetchVideo(videoId).catch(() => null),
          fetchDetections(videoId).catch(() => []),
        ]).then(([v, d]) => {
          setVideo(v);
          setDetections(d || []);
          setLoading(false);
          // Stop polling once completed or failed
          if (v && (v.status === 'COMPLETED' || v.status === 'FAILED') && interval) {
            clearInterval(interval);
            interval = null;
          }
        });
      };
      load();
      // Poll every 3 seconds while video is processing
      interval = setInterval(load, 3000);
    } else {
      fetchContexts().then(setContexts).catch(() => {});
      fetchPendingVideos()
        .then(setPendingVideos)
        .catch(() => setPendingVideos([]))
        .finally(() => setLoading(false));
    }
    return () => { if (interval) clearInterval(interval); };
  }, [videoId]);

  const seekTo = (timestamp) => {
    if (videoRef.current) {
      videoRef.current.currentTime = timestamp;
      videoRef.current.play();
    }
  };

  const handleConfirm = async (detId) => {
    await confirmDetection(detId, notes[detId] || '');
    const updated = await fetchDetections(videoId);
    setDetections(updated || []);
  };

  const handleReject = async (detId) => {
    await rejectDetection(detId, notes[detId] || '');
    const updated = await fetchDetections(videoId);
    setDetections(updated || []);
  };

  if (loading) return <div className="loading"><div className="spinner"></div>{t('common.loading')}</div>;

  // ==================== VIDEO LIST (no video selected) ====================
  if (!videoId) {
    const filteredPending = pendingVideos.filter(v => {
      if (contextFilter && v.context_name !== contextFilter) return false;
      if (search && !v.filename.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });

    return (
      <div>
        <div className="page-header">
          <h1>{t('review.title')}</h1>
          <p>{pendingVideos.length} {t('review.pending_videos')}</p>
        </div>

        {/* Filters */}
        {pendingVideos.length > 0 && (
          <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
            <input type="text" placeholder={t('reports.search')} value={search} onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 180, padding: '9px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }} />
            {contexts.length > 0 && (
              <select value={contextFilter} onChange={e => setContextFilter(e.target.value)}
                style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, minWidth: 180 }}>
                <option value="">{t('reports.all_contexts')}</option>
                {contexts.map(c => <option key={c.context_id} value={c.name}>{c.name}</option>)}
              </select>
            )}
          </div>
        )}

        {filteredPending.length === 0 ? (
          <div className="empty-state">
            <h3>{t('review.no_pending')}</h3>
            <p>{t('review.no_pending_info')}</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {filteredPending.map((v, i) => (
              <div key={i} className="card" style={{ padding: 0, overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.2s' }}
                onClick={() => setVideoId(v.video_id)}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
                {/* Thumbnail */}
                <div style={{ height: 160, background: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                  {v.first_thumbnail ? (
                    <img src={`/api/thumbnails/${v.first_thumbnail}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" stroke="#555" strokeWidth="2"/><path d="M20 16l12 8-12 8V16z" fill="#555"/></svg>
                  )}
                  {/* Score badge */}
                  <div style={{
                    position: 'absolute', top: 10, right: 10,
                    width: 44, height: 44, borderRadius: '50%',
                    background: getScoreColor(v.overall_risk || 0),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontWeight: 700, fontSize: 16,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  }}>
                    {typeof v.overall_risk === 'number' ? v.overall_risk.toFixed(1) : v.overall_risk || 0}
                  </div>
                  {/* Pending count */}
                  <div style={{
                    position: 'absolute', bottom: 10, left: 10,
                    background: 'rgba(0,0,0,0.7)', color: 'white',
                    padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500,
                  }}>
                    {v.pending_count} {t('review.pending_count')}
                  </div>
                </div>
                {/* Info */}
                <div style={{ padding: 16 }}>
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{v.filename}</div>
                    {v.context_name && <span className="badge badge-analyzing" style={{ fontSize: 10, marginTop: 4, display: 'inline-block' }}>{v.context_name}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#999', display: 'flex', gap: 12 }}>
                    <span>{v.total_detections || 0} {t('videos.detections').toLowerCase()}</span>
                    {v.duration_seconds && <span>{Math.round(v.duration_seconds)}s</span>}
                  </div>
                  {v.scores_json && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      {(() => {
                        try {
                          const scores = JSON.parse(v.scores_json);
                          return Object.entries(scores).map(([cat, score]) => (
                            <span key={cat} style={{
                              fontSize: 11, padding: '2px 8px', borderRadius: 10,
                              background: score >= 4 ? '#fff3cd' : '#e8f5e9',
                              color: score >= 4 ? '#856404' : '#2e7d32', fontWeight: 500, textTransform: 'capitalize',
                            }}>
                              {cat}: {score}
                            </span>
                          ));
                        } catch { return null; }
                      })()}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ==================== VIDEO DETAIL (video selected) ====================
  const pendingDetections = detections.filter(d => d.review_status === 'PENDING');
  const reviewedDetections = detections.filter(d => d.review_status !== 'PENDING');

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1>{video?.filename || 'Video'}</h1>
          <p>
            {video?.status && <span className={`badge badge-${video.status.toLowerCase()}`}>{video.status}</span>}
            {video?.duration_seconds && <span style={{ marginLeft: 12, fontSize: 13, color: '#999' }}>Duracao: {Math.round(video.duration_seconds)}s</span>}
          </p>
        </div>
        <button className="btn btn-secondary" onClick={() => setVideoId(null)}>Voltar</button>
      </div>

      {video?.status === 'COMPLETED' ? (
        <>
          {/* Scores Summary */}
          {video?.scores_json && (
            <div className="stat-cards" style={{ marginBottom: 16 }}>
              {(() => {
                try {
                  const scores = JSON.parse(video.scores_json);
                  return Object.entries(scores).map(([cat, score]) => (
                    <div key={cat} className={`stat-card ${score >= 7 ? 'danger' : score >= 4 ? 'warning' : 'success'}`}>
                      <div className="stat-value">{score}</div>
                      <div className="stat-label" style={{ textTransform: 'capitalize' }}>{cat}</div>
                    </div>
                  ));
                } catch { return null; }
              })()}
              {video.overall_risk != null && (
                <div className={`stat-card ${video.overall_risk >= 7 ? 'danger' : video.overall_risk >= 4 ? 'warning' : ''}`}>
                  <div className="stat-value">{typeof video.overall_risk === 'number' ? video.overall_risk.toFixed(1) : video.overall_risk}</div>
                  <div className="stat-label">{t('review.score_general')}</div>
                </div>
              )}
            </div>
          )}

          <div className="video-review-layout">
            <div className="video-player-section">
              <video ref={videoRef} controls src={`/api/videos/${videoId}/stream`}
                style={{ width: '100%', borderRadius: 12, background: '#000' }} />

              {detections.length > 0 && (
                <div className="card" style={{ marginTop: 12 }}>
                  <div className="card-title">{t('review.moments')} ({detections.length})</div>
                  <div className="thumbnail-strip">
                    {detections.map((d, i) => (
                      <div key={i}
                        className={`thumbnail-item ${activeDetection === d.detection_id ? 'active' : ''}`}
                        onClick={() => { seekTo(d.timestamp_sec); setActiveDetection(d.detection_id); }}>
                        {d.thumbnail_path ? (
                          <img src={`/api/thumbnails/${d.thumbnail_path}`} alt={`t=${d.timestamp_sec}s`} />
                        ) : (
                          <div style={{ width: '100%', height: 68, background: '#ddd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>
                            {formatTime(d.timestamp_sec)}
                          </div>
                        )}
                        <div className="thumb-time">{formatTime(d.timestamp_sec)}</div>
                        <div className="thumb-score" style={{ background: getScoreColor(d.score) }}>{d.score}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="detection-panel">
              {pendingDetections.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, marginBottom: 12, color: 'var(--dbxsc-warning, #f39c12)' }}>
                    Pendentes ({pendingDetections.length})
                  </h3>
                  {pendingDetections.map(d => (
                    <DetectionCard key={d.detection_id} detection={d} notes={notes} setNotes={setNotes}
                      onConfirm={handleConfirm} onReject={handleReject} onSeek={seekTo}
                      active={activeDetection === d.detection_id} onActivate={() => setActiveDetection(d.detection_id)} />
                  ))}
                </>
              )}
              {reviewedDetections.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, marginBottom: 12, marginTop: 24, color: '#999' }}>
                    Revisados ({reviewedDetections.length})
                  </h3>
                  {reviewedDetections.map(d => (
                    <DetectionCard key={d.detection_id} detection={d} notes={notes} setNotes={setNotes}
                      onSeek={seekTo} reviewed active={activeDetection === d.detection_id}
                      onActivate={() => setActiveDetection(d.detection_id)} />
                  ))}
                </>
              )}
              {detections.length === 0 && (
                <div className="empty-state" style={{ padding: 20 }}>
                  <h3>{t('review.no_detections')}</h3>
                  <p>{t('review.no_risk')}</p>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          {video?.status === 'FAILED' ? (
            <>
              <h3 style={{ color: 'var(--dbxsc-danger)' }}>{t('review.failed')}</h3>
              <p style={{ color: '#999', marginTop: 8 }}>{video?.error_message || 'Erro desconhecido'}</p>
            </>
          ) : (
            <>
              <div className="spinner" style={{ margin: '0 auto 16px' }}></div>
              <h3>{t('review.processing')}</h3>
              <div className="progress-bar" style={{ maxWidth: 300, margin: '16px auto' }}>
                <div className="progress-bar-fill" style={{ width: `${video?.progress_pct || 0}%` }}></div>
              </div>
              <p style={{ color: '#999' }}>{Math.round(video?.progress_pct || 0)}% - {video?.status}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DetectionCard({ detection: d, notes, setNotes, onConfirm, onReject, onSeek, reviewed, active, onActivate }) {
  return (
    <div className={`detection-card ${d.score >= 7 ? 'high-risk' : d.score >= 4 ? 'medium-risk' : ''} ${active ? 'active' : ''}`} onClick={onActivate}>
      <div className="detection-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`score-gauge ${getScoreClass(d.score)}`} style={{ width: 32, height: 32, fontSize: 12 }}>{d.score}</span>
          <div>
            <div className="detection-category">{d.category}</div>
            <div className="detection-time" style={{ cursor: 'pointer', color: 'var(--dbxsc-primary)' }}
              onClick={e => { e.stopPropagation(); onSeek(d.timestamp_sec); }}>
              {formatTime(d.timestamp_sec)}
            </div>
          </div>
        </div>
        {d.review_status !== 'PENDING' && (
          <span className={`badge badge-${d.review_status.toLowerCase()}`}>
            {d.review_status === 'CONFIRMED' ? 'Confirmado' : 'Rejeitado'}
          </span>
        )}
      </div>
      {d.ai_description && <div className="detection-description">{d.ai_description}</div>}
      {d.confidence != null && (
        <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>Confianca: {(d.confidence * 100).toFixed(0)}%</div>
      )}
      {!reviewed && (
        <>
          <div className="form-group" style={{ marginBottom: 8 }}>
            <textarea placeholder="{t('review.notes_placeholder')}" value={notes[d.detection_id] || ''}
              onChange={e => setNotes({ ...notes, [d.detection_id]: e.target.value })}
              style={{ minHeight: 50, fontSize: 12 }} onClick={e => e.stopPropagation()} />
          </div>
          <div className="detection-actions">
            <button className="btn btn-sm btn-success" onClick={e => { e.stopPropagation(); onConfirm(d.detection_id); }}>Confirmar</button>
            <button className="btn btn-sm btn-danger" onClick={e => { e.stopPropagation(); onReject(d.detection_id); }}>Rejeitar</button>
          </div>
        </>
      )}
      {reviewed && d.reviewer_notes && (
        <div style={{ fontSize: 12, color: '#666', marginTop: 8, fontStyle: 'italic' }}>Nota: {d.reviewer_notes}</div>
      )}
    </div>
  );
}

function getScoreClass(s) { return s <= 3 ? 'score-low' : s <= 6 ? 'score-medium' : s <= 8 ? 'score-high' : 'score-critical'; }
function getScoreColor(s) { return s <= 3 ? '#27ae60' : s <= 6 ? '#f39c12' : s <= 8 ? '#e67e22' : '#e74c3c'; }
function formatTime(sec) { if (!sec && sec !== 0) return '-'; const m = Math.floor(sec / 60); const s = Math.round(sec % 60); return `${m}:${String(s).padStart(2, '0')}`; }

export default VideoReview;
