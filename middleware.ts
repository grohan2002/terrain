export { auth as middleware } from "@/lib/auth";

export const config = {
  matcher: [
    // Protect all routes except static assets and NextAuth internals
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
