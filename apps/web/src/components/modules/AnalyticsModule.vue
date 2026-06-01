<script setup>
import { computed } from "vue";
import { useCandidateStore } from "../../stores/candidates";

const store = useCandidateStore();

const insightCards = computed(() => {
  const shortlistRate = store.dashboard.totalCandidates
    ? Math.round(
        (store.dashboard.shortlisted / store.dashboard.totalCandidates) * 100
      )
    : 0;

  return [
    {
      label: "Resolved API",
      value: store.apiBaseUrl.replace(/^https?:\/\//, ""),
      note: store.backendReady ? "Backend reachable" : "Backend unavailable",
      colorClass: "api-card"
    },
    {
      label: "Data mode",
      value: store.usingMemoryStore ? "Demo" : "MongoDB",
      note: store.usingMemoryStore
        ? "Safe local fallback"
        : "Persistent storage enabled",
      colorClass: "mode-card"
    },
    {
      label: "Shortlist rate",
      value: `${shortlistRate}%`,
      note: "Percentage in Interview, Offer, or Hired stages",
      colorClass: "shortlist-card"
    },
    {
      label: "Total Pipeline Score",
      value: `${store.dashboard.averageScore}%`,
      note: "Average match score of all profiles",
      colorClass: "score-card"
    }
  ];
});

// Calculate statistics from the candidates list
const pipelineStats = computed(() => {
  const cands = store.candidates;
  const total = cands.length;

  const counts = {
    screening: 0,
    interview: 0,
    offer: 0,
    hired: 0,
    rejected: 0
  };

  cands.forEach((c) => {
    if (counts[c.status] !== undefined) {
      counts[c.status]++;
    }
  });

  return [
    { label: "Screening Review", count: counts.screening, status: "screening", percentage: total ? Math.round((counts.screening / total) * 100) : 0, color: "var(--p-info-color, #3b82f6)" },
    { label: "Active Interviews", count: counts.interview, status: "interview", percentage: total ? Math.round((counts.interview / total) * 100) : 0, color: "var(--p-warn-color, #f59e0b)" },
    { label: "Offers Extended", count: counts.offer, status: "offer", percentage: total ? Math.round((counts.offer / total) * 100) : 0, color: "var(--p-success-color, #10b981)" },
    { label: "Successfully Hired", count: counts.hired, status: "hired", percentage: total ? Math.round((counts.hired / total) * 100) : 0, color: "#06b6d4" },
    { label: "Archived / Rejected", count: counts.rejected, status: "rejected", percentage: total ? Math.round((counts.rejected / total) * 100) : 0, color: "#ef4444" }
  ];
});

// Calculate most requested skills in pipeline
const popularSkills = computed(() => {
  const skillCounts = {};
  store.candidates.forEach((c) => {
    if (Array.isArray(c.skills)) {
      c.skills.forEach((skill) => {
        skillCounts[skill] = (skillCounts[skill] || 0) + 1;
      });
    }
  });

  return Object.entries(skillCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8); // Top 8 skills
});

// Experience groups
const experienceSpread = computed(() => {
  const cands = store.candidates;
  let junior = 0; // 0-3 yrs
  let mid = 0;    // 4-6 yrs
  let senior = 0; // 7+ yrs

  cands.forEach((c) => {
    const exp = Number(c.experienceYears || 0);
    if (exp <= 3) junior++;
    else if (exp <= 6) mid++;
    else senior++;
  });

  const total = cands.length;

  return [
    { label: "Junior (0-3 Yrs)", count: junior, percentage: total ? Math.round((junior / total) * 100) : 0 },
    { label: "Mid-level (4-6 Yrs)", count: mid, percentage: total ? Math.round((mid / total) * 100) : 0 },
    { label: "Senior Expert (7+ Yrs)", count: senior, percentage: total ? Math.round((senior / total) * 100) : 0 }
  ];
});
</script>

<template>
  <section class="analytics-wrapper">
    <!-- Top KPI Dashboard Cards -->
    <section class="analytics-grid">
      <article
        v-for="card in insightCards"
        :key="card.label"
        class="analytics-card"
        :class="card.colorClass"
      >
        <span class="label">{{ card.label }}</span>
        <strong class="value">{{ card.value }}</strong>
        <p class="muted">{{ card.note }}</p>
      </article>
    </section>

    <!-- Detailed Visual Intelligence Layout -->
    <div class="visuals-grid">
      <!-- 1) Funnel progression -->
      <article class="panel-card funnel-card">
        <div class="panel-header">
          <h4>Recruitment Pipeline Funnel</h4>
          <p class="muted-text">Real-time candidate conversion distribution across stages</p>
        </div>
        <div class="funnel-container">
          <div
            v-for="item in pipelineStats"
            :key="item.label"
            class="funnel-row"
          >
            <div class="funnel-label-group">
              <span class="f-lbl">{{ item.label }}</span>
              <span class="f-cnt">{{ item.count }} ({{ item.percentage }}%)</span>
            </div>
            <div class="funnel-progress-bg">
              <div
                class="funnel-progress-bar"
                :style="{
                  width: `${Math.max(item.percentage, 2)}%`,
                  backgroundColor: item.color
                }"
              ></div>
            </div>
          </div>
        </div>
      </article>

      <!-- 2) Skills & Exp breakdown -->
      <div class="secondary-visuals">
        <!-- Experience breakdown -->
        <article class="panel-card exp-card">
          <div class="panel-header">
            <h4>Seniority Experience Spread</h4>
            <p class="muted-text">Distribution of experience levels</p>
          </div>
          <div class="exp-container">
            <div v-for="item in experienceSpread" :key="item.label" class="exp-row">
              <div class="exp-meta">
                <span>{{ item.label }}</span>
                <strong>{{ item.count }} Candidates</strong>
              </div>
              <div class="exp-bar-bg">
                <div class="exp-bar-fill" :style="{ width: `${item.percentage}%` }"></div>
              </div>
            </div>
          </div>
        </article>

        <!-- Top skill cloud -->
        <article class="panel-card skill-cloud-card">
          <div class="panel-header">
            <h4>Talent Skill Density</h4>
            <p class="muted-text">Most frequent skillsets in active pipeline</p>
          </div>
          <div class="skill-cloud">
            <div
              v-for="skill in popularSkills"
              :key="skill.name"
              class="cloud-chip"
              :style="{
                opacity: 0.5 + (skill.count / store.candidates.length) * 0.5,
                transform: `scale(${1 + (skill.count / store.candidates.length) * 0.15})`
              }"
            >
              <span class="c-name">{{ skill.name }}</span>
              <span class="c-badge">{{ skill.count }}</span>
            </div>
            <div v-if="!popularSkills.length" class="empty-state">
              No skill tags cataloged yet. Seed candidates to view.
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.analytics-wrapper {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.api-card {
  border-left: 4px solid #3b82f6;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.05), rgba(255, 255, 255, 0.9));
}

.mode-card {
  border-left: 4px solid #8b5cf6;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.05), rgba(255, 255, 255, 0.9));
}

.shortlist-card {
  border-left: 4px solid #10b981;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.05), rgba(255, 255, 255, 0.9));
}

.score-card {
  border-left: 4px solid #06b6d4;
  background: linear-gradient(135deg, rgba(6, 182, 212, 0.05), rgba(255, 255, 255, 0.9));
}

.visuals-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(320px, 1fr);
  gap: 20px;
}

.secondary-visuals {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.panel-header {
  margin-bottom: 16px;
}

.panel-header h4 {
  margin: 0;
  color: #1e293b;
  font-size: 1.05rem;
}

.muted-text {
  color: #64748b;
  font-size: 0.82rem;
  margin: 4px 0 0;
}

/* Funnel container styling */
.funnel-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.funnel-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.funnel-label-group {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  font-weight: 600;
  color: #475569;
}

.funnel-progress-bg {
  height: 14px;
  background: #f1f5f9;
  border-radius: 999px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
}

.funnel-progress-bar {
  height: 100%;
  border-radius: 999px;
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Seniority styling */
.exp-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.exp-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.exp-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.84rem;
  color: #475569;
}

.exp-meta strong {
  color: #1e293b;
}

.exp-bar-bg {
  height: 8px;
  background: #f1f5f9;
  border-radius: 4px;
  overflow: hidden;
}

.exp-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #6366f1);
  border-radius: 4px;
  transition: width 0.5s ease;
}

/* Skill Density Cloud */
.skill-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding: 10px 0;
}

.cloud-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(59, 130, 246, 0.05);
  border: 1px solid rgba(59, 130, 246, 0.12);
  border-radius: 8px;
  transition: all 0.2s ease;
  cursor: default;
}

.cloud-chip:hover {
  background: rgba(59, 130, 246, 0.1);
  transform: translateY(-2px) scale(1.05) !important;
}

.c-name {
  font-size: 0.84rem;
  font-weight: 600;
  color: #1e293b;
}

.c-badge {
  font-size: 0.72rem;
  background: #3b82f6;
  color: white;
  padding: 1px 6px;
  border-radius: 999px;
  font-weight: 700;
}

.empty-state {
  font-size: 0.82rem;
  color: #94a3b8;
  font-style: italic;
  width: 100%;
  text-align: center;
  padding: 15px 0;
}

@media (max-width: 960px) {
  .visuals-grid {
    grid-template-columns: 1fr;
  }
}
</style>
