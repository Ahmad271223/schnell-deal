import type { ReactNode } from 'react';
import { AreaShell } from '@/components/shell';

export default function Layout({ children }: { children: ReactNode }) {
  return <AreaShell area="aussendienst">{children}</AreaShell>;
}
