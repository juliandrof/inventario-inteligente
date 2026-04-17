const BASE_URL = '/api';

async function request(url, options = {}) {
  const res = await fetch(`${BASE_URL}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || `HTTP ${res.status}`);
  }
  return res.json();
}

function qs(params) {
  const s = Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return s ? '?' + s : '';
}

// Dashboard
export const fetchDashboardSummary = (f = {}) => request('/dashboard/summary' + qs(f));
export const fetchDashboardByType = (f = {}) => request('/dashboard/by-type' + qs(f));
export const fetchDashboardByUF = () => request('/dashboard/by-uf');
export const fetchDashboardByStore = (f = {}) => request('/dashboard/by-store' + qs(f));
export const fetchOccupancy = (f = {}) => request('/dashboard/occupancy' + qs(f));
export const fetchAnomalies = (f = {}) => request('/dashboard/anomalies' + qs(f));
export const fetchTemporal = (storeId) => request(`/dashboard/temporal?store_id=${storeId}`);
export const fetchRecentVideos = (f = {}) => request('/dashboard/recent' + qs(f));
export const fetchFilters = () => request('/dashboard/filters');

// Videos
export const fetchVideos = (f = {}) => request('/videos' + qs(f));
export const fetchVideo = (id) => request(`/videos/${id}`);
export const fetchVideoFixtures = (id) => request(`/videos/${id}/fixtures`);
export const deleteVideo = (id) => request(`/videos/${id}`, { method: 'DELETE' });
export const reprocessVideo = (id) => request(`/videos/reprocess/${id}`, { method: 'POST' });
export const uploadVideo = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/videos/upload`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};
export const startBatch = (volumePath) => request(`/videos/batch?volume_path=${encodeURIComponent(volumePath)}`, { method: 'POST' });

// Analysis
export const fetchFixtures = (f = {}) => request('/analysis/fixtures' + qs(f));
export const fetchStores = (f = {}) => request('/analysis/stores' + qs(f));
export const fetchStoreDetail = (id) => request(`/analysis/stores/${id}`);
export const fetchFixtureTypes = () => request('/analysis/fixture-types');

// Review
export const fetchReviewVideos = (f = {}) => request('/review/videos' + qs(f));
export const fetchReviewFrames = (videoId) => request(`/review/frames/${videoId}`);

// Reports
export const fetchReportSummary = (f = {}) => request('/reports/summary' + qs(f));
export const fetchComparison = (f = {}) => request('/reports/comparison' + qs(f));

// Config
export const fetchConfigs = () => request('/config');
export const updateConfig = (key, value, description) => request(`/config/${key}`, {
  method: 'PUT', body: JSON.stringify({ value, description }),
});

// Branding
export const fetchBranding = () => request('/branding');
export const updateBranding = (key, value) => request(`/branding/${key}`, {
  method: 'PUT', body: JSON.stringify({ value }),
});
export const uploadLogo = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/branding/logo`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};
