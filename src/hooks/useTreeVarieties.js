import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useFarm } from './useFarm';

export function useTreeVarieties() {
  const { farm } = useFarm();
  const [varieties, setVarieties] = useState([]);
  const [loading, setLoading] = useState(true);

  const refreshVarieties = useCallback(async () => {
    if (!farm) {
      setVarieties([]);
      setLoading(false);
      return [];
    }

    setLoading(true);
    const { data, error } = await supabase
      .from('tree_varieties')
      .select('id, name')
      .eq('farm_id', farm.id)
      .order('name');

    if (error) {
      console.error('Failed to load varieties:', error.message);
      setVarieties([]);
    } else {
      setVarieties(data || []);
    }
    setLoading(false);
    return data || [];
  }, [farm]);

  useEffect(() => {
    refreshVarieties();
  }, [refreshVarieties]);

  return { varieties, loading, refreshVarieties };
}
