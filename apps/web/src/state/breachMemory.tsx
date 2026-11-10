import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { ForecastResult } from '@settle/shared';

interface BreachMemoryContextValue {
  hadBreach: boolean;
  setHadBreach: (val: boolean) => void;
  recordForecast: (forecast: ForecastResult | undefined) => void;
}

const BreachMemoryContext = createContext<BreachMemoryContextValue>({
  hadBreach: false,
  setHadBreach: () => {},
  recordForecast: () => {},
});

export const useBreachMemory = () => useContext(BreachMemoryContext);

export interface BreachMemoryProviderProps {
  children: ReactNode;
  initialHadBreach?: boolean;
}

export const BreachMemoryProvider: React.FC<BreachMemoryProviderProps> = ({
  children,
  initialHadBreach = false,
}) => {
  const [hadBreach, setHadBreach] = useState<boolean>(initialHadBreach);

  const recordForecast = useCallback((forecast: ForecastResult | undefined) => {
    if (forecast && forecast.firstBreachDate !== null) {
      setHadBreach(true);
    }
  }, []);

  return (
    <BreachMemoryContext.Provider value={{ hadBreach, setHadBreach, recordForecast }}>
      {children}
    </BreachMemoryContext.Provider>
  );
};

