import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from './AuthContext';

const FarmContext = createContext({
  farm: null,
  farms: [],
  loading: true,
  setFarm: () => {},
  refreshFarms: async () => [],
});

export function FarmProvider({ children }) {
  const { user } = useAuth();
  const [farm, setFarm] = useState(null);
  const [farms, setFarms] = useState([]);
  const [loading, setLoading] = useState(true);

  const refreshFarms = useCallback(async () => {
    if (!user) {
      setFarm(null);
      setFarms([]);
      setLoading(false);
      return [];
    }

    setLoading(true);
    const { data, error } = await supabase
      .from('farms')
      .select('*')
      .eq('user_id', user.id)
      .order('id');

    if (error) {
      console.error('Failed to load farms:', error.message);
      setFarms([]);
      setFarm(null);
    } else {
      setFarms(data || []);
      setFarm((prev) => {
        if (prev && data?.some((f) => f.id === prev.id)) {
          return data.find((f) => f.id === prev.id);
        }
        return data?.[0] || null;
      });
    }
    setLoading(false);
    return data || [];
  }, [user]);

  useEffect(() => {
    refreshFarms();
  }, [refreshFarms]);

  return (
    <FarmContext.Provider value={{ farm, farms, loading, setFarm, refreshFarms }}>
      {children}
    </FarmContext.Provider>
  );
}

export function useFarm() {
  return useContext(FarmContext);
}
