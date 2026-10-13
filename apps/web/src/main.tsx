import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FoundationPage } from './pages/foundation-page';
import '@ntfs/ui/tokens.css';
import './style.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5000, refetchOnWindowFocus: false } } });
const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');
createRoot(root).render(<StrictMode><QueryClientProvider client={client}><BrowserRouter><Routes><Route path="*" element={<FoundationPage />} /></Routes></BrowserRouter></QueryClientProvider></StrictMode>);
