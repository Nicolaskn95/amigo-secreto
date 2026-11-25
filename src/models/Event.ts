import crypto from "node:crypto";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

export type EventStatus = "draft" | "active" | "completed";
export type EventRound = "round1_gifts" | "round2_draw" | "completed";

const EventSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    giftToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => crypto.randomBytes(6).toString("base64url").toLowerCase(),
    },
    shareToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    currentRound: {
      type: String,
      enum: ["round1_gifts", "round2_draw", "completed"],
      default: "round1_gifts",
    },
    maxBudget: {
      type: Number,
      default: null,
    },
    status: {
      type: String,
      enum: ["draft", "active", "completed"],
      default: "active",
    },
    drawSequence: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

export type EventDoc = InferSchemaType<typeof EventSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const EventModel: Model<EventDoc> =
  (mongoose.models.Event as Model<EventDoc>) ||
  mongoose.model<EventDoc>("Event", EventSchema);
