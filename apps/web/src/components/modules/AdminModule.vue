<script setup>
import { computed, onMounted, ref } from "vue";
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Dialog from "primevue/dialog";
import Dropdown from "primevue/dropdown";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import FacilityFields from "../FacilityFields.vue";
import MultiSelect from "primevue/multiselect";
import Tag from "primevue/tag";
import { CURRENCIES, ROLES, ROLE_LABELS } from "@acmp/shared";
import api from "../../services/api";
import { useAuthStore } from "../../stores/auth";
import { useBrandingStore } from "../../stores/branding";
import { PLATFORM, buildThemeVars, initialsOf } from "../../config/brand";

const auth = useAuthStore();
const branding = useBrandingStore();
const DEFAULT_BRAND_FORM = { displayName: "", tagline: "", website: "", supportEmail: "", phone: "", address: "", primaryColor: PLATFORM.primaryColor, accentColor: PLATFORM.accentColor };

const tab = ref("users");
const users = ref([]);
const companies = ref([]);
const unassignedCandidates = ref(0);
const entries = ref([]);
const error = ref("");
const notice = ref("");
const loading = ref(false);
const hasMoreAudit = ref(false);

const roleOptions = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));
const companyOptions = computed(() => companies.value.map((company) => ({ value: company.id, label: company.name })));

const newCompany = ref({ name: "", description: "" });

const auditFilter = ref({ action: "", actorId: "", companyId: "" });
const actorOptions = computed(() => users.value.map((user) => ({ value: user.id, label: user.name || user.email })));

function fail(e, fallback) {
  error.value = e.response?.data?.error || e.response?.data?.message || fallback || e.message;
  notice.value = "";
}

function done(message) {
  notice.value = message;
  error.value = "";
}

async function loadUsers() {
  const { data } = await api.get("/users");
  users.value = data.users;
}

async function loadCompanies() {
  const { data } = await api.get("/companies");
  companies.value = data.companies;
  unassignedCandidates.value = data.unassignedCandidates || 0;
}

async function loadAudit({ append = false } = {}) {
  const params = { limit: 50 };
  if (auditFilter.value.action.trim()) params.action = auditFilter.value.action.trim();
  if (auditFilter.value.actorId) params.actorId = auditFilter.value.actorId;
  if (auditFilter.value.companyId) params.companyId = auditFilter.value.companyId;
  if (append && entries.value.length) params.before = entries.value[entries.value.length - 1].createdAt;
  const { data } = await api.get("/audit", { params });
  entries.value = append ? [...entries.value, ...data.entries] : data.entries;
  hasMoreAudit.value = data.entries.length === 50;
}

async function refreshAll() {
  loading.value = true;
  try {
    await Promise.all([loadUsers(), loadCompanies(), loadAudit()]);
    error.value = "";
  } catch (e) {
    fail(e, "Unable to load admin data.");
  } finally {
    loading.value = false;
  }
}

async function updateUser(user, changes, label) {
  try {
    const { data } = await api.patch(`/users/${user.id}`, changes);
    Object.assign(user, data.user);
    done(`${label} updated for ${user.name || user.email}.`);
    await Promise.all([loadCompanies(), loadAudit()]);
  } catch (e) {
    fail(e);
    await loadUsers(); // put the table back to the server's truth
  }
}

const changeRole = (user, accessRole) => updateUser(user, { accessRole }, "Role");
const changeCompany = (user, companyId) => updateUser(user, { companyId: companyId || null }, "Company");
const toggleActive = (user) => updateUser(user, { isActive: !user.isActive }, user.isActive ? "Account disabled; it" : "Account enabled; it");

async function createCompany() {
  const name = newCompany.value.name.trim();
  if (!name) {
    error.value = "Company name is required.";
    return;
  }
  try {
    await api.post("/companies", { name, description: newCompany.value.description.trim() });
    newCompany.value = { name: "", description: "" };
    await Promise.all([loadCompanies(), loadAudit()]);
    done(`Company "${name}" created.`);
  } catch (e) {
    fail(e);
  }
}

async function removeCompany(company) {
  if (!confirm(`Delete company "${company.name}"? This only works when it has no users and no candidates.`)) return;
  try {
    await api.delete(`/companies/${company.id}`);
    await Promise.all([loadCompanies(), loadAudit()]);
    done(`Company "${company.name}" deleted.`);
  } catch (e) {
    fail(e);
  }
}

async function adoptUnassigned(company) {
  if (!confirm(`Move all ${unassignedCandidates.value} candidate(s) that have no company into "${company.name}"?`)) return;
  try {
    const { data } = await api.post(`/companies/${company.id}/adopt-unassigned`, {});
    await Promise.all([loadCompanies(), loadAudit()]);
    done(`Moved ${data.moved} candidate(s) into "${company.name}".`);
  } catch (e) {
    fail(e);
  }
}

// Company settings: the currencies its jobs can use and its own list of facilities
const settingsOpen = ref(false);
const settingsCompany = ref(null);
const settingsForm = ref({ currencies: ["USD"], facilities: [] });
const settingsError = ref("");
const savingSettings = ref(false);
const currencyOptions = Object.entries(CURRENCIES).map(([code, name]) => ({ value: code, label: `${code} · ${name}` }));

function openSettings(company) {
  settingsCompany.value = company;
  settingsForm.value = {
    currencies: [...(company.currencies || ["USD"])],
    facilities: (company.facilities || []).map((facility) => ({ ...facility }))
  };
  settingsError.value = "";
  facilitySearch.value = "";
  settingsOpen.value = true;
}

const facilitySearch = ref("");
const blankFacility = () => ({ id: null, name: "", location: "", address: "", pinCode: "" });
const addFacility = () => {
  facilitySearch.value = "";
  settingsForm.value.facilities.push(blankFacility());
};
// Search by name, location, address or pin code. Rows keep their real index so editing and removing stay correct.
const visibleFacilities = computed(() => {
  const q = facilitySearch.value.trim().toLowerCase();
  return settingsForm.value.facilities
    .map((facility, index) => ({ facility, index }))
    .filter(({ facility }) => !q || [facility.name, facility.location, facility.address, facility.pinCode].some((v) => String(v || "").toLowerCase().includes(q)));
});
const locationSuggestions = computed(() => settingsForm.value.facilities.map((facility) => facility.location));
const removeFacility = (index) => settingsForm.value.facilities.splice(index, 1);

async function saveSettings() {
  settingsError.value = "";
  const facilities = settingsForm.value.facilities
    .map((facility) => ({
      ...(facility.id ? { id: facility.id } : {}),
      name: facility.name.trim(),
      location: (facility.location || "").trim(),
      address: (facility.address || "").trim(),
      pinCode: (facility.pinCode || "").trim()
    }))
    .filter((facility) => facility.name);
  if (!settingsForm.value.currencies.length) {
    settingsError.value = "Choose at least one currency.";
    return;
  }
  savingSettings.value = true;
  try {
    await api.patch(`/companies/${settingsCompany.value.id}`, { currencies: settingsForm.value.currencies, facilities });
    settingsOpen.value = false;
    await Promise.all([loadCompanies(), loadAudit()]);
    done(`Settings saved for "${settingsCompany.value.name}".`);
  } catch (e) {
    settingsError.value = e.response?.data?.error || e.response?.data?.message || "The settings could not be saved.";
  } finally {
    savingSettings.value = false;
  }
}

// Company branding (white label): name, details, colours and logo, kept in one place per company
const brandOpen = ref(false);
const brandCompany = ref(null);
const brandForm = ref({});
const brandLogo = ref(null);
const brandError = ref("");
const savingBrand = ref(false);
const brandFields = ["displayName", "tagline", "website", "supportEmail", "phone", "address", "primaryColor", "accentColor"];
const brandPreview = computed(() => buildThemeVars(brandForm.value.primaryColor, brandForm.value.accentColor));

async function openBranding(company) {
  brandCompany.value = company;
  brandError.value = "";
  brandForm.value = { ...DEFAULT_BRAND_FORM, ...(company.branding || {}) };
  brandLogo.value = null;
  brandOpen.value = true;
  try {
    const { data } = await api.get("/branding", { params: { companyId: company.id } });
    brandLogo.value = data.branding.logo;
  } catch (e) {
    brandError.value = "The current logo could not be loaded.";
  }
}

async function uploadLogo(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  brandError.value = "";
  try {
    const { data } = await api.put(`/companies/${brandCompany.value.id}/logo`, file, {
      headers: { "Content-Type": "application/octet-stream" },
      transformRequest: [(body) => body]
    });
    brandLogo.value = data.branding.logo;
    await refreshBrandingIfOwn();
  } catch (e) {
    brandError.value = e.response?.data?.error || "The logo could not be uploaded.";
  }
}

async function removeLogo() {
  brandError.value = "";
  try {
    await api.delete(`/companies/${brandCompany.value.id}/logo`);
    brandLogo.value = null;
    await refreshBrandingIfOwn();
  } catch (e) {
    brandError.value = e.response?.data?.error || "The logo could not be removed.";
  }
}

const refreshBrandingIfOwn = async () => {
  if (brandCompany.value?.id === auth.user?.companyId) await branding.load();
};

async function saveBranding() {
  brandError.value = "";
  savingBrand.value = true;
  try {
    const payload = Object.fromEntries(brandFields.map((key) => [key, String(brandForm.value[key] ?? "").trim()]));
    await api.patch(`/companies/${brandCompany.value.id}`, { branding: payload });
    brandOpen.value = false;
    await Promise.all([loadCompanies(), loadAudit(), refreshBrandingIfOwn()]);
    done(`Branding saved for "${brandCompany.value.name}".`);
  } catch (e) {
    brandError.value = e.response?.data?.error || "The branding could not be saved.";
  } finally {
    savingBrand.value = false;
  }
}

async function applyAuditFilter() {
  try {
    await loadAudit();
    error.value = "";
  } catch (e) {
    fail(e);
  }
}

const formatTime = (iso) => (iso ? new Date(iso).toLocaleString() : "");
const sourceSeverity = { user: "info", ai: "warning", system: "secondary" };

onMounted(refreshAll);
</script>

<template>
  <section class="content-grid admin-module">
    <div class="admin-tabs glassmorphic-inset" role="tablist">
      <button v-for="item in [['users', 'Users', 'pi-users'], ['companies', 'Companies', 'pi-building'], ['audit', 'Audit log', 'pi-history']]"
        :key="item[0]" role="tab" :aria-selected="tab === item[0]" class="admin-tab" :class="{ active: tab === item[0] }" @click="tab = item[0]">
        <i :class="['pi', item[2]]"></i> {{ item[1] }}
      </button>
      <Button label="Refresh" icon="pi pi-refresh" text size="small" :loading="loading" @click="refreshAll" />
    </div>

    <Message v-if="error" severity="error" :closable="true" @close="error = ''">{{ error }}</Message>
    <Message v-if="notice" severity="success" :closable="true" @close="notice = ''">{{ notice }}</Message>

    <!-- Users -->
    <section v-if="tab === 'users'" class="panel-card" aria-label="Users">
      <div class="panel-heading">
        <div>
          <h3>Users, companies and roles</h3>
          <p class="muted">
            Each Recruiter, Hiring manager and Read-only user belongs to one company and only sees that company's candidates.
            Admins manage all companies. New sign-ups start as Read-only with no company until you set both.
          </p>
        </div>
      </div>
      <DataTable :value="users" data-key="id" size="small" responsive-layout="scroll">
        <Column header="User">
          <template #body="{ data }">
            <strong>{{ data.name }}</strong><br />
            <small class="muted">{{ data.email }}</small>
          </template>
        </Column>
        <Column header="Access role">
          <template #body="{ data }">
            <Dropdown
              :model-value="data.accessRole"
              :options="roleOptions"
              option-label="label"
              option-value="value"
              :disabled="data.id === auth.user?.id"
              :aria-label="`Role for ${data.email}`"
              @update:model-value="(role) => changeRole(data, role)"
            />
          </template>
        </Column>
        <Column header="Company">
          <template #body="{ data }">
            <Dropdown
              :model-value="data.companyId"
              :options="companyOptions"
              option-label="label"
              option-value="value"
              show-clear
              :placeholder="data.accessRole === 'admin' ? 'All companies' : 'No company'"
              :aria-label="`Company for ${data.email}`"
              @update:model-value="(id) => changeCompany(data, id)"
            />
          </template>
        </Column>
        <Column header="Status">
          <template #body="{ data }">
            <Tag :value="data.isActive ? 'Active' : 'Disabled'" :severity="data.isActive ? 'success' : 'danger'" />
          </template>
        </Column>
        <Column header="">
          <template #body="{ data }">
            <Button
              v-if="data.id !== auth.user?.id"
              :label="data.isActive ? 'Disable' : 'Enable'"
              size="small"
              text
              :severity="data.isActive ? 'danger' : 'success'"
              @click="toggleActive(data)"
            />
          </template>
        </Column>
      </DataTable>
    </section>

    <!-- Companies -->
    <section v-if="tab === 'companies'" class="panel-card" aria-label="Companies">
      <div class="panel-heading">
        <div>
          <h3>Companies</h3>
          <p class="muted">Each company's candidates, conversations and analytics are private to its users. Assign users on the Users tab.</p>
        </div>
      </div>
      <Message v-if="unassignedCandidates > 0" severity="warn" :closable="false">
        {{ unassignedCandidates }} candidate(s) have no company, so only admins can see them. Use "Move unassigned here" on a company to adopt them.
      </Message>
      <form class="company-form" @submit.prevent="createCompany">
        <InputText v-model="newCompany.name" placeholder="Company name" aria-label="Company name" maxlength="80" />
        <InputText v-model="newCompany.description" placeholder="Description (optional)" aria-label="Company description" maxlength="300" />
        <Button type="submit" label="Create company" icon="pi pi-plus" />
      </form>
      <DataTable :value="companies" data-key="id" size="small" responsive-layout="scroll">
        <Column field="name" header="Company" />
        <Column field="description" header="Description" />
        <Column header="Currencies">
          <template #body="{ data }">{{ (data.currencies || []).join(", ") }}</template>
        </Column>
        <Column header="Facilities">
          <template #body="{ data }">{{ (data.facilities || []).length }}</template>
        </Column>
        <Column field="userCount" header="Users" />
        <Column field="candidateCount" header="Candidates" />
        <Column header="">
          <template #body="{ data }">
            <Button v-if="unassignedCandidates > 0" label="Move unassigned here" size="small" text @click="adoptUnassigned(data)" />
            <Button label="Branding" icon="pi pi-palette" size="small" text @click="openBranding(data)" />
            <Button label="Settings" icon="pi pi-cog" size="small" text @click="openSettings(data)" />
            <Button label="Delete" size="small" text severity="danger" @click="removeCompany(data)" />
          </template>
        </Column>
        <template #empty>No companies yet. Create the first one above.</template>
      </DataTable>
    </section>

    <Dialog v-model:visible="settingsOpen" modal :header="`Settings: ${settingsCompany?.name || ''}`" :style="{ width: '40rem', maxWidth: '96vw' }">
      <div class="settings-form">
        <label>Currencies for this company's jobs
          <MultiSelect
            v-model="settingsForm.currencies"
            :options="currencyOptions"
            option-label="label"
            option-value="value"
            display="chip"
            filter
            placeholder="Choose currencies"
            aria-label="Currencies"
          />
          <small class="muted">Job pay and bill rates can only use these currencies.</small>
        </label>

        <div>
          <strong>Facilities</strong>
          <small class="muted"> Work sites this company hires for. Each company has its own list.</small>
          <span v-if="settingsForm.facilities.length > 3" class="p-input-icon-left facility-search">
            <i class="pi pi-search" aria-hidden="true" />
            <InputText v-model="facilitySearch" placeholder="Search facilities by name, location, address or pin code" aria-label="Search facilities" />
          </span>
          <ul class="facility-list">
            <li v-for="{ facility, index } in visibleFacilities" :key="facility.id || `new-${index}`" class="facility-card">
              <FacilityFields :model-value="facility" :suggestions="locationSuggestions" :id-prefix="`admin-facility-${index}`" />
              <Button icon="pi pi-times" text rounded size="small" severity="secondary" :aria-label="`Remove facility ${index + 1}`" @click="removeFacility(index)" />
            </li>
            <li v-if="!visibleFacilities.length && settingsForm.facilities.length" class="muted">No facility matches your search.</li>
          </ul>
          <Button label="Add facility" icon="pi pi-plus" size="small" outlined @click="addFacility" />
        </div>
        <Message v-if="settingsError" severity="error" :closable="false">{{ settingsError }}</Message>
      </div>
      <template #footer>
        <Button label="Cancel" text severity="secondary" @click="settingsOpen = false" />
        <Button label="Save settings" icon="pi pi-check" :loading="savingSettings" @click="saveSettings" />
      </template>
    </Dialog>

    <Dialog v-model:visible="brandOpen" modal :header="`Branding: ${brandCompany?.name || ''}`" :style="{ width: '40rem' }">
      <div class="settings-form">
        <div class="brand-preview" :style="brandPreview" data-testid="brand-preview">
          <span class="brand-preview-mark">
            <img v-if="brandLogo" :src="brandLogo" alt="Company logo preview" />
            <template v-else>{{ initialsOf(brandForm.displayName || brandCompany?.name) }}</template>
          </span>
          <span>
            <strong>{{ brandForm.displayName || brandCompany?.name }}</strong>
            <small>{{ brandForm.tagline || "Your tagline appears here" }}</small>
          </span>
        </div>

        <div class="logo-row">
          <label class="file-button">
            <span class="p-button p-component p-button-outlined p-button-sm"><i class="pi pi-upload"></i>&nbsp;{{ brandLogo ? "Replace logo" : "Upload logo" }}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Logo file" @change="uploadLogo" />
          </label>
          <Button v-if="brandLogo" label="Remove logo" size="small" text severity="danger" @click="removeLogo" />
          <small class="muted">PNG, JPEG or WebP, up to 256 KB. A square image works best.</small>
        </div>

        <label>Display name
          <InputText v-model="brandForm.displayName" maxlength="80" placeholder="Shown in the app header and sidebar" aria-label="Display name" />
        </label>
        <label>Tagline
          <InputText v-model="brandForm.tagline" maxlength="120" aria-label="Tagline" />
        </label>
        <div class="two-col">
          <label>Primary colour
            <span class="color-row"><input v-model="brandForm.primaryColor" type="color" aria-label="Primary colour" /><InputText v-model="brandForm.primaryColor" maxlength="7" aria-label="Primary colour code" /></span>
          </label>
          <label>Accent colour
            <span class="color-row"><input v-model="brandForm.accentColor" type="color" aria-label="Accent colour" /><InputText v-model="brandForm.accentColor" maxlength="7" aria-label="Accent colour code" /></span>
          </label>
        </div>
        <div class="two-col">
          <label>Website
            <InputText v-model="brandForm.website" maxlength="200" placeholder="https://" aria-label="Website" />
          </label>
          <label>Support email
            <InputText v-model="brandForm.supportEmail" maxlength="120" aria-label="Support email" />
          </label>
        </div>
        <div class="two-col">
          <label>Phone
            <InputText v-model="brandForm.phone" maxlength="40" aria-label="Phone" />
          </label>
          <label>Address
            <InputText v-model="brandForm.address" maxlength="200" aria-label="Address" />
          </label>
        </div>
        <Message v-if="brandError" severity="error" :closable="false">{{ brandError }}</Message>
      </div>
      <template #footer>
        <Button label="Cancel" text severity="secondary" @click="brandOpen = false" />
        <Button label="Save branding" icon="pi pi-check" :loading="savingBrand" @click="saveBranding" />
      </template>
    </Dialog>

    <!-- Audit log -->
    <section v-if="tab === 'audit'" class="panel-card" aria-label="Audit log">
      <div class="panel-heading">
        <div>
          <h3>Audit log</h3>
          <p class="muted">Every sign-in, role or company change and candidate change, including actions the AI assistant ran. Entries cannot be edited or deleted.</p>
        </div>
      </div>
      <form class="company-form" @submit.prevent="applyAuditFilter">
        <InputText v-model="auditFilter.action" placeholder="Action, e.g. candidate.deleted" aria-label="Filter by action" />
        <Dropdown v-model="auditFilter.actorId" :options="actorOptions" option-label="label" option-value="value" show-clear placeholder="Any person" aria-label="Filter by person" />
        <Dropdown v-model="auditFilter.companyId" :options="companyOptions" option-label="label" option-value="value" show-clear placeholder="Any company" aria-label="Filter by company" />
        <Button type="submit" label="Filter" icon="pi pi-filter" />
      </form>
      <DataTable :value="entries" data-key="id" size="small" responsive-layout="scroll">
        <Column header="When">
          <template #body="{ data }">{{ formatTime(data.createdAt) }}</template>
        </Column>
        <Column header="Who">
          <template #body="{ data }">{{ data.actorEmail || "system" }}</template>
        </Column>
        <Column field="action" header="Action" />
        <Column header="Source">
          <template #body="{ data }">
            <Tag :value="data.source" :severity="sourceSeverity[data.source] || 'info'" />
          </template>
        </Column>
        <Column field="summary" header="Details" />
        <template #empty>No audit entries match.</template>
      </DataTable>
      <div v-if="hasMoreAudit" class="load-more">
        <Button label="Load older entries" text @click="loadAudit({ append: true })" />
      </div>
    </section>
  </section>
</template>

<style scoped>
.admin-tabs { display: flex; gap: 8px; align-items: center; padding: 8px 12px; border-radius: 12px; margin-bottom: 8px; flex-wrap: wrap; }
.admin-tab { display: inline-flex; gap: 8px; align-items: center; border: 0; padding: 8px 14px; border-radius: 10px; background: transparent; color: #475569; font-weight: 600; cursor: pointer; }
.admin-tab.active { background: #ffffff; color: var(--primary-700); box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12); }
.company-form { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.company-form > * { flex: 1 1 14rem; }
.company-form button { flex: 0 0 auto; }
.load-more { display: flex; justify-content: center; margin-top: 8px; }
.settings-form { display: grid; gap: 14px; }
.settings-form label { display: grid; gap: 4px; font-weight: 600; font-size: 0.9rem; }
.brand-preview { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 12px; background: var(--primary-50); border: 1px solid var(--primary-100); }
.brand-preview strong { display: block; color: var(--primary-700); }
.brand-preview small { color: var(--text-muted); }
.brand-preview-mark { width: 48px; height: 48px; border-radius: 12px; display: grid; place-items: center; background: var(--brand-gradient); color: var(--primary-color-text); font-weight: 800; overflow: hidden; }
.brand-preview-mark img { width: 100%; height: 100%; object-fit: contain; background: #fff; }
.logo-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.file-button { display: inline-block; cursor: pointer; }
.file-button input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.color-row { display: flex; gap: 8px; align-items: center; }
.color-row input[type="color"] { width: 2.5rem; height: 2.3rem; padding: 0; border: 1px solid var(--border-strong); border-radius: 8px; background: none; }
.facility-list { list-style: none; margin: 8px 0; padding: 0; display: grid; gap: 6px; }
.facility-list li { display: flex; gap: 6px; align-items: flex-start; }
.facility-card { padding: 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--surface-muted); }
.facility-search { display: block; margin: 8px 0; }
.facility-search :deep(input) { width: 100%; }
</style>
