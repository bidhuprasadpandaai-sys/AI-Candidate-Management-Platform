<script setup>
import { computed, onMounted, ref, watch } from "vue";
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Dialog from "primevue/dialog";
import Dropdown from "primevue/dropdown";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Tag from "primevue/tag";
import Textarea from "primevue/textarea";
import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  JOB_STATUSES,
  JOB_STATUS_LABELS,
  JOB_STATUS_SEVERITY,
  PIPELINE_STAGES,
  RATE_UNITS,
  STATUS_SEVERITY
} from "@acmp/shared";
import CandidateDetailSidebar from "../CandidateDetailSidebar.vue";
import FacilityFields from "../FacilityFields.vue";
import ProfileMeter from "../ProfileMeter.vue";
import api from "../../services/api";
import { useAuthStore } from "../../stores/auth";
import { useCandidateStore } from "../../stores/candidates";
import { useJobsStore } from "../../stores/jobs";

const auth = useAuthStore();
const store = useCandidateStore();
const jobsStore = useJobsStore();

const tab = ref("openings");
const error = ref("");
const notice = ref("");

const canManage = computed(() => auth.can("job:manage"));
const canMove = computed(() => auth.can("candidate:update"));

const stageLabel = (stage) => stage.charAt(0).toUpperCase() + stage.slice(1);
const statusOptions = JOB_STATUSES.map((value) => ({ value, label: JOB_STATUS_LABELS[value] }));

function fail(e, fallback) {
  error.value = e?.response?.data?.error || e?.response?.data?.message || fallback || e?.message || "Something went wrong.";
  notice.value = "";
}

// ── Openings ──────────────────────────────────────────────────────────────────
const dialogOpen = ref(false);
watch(dialogOpen, (open) => {
  if (!open) facilityDialogOpen.value = false;
});
const editingId = ref(null);
const saving = ref(false);
const form = ref(emptyForm());

function emptyForm() {
  return {
    title: "", department: "", location: "", status: "open", hiringManagerId: null, description: "", companyId: null,
    employmentType: "full_time", currency: null, rateUnit: "hour",
    payRateMin: null, payRateMax: null, billRateMin: null, billRateMax: null,
    facilityId: null, expiresAt: "", maxApplications: null
  };
}

const employmentOptions = EMPLOYMENT_TYPES.map((value) => ({ value, label: EMPLOYMENT_TYPE_LABELS[value] }));
const rateUnitOptions = RATE_UNITS.map((value) => ({ value, label: `per ${value}` }));
const todayIso = () => new Date().toISOString().slice(0, 10);

// The company this job belongs to decides which currencies and facilities can be chosen.
const formCompany = computed(() => {
  const id = auth.isAdmin ? form.value.companyId : auth.user?.companyId;
  return store.companies.find((company) => company.id === id) || null;
});
const currencyOptions = computed(() => (formCompany.value?.currencies || ["USD"]).map((code) => ({ value: code, label: code })));
const facilityOptions = computed(() =>
  (formCompany.value?.facilities || []).map((facility) => ({
    value: facility.id,
    label: [facility.name, facility.location].filter(Boolean).join(" · ")
  }))
);

// Add a facility for the job's company without leaving the job form. It belongs to that company only.
const facilityDialogOpen = ref(false);
const facilityForm = ref({ name: "", location: "", address: "", pinCode: "" });
const facilityError = ref("");
const savingFacility = ref(false);
const facilityLocations = computed(() => (formCompany.value?.facilities || []).map((facility) => facility.location));

function openFacilityDialog() {
  facilityForm.value = { name: "", location: "", address: "", pinCode: "" };
  facilityError.value = "";
  facilityDialogOpen.value = true;
}

async function saveFacility() {
  facilityError.value = "";
  if (!facilityForm.value.name.trim()) {
    facilityError.value = "Give the facility a name.";
    return;
  }
  savingFacility.value = true;
  try {
    const { data } = await api.post(`/companies/${formCompany.value.id}/facilities`, {
      name: facilityForm.value.name.trim(),
      location: facilityForm.value.location.trim(),
      address: facilityForm.value.address.trim(),
      pinCode: facilityForm.value.pinCode.trim()
    });
    await store.fetchCompanies();
    form.value.facilityId = data.facility.id;
    facilityDialogOpen.value = false;
  } catch (e) {
    facilityError.value = e?.response?.data?.error || "The facility could not be added.";
  } finally {
    savingFacility.value = false;
  }
}

const money = (value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
// "EUR 40 – 60.5 / hour", "EUR from 40 / hour", or "–"
function rateText(job, kind) {
  const min = job[`${kind}RateMin`];
  const max = job[`${kind}RateMax`];
  if (min === null && max === null) return "–";
  const range = min !== null && max !== null ? `${money(min)} – ${money(max)}` : min !== null ? `from ${money(min)}` : `up to ${money(max)}`;
  return `${job.currency || ""} ${range} / ${job.rateUnit}`.trim();
}
// A live "Pay: EUR 40 – 60 / hour" chip in the form header
const rateSummary = computed(() => {
  const f = form.value;
  const asJob = { payRateMin: f.payRateMin ?? null, payRateMax: f.payRateMax ?? null, currency: f.currency, rateUnit: f.rateUnit };
  const text = rateText(asJob, "pay");
  return text === "–" ? "" : `Pay ${text}`;
});
const applicationsText = (job) => (job.maxApplications ? `${job.candidateCount} / ${job.maxApplications}` : String(job.candidateCount));

const companyOptions = computed(() => store.companies.map((company) => ({ value: company.id, label: company.name })));
const managerOptions = computed(() => jobsStore.hiringManagers.map((user) => ({ value: user.id, label: user.name })));

async function loadManagers() {
  try {
    await jobsStore.fetchHiringManagers(auth.isAdmin ? form.value.companyId : undefined);
  } catch {
    jobsStore.hiringManagers = [];
  }
}

async function openDialog(job = null) {
  error.value = "";
  editingId.value = job?.id || null;
  form.value = job
    ? {
        title: job.title, department: job.department, location: job.location, status: job.status, hiringManagerId: job.hiringManagerId,
        description: job.description, companyId: job.companyId,
        employmentType: job.employmentType || "full_time", currency: job.currency, rateUnit: job.rateUnit || "hour",
        payRateMin: job.payRateMin, payRateMax: job.payRateMax, billRateMin: job.billRateMin, billRateMax: job.billRateMax,
        facilityId: job.facilityId, expiresAt: job.expiresAt || "", maxApplications: job.maxApplications
      }
    : emptyForm();
  // the company's currency and facility lists
  await store.fetchCompanies().catch(() => {});
  if (!job) form.value.currency = (formCompany.value?.currencies || ["USD"])[0];
  dialogOpen.value = true;
  await loadManagers();
}

watch(() => form.value.companyId, () => {
  if (dialogOpen.value && auth.isAdmin) {
    form.value.hiringManagerId = null;
    form.value.facilityId = null;
    form.value.currency = (formCompany.value?.currencies || ["USD"])[0];
    loadManagers();
  }
});

async function saveJob() {
  const title = form.value.title.trim();
  if (!title) {
    error.value = "Job title is required.";
    return;
  }
  if (auth.isAdmin && !editingId.value && !form.value.companyId) {
    error.value = "Choose the company this job belongs to.";
    return;
  }
  for (const [kind, label] of [["pay", "Pay"], ["bill", "Bill"]]) {
    const min = form.value[`${kind}RateMin`];
    const max = form.value[`${kind}RateMax`];
    if (min !== null && max !== null && min > max) {
      error.value = `${label} rate minimum cannot be higher than the maximum.`;
      return;
    }
  }
  if (form.value.expiresAt && form.value.expiresAt < todayIso() && form.value.expiresAt !== (jobsStore.jobById(editingId.value)?.expiresAt || "")) {
    error.value = "The expiry date cannot be in the past.";
    return;
  }
  saving.value = true;
  try {
    const payload = {
      employmentType: form.value.employmentType,
      currency: form.value.currency,
      rateUnit: form.value.rateUnit,
      payRateMin: form.value.payRateMin,
      payRateMax: form.value.payRateMax,
      billRateMin: form.value.billRateMin,
      billRateMax: form.value.billRateMax,
      facilityId: form.value.facilityId || null,
      expiresAt: form.value.expiresAt || null,
      maxApplications: form.value.maxApplications || null,
      title,
      department: form.value.department.trim(),
      location: form.value.location.trim(),
      status: form.value.status,
      description: form.value.description.trim(),
      hiringManagerId: form.value.hiringManagerId || null
    };
    if (!editingId.value && auth.isAdmin) payload.companyId = form.value.companyId;
    await jobsStore.saveJob(editingId.value, payload);
    dialogOpen.value = false;
    notice.value = editingId.value ? `Job "${title}" updated.` : `Job "${title}" created.`;
    error.value = "";
  } catch (e) {
    fail(e);
  } finally {
    saving.value = false;
  }
}

async function setStatus(job, status) {
  try {
    await jobsStore.saveJob(job.id, { status });
    notice.value = `"${job.title}" is now ${JOB_STATUS_LABELS[status].toLowerCase()}.`;
    error.value = "";
  } catch (e) {
    fail(e);
  }
}

async function removeJob(job) {
  if (!confirm(`Delete the job "${job.title}"?`)) return;
  try {
    await jobsStore.deleteJob(job.id);
    notice.value = `Job "${job.title}" deleted.`;
    error.value = "";
  } catch (e) {
    fail(e);
  }
}

// ── Board ─────────────────────────────────────────────────────────────────────
const boardOptions = computed(() =>
  jobsStore.jobs.map((job) => ({ value: job.id, label: `${job.title}${job.companyName && auth.isAdmin ? ` (${job.companyName})` : ""}${job.status === "open" ? "" : ` · ${JOB_STATUS_LABELS[job.status]}`}` }))
);
const selectedBoard = ref(null);
const draggingId = ref("");
const overStage = ref("");

const columns = computed(() =>
  PIPELINE_STAGES.map((stage) => ({
    stage,
    label: stageLabel(stage),
    cards: store.boardApplications.filter((application) => (application.status || "screening") === stage)
  }))
);

async function loadBoard(jobId) {
  selectedBoard.value = jobId;
  try {
    await store.fetchBoard(jobId);
    error.value = "";
  } catch (e) {
    fail(e, "Unable to load the pipeline.");
  }
}

function openBoard(job) {
  tab.value = "board";
  loadBoard(job.id);
}

async function move(candidateId, stage) {
  try {
    await store.moveApplication(candidateId, stage);
    error.value = "";
  } catch (e) {
    fail(e, "Unable to move the candidate.");
  }
}

function onDragStart(event, card) {
  if (!canMove.value) return;
  draggingId.value = card.id;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", card.id);
}

function onDrop(event, stage) {
  event.preventDefault();
  const id = event.dataTransfer.getData("text/plain") || draggingId.value;
  draggingId.value = "";
  overStage.value = "";
  if (id && canMove.value) move(id, stage);
}

function showBoardTab() {
  tab.value = "board";
  if (!selectedBoard.value) {
    const first = jobsStore.openJobs[0] || jobsStore.jobs[0];
    if (first) loadBoard(first.id);
  }
}

onMounted(async () => {
  try {
    await jobsStore.fetchJobs();
  } catch (e) {
    fail(e, "Unable to load jobs.");
  }
});
</script>

<template>
  <section class="content-grid jobs-module">
    <div class="jobs-tabs glassmorphic-inset" role="tablist">
      <button role="tab" :aria-selected="tab === 'openings'" class="jobs-tab" :class="{ active: tab === 'openings' }" @click="tab = 'openings'">
        <i class="pi pi-briefcase"></i> Openings
      </button>
      <button role="tab" :aria-selected="tab === 'board'" class="jobs-tab" :class="{ active: tab === 'board' }" @click="showBoardTab">
        <i class="pi pi-th-large"></i> Pipeline board
      </button>
    </div>

    <Message v-if="error && !dialogOpen" severity="error" :closable="true" @close="error = ''">{{ error }}</Message>
    <Message v-if="notice" severity="success" :closable="true" @close="notice = ''">{{ notice }}</Message>

    <!-- Openings -->
    <section v-if="tab === 'openings'" class="panel-card" aria-label="Job openings">
      <div class="panel-heading">
        <div>
          <h3>Job openings</h3>
          <p class="muted">Link candidates to a job to follow them on its pipeline board.</p>
        </div>
        <Button v-if="canManage" label="Add job" icon="pi pi-plus" severity="success" @click="openDialog()" />
      </div>
      <DataTable :value="jobsStore.jobs" data-key="id" size="small" responsive-layout="scroll" :loading="jobsStore.loading">
        <Column header="Job">
          <template #body="{ data }">
            <strong>{{ data.title }}</strong><br />
            <small class="muted">{{ [data.department, data.location].filter(Boolean).join(" · ") || "No department or location" }}</small>
          </template>
        </Column>
        <Column v-if="auth.isAdmin" field="companyName" header="Company" />
        <Column header="Status">
          <template #body="{ data }">
            <Tag :value="JOB_STATUS_LABELS[data.status]" :severity="JOB_STATUS_SEVERITY[data.status]" />
          </template>
        </Column>
        <Column header="Type">
          <template #body="{ data }">{{ EMPLOYMENT_TYPE_LABELS[data.employmentType] || "Full time" }}</template>
        </Column>
        <Column header="Pay rate">
          <template #body="{ data }"><span data-test="pay-rate">{{ rateText(data, "pay") }}</span></template>
        </Column>
        <Column v-if="canManage" header="Bill rate">
          <template #body="{ data }"><span data-test="bill-rate">{{ rateText(data, "bill") }}</span></template>
        </Column>
        <Column header="Facility">
          <template #body="{ data }">{{ data.facilityName || "–" }}</template>
        </Column>
        <Column header="Expires">
          <template #body="{ data }">
            <span v-if="data.expiresAt">{{ data.expiresAt }}</span><span v-else>–</span>
            <Tag v-if="data.isExpired" value="Expired" severity="danger" class="job-tag" />
          </template>
        </Column>
        <Column header="Hiring manager">
          <template #body="{ data }">{{ data.hiringManagerName || "Not set" }}</template>
        </Column>
        <Column header="Applications">
          <template #body="{ data }">
            <span data-test="applications">{{ applicationsText(data) }}</span>
            <Tag v-if="data.isFull" value="Full" severity="warning" class="job-tag" />
          </template>
        </Column>
        <Column header="">
          <template #body="{ data }">
            <Button label="Board" icon="pi pi-th-large" size="small" text @click="openBoard(data)" />
            <template v-if="canManage">
              <Button label="Edit" size="small" text @click="openDialog(data)" />
              <Button v-if="data.status !== 'closed'" label="Close" size="small" text severity="secondary" @click="setStatus(data, 'closed')" />
              <Button v-else label="Reopen" size="small" text severity="success" @click="setStatus(data, 'open')" />
              <Button label="Delete" size="small" text severity="danger" @click="removeJob(data)" />
            </template>
          </template>
        </Column>
        <template #empty>
          <p class="jobs-empty">No jobs yet.<span v-if="canManage"> Use "Add job" above to create the first one.</span></p>
        </template>
      </DataTable>
    </section>

    <!-- Pipeline board -->
    <section v-if="tab === 'board'" class="panel-card" aria-label="Pipeline board">
      <div class="panel-heading">
        <div>
          <h3>Pipeline board</h3>
          <p class="muted">
            <template v-if="canMove">Drag a card to another column to change its stage, or use the stage menu on the card.</template>
            <template v-else>You can view the pipeline but not move candidates.</template>
          </p>
        </div>
        <Dropdown
          :model-value="selectedBoard"
          :options="boardOptions"
          option-label="label"
          option-value="value"
          placeholder="Choose a job"
          aria-label="Job"
          class="board-select"
          @update:model-value="loadBoard"
        />
      </div>

      <div class="board" :class="{ loading: store.boardLoading }">
        <section
          v-for="column in columns"
          :key="column.stage"
          class="board-column"
          :class="{ over: overStage === column.stage }"
          :aria-label="`${column.label} column`"
          @dragover.prevent="overStage = column.stage"
          @dragleave="overStage = ''"
          @drop="onDrop($event, column.stage)"
        >
          <header class="board-column__head">
            <Tag :value="column.label" :severity="STATUS_SEVERITY[column.stage]" />
            <span class="board-count" :aria-label="`${column.cards.length} candidates`">{{ column.cards.length }}</span>
          </header>

          <article
            v-for="card in column.cards"
            :key="card.id"
            class="board-card"
            :class="{ dragging: draggingId === card.id }"
            :draggable="canMove"
            @dragstart="onDragStart($event, card)"
            @dragend="draggingId = ''"
          >
            <div class="board-card__top">
              <button type="button" class="board-card__name" @click="store.selectCandidate(card.candidate.id)">{{ card.candidate.name }}</button>
              <span
                class="fit-badge"
                :class="`fit-${card.fit.level}`"
                :title="`${card.fit.label} for this job`"
                data-test="card-fit"
              >{{ card.fit.score }}</span>
            </div>
            <small class="muted">{{ card.candidate.role }}</small>
            <div class="board-card__meta">
              <small class="muted">Fit for this job</small>
              <i v-if="card.candidate.resumeId" class="pi pi-paperclip" title="Resume attached" aria-label="Resume attached"></i>
              <small v-if="card.candidate.ownerName" class="muted">{{ card.candidate.ownerName }}</small>
            </div>
            <ProfileMeter :candidate="card.candidate" compact />
            <div v-if="card.candidate.skills?.length" class="board-card__skills">
              <span v-for="skill in card.candidate.skills.slice(0, 3)" :key="skill" class="skill-chip">{{ skill }}</span>
            </div>
            <label v-if="canMove" class="board-card__move">
              <span class="sr-only">Move {{ card.candidate.name }} to stage</span>
              <select :value="card.status" :aria-label="`Move ${card.candidate.name} to stage`" @change="move(card.id, $event.target.value)">
                <option v-for="stage in PIPELINE_STAGES" :key="stage" :value="stage">{{ stageLabel(stage) }}</option>
              </select>
            </label>
          </article>

          <p v-if="!column.cards.length" class="board-empty">No candidates</p>
        </section>
      </div>
    </section>

    <!-- Job dialog -->
    <Dialog v-model:visible="dialogOpen" modal :header="editingId ? 'Edit job' : 'Add job'" class="job-dialog" :style="{ width: '48rem', maxWidth: '96vw' }">
      <div class="job-form">
        <p class="job-form__intro">{{ editingId ? "Change what you need and save." : "Fill in the basics first. Pay, limits and a description can be added now or later." }}</p>

        <section class="form-card">
          <header><i class="pi pi-briefcase" aria-hidden="true"></i><div><h4>Basics</h4><p>What the job is and where.</p></div></header>
          <label v-if="auth.isAdmin && !editingId" class="field"><span>Company *</span>
            <Dropdown v-model="form.companyId" :options="companyOptions" option-label="label" option-value="value" placeholder="Select a company" aria-label="Company" />
          </label>
          <label class="field"><span>Job title *</span>
            <InputText v-model="form.title" maxlength="120" placeholder="e.g. Registered Nurse" aria-label="Job title" />
          </label>
          <div class="job-form__row">
            <label class="field"><span>Department</span>
              <InputText v-model="form.department" maxlength="80" placeholder="e.g. Emergency" aria-label="Department" />
            </label>
            <label class="field"><span>Location</span>
              <InputText v-model="form.location" maxlength="120" placeholder="City or Remote" aria-label="Location" />
            </label>
          </div>
          <div class="job-form__row">
            <label class="field"><span>Employment type</span>
              <Dropdown v-model="form.employmentType" :options="employmentOptions" option-label="label" option-value="value" aria-label="Employment type" />
            </label>
            <label class="field"><span>Facility</span>
              <Dropdown v-model="form.facilityId" :options="facilityOptions" option-label="label" option-value="value" show-clear filter :placeholder="facilityOptions.length ? 'Choose a facility' : 'No facilities yet'" aria-label="Facility" />
              <Button v-if="!facilityDialogOpen" type="button" label="Add new facility" icon="pi pi-plus" size="small" text class="add-facility-link" :disabled="!formCompany" @click="openFacilityDialog" />
            </label>
          </div>
          <div v-if="facilityDialogOpen" class="new-facility" role="group" aria-label="New facility" data-test="new-facility">
            <h5><i class="pi pi-map-marker" aria-hidden="true"></i> New facility for {{ formCompany?.name || "this company" }}</h5>
            <p class="job-form__intro">It is saved for this company only. Other companies never see it.</p>
            <FacilityFields :model-value="facilityForm" :suggestions="facilityLocations" id-prefix="job-facility" />
            <Message v-if="facilityError" severity="error" :closable="false">{{ facilityError }}</Message>
            <div class="new-facility__actions">
              <Button type="button" label="Cancel" text severity="secondary" size="small" @click="facilityDialogOpen = false" />
              <Button type="button" label="Add facility" icon="pi pi-check" size="small" :loading="savingFacility" @click="saveFacility" />
            </div>
          </div>
        </section>

        <section class="form-card">
          <header><i class="pi pi-users" aria-hidden="true"></i><div><h4>Hiring</h4><p>Who is hiring and whether it is open.</p></div></header>
          <div class="job-form__row">
            <label class="field"><span>Status</span>
              <Dropdown v-model="form.status" :options="statusOptions" option-label="label" option-value="value" aria-label="Status" />
            </label>
            <label class="field"><span>Hiring manager</span>
              <Dropdown v-model="form.hiringManagerId" :options="managerOptions" option-label="label" option-value="value" show-clear placeholder="Not set" aria-label="Hiring manager" />
            </label>
          </div>
        </section>

        <section class="form-card">
          <header>
            <i class="pi pi-wallet" aria-hidden="true"></i>
            <div><h4>Pay and billing</h4><p>Ranges use the company's currencies. Bill rates are only visible to recruiters and admins.</p></div>
            <span v-if="rateSummary" class="rate-chip" data-test="rate-summary">{{ rateSummary }}</span>
          </header>
          <div class="job-form__row">
            <label class="field"><span>Currency</span>
              <Dropdown v-model="form.currency" :options="currencyOptions" option-label="label" option-value="value" aria-label="Currency" />
            </label>
            <label class="field"><span>Rates are</span>
              <Dropdown v-model="form.rateUnit" :options="rateUnitOptions" option-label="label" option-value="value" aria-label="Rate unit" />
            </label>
          </div>
          <div class="range-group">
            <span class="range-title">Pay rate</span>
            <div class="range-row">
              <label class="field"><span>Minimum</span>
                <InputNumber v-model="form.payRateMin" :min="0" :max-fraction-digits="2" placeholder="0" aria-label="Pay rate minimum" />
              </label>
              <span class="range-dash" aria-hidden="true">to</span>
              <label class="field"><span>Maximum</span>
                <InputNumber v-model="form.payRateMax" :min="0" :max-fraction-digits="2" placeholder="0" aria-label="Pay rate maximum" />
              </label>
            </div>
          </div>
          <div class="range-group">
            <span class="range-title">Bill rate</span>
            <div class="range-row">
              <label class="field"><span>Minimum</span>
                <InputNumber v-model="form.billRateMin" :min="0" :max-fraction-digits="2" placeholder="0" aria-label="Bill rate minimum" />
              </label>
              <span class="range-dash" aria-hidden="true">to</span>
              <label class="field"><span>Maximum</span>
                <InputNumber v-model="form.billRateMax" :min="0" :max-fraction-digits="2" placeholder="0" aria-label="Bill rate maximum" />
              </label>
            </div>
          </div>
        </section>

        <section class="form-card">
          <header><i class="pi pi-calendar" aria-hidden="true"></i><div><h4>Application limits</h4><p>Close the job automatically by date or by number of applicants.</p></div></header>
          <div class="job-form__row">
            <label class="field"><span>Job expires on</span>
              <input v-model="form.expiresAt" type="date" :min="todayIso()" class="date-input" aria-label="Job expiry date" />
            </label>
            <label class="field"><span>Maximum applications</span>
              <InputNumber v-model="form.maxApplications" :min="1" :use-grouping="false" placeholder="No limit" aria-label="Maximum applications" />
            </label>
          </div>
        </section>

        <section class="form-card">
          <header><i class="pi pi-align-left" aria-hidden="true"></i><div><h4>Description</h4><p>Skills, experience and duties. Used to work out how well candidates fit.</p></div></header>
          <Textarea v-model="form.description" rows="5" auto-resize maxlength="5000" placeholder="Describe the role…" aria-label="Description" />
          <small class="char-count">{{ (form.description || "").length }} / 5000</small>
        </section>

        <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
      </div>
      <template #footer>
        <Button label="Cancel" text severity="secondary" @click="dialogOpen = false" />
        <Button :label="editingId ? 'Save changes' : 'Add job'" icon="pi pi-check" :loading="saving" @click="saveJob" />
      </template>
    </Dialog>

    <CandidateDetailSidebar />
  </section>
</template>

<style scoped>
.jobs-tabs { display: flex; gap: 8px; padding: 8px 12px; border-radius: 12px; margin-bottom: 8px; max-width: fit-content; }
.jobs-tab { display: inline-flex; gap: 8px; align-items: center; border: 0; padding: 8px 14px; border-radius: 10px; background: transparent; color: #475569; font-weight: 600; cursor: pointer; }
.jobs-tab.active { background: #ffffff; color: var(--primary-700); box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12); }
.board-select { min-width: 16rem; }
.board { display: grid; grid-template-columns: repeat(5, minmax(15rem, 1fr)); gap: 12px; overflow-x: auto; padding-bottom: 8px; }
.board.loading { opacity: 0.6; }
.board-column { background: rgba(241, 245, 249, 0.8); border-radius: 12px; padding: 10px; min-height: 12rem; display: flex; flex-direction: column; gap: 8px; border: 2px dashed transparent; }
.board-column.over { border-color: var(--primary-500); background: rgba(219, 234, 254, 0.7); }
.board-column__head { display: flex; justify-content: space-between; align-items: center; }
.board-count { font-weight: 700; color: #475569; }
.board-card { background: #fff; border-radius: 10px; padding: 10px; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12); display: grid; gap: 4px; cursor: grab; }
.board-card.dragging { opacity: 0.4; }
.board-card__name { all: unset; font-weight: 700; color: #0f172a; cursor: pointer; }
.board-card__name:focus-visible { outline: 2px solid var(--primary-500); border-radius: 4px; }
.board-card__meta { display: flex; gap: 8px; align-items: center; }
.board-card__skills { display: flex; flex-wrap: wrap; gap: 4px; }
.board-card__move select { width: 100%; margin-top: 4px; padding: 4px 6px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; font: inherit; }
.board-empty { margin: 0; color: #94a3b8; font-size: 0.85rem; text-align: center; padding: 1rem 0; }
.job-form { display: grid; gap: 14px; }
.job-form__intro { margin: 0; color: var(--text-muted); font-size: 0.9rem; }
.form-card { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--surface-card); }
.form-card > header { display: flex; gap: 12px; align-items: flex-start; }
.form-card > header > i { width: 2.2rem; height: 2.2rem; border-radius: 10px; display: grid; place-items: center; background: var(--primary-50); color: var(--primary-600); flex-shrink: 0; }
.form-card > header h4 { margin: 0; font-size: 0.98rem; color: var(--text-primary); }
.form-card > header p { margin: 2px 0 0; font-size: 0.8rem; color: var(--text-muted); }
.rate-chip { margin-left: auto; align-self: center; padding: 4px 10px; border-radius: 999px; background: var(--primary-50); color: var(--primary-700); border: 1px solid var(--primary-100); font-size: 0.78rem; font-weight: 600; white-space: nowrap; }
.new-facility { display: grid; gap: 10px; padding: 14px; border: 1px dashed var(--primary-300); border-radius: var(--radius-md); background: var(--primary-50); }
.new-facility h5 { margin: 0; font-size: 0.92rem; color: var(--primary-700); display: flex; gap: 6px; align-items: center; }
.new-facility .job-form__intro { font-size: 0.8rem; }
.new-facility__actions { display: flex; justify-content: flex-end; gap: 8px; }
.add-facility-link { justify-self: start; padding-left: 0; }
.facility-error { margin-top: 10px; }
.field { display: grid; gap: 4px; min-width: 0; }
.field > span { font-weight: 600; font-size: 0.8rem; color: var(--text-secondary); }
.job-form :deep(.p-inputtext), .job-form :deep(.p-dropdown), .job-form :deep(.p-inputnumber), .job-form :deep(.p-inputtextarea) { width: 100%; }
.job-form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.range-group { display: grid; gap: 6px; padding: 12px; border-radius: var(--radius-sm); background: var(--surface-muted); }
.range-title { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.range-row { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: end; }
.range-dash { padding-bottom: 0.65rem; color: var(--text-muted); font-size: 0.85rem; }
.char-count { justify-self: end; color: var(--text-muted); font-size: 0.75rem; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
@media (max-width: 768px) { .job-form__row, .range-row { grid-template-columns: 1fr; } .range-dash { display: none; } }
.jobs-empty { margin: 0; padding: 8px 0; color: #64748b; }
.board-card__top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.fit-badge { min-width: 2.2rem; text-align: center; padding: 2px 8px; border-radius: 999px; font-weight: 800; font-size: 0.85rem; color: #fff; background: #94a3b8; }
.fit-badge.fit-strong { background: #10b981; }
.fit-badge.fit-good { background: var(--primary-500); }
.fit-badge.fit-partial { background: #f59e0b; }
.fit-badge.fit-weak { background: #ef4444; }
.date-input { height: 2.5rem; padding: 0 0.7rem; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); font: inherit; background: #fff; width: 100%; }
.job-tag { margin-left: 6px; }
</style>
