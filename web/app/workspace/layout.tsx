import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api';

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  if (!(await getMe())) redirect('/login');
  return children;
}
