"use server";
import { cookies } from "next/headers";
import { createAuthActions } from "@insforge/sdk/ssr";
export async function authenticate(
  mode: "signin" | "signup" | "verify",
  email: string,
  password: string,
) {
  const auth = createAuthActions({ cookies: await cookies() });
  const result =
    mode === "signin"
      ? await auth.signInWithPassword({ email, password })
      : mode === "verify"
        ? await auth.verifyEmail({ email, otp: password })
        : await auth.signUp({ email, password });
  if (result.error) return { error: result.error.message };
  return {
    ok: true,
    verification:
      mode === "signup" && "requireEmailVerification" in (result.data ?? {})
        ? Boolean((result.data as any).requireEmailVerification)
        : false,
  };
}
export async function logout() {
  const auth = createAuthActions({ cookies: await cookies() });
  await auth.signOut();
}
