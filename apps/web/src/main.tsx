import { WeeklyPage } from './weekly-plans/weekly-page';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FoundationPage } from './pages/foundation-page';
import { AccountPage } from './identity/account-page';
import { OrganizationPage } from './organization/organization-page';
import { WorkPage } from './work/work-page';
import { PersonalPage } from './personal/personal-page';
import '@ntfs/ui/tokens.css';
import './style.css';
import './controls.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5000, refetchOnWindowFocus: false } } });
const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');
createRoot(root).render(<StrictMode><QueryClientProvider client={client}><BrowserRouter><Routes><Route path="/weekly-plans" element={<WeeklyPage />} /><Route path="/personal" element={<PersonalPage />} /><Route path="/work" element={<WorkPage />} /><Route path="/organization" element={<OrganizationPage />} /><Route path="/account" element={<AccountPage />} /><Route path="*" element={<FoundationPage />} /></Routes></BrowserRouter></QueryClientProvider></StrictMode>);
