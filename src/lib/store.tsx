import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Confidence, NodeType } from '../types/graph';

type Theme = 'light' | 'dark';

export interface Exporter {
  png?: () => Promise<void> | void;
  svg?: () => Promise<void> | void;
  json?: () => void;
}

interface HoverState {
  id: string;
  rect: DOMRect;
}

interface Store {
  theme: Theme;
  toggleTheme: () => void;
  confidence: Set<Confidence>;
  toggleConfidence: (c: Confidence) => void;
  domainFilter: string | null;
  setDomainFilter: (j: string | null) => void;
  hiddenTypes: Set<NodeType>;
  setHiddenTypes: (s: Set<NodeType>) => void;
  paletteOpen: boolean;
  setPaletteOpen: (b: boolean) => void;
  helpOpen: boolean;
  setHelpOpen: (b: boolean) => void;
  explainOpen: boolean;
  setExplainOpen: (b: boolean) => void;
  exporter: React.MutableRefObject<Exporter | null>;
  hover: HoverState | null;
  setHover: (h: HoverState | null) => void;
  bannerDismissed: boolean;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  dismissBanner: () => void;
}

const Ctx = createContext<Store | null>(null);

const safeGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const safeSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode: ignore */
  }
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    // deep link: …#/graph?theme=light
    const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('theme');
    if (q === 'light' || q === 'dark') return q;
    return safeGet('carto-theme') === 'dark' ? 'dark' : 'light';
  });
  const [confidence, setConfidence] = useState<Set<Confidence>>(new Set(['V', 'H']));
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<NodeType>>(new Set(['doc', 'term', 'convention', 'question', 'issue', 'licence', 'file', 'step']));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(() => safeGet('carto-banner') === '1');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => safeGet('carto-sidebar') === 'collapsed');
  const toggleSidebar = useCallback(
    () =>
      setSidebarCollapsed((c) => {
        safeSet('carto-sidebar', c ? 'expanded' : 'collapsed');
        return !c;
      }),
    [],
  );
  const exporter = useRef<Exporter | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    safeSet('carto-theme', theme);
  }, [theme]);

  const toggleConfidence = useCallback((c: Confidence) => {
    setConfidence((prev) => {
      const n = new Set(prev);
      if (n.has(c)) {
        if (n.size > 1) n.delete(c);
      } else n.add(c);
      return n;
    });
  }, []);

  const value = useMemo<Store>(
    () => ({
      theme,
      toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
      confidence,
      toggleConfidence,
      domainFilter,
      setDomainFilter,
      hiddenTypes,
      setHiddenTypes,
      paletteOpen,
      setPaletteOpen,
      helpOpen,
      setHelpOpen,
      explainOpen,
      setExplainOpen,
      exporter,
      hover,
      setHover,
      bannerDismissed,
      dismissBanner: () => {
        setBannerDismissed(true);
        safeSet('carto-banner', '1');
      },
      sidebarCollapsed,
      toggleSidebar,
    }),
    [theme, confidence, toggleConfidence, domainFilter, hiddenTypes, paletteOpen, helpOpen, explainOpen, hover, bannerDismissed, sidebarCollapsed, toggleSidebar],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider manquant');
  return s;
}

/** Node inspector state lives in the URL (?n=<id>) so every selection is deep-linkable. */
export function useInspect(): [string | null, (id: string | null, tab?: string) => void, string] {
  const [params, setParams] = useSearchParams();
  const id = params.get('n');
  const tab = params.get('tab') ?? 'overview';
  const set = useCallback(
    (nid: string | null, t?: string) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (nid) p.set('n', nid);
          else p.delete('n');
          if (t) p.set('tab', t);
          else if (!nid) p.delete('tab');
          return p;
        },
        { replace: false },
      );
    },
    [setParams],
  );
  return [id, set, tab];
}

export function download(name: string, data: string | Blob, mime = 'application/json') {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
