<script setup>
import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import Dropdown from "primevue/dropdown";
import InputText from "primevue/inputtext";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS } from "@acmp/shared";
import api from "../services/api";

// Other documents kept with a candidate (certificates, IDs, contracts ...). Each can have an expiry date;
// after that day the document is marked Expired. The API decides the state; this only shows it.
const props = defineProps({
  candidateId: { type: String, required: true },
  companyId: { type: String, default: null },
  canManage: { type: Boolean, default: false }
});

const MAX_BYTES = 5 * 1024 * 1024;
const categoryOptions = DOCUMENT_CATEGORIES.map((value) => ({ value, label: DOCUMENT_CATEGORY_LABELS[value] }));

const documents = ref([]);
const loading = ref(false);
const error = ref("");
const busy = ref(false);
let request = 0;

const emptyForm = () => ({ file: null, title: "", category: "certificate", expiresAt: "" });
const form = ref(emptyForm());
const adding = ref(false);
const editingId = ref(null);
const editForm = ref({ title: "", category: "other", expiresAt: "" });

const expiredCount = computed(() => documents.value.filter((doc) => doc.isExpired).length);
defineExpose({ expiredCount });

async function load() {
  if (!props.candidateId) return;
  const mine = ++request;
  loading.value = true;
  error.value = "";
  try {
    const { data } = await api.get(`/candidates/${props.candidateId}/documents`);
    if (mine === request) documents.value = data.documents;
  } catch {
    if (mine === request) {
      documents.value = [];
      error.value = "The documents could not be loaded.";
    }
  } finally {
    if (mine === request) loading.value = false;
  }
}

watch(
  () => props.candidateId,
  () => {
    adding.value = false;
    editingId.value = null;
    form.value = emptyForm();
    load();
  },
  { immediate: true }
);

function onFile(event) {
  const picked = event.target.files?.[0] || null;
  error.value = "";
  if (!picked) return;
  if (!/\.(pdf|docx|png|jpe?g)$/i.test(picked.name) || picked.size > MAX_BYTES) {
    error.value = "Choose a PDF, Word (.docx), PNG or JPEG file up to 5 MB.";
    event.target.value = "";
    return;
  }
  form.value.file = picked;
  if (!form.value.title) form.value.title = picked.name.replace(/\.[^.]+$/, "").slice(0, 100);
}

async function upload() {
  error.value = "";
  if (!form.value.file) {
    error.value = "Choose a file first.";
    return;
  }
  if (!form.value.title.trim()) {
    error.value = "Give the document a title.";
    return;
  }
  busy.value = true;
  try {
    const params = { title: form.value.title.trim(), category: form.value.category };
    if (form.value.expiresAt) params.expiresAt = form.value.expiresAt;
    await api.post(`/candidates/${props.candidateId}/documents`, form.value.file, {
      params,
      headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(form.value.file.name) },
      transformRequest: [(body) => body],
      timeout: 60000
    });
    form.value = emptyForm();
    adding.value = false;
    await load();
  } catch (e) {
    error.value = e.response?.data?.error || "The document could not be uploaded.";
  } finally {
    busy.value = false;
  }
}

function startEdit(doc) {
  editingId.value = doc.id;
  editForm.value = { title: doc.title, category: doc.category, expiresAt: doc.expiresAt || "" };
  error.value = "";
}

async function saveEdit(doc) {
  error.value = "";
  busy.value = true;
  try {
    await api.patch(`/documents/${doc.id}`, {
      title: editForm.value.title.trim(),
      category: editForm.value.category,
      expiresAt: editForm.value.expiresAt || null
    });
    editingId.value = null;
    await load();
  } catch (e) {
    error.value = e.response?.data?.error || "The document could not be saved.";
  } finally {
    busy.value = false;
  }
}

async function download(doc) {
  error.value = "";
  try {
    const { data, headers } = await api.get(`/documents/${doc.id}/file`, { responseType: "blob" });
    const disposition = headers?.["content-disposition"] || "";
    const name = decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1] || doc.filename);
    const url = URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  } catch {
    error.value = "The document could not be downloaded.";
  }
}

async function remove(doc) {
  if (!confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
  error.value = "";
  try {
    await api.delete(`/documents/${doc.id}`);
    await load();
  } catch (e) {
    error.value = e.response?.data?.error || "The document could not be deleted.";
  }
}

const sizeText = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const dateText = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "");

function expiryLabel(doc) {
  if (doc.status === "no_expiry") return "No expiry date";
  if (doc.status === "expired") return `Expired on ${dateText(doc.expiresAt)}`;
  if (doc.daysLeft === 0) return "Expires today";
  if (doc.status === "expiring_soon") return `Expires in ${doc.daysLeft} day${doc.daysLeft === 1 ? "" : "s"}`;
  return `Valid until ${dateText(doc.expiresAt)}`;
}

const iconFor = (type) => ({ pdf: "pi-file-pdf", docx: "pi-file-word", png: "pi-image", jpg: "pi-image" })[type] || "pi-file";
</script>

<template>
  <div class="docs" data-test="documents">
    <div class="docs-head">
      <div>
        <h4>Other documents</h4>
        <p class="muted-text">Certificates, IDs, licences and contracts. Add an expiry date and we mark the document Expired after it.</p>
      </div>
      <Button v-if="canManage && !adding" label="Add document" icon="pi pi-plus" size="small" @click="adding = true" />
    </div>

    <form v-if="adding" class="doc-form" aria-label="Add document" @submit.prevent="upload">
      <label class="field">
        <span>File (PDF, Word, PNG or JPEG, up to 5 MB)</span>
        <input type="file" accept=".pdf,.docx,.png,.jpg,.jpeg" aria-label="Document file" :disabled="busy" @change="onFile" />
      </label>
      <label class="field">
        <span>Title</span>
        <InputText v-model="form.title" maxlength="100" placeholder="e.g. Nursing licence" aria-label="Document title" />
      </label>
      <div class="two">
        <label class="field">
          <span>Type</span>
          <Dropdown v-model="form.category" :options="categoryOptions" option-label="label" option-value="value" aria-label="Document type" />
        </label>
        <label class="field">
          <span>Expiry date (optional)</span>
          <input v-model="form.expiresAt" type="date" class="date-input" aria-label="Expiry date" />
        </label>
      </div>
      <div class="form-actions">
        <Button type="button" label="Cancel" text severity="secondary" size="small" @click="adding = false; form = emptyForm()" />
        <Button type="submit" label="Upload" icon="pi pi-upload" size="small" :loading="busy" />
      </div>
    </form>

    <p v-if="error" class="docs-error" role="alert">{{ error }}</p>
    <p v-if="loading && !documents.length" class="muted-text">Loading…</p>

    <ul class="doc-list">
      <li v-for="doc in documents" :key="doc.id" class="doc-item" :class="{ expired: doc.isExpired }" data-test="document">
        <template v-if="editingId !== doc.id">
          <span class="doc-icon"><i class="pi" :class="iconFor(doc.type)" aria-hidden="true"></i></span>
          <div class="doc-main">
            <strong data-test="doc-title">{{ doc.title }}</strong>
            <small class="muted-text">{{ DOCUMENT_CATEGORY_LABELS[doc.category] || doc.category }} · {{ doc.filename }} · {{ sizeText(doc.size) }}</small>
            <span class="expiry" :class="`expiry-${doc.status}`" data-test="doc-expiry">
              <i v-if="doc.isExpired" class="pi pi-exclamation-circle" aria-hidden="true"></i>
              <strong v-if="doc.isExpired">Expired</strong>
              {{ expiryLabel(doc) }}
            </span>
          </div>
          <div class="doc-actions">
            <Button icon="pi pi-download" text rounded size="small" severity="secondary" :aria-label="`Download ${doc.title}`" @click="download(doc)" />
            <template v-if="canManage">
              <Button icon="pi pi-pencil" text rounded size="small" severity="secondary" :aria-label="`Edit ${doc.title}`" @click="startEdit(doc)" />
              <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="`Delete ${doc.title}`" @click="remove(doc)" />
            </template>
          </div>
        </template>
        <form v-else class="doc-form inline" @submit.prevent="saveEdit(doc)">
          <label class="field">
            <span>Title</span>
            <InputText v-model="editForm.title" maxlength="100" aria-label="Edit title" />
          </label>
          <div class="two">
            <label class="field">
              <span>Type</span>
              <Dropdown v-model="editForm.category" :options="categoryOptions" option-label="label" option-value="value" aria-label="Edit type" />
            </label>
            <label class="field">
              <span>Expiry date</span>
              <input v-model="editForm.expiresAt" type="date" class="date-input" aria-label="Edit expiry date" />
            </label>
          </div>
          <div class="form-actions">
            <Button type="button" label="Cancel" text severity="secondary" size="small" @click="editingId = null" />
            <Button type="submit" label="Save" icon="pi pi-check" size="small" :loading="busy" />
          </div>
        </form>
      </li>
    </ul>
    <p v-if="!loading && !documents.length && !error" class="empty" data-test="no-documents">No other documents yet.</p>
  </div>
</template>

<style scoped>
.docs { display: grid; gap: 12px; }
.docs-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.docs-head :deep(.p-button) { white-space: nowrap; flex-shrink: 0; }
.docs-head h4 { margin: 0 0 2px; font-size: 1rem; }
.docs-head p { margin: 0; font-size: 0.82rem; }
.muted-text { color: var(--text-muted); }
.doc-form { display: grid; gap: 10px; padding: 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-muted); }
.doc-form.inline { border-style: solid; width: 100%; }
.field { display: grid; gap: 4px; font-size: 0.82rem; font-weight: 600; color: var(--text-secondary); }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.date-input { height: 2.5rem; padding: 0 10px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); font: inherit; background: #fff; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; }
.docs-error { margin: 0; color: var(--danger); font-size: 0.85rem; }
.doc-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.doc-item { display: flex; gap: 12px; align-items: center; padding: 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--surface-card); }
.doc-item.expired { border-color: color-mix(in srgb, var(--danger) 45%, white); background: color-mix(in srgb, var(--danger) 5%, white); }
.doc-icon { width: 2.4rem; height: 2.4rem; border-radius: 10px; display: grid; place-items: center; background: var(--primary-50); color: var(--primary-600); flex-shrink: 0; }
.doc-main { display: grid; gap: 2px; min-width: 0; flex: 1; }
.doc-main strong { overflow-wrap: anywhere; }
.doc-main small { overflow-wrap: anywhere; }
.doc-actions { display: flex; flex-shrink: 0; }
.expiry { display: inline-flex; gap: 6px; align-items: center; font-size: 0.8rem; color: var(--text-muted); }
.expiry-expired { color: var(--danger); }
.expiry-expiring_soon { color: #b54708; }
.expiry-valid { color: var(--success); }
.empty { margin: 0; color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 16px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); }
</style>
