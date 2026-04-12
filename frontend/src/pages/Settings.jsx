import React, { useState, useEffect } from 'react';
import { useI18n } from '../i18n';
import { fetchContexts, createContext, updateContext, deleteContext, fetchBranding, updateBranding, uploadLogo } from '../api';
import { Tooltip } from '../i18n';

const TABS = ['contexts', 'model', 'branding'];

function Settings() {
  const { t } = useI18n();
  const [tab, setTab] = useState('contexts');

  return (
    <div>
      <div className="page-header"><h1>{t('settings.title')}</h1><p>{t('settings.subtitle')}</p></div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid #e0e0e0', paddingBottom: 0 }}>
        {TABS.map(k => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: '10px 20px', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 500,
            borderBottom: tab === k ? '3px solid var(--dbxsc-primary)' : '3px solid transparent',
            color: tab === k ? 'var(--dbxsc-primary)' : '#999', background: 'none', fontFamily: 'inherit',
            transition: 'all 0.2s',
          }}>
            {t(`settings.tab_${k}`)}
          </button>
        ))}
      </div>

      {tab === 'contexts' && <ContextsTab />}
      {tab === 'model' && <ModelTab />}
      {tab === 'branding' && <BrandingTab />}
    </div>
  );
}

// ============================================================
// CONTEXTS TAB
// ============================================================
function ContextsTab() {
  const { t } = useI18n();
  const [contexts, setContexts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(newForm());
  const [toast, setToast] = useState('');

  function newForm() {
    return { name: '', description: '', categories: ['fadiga', 'distracao'], scan_prompt: '', scan_fps: 0.2, detail_fps: 1.0, score_threshold: 4, color: '#2563EB', newCat: '' };
  }
  const load = () => { fetchContexts().then(setContexts).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(load, []);
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const handleEdit = (ctx) => {
    let cats = ctx.categories;
    if (typeof cats === 'string') try { cats = JSON.parse(cats); } catch { cats = []; }
    setEditing(ctx.context_id); setForm({ ...ctx, categories: cats, newCat: '' });
  };
  const handleSave = async () => {
    const data = { name: form.name, description: form.description, categories: form.categories, scan_prompt: form.scan_prompt,
      scan_fps: parseFloat(form.scan_fps), detail_fps: parseFloat(form.detail_fps), score_threshold: parseInt(form.score_threshold), color: form.color || '#2563EB' };
    if (editing === 'new') { await createContext(data); showToast(t('ctx.created')); }
    else { await updateContext(editing, data); showToast(t('ctx.updated')); }
    setEditing(null); load();
  };
  const handleDelete = async (id, name) => {
    if (!confirm(`${t('ctx.confirm_delete')} "${name}"?`)) return;
    await deleteContext(id); showToast(t('ctx.deleted')); load();
  };
  const addCat = () => {
    const c = form.newCat.trim().toLowerCase();
    if (c && !form.categories.includes(c)) setForm({ ...form, categories: [...form.categories, c], newCat: '' });
  };

  if (loading) return <div className="loading"><div className="spinner"></div>{t('common.loading')}</div>;

  if (editing) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18 }}>{editing === 'new' ? t('ctx.new') : `${t('ctx.edit')}: ${form.name}`}</h2>
          <button className="btn btn-secondary" onClick={() => setEditing(null)}>{t('ctx.cancel')}</button>
        </div>
        <div className="card">
          <div className="form-group"><label>{t('ctx.name')}</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={t('ctx.name_placeholder')} /></div>
          <div className="form-group"><label>{t('ctx.description')}</label>
            <input type="text" value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} placeholder={t('ctx.desc_placeholder')} /></div>
          <div className="form-group">
            <label>{t('ctx.color')}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="color" value={form.color || '#2563EB'} onChange={e => setForm({ ...form, color: e.target.value })}
                style={{ width: 48, height: 36, border: '1px solid #ddd', borderRadius: 8, padding: 2, cursor: 'pointer' }} />
              <span style={{ padding: '4px 14px', borderRadius: 12, fontSize: 13, fontWeight: 500, color: 'white', background: form.color || '#2563EB' }}>
                {form.name || 'Preview'}
              </span>
              <span style={{ fontSize: 12, color: '#999', fontFamily: 'monospace' }}>{form.color || '#2563EB'}</span>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-title">{t('ctx.categories_title')}<Tooltip text={t('tip.categories')} /></div>
          <p style={{ fontSize: 13, color: '#999', marginBottom: 12 }}>{t('ctx.categories_info')}</p>
          <div className="category-tags">
            {form.categories.map((cat, i) => (
              <div key={i} className="category-tag"><span style={{ textTransform: 'capitalize' }}>{cat}</span>
                <span className="tag-remove" onClick={() => setForm({ ...form, categories: form.categories.filter(c => c !== cat) })}>x</span></div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input type="text" value={form.newCat} onChange={e => setForm({ ...form, newCat: e.target.value })}
              placeholder={t('ctx.new_category')} onKeyDown={e => e.key === 'Enter' && addCat()}
              style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }} />
            <button className="btn btn-primary btn-sm" onClick={addCat}>{t('ctx.add')}</button>
          </div>
        </div>
        <div className="card">
          <div className="card-title">{t('ctx.prompt_title')}<Tooltip text={t('tip.prompt')} /></div>
          <p style={{ fontSize: 13, color: '#999', marginBottom: 8 }}>{t('ctx.prompt_info')}</p>
          <div className="form-group">
            <textarea value={form.scan_prompt} onChange={e => setForm({ ...form, scan_prompt: e.target.value })}
              style={{ minHeight: 120, fontFamily: 'monospace', fontSize: 13 }} placeholder={t('ctx.prompt_placeholder')} />
          </div>
        </div>
        <div className="card">
          <div className="card-title">{t('ctx.params_title')}</div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ width: 180 }}><label>{t('ctx.fps_scan')}<Tooltip text={t('tip.fps_scan')} /></label>
              <input type="number" step="0.1" min="0.1" max="5" value={form.scan_fps} onChange={e => setForm({ ...form, scan_fps: e.target.value })} /></div>
            <div className="form-group" style={{ width: 180 }}><label>{t('ctx.fps_detail')}<Tooltip text={t('tip.fps_detail')} /></label>
              <input type="number" step="0.1" min="0.1" max="10" value={form.detail_fps} onChange={e => setForm({ ...form, detail_fps: e.target.value })} /></div>
            <div className="form-group" style={{ width: 180 }}><label>{t('ctx.threshold')}<Tooltip text={t('tip.threshold')} /></label>
              <input type="number" min="0" max="10" value={form.score_threshold} onChange={e => setForm({ ...form, score_threshold: e.target.value })} /></div>
          </div>
        </div>
        <button className="btn btn-primary" onClick={handleSave}
          disabled={!form.name.trim() || !form.scan_prompt.trim() || form.categories.length === 0}>
          {editing === 'new' ? t('ctx.create') : t('ctx.save')}
        </button>
        {toast && <div className="toast toast-success">{toast}</div>}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={{ color: '#999', fontSize: 14 }}>{t('ctx.subtitle')}</p>
        <button className="btn btn-primary" onClick={() => { setEditing('new'); setForm(newForm()); }}>{t('ctx.new')}</button>
      </div>
      {contexts.length === 0 ? <div className="empty-state"><h3>{t('ctx.no_contexts')}</h3></div> : (
        <div style={{ display: 'grid', gap: 16 }}>
          {contexts.map(ctx => {
            let cats = ctx.categories;
            if (typeof cats === 'string') try { cats = JSON.parse(cats); } catch { cats = []; }
            return (
              <div key={ctx.context_id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex' }}>
                  <div style={{ width: 6, background: 'var(--dbxsc-primary)', flexShrink: 0 }} />
                  <div style={{ flex: 1, padding: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <h3 style={{ fontSize: 16, marginBottom: 4 }}>{ctx.name}</h3>
                        {ctx.description && <p style={{ fontSize: 13, color: '#999', marginBottom: 8 }}>{ctx.description}</p>}
                        <div className="category-tags" style={{ marginBottom: 8 }}>
                          {cats.map((c, i) => <span key={i} className="category-tag" style={{ fontSize: 12, textTransform: 'capitalize' }}>{c}</span>)}
                        </div>
                        <div style={{ fontSize: 12, color: '#999' }}>FPS: {ctx.scan_fps} | Threshold: {ctx.score_threshold}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => handleEdit(ctx)}>{t('ctx.edit')}</button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleDelete(ctx.context_id, ctx.name)}>{t('ctx.delete')}</button>
                      </div>
                    </div>
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ fontSize: 12, color: '#666', cursor: 'pointer' }}>{t('ctx.view_prompt')}</summary>
                      <pre style={{ fontSize: 11, color: '#555', marginTop: 8, whiteSpace: 'pre-wrap', background: '#f9f9f9', padding: 10, borderRadius: 6 }}>{ctx.scan_prompt}</pre>
                    </details>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {toast && <div className="toast toast-success">{toast}</div>}
    </div>
  );
}

// ============================================================
// MODEL TAB
// ============================================================
function ModelTab() {
  const { t } = useI18n();
  const [model, setModel] = useState('');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(configs => {
      const m = configs.find(c => c.config_key === 'fmapi_model');
      if (m) { setModel(m.config_value); setSaved(m.config_value); }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    await fetch('/api/config/fmapi_model', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: model, description: 'Vision model serving endpoint name' }),
    });
    setSaved(model);
    setToast(t('settings.model_saved'));
    setTimeout(() => setToast(''), 3000);
  };

  if (loading) return <div className="loading"><div className="spinner"></div>{t('common.loading')}</div>;

  return (
    <div>
      <div className="card">
        <div className="card-title">{t('settings.model_title')}<Tooltip text={t('tip.model')} /></div>
        <p style={{ fontSize: 13, color: '#999', marginBottom: 16 }}>{t('settings.model_desc')}</p>

        <div className="form-group">
          <label>{t('settings.model_endpoint')}</label>
          <input type="text" value={model} onChange={e => setModel(e.target.value)}
            placeholder="databricks-llama-4-maverick" style={{ maxWidth: 500 }} />
        </div>

        <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
          <div style={{ fontWeight: 500, marginBottom: 6 }}>{t('settings.model_examples')}</div>
          <div style={{ color: '#666', lineHeight: 1.8 }}>
            <code style={{ background: '#e8e8e8', padding: '2px 6px', borderRadius: 4 }}>databricks-llama-4-maverick</code> — Llama 4 Maverick (vision)<br/>
            <code style={{ background: '#e8e8e8', padding: '2px 6px', borderRadius: 4 }}>databricks-claude-sonnet-4-6</code> — Claude Sonnet 4.6 (vision)<br/>
            <code style={{ background: '#e8e8e8', padding: '2px 6px', borderRadius: 4 }}>databricks-gpt-5-4-mini</code> — GPT 5.4 Mini (vision)<br/>
            <code style={{ background: '#e8e8e8', padding: '2px 6px', borderRadius: 4 }}>databricks-gemini-2-5-flash</code> — Gemini 2.5 Flash (vision)
          </div>
        </div>

        <button className="btn btn-primary" onClick={handleSave} disabled={!model.trim() || model === saved}>
          {t('settings.model_save')}
        </button>
        {saved && <p style={{ fontSize: 12, color: '#999', marginTop: 8 }}>{t('settings.model_current')}: <code>{saved}</code></p>}
      </div>
      {toast && <div className="toast toast-success">{toast}</div>}
    </div>
  );
}

// ============================================================
// BRANDING TAB
// ============================================================
const COLOR_SETTINGS = [
  { key: 'primary_color', labelKey: 'brand.primary', default: '#2563EB' },
  { key: 'secondary_color', labelKey: 'brand.secondary', default: '#1E293B' },
  { key: 'accent_color', labelKey: 'brand.accent', default: '#3B82F6' },
  { key: 'sidebar_color', labelKey: 'brand.sidebar', default: '#0F172A' },
];

function BrandingTab() {
  const { t } = useI18n();
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

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const handleSaveColors = async () => {
    setSaving(true);
    for (const [key, value] of Object.entries(colors)) await updateBranding(key, value);
    const root = document.documentElement;
    root.style.setProperty('--dbxsc-primary', colors.primary_color);
    root.style.setProperty('--dbxsc-dark', colors.secondary_color);
    root.style.setProperty('--dbxsc-accent', colors.accent_color);
    root.style.setProperty('--dbxsc-sidebar', colors.sidebar_color);
    setSaving(false); showToast(t('brand.saved'));
  };

  const handleLogoUpload = async () => {
    if (!logoFile) return;
    setSaving(true);
    try { await uploadLogo(logoFile); setHasCustomLogo(true); setLogoFile(null); showToast(t('brand.logo_saved')); window.location.reload(); }
    catch { showToast('Error'); }
    setSaving(false);
  };

  const handleReset = async () => {
    const defs = {};
    for (const s of COLOR_SETTINGS) { defs[s.key] = s.default; await updateBranding(s.key, s.default); }
    setColors(defs);
    const root = document.documentElement;
    root.style.setProperty('--dbxsc-primary', '#2563EB'); root.style.setProperty('--dbxsc-dark', '#1E293B');
    root.style.setProperty('--dbxsc-accent', '#3B82F6'); root.style.setProperty('--dbxsc-sidebar', '#0F172A');
    showToast(t('brand.restored'));
  };

  if (loading) return <div className="loading"><div className="spinner"></div>{t('common.loading')}</div>;

  return (
    <div>
      <div className="two-cols">
        <div className="card">
          <div className="card-title">{t('brand.logo')}</div>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            {hasCustomLogo ? <img src="/api/branding/logo" alt="Logo" style={{ maxHeight: 80, maxWidth: 200, marginBottom: 12 }} /> : (
              <div style={{ padding: 20, background: 'var(--dbxsc-dark)', borderRadius: 12, display: 'inline-block' }}>
                <span style={{ color: 'white', fontSize: 18, fontWeight: 700 }}>Databricks Scenic Crawler AI</span>
              </div>
            )}
            <p style={{ fontSize: 12, color: '#999', marginTop: 8 }}>{hasCustomLogo ? t('brand.custom_active') : t('brand.default_logo')}</p>
          </div>
          <div className="form-group">
            <label>{t('brand.upload_logo')}</label>
            <input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={e => setLogoFile(e.target.files[0])} style={{ fontSize: 13 }} />
            <p style={{ fontSize: 11, color: '#999', marginTop: 4 }}>{t('brand.logo_hint')}</p>
          </div>
          {logoFile && <button className="btn btn-primary" onClick={handleLogoUpload} disabled={saving}>{t('brand.update_logo')}</button>}
        </div>
        <div className="card">
          <div className="card-title">{t('brand.colors')}</div>
          {COLOR_SETTINGS.map(s => (
            <div key={s.key} className="color-picker-row">
              <label>{t(s.labelKey)}</label>
              <input type="color" value={colors[s.key] || s.default} onChange={e => setColors({ ...colors, [s.key]: e.target.value })} />
              <span className="color-hex">{colors[s.key] || s.default}</span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <button className="btn btn-primary" onClick={handleSaveColors} disabled={saving}>{t('brand.save_colors')}</button>
            <button className="btn btn-secondary" onClick={handleReset}>{t('brand.reset')}</button>
          </div>
        </div>
      </div>
      {toast && <div className="toast toast-success">{toast}</div>}
    </div>
  );
}

export default Settings;
