import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/auth";
import {
  resetPinAndRevealDraw,
  revealParticipantDraw,
} from "@/lib/draw-transaction";

const revealSchema = z.object({
  participantId: z.string().min(1, "Selecione quem é você."),
  pin: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Informe os 4 dígitos numéricos do seu PIN."),
  isResetPin: z.boolean().optional().default(false),
});

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/public/[token]/reveal">
) {
  try {
    const { token } = await ctx.params;
    const body = await req.json();
    const { participantId, pin, isResetPin } = revealSchema.parse(body);

    const result = isResetPin
      ? await resetPinAndRevealDraw({
          shareToken: token,
          participantId,
          newPin: pin,
        })
      : await revealParticipantDraw({
          shareToken: token,
          participantId,
          pin,
        });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
