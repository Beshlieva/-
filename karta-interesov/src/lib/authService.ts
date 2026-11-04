import { supabase } from './supabase';
import type { Database } from '../types/database';

export type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export interface SignUpPayload {
  firstName: string;
  lastName: string;
  email: string;
  age: number;
  regionCode: string;
  password: string;
}

export interface SignInPayload {
  email: string;
  password: string;
}

const buildDisplayName = (firstName: string, lastName: string): string =>
  [firstName.trim(), lastName.trim()].filter(Boolean).join(' ').trim();

async function resolveRegionId(regionCode: string): Promise<number> {
  const { data, error } = await supabase
    .from('regions')
    .select('id')
    .eq('code', regionCode)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const regionRow = data as { id: number } | null;

  if (!regionRow) {
    throw new Error(`REGION_NOT_FOUND:${regionCode}`);
  }

  return regionRow.id;
}

async function syncProfileFromAuthUser(
  userId: string,
  email: string,
  displayName: string,
  age: number,
  regionId: number,
): Promise<ProfileRow> {
  const profileTable = supabase.from('profiles') as any;
  const profileInsert = {
    id: userId,
    email,
    display_name: displayName,
    region_id: regionId,
    age,
    role: 'user',
    updated_at: new Date().toISOString(),
  } as Database['public']['Tables']['profiles']['Insert'];

  const { data, error } = await profileTable
    .upsert(profileInsert, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data as ProfileRow;
}

export async function signUp(payload: SignUpPayload) {
  const firstName = payload.firstName.trim();
  const lastName = payload.lastName.trim();
  const displayName = buildDisplayName(firstName, lastName);

  if (!firstName || !lastName) {
    throw new Error('FIRST_NAME_AND_LAST_NAME_REQUIRED');
  }

  if (!Number.isInteger(payload.age) || payload.age < 10 || payload.age > 100) {
    throw new Error('AGE_OUT_OF_RANGE');
  }

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: payload.email,
    password: payload.password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
        full_name: displayName,
        age: String(payload.age),
        region_code: payload.regionCode,
      },
    },
  });

  if (authError) {
    throw authError;
  }

  const user = authData.user;

  if (!user) {
    throw new Error('SIGNUP_FAILED');
  }

  const regionId = await resolveRegionId(payload.regionCode);
  const profile = await syncProfileFromAuthUser(
    user.id,
    payload.email,
    displayName,
    payload.age,
    regionId,
  );

  return {
    user,
    profile,
    session: authData.session,
  };
}

export async function signInWithPassword({ email, password }: SignInPayload) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    throw error;
  }

  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw error;
  }
}

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  return data.user;
}

export async function getProfile(userId?: string): Promise<ProfileRow | null> {
  const effectiveUserId = userId ?? (await getCurrentUser())?.id;

  if (!effectiveUserId) {
    return null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', effectiveUserId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as ProfileRow | null) ?? null;
}
