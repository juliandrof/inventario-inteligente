import React, { useState, useEffect, useRef } from 'react';
import { fetchVideo, fetchDetections, fetchPendingReviews, confirmDetection, rejectDetection } from '../api';

function VideoReview({ navigate, pageParams }) {
  const [videoId, setVideoId] = useState(pageParams.videoId || null);
  const [video, setVideo] = useState(null);
  const [detections, setDetections] = useState([]);
  const [pendingList, setPendingList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeDetection, setActiveDetection] = useState(null);
  const [notes, setNotes] = useState({});
  const videoRef = useRef(null);

  useEffect(() => {
    if (pageParams.videoId) setVideoId(pageParams.videoId);
  }, [pageParams.videoId]);

  useEffect(() => {
    setLoading(true);
    if (videoId) {
      Promise.all([
        fetchVideo(videoId).catch(() => null),
        fetchDetections(videoId).catch(() => []),
      ]).then(([v, d]) => {
        setVideo(v);
        setDetections(d || []);
        setLoading(false);
      });
    } else {
      fetchPendingReviews()
        .then(setPendingList)
        .catch(() => setPendingList([]))
        .finally(() => setLoading(false));
    }
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

  if (loading) return <div className="loading"><div className="spinner"></div>Carregando...</div>;

  // If no video selected, show pending reviews list
  if (!videoId) {
    return (
      <div>
        <div className="page-header">
          <h1>Revisao de Deteccoes</h1>
          <p>{pendingList.length} deteccoes pendentes de revisao</p>
        </div>

        {pendingList.length === 0 ? (
          <div className="empty-state">
            <h3>Nenhuma deteccao pendente</h3>
            <p>Todos os videos foram revisados ou nenhum video foi processado ainda</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="data-table">
              <thead>
                <tr><th>Arquivo</th><th>Categoria</th><th>Score</th><th>Momento</th><th>Descricao IA</th></tr>
              </thead>
              <tbody>
                {pendingList.map((d, i) => (
                  <tr key={i} className="clickable" onClick={() => setVideoId(d.video_id)}>
                    <td style={{ fontWeight: 500 }}>{d.filename}</td>
                    <td><span className="category-tag" style={{ textTransform: 'capitalize' }}>{d.category}</span></td>
                    <td><span className={`score-gauge ${getScoreClass(d.score)}`}>{d.score}</span></td>
                    <td>{formatTime(d.timestamp_sec)}</td>
                    <td style={{ fontSize: 12, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.ai_description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

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
            {video?.resolution && <span style={{ marginLeft: 12, fontSize: 13, color: '#999' }}>{video.resolution}</span>}
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
              {video.overall_risk && (
                <div className={`stat-card ${video.overall_risk >= 7 ? 'danger' : video.overall_risk >= 4 ? 'warning' : ''}`}>
                  <div className="stat-value">{typeof video.overall_risk === 'number' ? video.overall_risk.toFixed(1) : video.overall_risk}</div>
                  <div className="stat-label">Risco Geral</div>
                </div>
              )}
            </div>
          )}

          <div className="video-review-layout">
            <div className="video-player-section">
              {/* Video Player */}
              <video
                ref={videoRef}
                controls
                src={`/api/videos/${videoId}/stream`}
                style={{ width: '100%', borderRadius: 12, background: '#000' }}
              />

              {/* Thumbnail Strip */}
              {detections.length > 0 && (
                <div className="card" style={{ marginTop: 12 }}>
                  <div className="card-title">Momentos Detectados ({detections.length})</div>
                  <div className="thumbnail-strip">
                    {detections.map((d, i) => (
                      <div
                        key={i}
                        className={`thumbnail-item ${activeDetection === d.detection_id ? 'active' : ''}`}
                        onClick={() => { seekTo(d.timestamp_sec); setActiveDetection(d.detection_id); }}
                      >
                        {d.thumbnail_path ? (
                          <img src={`/api/thumbnails/${d.thumbnail_path}`} alt={`t=${d.timestamp_sec}s`} />
                        ) : (
                          <div style={{ width: '100%', height: 68, background: '#ddd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>
                            {formatTime(d.timestamp_sec)}
                          </div>
                        )}
                        <div className="thumb-time">{formatTime(d.timestamp_sec)}</div>
                        <div className={`thumb-score ${getScoreClass(d.score)}`} style={{ background: getScoreColor(d.score) }}>
                          {d.score}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Detection Panel */}
            <div className="detection-panel">
              {pendingDetections.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, marginBottom: 12, color: 'var(--dbxsc-warning)' }}>
                    Pendentes de Revisao ({pendingDetections.length})
                  </h3>
                  {pendingDetections.map((d, i) => (
                    <DetectionCard
                      key={d.detection_id}
                      detection={d}
                      notes={notes}
                      setNotes={setNotes}
                      onConfirm={handleConfirm}
                      onReject={handleReject}
                      onSeek={seekTo}
                      active={activeDetection === d.detection_id}
                      onActivate={() => setActiveDetection(d.detection_id)}
                    />
                  ))}
                </>
              )}

              {reviewedDetections.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, marginBottom: 12, marginTop: 24, color: '#999' }}>
                    Ja Revisados ({reviewedDetections.length})
                  </h3>
                  {reviewedDetections.map((d, i) => (
                    <DetectionCard
                      key={d.detection_id}
                      detection={d}
                      notes={notes}
                      setNotes={setNotes}
                      onSeek={seekTo}
                      reviewed
                      active={activeDetection === d.detection_id}
                      onActivate={() => setActiveDetection(d.detection_id)}
                    />
                  ))}
                </>
              )}

              {detections.length === 0 && (
                <div className="empty-state" style={{ padding: 20 }}>
                  <h3>Nenhuma deteccao</h3>
                  <p>Nenhum sinal de risco foi identificado neste video</p>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          {video?.status === 'FAILED' ? (
            <>
              <h3 style={{ color: 'var(--dbxsc-danger)' }}>Falha no Processamento</h3>
              <p style={{ color: '#999', marginTop: 8 }}>{video?.error_message || 'Erro desconhecido'}</p>
            </>
          ) : (
            <>
              <div className="spinner" style={{ margin: '0 auto 16px' }}></div>
              <h3>Processando video...</h3>
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
  const riskClass = d.score >= 7 ? 'high-risk' : d.score >= 4 ? 'medium-risk' : '';

  return (
    <div className={`detection-card ${riskClass} ${active ? 'active' : ''}`} onClick={onActivate}>
      <div className="detection-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`score-gauge ${getScoreClass(d.score)}`} style={{ width: 32, height: 32, fontSize: 12 }}>
            {d.score}
          </span>
          <div>
            <div className="detection-category">{d.category}</div>
            <div className="detection-time" style={{ cursor: 'pointer', color: 'var(--dbxsc-primary)' }} onClick={(e) => { e.stopPropagation(); onSeek(d.timestamp_sec); }}>
              {formatTime(d.timestamp_sec)}
            </div>
          </div>
        </div>
        {d.review_status !== 'PENDING' && (
          <span className={`badge badge-${d.review_status.toLowerCase()}`}>{d.review_status}</span>
        )}
      </div>

      {d.ai_description && (
        <div className="detection-description">{d.ai_description}</div>
      )}

      {d.confidence && (
        <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
          Confianca: {(d.confidence * 100).toFixed(0)}%
        </div>
      )}

      {!reviewed && (
        <>
          <div className="form-group" style={{ marginBottom: 8 }}>
            <textarea
              placeholder="Observacoes manuais (opcional)..."
              value={notes[d.detection_id] || ''}
              onChange={(e) => setNotes({ ...notes, [d.detection_id]: e.target.value })}
              style={{ minHeight: 50, fontSize: 12 }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="detection-actions">
            <button className="btn btn-sm btn-success" onClick={(e) => { e.stopPropagation(); onConfirm(d.detection_id); }}>
              Confirmar
            </button>
            <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); onReject(d.detection_id); }}>
              Rejeitar
            </button>
          </div>
        </>
      )}

      {reviewed && d.reviewer_notes && (
        <div style={{ fontSize: 12, color: '#666', marginTop: 8, fontStyle: 'italic' }}>
          Nota: {d.reviewer_notes}
        </div>
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

function getScoreColor(score) {
  if (score <= 3) return '#27ae60';
  if (score <= 6) return '#f39c12';
  if (score <= 8) return '#e67e22';
  return '#e74c3c';
}

function formatTime(sec) {
  if (!sec && sec !== 0) return '-';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default VideoReview;
