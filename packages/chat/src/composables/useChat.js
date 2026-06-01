import axios from "axios";
import { reactive, ref } from "vue";
import { generateCandidateReply } from "../utils/chatHelpers.js";

function createClient(apiBase) {
  return axios.create({
    baseURL: apiBase,
    timeout: 10000
  });
}

function normalizeConversation(conversation = {}) {
  const lastMessage = conversation.lastMessage || null;

  return {
    id: String(conversation.id || conversation._id || ""),
    type: conversation.type || "individual",
    title: conversation.title || "Untitled conversation",
    candidateIds: Array.isArray(conversation.candidateIds) ? conversation.candidateIds : [],
    participants: Array.isArray(conversation.participants) ? conversation.participants : [],
    createdAt: conversation.createdAt || null,
    updatedAt: conversation.updatedAt || null,
    lastMessage: lastMessage
      ? {
          id: String(lastMessage.id || lastMessage._id || ""),
          text: lastMessage.text || "",
          sender: lastMessage.sender || "candidate",
          senderName: lastMessage.senderName || ""
        }
      : null
  };
}

function normalizeMessage(message = {}) {
  return {
    id: String(message.id || message._id || ""),
    conversationId: String(message.conversationId || ""),
    sender: message.sender || "candidate",
    senderName: message.senderName || "",
    text: message.text || "",
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    createdAt: message.createdAt || new Date().toISOString()
  };
}
const conversations = ref([]);
const activeConversationId = ref("");
const messages = reactive({});
const loading = ref(false);
const sending = ref(false);
const error = ref("");
const scheduledQueue = reactive({});

export default function useChat() {

  async function fetchConversations(apiBase) {
    loading.value = true;
    error.value = "";

    try {
      const client = createClient(apiBase);
      const { data } = await client.get("/conversations");
      conversations.value = Array.isArray(data.conversations)
        ? data.conversations.map(normalizeConversation)
        : [];

      if (
        !activeConversationId.value &&
        conversations.value.length > 0
      ) {
        activeConversationId.value = conversations.value[0].id;
      }

      return conversations.value;
    } catch (err) {
      error.value = err.message || "Unable to load conversations.";
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function createConversation(apiBase, candidateIds, type, title) {
    const client = createClient(apiBase);
    const { data } = await client.post("/conversations", {
      candidateIds,
      type,
      title
    });
    const conversation = normalizeConversation(data.conversation);
    conversations.value = [conversation, ...conversations.value];
    activeConversationId.value = conversation.id;
    messages[conversation.id] = [];
    return conversation;
  }

  async function fetchMessages(apiBase, conversationId) {
    if (!conversationId) {
      return [];
    }

    loading.value = true;
    error.value = "";

    try {
      const client = createClient(apiBase);
      const { data } = await client.get(`/conversations/${conversationId}/messages`);
      const normalizedMessages = Array.isArray(data.messages)
        ? data.messages.map(normalizeMessage)
        : [];
      messages[conversationId] = normalizedMessages;
      activeConversationId.value = conversationId;
      return normalizedMessages;
    } catch (err) {
      error.value = err.message || "Unable to load messages.";
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function sendMessage(apiBase, conversationId, payload) {
    const messagePayload =
      typeof payload === "string"
        ? { text: payload, attachments: [] }
        : {
            text: String(payload?.text || ""),
            attachments: Array.isArray(payload?.attachments) ? payload.attachments : []
          };
    const trimmedText = messagePayload.text.trim();
    if (!conversationId || (!trimmedText && messagePayload.attachments.length === 0)) {
      return null;
    }

    sending.value = true;
    error.value = "";

    try {
      const client = createClient(apiBase);
      const { data } = await client.post(`/conversations/${conversationId}/messages`, {
        text: trimmedText,
        attachments: messagePayload.attachments
      });

      const recruiterMessage = normalizeMessage(data.message);
      const activeMessages = messages[conversationId] || [];
      messages[conversationId] = [...activeMessages, recruiterMessage];

      if (data.autoReply) {
        messages[conversationId] = [
          ...messages[conversationId],
          normalizeMessage(data.autoReply)
        ];
      }

      conversations.value = conversations.value.map((conversation) => {
        if (conversation.id !== conversationId) {
          return conversation;
        }

        const latestMessage = data.autoReply || data.message;
        return {
          ...conversation,
          updatedAt: data.updatedAt || latestMessage?.createdAt || conversation.updatedAt,
          lastMessage: latestMessage
            ? {
                id: String(latestMessage.id || latestMessage._id || ""),
                text: latestMessage.text || "",
                sender: latestMessage.sender || "candidate",
                senderName: latestMessage.senderName || ""
              }
            : conversation.lastMessage
        };
      });

      return {
        message: recruiterMessage,
        autoReply: data.autoReply ? normalizeMessage(data.autoReply) : null
      };
    } catch (err) {
      error.value = err.message || "Unable to send message.";
      throw err;
    } finally {
      sending.value = false;
    }
  }

  function scheduleMessage(apiBase, conversationId, payload) {
    const sendAtValue = String(payload?.sendAt || "");
    const sendAtMs = new Date(sendAtValue).getTime();

    if (!Number.isFinite(sendAtMs) || sendAtMs <= Date.now()) {
      return sendMessage(apiBase, conversationId, payload);
    }

    const queueId = `${conversationId}-${sendAtMs}-${Math.random().toString(36).slice(2, 8)}`;
    scheduledQueue[queueId] = {
      conversationId,
      sendAt: new Date(sendAtMs).toISOString(),
      text: String(payload?.text || ""),
      attachments: Array.isArray(payload?.attachments) ? payload.attachments : []
    };

    const delayMs = Math.max(0, sendAtMs - Date.now());
    setTimeout(async () => {
      try {
        await sendMessage(apiBase, conversationId, payload);
      } finally {
        delete scheduledQueue[queueId];
      }
    }, delayMs);

    return queueId;
  }

  return {
    conversations,
    activeConversationId,
    messages,
    loading,
    sending,
    error,
    scheduledQueue,
    fetchConversations,
    createConversation,
    fetchMessages,
    sendMessage,
    scheduleMessage,
    generateCandidateReply
  };
}
