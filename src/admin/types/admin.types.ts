export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  company?: string;
  phone?: string;
  avatar?: string;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  permissions?: AdminPermission[];
}

export interface AdminPermission {
  id: string;
  name: string;
  description?: string;
  resource: string;
  action: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminRole {
  id: string;
  name: string;
  description?: string;
  permissions: AdminPermission[];
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminAuditLog {
  id: string;
  adminId: string;
  action: string;
  resource: string;
  resourceId?: string;
  oldData?: any;
  newData?: any;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  admin?: AdminUser;
}

export interface AdminDashboardStats {
  totalUsers: number;
  activeUsers: number;
  totalCampaigns: number;
  activeCampaigns: number;
  totalClients: number;
  totalRevenue: number;
  monthlyGrowth: {
    users: number;
    campaigns: number;
    revenue: number;
  };
  recentActivity: AdminAuditLog[];
  systemHealth: {
    status: 'healthy' | 'degraded' | 'down';
    uptime: number;
    responseTime: number;
  };
}

export interface BulkOperationResult {
  success: number;
  failed: number;
  errors: string[];
  affectedIds: string[];
}

export interface AdminSearchFilters {
  search?: string;
  role?: string;
  isActive?: boolean;
  dateRange?: {
    start: Date;
    end: Date;
  };
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface SystemMetrics {
  users: {
    total: number;
    active: number;
    newThisMonth: number;
    growthRate: number;
  };
  campaigns: {
    total: number;
    active: number;
    completed: number;
    successRate: number;
  };
  revenue: {
    total: number;
    monthly: number;
    growthRate: number;
  };
  system: {
    uptime: number;
    responseTime: number;
    errorRate: number;
  };
}
