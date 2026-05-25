import { notFound } from 'next/navigation';

import DashboardActivatePage from '../../../src/app/dashboard/activate/page';
import DashboardAdsNetworkPage from '../../../src/app/dashboard/ads-network/page';
import DashboardCashTasksPage from '../../../src/app/dashboard/cash-tasks/page';
import DashboardChatPage from '../../../src/app/dashboard/chat/page';
import DashboardChallengesPage from '../../../src/app/dashboard/challenges/page';
import DashboardComingSoonPage from '../../../src/app/dashboard/coming-soon/page';
import DashboardFreelancePage from '../../../src/app/dashboard/freelance/page';
import DashboardJobsPage from '../../../src/app/dashboard/jobs/page';
import DashboardLedgerPage from '../../../src/app/dashboard/ledger/page';
import DashboardOfferwallsPage from '../../../src/app/dashboard/offerwalls/page';
import DashboardProfilePage from '../../../src/app/dashboard/profile/page';
import DashboardReferralsPage from '../../../src/app/dashboard/referrals/page';
import DashboardSuperadminPage from '../../../src/app/dashboard/superadmin/page';
import DashboardSurveysPage from '../../../src/app/dashboard/surveys/page';
import DashboardTasksPage from '../../../src/app/dashboard/tasks/page';
import DashboardWalletPage from '../../../src/app/dashboard/wallet/page';
import AdminConsolePage from '../../../src/app/dashboard/admin-console/page';
import AdminWorkspacePage from '../../../src/app/dashboard/admin/page';

const ROUTES: Record<string, React.ComponentType> = {
  'admin-console': AdminConsolePage,
  admin: AdminWorkspacePage,
  activate: DashboardActivatePage,
  'ads-network': DashboardAdsNetworkPage,
  'cash-tasks': DashboardCashTasksPage,
  chat: DashboardChatPage,
  challenges: DashboardChallengesPage,
  'coming-soon': DashboardComingSoonPage,
  freelance: DashboardFreelancePage,
  jobs: DashboardJobsPage,
  ledger: DashboardLedgerPage,
  offerwalls: DashboardOfferwallsPage,
  profile: DashboardProfilePage,
  referrals: DashboardReferralsPage,
  superadmin: DashboardSuperadminPage,
  surveys: DashboardSurveysPage,
  tasks: DashboardTasksPage,
  wallet: DashboardWalletPage,
};

export default function DashboardCatchAllPage({ params }: { params: { slug?: string[] } }) {
  const slug = params.slug?.join('/') || '';
  const [segment] = slug.split('/');
  const Page = ROUTES[segment];

  if (!Page) {
    notFound();
  }

  return <Page />;
}
