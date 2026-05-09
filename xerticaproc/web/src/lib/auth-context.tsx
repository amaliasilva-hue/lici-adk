"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { setApiToken } from "@/lib/api";

const ALLOWED_DOMAIN = "xertica.com";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function FirebaseAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }

      if (firebaseUser) {
        const email = firebaseUser.email ?? "";
        if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
          // Block non-org accounts immediately
          await firebaseSignOut(auth);
          setApiToken(null);
          setUser(null);
        } else {
          const token = await firebaseUser.getIdToken();
          setApiToken(token);
          setUser(firebaseUser);
          // Refresh token every 55 minutes (Firebase tokens expire after 60 min)
          refreshTimer = setInterval(async () => {
            const freshToken = await firebaseUser.getIdToken(true);
            setApiToken(freshToken);
          }, 55 * 60 * 1000);
        }
      } else {
        setApiToken(null);
        setUser(null);
      }
      setLoading(false);
    });
    return () => {
      if (refreshTimer) {
        clearInterval(refreshTimer);
      }
      unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ hd: ALLOWED_DOMAIN });
    await signInWithPopup(auth, provider);
  }, []);

  const signOut = useCallback(async () => {
    setApiToken(null);
    await firebaseSignOut(auth);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside FirebaseAuthProvider");
  return ctx;
}
