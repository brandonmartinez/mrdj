import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { api, orgApi } from '../api.ts';
import type { MeResponse, MyOrg } from '../api.ts';

interface SessionValue {
  me:      MeResponse | null;
  orgs:    MyOrg[];
  loading: boolean;
  isAuthed: boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [orgs, setOrgs] = useState<MyOrg[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const meRes = await api.me();
      setMe(meRes);
      // Only account-typed sessions own orgs; guests get an empty list.
      if (meRes.user.type === 'account') {
        const { organizations } = await orgApi.myOrgs().catch(() => ({ organizations: [] }));
        setOrgs(organizations);
      } else {
        setOrgs([]);
      }
    } catch {
      setMe(null);
      setOrgs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const isAuthed = !!me && me.user.type === 'account';

  return (
    <SessionContext.Provider value={{ me, orgs, loading, isAuthed, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
