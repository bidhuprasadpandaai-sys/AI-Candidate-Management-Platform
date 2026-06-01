<script setup>
import { computed, ref, watch } from "vue";
import { useAuthStore } from "../../stores/auth";
import Button from "primevue/button";
import Message from "primevue/message";
import api from "../../services/api";

const authStore = useAuthStore();

const activeTab = ref("profile");
const isEditing = ref(false);
const savingProfile = ref(false);
const changingPassword = ref(false);
const profileError = ref("");
const profileSuccess = ref("");
const passwordError = ref("");
const passwordSuccess = ref("");

const draftProfile = ref({
  firstName: "",
  middleName: "",
  lastName: "",
  role: "",
  phone: "",
  facebook: "",
  twitter: "",
  profilePic: ""
});

const passwordForm = ref({
  currentPassword: "",
  newPassword: "",
  confirmPassword: ""
});

const fullName = computed(() => String(authStore.user?.name || "User"));
const email = computed(() => authStore.user?.email || "-");
const profileImage = computed(() => draftProfile.value.profilePic || authStore.user?.profilePic || "");
const initials = computed(() => {
  const tokens = fullName.value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (!tokens.length) return "U";
  return tokens.map((token) => token[0].toUpperCase()).join("");
});

const createdOn = computed(() => {
  if (!authStore.user?.createdAt) return "2025-04-02 10:30 AM";
  return new Date(authStore.user.createdAt).toLocaleString();
});

const updatedOn = computed(() => {
  if (!authStore.user?.updatedAt) return "2025-04-02 10:30 AM";
  return new Date(authStore.user.updatedAt).toLocaleString();
});

function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    middleName: parts.length > 2 ? parts.slice(1, -1).join(" ") : "",
    lastName: parts.length > 1 ? parts[parts.length - 1] : ""
  };
}

function syncDraftFromUser() {
  const name = splitName(authStore.user?.name || "");
  draftProfile.value = {
    ...draftProfile.value,
    firstName: name.firstName,
    middleName: name.middleName,
    lastName: name.lastName,
    role: authStore.user?.role || "",
    phone: authStore.user?.phone || "",
    facebook: authStore.user?.socialLinks?.facebook || "",
    twitter: authStore.user?.socialLinks?.twitter || "",
    profilePic: authStore.user?.profilePic || ""
  };
}

watch(
  () => authStore.user,
  () => {
    syncDraftFromUser();
  },
  { immediate: true }
);

function buildFullName() {
  return [
    draftProfile.value.firstName,
    draftProfile.value.middleName,
    draftProfile.value.lastName
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
}

function onEditProfile() {
  profileError.value = "";
  profileSuccess.value = "";
  isEditing.value = true;
  syncDraftFromUser();
}

function onCancelEdit() {
  isEditing.value = false;
  profileError.value = "";
  profileSuccess.value = "";
  syncDraftFromUser();
}

async function onProfilePicPicked(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  activeTab.value = "profile";
  isEditing.value = true;
  profileError.value = "";
  profileSuccess.value = "";

  if (!file.type.startsWith("image/")) {
    profileError.value = "Please upload a valid image file.";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    draftProfile.value.profilePic = String(reader.result || "");
  };
  reader.readAsDataURL(file);
}

async function saveProfile() {
  const name = buildFullName();
  if (!name) {
    profileError.value = "First name is required.";
    return;
  }

  profileError.value = "";
  profileSuccess.value = "";
  savingProfile.value = true;

  try {
    await api.put(
      "/auth/profile",
      {
        name,
        role: draftProfile.value.role,
        phone: draftProfile.value.phone,
        profilePic: draftProfile.value.profilePic,
        socialLinks: {
          facebook: draftProfile.value.facebook,
          twitter: draftProfile.value.twitter
        }
      },
      { withCredentials: true }
    );

    await authStore.loadUser();
    profileSuccess.value = "Profile updated successfully.";
    isEditing.value = false;
  } catch (err) {
    profileError.value = err.response?.data?.error || err.message;
  } finally {
    savingProfile.value = false;
  }
}

async function changePassword() {
  passwordError.value = "";
  passwordSuccess.value = "";

  if (!passwordForm.value.currentPassword || !passwordForm.value.newPassword || !passwordForm.value.confirmPassword) {
    passwordError.value = "All password fields are required.";
    return;
  }

  if (!/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(passwordForm.value.newPassword)) {
    passwordError.value = "New password must be at least 8 characters with an uppercase letter and a number.";
    return;
  }

  if (passwordForm.value.newPassword !== passwordForm.value.confirmPassword) {
    passwordError.value = "New password and confirm password do not match.";
    return;
  }

  changingPassword.value = true;

  try {
    await api.post(
      "/auth/change-password",
      {
        currentPassword: passwordForm.value.currentPassword,
        newPassword: passwordForm.value.newPassword
      },
      { withCredentials: true }
    );

    passwordSuccess.value = "Password changed successfully.";
    passwordForm.value = {
      currentPassword: "",
      newPassword: "",
      confirmPassword: ""
    };
  } catch (err) {
    passwordError.value = err.response?.data?.error || err.message;
  } finally {
    changingPassword.value = false;
  }
}
</script>

<template>
  <section class="profile-layout">
    <aside class="profile-sidebar-card">
      <div class="avatar-stack">
        <div v-if="profileImage" class="avatar-wrap">
          <img :src="profileImage" alt="Profile picture" class="avatar" />
        </div>
        <div v-else class="avatar-fallback">{{ initials }}</div>

        <label class="avatar-edit-btn" aria-label="Edit avatar">
          <i class="pi pi-pencil" />
          <input type="file" accept="image/*" class="file-input" @change="onProfilePicPicked" />
        </label>
      </div>

      <h3>{{ fullName }}</h3>
      <p>{{ email }}</p>

      <nav class="profile-tab-list">
        <button type="button" class="tab-item" :class="{ active: activeTab === 'profile' }" @click="activeTab = 'profile'">
          <i class="pi pi-user"></i>
          <span>Profile Information</span>
        </button>
        <button type="button" class="tab-item" :class="{ active: activeTab === 'password' }" @click="activeTab = 'password'">
          <i class="pi pi-lock"></i>
          <span>Change Password</span>
        </button>
      </nav>
    </aside>

    <article v-if="activeTab === 'profile'" class="profile-main-card">
      <header class="profile-main-header">
        <div>
          <h2>Profile Information</h2>
          <p>View and update your personal information.</p>
        </div>

        <div class="action-row">
          <Button v-if="!isEditing" label="Edit Profile" icon="pi pi-pencil" class="edit-btn" @click="onEditProfile" />
          <template v-else>
            <Button label="Cancel" severity="secondary" outlined @click="onCancelEdit" />
            <Button label="Save" icon="pi pi-check" class="edit-btn" :loading="savingProfile" @click="saveProfile" />
          </template>
        </div>
      </header>

      <Message v-if="profileError" severity="error" class="status-msg">{{ profileError }}</Message>
      <Message v-if="profileSuccess" severity="success" class="status-msg">{{ profileSuccess }}</Message>

      <div class="section-divider"></div>

      <section class="detail-block">
        <h4>PERSONAL DETAILS</h4>
        <div class="grid-3">
          <label>
            <span>First Name</span>
            <input v-model="draftProfile.firstName" type="text" :disabled="!isEditing" />
          </label>
          <label>
            <span>Middle Name</span>
            <input v-model="draftProfile.middleName" type="text" :disabled="!isEditing" />
          </label>
          <label>
            <span>Last Name</span>
            <input v-model="draftProfile.lastName" type="text" :disabled="!isEditing" />
          </label>
        </div>
      </section>

      <section class="detail-block">
        <h4>CONTACT DETAILS</h4>
        <div class="grid-2">
          <label>
            <span>Email</span>
            <input :value="email" type="text" disabled />
          </label>
          <label>
            <span>Contact Number</span>
            <input v-model="draftProfile.phone" type="text" :disabled="!isEditing" />
          </label>
        </div>
      </section>

      <section class="detail-block">
        <h4>SOCIAL MEDIA LINKS</h4>
        <div class="grid-2">
          <label>
            <span>Facebook</span>
            <div class="icon-input">
              <i class="pi pi-facebook"></i>
              <input v-model="draftProfile.facebook" type="text" :disabled="!isEditing" />
            </div>
          </label>
          <label>
            <span>X (Twitter)</span>
            <div class="icon-input">
              <i class="pi pi-times"></i>
              <input v-model="draftProfile.twitter" type="text" :disabled="!isEditing" />
            </div>
          </label>
        </div>
      </section>

      <section class="detail-block">
        <h4>ACCOUNT DETAILS</h4>
        <div class="grid-2">
          <label>
            <span>Account Created On</span>
            <input :value="createdOn" type="text" disabled />
          </label>
          <label>
            <span>Last Updated On</span>
            <input :value="updatedOn" type="text" disabled />
          </label>
        </div>
      </section>
    </article>

    <article v-else class="profile-main-card">
      <header class="profile-main-header">
        <div>
          <h2>Change Password</h2>
          <p>Keep your account secure by updating your password regularly.</p>
        </div>
      </header>

      <Message v-if="passwordError" severity="error" class="status-msg">{{ passwordError }}</Message>
      <Message v-if="passwordSuccess" severity="success" class="status-msg">{{ passwordSuccess }}</Message>

      <div class="section-divider"></div>

      <section class="detail-block password-block">
        <label>
          <span>Current Password</span>
          <input v-model="passwordForm.currentPassword" type="password" />
        </label>
        <label>
          <span>New Password</span>
          <input v-model="passwordForm.newPassword" type="password" />
        </label>
        <label>
          <span>Confirm New Password</span>
          <input v-model="passwordForm.confirmPassword" type="password" />
        </label>

        <Button
          label="Update Password"
          icon="pi pi-check"
          class="edit-btn update-password-btn"
          :loading="changingPassword"
          @click="changePassword"
        />
      </section>
    </article>
  </section>
</template>

<style scoped>
.profile-layout {
  display: grid;
  grid-template-columns: 290px minmax(0, 1fr);
  gap: 1.2rem;
}

.profile-sidebar-card,
.profile-main-card {
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 16px;
  box-shadow: 0 20px 35px -28px rgba(15, 23, 42, 0.35);
}

.profile-sidebar-card {
  padding: 1.1rem;
}

.avatar-stack {
  position: relative;
  width: 130px;
  margin: 0.65rem auto 1rem;
}

.avatar-wrap,
.avatar-fallback {
  width: 130px;
  height: 130px;
  border-radius: 999px;
  overflow: hidden;
  display: grid;
  place-items: center;
}

.avatar-wrap {
  border: 1px solid rgba(148, 163, 184, 0.3);
}

.avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-fallback {
  background: linear-gradient(140deg, #0ea5e9, #4f46e5);
  color: #fff;
  font-size: 2rem;
  font-weight: 700;
}

.avatar-edit-btn {
  position: absolute;
  right: 6px;
  bottom: 6px;
  border: 0;
  width: 2rem;
  height: 2rem;
  border-radius: 999px;
  background: #ffffff;
  box-shadow: 0 8px 20px -12px rgba(15, 23, 42, 0.7);
  color: #4f46e5;
  display: grid;
  place-items: center;
  cursor: pointer;
}

.file-input {
  display: none;
}

.profile-sidebar-card h3 {
  margin: 0;
  text-align: center;
  color: #1e3a8a;
  font-size: 1.7rem;
}

.profile-sidebar-card p {
  margin: 0.35rem 0 1rem;
  text-align: center;
  color: #ec4899;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.profile-tab-list {
  display: grid;
  gap: 0.55rem;
}

.tab-item {
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #334155;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.8rem 0.9rem;
  font-size: 1.05rem;
  cursor: pointer;
}

.tab-item.active {
  background: #eef2ff;
  color: #4338ca;
  font-weight: 600;
}

.profile-main-card {
  padding: 1.25rem;
}

.profile-main-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.profile-main-header h2 {
  margin: 0;
  color: #1e3a8a;
}

.profile-main-header p {
  margin: 0.35rem 0 0;
  color: #64748b;
}

.action-row {
  display: flex;
  gap: 0.5rem;
}

.edit-btn {
  background: linear-gradient(135deg, #4f46e5, #4338ca) !important;
  border: 0 !important;
}

.status-msg {
  margin-top: 0.9rem;
}

.section-divider {
  height: 1px;
  background: #e2e8f0;
  margin: 1rem 0 1.1rem;
}

.detail-block {
  margin-bottom: 1.35rem;
}

.detail-block h4 {
  margin: 0 0 0.75rem;
  color: #1e3a8a;
  letter-spacing: 0.01em;
}

.grid-3,
.grid-2 {
  display: grid;
  gap: 0.8rem;
}

.grid-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.grid-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

label {
  display: block;
}

label span {
  display: block;
  color: #64748b;
  font-weight: 600;
  margin-bottom: 0.45rem;
}

input {
  width: 100%;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  border-radius: 10px;
  padding: 0.78rem 0.78rem;
  color: #334155;
}

input:disabled {
  opacity: 1;
}

.icon-input {
  position: relative;
}

.icon-input > i {
  position: absolute;
  left: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  color: #1d4ed8;
}

.icon-input input {
  padding-left: 2.4rem;
}

.password-block {
  max-width: 540px;
  display: grid;
  gap: 0.85rem;
}

.update-password-btn {
  width: fit-content;
  margin-top: 0.35rem;
}

@media (max-width: 1120px) {
  .profile-layout {
    grid-template-columns: 1fr;
  }

  .profile-sidebar-card {
    max-width: 360px;
  }
}

@media (max-width: 800px) {
  .grid-3,
  .grid-2 {
    grid-template-columns: 1fr;
  }

  .profile-main-header {
    flex-direction: column;
  }

  .action-row {
    width: 100%;
  }
}
</style>
