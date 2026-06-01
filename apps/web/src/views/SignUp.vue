<template>
  <section class="auth-page">
    <div class="orb orb-left"></div>
    <div class="orb orb-right"></div>

    <div class="auth-shell">
      <header class="auth-header">
        <span class="brand">NEXORA</span>
        <p class="switch-top">
          Already have an account?
          <router-link class="inline-link" to="/signin">Sign in</router-link>
        </p>
      </header>

      <main class="auth-card">
        <h1>Create your account</h1>
        <p class="subtitle">Set up your recruiter workspace in less than a minute.</p>

        <form class="auth-form" @submit.prevent="signup">
          <label for="name">Full name</label>
          <span class="input-wrap">
            <i class="pi pi-user" aria-hidden="true" />
            <InputText id="name" v-model="form.name" placeholder="Jane Doe" />
          </span>

          <label for="email">Email</label>
          <span class="input-wrap">
            <i class="pi pi-envelope" aria-hidden="true" />
            <InputText id="email" v-model="form.email" type="email" placeholder="you@example.com" />
          </span>

          <div class="split-grid">
            <div>
              <label for="role">Role</label>
              <span class="input-wrap">
                <i class="pi pi-briefcase" aria-hidden="true" />
                <InputText id="role" v-model="form.role" placeholder="Hiring Manager" />
              </span>
            </div>
            <div>
              <label for="phone">Phone</label>
              <span class="input-wrap">
                <i class="pi pi-phone" aria-hidden="true" />
                <InputText id="phone" v-model="form.phone" placeholder="+1 555 0100" />
              </span>
            </div>
          </div>

          <label for="password">Password</label>
          <span class="input-wrap">
            <i class="pi pi-lock" aria-hidden="true" />
            <Password id="password" v-model="form.password" :feedback="false" toggleMask placeholder="Create a strong password" />
          </span>

          <small class="helper-text">Use at least 8 characters with one uppercase letter and one number.</small>

          <label class="terms-label" for="terms">
            <Checkbox id="terms" v-model="terms" :binary="true" inputId="terms" />
            <span>I agree to the Terms and Privacy Policy.</span>
          </label>

          <Button type="submit" class="cta" :loading="loading" :disabled="!terms">Create account</Button>
          <Message v-if="error" severity="error">{{ error }}</Message>
        </form>
      </main>
    </div>
  </section>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Message from 'primevue/message';
import api from '../services/api';

const router = useRouter();
const loading = ref(false);
const error = ref(null);
const terms = ref(false);

const form = ref({
  name: '',
  email: '',
  role: '',
  phone: '',
  password: ''
});

async function signup() {
  if (!terms.value) return;

  const payload = {
    ...form.value,
    name: form.value.name.trim(),
    email: form.value.email.trim().toLowerCase(),
    role: form.value.role.trim(),
    phone: form.value.phone.trim()
  };

  const hasStrongPassword = /^(?=.*[A-Z])(?=.*\d).{8,}$/.test(payload.password);
  if (!payload.name) {
    error.value = 'Full name is required.';
    return;
  }
  if (!payload.email) {
    error.value = 'Email is required.';
    return;
  }
  if (!hasStrongPassword) {
    error.value = 'Password must be at least 8 characters with an uppercase letter and a number.';
    return;
  }

  loading.value = true;
  error.value = null;
  try {
    await api.post('/auth/signup', payload, { withCredentials: true });
    router.push({
      path: '/signin',
      query: { signup: 'success' }
    });
  } catch (err) {
    error.value = err.response?.data?.error || err.message;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.auth-page {
  --accent: #0b7a75;
  --accent-strong: #0f5f5b;
  --bg: linear-gradient(160deg, #f0fdf4 0%, #f8fafc 40%, #ecfeff 100%);
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
  left: -90px;
  top: -90px;
  background: #a7f3d0;
}

.orb-right {
  width: 320px;
  height: 320px;
  right: -120px;
  bottom: -120px;
  background: #67e8f9;
}

.auth-shell {
  max-width: 560px;
  margin: 0 auto;
  position: relative;
  z-index: 2;
}

.auth-header {
  margin-bottom: 1rem;
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: baseline;
}

.brand {
  letter-spacing: 0.08em;
  font-size: 1.15rem;
  font-weight: 800;
  color: #0f172a;
}

.switch-top {
  margin: 0;
  color: #475569;
  font-size: 0.9rem;
}

.inline-link {
  color: var(--accent);
  font-weight: 600;
  text-decoration: none;
}

.inline-link:hover {
  text-decoration: underline;
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
  box-shadow: 0 0 0 3px rgba(11, 122, 117, 0.15);
}

:deep(.p-password) {
  width: 100%;
}

.split-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.8rem;
}

.split-grid > div {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.helper-text {
  color: #64748b;
  margin-top: -0.25rem;
}

.terms-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
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

@media (max-width: 640px) {
  .auth-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .split-grid {
    grid-template-columns: 1fr;
  }

  .auth-card {
    border-radius: 14px;
    padding: 1.2rem;
  }

  .auth-card h1 {
    font-size: 1.55rem;
  }
}
</style>
