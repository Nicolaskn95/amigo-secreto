import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import {
  AppError,
  generateShareToken,
  handleApiError,
  requireAdmin,
} from "@/lib/auth";
import {
  validateEventViability,
  type EngineParticipant,
  type EngineRule,
} from "@/lib/draw-engine";
import { resetAllEventDraws } from "@/lib/draw-transaction";
import { EventModel } from "@/models/Event";
import { FamilyModel } from "@/models/Family";
import { ParticipantModel } from "@/models/Participant";
import { RestrictionRuleModel } from "@/models/RestrictionRule";

const patchEventSchema = z.object({
  action: z
    .enum([
      "update",
      "set_round",
      "regenerate_gift_link",
      "regenerate_link",
      "reset_draws",
    ])
    .optional()
    .default("update"),
  name: z.string().trim().min(2).optional(),
  description: z.string().trim().optional(),
  currentRound: z
    .enum(["round1_gifts", "round2_draw", "completed"])
    .optional(),
  maxBudget: z.number().min(0).nullable().optional(),
  status: z.enum(["draft", "active", "completed"]).optional(),
});

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/events/[eventId]">
) {
  try {
    await requireAdmin(req);
    const { eventId } = await ctx.params;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      throw new AppError("ID do sorteio inválido.", 400);
    }

    await connectDB();

    let event = await EventModel.findById(eventId).lean();
    if (!event) {
      throw new AppError("Sorteio não encontrado.", 404);
    }

    // Garante retrocompatibilidade com eventos criados antes das 2 rodadas
    if (!event.giftToken || !event.currentRound) {
      const updated = await EventModel.findByIdAndUpdate(
        event._id,
        {
          $set: {
            giftToken: event.giftToken || generateShareToken(),
            currentRound: event.currentRound || "round1_gifts",
          },
        },
        { returnDocument: "after" }
      ).lean();
      if (updated) event = updated;
    }

    const [families, participants, rules] = await Promise.all([
      FamilyModel.find({ eventId: event._id }).sort({ createdAt: 1 }).lean(),
      ParticipantModel.find({ eventId: event._id }).sort({ createdAt: 1 }).lean(),
      RestrictionRuleModel.find({ eventId: event._id }).sort({ createdAt: -1 }).lean(),
    ]);

    const engineParticipants: EngineParticipant[] = participants.map((p) => ({
      id: p._id.toString(),
      familyId: p.familyId.toString(),
      name: p.name,
      hasDrawn: Boolean(p.hasDrawn),
      drawnParticipantId: p.drawnParticipantId
        ? p.drawnParticipantId.toString()
        : null,
      drawnByParticipantId: p.drawnByParticipantId
        ? p.drawnByParticipantId.toString()
        : null,
    }));

    const engineRules: EngineRule[] = rules.map((r) => ({
      scope: r.scope,
      sourceParticipantId: r.sourceParticipantId
        ? r.sourceParticipantId.toString()
        : null,
      sourceFamilyId: r.sourceFamilyId ? r.sourceFamilyId.toString() : null,
      targetParticipantId: r.targetParticipantId
        ? r.targetParticipantId.toString()
        : null,
      targetFamilyId: r.targetFamilyId ? r.targetFamilyId.toString() : null,
    }));

    const viability = validateEventViability(engineParticipants, engineRules);

    return NextResponse.json({
      event: {
        id: event._id.toString(),
        name: event.name,
        description: event.description,
        giftToken: event.giftToken,
        shareToken: event.shareToken,
        currentRound: event.currentRound || "round1_gifts",
        maxBudget: event.maxBudget ?? null,
        status: event.status,
        drawSequence: event.drawSequence,
        createdAt: event.createdAt,
      },
      families: families.map((f) => ({
        id: f._id.toString(),
        name: f.name,
        color: f.color,
      })),
      participants: participants.map((p) => ({
        id: p._id.toString(),
        familyId: p.familyId.toString(),
        name: p.name,
        role: p.role || "",
        giftHint: p.giftHint || "",
        giftItemsCount: Array.isArray(p.giftItems) ? p.giftItems.length : 0,
        giftsTotal: Number(p.giftsTotal) || 0,
        hasDrawn: Boolean(p.hasDrawn),
        hasPin: Boolean(p.pinHash),
        reRollCount: p.reRollCount || 0,
        drawnAt: p.drawnAt,
      })),
      rules: rules.map((r) => ({
        id: r._id.toString(),
        scope: r.scope,
        sourceParticipantId: r.sourceParticipantId?.toString() || null,
        sourceFamilyId: r.sourceFamilyId?.toString() || null,
        targetParticipantId: r.targetParticipantId?.toString() || null,
        targetFamilyId: r.targetFamilyId?.toString() || null,
        description: r.description,
      })),
      viability,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/events/[eventId]">
) {
  try {
    await requireAdmin(req);
    const { eventId } = await ctx.params;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      throw new AppError("ID inválido.", 400);
    }

    const body = await req.json();
    const data = patchEventSchema.parse(body);

    await connectDB();

    if (data.action === "reset_draws") {
      await resetAllEventDraws(eventId);
      return NextResponse.json({
        ok: true,
        message: "Todos os sorteios da 2ª rodada foram reiniciados (mantendo os presentes).",
      });
    }

    if (data.action === "set_round") {
      if (!data.currentRound) {
        throw new AppError("Informe a rodada desejada.", 400);
      }
      const updated = await EventModel.findByIdAndUpdate(
        eventId,
        {
          $set: {
            currentRound: data.currentRound,
            status: data.currentRound === "completed" ? "completed" : "active",
          },
        },
        { returnDocument: "after" }
      ).lean();

      if (!updated) throw new AppError("Evento não encontrado.", 404);
      return NextResponse.json({
        currentRound: updated.currentRound,
        status: updated.status,
      });
    }

    if (data.action === "regenerate_gift_link") {
      const updated = await EventModel.findByIdAndUpdate(
        eventId,
        { $set: { giftToken: generateShareToken() } },
        { returnDocument: "after" }
      ).lean();

      if (!updated) throw new AppError("Evento não encontrado.", 404);
      return NextResponse.json({ giftToken: updated.giftToken });
    }

    if (data.action === "regenerate_link") {
      const updated = await EventModel.findByIdAndUpdate(
        eventId,
        { $set: { shareToken: generateShareToken(), status: "active" } },
        { returnDocument: "after" }
      ).lean();

      if (!updated) throw new AppError("Evento não encontrado.", 404);
      return NextResponse.json({
        shareToken: updated.shareToken,
        status: updated.status,
      });
    }

    const updateFields: Record<string, unknown> = {};
    if (data.name !== undefined) updateFields.name = data.name;
    if (data.description !== undefined) updateFields.description = data.description;
    if (data.status !== undefined) updateFields.status = data.status;
    if (data.currentRound !== undefined) updateFields.currentRound = data.currentRound;
    if (data.maxBudget !== undefined) updateFields.maxBudget = data.maxBudget;

    const updated = await EventModel.findByIdAndUpdate(
      eventId,
      { $set: updateFields },
      { returnDocument: "after" }
    ).lean();

    if (!updated) throw new AppError("Evento não encontrado.", 404);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/events/[eventId]">
) {
  try {
    await requireAdmin(req);
    const { eventId } = await ctx.params;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      throw new AppError("ID inválido.", 400);
    }

    await connectDB();
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const deleted = await EventModel.findByIdAndDelete(eventId, { session });
        if (!deleted) throw new AppError("Sorteio não encontrado.", 404);

        await Promise.all([
          FamilyModel.deleteMany({ eventId: deleted._id }, { session }),
          ParticipantModel.deleteMany({ eventId: deleted._id }, { session }),
          RestrictionRuleModel.deleteMany({ eventId: deleted._id }, { session }),
        ]);
      });

      return NextResponse.json({ ok: true });
    } finally {
      await session.endSession();
    }
  } catch (err) {
    return handleApiError(err);
  }
}
