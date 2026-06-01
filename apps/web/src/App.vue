<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Message from "primevue/message";
import Button from "primevue/button";
import AppHeader from "./components/AppHeader.vue";
import { microfrontendRegistry } from "./microfrontends/registry";
import { useCandidateStore } from "./stores/candidates";
import { useAuthStore } from "./stores/auth";

const store = useCandidateStore();
const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();

const activeModuleComponent = computed(() => {
  return (
    microfrontendRegistry[store.activeModule] || microfrontendRegistry.overview
  );
});

const isAuthRoute = computed(() => Boolean(route.meta.authLayout));
const isAuthenticated = computed(() => Boolean(authStore.user));
const isAuthResolved = computed(() => !authStore.loading);
const userName = computed(() => authStore.user?.name || "User");
const userRole = computed(() => authStore.user?.role || "Recruiter");
const profileImage = computed(() => authStore.user?.profilePic || authStore.user?.avatarUrl || "");
const userInitials = computed(() => {
  const parts = String(userName.value)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) {
    return "U";
  }
  return parts.map((part) => part[0].toUpperCase()).join("");
});
const profileMenuOpen = ref(false);
const profileMenuRef = ref(null);

async function initializeShell() {
  if (!isAuthRoute.value && isAuthenticated.value) {
    await store.initialize();
  }
}

async function ensureAuth() {
  if (isAuthRoute.value) {
    return;
  }

  await authStore.loadUser();
  if (!authStore.user) {
    await router.replace("/signin");
  }
}

async function logout() {
  await authStore.logout();
  profileMenuOpen.value = false;
  await router.replace("/signin");
}

function toggleProfileMenu() {
  profileMenuOpen.value = !profileMenuOpen.value;
}

function closeProfileMenu() {
  profileMenuOpen.value = false;
}

function openProfileSettings() {
  store.setActiveModule("profile");
  closeProfileMenu();
}

function onDocumentClick(event) {
  if (!profileMenuRef.value) {
    return;
  }
  if (!profileMenuRef.value.contains(event.target)) {
    closeProfileMenu();
  }
}

onMounted(async () => {
  document.addEventListener("click", onDocumentClick);
  await ensureAuth();
  await initializeShell();
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick);
});

watch(
  () => route.fullPath,
  async () => {
    await ensureAuth();
    await initializeShell();
  }
);
</script>

<template>
  <div v-if="!isAuthRoute && !isAuthResolved" class="auth-check-loader">
    <p>Checking session...</p>
  </div>

  <RouterView v-if="isAuthRoute" />

  <div v-else-if="isAuthenticated" class="app-shell shell-layout">
    <aside class="shell-sidebar">
      <div class="sidebar-brand">
        <div class="brand-mark">AI</div>
        <div>
          <p class="eyebrow">Platform shell</p>
          <h2>TalentOS</h2>
        </div>
      </div>

      <nav class="sidebar-nav">
        <button
          v-for="module in store.modules"
          :key="module.id"
          class="sidebar-link"
          :class="{ active: store.activeModule === module.id }"
          @click="store.setActiveModule(module.id)"
        >
          <strong>{{ module.name }}</strong>
          <small>{{ module.description }}</small>
        </button>
      </nav>

      <div class="sidebar-footnote profile-footnote" ref="profileMenuRef">
        <button
          type="button"
          class="profile-trigger"
          @click.stop="toggleProfileMenu"
        >
          <div v-if="profileImage" class="avatar-image-wrap">
            <img :src="profileImage" alt="Profile picture" class="avatar-image" />
          </div>
          <div v-else class="avatar-fallback">{{ userInitials }}</div>
          <div class="profile-copy">
            <strong>{{ userName }}</strong>
            <small>{{ userRole }}</small>
          </div>
          <i class="pi pi-angle-up trigger-chevron" :class="{ open: profileMenuOpen }"></i>
        </button>

        <div v-if="profileMenuOpen" class="profile-menu-card">
          <div class="profile-menu-header">
            <div v-if="profileImage" class="avatar-image-wrap header-avatar">
              <img :src="profileImage" alt="Profile picture" class="avatar-image" />
            </div>
            <div v-else class="avatar-fallback header-avatar">{{ userInitials }}</div>
            <div class="profile-menu-meta">
              <strong>{{ userName }}</strong>
              <p>{{ authStore.user?.email }}</p>
            </div>
          </div>

          <div class="profile-menu-divider"></div>

          <button type="button" class="profile-menu-item" @click="openProfileSettings">
            <i class="pi pi-cog"></i>
            <span>Profile Settings</span>
          </button>

          <button type="button" class="profile-menu-item logout" @click="logout">
            <i class="pi pi-sign-out"></i>
            <span>Logout</span>
          </button>
        </div>
      </div>
    </aside>

    <main class="workspace-pane">
      <AppHeader />

      <Message
        :severity="store.backendReady ? 'success' : 'warn'"
        :closable="false"
      >
        {{ store.backendMessage }}
        {{
          store.usingMemoryStore
            ? " Demo data is enabled until MongoDB is connected."
            : " MongoDB persistence is active."
        }}
      </Message>

      <component :is="activeModuleComponent" />
    </main>
  </div>
</template>

<style scoped>
.auth-check-loader {
  min-height: 100vh;
  display: grid;
  place-items: center;
  color: #475569;
  font-weight: 600;
}

.profile-footnote {
  border-top: 1px solid rgba(226, 232, 240, 0.5);
  padding-top: 14px;
  position: relative;
}

.avatar-image-wrap,
.avatar-fallback {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 999px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.avatar-image-wrap {
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.35);
}

.avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-fallback {
  background: linear-gradient(135deg, #0ea5e9, #14b8a6);
  color: #ffffff;
  font-size: 0.78rem;
  font-weight: 700;
}

.profile-copy {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  text-align: left;
}

.profile-copy strong {
  color: #0f172a;
}

.profile-copy small {
  color: #64748b;
  font-size: 0.74rem;
}

.profile-trigger {
  width: 100%;
  border: 0;
  background: transparent;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.35rem 0.25rem;
  border-radius: 10px;
  cursor: pointer;
}

.profile-trigger:hover {
  background: rgba(226, 232, 240, 0.32);
}

.trigger-chevron {
  margin-left: auto;
  color: #64748b;
  transition: transform 0.2s ease;
}

.trigger-chevron.open {
  transform: rotate(180deg);
}

.profile-menu-card {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 10px);
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 14px;
  box-shadow: 0 18px 34px -20px rgba(15, 23, 42, 0.5);
  padding: 0.9rem;
  z-index: 20;
}

.profile-menu-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.header-avatar {
  width: 2.6rem;
  height: 2.6rem;
}

.profile-menu-meta {
  min-width: 0;
}

.profile-menu-meta strong {
  display: block;
  color: #1e293b;
}

.profile-menu-meta p {
  margin: 0.2rem 0 0;
  color: #ec4899;
  font-weight: 600;
  font-size: 0.86rem;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-menu-divider {
  margin: 0.85rem 0;
  height: 1px;
  background: #f1f5f9;
}

.profile-menu-item {
  width: 100%;
  border: 0;
  background: transparent;
  border-radius: 10px;
  padding: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  color: #334155;
  font-size: 0.98rem;
  cursor: pointer;
}

.profile-menu-item i {
  font-size: 1rem;
}

.profile-menu-item:hover {
  background: #f8fafc;
}

.profile-menu-item.logout {
  margin-top: 0.2rem;
}
</style>
