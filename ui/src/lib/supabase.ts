import { createClient } from '@supabase/supabase-js';
import { isLocalMode } from './localMode';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// In local mode, Supabase is not required
if (!isLocalMode()) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables');
  }
}

// Create Supabase client only if we have the required variables
// In local mode, this will be null/undefined, which should be handled by the app
export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;
