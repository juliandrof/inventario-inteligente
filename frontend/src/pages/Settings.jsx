import React, { useState, useEffect } from 'react';
import { fetchConfigs, updateConfig, fetchBranding, updateBranding, uploadLogo } from '../api';

function Settings() {
  const [configs, setConfigs] = useState([]);
  const [branding, setBranding] = useState({});
  const [editKey, setEditKey] = useState(null);
  const [editVal, setEditVal] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetchConfigs().then(setConfigs).catch(() => {});
    fetchBranding().then(setBranding).catch(() => {});
  }, []);

  async function saveConfig(key) {
    await updateConfig(key, editVal);
    setConfigs(c => c.map(x => x.config_key === key ? { ...x, config_value: editVal } : x));
    setEditKey(null);
    setMsg(`Configuracao "${key}" atualizada!`);
    setTimeout(() => setMsg(''), 3000);
  }

  async function saveBranding(key, val) {
    await updateBranding(key, val);
    setBranding(b => ({ ...b, [key]: val }));
    setMsg('Branding atualizado!');
    setTimeout(() => setMsg(''), 3000);
  }

  async function handleLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadLogo(file);
    setMsg('Logo atualizado!');
    setTimeout(() => setMsg(''), 3000);
  }

  const CONFIG_LABELS = {
    scan_fps: 'Frames/segundo para analise',
    confidence_threshold: 'Confianca minima (0-1)',
    dedup_position_threshold: 'Distancia dedup (%)',
    anomaly_std_threshold: 'Desvios padrao para anomalia',
    timezone: 'Timezone',
  };

  return (
    <div className="page">
      <div className="page-header"><h1>Configuracoes</h1></div>

      {msg && <div className="toast">{msg}</div>}

      <div className="card">
        <h3>Parametros de Analise</h3>
        <table className="data-table">
          <thead><tr><th>Parametro</th><th>Valor</th><th>Descricao</th><th></th></tr></thead>
          <tbody>
            {configs.map(c => (
              <tr key={c.config_key}>
                <td><strong>{CONFIG_LABELS[c.config_key] || c.config_key}</strong></td>
                <td>
                  {editKey === c.config_key ? (
                    <input className="inline-input" value={editVal} onChange={e => setEditVal(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveConfig(c.config_key)} />
                  ) : (
                    <code>{c.config_value}</code>
                  )}
                </td>
                <td className="desc-cell">{c.description || '-'}</td>
                <td>
                  {editKey === c.config_key ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm btn-primary" onClick={() => saveConfig(c.config_key)}>Salvar</button>
                      <button className="btn btn-sm" onClick={() => setEditKey(null)}>Cancelar</button>
                    </div>
                  ) : (
                    <button className="btn btn-sm" onClick={() => { setEditKey(c.config_key); setEditVal(c.config_value); }}>Editar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Branding</h3>
        <div className="branding-grid">
          {['primary_color', 'secondary_color', 'accent_color', 'sidebar_color'].map(key => (
            <div key={key} className="color-picker-row">
              <label>{key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</label>
              <input type="color" value={branding[key] || '#000000'} onChange={e => saveBranding(key, e.target.value)} />
              <code>{branding[key]}</code>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
            Upload Logo <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogo} />
          </label>
        </div>
      </div>
    </div>
  );
}

export default Settings;
