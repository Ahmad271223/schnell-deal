import { PageHeader } from '@/components/ui';
import { VehicleTable } from '@/components/vehicles';

export default function Page() {
  return (
    <div>
      <PageHeader title="Nicht verkauft" subtitle="Fahrzeuge, deren Auktion ohne Zuschlag endete. Der Plattformbetreiber stimmt das weitere Vorgehen mit Ihnen ab." />
      <VehicleTable statuses="UNSOLD" basePath="/autohaus/fahrzeuge" />
    </div>
  );
}
