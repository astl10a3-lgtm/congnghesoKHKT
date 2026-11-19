import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { WorkflowProvider } from './context/WorkflowContext.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <WorkflowProvider>
    <App />
  </WorkflowProvider>
);
