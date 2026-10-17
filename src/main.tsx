import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createServices } from '@/app/createServices';
import { App } from '@/ui/App';
import { AppContext } from '@/ui/servicesContext';
import { createViewStore } from '@/ui/viewStore';
import '@/ui/styles.css';

const services = createServices();
const view = createViewStore();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppContext.Provider value={{ services, view }}>
      <App />
    </AppContext.Provider>
  </StrictMode>,
);

void services.projects.init();
