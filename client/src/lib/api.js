import axios from 'axios';

/**
 * The access token lives in memory only — never in localStorage, so an XSS payload
 * cannot read it. Durability comes from the httpOnly refresh cookie, which the
 * interceptor below exchanges for a fresh access token when one expires.
 */
let accessToken = null;
let onSessionLost = () => {};

export const setAccessToken = (token) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;
export const setSessionLostHandler = (fn) => {
  onSessionLost = fn;
};

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 20000,
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Concurrent 401s share a single refresh call instead of stampeding the endpoint.
let refreshPromise = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    const isAuthCall = config?.url?.includes('/auth/login') || config?.url?.includes('/auth/refresh');

    if (response?.status === 401 && !config._retried && !isAuthCall) {
      config._retried = true;
      try {
        refreshPromise = refreshPromise || api.post('/auth/refresh');
        const { data } = await refreshPromise;
        refreshPromise = null;
        setAccessToken(data.data.accessToken);
        config.headers.Authorization = `Bearer ${data.data.accessToken}`;
        return api(config);
      } catch (refreshError) {
        refreshPromise = null;
        setAccessToken(null);
        onSessionLost();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

/** Normalises an axios failure into a message the UI can show directly. */
export function errorMessage(error, fallback = 'Something went wrong') {
  const data = error?.response?.data;
  if (!data) return error?.message || fallback;
  if (Array.isArray(data.details) && data.details.length) {
    return data.details.map((d) => `${d.field}: ${d.message}`).join(', ');
  }
  return data.message || fallback;
}

/** Triggers a browser download for an endpoint that returns CSV. */
export async function downloadCsv(url, filename) {
  const response = await api.get(url, { responseType: 'blob' });
  const href = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

export default api;
