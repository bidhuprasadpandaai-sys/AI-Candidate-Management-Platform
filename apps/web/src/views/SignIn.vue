<template>
  <section class="auth-page">
    <div class="orb orb-left"></div>
    <div class="orb orb-right"></div>

    <div class="auth-shell">
      <header class="auth-header">
        <span class="brand-mark-sm" aria-hidden="true">{{ platformName[0] }}</span>
        <span class="brand">{{ platformName }}</span>
      </header>

      <main class="auth-card">
        <h1>Welcome back</h1>
        <p class="subtitle">Sign in to continue managing your hiring pipeline.</p>

        <div class="mode-tabs" role="tablist" aria-label="Sign-in method">
          <button type="button" role="tab" :aria-selected="mode === 'password'" :class="{ active: mode === 'password' }" @click="setMode('password')">Password</button>
          <button type="button" role="tab" :aria-selected="mode === 'otp'" :class="{ active: mode === 'otp' }" @click="setMode('otp')">Email code</button>
        </div>

        <form v-if="mode === 'password'" class="auth-form" @submit.prevent="signin">
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

        <form v-else class="auth-form" @submit.prevent="otpSent ? verifyOtp() : requestOtp()">
          <label for="otp-email">Email</label>
          <span class="input-wrap">
            <i class="pi pi-envelope" aria-hidden="true" />
            <InputText id="otp-email" v-model="otpForm.email" type="email" placeholder="you@example.com" :disabled="otpSent" />
          </span>

          <template v-if="otpSent">
            <label for="otp-code">6-digit code</label>
            <span class="input-wrap">
              <i class="pi pi-key" aria-hidden="true" />
              <InputText
                id="otp-code"
                v-model="otpForm.code"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
                placeholder="123456"
              />
            </span>
            <p class="hint">We emailed a code to {{ otpForm.email }}. It expires in 10 minutes.</p>
          </template>

          <Button type="submit" class="cta" :loading="loading">{{ otpSent ? 'Verify and sign in' : 'Send code' }}</Button>

          <div v-if="otpSent" class="form-row">
            <button type="button" class="link-button" :disabled="resendIn > 0 || loading" @click="requestOtp">
              {{ resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code' }}
            </button>
            <button type="button" class="link-button" @click="resetOtp">Use a different email</button>
          </div>

          <Message v-if="error" severity="error">{{ error }}</Message>
          <Message v-if="success" severity="success">{{ success }}</Message>
        </form>
      </main>
    </div>
  </section>
</template>

<script setup>
import { PLATFORM } from "../config/brand";

const platformName = PLATFORM.name;
import { onBeforeUnmount, ref } from 'vue';
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
const success = ref(route.query.signup === 'success' ? 'Account created. Please sign in. New accounts start with read-only access until an admin changes your role.' : null);

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

// ── Email code (OTP) sign-in ──────────────────────────────────────────────────
const mode = ref('password');
const otpForm = ref({ email: '', code: '' });
const otpSent = ref(false);
const resendIn = ref(0);
let resendTimer = null;

function setMode(next) {
  mode.value = next;
  error.value = null;
  success.value = null;
}

function startResendTimer(seconds = 60) {
  resendIn.value = seconds;
  clearInterval(resendTimer);
  resendTimer = setInterval(() => {
    resendIn.value -= 1;
    if (resendIn.value <= 0) clearInterval(resendTimer);
  }, 1000);
}

function resetOtp() {
  otpSent.value = false;
  otpForm.value = { email: otpForm.value.email, code: '' };
  error.value = null;
  success.value = null;
  clearInterval(resendTimer);
  resendIn.value = 0;
}

async function requestOtp() {
  const email = otpForm.value.email.trim().toLowerCase();
  if (!email) {
    error.value = 'Email is required.';
    return;
  }

  loading.value = true;
  error.value = null;
  success.value = null;
  try {
    await api.post('/auth/otp/request', { email }, { withCredentials: true });
    otpForm.value.email = email;
    otpSent.value = true;
    success.value = 'If that email has an account, a sign-in code is on its way.';
    startResendTimer();
  } catch (e) {
    error.value = e.response?.data?.error || e.message;
  } finally {
    loading.value = false;
  }
}

async function verifyOtp() {
  const code = otpForm.value.code.trim();
  if (!/^\d{6}$/.test(code)) {
    error.value = 'Enter the 6-digit code from your email.';
    return;
  }

  loading.value = true;
  error.value = null;
  success.value = null;
  try {
    await api.post('/auth/otp/verify', { email: otpForm.value.email, code }, { withCredentials: true });
    router.replace('/');
  } catch (e) {
    error.value = e.response?.data?.error || e.message;
  } finally {
    loading.value = false;
  }
}

onBeforeUnmount(() => clearInterval(resendTimer));
</script>

<style scoped>
.auth-page {
  --accent: var(--primary-600);
  --accent-strong: var(--primary-700);
  --bg: radial-gradient(1200px 600px at 10% -10%, var(--primary-100) 0%, transparent 60%), radial-gradient(900px 500px at 100% 110%, var(--accent-soft) 0%, transparent 60%), var(--surface-page);
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
  background: var(--primary-200);
}

.orb-right {
  width: 320px;
  height: 320px;
  right: -120px;
  bottom: -120px;
  background: var(--accent-soft);
}

.auth-shell {
  max-width: 460px;
  margin: 0 auto;
  position: relative;
  z-index: 2;
}

.auth-header {
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.brand-mark-sm {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: var(--brand-gradient);
  color: var(--primary-color-text);
  font-weight: 800;
}

.brand {
  letter-spacing: 0.08em;
  font-size: 1.15rem;
  font-weight: 800;
  color: #0f172a;
}

.auth-card {
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 16px;
  padding: 1.75rem;
  background: rgba(255, 255, 255, 0.94);
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

.mode-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  margin: 0 0 1rem;
  border-radius: 12px;
  background: #e2e8f0;
}
.mode-tabs button {
  border: 0;
  padding: 0.55rem 0.75rem;
  border-radius: 9px;
  background: transparent;
  color: #475569;
  font-weight: 600;
  cursor: pointer;
}
.mode-tabs button.active {
  background: #ffffff;
  color: var(--accent-strong);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.15);
}
.hint { margin: 0; font-size: 0.85rem; color: #64748b; }
.link-button {
  border: 0;
  background: none;
  padding: 0;
  color: var(--accent-strong);
  font-weight: 600;
  cursor: pointer;
}
.link-button:disabled { color: #94a3b8; cursor: default; }
</style>
