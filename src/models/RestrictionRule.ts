import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

export const RULE_SCOPES = [
  "PARTICIPANT_TO_PARTICIPANT",
  "PARTICIPANT_TO_FAMILY",
  "FAMILY_TO_FAMILY",
  "FAMILY_TO_PARTICIPANT",
] as const;

export type RuleScope = (typeof RULE_SCOPES)[number];

const RestrictionRuleSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    scope: {
      type: String,
      enum: RULE_SCOPES,
      required: true,
    },
    sourceParticipantId: {
      type: Schema.Types.ObjectId,
      ref: "Participant",
      default: null,
    },
    sourceFamilyId: {
      type: Schema.Types.ObjectId,
      ref: "Family",
      default: null,
    },
    targetParticipantId: {
      type: Schema.Types.ObjectId,
      ref: "Participant",
      default: null,
    },
    targetFamilyId: {
      type: Schema.Types.ObjectId,
      ref: "Family",
      default: null,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

export type RestrictionRuleDoc = InferSchemaType<typeof RestrictionRuleSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const RestrictionRuleModel: Model<RestrictionRuleDoc> =
  (mongoose.models.RestrictionRule as Model<RestrictionRuleDoc>) ||
  mongoose.model<RestrictionRuleDoc>("RestrictionRule", RestrictionRuleSchema);
