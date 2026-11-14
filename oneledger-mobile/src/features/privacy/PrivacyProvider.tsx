import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type PrivacyContextValue = {
  /** When true, every MoneyAmount renders a placeholder instead of a value. */
  amountsHidden: boolean;
  toggleAmountsHidden: () => void;
};

const PrivacyContext = createContext<PrivacyContextValue>({
  amountsHidden: false,
  toggleAmountsHidden: () => {},
});

/**
 * Privacy mode ("hide amounts"), the mobile counterpart of the web
 * dashboard mask. In-memory for now; persistence arrives with settings.
 */
export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [amountsHidden, setAmountsHidden] = useState(false);
  const toggleAmountsHidden = useCallback(
    () => setAmountsHidden((hidden) => !hidden),
    [],
  );
  const value = useMemo(
    () => ({ amountsHidden, toggleAmountsHidden }),
    [amountsHidden, toggleAmountsHidden],
  );
  return (
    <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>
  );
}

export function usePrivacy(): PrivacyContextValue {
  return useContext(PrivacyContext);
}
