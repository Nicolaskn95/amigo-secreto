import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const GiftItemSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      default: "",
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    scraped: {
      type: Boolean,
      default: false,
    },
  },
  { _id: true }
);

const ParticipantSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    familyId: {
      type: Schema.Types.ObjectId,
      ref: "Family",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      default: "",
      trim: true,
    },
    giftHint: {
      type: String,
      default: "",
      trim: true,
    },
    giftItems: {
      type: [GiftItemSchema],
      default: [],
    },
    giftsTotal: {
      type: Number,
      default: 0,
    },
    pinHash: {
      type: String,
      default: null,
    },
    hasDrawn: {
      type: Boolean,
      default: false,
    },
    drawnParticipantId: {
      type: Schema.Types.ObjectId,
      ref: "Participant",
      default: null,
    },
    drawnByParticipantId: {
      type: Schema.Types.ObjectId,
      ref: "Participant",
      default: null,
    },
    reRollCount: {
      type: Number,
      default: 0,
    },
    drawnAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

ParticipantSchema.index(
  { eventId: 1, drawnParticipantId: 1 },
  {
    unique: true,
    partialFilterExpression: { drawnParticipantId: { $type: "objectId" } },
  }
);

ParticipantSchema.index(
  { eventId: 1, drawnByParticipantId: 1 },
  {
    unique: true,
    partialFilterExpression: { drawnByParticipantId: { $type: "objectId" } },
  }
);

export type ParticipantDoc = InferSchemaType<typeof ParticipantSchema> & {
  _id: mongoose.Types.ObjectId;
};

// Em modo dev (Hot Reload), garante que os campos giftItems e giftsTotal sejam recarregados
const existingParticipantModel = mongoose.models.Participant as
  | Model<ParticipantDoc>
  | undefined;
if (
  existingParticipantModel &&
  (!existingParticipantModel.schema.path("giftItems") ||
    !existingParticipantModel.schema.path("giftsTotal"))
) {
  mongoose.deleteModel("Participant");
}

export const ParticipantModel: Model<ParticipantDoc> =
  (mongoose.models.Participant as Model<ParticipantDoc>) ||
  mongoose.model<ParticipantDoc>("Participant", ParticipantSchema);
