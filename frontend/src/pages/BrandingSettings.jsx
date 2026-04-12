import React, { useState, useEffect } from 'react';
import { fetchBranding, updateBranding, uploadLogo } from '../api';

const COLOR_SETTINGS = [
  { key: 'primary_color', label: 'Cor Primaria', default: '#2563EB' },
  { key: 'secondary_color', label: 'Cor Secundaria', default: '#1E293B' },
  { key: 'accent_color', label: 'Cor de Destaque', default: '#3B82F6' },
  { key: 'sidebar_color', label: 'Cor da Barra Lateral', default: '#0F172A' },
];

function BrandingSettings() {
  const [colors, setColors] = useState({});
  const [logoFile, setLogoFile] = useState(null);
  const [hasCustomLogo, setHasCustomLogo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    fetchBranding().then(b => {
      const c = {};
      COLOR_SETTINGS.forEach(s => { c[s.key] = b[s.key] || s.default; });
      setColors(c);
      setHasCustomLogo(!!b.logo_path);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleColorChange = (key, value) => {
    setColors({ ...colors, [key]: value });
  };

  const handleSaveColors = async () => {
    setSaving(true);
    for (const [key, value] of Object.entries(colors)) {
      await updateBranding(key, value);
    }
    // Apply to CSS vars immediately
    const root = document.documentElement;
    root.style.setProperty('--dbxsc-primary', colors.primary_color);
    root.style.setProperty('--dbxsc-dark', colors.secondary_color);
    root.style.setProperty('--dbxsc-accent', colors.accent_color);
    root.style.setProperty('--dbxsc-sidebar', colors.sidebar_color);
    setSaving(false);
    showToast('Cores atualizadas com sucesso!');
  };

  const handleLogoUpload = async () => {
    if (!logoFile) return;
    setSaving(true);
    try {
      await uploadLogo(logoFile);
      setHasCustomLogo(true);
      setLogoFile(null);
      showToast('Logo atualizado com sucesso!');
      window.location.reload();
    } catch (e) {
      showToast('Erro ao fazer upload do logo');
    }
    setSaving(false);
  };

  const handleResetDefaults = async () => {
    const defaults = {};
    for (const s of COLOR_SETTINGS) {
      defaults[s.key] = s.default;
      await updateBranding(s.key, s.default);
    }
    setColors(defaults);
    const root = document.documentElement;
    root.style.setProperty('--dbxsc-primary', '#2563EB');
    root.style.setProperty('--dbxsc-dark', '#1E293B');
    root.style.setProperty('--dbxsc-accent', '#3B82F6');
    root.style.setProperty('--dbxsc-sidebar', '#0F172A');
    showToast('Cores restauradas para o padrao!');
  };

  if (loading) return <div className="loading"><div className="spinner"></div>Carregando...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Visual e Marca</h1>
        <p>Personalize o logo e a paleta de cores do aplicativo</p>
      </div>

      <div className="two-cols">
        {/* Logo */}
        <div className="card">
          <div className="card-title">Logo</div>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            {hasCustomLogo ? (
              <img src="/api/branding/logo" alt="Logo atual" style={{ maxHeight: 80, maxWidth: 200, marginBottom: 12 }} />
            ) : (
              <div style={{ padding: 20, background: 'var(--dbxsc-dark)', borderRadius: 12, display: 'inline-block' }}>
                <span style={{ color: 'white', fontSize: 18, fontWeight: 700 }}>DBXSC AI</span>
              </div>
            )}
            <p style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
              {hasCustomLogo ? 'Logo personalizado ativo' : 'Usando logo padrao'}
            </p>
          </div>

          <div className="form-group">
            <label>Fazer upload de novo logo</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              onChange={(e) => setLogoFile(e.target.files[0])}
              style={{ fontSize: 13 }}
            />
            <p style={{ fontSize: 11, color: '#999', marginTop: 4 }}>PNG, JPG ou SVG. Recomendado: fundo transparente, max 200x80px</p>
          </div>

          {logoFile && (
            <button className="btn btn-primary" onClick={handleLogoUpload} disabled={saving}>
              {saving ? 'Enviando...' : 'Atualizar Logo'}
            </button>
          )}
        </div>

        {/* Colors */}
        <div className="card">
          <div className="card-title">Paleta de Cores</div>

          {COLOR_SETTINGS.map(s => (
            <div key={s.key} className="color-picker-row">
              <label>{s.label}</label>
              <input
                type="color"
                value={colors[s.key] || s.default}
                onChange={(e) => handleColorChange(s.key, e.target.value)}
              />
              <span className="color-hex">{colors[s.key] || s.default}</span>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <button className="btn btn-primary" onClick={handleSaveColors} disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar Cores'}
            </button>
            <button className="btn btn-secondary" onClick={handleResetDefaults}>
              Restaurar Padrao
            </button>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="card">
        <div className="card-title">Pre-visualizacao</div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', minHeight: 200 }}>
          <div style={{ width: 200, background: colors.sidebar_color, borderRadius: 12, padding: 20, color: 'white' }}>
            <div style={{ fontWeight: 700, marginBottom: 20 }}>Menu Lateral</div>
            <div style={{ padding: '8px 0', borderLeft: `3px solid ${colors.primary_color}`, paddingLeft: 12, marginBottom: 8 }}>Dashboard</div>
            <div style={{ padding: '8px 0', paddingLeft: 15, opacity: 0.6, marginBottom: 8 }}>Videos</div>
            <div style={{ padding: '8px 0', paddingLeft: 15, opacity: 0.6 }}>Revisao</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <button style={{ padding: '10px 20px', background: colors.primary_color, color: 'white', border: 'none', borderRadius: 8, fontWeight: 500 }}>
                Botao Primario
              </button>
              <button style={{ padding: '10px 20px', background: colors.accent_color, color: 'white', border: 'none', borderRadius: 8, fontWeight: 500 }}>
                Botao Destaque
              </button>
            </div>
            <div style={{ borderTop: `3px solid ${colors.primary_color}`, background: 'white', padding: 16, borderRadius: '0 0 8px 8px' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: colors.secondary_color }}>42</div>
              <div style={{ fontSize: 12, color: '#999' }}>EXEMPLO DE METRICA</div>
            </div>
          </div>
        </div>
      </div>

      {toast && <div className="toast toast-success">{toast}</div>}
    </div>
  );
}

export default BrandingSettings;
