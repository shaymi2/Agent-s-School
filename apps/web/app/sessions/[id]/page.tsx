import { Shell } from '@/components/Shell';
import { SessionReplay } from '@/components/SessionReplay';

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Shell>
      <SessionReplay sessionId={id} />
    </Shell>
  );
}
