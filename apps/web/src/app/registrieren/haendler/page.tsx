import { PublicLayout } from '@/components/public-layout';
import { RegistrationForm } from '@/components/registration-form';

export default function Page() {
  return (
    <PublicLayout wide>
      <h1 className="mb-1 text-2xl font-semibold">Registrierung Händler / Käufer</h1>
      <p className="mb-6 text-sm text-slate-600">Pflichtfelder sind mit * gekennzeichnet. Nach der Prüfung Ihrer Unterlagen erhalten Sie eine Freigabe per E-Mail.</p>
      <RegistrationForm type="DEALER" />
    </PublicLayout>
  );
}
