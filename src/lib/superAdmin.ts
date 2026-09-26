import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const envServiceKey = (import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY as string | undefined) || '';
const DEV_KEY_STORAGE = 'sanchay_dev_service_role_key';
const DEV_PIN_STORAGE = 'sanchay_dev_pin_verified';

export function getDeveloperPIN(): string {
  return (import.meta.env.VITE_DEV_ADMIN_PIN as string | undefined) || '1996';
}

export function isDeveloperUnlocked(): boolean {
  try {
    return sessionStorage.getItem(DEV_PIN_STORAGE) === 'true';
  } catch {
    return false;
  }
}

export function setDeveloperUnlocked(unlocked: boolean) {
  try {
    if (unlocked) sessionStorage.setItem(DEV_PIN_STORAGE, 'true');
    else sessionStorage.removeItem(DEV_PIN_STORAGE);
  } catch {
    // fallback
  }
}

export function getActiveServiceRoleKey(): string {
  if (envServiceKey && envServiceKey.trim().length > 10) {
    return envServiceKey.trim();
  }
  try {
    return localStorage.getItem(DEV_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setActiveServiceRoleKey(key: string) {
  try {
    localStorage.setItem(DEV_KEY_STORAGE, key.trim());
  } catch {
    // fallback
  }
}

export function createSuperAdminClient(customKey?: string): SupabaseClient | null {
  const keyToUse = customKey || getActiveServiceRoleKey();
  if (!keyToUse) return null;
  return createClient(url, keyToUse, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
