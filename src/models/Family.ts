import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const FamilySchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    color: {
      type: String,
      default: "#e11d48",
    },
  },
  { timestamps: true }
);

export type FamilyDoc = InferSchemaType<typeof FamilySchema> & {
  _id: mongoose.Types.ObjectId;
};

export const FamilyModel: Model<FamilyDoc> =
  (mongoose.models.Family as Model<FamilyDoc>) ||
  mongoose.model<FamilyDoc>("Family", FamilySchema);
