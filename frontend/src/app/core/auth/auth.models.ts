export type Role = 'USER' | 'ADMIN' | 'SUPER_ADMIN';

export interface User {
  id: string;
  username: string;
  email: string;
  role: Role;
  locale: 'pl' | 'en';
  emailVerified: boolean;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  locale: 'pl' | 'en';
  acceptTerms: boolean;
}

export interface UsernameAvailability {
  available: boolean;
  reason?: string;
}

const ROLE_RANK: Record<Role, number> = { USER: 1, ADMIN: 2, SUPER_ADMIN: 3 };

export function hasRole(user: User | null, required: Role): boolean {
  return !!user && ROLE_RANK[user.role] >= ROLE_RANK[required];
}
