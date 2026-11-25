import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import { AppError, handleApiError, requireAdmin } from "@/lib/auth";
import { FamilyModel } from "@/models/Family";
import { ParticipantModel } from "@/models/Participant";
import { RestrictionRuleModel } from "@/models/RestrictionRule";

const updateFamilySchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da família.").optional(),
  color: z.string().trim().min(4).optional(),
});

export async function PUT(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/families/[familyId]">
) {
  try {
    await requireAdmin(req);
    const { familyId } = await ctx.params;

    if (!mongoose.Types.ObjectId.isValid(familyId)) {
      throw new AppError("ID da família inválido.", 400);
    }

    const body = await req.json();
    const data = updateFamilySchema.parse(body);

    await connectDB();
    const update: Record<string, unknown> = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.color !== undefined) update.color = data.color;

    const updated = await FamilyModel.findByIdAndUpdate(
      familyId,
      { $set: update },
      { returnDocument: "after" }
    ).lean();

    if (!updated) throw new AppError("Família não encontrada.", 404);

    return NextResponse.json({
      family: {
        id: updated._id.toString(),
        name: updated.name,
        color: updated.color,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/families/[familyId]">
) {
  try {
    await requireAdmin(req);
    const { familyId } = await ctx.params;

    if (!mongoose.Types.ObjectId.isValid(familyId)) {
      throw new AppError("ID da família inválido.", 400);
    }

    await connectDB();
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const family = await FamilyModel.findById(familyId).session(session);
        if (!family) throw new AppError("Família não encontrada.", 404);

        const anyDrawn = await ParticipantModel.exists({
          eventId: family.eventId,
          hasDrawn: true,
        }).session(session);

        if (anyDrawn) {
          throw new AppError(
            "Já existem sorteios realizados neste evento. Reinicie os sorteios antes de excluir uma família.",
            409
          );
        }

        const familyParticipants = await ParticipantModel.find({
          familyId: family._id,
        })
          .select("_id")
          .session(session)
          .lean();

        const participantIds = familyParticipants.map((p) => p._id);

        await RestrictionRuleModel.deleteMany(
          {
            eventId: family.eventId,
            $or: [
              { sourceFamilyId: family._id },
              { targetFamilyId: family._id },
              { sourceParticipantId: { $in: participantIds } },
              { targetParticipantId: { $in: participantIds } },
            ],
          },
          { session }
        );

        await ParticipantModel.deleteMany({ familyId: family._id }, { session });
        await FamilyModel.deleteOne({ _id: family._id }, { session });
      });

      return NextResponse.json({ ok: true });
    } finally {
      await session.endSession();
    }
  } catch (err) {
    return handleApiError(err);
  }
}
