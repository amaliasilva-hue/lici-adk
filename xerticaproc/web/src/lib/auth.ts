import NextAuth, { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN ?? "xertica.com";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      const email = profile?.email ?? "";
      if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        return false; // block non-org emails
      }
      return true;
    },
    async jwt({ token, account }) {
      // persist the Google id_token so we can forward it to the backend
      if (account?.id_token) {
        token.idToken = account.id_token;
      }
      return token;
    },
    async session({ session, token }) {
      // expose idToken on the session for the proxy route
      (session as typeof session & { idToken?: string }).idToken =
        token.idToken as string | undefined;
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  session: { strategy: "jwt" },
};

export default NextAuth(authOptions);
