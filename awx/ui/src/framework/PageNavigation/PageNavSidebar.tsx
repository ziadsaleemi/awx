import { ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBreakpoint } from '../components/useBreakPoint';

interface PageNavSideBarState {
  isOpen: boolean;
  isCollapsed: boolean;
  setState: (state: Partial<PageNavSideBarState>) => void;
}

export const PageNavSideBarContext = createContext<PageNavSideBarState>({
  isOpen: false,
  isCollapsed: false,
  setState: () => ({}),
});

export function usePageNavSideBar() {
  return useContext(PageNavSideBarContext);
}

export function PageNavSideBarProvider(props: { children: ReactNode }) {
  const isXl = useBreakpoint('xl');
  const [isOpen, setOpen] = useState(() => isXl);
  const [isCollapsed, setCollapsed] = useState(
    () => localStorage.getItem('nav-collapsed') === 'true'
  );
  const setState = useCallback((state: Partial<PageNavSideBarState>) => {
    if (state.isOpen !== undefined) setOpen(state.isOpen);
    if (state.isCollapsed !== undefined) {
      setCollapsed(state.isCollapsed);
      localStorage.setItem('nav-collapsed', state.isCollapsed ? 'true' : 'false');
    }
  }, []);
  useEffect(() => setState({ isOpen: isXl }), [isXl, setState]);
  return (
    <PageNavSideBarContext.Provider value={{ isOpen, isCollapsed, setState }}>
      {props.children}
    </PageNavSideBarContext.Provider>
  );
}

export function usePageNavBarClick() {
  const navigate = useNavigate();
  const isXl = useBreakpoint('xl');
  const navBar = usePageNavSideBar();
  const onClick = useCallback(
    (path: string) => {
      navigate(path);
      if (!isXl) navBar.setState({ isOpen: !navBar.isOpen });
    },
    [navigate, isXl, navBar]
  );
  return onClick;
}
