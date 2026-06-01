import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: String,
      required: true,
      index: true
    },
    sender: {
      type: String,
      enum: ["recruiter", "candidate"],
      required: true
    },
    senderName: {
      type: String,
      required: true,
      trim: true
    },
    text: {
      type: String,
      required: true,
      trim: true
    },
    attachments: {
      type: [
        {
          name: { type: String, required: true, trim: true },
          type: { type: String, required: false, trim: true },
          size: { type: Number, required: false },
          content: { type: String, required: false, trim: true }
        }
      ],
      default: []
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

export const Message =
  mongoose.models.Message || mongoose.model("Message", messageSchema);
