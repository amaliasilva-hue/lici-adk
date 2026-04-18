import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      authorization: {
        params: { hd: 'xertica.com', prompt: 'select_account' },
      },
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      const email = (profile as any)?.email as string | undefined;
      return !!email && email.endsWith('@xertica.com');
    },
  },
  session: { strategy: 'jwt' },
};
