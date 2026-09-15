"use client";
import { createBrowserClient } from "@insforge/sdk/ssr";
let backend: ReturnType<typeof createBrowserClient> | undefined;
export function getBackend() {
  backend ??= createBrowserClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
    anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!,
  });
  return backend;
}
export async function api(path: string, body?: unknown) {
  const token = document.cookie
    .split("; ")
    .find((c) => c.startsWith("insforge_access_token="))
    ?.split("=")
    .slice(1)
    .join("=");
  const proof = sessionStorage.getItem("vc-wallet-proof");
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000"}${path}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token
          ? { Authorization: `Bearer ${decodeURIComponent(token)}` }
          : {}),
        ...(proof ? { "X-Wallet-Proof": proof } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Request failed");
  return result;
}
