export type AccountRole = 'admin' | 'member';
export type AccountStatus = 'active' | 'locked';

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  avatar: string;
  bio: string;
  role: AccountRole;
  status: AccountStatus;
  passwordUpdatedAt?: string;
  lastLoginAt?: string;
  joinedDate: string;
  totalCraftsMade: number;
  savedWasteKg: number;
  totalLikesReceived: number;
}

export interface AdminAccountRecord extends AuthUser {
  password: string;
}

export type AdminAuditAction =
  | 'create_account'
  | 'change_password'
  | 'view_passwords'
  | 'update_role'
  | 'toggle_status'
  | 'update_profile'
  | 'delete_account';

export interface AdminAuditLogItem {
  id: string;
  adminId: string;
  adminUsername: string;
  action: AdminAuditAction;
  targetAccountId?: string;
  targetUsername?: string;
  detail: string;
  createdAt: string;
}

export interface AdminDashboardData {
  accounts: AdminAccountRecord[];
  stats: {
    totalAccounts: number;
    adminCount: number;
    activeCount: number;
    lockedCount: number;
  };
  auditLogs: AdminAuditLogItem[];
}
