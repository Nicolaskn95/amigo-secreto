import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { AppError, handleApiError } from "@/lib/auth";
import { EventModel } from "@/models/Event";
import { FamilyModel } from "@/models/Family";
import { ParticipantModel } from "@/models/Participant";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/public/gifts/[giftToken]">
) {
  try {
    void req.nextUrl.pathname;
    const { giftToken } = await ctx.params;

    await connectDB();

    const event = await EventModel.findOne({ giftToken }).lean();
    if (!event) {
      throw new AppError("Link da 1ª Rodada (presentes) inválido ou não encontrado.", 404);
    }

    const [families, participants] = await Promise.all([
      FamilyModel.find({ eventId: event._id }).sort({ createdAt: 1 }).lean(),
      ParticipantModel.find({ eventId: event._id })
        .select("_id familyId name role giftHint giftItems giftsTotal pinHash")
        .sort({ createdAt: 1 })
        .lean(),
    ]);

    const withGiftsCount = participants.filter(
      (p) => (Array.isArray(p.giftItems) && p.giftItems.length > 0) || Boolean(p.giftHint)
    ).length;

    return NextResponse.json({
      event: {
        name: event.name,
        description: event.description,
        currentRound: event.currentRound || "round1_gifts",
        maxBudget: event.maxBudget ?? null,
        status: event.status,
        totalParticipants: participants.length,
        withGiftsCount,
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
        hasPin: Boolean(p.pinHash),
        hasGifts:
          (Array.isArray(p.giftItems) && p.giftItems.length > 0) ||
          Boolean(p.giftHint),
        giftItemsCount: Array.isArray(p.giftItems) ? p.giftItems.length : 0,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
