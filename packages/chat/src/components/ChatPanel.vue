<script setup>
import { computed, onMounted, ref, watch } from "vue";
import ConversationList from "./ConversationList.vue";
import MessageThread from "./MessageThread.vue";
import NewConversationModal from "./NewConversationModal.vue";
import useChat from "../composables/useChat.js";

const props = defineProps({
  candidates: {
    type: Array,
    default: () => []
  },
  apiBase: {
    type: String,
    required: true
  }
});

const isModalOpen = ref(false);
const chat = useChat();

const activeConversation = computed(() => {
  return (
    chat.conversations.value.find(
      (conversation) => conversation.id === chat.activeConversationId.value
    ) || null
  );
});

const activeMessages = computed(() => {
  return chat.messages[chat.activeConversationId.value] || [];
});

const conversationItems = computed(() => chat.conversations.value || []);
const activeConversationId = computed(() => chat.activeConversationId.value || "");
const chatError = computed(() => chat.error.value || "");
const isSending = computed(() => chat.sending.value);
const scheduledItems = computed(() => {
  return Object.values(chat.scheduledQueue).filter(
    (item) => item.conversationId === chat.activeConversationId.value
  );
});

async function selectConversation(conversationId) {
  await chat.fetchMessages(props.apiBase, conversationId);
}

async function handleCreateConversation(payload) {
  const conversation = await chat.createConversation(
    props.apiBase,
    payload.candidateIds,
    payload.type,
    payload.title
  );

  isModalOpen.value = false;
  await chat.fetchMessages(props.apiBase, conversation.id);
}

async function handleSend(payload) {
  if (typeof payload === "string") {
    await chat.sendMessage(props.apiBase, chat.activeConversationId.value, payload);
    return;
  }

  if (payload?.sendAt) {
    chat.scheduleMessage(props.apiBase, chat.activeConversationId.value, payload);
    return;
  }

  await chat.sendMessage(props.apiBase, chat.activeConversationId.value, payload);
}

onMounted(async () => {
  const conversations = await chat.fetchConversations(props.apiBase);
  if (conversations.length > 0 && chat.activeConversationId.value) {
    await chat.fetchMessages(props.apiBase, chat.activeConversationId.value);
  }
});

watch(
  () => props.apiBase,
  async (nextApiBase, previousApiBase) => {
    if (!nextApiBase || nextApiBase === previousApiBase) {
      return;
    }

    const conversations = await chat.fetchConversations(nextApiBase);
    if (conversations.length > 0 && chat.activeConversationId.value) {
      await chat.fetchMessages(nextApiBase, chat.activeConversationId.value);
    }
  }
);
</script>

<template>
  <section class="chat-panel">
    <div class="chat-panel__shell">
      <ConversationList
        :conversations="conversationItems"
        :active-conversation-id="activeConversationId"
        @new-chat="isModalOpen = true"
        @select="selectConversation"
      />

      <div class="chat-panel__thread">
        <div v-if="chatError" class="chat-panel__error">
          {{ chatError }}
        </div>
        <MessageThread
          :conversation="activeConversation"
          :messages="activeMessages"
          :sending="isSending"
          @send="handleSend"
        />
        <div v-if="scheduledItems.length" class="scheduled-list">
          <p>Scheduled messages</p>
          <ul>
            <li v-for="item in scheduledItems" :key="`${item.sendAt}-${item.text}`">
              {{ new Date(item.sendAt).toLocaleString() }} · {{ item.text || "Attachment only message" }}
            </li>
          </ul>
        </div>
      </div>
    </div>

    <NewConversationModal
      :candidates="candidates"
      :open="isModalOpen"
      @close="isModalOpen = false"
      @create="handleCreateConversation"
    />
  </section>
</template>

<style scoped>
.chat-panel {
  min-width: 0;
}

.chat-panel__shell {
  display: grid;
  grid-template-columns: minmax(18rem, 24rem) minmax(0, 1fr);
  gap: 1.25rem;
  align-items: start;
}

.chat-panel__thread {
  min-width: 0;
}

.chat-panel__error {
  margin-bottom: 0.85rem;
  border: 1px solid #fecaca;
  border-radius: 1rem;
  background: #fff1f2;
  color: #9f1239;
  padding: 0.9rem 1rem;
}

.scheduled-list {
  margin-top: 0.75rem;
  border: 1px solid #bfdbfe;
  background: #eff6ff;
  border-radius: 0.9rem;
  padding: 0.65rem 0.85rem;
  color: #1e3a8a;
}

.scheduled-list p {
  margin: 0 0 0.35rem;
  font-weight: 700;
  font-size: 0.84rem;
}

.scheduled-list ul {
  margin: 0;
  padding-left: 1rem;
}

.scheduled-list li {
  font-size: 0.82rem;
}

@media (max-width: 1000px) {
  .chat-panel__shell {
    grid-template-columns: 1fr;
  }
}
</style>
