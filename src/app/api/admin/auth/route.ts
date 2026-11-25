import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ADMIN_COOKIE_NAME,
  AppError,
  createAdminSessionToken,
  getAdminPassword,
  handleApiError,
  isAdminAuthenticated,
} from "@/lib/auth";

const loginSchema = z.object({
  password: z.string().min(1, "Informe a senha de administrador."),
});

export async function GET(req: NextRequest) {
  try {
    const authenticated = await isAdminAuthenticated(req);
    return NextResponse.json({ authenticated });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password } = loginSchema.parse(body);

    if (password !== getAdminPassword()) {
      throw new AppError("Senha de administrador incorreta.", 401, "INVALID_PASSWORD");
    }

    const token = createAdminSessionToken();
    const res = NextResponse.json({ authenticated: true });
    res.cookies.set(ADMIN_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE() {
  const res = NextResponse.json({ authenticated: false });
  res.cookies.delete(ADMIN_COOKIE_NAME);
  return res;
}
