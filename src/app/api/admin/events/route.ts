import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import {
  generateShareToken,
  handleApiError,
  requireAdmin,
} from "@/lib/auth";
import { EventModel } from "@/models/Event";
import { FamilyModel } from "@/models/Family";
import { ParticipantModel } from "@/models/Participant";
import { RestrictionRuleModel } from "@/models/RestrictionRule";

const createEventSchema = z.object({
  name: z.string().trim().min(2, "O nome do sorteio deve ter pelo menos 2 caracteres."),
  description: z.string().trim().optional().default(""),
  maxBudget: z.number().positive().nullable().optional().default(null),
  seedDemo: z.boolean().optional().default(false),
  createDefaultFamilies: z.boolean().optional().default(true),
});

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    await connectDB();

    const events = await EventModel.find().sort({ createdAt: -1 }).lean();
    const eventIds = events.map((e) => e._id);

    const [families, participants, rules] = await Promise.all([
      FamilyModel.find({ eventId: { $in: eventIds } }).lean(),
      ParticipantModel.find({ eventId: { $in: eventIds } })
        .select("eventId hasDrawn giftItems giftHint")
        .lean(),
      RestrictionRuleModel.find({ eventId: { $in: eventIds } })
        .select("eventId")
        .lean(),
    ]);

    const enriched = events.map((ev) => {
      const idStr = ev._id.toString();
      const evParticipants = participants.filter(
        (p) => p.eventId.toString() === idStr
      );
      return {
        id: idStr,
        name: ev.name,
        description: ev.description,
        giftToken: ev.giftToken || ev.shareToken,
        shareToken: ev.shareToken,
        currentRound: ev.currentRound || "round1_gifts",
        maxBudget: ev.maxBudget ?? null,
        status: ev.status,
        drawSequence: ev.drawSequence,
        createdAt: ev.createdAt,
        familyCount: families.filter((f) => f.eventId.toString() === idStr)
          .length,
        participantCount: evParticipants.length,
        giftsSubmittedCount: evParticipants.filter(
          (p) => (p.giftItems?.length || 0) > 0 || Boolean(p.giftHint)
        ).length,
        drawnCount: evParticipants.filter((p) => p.hasDrawn).length,
        ruleCount: rules.filter((r) => r.eventId.toString() === idStr).length,
      };
    });

    return NextResponse.json({ events: enriched });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const data = createEventSchema.parse(body);

    await connectDB();
    const session = await mongoose.startSession();
    try {
      let createdEventId = "";

      await session.withTransaction(async () => {
        const [event] = await EventModel.create(
          [
            {
              name: data.name,
              description: data.description,
              giftToken: generateShareToken(),
              shareToken: generateShareToken(),
              currentRound: "round1_gifts",
              maxBudget: data.maxBudget,
              status: "active",
            },
          ],
          { session }
        );

        createdEventId = event._id.toString();

        if (data.seedDemo) {
          const [fam1, fam2] = await FamilyModel.create(
            [
              {
                eventId: event._id,
                name: "Família 1",
                color: "#2563eb",
              },
              {
                eventId: event._id,
                name: "Família 2",
                color: "#e11d48",
              },
            ],
            { session, ordered: true }
          );

          const createdParticipants = await ParticipantModel.create(
            [
              {
                eventId: event._id,
                familyId: fam1._id,
                name: "Tio Carlos",
                role: "Pai (Família 1)",
                giftHint: "Camisa polo G",
              },
              {
                eventId: event._id,
                familyId: fam1._id,
                name: "Tia Ana",
                role: "Mãe (Família 1)",
                giftHint: "Perfume floral",
              },
              {
                eventId: event._id,
                familyId: fam1._id,
                name: "Primo Lucas",
                role: "Filho (Família 1)",
                giftHint: "Fone Bluetooth",
              },
              {
                eventId: event._id,
                familyId: fam2._id,
                name: "Pai",
                role: "Pai",
                giftHint: "Kit churrasco",
              },
              {
                eventId: event._id,
                familyId: fam2._id,
                name: "Mãe",
                role: "Mãe",
                giftHint: "Bolsa tiracolo",
              },
              {
                eventId: event._id,
                familyId: fam2._id,
                name: "Filho",
                role: "Filho",
                giftHint: "Tênis nº 41",
              },
            ],
            { session, ordered: true }
          );

          const pai = createdParticipants.find((p) => p.name === "Pai")!;
          const mae = createdParticipants.find((p) => p.name === "Mãe")!;
          const filho = createdParticipants.find((p) => p.name === "Filho")!;

          await RestrictionRuleModel.create(
            [
              {
                eventId: event._id,
                scope: "PARTICIPANT_TO_PARTICIPANT",
                sourceParticipantId: mae._id,
                targetParticipantId: pai._id,
                description: `Mãe (${fam2.name}) não pode tirar Pai (${fam2.name})`,
              },
              {
                eventId: event._id,
                scope: "PARTICIPANT_TO_PARTICIPANT",
                sourceParticipantId: filho._id,
                targetParticipantId: pai._id,
                description: `Filho (${fam2.name}) não pode tirar Pai (${fam2.name})`,
              },
            ],
            { session, ordered: true }
          );
        } else if (data.createDefaultFamilies) {
          await FamilyModel.create(
            [
              {
                eventId: event._id,
                name: "Família 1",
                color: "#2563eb",
              },
              {
                eventId: event._id,
                name: "Família 2",
                color: "#e11d48",
              },
            ],
            { session, ordered: true }
          );
        }
      });

      return NextResponse.json({ id: createdEventId }, { status: 201 });
    } finally {
      await session.endSession();
    }
  } catch (err) {
    return handleApiError(err);
  }
}
