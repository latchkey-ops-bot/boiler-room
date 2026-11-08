import { createContext, type ReactNode, useContext } from 'react';
import type { BrandTheme } from './theme.ts';

const BrandContext = createContext<BrandTheme | undefined>(undefined);

export const BrandProvider = ({ theme, children }: { theme: BrandTheme; children: ReactNode }) => (
  <BrandContext.Provider value={theme}>{children}</BrandContext.Provider>
);

export function useBrand(): BrandTheme {
  const theme = useContext(BrandContext);
  if (!theme) throw new Error('useBrand must be used inside <BrandProvider>.');
  return theme;
}
