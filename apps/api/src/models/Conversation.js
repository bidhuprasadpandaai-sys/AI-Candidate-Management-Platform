import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["individual", "group"],
      default: "individual"
    },
    candidateIds: [
      {
        type: String,
        required: true
      }
    ],
    ownerId: { type: String, index: true },
    companyId: { type: String, index: true },
    title: {
      type: String,
      required: true,
      trim: true
    }
  },
  {
    timestamps: true
  }
);

export const Conversation =
  mongoose.models.Conversation ||
  mongoose.model("Conversation", conversationSchema);
