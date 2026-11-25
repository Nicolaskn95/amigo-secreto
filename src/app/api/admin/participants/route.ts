import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import { AppError, handleApiError, requireAdmin } from "@/lib/auth";
import { EventModel } from "@/models/Event";
import { FamilyModel } from "@/models/Family";
import { ParticipantModel } from "@/models/Participant";

const createParticipantSchema = z.object({
  eventId: z.string().min(1),
  familyId: z.string().min(1),
  name: z.string().trim().min(1, "Informe o nome do integrante."),
  role: z.string().trim().optional().default(""),
  giftHint: z.string().trim().optional().default(""),
});

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const data = createParticipantSchema.parse(body);

    if (
      !mongoose.Types.ObjectId.isValid(data.eventId) ||
      !mongoose.Types.ObjectId.isValid(data.familyId)
    ) {
      throw new AppError("IDs de evento ou família inválidos.", 400);
    }

    await connectDB();

    const [event, family, anyDrawn] = await Promise.all([
      EventModel.findById(data.eventId).lean(),
      FamilyModel.findOne({ _id: data.familyId, eventId: data.eventId }).lean(),
      ParticipantModel.exists({ eventId: data.eventId, hasDrawn: true }),
    ]);

    if (!event) throw new AppError("Sorteio não encontrado.", 404);
    if (!family) throw new AppError("Família não encontrada neste sorteio.", 404);
    if (anyDrawn) {
      throw new AppError(
        "O sorteio já está em andamento. Para adicionar novos integrantes, clique em 'Reiniciar Sorteios'.",
        409
      );
    }

    const participant = await ParticipantModel.create({
      eventId: event._id,
      familyId: family._id,
      name: data.name,
      role: data.role,
      giftHint: data.giftHint,
    });

    return NextResponse.json(
      {
        participant: {
          id: participant._id.toString(),
          familyId: participant.familyId.toString(),
          name: participant.name,
          role: participant.role,
          giftHint: participant.giftHint,
          hasDrawn: false,
          hasPin: false,
          reRollCount: 0,
          drawnAt: null,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
