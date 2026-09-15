import { createAdminClient, createClient } from "@insforge/sdk";
function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}
export const backendUrl = required("INSFORGE_URL");
export const admin = createAdminClient({
  baseUrl: backendUrl,
  apiKey: required("INSFORGE_API_KEY"),
});
export function userClient(token: string) {
  return createClient({
    baseUrl: backendUrl,
    anonKey: required("INSFORGE_ANON_KEY"),
    accessToken: token,
    isServerMode: true,
  });
}
export async function checked<T>(
  request: PromiseLike<{ data: T; error: unknown }>,
): Promise<T> {
  const { data, error } = await request;
  if (error)
    throw new Error(
      typeof error === "object" && error && "message" in error
        ? String(error.message)
        : String(error),
    );
  return data;
}
