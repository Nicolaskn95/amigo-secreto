import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { AppError, handleApiError } from "@/lib/auth";
import { EventModel } from "@/models/Event";
import { FamilyModel } from "@/models/Family";
import { ParticipantModel } from "@/models/Participant";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/public/[token]">
) {
  try {
    void req.nextUrl.pathname;
    const { token } = await ctx.params;

    await connectDB();

    const event = await EventModel.findOne({ shareToken: token }).lean();
    if (!event) {
      throw new AppError("Link de sorteio não encontrado ou inválido.", 404);
    }

    const [families, participants] = await Promise.all([
      FamilyModel.find({ eventId: event._id }).sort({ createdAt: 1 }).lean(),
      ParticipantModel.find({ eventId: event._id })
        .select("_id familyId name role hasDrawn pinHash")
        .sort({ createdAt: 1 })
        .lean(),
    ]);

    return NextResponse.json({
      event: {
        name: event.name,
        description: event.description,
        currentRound: event.currentRound || "round2_draw",
        maxBudget: event.maxBudget ?? null,
        status: event.status,
        totalParticipants: participants.length,
        drawnCount: participants.filter((p) => p.hasDrawn).length,
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
        hasDrawn: Boolean(p.hasDrawn),
        hasPin: Boolean(p.pinHash),
        needsPinReset: Boolean(p.hasDrawn && !p.pinHash),
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
