import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import { AppError, handleApiError, requireAdmin } from "@/lib/auth";
import { ParticipantModel } from "@/models/Participant";
import { RestrictionRuleModel } from "@/models/RestrictionRule";

const updateParticipantSchema = z.object({
  action: z.enum(["update", "reset_pin"]).optional().default("update"),
  name: z.string().trim().min(1).optional(),
  role: z.string().trim().optional(),
  giftHint: z.string().trim().optional(),
  familyId: z.string().optional(),
});

export async function PUT(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/participants/[participantId]">
) {
  try {
    await requireAdmin(req);
    const { participantId } = await ctx.params;

    if (!mongoose.Types.ObjectId.isValid(participantId)) {
      throw new AppError("ID do integrante inválido.", 400);
    }

    const body = await req.json();
    const data = updateParticipantSchema.parse(body);

    await connectDB();

    const existing = await ParticipantModel.findById(participantId).lean();
    if (!existing) throw new AppError("Integrante não encontrado.", 404);

    if (data.action === "reset_pin") {
      await ParticipantModel.updateOne(
        { _id: existing._id },
        { $set: { pinHash: null } }
      );
      return NextResponse.json({
        ok: true,
        message: "PIN limpo! O participante poderá cadastrar um novo PIN ao acessar o link público.",
      });
    }

    const update: Record<string, unknown> = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.role !== undefined) update.role = data.role;
    if (data.giftHint !== undefined) update.giftHint = data.giftHint;

    if (
      data.familyId !== undefined &&
      data.familyId !== existing.familyId.toString()
    ) {
      const anyDrawn = await ParticipantModel.exists({
        eventId: existing.eventId,
        hasDrawn: true,
      });
      if (anyDrawn) {
        throw new AppError(
          "Não é possível mover integrante de família com sorteio em andamento.",
          409
        );
      }
      if (!mongoose.Types.ObjectId.isValid(data.familyId)) {
        throw new AppError("Família de destino inválida.", 400);
      }
      update.familyId = data.familyId;
    }

    const updated = await ParticipantModel.findByIdAndUpdate(
      participantId,
      { $set: update },
      { returnDocument: "after" }
    ).lean();

    return NextResponse.json({
      participant: {
        id: updated!._id.toString(),
        familyId: updated!.familyId.toString(),
        name: updated!.name,
        role: updated!.role || "",
        giftHint: updated!.giftHint || "",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/participants/[participantId]">
) {
  try {
    await requireAdmin(req);
    const { participantId } = await ctx.params;

    if (!mongoose.Types.ObjectId.isValid(participantId)) {
      throw new AppError("ID do integrante inválido.", 400);
    }

    await connectDB();
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const participant = await ParticipantModel.findById(participantId).session(
          session
        );
        if (!participant) throw new AppError("Integrante não encontrado.", 404);

        const anyDrawn = await ParticipantModel.exists({
          eventId: participant.eventId,
          hasDrawn: true,
        }).session(session);

        if (anyDrawn) {
          throw new AppError(
            "Já existem sorteios realizados. Reinicie os sorteios antes de remover integrantes.",
            409
          );
        }

        await RestrictionRuleModel.deleteMany(
          {
            eventId: participant.eventId,
            $or: [
              { sourceParticipantId: participant._id },
              { targetParticipantId: participant._id },
            ],
          },
          { session }
        );

        await ParticipantModel.deleteOne({ _id: participant._id }, { session });
      });

      return NextResponse.json({ ok: true });
    } finally {
      await session.endSession();
    }
  } catch (err) {
    return handleApiError(err);
  }
}
