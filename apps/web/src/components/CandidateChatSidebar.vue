<script setup>
import { ref, computed, watch } from "vue";
import Button from "primevue/button";
import Sidebar from "primevue/sidebar";
import { useChat, MessageThread, getInitials } from "@acmp/chat";
import { useCandidateStore } from "../stores/candidates";

const props = defineProps({
  visible: {
    type: Boolean,
    required: true
  },
  candidate: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(["update:visible"]);

const store = useCandidateStore();
const chat = useChat();
const loadingConversation = ref(false);

const visibleModel = computed({
  get: () => props.visible,
  set: (val) => emit("update:visible", val)
});

const activeConversation = computed(() => {
  return (
    chat.conversations.value.find(
      (c) => c.id === chat.activeConversationId.value
    ) || null
  );
});

const activeMessages = computed(() => {
  return chat.messages[chat.activeConversationId.value] || [];
});

async function initializeChat() {
  if (!props.candidate) return;
  
  loadingConversation.value = true;
  chat.error.value = "";
  
  try {
    const list = await chat.fetchConversations(store.apiBaseUrl);
    const targetCandidateId = String(props.candidate.id);
    
    const existing = list.find(
      (c) =>
        c.type === "individual" &&
        c.candidateIds.map(String).includes(targetCandidateId)
    );
    
    if (existing) {
      chat.activeConversationId.value = existing.id;
      await chat.fetchMessages(store.apiBaseUrl, existing.id);
    } else {
      const newConv = await chat.createConversation(
        store.apiBaseUrl,
        [targetCandidateId],
        "individual",
        props.candidate.name
      );
      chat.activeConversationId.value = newConv.id;
      await chat.fetchMessages(store.apiBaseUrl, newConv.id);
    }
  } catch (err) {
    console.error("Failed to initialize direct candidate chat:", err);
    chat.error.value = err.message || "Could not open chat with the candidate.";
  } finally {
    loadingConversation.value = false;
  }
}

async function handleSend(text) {
  if (chat.activeConversationId.value) {
    await chat.sendMessage(store.apiBaseUrl, chat.activeConversationId.value, text);
  }
}

watch(
  () => props.visible,
  (newVal) => {
    if (newVal && props.candidate) {
      initializeChat();
    }
  }
);

watch(
  () => props.candidate,
  (newCandidate) => {
    if (props.visible && newCandidate) {
      initializeChat();
    }
  }
);
</script>

<template>
  <Sidebar
    v-model:visible="visibleModel"
    position="right"
    class="candidate-drawer candidate-chat-drawer"
    :style="{ width: '32rem' }"
  >
    <template #header>
      <div class="drawer-header" v-if="candidate">
        <div class="avatar-badge">
          {{ getInitials(candidate.name) }}
        </div>
        <div>
          <h3>Chat with {{ candidate.name }}</h3>
          <p class="muted-text">{{ candidate.role }}</p>
        </div>
      </div>
    </template>

    <div class="drawer-body">
      <div v-if="loadingConversation" class="chat-loading">
        <i class="pi pi-spin pi-spinner"></i>
        <p>Loading conversation...</p>
      </div>

      <div v-else-if="chat.error.value" class="chat-error">
        <p>{{ chat.error.value }}</p>
        <Button label="Retry" severity="danger" outlined @click="initializeChat" />
      </div>

      <div v-else class="chat-thread-container">
        <MessageThread
          :conversation="activeConversation"
          :messages="activeMessages"
          :sending="chat.sending.value"
          @send="handleSend"
        />
      </div>
    </div>
  </Sidebar>
</template>

<style scoped>
.drawer-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar-badge {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: linear-gradient(135deg, #10b981, #059669);
  color: white;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 1.1rem;
}

.drawer-header h3 {
  margin: 0;
  font-size: 1.1rem;
  color: #0f172a;
}

.muted-text {
  color: #64748b;
  font-size: 0.82rem;
  margin: 2px 0 0;
}

.drawer-body {
  height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
}

.chat-loading, .chat-error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #64748b;
  font-size: 0.9rem;
}

.chat-loading i {
  font-size: 2rem;
  color: #3b82f6;
}

.chat-error {
  color: #ef4444;
  padding: 20px;
  text-align: center;
}

.chat-thread-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* Make the reusable message thread fit beautifully without a double border inside sidebar */
:deep(.message-thread) {
  border: none;
  border-radius: 0;
  background: transparent;
  flex: 1;
  height: 100%;
  min-height: 0;
}

:deep(.message-thread__header) {
  display: none; /* Hide header inside sidebar since we have sidebar header */
}

:deep(.message-thread__body) {
  padding: 10px 0;
}

:deep(.message-thread__composer) {
  padding: 10px 0 0;
  background: transparent;
}
</style>
