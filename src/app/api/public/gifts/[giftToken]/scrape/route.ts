import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import { AppError, handleApiError } from "@/lib/auth";
import { scrapeProductUrl } from "@/lib/price-scraper";
import { EventModel } from "@/models/Event";

const scrapeBodySchema = z.object({
  url: z.string().trim().min(5, "Cole o link do produto."),
});

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/public/gifts/[giftToken]/scrape">
) {
  try {
    const { giftToken } = await ctx.params;
    const body = await req.json();
    const { url } = scrapeBodySchema.parse(body);

    await connectDB();

    const event = await EventModel.findOne({ giftToken }).lean();
    if (!event) {
      throw new AppError("Link da rodada de presentes não encontrado.", 404);
    }

    if (event.currentRound && event.currentRound !== "round1_gifts") {
      throw new AppError(
        "A 1ª Rodada de cadastro de presentes já foi encerrada pelo administrador.",
        403
      );
    }

    const scraped = await scrapeProductUrl(url);
    return NextResponse.json(scraped);
  } catch (err) {
    return handleApiError(err);
  }
}
