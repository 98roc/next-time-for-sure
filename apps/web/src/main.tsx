import { AppShell } from './layout/app-shell';
import { WeeklyPageV2 } from './v2/weekly-page';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, createRoutesFromElements, Navigate, Route, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AccountPage } from './identity/account-page';
import { OrganizationPage } from './organization/organization-page';
import { ProjectsPageV2 } from './v2/projects-page';
import { PersonalPageV2 } from './v2/personal-page';
import { TeamPageV2 } from './v2/team-page';
import { currentIdentity } from './identity/api';
import '@ntfs/ui/tokens.css';
import './style.css';
import './controls.css';
import './layout/workspace.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5000, refetchOnWindowFocus: false } } });
const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');
const router = createBrowserRouter(createRoutesFromElements(<><Route path="/account" element={<AccountPage />} /><Route element={<AppShell />}><Route path="/reports" element={<Navigate to="/weekly-plans" replace />} /><Route path="/weekly-plans" element={<WeeklyPageV2 />} /><Route path="/personal" element={<PersonalPageV2 />} /><Route path="/work" element={<ProjectsPageV2 />} /><Route path="/accounts" element={<OrganizationPage key="accounts" accounts />} /><Route path="/organization" element={<TeamRoute />} /><Route path="*" element={<Navigate to="/personal" replace />} /></Route></>));
createRoot(root).render(<StrictMode><QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider></StrictMode>);

/** 超管保留基础团队管理，团队负责人进入 V2 成员与项目配置。 */
function TeamRoute() { const identity = useQuery({ queryKey: ['identity'], queryFn: currentIdentity, retry: false }); return identity.data?.isSuperAdmin ? <OrganizationPage key="organization" /> : <TeamPageV2 />; }
