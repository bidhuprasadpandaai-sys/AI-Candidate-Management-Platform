<script setup>
import { ref } from "vue";
import CandidateList from "../CandidateList.vue";
import { ChatPanel } from "@acmp/chat";
import { useCandidateStore } from "../../stores/candidates";

const store = useCandidateStore();
const activeSubTab = ref("pipeline");
</script>

<template>
  <section class="content-grid">
    <div class="candidates-sub-nav glassmorphic-inset">
      <button
        class="sub-tab-btn"
        :class="{ active: activeSubTab === 'pipeline' }"
        @click="activeSubTab = 'pipeline'"
      >
        <i class="pi pi-users"></i>
        Candidate Pipeline
      </button>
      <button
        class="sub-tab-btn"
        :class="{ active: activeSubTab === 'chat' }"
        @click="activeSubTab = 'chat'"
      >
        <i class="pi pi-comments"></i>
        Chat History
      </button>
    </div>

    <div v-show="activeSubTab === 'pipeline'">
      <CandidateList @switch-to-chat="activeSubTab = 'chat'" />
    </div>

    <div v-show="activeSubTab === 'chat'">
      <section class="panel-card">
        <div class="panel-heading">
          <div>
            <h3>Chat history</h3>
            <p class="muted">Interact and chat with candidates directly from TalentOS.</p>
          </div>
        </div>
        <ChatPanel :candidates="store.candidates" :api-base="store.apiBaseUrl" />
      </section>
    </div>
  </section>
</template>

<style scoped>
.candidates-sub-nav {
  display: flex;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 12px;
  margin-bottom: 8px;
  max-width: fit-content;
}

.sub-tab-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.9rem;
}

.sub-tab-btn i {
  font-size: 1rem;
}

.sub-tab-btn:hover {
  background: rgba(59, 130, 246, 0.05);
  color: var(--text-primary);
}

.sub-tab-btn.active {
  background: var(--primary-gradient);
  color: white;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
}
</style>

