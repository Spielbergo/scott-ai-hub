import NextAuth from 'next-auth';
import GoogleProvider     from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),

    CredentialsProvider({
      name: 'Email',
      credentials: {
        email:    { label: 'Email',    type: 'email'    },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const adminEmail = process.env.ADMIN_EMAIL;
        const adminHash  = process.env.ADMIN_PASSWORD_HASH;
        if (!adminEmail || !adminHash) return null;
        if (!credentials?.email || !credentials?.password) return null;
        if (credentials.email.toLowerCase() !== adminEmail.toLowerCase()) return null;
        const valid = await bcrypt.compare(credentials.password, adminHash);
        if (!valid) return null;
        return { id: '1', name: 'Admin', email: adminEmail };
      },
    }),
  ],

  pages: {
    signIn: '/login',
    error:  '/login',
  },

  session: { strategy: 'jwt' },

  secret: process.env.NEXTAUTH_SECRET,

  callbacks: {
    /** Restrict all sign-ins to the admin email only */
    async signIn({ user }) {
      const allowed = (process.env.ADMIN_EMAIL || '').toLowerCase();
      if (!allowed) return false; // Block all if not configured
      return user.email?.toLowerCase() === allowed;
    },
    async session({ session, token }) {
      if (session?.user) session.user.id = token.sub;
      return session;
    },
  },
};

export default NextAuth(authOptions);
