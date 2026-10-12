import type { ReactNode } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';

/** The phone's one-line summary (2-3 numbers) that comes before filters, tiles and charts. */
export function PhoneBar({ children }: { children: ReactNode }) {
  const mobile = useIsMobile();
  if (!mobile) return null;
  return <div className="phone-summary" data-testid="phone-summary">{children}</div>;
}
