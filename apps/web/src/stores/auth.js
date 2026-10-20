import { defineStore } from 'pinia';
import {
  ROLE_LABELS,
  can,
  canAnnotateCandidate,
  canAssignCandidate,
  canDeleteCandidate,
  canEditCandidate,
  effectiveRole
} from '@acmp/shared';
import api from '../services/api';

// The UI only hides or disables things based on these rules; the API enforces them.
export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null,
    loading: false,
    error: null
  }),
  getters: {
    accessRole: (state) => (state.user ? effectiveRole(state.user) : null),
    accessRoleLabel() {
      return this.accessRole ? ROLE_LABELS[this.accessRole] : '';
    },
    isAdmin() {
      return this.accessRole === 'admin';
    }
  },
  actions: {
    can(permission) {
      return can(this.user, permission);
    },
    canEdit(candidate) {
      return canEditCandidate(this.user, candidate);
    },
    canAnnotate(candidate) {
      return canAnnotateCandidate(this.user, candidate);
    },
    canDelete(candidate) {
      return canDeleteCandidate(this.user, candidate);
    },
    canAssign(candidate) {
      return canAssignCandidate(this.user, candidate);
    },
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
