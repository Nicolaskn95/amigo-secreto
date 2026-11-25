import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { AppError, handleApiError, requireAdmin } from "@/lib/auth";
import { ParticipantModel } from "@/models/Participant";
import { RestrictionRuleModel } from "@/models/RestrictionRule";

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/rules/[ruleId]">
) {
  try {
    await requireAdmin(req);
    const { ruleId } = await ctx.params;

    if (!mongoose.Types.ObjectId.isValid(ruleId)) {
      throw new AppError("ID da regra inválido.", 400);
    }

    await connectDB();

    const rule = await RestrictionRuleModel.findById(ruleId).lean();
    if (!rule) throw new AppError("Regra não encontrada.", 404);

    const anyDrawn = await ParticipantModel.exists({
      eventId: rule.eventId,
      hasDrawn: true,
    });
    if (anyDrawn) {
      throw new AppError(
        "Já existem sorteios realizados. Reinicie os sorteios antes de remover regras.",
        409
      );
    }

    await RestrictionRuleModel.deleteOne({ _id: rule._id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
