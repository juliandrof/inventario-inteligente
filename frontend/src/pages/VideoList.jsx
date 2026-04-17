import React, { useState, useEffect } from 'react';
import { fetchVideos, deleteVideo, reprocessVideo, fetchVideoFixtures, fetchFilters } from '../api';
import { StatusBadge, TYPE_COLORS } from './Dashboard';

function VideoList({ navigate, pageParams }) {
  const [videos, setVideos] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ ufs: [], stores: [] });
  const [selUF, setSelUF] = useState(pageParams?.uf || '');
  const [selStore, setSelStore] = useState(pageParams?.store_id || '');
  const [selStatus, setSelStatus] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [fixtures, setFixtures] = useState(null);

  useEffect(() => { fetchFilters().then(setFilters).catch(() => {}); }, []);

  useEffect(() => {
    const f = {};
    if (selUF) f.uf = selUF;
    if (selStore) f.store_id = selStore;
    if (selStatus) f.status = selStatus;
    fetchVideos(f).then(d => { setVideos(d.videos || []); setTotal(d.total || 0); }).catch(() => {});
  }, [selUF, selStore, selStatus]);

  useEffect(() => {
    if (!expanded) { setFixtures(null); return; }
    fetchVideoFixtures(expanded).then(setFixtures).catch(() => {});
  }, [expanded]);

  async function handleDelete(id) {
    if (!confirm('Excluir este video e todos os dados associados?')) return;
    await deleteVideo(id);
    setVideos(v => v.filter(x => x.video_id !== id));
  }

  async function handleReprocess(id) {
    await reprocessVideo(id);
    setVideos(v => v.map(x => x.video_id === id ? { ...x, status: 'PROCESSING', progress_pct: 0 } : x));
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Videos ({total})</h1>
        <div style={{ display: 'flex', gap: 12 }}>
          <select className="filter-select" value={selUF} onChange={e => { setSelUF(e.target.value); setSelStore(''); }}>
            <option value="">Todas UFs</option>
            {filters.ufs.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <select className="filter-select" value={selStore} onChange={e => setSelStore(e.target.value)}>
            <option value="">Todas Lojas</option>
            {filters.stores.filter(s => !selUF || s.uf === selUF).map(s => (
              <option key={s.store_id} value={s.store_id}>{s.store_id}</option>
            ))}
          </select>
          <select className="filter-select" value={selStatus} onChange={e => setSelStatus(e.target.value)}>
            <option value="">Todos Status</option>
            <option value="COMPLETED">Concluido</option>
            <option value="PROCESSING">Processando</option>
            <option value="PENDING">Pendente</option>
            <option value="FAILED">Erro</option>
          </select>
        </div>
      </div>

      <div className="card">
        <table className="data-table">
          <thead>
            <tr><th>Arquivo</th><th>UF</th><th>Loja</th><th>Data Video</th><th>Duracao</th><th>Status</th><th>Expositores</th><th>Acoes</th></tr>
          </thead>
          <tbody>
            {videos.map(v => (
              <React.Fragment key={v.video_id}>
                <tr className="clickable" onClick={() => setExpanded(expanded === v.video_id ? null : v.video_id)}>
                  <td className="filename">{v.filename}</td>
                  <td><span className="uf-badge">{v.uf}</span></td>
                  <td>{v.store_id}</td>
                  <td>{v.video_date}</td>
                  <td>{v.duration_seconds ? `${Math.round(v.duration_seconds)}s` : '-'}</td>
                  <td><StatusBadge status={v.status} pct={v.progress_pct} /></td>
                  <td><strong>{v.fixture_count || 0}</strong></td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {v.status === 'COMPLETED' && (
                        <button className="btn btn-sm" onClick={() => handleReprocess(v.video_id)}>Reprocessar</button>
                      )}
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(v.video_id)}>Excluir</button>
                    </div>
                  </td>
                </tr>
                {expanded === v.video_id && fixtures && (
                  <tr>
                    <td colSpan={8}>
                      <div className="expanded-fixtures">
                        <h4>Expositores Detectados</h4>
                        {fixtures.summary?.length > 0 ? (
                          <div className="fixture-summary-grid">
                            {fixtures.summary.map(s => (
                              <div key={s.fixture_type} className="fixture-summary-card">
                                <div className="fixture-type-dot" style={{ background: TYPE_COLORS[s.fixture_type] || '#666' }} />
                                <div>
                                  <strong>{s.fixture_type}</strong>
                                  <div>{s.total_count} unidades</div>
                                  <div className="fixture-occ">
                                    Ocupacao: {Math.round(s.avg_occupancy_pct || 0)}%
                                    <small> (V:{s.empty_count} P:{s.partial_count} C:{s.full_count})</small>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="empty-state">Nenhum expositor detectado</div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        {videos.length === 0 && <div className="empty-state">Nenhum video encontrado</div>}
      </div>
    </div>
  );
}

export default VideoList;
