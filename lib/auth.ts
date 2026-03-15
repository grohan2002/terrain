// ---------------------------------------------------------------------------
// NextAuth.js v5 configuration with RBAC.
// ---------------------------------------------------------------------------

import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import { hasPermission, getRequiredRole } from "@/lib/rbac";
import type { Role } from "@/lib/rbac";

// Extend NextAuth types to include role
declare module "next-auth" {
  interface User {
    role?: Role;
  }
  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: Role;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role?: Role;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (
          credentials?.email === "admin@bicep.dev" &&
          credentials?.password === "admin"
        ) {
          return {
            id: "1",
            email: "admin@bicep.dev",
            name: "Admin",
            role: "ADMIN" as Role,
          };
        }
        return null;
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = (user.role as Role) ?? "CONVERTER";
      }
      return token;
    },
    session({ session, token }) {
      session.user.role = (token.role as Role) ?? "CONVERTER";
      return session;
    },
    authorized({ auth: session, request }) {
      const isLoggedIn = !!session?.user;
      const pathname = request.nextUrl.pathname;
      const isApiRoute = pathname.startsWith("/api");
      const isAuthRoute = pathname.startsWith("/api/auth");
      const isCheckKey = pathname === "/api/check-key";
      const isDocsPage = pathname === "/api-docs" || pathname === "/api/docs";
      const isLoginPage = pathname === "/login";

      // Always allow auth routes, check-key, and docs
      if (isAuthRoute || isCheckKey || isDocsPage) return true;

      // Allow login page
      if (isLoginPage) return true;

      // Protect API routes
      if (isApiRoute && !isLoggedIn) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      // RBAC check for API routes
      if (isApiRoute && isLoggedIn) {
        const requiredRole = getRequiredRole(pathname);
        if (requiredRole) {
          const userRole = (session.user as { role?: string }).role ?? "CONVERTER";
          if (!hasPermission(userRole, requiredRole)) {
            return Response.json(
              { error: "Forbidden", requiredRole },
              { status: 403 },
            );
          }
        }
      }

      // Protect app pages
      if (!isLoggedIn) {
        return false; // Redirects to signIn page
      }

      return true;
    },
  },
});
