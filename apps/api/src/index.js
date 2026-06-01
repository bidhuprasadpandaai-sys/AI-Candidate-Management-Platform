import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { buildDashboardMetrics, generateAiReply, parseAiMessage } from "@acmp/shared";
import { connectDB } from "./config/db.js";
import { seedCandidates } from "./data/seedCandidates.js";
import { Candidate } from "./models/Candidate.js";
import { Conversation } from "./models/Conversation.js";
import { Message } from "./models/Message.js";
import authRouter from "./routes/auth.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:4410",
  "http://127.0.0.1:4410",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
].filter(Boolean);
const moduleManifest = [
  {
    id: "overview",
    name: "Overview",
    description: "Shell dashboard and platform health",
    route: "/overview",
    remote: false
  },
  {
    id: "candidates",
    name: "Candidates",
    description: "Pipeline and search experience",
    route: "/candidates",
    remote: false
  },
  {
    id: "chat",
    name: "Chat",
    description: "Candidate conversations workspace",
    route: "/chat",
    remote: false
  },
  {
    id: "assistant",
    name: "AI Assistant",
    description: "Recruiting copilot workspace",
    route: "/assistant",
    remote: false
  },
  {
    id: "analytics",
    name: "Analytics",
    description: "Delivery and adoption insights",
    route: "/analytics",
    remote: false
  }
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true
  })
);
app.use(express.json());
app.use("/api/auth", authRouter);

const usingDatabase = await connectDB();
let memoryCandidates = seedCandidates.map((candidate, index) => ({
  id: `demo-${index + 1}`,
  ...candidate
}));
let memoryConversations = [];
let memoryMessages = [];

const mapCandidate = (candidate) => ({
  id: String(candidate._id || candidate.id || candidate.email),
  name: candidate.name,
  email: candidate.email,
  role: candidate.role,
  status: candidate.status,
  score: Number(candidate.score || 0),
  stage: candidate.stage || "New application",
  location: candidate.location || "Remote",
  experienceYears: Number(candidate.experienceYears || 0),
  skills: candidate.skills || [],
  summary: candidate.summary || "",
  notes: candidate.notes || [],
  interviews: candidate.interviews || []
});

const mapConversation = (conversation) => ({
  id: String(conversation._id || conversation.id),
  type: conversation.type || "individual",
  candidateIds: Array.isArray(conversation.candidateIds) ? conversation.candidateIds.map(String) : [],
  title: conversation.title || "Untitled conversation",
  createdAt: conversation.createdAt || null,
  updatedAt: conversation.updatedAt || conversation.createdAt || null
});

const mapMessage = (message) => ({
  id: String(message._id || message.id),
  conversationId: String(message.conversationId),
  sender: message.sender,
  senderName: message.senderName,
  text: message.text,
  attachments: Array.isArray(message.attachments) ? message.attachments : [],
  createdAt: message.createdAt || null
});

const asyncHandler = (handler) => async (request, response, next) => {
  try {
    await handler(request, response, next);
  } catch (error) {
    next(error);
  }
};

async function fetchCandidates({ search = "", status = "all" } = {}) {
  if (!usingDatabase) {
    return memoryCandidates.filter((candidate) => {
      const matchesSearch =
        !search ||
        [candidate.name, candidate.role, ...(candidate.skills || [])]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
      const matchesStatus = status === "all" || candidate.status === status;
      return matchesSearch && matchesStatus;
    });
  }

  const query = {};

  if (status !== "all") {
    query.status = status;
  }

  if (search) {
    query.$or = [
      { name: new RegExp(search, "i") },
      { role: new RegExp(search, "i") },
      { skills: { $in: [new RegExp(search, "i")] } }
    ];
  }

  const candidates = await Candidate.find(query)
    .sort({ score: -1, createdAt: -1 })
    .lean();
  return candidates.map(mapCandidate);
}

async function getCandidateDirectory() {
  const candidates = await fetchCandidates();
  return new Map(candidates.map((candidate) => [candidate.id, candidate]));
}

function generateCandidateReply(candidateName = "Candidate", recruiterText = "") {
  const firstName = candidateName.trim().split(/\s+/)[0] || "Candidate";
  const text = recruiterText.trim().toLowerCase();

  if (text.includes("interview")) {
    return `Hi, this is ${firstName}. Thanks for the update. I am available and happy to coordinate the interview details.`;
  }

  if (text.includes("offer")) {
    return `Thank you for sharing this. I appreciate the opportunity and will review the offer details carefully.`;
  }

  if (text.includes("portfolio") || text.includes("resume")) {
    return `Thanks for reaching out. I can send over any additional materials you need and answer follow-up questions.`;
  }

  return `Hi, this is ${firstName}. Thanks for the update. I appreciate the message and will follow up soon.`;
}

async function fetchConversationById(conversationId) {
  if (!usingDatabase) {
    const conversation = memoryConversations.find((item) => item.id === conversationId);
    return conversation ? mapConversation(conversation) : null;
  }

  const conversation = await Conversation.findById(conversationId).lean();
  return conversation ? mapConversation(conversation) : null;
}

async function fetchConversationMessages(conversationId) {
  if (!usingDatabase) {
    return memoryMessages
      .filter((message) => message.conversationId === conversationId)
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
      .map(mapMessage);
  }

  const messages = await Message.find({ conversationId })
    .sort({ createdAt: 1 })
    .lean();
  return messages.map(mapMessage);
}

async function fetchConversationSummaries() {
  const candidateDirectory = await getCandidateDirectory();

  if (!usingDatabase) {
    return memoryConversations
      .map((conversation) => {
        const mappedConversation = mapConversation(conversation);
        const lastMessage = memoryMessages
          .filter((message) => message.conversationId === conversation.id)
          .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];

        return {
          ...mappedConversation,
          participants: mappedConversation.candidateIds
            .map((candidateId) => candidateDirectory.get(candidateId))
            .filter(Boolean),
          lastMessage: lastMessage ? mapMessage(lastMessage) : null
        };
      })
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }

  const conversations = await Conversation.find({})
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  const conversationIds = conversations.map((conversation) => String(conversation._id));
  const latestMessages = await Promise.all(
    conversationIds.map(async (conversationId) => {
      const message = await Message.findOne({ conversationId })
        .sort({ createdAt: -1 })
        .lean();
      return [conversationId, message ? mapMessage(message) : null];
    })
  );
  const latestMessageMap = new Map(latestMessages);

  return conversations.map((conversation) => {
    const mappedConversation = mapConversation(conversation);
    return {
      ...mappedConversation,
      participants: mappedConversation.candidateIds
        .map((candidateId) => candidateDirectory.get(candidateId))
        .filter(Boolean),
      lastMessage: latestMessageMap.get(mappedConversation.id) || null
    };
  });
}

async function createMessageRecord(messageData) {
  if (!usingDatabase) {
    const message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      ...messageData
    };
    memoryMessages.push(message);
    return mapMessage(message);
  }

  const message = new Message(messageData);
  await message.save();
  return mapMessage(message);
}

async function touchConversation(conversationId, updatedAt = new Date()) {
  if (!usingDatabase) {
    const index = memoryConversations.findIndex((conversation) => conversation.id === conversationId);
    if (index !== -1) {
      memoryConversations[index] = {
        ...memoryConversations[index],
        updatedAt: new Date(updatedAt).toISOString()
      };
    }
    return;
  }

  await Conversation.findByIdAndUpdate(conversationId, { updatedAt });
}

app.get("/api", (_request, response) => {
  response.json({
    name: "AI Candidate Management Platform API",
    status: "ok",
    port,
    usingDatabase,
    modules: moduleManifest.length
  });
});

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    usingDatabase,
    port,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/modules", (_request, response) => {
  response.json({ modules: moduleManifest });
});

app.get(
  "/api/dashboard",
  asyncHandler(async (_request, response) => {
    const candidates = await fetchCandidates();
    response.json({
      metrics: buildDashboardMetrics(candidates),
      usingMemoryStore: !usingDatabase
    });
  })
);

app.get(
  "/api/candidates",
  asyncHandler(async (request, response) => {
    const search = request.query.search || "";
    const status = request.query.status || "all";
    const page = Math.max(1, parseInt(request.query.page) || 1);
    const limit = Math.max(0, parseInt(request.query.limit) || 0);
    const sortField = request.query.sortField || "score";
    const sortOrder = parseInt(request.query.sortOrder) || -1;

    const allCandidates = await fetchCandidates({ search, status });

    // Sort client-side (works for both in-memory and Mongo paths)
    const sorted = [...allCandidates].sort((a, b) => {
      const av = a[sortField] ?? "";
      const bv = b[sortField] ?? "";
      if (typeof av === "number" && typeof bv === "number") return sortOrder * (av - bv);
      return sortOrder * String(av).localeCompare(String(bv));
    });

    const total = sorted.length;
    const candidates = limit > 0 ? sorted.slice((page - 1) * limit, page * limit) : sorted;

    response.json({ candidates, total, usingMemoryStore: !usingDatabase });
  })
);


// 1) POST: Create Candidate
app.post(
  "/api/candidates",
  asyncHandler(async (request, response) => {
    const candidateData = request.body;

    if (!usingDatabase) {
      const newCand = {
        id: `demo-${Date.now()}`,
        notes: [],
        interviews: [],
        ...candidateData
      };
      memoryCandidates.push(newCand);
      response.status(201).json(mapCandidate(newCand));
      return;
    }

    const candidate = new Candidate(candidateData);
    await candidate.save();
    response.status(201).json(mapCandidate(candidate));
  })
);

// 2) PUT: Update Candidate (Includes Notes & Interviews edits)
app.put(
  "/api/candidates/:id",
  asyncHandler(async (request, response) => {
    const id = request.params.id;
    const updateData = request.body;

    if (!usingDatabase) {
      const idx = memoryCandidates.findIndex((c) => c.id === id);
      if (idx === -1) {
        return response.status(404).json({ message: "Candidate not found in memory store" });
      }
      memoryCandidates[idx] = {
        ...memoryCandidates[idx],
        ...updateData
      };
      response.json(mapCandidate(memoryCandidates[idx]));
      return;
    }

    let candidate = await Candidate.findById(id);
    if (!candidate) {
      candidate = await Candidate.findOne({ email: id });
    }

    if (!candidate) {
      return response.status(404).json({ message: "Candidate not found in MongoDB" });
    }

    Object.assign(candidate, updateData);
    await candidate.save();
    response.json(mapCandidate(candidate));
  })
);

// 3) DELETE: Delete Candidate
app.delete(
  "/api/candidates/:id",
  asyncHandler(async (request, response) => {
    const id = request.params.id;

    if (!usingDatabase) {
      const idx = memoryCandidates.findIndex((c) => c.id === id);
      if (idx === -1) {
        return response.status(404).json({ message: "Candidate not found in memory store" });
      }
      memoryCandidates.splice(idx, 1);
      response.json({ success: true });
      return;
    }

    let deleted = await Candidate.findByIdAndDelete(id);
    if (!deleted) {
      deleted = await Candidate.findOneAndDelete({ email: id });
    }

    if (!deleted) {
      return response.status(404).json({ message: "Candidate not found in MongoDB" });
    }

    response.json({ success: true });
  })
);

app.get(
  "/api/conversations",
  asyncHandler(async (_request, response) => {
    const conversations = await fetchConversationSummaries();
    response.json({ conversations, usingMemoryStore: !usingDatabase });
  })
);

app.post(
  "/api/conversations",
  asyncHandler(async (request, response) => {
    const candidateIds = Array.isArray(request.body.candidateIds)
      ? request.body.candidateIds.map(String)
      : [];
    const type = request.body.type === "group" ? "group" : "individual";
    const title = String(request.body.title || "").trim();
    const requestedCandidateIds =
      type === "individual" ? candidateIds.slice(0, 1) : candidateIds;

    if (requestedCandidateIds.length === 0) {
      return response.status(400).json({ message: "At least one candidate is required." });
    }

    if (!title) {
      return response.status(400).json({ message: "Conversation title is required." });
    }

    const candidateDirectory = await getCandidateDirectory();
    const missingCandidateIds = requestedCandidateIds.filter(
      (candidateId) => !candidateDirectory.has(candidateId)
    );

    if (missingCandidateIds.length > 0) {
      return response.status(400).json({ message: "One or more candidates were not found." });
    }

    if (!usingDatabase) {
      const now = new Date().toISOString();
      const conversation = {
        id: `conv-${Date.now()}`,
        type,
        candidateIds: requestedCandidateIds,
        title,
        createdAt: now,
        updatedAt: now
      };
      memoryConversations.unshift(conversation);
      response.status(201).json({
        conversation: {
          ...mapConversation(conversation),
          participants: requestedCandidateIds
            .map((candidateId) => candidateDirectory.get(candidateId))
            .filter(Boolean),
          lastMessage: null
        },
        usingMemoryStore: true
      });
      return;
    }

    const conversation = new Conversation({
      type,
      candidateIds: requestedCandidateIds,
      title
    });
    await conversation.save();

    response.status(201).json({
      conversation: {
        ...mapConversation(conversation),
        participants: requestedCandidateIds
          .map((candidateId) => candidateDirectory.get(candidateId))
          .filter(Boolean),
        lastMessage: null
      },
      usingMemoryStore: false
    });
  })
);

app.get(
  "/api/conversations/:id/messages",
  asyncHandler(async (request, response) => {
    const conversation = await fetchConversationById(request.params.id);
    if (!conversation) {
      return response.status(404).json({ message: "Conversation not found." });
    }

    const messages = await fetchConversationMessages(conversation.id);
    response.json({ conversation, messages, usingMemoryStore: !usingDatabase });
  })
);

app.post(
  "/api/conversations/:id/messages",
  asyncHandler(async (request, response) => {
    const conversation = await fetchConversationById(request.params.id);
    if (!conversation) {
      return response.status(404).json({ message: "Conversation not found." });
    }

    const text = String(request.body.text || "").trim();
    const attachments = Array.isArray(request.body.attachments)
      ? request.body.attachments
          .map((file) => ({
            name: String(file?.name || "").trim(),
            type: String(file?.type || "").trim(),
            size: Number(file?.size || 0),
            content: String(file?.content || "").trim()
          }))
          .filter((file) => file.name.length > 0)
      : [];
    if (!text && attachments.length === 0) {
      return response.status(400).json({ message: "Message text or attachment is required." });
    }

    const recruiterMessage = await createMessageRecord({
      conversationId: conversation.id,
      sender: "recruiter",
      senderName: "Recruiter",
      text: text || "Shared attachments",
      attachments
    });

    const candidateDirectory = await getCandidateDirectory();
    const participantNames = conversation.candidateIds
      .map((candidateId) => candidateDirectory.get(candidateId)?.name)
      .filter(Boolean);
    const replyName =
      participantNames.length > 1 ? `${participantNames[0]} and team` : participantNames[0] || "Candidate";
    const autoReply = await createMessageRecord({
      conversationId: conversation.id,
      sender: "candidate",
      senderName: replyName,
      text: generateCandidateReply(replyName, text)
    });

    const updatedAt = autoReply.createdAt || recruiterMessage.createdAt || new Date().toISOString();
    await touchConversation(conversation.id, updatedAt);

    response.status(201).json({
      message: recruiterMessage,
      autoReply,
      updatedAt,
      usingMemoryStore: !usingDatabase
    });
  })
);

app.delete(
  "/api/conversations/:id",
  asyncHandler(async (request, response) => {
    const conversationId = request.params.id;

    if (!usingDatabase) {
      const conversationIndex = memoryConversations.findIndex(
        (conversation) => conversation.id === conversationId
      );

      if (conversationIndex === -1) {
        return response.status(404).json({ message: "Conversation not found." });
      }

      memoryConversations.splice(conversationIndex, 1);
      memoryMessages = memoryMessages.filter((message) => message.conversationId !== conversationId);
      response.json({ success: true, usingMemoryStore: true });
      return;
    }

    const deletedConversation = await Conversation.findByIdAndDelete(conversationId);
    if (!deletedConversation) {
      return response.status(404).json({ message: "Conversation not found." });
    }

    await Message.deleteMany({ conversationId });
    response.json({ success: true, usingMemoryStore: false });
  })
);

app.post(
  "/api/chat",
  asyncHandler(async (request, response) => {
    const candidates = await fetchCandidates();
    const message = request.body.message || "";
    
    // Parse conversational command
    const parsed = parseAiMessage(message, candidates);
    let reply = "";
    let actionExecuted = false;

    if (parsed) {
      actionExecuted = true;
      reply = parsed.reply;

      if (parsed.command === "update_status") {
        if (usingDatabase) {
          await Candidate.findByIdAndUpdate(parsed.candidateId, parsed.args);
        } else {
          const idx = memoryCandidates.findIndex((c) => c.id === parsed.candidateId);
          if (idx !== -1) {
            memoryCandidates[idx] = { ...memoryCandidates[idx], ...parsed.args };
          }
        }
      } else if (parsed.command === "add_note") {
        const newNote = {
          author: "AI Copilot",
          text: parsed.args.text,
          createdAt: new Date()
        };
        if (usingDatabase) {
          await Candidate.findByIdAndUpdate(parsed.candidateId, {
            $push: { notes: newNote }
          });
        } else {
          const idx = memoryCandidates.findIndex((c) => c.id === parsed.candidateId);
          if (idx !== -1) {
            if (!memoryCandidates[idx].notes) memoryCandidates[idx].notes = [];
            memoryCandidates[idx].notes.push(newNote);
          }
        }
      } else if (parsed.command === "schedule_interview") {
        if (usingDatabase) {
          await Candidate.findByIdAndUpdate(parsed.candidateId, {
            $push: { interviews: parsed.args }
          });
        } else {
          const idx = memoryCandidates.findIndex((c) => c.id === parsed.candidateId);
          if (idx !== -1) {
            if (!memoryCandidates[idx].interviews) memoryCandidates[idx].interviews = [];
            memoryCandidates[idx].interviews.push(parsed.args);
          }
        }
      } else if (parsed.command === "summarize") {
        // Just general profiling, no database modifications
        actionExecuted = false;
      }
    } else {
      reply = generateAiReply(message, candidates);
    }

    response.json({ reply, actionExecuted, usingMemoryStore: !usingDatabase });
  })
);

app.get(
  "/api/analytics",
  asyncHandler(async (_request, response) => {
    const candidates = await fetchCandidates();

    // Status breakdown
    const statusBreakdown = candidates.reduce((acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    }, {});

    // Stage distribution
    const stageDistribution = candidates.reduce((acc, c) => {
      const stage = c.stage || "Unknown";
      acc[stage] = (acc[stage] || 0) + 1;
      return acc;
    }, {});

    // Top skills frequency
    const skillFrequency = candidates.reduce((acc, c) => {
      (c.skills || []).forEach((skill) => {
        acc[skill] = (acc[skill] || 0) + 1;
      });
      return acc;
    }, {});
    const topSkills = Object.entries(skillFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([skill, count]) => ({ skill, count }));

    // Experience distribution
    const experienceBuckets = { "0-2 yrs": 0, "3-5 yrs": 0, "6-10 yrs": 0, "10+ yrs": 0 };
    candidates.forEach((c) => {
      const yrs = c.experienceYears || 0;
      if (yrs <= 2) experienceBuckets["0-2 yrs"]++;
      else if (yrs <= 5) experienceBuckets["3-5 yrs"]++;
      else if (yrs <= 10) experienceBuckets["6-10 yrs"]++;
      else experienceBuckets["10+ yrs"]++;
    });

    // Top candidates by score
    const topCandidates = [...candidates]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((c) => ({ name: c.name, role: c.role, score: c.score, status: c.status }));

    // Average score
    const avgScore =
      candidates.length > 0
        ? Math.round(candidates.reduce((sum, c) => sum + (c.score || 0), 0) / candidates.length)
        : 0;

    response.json({
      total: candidates.length,
      avgScore,
      statusBreakdown,
      stageDistribution,
      topSkills,
      experienceBuckets,
      topCandidates,
      usingMemoryStore: !usingDatabase
    });
  })
);

app.post(
  "/api/seed",
  asyncHandler(async (_request, response) => {
    if (!usingDatabase) {
      memoryCandidates = seedCandidates.map((candidate, index) => ({
        id: `demo-${index + 1}`,
        notes: [],
        interviews: [],
        ...candidate
      }));
      memoryConversations = [];
      memoryMessages = [];

      response
        .status(201)
        .json({ count: memoryCandidates.length, usingMemoryStore: true });
      return;
    }

    await Candidate.deleteMany({});
    await Conversation.deleteMany({});
    await Message.deleteMany({});
    const created = await Candidate.insertMany(seedCandidates);
    response
      .status(201)
      .json({ count: created.length, usingMemoryStore: false });
  })
);

app.use((error, _request, response, _next) => {
  console.error("API request failed:", error);
  response.status(500).json({
    message: error.message || "Internal server error",
    usingMemoryStore: !usingDatabase
  });
});

app.listen(port, () => {
  console.log(`API server running on http://localhost:${port}`);
});
