import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import { AppError, handleApiError, requireAdmin } from "@/lib/auth";
import { EventModel } from "@/models/Event";
import { FamilyModel } from "@/models/Family";

const createFamilySchema = z.object({
  eventId: z.string().min(1, "Informe o evento."),
  name: z.string().trim().min(1, "Informe o nome da família."),
  color: z.string().trim().optional().default("#e11d48"),
});

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const eventId = req.nextUrl.searchParams.get("eventId");
    if (!eventId || !mongoose.Types.ObjectId.isValid(eventId)) {
      throw new AppError("Parâmetro eventId inválido.", 400);
    }

    await connectDB();
    const families = await FamilyModel.find({ eventId }).sort({ createdAt: 1 }).lean();
    return NextResponse.json({
      families: families.map((f) => ({
        id: f._id.toString(),
        eventId: f.eventId.toString(),
        name: f.name,
        color: f.color,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const data = createFamilySchema.parse(body);

    if (!mongoose.Types.ObjectId.isValid(data.eventId)) {
      throw new AppError("ID do sorteio inválido.", 400);
    }

    await connectDB();
    const event = await EventModel.findById(data.eventId).lean();
    if (!event) throw new AppError("Sorteio não encontrado.", 404);

    const family = await FamilyModel.create({
      eventId: event._id,
      name: data.name,
      color: data.color,
    });

    return NextResponse.json(
      {
        family: {
          id: family._id.toString(),
          eventId: family.eventId.toString(),
          name: family.name,
          color: family.color,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
