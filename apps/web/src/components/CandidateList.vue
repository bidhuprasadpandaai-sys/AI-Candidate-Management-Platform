<script setup>
import { ref, computed, onMounted } from "vue";
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Dialog from "primevue/dialog";
import Dropdown from "primevue/dropdown";
import InputText from "primevue/inputtext";
import OverlayPanel from "primevue/overlaypanel";
import Tag from "primevue/tag";
import { CANDIDATE_STATUSES, STATUS_SEVERITY } from "@acmp/shared";
import { useChat } from "@acmp/chat";
import { useCandidateStore } from "../stores/candidates";
import AddCandidateModal from "./AddCandidateModal.vue";
import CandidateDetailSidebar from "./CandidateDetailSidebar.vue";
import CandidateChatSidebar from "./CandidateChatSidebar.vue";

// ─── Preference keys ─────────────────────────────────────────────────────────
const PREF_VIS    = "acmp_col_visibility";
const PREF_ORDER  = "acmp_col_order";
const PREF_ROWS   = "acmp_rows_per_page";
const PREF_CUSTOM = "acmp_custom_cols";

// ─── Emits ───────────────────────────────────────────────────────────────────
const emit = defineEmits(["switch-to-chat"]);

// ─── Store / Chat ─────────────────────────────────────────────────────────────
const store = useCandidateStore();
const chat  = useChat();

// ─── Modals ──────────────────────────────────────────────────────────────────
const showAddModal       = ref(false);
const showChatSidebar    = ref(false);
const activeChatCandidate = ref(null);

// ─── Group-chat ───────────────────────────────────────────────────────────────
const selectedCandidates  = ref([]);
const showGroupChatDialog = ref(false);
const groupChatTitle      = ref("");
const creatingGroupChat   = ref(false);

// ─── Column panel (OverlayPanel) ──────────────────────────────────────────────
const colPanelRef = ref(null);

// ─── Add-column dialog ────────────────────────────────────────────────────────
const showAddColumnDialog = ref(false);
const newColumnLabel      = ref("");
const newColumnField      = ref("");
const addColumnError      = ref("");

// ─── Default column definitions ──────────────────────────────────────────────
const DEFAULT_COLUMNS = [
  { key: "name",            header: "Candidate",   field: "name",            type: "text",   sortable: true  },
  { key: "role",            header: "Role",         field: "role",            type: "text",   sortable: true  },
  { key: "status",          header: "Status",       field: "status",          type: "status", sortable: true  },
  { key: "score",           header: "Score",        field: "score",           type: "score",  sortable: true  },
  { key: "stage",           header: "Stage",        field: "stage",           type: "text",   sortable: true  },
  { key: "location",        header: "Location",     field: "location",        type: "text",   sortable: true  },
  { key: "skills",          header: "Skills",       field: "skills",          type: "skills", sortable: false },
  { key: "experienceYears", header: "Experience",   field: "experienceYears", type: "text",   sortable: true  },
  { key: "email",           header: "Email",        field: "email",           type: "text",   sortable: false },
];

// ─── Load prefs from localStorage ───────────────────────────────────────────
function loadPrefs() {
  try {
    return {
      vis:    JSON.parse(localStorage.getItem(PREF_VIS)    || "null"),
      order:  JSON.parse(localStorage.getItem(PREF_ORDER)  || "null"),
      rows:   parseInt(localStorage.getItem(PREF_ROWS)     || "10"),
      custom: JSON.parse(localStorage.getItem(PREF_CUSTOM) || "[]"),
    };
  } catch { return { vis: null, order: null, rows: 10, custom: [] }; }
}

const prefs = loadPrefs();

// Default visibility: hide email & experience until user enables them
const DEFAULT_HIDDEN = new Set(["email", "experienceYears"]);

const columnVisibility = ref(
  Object.fromEntries(
    DEFAULT_COLUMNS.map((col) => [
      col.key,
      prefs.vis ? (prefs.vis[col.key] ?? !DEFAULT_HIDDEN.has(col.key)) : !DEFAULT_HIDDEN.has(col.key),
    ])
  )
);

const customColumns = ref(Array.isArray(prefs.custom) ? prefs.custom : []);

function uniqueValues(values) {
  return [...new Set(values)];
}

function normalizedColumnKeys(keys) {
  const knownKeys = [
    ...DEFAULT_COLUMNS.map((col) => col.key),
    ...customColumns.value.map((col) => col.key),
  ];
  const knownSet = new Set(knownKeys);
  const orderedKnown = uniqueValues((Array.isArray(keys) ? keys : []).filter((key) => knownSet.has(key)));
  const missingKeys = knownKeys.filter((key) => !orderedKnown.includes(key));
  return [...orderedKnown, ...missingKeys];
}

const allColumnKeys = ref(normalizedColumnKeys(prefs.order));

const rowsPerPage = ref(isNaN(prefs.rows) ? 10 : prefs.rows);

// ─── Column map ───────────────────────────────────────────────────────────────
const allColumnsMap = computed(() => {
  const map = {};
  for (const col of DEFAULT_COLUMNS)      map[col.key] = col;
  for (const col of customColumns.value)  map[col.key] = col;
  return map;
});

const orderedColumns = computed(() => {
  const result = [];
  for (const key of allColumnKeys.value) {
    if (allColumnsMap.value[key]) result.push(allColumnsMap.value[key]);
  }
  // append any custom cols not yet tracked
  for (const col of customColumns.value) {
    if (!allColumnKeys.value.includes(col.key)) result.push(col);
  }
  return result;
});

const visibleColumns = computed(() =>
  orderedColumns.value.filter((col) => columnVisibility.value[col.key] !== false)
);
const tableRenderKey = computed(() => `tbl:${allColumnKeys.value.join("|")}:${visibleColumns.value.map((c) => c.key).join("|")}`);

// ─── Save prefs ───────────────────────────────────────────────────────────────
function savePrefs() {
  localStorage.setItem(PREF_VIS,    JSON.stringify(columnVisibility.value));
  localStorage.setItem(PREF_ORDER,  JSON.stringify(allColumnKeys.value));
  localStorage.setItem(PREF_ROWS,   String(rowsPerPage.value));
  localStorage.setItem(PREF_CUSTOM, JSON.stringify(customColumns.value));
}

function toggleColumn(key) {
  columnVisibility.value[key] = !columnVisibility.value[key];
  allColumnKeys.value = normalizedColumnKeys(allColumnKeys.value);
  savePrefs();
}

function resetPreferences() {
  [PREF_VIS, PREF_ORDER, PREF_ROWS, PREF_CUSTOM].forEach((k) => localStorage.removeItem(k));
  columnVisibility.value = Object.fromEntries(
    DEFAULT_COLUMNS.map((col) => [col.key, !DEFAULT_HIDDEN.has(col.key)])
  );
  customColumns.value   = [];
  allColumnKeys.value   = DEFAULT_COLUMNS.map((c) => c.key);
  rowsPerPage.value     = 10;
  store.rows            = 10;
  store.currentPage     = 1;
  store.sortField       = "score";
  store.sortOrder       = -1;
  store.applyFilters();
}

// ─── Add custom column ────────────────────────────────────────────────────────
function openAddColumnDialog() {
  newColumnLabel.value  = "";
  newColumnField.value  = "";
  addColumnError.value  = "";
  showAddColumnDialog.value = true;
}

function addCustomColumn() {
  const label = newColumnLabel.value.trim();
  const field = newColumnField.value.trim().replace(/\s+/g, "_").toLowerCase();
  if (!label) { addColumnError.value = "Column label is required."; return; }
  if (!field) { addColumnError.value = "Field name is required."; return; }
  if (allColumnsMap.value[field]) { addColumnError.value = `Field "${field}" already exists.`; return; }

  const col = { key: field, header: label, field, type: "custom", sortable: false, custom: true };
  customColumns.value        = [...customColumns.value, col];
  columnVisibility.value[field] = true;
  allColumnKeys.value        = [...allColumnKeys.value, field];
  savePrefs();
  showAddColumnDialog.value = false;
}

function removeCustomColumn(key) {
  customColumns.value = customColumns.value.filter((c) => c.key !== key);
  const vis = { ...columnVisibility.value };
  delete vis[key];
  columnVisibility.value  = vis;
  allColumnKeys.value     = normalizedColumnKeys(allColumnKeys.value.filter((k) => k !== key));
  savePrefs();
}

// ─── Column reorder ───────────────────────────────────────────────────────────
// PrimeVue fires column-reorder with { dragIndex, dropIndex }
// Fixed columns: 0=selection, 1=row-reorder; last=chat → offset by 2
const FIXED_LEFT = 2;

function onColumnReorder({ dragIndex, dropIndex }) {
  const di  = dragIndex  - FIXED_LEFT;
  const ddr = dropIndex  - FIXED_LEFT;
  const vis = uniqueValues(visibleColumns.value.map((c) => c.key));
  if (di < 0 || ddr < 0 || di >= vis.length || ddr > vis.length) return;

  const newVis = [...vis];
  const [moved] = newVis.splice(di, 1);
  newVis.splice(ddr, 0, moved);

  const hidden = normalizedColumnKeys(allColumnKeys.value).filter((k) => !newVis.includes(k));
  allColumnKeys.value = normalizedColumnKeys([...newVis, ...hidden]);
  savePrefs();
}

// ─── Row reorder ──────────────────────────────────────────────────────────────
function onRowReorder(event) {
  store.candidates = event.value;
}

// ─── Lazy loading / pagination ────────────────────────────────────────────────
async function onPage(event) {
  store.currentPage = event.page + 1;
  store.rows        = event.rows;
  rowsPerPage.value = event.rows;
  savePrefs();
  await store.fetchCandidates();
}

async function onSort(event) {
  store.sortField   = event.sortField   || "score";
  store.sortOrder   = event.sortOrder   ?? -1;
  store.currentPage = 1;
  await store.fetchCandidates();
}

// ─── Row click ────────────────────────────────────────────────────────────────
const onRowClick = (event) => {
  const t = event.originalEvent?.target;
  if (!t) return;
  if (
    t.closest(".p-selection-column") ||
    t.closest(".p-checkbox") ||
    t.closest(".p-checkbox-box") ||
    t.closest(".chat-btn") ||
    t.closest(".chat-col") ||
    t.closest(".p-reorderablerow-handle")
  ) return;
  store.selectCandidate(event.data.id);
};

// ─── Direct chat ──────────────────────────────────────────────────────────────
const openDirectChat = (candidate) => {
  activeChatCandidate.value = candidate;
  showChatSidebar.value     = true;
};

// ─── Group chat ───────────────────────────────────────────────────────────────
const openGroupChatDialog = () => {
  if (selectedCandidates.value.length === 0) return;
  if (selectedCandidates.value.length === 1) {
    openDirectChat(selectedCandidates.value[0]);
    selectedCandidates.value = [];
    return;
  }
  groupChatTitle.value    = `Group Chat: ${selectedCandidates.value.map((c) => c.name).join(", ")}`;
  showGroupChatDialog.value = true;
};

const handleCreateGroupChat = async () => {
  if (!groupChatTitle.value.trim() || selectedCandidates.value.length < 2) return;
  creatingGroupChat.value = true;
  try {
    const ids          = selectedCandidates.value.map((c) => String(c.id));
    const conversation = await chat.createConversation(store.apiBaseUrl, ids, "group", groupChatTitle.value.trim());
    chat.activeConversationId.value = conversation.id;
    await chat.fetchMessages(store.apiBaseUrl, conversation.id);
    selectedCandidates.value    = [];
    showGroupChatDialog.value   = false;
    emit("switch-to-chat");
  } catch (err) {
    console.error("Failed to create group chat:", err);
  } finally {
    creatingGroupChat.value = false;
  }
};

// ─── Status helpers ───────────────────────────────────────────────────────────
const statusOptions = computed(() =>
  CANDIDATE_STATUSES.map((s) => ({
    label: s === "all" ? "All statuses" : `${s.charAt(0).toUpperCase()}${s.slice(1)}`,
    value: s,
  }))
);
const getSeverity = (status) => STATUS_SEVERITY[status] || "secondary";

// ─── Init ─────────────────────────────────────────────────────────────────────
onMounted(() => {
  allColumnKeys.value = normalizedColumnKeys(allColumnKeys.value);
  store.rows      = rowsPerPage.value;
  store.currentPage = 1;
});
</script>

<template>
  <section class="panel-card candidate-panel">

    <!-- ── Header ── -->
    <div class="panel-heading">
      <div>
        <h3>Candidate Pipeline</h3>
        <p class="muted">
          {{ store.totalRecords }} candidates · lazy-loaded · drag columns &amp; rows to reorder · preferences saved
        </p>
      </div>
      <div class="header-actions">
        <!-- Group / single chat from selection -->
        <Button
          v-if="selectedCandidates.length > 0"
          :label="selectedCandidates.length > 1 ? `Group Chat (${selectedCandidates.length})` : 'Chat'"
          icon="pi pi-comments"
          severity="help"
          @click="openGroupChatDialog"
        />

        <!-- Columns panel toggle -->
        <Button
          :label="`Columns (${visibleColumns.length})`"
          icon="pi pi-sliders-h"
          outlined
          @click="colPanelRef.toggle($event)"
        />

        <OverlayPanel ref="colPanelRef" class="col-overlay">
          <div class="col-panel">
            <div class="col-panel__head">
              <span class="col-panel__title">Visible columns</span>
              <button class="col-panel__reset-btn" @click="resetPreferences">
                <i class="pi pi-refresh" /> Reset all
              </button>
            </div>

            <div class="col-panel__list">
              <label
                v-for="col in [...DEFAULT_COLUMNS, ...customColumns]"
                :key="col.key"
                class="col-toggle-row"
              >
                <span class="col-toggle-switch" :class="{ on: columnVisibility[col.key] !== false }">
                  <input type="checkbox" :checked="columnVisibility[col.key] !== false" @change="toggleColumn(col.key)" />
                  <span class="slider" />
                </span>
                <span class="col-toggle-label">{{ col.header }}</span>
                <button v-if="col.custom" class="col-remove" @click.stop="removeCustomColumn(col.key)" title="Remove">
                  <i class="pi pi-times" />
                </button>
              </label>
            </div>

            <button class="col-panel__add-btn" @click="openAddColumnDialog(); colPanelRef.hide()">
              <i class="pi pi-plus" /> Add custom column
            </button>
          </div>
        </OverlayPanel>

        <Button label="Add Candidate" icon="pi pi-plus" severity="success" @click="showAddModal = true" />
        <Button label="Refresh" icon="pi pi-refresh" text @click="store.applyFilters" />
      </div>
    </div>

    <!-- ── Filters ── -->
    <div class="filter-row">
      <InputText
        v-model="store.search"
        placeholder="Search candidate, role, or skill"
        @keyup.enter="store.applyFilters"
      />
      <Dropdown
        v-model="store.status"
        :options="statusOptions"
        option-label="label"
        option-value="value"
        @change="store.applyFilters"
      />
      <Button label="Apply" icon="pi pi-filter" @click="store.applyFilters" :loading="store.loading" />
    </div>

    <!-- ── Data Table ── -->
    <DataTable
      :key="tableRenderKey"
      v-model:selection="selectedCandidates"
      :value="store.candidates"
      data-key="id"
      responsive-layout="scroll"
      :loading="store.loading"
      striped-rows
      lazy
      paginator
      :rows="rowsPerPage"
      :rows-per-page-options="[5, 10, 25, 50]"
      :total-records="store.totalRecords"
      reorderable-columns
      class="clickable-table"
      @row-click="onRowClick"
      @page="onPage"
      @sort="onSort"
      @column-reorder="onColumnReorder"
      @row-reorder="onRowReorder"
    >
      <!-- Fixed: selection -->
      <Column columnKey="__select" selection-mode="multiple" headerStyle="width: 3rem;" :reorderable-column="false" />
      <!-- Fixed: row drag handle -->
      <Column columnKey="__reorder" row-reorder headerStyle="width: 3rem;" :reorderable-column="false" />

      <!-- Dynamic visible columns -->
      <template v-for="col in visibleColumns" :key="col.key">
        <!-- plain text / custom -->
        <Column
          v-if="col.type === 'text' || col.type === 'custom'"
          :key="`col-${col.key}`"
          :columnKey="col.key"
          :field="col.field"
          :header="col.header"
          :sortable="col.sortable"
        >
          <template #body="sp">
            <span>{{ sp.data[col.field] ?? '—' }}</span>
          </template>
        </Column>

        <!-- status badge -->
        <Column v-else-if="col.type === 'status'" :key="`col-${col.key}`" :columnKey="col.key" field="status" header="Status" :sortable="true">
          <template #body="sp">
            <Tag
              :value="sp.data.status?.toUpperCase()"
              :severity="getSeverity(sp.data.status)"
              class="status-tag"
            />
          </template>
        </Column>

        <!-- score gauge -->
        <Column v-else-if="col.type === 'score'" :key="`col-${col.key}`" :columnKey="col.key" field="score" header="Score" :sortable="true">
          <template #body="sp">
            <div class="score-gauge-container">
              <svg class="score-gauge" viewBox="0 0 36 36">
                <path class="circle-bg"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                <path class="circle-fill"
                  :stroke-dasharray="`${sp.data.score}, 100`"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  :stroke="sp.data.score >= 90 ? '#10b981' : sp.data.score >= 80 ? '#3b82f6' : '#f59e0b'" />
              </svg>
              <span class="score-val">{{ sp.data.score }}</span>
            </div>
          </template>
        </Column>

        <!-- skills chips -->
        <Column v-else-if="col.type === 'skills'" :key="`col-${col.key}`" :columnKey="col.key" field="skills" header="Skills">
          <template #body="sp">
            <div class="skills-wrap">
              <span v-for="skill in sp.data.skills" :key="skill" class="skill-chip">{{ skill }}</span>
            </div>
          </template>
        </Column>
      </template>

      <!-- Fixed: chat icon (always last) -->
      <Column columnKey="__chat" header="Chat" class="chat-col" style="width: 5.5rem; text-align: center;" :reorderable-column="false">
        <template #body="sp">
          <Button
            icon="pi pi-comments"
            outlined
            rounded
            severity="info"
            class="chat-btn"
            title="Chat with candidate"
            @click.stop="openDirectChat(sp.data)"
          />
        </template>
      </Column>
    </DataTable>

    <!-- ── Overlays ── -->
    <AddCandidateModal v-model:visible="showAddModal" />
    <CandidateDetailSidebar />
    <CandidateChatSidebar v-model:visible="showChatSidebar" :candidate="activeChatCandidate" />

    <!-- Group chat dialog -->
    <Dialog v-model:visible="showGroupChatDialog" header="Create Group Chat" :modal="true" :style="{ width: '28rem' }">
      <div style="display: flex; flex-direction: column; gap: 10px;">
        <label style="font-weight: 600; font-size: 0.88rem; color: #334155;">Conversation Title</label>
        <InputText v-model="groupChatTitle" placeholder="e.g. Frontend Engineering Group Chat" />
        <p style="font-size: 0.82rem; color: #64748b; margin: 0; line-height: 1.5;">
          Participants: {{ selectedCandidates.map((c) => c.name).join(", ") }}
        </p>
      </div>
      <template #footer>
        <Button label="Cancel" icon="pi pi-times" text @click="showGroupChatDialog = false" />
        <Button label="Create" icon="pi pi-check" :loading="creatingGroupChat" @click="handleCreateGroupChat" />
      </template>
    </Dialog>

    <!-- Add column dialog -->
    <Dialog v-model:visible="showAddColumnDialog" header="Add Custom Column" :modal="true" :style="{ width: '26rem' }">
      <div class="add-col-form">
        <div class="add-col-field">
          <label>Column Label <span class="req">*</span></label>
          <InputText v-model="newColumnLabel" placeholder="e.g. LinkedIn URL" @keyup.enter="addCustomColumn" />
        </div>
        <div class="add-col-field">
          <label>Field Name <span class="req">*</span></label>
          <InputText v-model="newColumnField" placeholder="e.g. linkedin (snake_case)" @keyup.enter="addCustomColumn" />
          <small class="add-col-hint">Maps to <code>candidate.{{ newColumnField || 'field' }}</code>. Unknown fields show "—".</small>
        </div>
        <p v-if="addColumnError" class="add-col-error">{{ addColumnError }}</p>
      </div>
      <template #footer>
        <Button label="Cancel" icon="pi pi-times" text @click="showAddColumnDialog = false" />
        <Button label="Add Column" icon="pi pi-plus" @click="addCustomColumn" />
      </template>
    </Dialog>

  </section>
</template>

<style scoped>
/* ── Layout ── */
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* ── Status tag ── */
.status-tag {
  font-size: 0.74rem;
  letter-spacing: 0.05em;
  padding: 4px 8px;
}

/* ── Score gauge ── */
.score-gauge-container {
  position: relative;
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.score-gauge { width: 100%; height: 100%; }
.circle-bg   { fill: none; stroke: #e2e8f0; stroke-width: 3.5; }
.circle-fill { fill: none; stroke-width: 3.8; stroke-linecap: round; transition: stroke-dasharray 0.4s ease; }
.score-val   { position: absolute; font-size: 0.76rem; font-weight: 700; color: #1e293b; }

/* ── Table row interactions ── */
.clickable-table :deep(tbody tr) {
  cursor: pointer;
  transition: background-color 0.2s ease, transform 0.1s ease;
}
.clickable-table :deep(tbody tr:hover)  { background-color: rgba(59, 130, 246, 0.04) !important; }
.clickable-table :deep(tbody tr:active) { transform: scale(0.998); }

/* ── Column panel (inside OverlayPanel) ── */
:global(.col-overlay .p-overlaypanel-content) {
  padding: 0 !important;
}
.col-panel {
  width: 260px;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  overflow: hidden;
}
.col-panel__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px 10px;
  border-bottom: 1px solid #e2e8f0;
}
.col-panel__title { font-weight: 700; font-size: 0.88rem; color: #1e293b; }
.col-panel__reset-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: #64748b;
  font-size: 0.78rem;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background 0.15s;
}
.col-panel__reset-btn:hover { background: #f1f5f9; color: #ef4444; }

.col-panel__list {
  max-height: 280px;
  overflow-y: auto;
  padding: 6px 0;
}

.col-toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 16px;
  cursor: pointer;
  transition: background 0.15s;
}
.col-toggle-row:hover { background: #f8fafc; }

/* iOS-style toggle switch */
.col-toggle-switch {
  position: relative;
  width: 34px;
  height: 20px;
  flex-shrink: 0;
}
.col-toggle-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
.col-toggle-switch .slider {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: #cbd5e1;
  transition: background 0.2s;
}
.col-toggle-switch .slider::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  left: 3px;
  top: 3px;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.col-toggle-switch.on .slider { background: #3b82f6; }
.col-toggle-switch.on .slider::after { transform: translateX(14px); }

.col-toggle-label {
  flex: 1;
  font-size: 0.86rem;
  color: #334155;
  font-weight: 500;
}
.col-remove {
  background: none;
  border: none;
  cursor: pointer;
  color: #94a3b8;
  padding: 2px 4px;
  border-radius: 4px;
  line-height: 1;
  font-size: 0.75rem;
  transition: color 0.15s, background 0.15s;
}
.col-remove:hover { color: #ef4444; background: #fee2e2; }

.col-panel__add-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 12px 12px;
  padding: 8px 14px;
  border-radius: 8px;
  background: linear-gradient(135deg, #eff6ff, #f0fdf4);
  border: 1px dashed #93c5fd;
  color: #2563eb;
  cursor: pointer;
  font-size: 0.84rem;
  font-weight: 600;
  transition: background 0.15s, border-color 0.15s;
}
.col-panel__add-btn:hover { background: #dbeafe; border-color: #3b82f6; }

/* ── Add column form ── */
.add-col-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.add-col-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.add-col-field label {
  font-weight: 600;
  font-size: 0.86rem;
  color: #334155;
}
.req { color: #ef4444; }
.add-col-hint {
  font-size: 0.76rem;
  color: #64748b;
}
.add-col-hint code {
  background: #f1f5f9;
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 0.76rem;
}
.add-col-error {
  font-size: 0.82rem;
  color: #dc2626;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 8px 12px;
  margin: 0;
}
</style>
