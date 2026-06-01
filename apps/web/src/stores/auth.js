import { defineStore } from 'pinia';
import api from '../services/api';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null,
    loading: false,
    error: null
  }),
  actions: {
    async loadUser() {
      this.loading = true;
      try {
        const response = await api.get('/auth/me', { withCredentials: true });
        this.user = response.data.user;
        this.error = null;
      } catch (err) {
        this.user = null;
        this.error = err.response?.data?.error || err.message;
      } finally {
        this.loading = false;
      }
    },
    async logout() {
      this.loading = true;
      try {
        await api.post('/auth/logout', {}, { withCredentials: true });
        this.user = null;
        this.error = null;
      } catch (err) {
        this.error = err.response?.data?.error || err.message;
      } finally {
        this.loading = false;
      }
    }
  }
});
