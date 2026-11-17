import { motion } from 'framer-motion';
import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Shell } from './components/Shell';
import { StoreProvider } from './lib/store';
import Atlas from './views/Atlas';

const GraphExplorer = lazy(() => import('./views/GraphExplorer'));
const Lifecycles = lazy(() => import('./views/Lifecycles'));
const UiConventions = lazy(() => import('./views/UiConventions'));
const Catalog = lazy(() => import('./views/Catalog'));
const Diagrams = lazy(() => import('./views/Diagrams'));
const DataIntegrations = lazy(() => import('./views/DataIntegrations'));
const Database = lazy(() => import('./views/Database'));
const Workflows = lazy(() => import('./views/Workflows'));
const Risks = lazy(() => import('./views/Risks'));
const DocsReader = lazy(() => import('./views/DocsReader'));
const Glossary = lazy(() => import('./views/Glossary'));

function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative h-10 w-10">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="absolute left-1/2 top-1/2 h-2.5 w-2.5 rounded-full bg-accent"
              animate={{ x: [0, Math.cos((i * 2 * Math.PI) / 3) * 14, 0], y: [0, Math.sin((i * 2 * Math.PI) / 3) * 14, 0], opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
              style={{ marginLeft: -5, marginTop: -5 }}
            />
          ))}
        </div>
        <div className="text-[12px] text-muted">Chargement de la carte…</div>
      </div>
    </div>
  );
}

function TitleSync() {
  const loc = useLocation();
  useEffect(() => {
    const map: Record<string, string> = { graph: 'Graphe', modules: 'Modules', diagrams: 'Diagrammes', lifecycles: 'Cycles de vie', data: 'Intégrations', database: 'Base de données', workflows: 'Workflows', risks: 'Risques', docs: 'Documentation', glossary: 'Glossaire', ui: 'Conventions UI' };
    const seg = loc.pathname.split('/')[1];
    document.title = `${seg ? map[seg] ?? 'Atlas' : 'Atlas'} · Code Cartography · LiaWeb`;
  }, [loc.pathname]);
  return null;
}

function NodeRedirect() {
  const { id } = useParams();
  return <Navigate to={`/graph?n=${encodeURIComponent(id ?? '')}&focus=1`} replace />;
}

export default function App() {
  return (
    <HashRouter>
      <StoreProvider>
        <TitleSync />
        <Shell>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Atlas />} />
              <Route path="/graph" element={<GraphExplorer />} />
              <Route path="/lifecycles" element={<Lifecycles />} />
              <Route path="/ui" element={<UiConventions />} />
              <Route path="/modules" element={<Catalog />} />
              <Route path="/diagrams" element={<Diagrams />} />
              <Route path="/data" element={<DataIntegrations />} />
              <Route path="/database" element={<Database />} />
              <Route path="/workflows" element={<Workflows />} />
              <Route path="/risks" element={<Risks />} />
              <Route path="/docs" element={<Navigate to="/docs/00" replace />} />
              <Route path="/docs/:docId" element={<DocsReader />} />
              <Route path="/glossary" element={<Glossary />} />
              <Route path="/node/:id" element={<NodeRedirect />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Shell>
      </StoreProvider>
    </HashRouter>
  );
}
