import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/auth";
import { executeParticipantDraw } from "@/lib/draw-transaction";

const drawSchema = z.object({
  participantId: z.string().min(1, "Selecione quem é você."),
  pin: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Cadastre um PIN numérico de exatamente 4 dígitos."),
});

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/public/[token]/draw">
) {
  try {
    const { token } = await ctx.params;
    const body = await req.json();
    const { participantId, pin } = drawSchema.parse(body);

    const result = await executeParticipantDraw({
      shareToken: token,
      participantId,
      pin,
    });

    return NextResponse.json({
      drawerName: result.drawerName,
      chosen: result.chosen,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
