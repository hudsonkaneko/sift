'use client';

import { SWRConfig } from 'swr';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        errorRetryCount: 3,
        errorRetryInterval: 2000,
        dedupingInterval: 5000,
        revalidateOnFocus: false,
      }}
    >
      {children}
    </SWRConfig>
  );
}
