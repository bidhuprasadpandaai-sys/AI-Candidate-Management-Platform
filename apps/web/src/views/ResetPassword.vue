<template>
  <section class="auth-page">
    <div class="orb orb-left"></div>
    <div class="orb orb-right"></div>

    <div class="auth-shell">
      <header class="auth-header">
        <span class="brand">NEXORA</span>
      </header>

      <main class="auth-card">
        <div class="icon-wrap" aria-hidden="true">
          <i class="pi" :class="token ? 'pi-lock' : 'pi-send'"></i>
        </div>

        <h1>{{ token ? 'Choose a new password' : 'Reset your password' }}</h1>
        <p class="subtitle">
          {{ token ? 'Enter your new password to finish account recovery.' : 'Enter your email and we will send a reset link.' }}
        </p>

        <form class="auth-form" @submit.prevent="reset">
          <template v-if="!token">
            <label for="email">Email</label>
            <span class="input-wrap">
              <i class="pi pi-envelope" aria-hidden="true" />
              <InputText id="email" v-model="form.email" type="email" placeholder="you@example.com" />
            </span>
          </template>

          <template v-else>
            <label for="newPassword">New password</label>
            <span class="input-wrap">
              <i class="pi pi-lock" aria-hidden="true" />
              <Password id="newPassword" v-model="form.newPassword" :feedback="false" toggleMask placeholder="Create your new password" />
            </span>
            <small class="helper-text">Use at least 8 characters with one uppercase letter and one number.</small>
          </template>

          <Button type="submit" class="cta" :loading="loading">
            {{ token ? 'Reset password' : 'Send reset link' }}
          </Button>

          <Message v-if="error" severity="error">{{ error }}</Message>
          <Message v-if="success" severity="success">{{ success }}</Message>

          <p class="switch-text">
            Back to
            <router-link class="inline-link" to="/signin">Sign in</router-link>
          </p>
        </form>
      </main>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import InputText from 'primevue/inputtext';
import Button from 'primevue/button';
import Message from 'primevue/message';
import Password from 'primevue/password';
import api from '../services/api';

const route = useRoute();
const loading = ref(false);
const error = ref(null);
const success = ref(null);
const token = computed(() => String(route.query.token || ''));

const form = ref({
  email: '',
  newPassword: ''
});

async function reset() {
  const email = form.value.email.trim().toLowerCase();
  const newPassword = form.value.newPassword;

  if (!token.value && !email) {
    error.value = 'Email is required.';
    return;
  }
  if (token.value && !newPassword) {
    error.value = 'New password is required.';
    return;
  }
  if (token.value && !/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(newPassword)) {
    error.value = 'Password must be at least 8 characters with an uppercase letter and a number.';
    return;
  }

  loading.value = true;
  error.value = null;
  success.value = null;
  try {
    if (token.value) {
      await api.post('/auth/reset', {
        token: token.value,
        newPassword
      }, { withCredentials: true });
      success.value = 'Password reset successful. You can sign in now.';
      form.value.newPassword = '';
    } else {
      await api.post('/auth/request-reset', { email }, { withCredentials: true });
      success.value = 'Reset link sent. Check your email (or API logs in local development).';
    }
  } catch (e) {
    error.value = e.response?.data?.error || e.message;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.auth-page {
  --accent: #0f766e;
  --accent-strong: #115e59;
  --bg: linear-gradient(165deg, #f0fdfa 0%, #f8fafc 45%, #ecfeff 100%);
  min-height: 100vh;
  position: relative;
  overflow: hidden;
  background: var(--bg);
  padding: 2rem 1rem;
}

.orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(12px);
  opacity: 0.35;
}

.orb-left {
  width: 260px;
  height: 260px;
  left: -90px;
  top: -90px;
  background: #5eead4;
}

.orb-right {
  width: 320px;
  height: 320px;
  right: -130px;
  bottom: -120px;
  background: #a5f3fc;
}

.auth-shell {
  max-width: 460px;
  margin: 0 auto;
  position: relative;
  z-index: 2;
}

.auth-header {
  margin-bottom: 1rem;
}

.brand {
  letter-spacing: 0.08em;
  font-size: 1.15rem;
  font-weight: 800;
  color: #0f172a;
}

.auth-card {
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 18px;
  padding: 1.5rem;
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(8px);
  box-shadow: 0 20px 40px -30px rgba(15, 23, 42, 0.45);
}

.icon-wrap {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: rgba(15, 118, 110, 0.14);
  color: var(--accent);
  margin-bottom: 0.9rem;
}

.icon-wrap i {
  font-size: 1.25rem;
}

.auth-card h1 {
  margin: 0;
  font-size: 1.8rem;
  color: #0f172a;
}

.subtitle {
  margin: 0.5rem 0 1.25rem;
  color: #475569;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

label {
  font-size: 0.9rem;
  color: #0f172a;
  font-weight: 600;
}

.input-wrap {
  display: block;
  position: relative;
}

.input-wrap > i {
  position: absolute;
  top: 50%;
  left: 0.85rem;
  transform: translateY(-50%);
  color: #64748b;
  z-index: 2;
}

:deep(.p-inputtext),
:deep(.p-password-input) {
  width: 100%;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  padding: 0.72rem 0.9rem 0.72rem 2.5rem;
  box-shadow: none;
}

:deep(.p-inputtext:enabled:focus),
:deep(.p-password-input:enabled:focus) {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.15);
}

:deep(.p-password) {
  width: 100%;
}

.helper-text {
  color: #64748b;
  margin-top: -0.25rem;
}

.cta {
  margin-top: 0.3rem;
  background: var(--accent) !important;
  border-color: var(--accent) !important;
}

.cta:hover {
  background: var(--accent-strong) !important;
  border-color: var(--accent-strong) !important;
}

.switch-text {
  text-align: center;
  margin: 0.7rem 0 0;
  color: #64748b;
  font-size: 0.92rem;
}

.inline-link {
  color: var(--accent);
  text-decoration: none;
  font-weight: 600;
}

.inline-link:hover {
  text-decoration: underline;
}

@media (max-width: 640px) {
  .auth-card {
    border-radius: 14px;
    padding: 1.2rem;
  }

  .auth-card h1 {
    font-size: 1.55rem;
  }
}
</style>
