<template>
  <section class="auth-page">
    <div class="orb orb-left"></div>
    <div class="orb orb-right"></div>

    <div class="auth-shell">
      <header class="auth-header">
        <span class="brand">NEXORA</span>
      </header>

      <main class="auth-card">
        <h1>Welcome back</h1>
        <p class="subtitle">Sign in to continue managing your hiring pipeline.</p>

        <form class="auth-form" @submit.prevent="signin">
          <label for="email">Email</label>
          <span class="input-wrap">
            <i class="pi pi-envelope" aria-hidden="true" />
            <InputText id="email" v-model="form.email" type="email" placeholder="you@example.com" />
          </span>

          <label for="password">Password</label>
          <span class="input-wrap password-wrap">
            <i class="pi pi-lock" aria-hidden="true" />
            <Password id="password" v-model="form.password" :feedback="false" toggleMask placeholder="Enter your password" />
          </span>

          <div class="form-row">
            <label class="remember-label" for="remember">
              <Checkbox id="remember" v-model="rememberMe" :binary="true" inputId="remember" />
              <span>Remember me</span>
            </label>
            <router-link class="inline-link" to="/resetpassword">Forgot password?</router-link>
          </div>

          <Button type="submit" class="cta" :loading="loading">Sign in</Button>

          <Message v-if="error" severity="error">{{ error }}</Message>
          <Message v-if="success" severity="success">{{ success }}</Message>

          <p class="switch-text">
            Don&apos;t have an account?
            <router-link class="inline-link" to="/signup">Create one</router-link>
          </p>
        </form>
      </main>
    </div>
  </section>
</template>

<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Message from 'primevue/message';
import api from '../services/api';

const router = useRouter();
const route = useRoute();
const loading = ref(false);
const error = ref(null);
const rememberMe = ref(true);
const success = ref(route.query.signup === 'success' ? 'Account created successfully. Please sign in.' : null);

const form = ref({
  email: '',
  password: ''
});

async function signin() {
  const email = form.value.email.trim().toLowerCase();
  const password = form.value.password;
  if (!email || !password) {
    error.value = 'Email and password are required.';
    return;
  }

  loading.value = true;
  error.value = null;
  try {
    await api.post('/auth/signin', { email, password }, { withCredentials: true });
    router.replace('/');
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
  --bg: linear-gradient(160deg, #ecfeff 0%, #f8fafc 40%, #f0fdfa 100%);
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
  width: 280px;
  height: 280px;
  left: -100px;
  top: -80px;
  background: #99f6e4;
}

.orb-right {
  width: 320px;
  height: 320px;
  right: -120px;
  bottom: -120px;
  background: #67e8f9;
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

.form-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.remember-label {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  font-size: 0.9rem;
  font-weight: 500;
}

.inline-link {
  color: var(--accent);
  text-decoration: none;
  font-weight: 600;
}

.inline-link:hover {
  text-decoration: underline;
}

.cta {
  margin-top: 0.25rem;
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
