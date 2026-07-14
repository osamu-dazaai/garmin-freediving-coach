import axios from 'axios';
import { useSettingsStore } from '../store/settingsStore';
import { API_TIMEOUT_MS } from '../constants/api';

// Create a fresh axios instance that reads baseUrl dynamically from the store
export function getClient() {
  const { baseUrl, apiKey } = useSettingsStore.getState();
  return axios.create({
    baseURL: baseUrl,
    timeout: API_TIMEOUT_MS,
    headers: apiKey ? { 'X-API-Key': apiKey } : {},
  });
}
