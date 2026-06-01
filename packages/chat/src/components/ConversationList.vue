<script setup>
import { computed } from "vue";
import { formatTimestamp, getInitials } from "../utils/chatHelpers.js";

const props = defineProps({
  conversations: {
    type: Array,
    default: () => []
  },
  activeConversationId: {
    type: String,
    default: ""
  }
});

const emit = defineEmits(["select", "new-chat"]);

const sortedConversations = computed(() => {
  return [...props.conversations].sort((left, right) => {
    const leftDate = new Date(left.updatedAt || left.createdAt || 0).getTime();
    const rightDate = new Date(right.updatedAt || right.createdAt || 0).getTime();
    return rightDate - leftDate;
  });
});
</script>

<template>
  <aside class="conversation-list">
    <div class="conversation-list__header">
      <div>
        <p class="conversation-list__eyebrow">Candidate chat</p>
        <h3>Conversations</h3>
      </div>
      <button class="conversation-list__new" type="button" @click="emit('new-chat')">
        New chat
      </button>
    </div>

    <div v-if="sortedConversations.length === 0" class="conversation-list__empty">
      Start a new chat to message candidates from the recruiting workspace.
    </div>

    <button
      v-for="conversation in sortedConversations"
      :key="conversation.id"
      class="conversation-item"
      :class="{ 'conversation-item--active': conversation.id === activeConversationId }"
      type="button"
      @click="emit('select', conversation.id)"
    >
      <div class="conversation-item__avatar">
        {{ getInitials(conversation.title) }}
      </div>
      <div class="conversation-item__body">
        <div class="conversation-item__topline">
          <strong>{{ conversation.title }}</strong>
          <span>{{ formatTimestamp(conversation.updatedAt || conversation.createdAt) }}</span>
        </div>
        <p>
          {{ conversation.lastMessage?.text || "No messages yet" }}
        </p>
      </div>
    </button>
  </aside>
</template>

<style scoped>
.conversation-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

.conversation-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.conversation-list__eyebrow {
  margin: 0 0 0.25rem;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6b7280;
}

.conversation-list__header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.conversation-list__new {
  border: none;
  border-radius: 999px;
  background: #0f766e;
  color: #fff;
  padding: 0.65rem 1rem;
  font-weight: 600;
  cursor: pointer;
}

.conversation-list__empty {
  border: 1px dashed #cbd5e1;
  border-radius: 1rem;
  padding: 1rem;
  color: #64748b;
  background: #f8fafc;
}

.conversation-item {
  display: grid;
  grid-template-columns: 2.75rem 1fr;
  gap: 0.9rem;
  align-items: start;
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 1rem;
  background: #fff;
  padding: 0.9rem;
  text-align: left;
  cursor: pointer;
}

.conversation-item--active {
  border-color: #0f766e;
  box-shadow: 0 0 0 1px #0f766e inset;
  background: #f0fdfa;
}

.conversation-item__avatar {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 999px;
  background: linear-gradient(135deg, #0f766e, #14b8a6);
  color: #fff;
  font-weight: 700;
}

.conversation-item__body {
  min-width: 0;
}

.conversation-item__topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.35rem;
}

.conversation-item__topline strong,
.conversation-item__body p {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-item__topline span {
  font-size: 0.76rem;
  color: #64748b;
  flex-shrink: 0;
}

.conversation-item__body p {
  margin: 0;
  font-size: 0.9rem;
  color: #475569;
}
</style>
