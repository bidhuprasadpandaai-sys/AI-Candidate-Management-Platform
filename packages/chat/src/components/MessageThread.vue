<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { formatTimestamp, getInitials } from "../utils/chatHelpers.js";

const props = defineProps({
  conversation: {
    type: Object,
    default: null
  },
  messages: {
    type: Array,
    default: () => []
  },
  sending: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(["send"]);

const draft = ref("");
const threadBody = ref(null);
const showEmojiPicker = ref(false);
const attachmentInput = ref(null);
const attachments = ref([]);
const sendLaterAt = ref("");
const emojis = ["😀", "😁", "😂", "😊", "😍", "👍", "🎯", "🔥", "✅", "🙏", "📎", "💼"];

const canSend = computed(() => {
  return (
    !props.sending &&
    (draft.value.trim().length > 0 || attachments.value.length > 0)
  );
});

async function scrollToBottom() {
  await nextTick();
  const element = threadBody.value;
  if (element) {
    element.scrollTop = element.scrollHeight;
  }
}

function handleSend() {
  const text = draft.value.trim();
  if (!text && attachments.value.length === 0) {
    return;
  }

  const payload = {
    text,
    attachments: attachments.value.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
      content: file.content || ""
    })),
    sendAt: sendLaterAt.value || null
  };

  emit("send", payload);
  clearComposer();
}

function clearComposer() {
  draft.value = "";
  attachments.value = [];
  sendLaterAt.value = "";
}

function addEmoji(emoji) {
  draft.value = `${draft.value}${emoji}`;
}

function openAttachmentPicker() {
  attachmentInput.value?.click();
}

async function handleAttachments(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) {
    return;
  }

  const withContent = await Promise.all(
    files.map(async (file) => {
      const content = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => resolve("");
        reader.readAsDataURL(file);
      });

      return {
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        size: file.size,
        type: file.type,
        content
      };
    })
  );

  attachments.value = [
    ...attachments.value,
    ...withContent
  ];

  event.target.value = "";
}

function removeAttachment(id) {
  attachments.value = attachments.value.filter((file) => file.id !== id);
}

watch(
  () => props.messages,
  async () => {
    await scrollToBottom();
  },
  { deep: true, immediate: true }
);

watch(
  () => props.conversation?.id,
  async () => {
    await scrollToBottom();
  }
);
</script>

<template>
  <section class="message-thread">
    <div v-if="conversation" class="message-thread__header">
      <div class="message-thread__title">
        <div class="message-thread__avatar">
          {{ getInitials(conversation.title) }}
        </div>
        <div>
          <h3>{{ conversation.title }}</h3>
          <p>{{ conversation.type === "group" ? "Group conversation" : "Individual conversation" }}</p>
        </div>
      </div>
    </div>

    <div v-if="conversation" ref="threadBody" class="message-thread__body">
      <div v-if="messages.length === 0" class="message-thread__empty">
        Send the first message to start this conversation.
      </div>

      <article
        v-for="message in messages"
        :key="message.id"
        class="message-bubble"
        :class="{
          'message-bubble--recruiter': message.sender === 'recruiter',
          'message-bubble--candidate': message.sender === 'candidate'
        }"
      >
        <strong>{{ message.senderName }}</strong>
        <p>{{ message.text }}</p>
        <div v-if="message.attachments?.length" class="bubble-attachments">
          <a
            v-for="(file, fileIndex) in message.attachments"
            :key="`${message.id}-file-${fileIndex}`"
            :href="file.content || '#'"
            :download="file.name"
            class="bubble-attachment-link"
          >
            📎 {{ file.name }}
          </a>
        </div>
        <span>{{ formatTimestamp(message.createdAt) }}</span>
      </article>
    </div>

    <div v-else class="message-thread__placeholder">
      Select a conversation or start a new chat from the sidebar.
    </div>

    <form v-if="conversation" class="message-thread__composer" @submit.prevent="handleSend">
      <div class="composer-tools">
        <input
          ref="attachmentInput"
          type="file"
          class="file-hidden"
          multiple
          @change="handleAttachments"
        />
        <button type="button" class="tool-btn" @click="openAttachmentPicker">📎 Attach</button>
        <button type="button" class="tool-btn" @click="showEmojiPicker = !showEmojiPicker">😊 Emoji</button>
        <label class="send-later">
          <span>Send later</span>
          <input v-model="sendLaterAt" type="datetime-local" />
        </label>
      </div>

      <div v-if="attachments.length" class="attachment-list">
        <div v-for="file in attachments" :key="file.id" class="attachment-chip">
          <span>{{ file.name }}</span>
          <button type="button" @click="removeAttachment(file.id)">×</button>
        </div>
      </div>

      <div v-if="showEmojiPicker" class="emoji-picker">
        <button v-for="emoji in emojis" :key="emoji" type="button" @click="addEmoji(emoji)">{{ emoji }}</button>
      </div>

      <textarea
        v-model="draft"
        rows="3"
        placeholder="Write a message to the candidate..."
      />
      <button type="submit" :disabled="!canSend">
        {{ sending ? "Sending..." : sendLaterAt ? "Schedule message" : "Send message" }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.message-thread {
  display: flex;
  flex-direction: column;
  min-height: 38rem;
  background: linear-gradient(180deg, #fcfffd 0%, #f8fafc 100%);
  border: 1px solid #dbe4ea;
  border-radius: 1.4rem;
  overflow: hidden;
}

.message-thread__header {
  padding: 1.25rem 1.25rem 1rem;
  border-bottom: 1px solid #e2e8f0;
  background: rgba(255, 255, 255, 0.92);
}

.message-thread__title {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}

.message-thread__avatar {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: 999px;
  background: linear-gradient(135deg, #134e4a, #14b8a6);
  color: #fff;
  font-weight: 700;
}

.message-thread__title h3,
.message-thread__title p {
  margin: 0;
}

.message-thread__title p {
  color: #64748b;
  font-size: 0.9rem;
}

.message-thread__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
  overflow-y: auto;
}

.message-thread__empty,
.message-thread__placeholder {
  margin: auto;
  max-width: 22rem;
  text-align: center;
  color: #64748b;
}

.message-bubble {
  max-width: 75%;
  border-radius: 1.1rem;
  padding: 0.9rem 1rem;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
}

.message-bubble strong,
.message-bubble p,
.message-bubble span {
  display: block;
}

.message-bubble strong {
  margin-bottom: 0.35rem;
  font-size: 0.82rem;
}

.message-bubble p {
  margin: 0 0 0.45rem;
  line-height: 1.45;
  white-space: pre-wrap;
}

.bubble-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0 0 0.45rem;
}

.bubble-attachment-link {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: 0.75rem;
  text-decoration: none;
  color: inherit;
  border: 1px solid rgba(226, 232, 240, 0.7);
  border-radius: 999px;
  padding: 0.2rem 0.45rem;
  background: rgba(255, 255, 255, 0.15);
}

.message-bubble span {
  font-size: 0.76rem;
  opacity: 0.8;
}

.message-bubble--recruiter {
  align-self: flex-end;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  color: #eff6ff;
}

.message-bubble--candidate {
  align-self: flex-start;
  background: #e5e7eb;
  color: #1f2937;
}

.message-thread__composer {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.85rem;
  padding: 1rem 1.25rem 1.25rem;
  border-top: 1px solid #e2e8f0;
  background: rgba(255, 255, 255, 0.92);
}

.composer-tools {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  align-items: center;
}

.tool-btn {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  border-radius: 999px;
  padding: 0.45rem 0.8rem;
  font-weight: 600;
  cursor: pointer;
}

.send-later {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-left: auto;
  color: #475569;
  font-size: 0.84rem;
}

.send-later input {
  border: 1px solid #cbd5e1;
  border-radius: 0.6rem;
  padding: 0.35rem 0.55rem;
}

.file-hidden {
  display: none;
}

.attachment-list {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  border-radius: 999px;
  padding: 0.35rem 0.6rem;
  font-size: 0.8rem;
}

.attachment-chip button {
  border: 0;
  background: transparent;
  color: #475569;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
}

.emoji-picker {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  border: 1px solid #e2e8f0;
  border-radius: 0.8rem;
  padding: 0.45rem;
  background: #ffffff;
}

.emoji-picker button {
  border: 0;
  background: #f8fafc;
  border-radius: 0.45rem;
  padding: 0.25rem 0.35rem;
  cursor: pointer;
}


.message-thread__composer textarea {
  width: 100%;
  resize: vertical;
  min-height: 5rem;
  border: 1px solid #cbd5e1;
  border-radius: 1rem;
  padding: 0.85rem 1rem;
  font: inherit;
}

.message-thread__composer button {
  align-self: end;
  border: none;
  border-radius: 999px;
  background: #0f766e;
  color: #fff;
  padding: 0.85rem 1.2rem;
  font-weight: 700;
  cursor: pointer;
}

.message-thread__composer button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (max-width: 900px) {
  .message-thread {
    min-height: 28rem;
  }

  .message-bubble {
    max-width: 88%;
  }

  .message-thread__composer {
    grid-template-columns: 1fr;
  }
}
</style>
